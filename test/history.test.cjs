"use strict";
// /推分记录：窗口边界、按 upload_time 分批、补历史、重放 B50、进榜/移出、存储，
// 再走一遍端到端（假 QQ + 假落雪，文字回复）。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMockOfficial } = require("./mock-official.cjs");
const { createMockLxns, PNG } = require("./mock-lxns.cjs");
const { createLxnsClient } = require("../src/lxns.cjs");
const { createOAuth } = require("../src/lxns-oauth.cjs");
const { openVault } = require("../src/vault.cjs");
const { createBindings } = require("../src/bindings.cjs");
const { createCatalog } = require("../src/catalog.cjs");
const { createAssets } = require("../src/assets.cjs");
const { createAnnaBot } = require("../src/bot.cjs");
const { V } = require("../src/voice.cjs");
const {
  parseWindow, latestFrom, buildFrom, collect, buildReport, toEvents, createHistoryStore, hashOpenid,
} = require("../src/history.cjs");

const FC1 = "123456789012345";
const FC2 = "102000000000002";
const FC3 = "103000000000003";
const FIXED = new Date("2026-10-19T12:00:00+08:00");
const at = (text) => new Date(text).toISOString();

function makeCatalog(songs) {
  return {
    getSong: (id) => songs.find((song) => song.id === Number(id)) || null,
    chart: (song, levelIndex) => song.difficulties.find((chart) => chart.difficulty === Number(levelIndex)) || null,
    currentVersion: () => ({ version: 24000 }),
  };
}

const SONGS = [
  { id: 1, title: "A", version: 23000, difficulties: [{ difficulty: 3, level: "14", level_value: 15.0 }] },
  { id: 2, title: "B", version: 24000, difficulties: [{ difficulty: 3, level: "14+", level_value: 15.2 }] },
];

function score(id, levelIndex, value, time, extra = {}) {
  return {
    id, song_name: "曲" + id, level: "14", level_index: levelIndex, score: value, rating: 0,
    clear: "clear", full_combo: null, full_chain: null, over_power: 80,
    upload_time: time, play_time: time, ...extra,
  };
}

