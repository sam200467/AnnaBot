"use strict";
// 端到端：假 QQ 平台（mock-official）+ 假落雪（mock-lxns）+ 真的绑定库/指令层/功能，只有出图换成假的。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMockOfficial } = require("./mock-official.cjs");
const { createMockLxns, PNG } = require("./mock-lxns.cjs");
const { createLxnsClient, LxnsError } = require("../src/lxns.cjs");
const { createOAuth } = require("../src/lxns-oauth.cjs");
const { openVault } = require("../src/vault.cjs");
const { createBindings } = require("../src/bindings.cjs");
const { createCatalog } = require("../src/catalog.cjs");
const { createAnnaBot } = require("../src/bot.cjs");
const { V } = require("../src/voice.cjs");
const defaultFeatures = require("../src/features/index.cjs");

const FC1 = "123456789012345";
const FC2 = "102000000000002";

async function setup(t, { features, render, config = {} } = {}) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns();
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-bot-"));
  const lxns = createLxnsClient({ baseUrl: lx.apiBase, devToken: lx.devToken, retries: 0 });
  const oauth = createOAuth({ clientId: lx.clientId, clientSecret: lx.clientSecret, siteUrl: lx.site });
  const vault = await openVault({ file: path.join(dir, "bindings.enc"), key: crypto.randomBytes(32) });
  const bindings = createBindings({ vault, lxns, oauth });
  const catalog = createCatalog({ lxns, cacheDir: path.join(dir, "cache") });
  await catalog.ready();
  const renderer = { render: render || (async () => ({ buffer: PNG })) };
  const logs = [];
  const bot = createAnnaBot({
    allowedGroupIds: ["G1"], allowPrivateChat: true, admins: ["ADMIN"],
    receiptDelayMs: 200, generateCooldownMs: 0,
    qq: { appId: "1", clientSecret: "x", tokenUrl: qq.tokenUrl, apiBase: qq.apiBase, sandboxApiBase: qq.apiBase, sandbox: false,
      minSendIntervalMs: 0, jitterMs: 0, perTargetIntervalMs: 0, perTargetPerHour: 1000 },
    ...config,
  }, { lxns, oauth, bindings, catalog, renderer, log: (line) => logs.push(line), ...(features ? { features } : {}) });
  t.after(async () => {
    bot.stop();
    await qq.stop();
    await lx.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let seq = 0;
  const id = () => "m" + (++seq);
  const send = (name, d) => bot.handleEvent(name, d);
  const group = (content, { user = "U1", groupId = "G1", msgId = id() } = {}) =>
    send("GROUP_AT_MESSAGE_CREATE", { id: msgId, group_openid: groupId, author: { member_openid: user }, content: " " + content });
  const direct = (content, { user = "U1" } = {}) =>
    send("C2C_MESSAGE_CREATE", { id: id(), author: { user_openid: user }, content });
  // 开了全量消息的群：@ 以 mentions 给出，正文里带 <@openid> 标记
  const groupAll = (content, mentions, { user = "U1", msgId = id() } = {}) =>
    send("GROUP_MESSAGE_CREATE", { id: msgId, group_openid: "G1", author: { member_openid: user }, content, ...(mentions ? { mentions } : {}) });
  const texts = () => qq.state.sent.map((s) => s.body.content ?? s.body.markdown?.content);
  const last = () => texts().at(-1);
  async function authorize(user, friendCode, via = group) {
    await via("/授权", { user });
    const url = last().match(/https?:\/\/\S+/)[0];
    return lx.approve(friendCode, new URL(url).searchParams.get("code_challenge"));
  }
  return { qq, lx, bot, bindings, vault, logs, group, direct, groupAll, texts, last, authorize, id };
}

const BOT_MENTION = { id: "BOT", member_openid: "BOT", is_you: true, bot: true };

test("安装更新后连接 QQ 即主动发送更新日志，无需群消息触发", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anna-update-start-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({
    version: "new-version", installedAt: "2026-10-21", notifyUpdate: true, notes: ["上线通知"],
  }));
  const s = await setup(t, { config: { root, workDir: path.join(root, "data"), commandPanel: false } });
  await s.bot.start();
  assert.ok(await s.qq.waitFor(() => s.qq.state.sent.length === 1, 5000));
  assert.match(s.last(), /更新日志[\s\S]*上线通知/);
  assert.ok(s.qq.state.sent[0].body.markdown.content.startsWith("### **Anna 更新日志**\n"));
  assert.equal(s.qq.state.sent[0].path, "/v2/groups/G1/messages");
  assert.equal(s.qq.state.sent[0].body.msg_id, undefined);
  await s.group("/状态");
  assert.equal(s.texts().filter((text) => text.includes("更新日志")).length, 1);
});

