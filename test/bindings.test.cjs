"use strict";
// OAuth + 绑定：PKCE、令牌滚动、并发刷新只刷一次、授权失效退回好友码、查别人不用对方的令牌。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLxnsClient } = require("../src/lxns.cjs");
const { createOAuth } = require("../src/lxns-oauth.cjs");
const { openVault } = require("../src/vault.cjs");
const { createBindings, normalizeFriendCode } = require("../src/bindings.cjs");
const { createMockLxns } = require("./mock-lxns.cjs");

async function setup(t) {
  const mock = createMockLxns();
  await mock.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-bind-"));
  t.after(async () => { await mock.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const key = crypto.randomBytes(32);
  const file = path.join(dir, "bindings.enc");
  const vault = await openVault({ file, key });
  const lxns = createLxnsClient({ baseUrl: mock.apiBase, devToken: mock.devToken, retryDelayMs: 10 });
  const oauth = createOAuth({ clientId: mock.clientId, clientSecret: mock.clientSecret, siteUrl: mock.site });
  const logs = [];
  const bindings = createBindings({ vault, lxns, oauth, log: (line) => logs.push(line) });
  // 走一遍授权：拿链接 → 「玩家同意」→ 用授权码换令牌
  async function authorize(openid, friendCode) {
    const { url } = bindings.startOAuth(openid);
    const code = mock.approve(friendCode, new URL(url).searchParams.get("code_challenge"));
    return bindings.finishOAuth(openid, code);
  }
  return { mock, vault, lxns, oauth, bindings, authorize, logs, file, key };
}

test("好友码：全角数字、空格都认；不是数字直接拒", () => {
  assert.equal(normalizeFriendCode(" １０１ ９１５ "), "101915");
  assert.equal(normalizeFriendCode("abc"), null);
  assert.equal(normalizeFriendCode("12"), null);
});

test("好友码绑定：先去落雪确认玩家存在再存", async (t) => {
  const { mock, bindings } = await setup(t);
  mock.addPlayer({ friendCode: "123456789012345", name: "测试玩家", rating: 17 });
  await assert.rejects(bindings.bindFriendCode("U1", "999999999999999"), (e) => e.code === "player_not_found");
  await assert.rejects(bindings.bindFriendCode("U1", "12"), (e) => e.code === "invalid_friend_code");
  assert.equal(bindings.get("U1"), null);
  const { player } = await bindings.bindFriendCode("U1", "123 456 789 012 345");
  assert.equal(player.name, "测试玩家");
  assert.deepEqual({ ...bindings.get("U1"), boundAt: "" },
    { friendCode: "123456789012345", playerName: "测试玩家", method: "friendCode", boundAt: "" });
});

test("授权链接带 PKCE 和无回调地址；授权码只能配发链接的那个人", async (t) => {
  const { mock, bindings, authorize } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "测试玩家" });
  const { url } = bindings.startOAuth("U1");
  const params = new URL(url).searchParams;
  assert.equal(params.get("redirect_uri"), "urn:ietf:wg:oauth:2.0:oob");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("scope"), "read_player");
  const code = mock.approve("101", params.get("code_challenge"));
  // 别人抢先拿这个授权码来绑：他自己也发过 /授权，但 verifier 对不上
  bindings.startOAuth("U2");
  await assert.rejects(bindings.finishOAuth("U2", code), (e) => e.code === "invalid_grant");
  // 没发过 /授权 的人
  await assert.rejects(bindings.finishOAuth("U3", code), (e) => e.code === "no_pending");
  // 本人照样能用
  const { player } = await bindings.finishOAuth("U1", code);
  assert.equal(player.name, "测试玩家");
  assert.equal(bindings.get("U1").method, "oauth");
  assert.equal(bindings.get("U2"), null);
  // authorize() 辅助函数自己也能跑通
  mock.addPlayer({ friendCode: "102", name: "B" });
  await authorize("U4", "102");
  assert.equal(bindings.get("U4").playerName, "B");
});

test("授权码输错不清掉这次授权，改对了还能用", async (t) => {
  const { mock, bindings } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "测试玩家" });
  const { url } = bindings.startOAuth("U1");
  const code = mock.approve("101", new URL(url).searchParams.get("code_challenge"));
  await assert.rejects(bindings.finishOAuth("U1", "WRONG-CODE-XXXX"), (e) => e.code === "invalid_grant");
  await bindings.finishOAuth("U1", code);
  assert.equal(bindings.get("U1").method, "oauth");
});