test("窗口：最新 / 今天 / 7天 / 15天 / 本月，别的天数不认；日期按北京时间 0 点", () => {
  const now = new Date("2026-10-19T12:00:00+08:00");
  assert.deepEqual(parseWindow("", { now }), { kind: "latest", label: "最近一次", from: null });
  assert.deepEqual(parseWindow("最新", { now }), { kind: "latest", label: "最近一次", from: null });
  assert.equal(parseWindow("今天", { now }).from.toISOString(), "2026-10-18T16:00:00.000Z");
  assert.equal(parseWindow("7天", { now }).from.toISOString(), "2026-10-12T16:00:00.000Z");
  assert.equal(parseWindow(" 7 天 ", { now }).from.toISOString(), "2026-10-12T16:00:00.000Z");
  assert.equal(parseWindow("七天", { now }).from.toISOString(), "2026-10-12T16:00:00.000Z");
  assert.equal(parseWindow("15天", { now }).from.toISOString(), "2026-10-04T16:00:00.000Z");
  assert.equal(parseWindow("本月", { now }).from.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(parseWindow("14天", { now }), null);
  assert.equal(parseWindow("8天", { now }), null);
  assert.equal(parseWindow("上周", { now }), null);
});

test("最近一批：upload_time 相差 ≤15 秒算同一批", () => {
  const scores = [
    score(1, 3, 1000000, at("2026-10-19T10:00:00+08:00")),
    score(1, 3, 1000000, at("2026-10-19T10:00:10+08:00")),
    score(2, 3, 1000000, at("2026-10-19T10:00:13+08:00")),
    score(2, 3, 1000000, at("2026-10-19T11:00:00+08:00")),
  ];
  assert.equal(latestFrom(scores).toISOString(), "2026-10-19T03:00:00.000Z");
  const worldsEnd = score(8001, 5, 1000000, at("2026-10-19T12:00:00+08:00"));
  assert.equal(latestFrom([...scores, worldsEnd]).toISOString(), "2026-10-19T03:00:00.000Z", "WE 不进 B50，不看它的上传时间");
  assert.equal(latestFrom([]), null);
});

test("toEvents：同一批取最高分；没涨不记；同分 FC 变好记一条", () => {
  const time = at("2026-10-19T10:00:00+08:00");
  const failed = score(1, 3, 300000, time);
  const good = score(1, 3, 1005000, at("2026-10-19T10:00:03+08:00"));
  const sameBatch = toEvents([failed, good], null);
  assert.equal(sameBatch.length, 1);
  assert.equal(sameBatch[0].score, 1005000);
  assert.equal(sameBatch[0].prev, null);

  const before = score(1, 3, 1000000, at("2026-10-19T09:00:00+08:00"));
  const up = toEvents([good], before);
  assert.deepEqual([up[0].score, up[0].prev, up[0].prevFc], [1005000, 1000000, null]);

  assert.deepEqual(toEvents([score(1, 3, 999000, time)], before), [], "分数掉了不算推分");
  const fc = toEvents([score(1, 3, 1000000, time, { full_combo: "fullcombo" })], before);
  assert.deepEqual([fc.length, fc[0].score, fc[0].prev, fc[0].fc], [1, 1000000, 1000000, "fullcombo"]);
});

test("buildFrom + buildReport：基线是这一批之前，影响按前后 B50 总和 ÷50", async () => {
  const catalog = makeCatalog(SONGS);
  const history = [
    score(1, 3, 1000000, at("2026-10-18T21:00:00+08:00")),
    score(1, 3, 1005000, at("2026-10-18T22:37:00+08:00")),
  ];
  const scores = [score(1, 3, 1005000, at("2026-10-18T22:37:00+08:00"))];
  const from = latestFrom(scores);
  const state = await buildFrom({ from, scores, fetchHistory: async () => history, friendCode: "1" });
  assert.deepEqual(state.baseline["1:3"], { score: 1000000, fc: null, op: 80 });
  assert.equal(state.events.length, 1);

  const report = buildReport({ state, window: { kind: "latest", label: "最近一次", from }, to: new Date("2026-10-18T23:00:00+08:00"), catalog, floor: 24000 });
  assert.equal(report.batches.length, 1);
  assert.equal(report.latest.events[0].action, "up");
  assert.ok(Math.abs(report.latest.before - 16 / 50) < 1e-9);
  assert.ok(Math.abs(report.latest.after - 16.5 / 50) < 1e-9);
  assert.ok(Math.abs(report.latest.impact - 0.01) < 1e-9);
  assert.ok(Math.abs(report.rating.gain - 0.01) < 1e-9);
});

test("collect：新上传补一次，重复跑不会记两遍", async () => {
  const catalog = makeCatalog(SONGS);
  const history = [
    score(1, 3, 1000000, at("2026-10-18T21:00:00+08:00")),
    score(1, 3, 1005000, at("2026-10-18T22:37:00+08:00")),
    score(1, 3, 1009000, at("2026-10-18T23:30:00+08:00")),
  ];
  const scores = [score(1, 3, 1005000, at("2026-10-18T22:37:00+08:00"))];
  const state = await buildFrom({ from: latestFrom(scores), scores, fetchHistory: async () => history, friendCode: "1" });
  const next = [score(1, 3, 1009000, at("2026-10-18T23:30:00+08:00"))];
  await collect({ state, scores: next, fetchHistory: async () => history });
  await collect({ state, scores: next, fetchHistory: async () => history });
  assert.equal(state.events.length, 2);
  const report = buildReport({ state, window: { kind: "latest", label: "最近一次", from: latestFrom(next) }, to: new Date("2026-10-18T23:45:00+08:00"), catalog, floor: 24000 });
  assert.equal(report.latest.events[0].action, "up");
  assert.equal(report.latest.events[0].prevScore, 1005000);
});

test("进榜/移出：一首挤进前 50，把第 50 名挤出去，影响是两者之差 ÷50", async () => {
  const songs = [];
  for (let i = 0; i < 30; i++) {
    songs.push({ id: 1000 + i, title: "旧" + i, version: 23000, difficulties: [{ difficulty: 3, level: "14", level_value: 15.0 }] });
  }
  for (let i = 0; i < 20; i++) {
    songs.push({ id: 2000 + i, title: "新" + i, version: 24000, difficulties: [{ difficulty: 3, level: "14", level_value: 15.0 }] });
  }
  songs.push({ id: 3000, title: "挤进来", version: 23000, difficulties: [{ difficulty: 3, level: "14", level_value: 15.0 }] });
  const catalog = makeCatalog(songs);
  const beforeTime = at("2026-10-18T21:00:00+08:00");
  const afterTime = at("2026-10-18T22:37:00+08:00");
  const scores = [
    ...songs.filter((song) => song.id !== 3000).map((song) => score(song.id, 3, 1007500, beforeTime)),
    score(3000, 3, 1007000, beforeTime),
  ];
  scores.find((entry) => entry.id === 3000).upload_time = afterTime;
  scores.find((entry) => entry.id === 3000).score = 1009000;
  const state = await buildFrom({
    from: new Date(afterTime), scores,
    fetchHistory: async () => [score(3000, 3, 1007000, beforeTime), score(3000, 3, 1009000, afterTime)],
    friendCode: "1",
  });
  const report = buildReport({ state, window: { kind: "latest", label: "最近一次", from: new Date(afterTime) }, to: new Date("2026-10-18T23:00:00+08:00"), catalog, floor: 24000 });
  assert.equal(report.latest.entered.length, 1);
  assert.equal(report.latest.entered[0].key, "3000:3");
  assert.equal(report.latest.left.length, 1);
  assert.ok(Math.abs(report.latest.impact - 0.003) < 1e-9);
  assert.equal(report.counts.entered, 1);
  assert.equal(report.counts.left, 1);
});

test("存储：每人一个文件、读得回来；坏了按没有处理；同一个人的读改写排队", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-history-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createHistoryStore({ dir });
  const state = { v: 1, friendCode: "1", at: FIXED.toISOString(), baseline: {}, cursor: {}, events: [] };
  await store.write("openid-1", state);
  assert.deepEqual(store.read("openid-1"), state);
  assert.equal(fs.existsSync(path.join(dir, hashOpenid("openid-1") + ".json")), true);
  fs.writeFileSync(path.join(dir, hashOpenid("openid-1") + ".json"), "{");
  assert.equal(store.read("openid-1"), null);

  const order = [];
  await Promise.all([
    store.withLock("openid-2", async () => { order.push(1); await new Promise((resolve) => setTimeout(resolve, 20)); order.push(2); }),
    store.withLock("openid-2", async () => { order.push(3); }),
  ]);
  assert.deepEqual(order, [1, 2, 3]);
});

