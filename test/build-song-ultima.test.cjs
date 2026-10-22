"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { VERSIONS, ultimaSongs, assignUltimaVersions } = require("../tools/build-song-ultima.cjs");
const { loadSongExtras } = require("../src/song-extras.cjs");

test("ULTIMA 清单：wiki 源代码的合并行、链接别名、实体和注释；LEVEL 只在专属红色格里修正", () => {
  const source = `L1: //|~|[[不能算的注释]]|作者|ULTIMA|14|
L2: |ジャンル|タイトル|アーティスト|レベル|h
L3: |VAR|[[甲＆乙>甲&#38;乙]]|作者|3|6|9|12|
L4: |~|~|~|>|BGCOLOR(#ff1c33):ULTIMA|14|
L5: |VAR|[[Halcyon]]|xi|>|BGCOLOR(#ff1c33):LEVEL|14+|
L6: |VAR|[[普通难度标题]]|作者|LEVEL|14|
L7: |VAR|[[新追加谱面]]|作者|ULTIMA|15|`;
  assert.deepEqual(ultimaSongs(source), [["甲＆乙", "甲&乙"], ["Halcyon"], ["新追加谱面"]]);
});

test("ULTIMA 清单：HTML rowspan 共用曲名，不把 MASTER 或只有表头的表误认成 ULTIMA", () => {
  const html = `<table><tr><th>ジャンル</th><th>タイトル</th><th>ULTIMA</th></tr>
<tr><td rowspan="2">VAR</td><td rowspan="2"><a href="/chunithmwiki/FLOWER" title="FLOWER">FLOWER</a></td><td>MASTER</td></tr>
<tr><td>ULTIMA</td></tr></table>`;
  assert.deepEqual(ultimaSongs(html), [["FLOWER"]]);
});

test("ULTIMA 版本：曲名从严匹配、WE 排除、复活时保留最早版本；少页或格式异常拒绝生成", () => {
  const page = (title) => `|VAR|[[${title}]]|作者|ULTIMA|14|`;
  const pages = Object.fromEntries(VERSIONS.map((version) => [version, page("不在曲库的曲目")]));
  pages.NEW = page("Flower");
  pages["NEW PLUS"] = page("FLOWER");
  pages.SUN = page("Flower");
  const song = (id, title, difficulty = 4) => ({ id, title, difficulties: [{ difficulty }] });
  assert.deepEqual([...assignUltimaVersions(pages, [song(1, "Flower"), song(2, "FLOWER"), song(8001, "Flower", 5)])], [[1, "NEW"], [2, "NEW PLUS"]]);
  assert.throws(() => assignUltimaVersions({}, []), /缺少 NEW/);
  assert.throws(() => assignUltimaVersions({ ...pages, SUN: "格式改变" }, []), /没有解析到 ULTIMA/);
});

test("已发布资料：旧曲 ULTIMA 的版本不使用难度调整后的更新日期", () => {
  const extras = loadSongExtras();
  assert.equal(extras.get(3).ultimaVersionJP, "NEW");
  assert.equal(extras.get(63).ultimaVersionJP, "NEW PLUS");
  assert.equal(extras.get(173).ultimaVersionJP, "LUMINOUS");
  assert.equal(extras.get(2822).ultimaVersionJP, "X-VERSE");
});