test("访问令牌被落雪拒了就强制刷新再试，新的刷新令牌写回绑定库（文件里也是新的）", async (t) => {
  const { mock, bindings, authorize, file, key } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "测试玩家" });
  await authorize("U1", "101");
  const firstRefresh = bindings.get("U1").oauth.refreshToken;
  mock.expireAccessTokens();
  // 本地记的还没到期，所以先拿旧令牌去查 → 落雪回 401 → 强制刷新再试
  await bindings.player("U1").bests();
  const second = bindings.get("U1").oauth;
  assert.notEqual(second.refreshToken, firstRefresh);
  assert.equal(second.status, "ok");
  const reopened = await openVault({ file, key });
  assert.equal(reopened.get("U1").oauth.refreshToken, second.refreshToken);
});

test("两个查询同时触发刷新，只刷新一次（刷新令牌是滚动的，刷两次第二次必失败）", async (t) => {
  const { mock, bindings, authorize, vault } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "测试玩家" });
  await authorize("U1", "101");
  await vault.update("U1", (e) => ({ ...e, oauth: { ...e.oauth, expiresAt: 0 } }));
  mock.state.tokenDelayMs = 50;
  const before = mock.state.tokenGrants.filter((g) => g === "refresh_token").length;
  const api = bindings.player("U1");
  const results = await Promise.all([api.player(), api.bests(), api.scores()]);
  assert.equal(results[0].name, "测试玩家");
  assert.equal(mock.state.tokenGrants.filter((g) => g === "refresh_token").length - before, 1);
  assert.equal(bindings.get("U1").oauth.status, "ok");
});

test("授权被撤销：标记失效，基础查询退回好友码，全部成绩请玩家重新授权", async (t) => {
  const { mock, bindings, authorize, vault } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "测试玩家" });
  await authorize("U1", "101");
  mock.revoke("101");
  await vault.update("U1", (e) => ({ ...e, oauth: { ...e.oauth, expiresAt: 0 } }));
  const api = bindings.player("U1");
  const bests = await api.bests();   // 刷新失败 → 退回开发者接口
  assert.equal(bests.bests.length, 2);
  assert.equal(mock.state.requests.at(-1).auth, "dev");
  assert.equal(bindings.get("U1").oauth.status, "expired");
  const after = bindings.player("U1");
  assert.equal(after.oauthExpired, true);
  assert.equal(after.hasFullScores, false);
  await assert.rejects(after.scores(), (e) => e.code === "oauth_expired");
});

test("网络错误不算授权失效", async (t) => {
  const { mock, bindings, authorize, vault } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "测试玩家" });
  await authorize("U1", "101");
  await vault.update("U1", (e) => ({ ...e, oauth: { ...e.oauth, expiresAt: 0 } }));
  mock.failNext(503, { error: "server_error" });
  await assert.rejects(bindings.accessToken("U1"));
  assert.equal(bindings.get("U1").oauth.status, "ok");
  assert.ok(await bindings.accessToken("U1"));
});

test("替别人查（thirdParty）只走开发者接口，不用对方的授权令牌，受对方的第三方开关管", async (t) => {
  const { mock, bindings, authorize } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "测试玩家", privacy: { scores: false } });
  await authorize("U1", "101");
  const mine = bindings.player("U1");
  assert.equal((await mine.bests()).bests.length, 2);   // 自己查：走授权令牌，不受开关管
  assert.equal(mock.state.requests.at(-1).auth, "bearer");
  const theirs = bindings.player("U1", { thirdParty: true });
  assert.equal(theirs.hasFullScores, false);
  await assert.rejects(theirs.bests(), (e) => e.code === "privacy_scores");
  assert.equal(mock.state.requests.at(-1).auth, "dev");
});

test("好友码绑定读不了全部分数；OAuth 绑定能读", async (t) => {
  const { mock, bindings, authorize } = await setup(t);
  mock.addPlayer({ friendCode: "101000000000001", name: "A" });
  mock.addPlayer({ friendCode: "102", name: "B" });
  await bindings.bindFriendCode("U1", "101000000000001");
  await authorize("U2", "102");
  await assert.rejects(bindings.player("U1").scores(), (e) => e.code === "need_oauth");
  assert.equal((await bindings.player("U1").simpleScores())[0].score, undefined);
  assert.equal((await bindings.player("U2").scores())[0].score, 1007725);
});

test("续期：很久没用的授权替他刷新一次；解绑删掉条目", async (t) => {
  const { mock, bindings, authorize, vault } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "A" });
  await authorize("U1", "101");
  await vault.update("U1", (e) => ({ ...e, oauth: { ...e.oauth, refreshedAt: 0 } }));
  const result = await bindings.keepAlive(24 * 60 * 60 * 1000);
  assert.deepEqual(result, { refreshed: 1, expired: 0 });
  assert.ok(bindings.get("U1").oauth.refreshedAt > 0);
  assert.deepEqual(bindings.stats(), { total: 1, friendCode: 0, oauth: 1, oauthExpired: 0 });
  assert.equal(await bindings.unbind("U1"), true);
  assert.equal(bindings.get("U1"), null);
});
