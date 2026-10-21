"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { plain, parseSource, buildGroups } = require("../tools/build-chart-designers.cjs");

test("wiki 署名去掉注音、颜色、脚注，保留本名、符号和 HTML 实体中的字", () => {
  assert.equal(plain("&ruby(メティアン){Meteian}; [#meteian]"), "Meteian");
  assert.equal(plain('&color(red){&#233;cologie};((说明((嵌套脚注))))'), "écologie");
  assert.equal(plain("BGCOLOR(#ddddff):[[CatastroPhe>譜面制作者一覧2#cat]]"), "CatastroPhe");
});

test("wiki 表格处理紫黑谱、继承署名、合作栏和明确的别名跳转，不从推测段落认身份", () => {
  const parsed = parseSource([
    "*本名 [#main]", "别名可能是某人，但没有证实。",
    "-別名義：正式别名((官方声明))", "|~曲名|>|~難|>|~ノーツデザイナー名|h",
    "|[[曲A]]|>|M|换名|>|", "|~|BGCOLOR(red):~U|>|~|",
    "|[[曲B]]|>|M|>|本名 vs 另一人|", "|[[曲C]]|>|M|BGCOLOR(#ddddff):合作名|",
    "*正式别名 [#alias]", "→[[本名>譜面制作者一覧1#main]]",
  ].join("\n"), 1);
  assert.deepEqual(parsed.records.map((r) => [r.credit, r.difficulty, r.joint]),
    [["换名", 3, false], ["换名", 4, false], ["本名 vs 另一人", 3, true], ["合作名", 3, true]]);
  assert.deepEqual(parsed.redirects.map((r) => [r.from, r.to]), [["正式别名", "本名"]]);
  assert.equal(parsed.aliases[0].name, "正式别名");
});

test("跨页归并只接受唯一的单人归属；任一页标合作或未确认的署名都排除", () => {
  const songs = ["本名", "换名", "正式别名", "共同名", "冲突名", "未知名"].map((note_designer, id) =>
    ({ id, difficulties: [{ difficulty: 3, note_designer }] }));
  const result = buildGroups(songs, [
    { page: 1, text: "*本名 [#main]\n-別名義：正式别名\n|[[曲A]]|>|M|换名|\n|[[曲B]]|>|M|共同名|\n|[[曲C]]|>|M|冲突名|\n|[[曲D]]|>|M|未知名|" },
    { page: 2, text: "*另一人 [#other]\n|[[曲B]]|>|M|BGCOLOR(#ddddff):共同名|\n|[[曲C]]|>|M|冲突名|" },
    { page: 5, text: "*譜面製作者不明 [#unknown]\n|[[曲D]]|>|M|未知名|" },
  ]);
  assert.deepEqual(new Set(result.groups["本名"].credits), new Set(["本名", "换名", "正式别名"]));
  assert.deepEqual(result.conflicts, [{ credit: "冲突名", owners: ["本名", "另一人"] }]);
  assert.deepEqual(result.excludedCredits.sort(), ["共同名", "未知名"]);
  assert.equal(result.groups["本名"].evidenceByCredit["换名"].song, "曲A");
});
