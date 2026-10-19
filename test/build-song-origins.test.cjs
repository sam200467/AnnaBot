"use strict";
// tools/build-song-origins.cjs：音击舞萌拆来源的匹配规则（不联网）
const test = require("node:test");
const assert = require("node:assert/strict");
const { classify, baseTitle } = require("../tools/build-song-origins.cjs");

const songs = [
  { id: 1, title: "音击原曲", genre: "音击舞萌" },
  { id: 2, title: "舞萌原曲", genre: "音击舞萌" },
  { id: 3, title: "D✪N’T ST✪P R✪CKIN’ ～[✪_✪] MIX～", genre: "音击舞萌" },
  { id: 4, title: "两边都有", genre: "音击舞萌" },
  { id: 5, title: "没对上", genre: "音击舞萌" },
  { id: 6, title: "不是音击舞萌", genre: "原创" },
  { id: 8001, title: "WE 版", genre: "音击舞萌" },
];
const ongeki = [
  { title: "音击原曲", category: "オンゲキ" },
  { title: "两边都有", category: "オンゲキ" },
  { title: "从舞萌移植", category: "チュウマイ" },   // 从中二 / 舞萌移植到音击的，不算音击来源
  { title: "没对上", category: "VARIETY" },
];
const maimai = [
  { title: "舞萌原曲", catcode: "maimai" },
  { title: "D✪N’T  ST✪P  R✪CKIN’", catcode: "maimai" },   // 中二版带 remix 后缀，去掉后再比
  { title: "两边都有", catcode: "maimai" },
  { title: "从中二移植", catcode: "オンゲキ＆CHUNITHM" },   // 从音击 / 中二移植到舞萌的，不算舞萌来源
];

test("去掉 [..] 和 ～..～ 的后缀再比一次", () => {
  assert.equal(baseTitle("D✪N’T ST✪P R✪CKIN’ ～[✪_✪] MIX～"), "d✪ntst✪pr✪ckin");
  assert.equal(baseTitle("普通曲名"), "普通曲名");
});

test("拆来源：音击 / 舞萌 / 両方；移植过去的分类不算；不是音击舞萌和 WE 不看", () => {
  const { origins, unmatched } = classify({ songs, ongeki, maimai });
  assert.deepEqual(Object.fromEntries(origins), {
    1: "音击",
    2: "舞萌",
    3: "舞萌",
    4: "両方",
  });
  assert.deepEqual(unmatched.map((song) => song.id), [5]);
});

test("同一首歌的通常版和 LUNATIC 版在 OTOGE DB 里是两行，算同一首", () => {
  const { origins, unmatched } = classify({
    songs: [{ id: 1, title: "撞名", genre: "音击舞萌" }],
    ongeki: [{ title: "撞名", category: "オンゲキ", lunatic: "" }, { title: "撞名", category: "オンゲキ", lunatic: "1" }],
    maimai: [],
  });
  assert.equal(origins.get(1), "音击");
  assert.deepEqual(unmatched, []);
});
