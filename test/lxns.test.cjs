"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createLxnsClient, LxnsError } = require("../src/lxns.cjs");
const { createMockLxns } = require("./mock-lxns.cjs");

async function setup(t, options = {}) {
  const mock = createMockLxns();
  await mock.start();
  t.after(() => mock.stop());
  const lxns = createLxnsClient({ baseUrl: mock.apiBase, devToken: mock.devToken, retryDelayMs: 10, ...options });
  return { mock, lxns };
}

test("公共接口直接返回数据（没有 success/data 那层），开发者接口自动解包", async (t) => {
  const { mock, lxns } = await setup(t);
  mock.addPlayer({ friendCode: "101", name: "测试玩家", rating: 17 });
  const list = await lxns.songList();
  assert.equal(list.songs.length, 3);
  const player = await lxns.dev.player("101");
  assert.equal(player.name, "测试玩家");
  assert.equal(mock.state.requests.at(-1).auth, "dev");
});

test("错误按类归好：好友码不存在 / 不是数字 / 第三方开关关着", async (t) => {
  const { mock, lxns } = await setup(t);
  mock.addPlayer({ friendCode: "102", name: "B", privacy: { scores: false } });
  await assert.rejects(lxns.dev.player("999"), (e) => e instanceof LxnsError && e.code === "player_not_found");
  await assert.rejects(lxns.dev.player("abc"), (e) => e.code === "invalid_friend_code");
  await assert.rejects(lxns.dev.bests("102"), (e) => e.code === "privacy_scores" && e.status === 403);
  await assert.rejects(lxns.dev.trend("102"), (e) => e.code === "privacy_history");
});

test("没玩过的谱面 best 返回 null，不是 404", async (t) => {
  const { mock, lxns } = await setup(t);
  mock.addPlayer({ friendCode: "103", name: "C" });
  assert.equal(await lxns.dev.best("103", 3, 0), null);
  assert.equal((await lxns.dev.best("103", 407, 3)).score, 1007725);
});

test("开发者接口的全部成绩没有分数，单曲成绩有", async (t) => {
  const { mock, lxns } = await setup(t);
  mock.addPlayer({ friendCode: "104", name: "D" });
  const simple = await lxns.dev.simpleScores("104");
  assert.equal(simple[0].score, undefined);
  const song = await lxns.dev.songBests("104", 407);
  assert.equal(song[0].score, 1007725);
});

test("5xx / 429 重试一次，401/404 不重试", async (t) => {
  const { mock, lxns } = await setup(t);
  mock.addPlayer({ friendCode: "105", name: "E" });
  mock.failNext(502);
  assert.equal((await lxns.dev.player("105")).name, "E");
  const before = mock.state.requests.length;
  await assert.rejects(lxns.dev.player("404404"), (e) => e.code === "player_not_found");
  assert.equal(mock.state.requests.length - before, 1);
  mock.failNext(429, undefined, 5);
  await assert.rejects(lxns.dev.player("105"), (e) => e.code === "rate_limited");
});

test("没配开发者密钥时开发者接口直接报 no_dev_token，不发请求", async (t) => {
  const { mock } = await setup(t);
  const lxns = createLxnsClient({ baseUrl: mock.apiBase, devToken: "" });
  const before = mock.state.requests.length;
  await assert.rejects(lxns.dev.player("101"), (e) => e.code === "no_dev_token");
  assert.equal(mock.state.requests.length, before);
});

test("连不上时报 network", async () => {
  const lxns = createLxnsClient({ baseUrl: "http://127.0.0.1:9/api/v0", devToken: "x", retries: 0 });
  await assert.rejects(lxns.songList(), (e) => e instanceof LxnsError && e.code === "network");
});