test("更新通知：仅白名单群触发，普通群消息可触发，指令继续正常回复且重启不重发", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anna-update-bot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({
    version: "new-version", installedAt: "2026-10-21", notifyUpdate: true, notes: ["新增通知"],
  }));
  const config = { root, workDir: path.join(root, "data") };
  const s = await setup(t, { config });
  await s.group("/状态", { groupId: "G2" });
  await s.direct("/状态");
  assert.ok(s.texts().every((text) => !text.includes("更新日志")));
  await s.groupAll("早上好");
  assert.match(s.last(), /更新日志[\s\S]*新增通知/);
  assert.ok(s.qq.state.sent.at(-1).body.markdown.content.startsWith("### **Anna 更新日志**\n"));
  assert.equal(s.qq.state.sent.at(-1).body.msg_id, "m3");
  await s.group("/状态");
  assert.equal(s.texts().filter((text) => text.includes("更新日志")).length, 1);
  assert.match(s.last(), /已运行/);
  const restarted = await setup(t, { config });
  await restarted.group("/状态");
  assert.equal(restarted.texts().filter((text) => text.includes("更新日志")).length, 0);
});

test("白名单外的群、没 @ 的群消息、别的机器人被 @ 的指令，一律不理", async (t) => {
  const s = await setup(t);
  await s.group("/帮助", { groupId: "G2" });
  await s.groupAll("/帮助");
  await s.groupAll("<@OTHER> /帮助", [{ id: "OTHER", is_you: false, bot: true }]);
  await s.groupAll("<@BOT> /帮助", [BOT_MENTION, { id: "ALL", scope: "all" }]);   // @全体成员
  assert.equal(s.qq.state.sent.length, 0);
  await s.groupAll("<@BOT> /帮助", [BOT_MENTION]);
  assert.equal(s.qq.state.sent.length, 1);
  assert.match(s.last(), /【先让我记住你】[\s\S]*\/绑定 好友码/);
  assert.equal(s.qq.state.sent[0].path, "/v2/groups/G1/messages");
});

test("同一条消息以两种事件名各推一次，只回一次", async (t) => {
  const s = await setup(t);
  await s.group("/状态", { msgId: "dup-1" });
  await s.groupAll("<@BOT> /状态", [BOT_MENTION], { msgId: "dup-1" });
  assert.equal(s.qq.state.sent.length, 1);
  assert.match(s.last(), /在线：/);
});

test("好友码绑定流程：没绑 → 用法 → 找不到 → 绑上 → /信息", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "测试玩家", rating: 16.5482,
    total_play_count: 1234, over_power: 12345.678, over_power_progress: 35.67 });
  await s.group("/信息");
  assert.equal(s.last(), V.needBinding);
  await s.group("/绑定");
  assert.equal(s.last(), V.bindUsage);
  await s.group("/绑定 999999999999999");
  assert.match(s.last(), /找不到这个玩家/);
  await s.group("＃绑定　" + FC1);                      // 全角井号、全角空格也认
  assert.match(s.last(), /记住了：测试玩家（Rating 16\.54）/);
  await s.group("/信息");
  assert.match(s.last(), /测试玩家（Rating 16\.54）\n好友码：123456789012345\n绑定方式：好友码/);
  assert.match(s.last(), /总游玩次数：1234 次\n总 OP：12345\.68\nOP 进度：35\.67%/);
});

