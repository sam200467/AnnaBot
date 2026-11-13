"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildData } = require("../src/features/recent.cjs");

const catalog = {
  getSong: (id) => id === 999 ? null : { id, title: "测试曲", disabled: true },
  chart: () => ({ level: "14+", level_value: 14.5 }),
  jacketId: (song) => song.id,
};
const play = (n, extra = {}) => ({ id: 1, level_index: 3, score: 1000000 + n,
  rating: 16.5, play_time: new Date(Date.UTC(2026, 10, 13, 4, n)).toISOString(), ...extra });
const build = (recents) => buildData({ recents, catalog, player: { name: "测试玩家" }, now: new Date("2026-11-13T06:00:00Z") });

test("R30 按游玩时间倒序截取 30 次：同谱、低分、失败和已下架曲目都保留，输入不变", () => {
  const input = Array.from({ length: 50 }, (_, i) => play(i, { upload_time: new Date(Date.UTC(2026, 10, 13, 6, 50 - i)).toISOString() }));
  input[49] = play(49, { score: 12345, clear: "failed", full_combo: null });
  const original = structuredClone(input);
  const data = build(input);
  const rows = data.chapters[0].scores;
  assert.equal(rows.length, 30);
  assert.equal(rows[0].score, 12345);
  assert.equal(rows[0].clear, "failed");
  assert.equal(rows[0].fullCombo, null);
  assert.equal(rows.at(-1).playTime, play(20).play_time);
  assert.deepEqual(rows.map((row) => row.index), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.equal(data.uniqueCharts, 1);
  assert.deepEqual(input, original);
});

test("同一分钟保留接口原顺序；不同难度、WE、未知曲目不丢失，当次标记不合并", () => {
  const data = build([play(1, { full_combo: "alljustice" }), play(1, { level_index: 4, full_combo: "fullcombo" }),
    play(1, { id: 8001, level_index: 5 }), play(1, { id: 999, song_name: "新曲" })]);
  const rows = data.chapters[0].scores;
  assert.deepEqual(rows.map((row) => [row.id, row.levelIndex]), [[1, 3], [1, 4], [8001, 5], [999, 3]]);
  assert.deepEqual(rows.map((row) => row.fullCombo), ["alljustice", "fullcombo", null, null]);
  assert.equal(rows.at(-1).title, "新曲");
  assert.equal(rows.at(-1).jacketId, 999);
  assert.equal(rows.at(-1).constant, null);
  assert.equal(data.uniqueCharts, 4);
});

test("缺少有效游玩时间不拿上传时间顶替；不足 30 条如实显示；北京时间可跨日", () => {
  const data = build([null, play(0, { play_time: null }), play(0, { play_time: "invalid" }),
    play(0, { play_time: "2026-11-12T17:02:00Z" })]);
  assert.equal(data.chapters[0].scores.length, 1);
  assert.equal(data.chapters[0].scores[0].playTimeText, "2026-11-13 01:02");
  assert.match(data.note, /最近 1 次/);
  assert.match(data.note, /3 条缺少有效游玩时间/);
  assert.deepEqual(build(null).chapters[0].scores, []);
  assert.deepEqual(build([]).chapters[0].scores, []);
});
