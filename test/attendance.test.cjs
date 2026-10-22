"use strict";
// /出勤记录：Recent 50 怎么切场、同一张谱面怎么合成一行、新纪录怎么认、近一年日历怎么排（src/attendance.cjs），
// 指令自己的分支（src/features/attendance.cjs），以及 heatmap 这条路由和绑定（对假落雪）。数据都是编的。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { splitVisits, mergeCharts, buildCalendar, buildAttendanceView, levelOf, ROW_LIMIT } = require("../src/attendance.cjs");
const feature = require("../src/features/attendance.cjs");
const { V } = require("../src/voice.cjs");
const { createLxnsClient } = require("../src/lxns.cjs");
const { createOAuth } = require("../src/lxns-oauth.cjs");
const { openVault } = require("../src/vault.cjs");
const { createBindings } = require("../src/bindings.cjs");
const { createMockLxns } = require("./mock-lxns.cjs");

const catalog = {
  getSong: (id) => (Number(id) === 999 ? null : { id: Number(id), title: "测试曲 " + id,
    difficulties: [{ difficulty: 3, level: "14+", level_value: 14.5 }, { difficulty: 4, level: "15", level_value: 15 }] }),
  chart: (song, levelIndex) => song?.difficulties?.find((d) => d.difficulty === Number(levelIndex)) || null,
};
// 一次游玩（时间写 UTC；北京时间 = UTC + 8）
const play = (id, levelIndex, score, playTime, { clear = "hard", fc = null, chain = null, rank = "sss", upload = "2026-10-19T13:38:46Z", name } = {}) =>
  ({ id, song_name: name === undefined ? "曲" + id : name, level: "14+", level_index: levelIndex, score, rating: 16.5,
    clear, full_combo: fc, full_chain: chain, rank, play_time: playTime, upload_time: upload });
const minutesAfter = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString().replace(".000Z", "Z");

test("切场：相邻两次隔 2 小时以内算同一场（排卡也算），超过就是两场；没有游玩时间的不算，顺序乱的也排好", () => {
  const visits = splitVisits([
    play(4, 3, 1000000, "2026-10-19T14:00:00Z"),
    play(1, 3, 1000000, "2026-10-19T10:00:00Z"),
    play(3, 3, 1000000, "2026-10-19T11:50:00Z"),   // 隔 107 分钟：还是同一场
    play(2, 3, 1000000, "2026-10-19T10:03:00Z"),
    play(5, 3, 1000000, null),
  ]);
  assert.deepEqual(visits.map((visit) => visit.map((p) => p.id)), [[1, 2, 3], [4]]);   // 隔 130 分钟：新的一场
  assert.deepEqual(splitVisits(null), []);
});

test("同一张谱面合成一行：次数、强制结束几次、分数取最高（评级跟着它），通关标记取几次里最好的；按第一次打的先后排", () => {
  const rows = mergeCharts([
    play(1, 3, 1003000, "2026-10-19T11:19:00Z", { clear: "failed", rank: "s" }),
    play(2, 4, 1005500, "2026-10-19T11:22:00Z", { rank: "ssp" }),
    play(1, 3, 1007352, "2026-10-19T11:25:00Z", { rank: "sss" }),
    play(1, 3, 1006000, "2026-10-19T11:28:00Z", { fc: "fullcombo", chain: "fullchain", rank: "ssp" }),
    play(999, 3, 990000, "2026-10-19T11:31:00Z", { name: "曲库里还没有" }),
    play(998, 3, 990000, "2026-10-19T11:34:00Z", { clear: "brave" }),
  ].map((p) => ({ ...p, ms: Date.parse(p.play_time) })), { catalog });
  assert.deepEqual(rows.map((row) => row.key), ["1:3", "2:4", "999:3", "998:3"]);
  const first = rows[0];
  assert.equal(first.count, 3);
  assert.equal(first.failed, 1);
  assert.deepEqual(first.attempts, [null, 1007352, 1006000]);   // 按先后；被强制结束的那次是 null
  assert.equal(first.score, 1007352);
  assert.equal(first.rank, "SSS");
  assert.equal(first.clear, "hard");
  assert.equal(first.fc, "fullcombo");          // 分数最高那次没 FC，FC 是另一次打的
  assert.equal(first.chain, "fullchain");
  assert.equal(first.title, "测试曲 1");
  assert.equal(first.constant, 14.5);
  assert.equal(rows[1].constant, 15);
  assert.equal(rows[1].fc, null);
  assert.equal(rows[2].title, "曲库里还没有");    // 曲库里没有：用落雪给的曲名
  assert.equal(rows[2].constant, null);
  assert.equal(rows[3].clear, "brave");
});

