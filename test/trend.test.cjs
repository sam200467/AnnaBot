"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWindow, buildTrendData } = require("../src/trend.cjs");
const { buildFrom } = require("../src/history.cjs");
const feature = require("../src/features/trend.cjs");
const { V } = require("../src/voice.cjs");

const catalog = {
  getSong: (id) => ({ id, title: "测试曲 " + id, version: id >= 100 ? 24000 : 23000 }),
  chart: () => ({ level_value: 15, level: "15" }),
};
const score = (id, value, t) => ({ id, level_index: 3, score: value, upload_time: t });
const stateAt = (at, events = []) => ({
  v: 1, at, baseline: { "1:3": { score: 1000000 }, "100:3": { score: 1000000 } },
  cursor: {}, events,
});
const event = (id, score, t) => ({ id, lv: 3, score, t, ms: Date.parse(t), prev: 1000000 });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " ≠ " + b);

test("只接受本周、本月；北京时间周一/月初边界、跨年和闰年", () => {
  for (const arg of ["", "7天", "本日", "本周 2", "本月 第2页", "最新", "上周", "本周本月"]) {
    assert.equal(parseWindow(arg), null);
  }
  assert.equal(parseWindow("本周", new Date("2026-10-18T15:59:59Z")).from.toISOString(), "2026-10-11T16:00:00.000Z");
  assert.equal(parseWindow("本周", new Date("2026-10-18T16:00:00Z")).from.toISOString(), "2026-10-18T16:00:00.000Z");
  assert.equal(parseWindow("本月", new Date("2026-09-30T16:00:00Z")).from.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(parseWindow("本周", new Date("2027-01-01T12:00:00+08:00")).from.toISOString(), "2026-12-27T16:00:00.000Z");
  assert.equal(parseWindow("本月", new Date("2028-02-29T12:00:00+08:00")).from.toISOString(), "2028-01-31T16:00:00.000Z");
});

test("三条曲线各用固定分母；包含零点更新，排除区间外事件，B50 = B30×0.6 + N20×0.4", () => {
  const to = new Date("2026-10-20T12:00:00+08:00"), window = parseWindow("本周", to);
  const state = stateAt("2026-10-01T00:00:00+08:00", [
    event(1, 1001000, "2026-10-18T12:00:00+08:00"),
    event(1, 1005000, "2026-10-19T00:00:00+08:00"),
    event(100, 1009000, "2026-10-20T10:00:00+08:00"),
    event(1, 1009000, "2026-10-21T10:00:00+08:00"),
  ]);
  const data = buildTrendData({ state, window, to, catalog, floor: 24000 });
  assert.equal(data.batches, 2);
  const [b50, b30, n20] = data.series;
  close(b30.start, 16.1 / 30);
  close(b30.end, 16.5 / 30);
  close(n20.start, 16 / 20);
  close(n20.end, 17.15 / 20);
  for (let i = 0; i < b50.points.length; i++) close(b50.points[i].value, b30.points[i].value * .6 + n20.points[i].value * .4);
  assert.equal(b50.points[0].ms, window.from.getTime());
  assert.equal(b50.points.at(-1).ms, to.getTime());
  assert.ok(data.ticks.length <= 5);
  assert.equal(new Set(data.ticks.map(tick => tick.label)).size, data.ticks.length, "周初不重复显示同一日期");
});

test("月底长区间不截掉上传；无更新和零点查询均能生成持平数据", () => {
  const to = new Date("2026-10-31T20:00:00+08:00"), window = parseWindow("本月", to);
  const events = Array.from({ length: 400 }, (_, i) => event(1, 1000000 + i, new Date(window.from.getTime() + i * 60000).toISOString()));
  const data = buildTrendData({ state: stateAt(window.from.toISOString(), events), window, to, catalog, floor: 24000 });
  assert.equal(data.batches, 400);
  assert.equal(data.updatedCharts, 1, "同一谱面多次更新只计一次");
  assert.equal(data.series[0].points.length, 402);
  for (const end of [to, window.from]) {
    const flat = buildTrendData({ state: stateAt(window.from.toISOString()), window, to: end, catalog, floor: 24000 });
    assert.equal(flat.batches, 0);
    assert.equal(flat.updatedCharts, 0);
    for (const series of flat.series) assert.equal(series.gain, 0);
    assert.ok(flat.ticks.length >= 1);
  }
});

test("榜单席位更换按旧曲前30/新曲前20计算，不把榜外分数算入涨幅", async () => {
  const from = new Date("2026-10-19T00:00:00+08:00");
  const before = "2026-10-18T10:00:00+08:00", after = "2026-10-19T10:00:00+08:00";
  const scores = [
    ...Array.from({ length: 30 }, (_, i) => score(i + 1, 1007500, before)),
    ...Array.from({ length: 20 }, (_, i) => score(i + 100, 1007500, before)),
    score(31, 1009000, after), score(32, 1000000, after),
  ];
  const state = await buildFrom({ from, scores, fetchHistory: async (id) => [
    score(id, 990000, before), scores.find((row) => row.id === id),
  ] });
  const data = buildTrendData({ state, window: { from, label: "本周" }, to: new Date(after), catalog, floor: 24000 });
  close(data.series[0].gain, .15 / 50);
  close(data.series[1].gain, .15 / 30);
  close(data.series[2].gain, 0);
  assert.equal(data.updatedCharts, 1, "新进替换只计新进谱面，不计移出及榜外更新");
});

test("更新数按区间首尾 B50 谱面去重，含原席位更新与新进，不含区间外和榜外", () => {
  const from = new Date("2026-10-19T00:00:00+08:00"), to = new Date("2026-10-20T12:00:00+08:00");
  const state = stateAt("2026-10-01T00:00:00+08:00");
  state.baseline = Object.fromEntries([
    ...Array.from({ length:30 }, (_, i) => [i + 1 + ":3", { score:1007500 }]),
    ...Array.from({ length:20 }, (_, i) => [i + 100 + ":3", { score:1007500 }]),
    ["31:3", { score:990000 }], ["32:3", { score:990000 }],
  ]);
  state.events = [
    event(2, 1009000, "2026-10-18T12:00:00+08:00"),
    event(1, 1008000, "2026-10-19T10:00:00+08:00"),
    event(1, 1009000, "2026-10-19T12:00:00+08:00"),
    event(31, 1009500, "2026-10-19T12:00:00+08:00"),
    event(32, 1000000, "2026-10-19T12:00:00+08:00"),
    { ...event(100, 1007500, "2026-10-19T12:00:00+08:00"), prev:1007500, fc:"alljustice" },
    event(3, 1009000, "2026-10-21T12:00:00+08:00"),
  ];
  const data = buildTrendData({ state, window:{ from, label:"本周" }, to, catalog, floor:24000 });
  assert.equal(data.updatedCharts, 3, "旧谱1、新进31、连段更新100各计1，其他不计");
});

test("功能入口拒绝所有其他参数，拒绝时不请求玩家数据", async () => {
  for (const args of ["", "7天", "本周 2", "本月 本周", "本月 第2页"]) {
    let reply;
    await feature.run({ args, voice: V, reply: (value) => { reply = value; } });
    assert.equal(reply, V.trendUsage);
  }
});

test("功能入口与推分记录共用基线，月查询扩展历史，重复查询增量复用，无更新仍出图", async () => {
  const now = new Date("2026-10-20T12:00:00+08:00");
  let saved = null, calls = 0;
  const rendered = [], histories = [
    score(1, 1000000, "2026-09-28T10:00:00+08:00"),
    score(1, 1005000, "2026-10-10T10:00:00+08:00"),
  ];
  const ctx = {
    args: "本周", now: () => now, userId: "test", voice: V, log() {},
    player: { player: async () => ({ friend_code: "1" }), scores: async () => [histories.at(-1)], bests: async () => ({}),
      scoreHistory: async () => { calls++; return histories; } },
    services: { catalog: { ...catalog, currentVersion: () => ({ version: 24000 }) },
      historyStore: { withLock: async (_, fn) => fn(), read: () => saved, write: async (_, value) => { saved = value; } },
      renderer: { render: async (theme, data) => { rendered.push({ theme, data }); return { buffer: Buffer.from("image") }; } },
    },
    image: async ({ render }) => render(),
  };
  await feature.run(ctx);
  assert.equal(rendered.at(-1).data.batches, 0);
  assert.equal(calls, 0);
  ctx.args = "本月";
  await feature.run(ctx);
  assert.equal(rendered.at(-1).theme, "trend");
  assert.equal(rendered.at(-1).data.batches, 1);
  assert.equal(calls, 1);
  await feature.run(ctx);
  assert.equal(calls, 1);
  saved.friendCode = "another-account";
  await feature.run(ctx);
  assert.equal(calls, 2, "重新绑定不能复用另一账号的历史");
});