// ── 端到端 ──
async function setup(t) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns();
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-history-bot-"));
  const lxns = createLxnsClient({ baseUrl: lx.apiBase, devToken: lx.devToken, retries: 0 });
  const oauth = createOAuth({ clientId: lx.clientId, clientSecret: lx.clientSecret, siteUrl: lx.site, apiBase: lx.apiBase });
  const vault = await openVault({ file: path.join(dir, "bindings.enc"), key: crypto.randomBytes(32) });
  const bindings = createBindings({ vault, lxns, oauth });
  const catalog = createCatalog({ lxns, cacheDir: path.join(dir, "cache") });
  await catalog.ready();
  const assets = createAssets({ cacheDir: path.join(dir, "assets"), baseUrl: lx.assetsBase });
  const historyStore = createHistoryStore({ dir: path.join(dir, "history") });
  const bot = createAnnaBot({
    allowedGroupIds: ["G1"], allowPrivateChat: true, admins: [], receiptDelayMs: 5000, generateCooldownMs: 0,
    qq: { appId: "1", clientSecret: "x", tokenUrl: qq.tokenUrl, apiBase: qq.apiBase, sandboxApiBase: qq.apiBase, sandbox: false,
      minSendIntervalMs: 0, jitterMs: 0, perTargetIntervalMs: 0, perTargetPerHour: 1000 },
  }, { lxns, oauth, bindings, catalog, assets, historyStore, log: () => {}, now: () => FIXED.getTime() });
  t.after(async () => {
    bot.stop();
    await qq.stop();
    await lx.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let seq = 0;
  const group = (content, { user = "U1" } = {}) => bot.handleEvent("GROUP_AT_MESSAGE_CREATE", {
    id: "m" + (++seq), group_openid: "G1", author: { member_openid: user }, content: " " + content,
  });
  const last = () => qq.state.sent.at(-1).body;
  async function authorize(user, friendCode) {
    await group("/授权", { user });
    const url = last().content.match(/https?:\/\/\S+/)[0];
    const code = lx.approve(friendCode, new URL(url).searchParams.get("code_challenge"));
    await group("/授权 " + code, { user });
  }
  return { lx, group, last, authorize };
}

function todayAt(hour) {
  const start = new Date("2026-10-19T00:00:00+08:00");
  return new Date(start.getTime() + hour * 3600 * 1000).toISOString();
}

test("/推分记录 端到端：没绑定、好友码请去授权、参数不认、最新/今天各出对应的文字", async (t) => {
  const s = await setup(t);
  const songs = s.lx.state.songList.songs;
  const current = [
    { ...score(3, 3, 1009000, todayAt(10)), rating: 14.65 },
    { ...score(407, 3, 1009000, todayAt(11)), rating: 17.65 },
  ];
  const history = [
    { ...score(407, 3, 1007725, todayAt(10)), rating: 17.5225 },
    { ...score(407, 3, 1009000, todayAt(11)), rating: 17.65 },
    { ...score(3, 3, 1009000, todayAt(10)), rating: 14.65 },
  ];
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", scores: current });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", scores: current, history });

  await s.group("/推分记录");
  assert.equal(s.last().content, V.needBinding);

  await s.group("/绑定 " + FC1);
  await s.group("/推分记录");
  assert.equal(s.last().content, V.needOAuth("推分记录"), "好友码没有具体分数，不读历史");

  await s.authorize("U2", FC2);
  const opts = { user: "U2" };
  await s.group("/推分记录", opts);
  let text = s.last().content;
  assert.match(text, /^最近一次推分 · 10\/19 11:00/m);
  assert.match(text, /账号 Rating 0\.643 → 0\.646（\+0\.003）/);
  assert.match(text, /提升：混沌を越えし我らが神聖なる調律主を讃えよ 17\.5225 → 17\.6500（\+0\.1275）/);

  await s.group("/推分记录 14天", opts);
  assert.equal(s.last().content, V.historyUsage);
  assert.equal(s.lx.state.requests.filter((request) => request.path.includes("/score/history")).length, 1,
    "参数不认时不读历史");

  await s.group("/推分记录 今天", opts);
  text = s.last().content;
  assert.match(text, /^今天 · 2 批 · 账号 Rating 0\.000 → 0\.646（\+0\.646）/);
  assert.match(text, /进榜 2 首/);

  // 今天没有推分：说最近一次是什么时候
  s.lx.addPlayer({ friendCode: FC3, name: "昨天玩家", scores: [score(3, 3, 1009000, at("2026-10-18T22:00:00+08:00"))],
    history: [score(3, 3, 1009000, at("2026-10-18T22:00:00+08:00"))] });
  await s.authorize("U3", FC3);
  await s.group("/推分记录 今天", { user: "U3" });
  text = s.last().content;
  assert.match(text, /^今天还没有推分记录。最近一次是 10\/18 22:00/);
  assert.match(text, /\/推分记录 最新/);
});