test("新纪录：现在的最好成绩分数等于这场最高、而且是同一次同步传的；分数一样但早就打出来了、或者最好成绩更高，都不算", () => {
  const plays = [
    play(1, 3, 1007352, "2026-10-19T11:19:00Z", { upload: "2026-10-19T13:38:46Z" }),
    play(2, 3, 1007307, "2026-10-19T11:22:00Z", { upload: "2026-10-19T13:38:46Z" }),
    play(3, 3, 1005000, "2026-10-19T11:25:00Z", { upload: "2026-10-19T13:38:46Z" }),
    play(4, 3, 1008000, "2026-10-19T11:28:00Z", { upload: "2026-10-19T13:38:46Z" }),
  ].map((p) => ({ ...p, ms: Date.parse(p.play_time) }));
  const bests = [
    { id: 1, level_index: 3, score: 1007352, upload_time: "2026-10-19T13:38:47Z" },
    { id: 2, level_index: 3, score: 1007307, upload_time: "2026-09-16T14:09:00Z" },
    { id: 3, level_index: 3, score: 1007526, upload_time: "2026-09-16T14:09:00Z" },
  ];
  const rows = mergeCharts(plays, { catalog, bests });
  assert.deepEqual(rows.map((row) => [row.id, row.newRecord]), [[1, true], [2, false], [3, false], [4, false]]);
});

test("整张图的数据：取最近一场，时间按北京时间、时长多算最后一首，统计这场的次数 / 谱面 / 新纪录 / 强制结束", () => {
  const recents = [
    play(7, 3, 1000000, "2026-10-18T13:24:00Z", { upload: "2026-10-18T14:38:00Z" }),
    play(1, 3, 1007352, "2026-10-19T11:19:00Z"),
    play(1, 3, 1003000, "2026-10-19T11:30:00Z", { clear: "failed" }),
    play(2, 4, 1007000, "2026-10-19T12:10:00Z"),
  ];
  const bests = [{ id: 1, level_index: 3, score: 1007352, upload_time: "2026-10-19T13:38:46Z" }];
  const data = buildAttendanceView({ recents, heatmap: {}, bests, catalog, now: new Date("2026-10-22T07:15:00Z") });
  assert.equal(data.time, "10/22 15:15");
  assert.deepEqual(data.visit, { date: "10/19", weekday: "周一", start: "19:19", end: "20:10", minutes: 54,
    plays: 3, charts: 2, failed: 1, newRecords: 1, truncated: false });
  assert.deepEqual(data.rows.map((row) => row.key), ["1:3", "2:4"]);
  assert.equal(data.omitted, 0);
  assert.equal(data.calendar.weeks.length, 53);

  // 不是今年的出勤带年份；一首也没有就是 null（指令回一句话）
  const old = buildAttendanceView({ recents: [play(1, 3, 1000000, "2025-12-30T12:00:00Z")], catalog, now: new Date("2026-01-02T04:00:00Z") });
  assert.equal(old.visit.date, "2025/12/30");
  assert.equal(old.visit.weekday, "周二");
  assert.equal(old.visit.minutes, 3);
  assert.equal(buildAttendanceView({ recents: [], catalog }), null);
  assert.equal(buildAttendanceView({ recents: [play(1, 3, 1000000, null)], catalog }), null);
});