test("授权流程：拿链接 → 落雪页面给授权码 → /授权 授权码 → 成功", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "测试玩家", total_play_count: 0, over_power: 0, over_power_progress: 0 });
  const code = await s.authorize("U1", FC1);
  assert.match(s.texts().at(-1), /只对你有效/);
  await s.group("/授权 " + code);
  assert.match(s.last(), /^好了：测试玩家/);
  await s.group("/信息");
  assert.match(s.last(), /绑定方式：授权/);
  assert.match(s.last(), /总游玩次数：0 次\n总 OP：0\.00\nOP 进度：0\.00%/);
  // 授权码没进日志
  assert.ok(!s.logs.join("\n").includes(code));
});

test("别人抢先用你的授权码：没发过 /授权 的、自己发过 /授权 的都绑不上；你自己照样能用", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "测试玩家" });
  const code = await s.authorize("U1", FC1);
  await s.group("/授权 " + code, { user: "U2" });
  assert.equal(s.last(), V.authorizeNoPending);
  await s.group("/授权", { user: "U2" });
  await s.group("/授权 " + code, { user: "U2" });
  assert.equal(s.last(), V.authorizeBadCode);
  assert.equal(s.bindings.get("U2"), null);
  await s.group("/授权 " + code);
  assert.match(s.last(), /^好了：/);
});

test("私聊：有进行中的授权时直接发授权码也认；没有时当普通话", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "测试玩家" });
  await s.direct("ABCD-EFGH-IJKL");
  assert.equal(s.last(), V.notACommand);
  const code = await s.authorize("U1", FC1, s.direct);
  assert.equal(s.qq.state.sent.at(-1).path, "/v2/users/U1/messages");
  await s.direct(code);
  assert.match(s.last(), /^好了：/);
  await s.direct("信息");                                 // 私聊里不带前缀的指令词也认
  assert.match(s.last(), /绑定方式：授权/);
  assert.match(s.last(), /总游玩次数：未知\n总 OP：未知\nOP 进度：未知/);
});

test("/解绑 要在有效期内再发一次才执行", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "测试玩家" });
  await s.group("/解绑");
  assert.equal(s.last(), V.unbindNotBound);
  await s.group("/绑定 " + FC1);
  await s.group("/解绑");
  assert.match(s.last(), /再发一次「\/解绑」，我就照做/);
  assert.ok(s.bindings.get("U1"));
  await s.group("/解绑", { user: "U2" });                 // 别人的确认不算数
  await s.group("/解绑");
  assert.match(s.last(), /^好，解绑了/);
  assert.equal(s.bindings.get("U1"), null);
});

test("@ 别人查：走开发者接口，受对方的第三方开关管；对方没绑定时说一声", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "测试玩家", privacy: { player: false } });
  const code = await s.authorize("U1", FC1);
  await s.group("/授权 " + code);
  await s.group("/信息");                                 // 自己查：走授权令牌，不受开关管
  assert.match(s.last(), /^测试玩家/);
  await s.groupAll("<@BOT> <@U1> /信息", [BOT_MENTION, { id: "U1", member_openid: "U1" }], { user: "U2" });
  assert.match(s.last(), /关了「允许读取玩家信息」/);
  assert.equal(s.lx.state.requests.at(-1).auth, "dev");
  await s.groupAll("<@BOT> <@U9> /信息", [BOT_MENTION, { id: "U9", member_openid: "U9" }], { user: "U2" });
  assert.equal(s.last(), V.otherNotBound);
});

test("未知指令、@ 了但不是指令、管理员指令", async (t) => {
  const s = await setup(t);
  await s.group("/不存在的指令");
  assert.equal(s.last(), V.unknownCommand);
  await s.group("你好呀");
  assert.equal(s.last(), V.notACommand);
  await s.group("/刷新曲库");
  assert.equal(s.last(), V.unknownCommand);                // 不是管理员：当没有这个指令
  await s.group("/刷新曲库", { user: "ADMIN" });
  assert.match(s.last(), /曲库刷新好了：3 首/);
  await s.group("/帮助");
  assert.ok(!s.last().includes("刷新曲库"));
});