test("Recent 50 全是最近这一场：注明前面可能还有；谱面超过两栏能放的，只画最后那些", () => {
  const start = "2026-10-19T08:00:00Z";
  const full = Array.from({ length: 50 }, (_, i) => play(100 + (i % 30), 3, 1000000, minutesAfter(start, i * 2)));
  const data = buildAttendanceView({ recents: full, catalog, now: new Date("2026-10-19T14:00:00Z") });
  assert.equal(data.visit.truncated, true);
  assert.equal(data.visit.charts, 30);
  assert.equal(data.rows.length, ROW_LIMIT);
  assert.equal(data.omitted, 30 - ROW_LIMIT);
  assert.equal(data.rows[0].id, 100 + 30 - ROW_LIMIT);   // 前面几张没画
  // 49 条：没占满，最近这场就是完整的
  assert.equal(buildAttendanceView({ recents: full.slice(1), catalog, now: new Date("2026-10-19T14:00:00Z") }).visit.truncated, false);
  // 更早还有一场：最近这场肯定完整
  const twoVisits = [play(9, 3, 1000000, "2026-10-17T08:00:00Z"), ...full.slice(1)];
  assert.equal(buildAttendanceView({ recents: twoVisits, catalog, now: new Date("2026-10-19T14:00:00Z") }).visit.truncated, false);
});

test("近一年日历：53 周、周一在上，最后一列是这周、今天以后不画；颜色按条数分四档；月份标在 1 号那一周；日子按北京时间", () => {
  const heatmap = { "2026-10-13": 54, "2026-10-17": 20, "2026-10-18": 9, "2026-10-19": 18, "2025-10-19": 5, "2026-10-23": 3 };
  const cal = buildCalendar(heatmap, Date.parse("2026-10-22T07:00:00Z"));   // 北京时间周四
  assert.equal(cal.weeks.length, 53);
  assert.ok(cal.weeks.every((week) => week.length === 7));
  assert.equal(cal.from, "2025-10-20");                                    // 52 周前的周一
  assert.equal(cal.to, "2026-10-22");
  const last = cal.weeks.at(-1);
  assert.deepEqual(last.map((day) => day.key), ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.deepEqual(last.map((day) => Boolean(day.today)), [false, false, false, true, false, false, false]);
  assert.deepEqual(last.map((day) => day.future), [false, false, false, false, true, true, true]);
  const byKey = new Map(cal.weeks.flat().map((day) => [day.key, day]));
  assert.deepEqual(["2026-10-13", "2026-10-17", "2026-10-18", "2026-10-19"].map((key) => byKey.get(key).level), [4, 3, 1, 2]);
  assert.equal(byKey.get("2026-10-23").count, 0);                          // 今天以后的不算
  assert.equal(cal.activeDays, 4);                                         // 一年以前的 2025-10-19 也不算
  const weekOf = (key) => cal.weeks.findIndex((week) => week.some((day) => day.key === key));
  assert.ok(cal.months.some((m) => m.text === "11月" && m.week === weekOf("2025-11-01")));
  assert.ok(cal.months.some((m) => m.text === "10月" && m.week === weekOf("2026-10-01")));
  assert.equal(cal.months.filter((m) => m.text === "10月").length, 1);    // 2025 年 10 月 1 号不在这一年里

  // UTC 16:30 已经是北京时间第二天
  assert.equal(buildCalendar({}, Date.parse("2026-10-22T16:30:00Z")).to, "2026-10-23");
  assert.deepEqual([0, 1, 9, 10, 19, 20, 39, 40, 300].map(levelOf), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

// 指令层（commands.cjs）已经查过授权绑定；这里只测功能自己的分支
function stubCtx({ args = "", recents = [], heatmap = {}, bests = [] } = {}) {
  const replies = [];
  const images = [];
  const rendered = [];
  const calls = [];
  const ctx = {
    args, voice: V, now: () => new Date("2026-10-22T07:15:00Z"),
    reply: async (text) => { replies.push(text); },
    image: async (job) => { images.push(job); },
    services: {
      catalog,
      renderer: { render: async (theme, data, options) => { rendered.push({ theme, data, options }); return { buffer: Buffer.from("jpg") }; } },
    },
    player: {
      recents: async () => { calls.push("recents"); return recents; },
      heatmap: async () => { calls.push("heatmap"); return heatmap; },
      scores: async () => { calls.push("scores"); return bests; },
    },
  };
  return { ctx, replies, images, rendered, calls };
}

test("指令：后面写了东西回用法；落雪上没有游玩记录回一句话；有就出图（JPEG 76、1.5 倍）", async () => {
  const usage = stubCtx({ args: "本周" });
  await feature.run(usage.ctx);
  assert.deepEqual(usage.replies, [V.attendanceUsage]);
  assert.deepEqual(usage.calls, []);

  const empty = stubCtx();
  await feature.run(empty.ctx);
  assert.deepEqual(empty.replies, [V.attendanceNoPlays]);
  assert.equal(empty.images.length, 0);

  const full = stubCtx({ recents: [play(1, 3, 1007352, "2026-10-19T11:19:00Z")], heatmap: { "2026-10-19": 1 } });
  await feature.run(full.ctx);
  assert.deepEqual(full.calls.sort(), ["heatmap", "recents", "scores"]);
  assert.deepEqual(full.replies, []);
  assert.equal(full.images[0].kind, "attendance");
  const out = await full.images[0].render();
  assert.ok(Buffer.isBuffer(out.buffer));
  assert.equal(full.rendered[0].theme, "attendance");
  assert.deepEqual(full.rendered[0].options, { format: "jpeg", quality: 76, scale: 1.5 });
  assert.equal(full.rendered[0].data.calendar.activeDays, 1);
});

test("落雪接口和绑定：授权的人走玩家接口读 heatmap、Recent 50 走开发者接口；好友码绑定的人读 heatmap 要先授权", async (t) => {
  const mock = createMockLxns();
  await mock.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-attendance-"));
  t.after(async () => { await mock.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const recents = [play(407, 3, 1007725, "2026-10-19T11:19:00Z")];
  mock.addPlayer({ friendCode: "123456789012345", name: "测试玩家", recents, heatmap: { "2026-10-19": 1 } });
  mock.addPlayer({ friendCode: "223456789012345", name: "测试玩家二" });
  const vault = await openVault({ file: path.join(dir, "bindings.enc"), key: crypto.randomBytes(32) });
  const lxns = createLxnsClient({ baseUrl: mock.apiBase, devToken: mock.devToken, retryDelayMs: 10 });
  const oauth = createOAuth({ clientId: mock.clientId, clientSecret: mock.clientSecret, siteUrl: mock.site });
  const bindings = createBindings({ vault, lxns, oauth, log: () => {} });
  const { url } = bindings.startOAuth("U1");
  await bindings.finishOAuth("U1", mock.approve("123456789012345", new URL(url).searchParams.get("code_challenge")));
  await bindings.bindFriendCode("U2", "223456789012345");

  const api = bindings.player("U1");
  assert.deepEqual(await api.heatmap(), { "2026-10-19": 1 });
  assert.equal(mock.state.requests.at(-1).path, "/api/v0/user/chunithm/player/heatmap");
  assert.equal(mock.state.requests.at(-1).auth, "bearer");
  assert.deepEqual((await api.recents()).map((p) => p.play_time), ["2026-10-19T11:19:00Z"]);
  assert.equal(mock.state.requests.at(-1).auth, "dev");

  await assert.rejects(bindings.player("U2").heatmap(), { code: "need_oauth" });
});