// ── 出图队列 ──
function imageFeature(kind = "demo") {
  return {
    name: "img-" + kind, words: [kind], usage: "/" + kind, summary: "测试出图", group: "测试",
    async run(ctx) {
      await ctx.image({ kind, render: () => ctx.services.renderer.render(kind, {}) });
    },
  };
}

test("出图：很快出来就直接发图，不发占位；慢了先说一声", async (t) => {
  let delay = 0;
  const s = await setup(t, {
    features: [...defaultFeatures, imageFeature("demo")],
    render: async () => { await new Promise((r) => setTimeout(r, delay)); return { buffer: PNG, caption: "图注" }; },
  });
  await s.group("/demo");
  assert.equal(s.qq.state.sent.length, 1);
  assert.equal(s.qq.state.sent[0].body.msg_type, 7);
  assert.equal(s.qq.state.uploads.length, 1);
  delay = 500;
  await s.group("/demo");
  const kinds = s.qq.state.sent.slice(1).map((x) => x.body.msg_type);
  assert.deepEqual(kinds, [0, 7]);
  assert.ok(V.jobAccepted.includes(s.texts()[1]));
});

test("出图：同一个人同一种图排着队时不再接；冷却；失败给好懂的原因", async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let fail = false;
  const s = await setup(t, {
    features: [...defaultFeatures, imageFeature("demo")],
    config: { generateCooldownMs: 60_000, receiptDelayMs: 10_000 },
    render: async () => {
      await gate;
      if (fail) throw new LxnsError("allow third party fetch scores is disabled", { status: 403, code: "privacy_scores" });
      return { buffer: PNG };
    },
  });
  const first = s.group("/demo");
  await new Promise((r) => setTimeout(r, 50));
  await s.group("/demo");
  assert.equal(s.last(), V.jobSameKindPending);
  const other = s.group("/demo", { user: "U2" });          // 别人的照样排队，并且被告知前面有几张
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(s.last(), V.jobQueued(1));
  fail = true;
  release();
  await first;
  await other;
  assert.match(s.last(), /这张图没画成：.*允许读取谱面成绩/);
  await s.group("/demo");
  assert.match(s.last(), /秒后再来/);
});

test("出图：图好时被动回复窗口已过（40034128），只记日志不补发文字", async (t) => {
  const s = await setup(t, { features: [...defaultFeatures, imageFeature("demo")] });
  let calls = 0;
  s.bot.transport.sendImage = async () => {
    calls++;
    throw Object.assign(new Error("被动回复超时"), { code: 40034128 });
  };
  await s.group("/demo");
  assert.equal(calls, 1);
  assert.equal(s.qq.state.sent.length, 0);
  assert.ok(s.logs.some((line) => line.includes("被动回复窗口已过")));
});

test("走真的网关：bot.start() 之后推一条消息能收到回复", async (t) => {
  const s = await setup(t);
  await s.bot.start();
  await s.qq.waitFor(() => s.qq.state.identified.length > 0);
  s.qq.push("C2C_MESSAGE_CREATE", { id: "gw-1", author: { user_openid: "U1" }, content: "/状态" });
  assert.ok(await s.qq.waitFor(() => s.qq.state.sent.length === 1));
  assert.match(s.last(), /在线：是/);
  // 启动时顺带把指令面板同步上去：群聊的只挂白名单里的群
  assert.ok(await s.qq.waitFor(() => s.logs.some((line) => line.startsWith("指令面板："))));
  assert.ok(s.logs.includes("指令面板：群聊新建了（1 个群），私聊新建了"));
  const group = [...s.qq.state.panels.values()].find((p) => p.scope === "group");
  assert.deepEqual([...group.targets], ["G1"]);
});

test("commandPanel=false 时启动不碰指令面板", async (t) => {
  const s = await setup(t, { config: { commandPanel: false } });
  await s.bot.start();
  await s.qq.waitFor(() => s.qq.state.identified.length > 0);
  s.qq.push("C2C_MESSAGE_CREATE", { id: "gw-1", author: { user_openid: "U1" }, content: "/状态" });
  assert.ok(await s.qq.waitFor(() => s.qq.state.sent.length === 1));
  assert.equal(s.qq.state.panelCalls.length, 0);
});
