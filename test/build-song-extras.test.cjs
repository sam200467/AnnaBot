"use strict";
// tools/build-song-extras.cjs 的 wiki 解析和匹配（不联网）：HTML 是照着 wikiwiki 的写法编的小样
const test = require("node:test");
const assert = require("node:assert/strict");
const { themeSongs, assignCharacters, addFaces, charactersOn } = require("../tools/build-song-extras.cjs");

const link = (title, text = title) => `<a href="/chunithmwiki/${encodeURIComponent(title)}" title="${title}" class="rel-wiki-page">${text}</a>`;
const note = '<a id="notetext_1"  class="note_super tooltip"\n data-tooltip-content="&lt;p&gt;脚注&lt;/p&gt;">*1</a>';

const PAGE = `
<p>${link("キャラクター世界観1")}（正文里的链接不算）</p>
<table><tr><td>背景</td><td>${link("ステージ背景")}</td></tr></table>
<table>
<tr><th>キャラクター</th><th>テーマ曲</th><th>アーティスト</th></tr>
<tr><td colspan="3"><strong>▼ CHUNITHM CRYSTAL</strong></td></tr>
<tr><td>${link("ティータ・アヴェニアス")}${note}</td><td>${link("《混乱》 ～ Muspell")}</td><td>Norn</td></tr>
<tr><td>${link("ティータ・アヴェニアス／混乱の業火")}</td><td rowspan="2" colspan="2">(対応楽曲無し)</td></tr>
<tr><td>${link("ミァン・テルスウラス／安寧の刻")}</td></tr>
<tr><td>${link("星河 うた")}</td><td rowspan="2">${link("後夜祭")}</td><td rowspan="2">田口囁一</td></tr>
<tr><td>(フジキュー)</td></tr>
<tr><td rowspan="2">(上記2名)</td><td>${link("曲 X", "曲<br class=\"spacer\">X")}</td><td>x</td></tr>
<tr><td>曲 Y</td><td>y</td></tr>
</table>
<table>
<tr><th>キャラクター/アーティスト</th><th>テーマ曲</th></tr>
<tr><td>${link("機神 トール", "(覚醒機神 トール)")}</td><td>${link("神鳴")}</td></tr>
<tr><td>${link("memex／Utopithm", "memex")}</td><td>${link("Utopithm")}</td></tr>
</table>`;

test("汇总页的表：合并单元格展开，版本标题和「対応楽曲無し」跳过，「上記2名」往上数", () => {
  const uta = { shown: "星河 うた", page: "星河 うた" };
  assert.deepEqual(themeSongs(PAGE), [
    { songs: [["《混乱》 ～ Muspell", "《混乱》 ～ Muspell"]], characters: [{ shown: "ティータ・アヴェニアス", page: "ティータ・アヴェニアス" }] },
    { songs: [["後夜祭", "後夜祭"]], characters: [uta, { shown: "フジキュー" }] },
    { songs: [["曲\nX", "曲 X"]], characters: [uta, { shown: "フジキュー" }] },
    { songs: [["曲 Y"]], characters: [uta, { shown: "フジキュー" }] },
    { songs: [["神鳴", "神鳴"]], characters: [{ shown: "覚醒機神 トール", page: "機神 トール" }] },
    { songs: [["Utopithm", "Utopithm"]], characters: [{ shown: "memex", page: "memex／Utopithm" }] },
  ]);
});

test("对上落雪：曲名从严到宽，角色先按写出来的名字、再按链接，对不上只记名字；没链接的纯文字只有原创曲才记", () => {
  const songs = [
    { id: 850, title: "《混乱》 ～ Muspell", genre: "原创" },
    { id: 8850, title: "《混乱》 ～ Muspell", genre: "原创" },   // WE 跟原曲同名，不能让它把原曲挤成「撞名」
    { id: 276, title: "後夜祭", genre: "原创" },
    { id: 2613, title: "Overhea[r]t", genre: "原创" },
    { id: 1057, title: "Over Heart", genre: "彩绿" },
    { id: 203, title: "FLOWER", genre: "原创" },
    { id: 2663, title: "Flower", genre: "音击舞萌" },
    { id: 2430, title: "REL0VE REL1VE", genre: "原创" },
    { id: 2700, title: "神鳴", genre: "原创" },
    { id: 2800, title: "Utopithm", genre: "原创" },
    { id: 202, title: "GEMINI -C-", genre: "原创" },
    { id: 2333, title: "痛快リズムアクション「B.B.K.K.B.K.K.」", genre: "彩绿" },
    { id: 160, title: "Change Our MIRAI！", genre: "彩绿" },
    { id: 2400, title: "モ°ルモ°ル", genre: "音击舞萌" },
    { id: 1, title: "某首东方曲", genre: "东方Project" },
  ];
  const characters = [
    { id: 8790, name: "ティータ・アヴェニアス" },
    { id: 1890, name: "星河 うた" },
    { id: 1891, name: "フジキュー" },
    { id: 17690, name: "宍戸 美鈴／It’s meant to be." },
    { id: 110, name: "機神 トール" },
    { id: 111, name: "覚醒機神 トール" },
    { id: 15630, name: "アンシャール・アウダーチア" },
    { id: 480, name: "明坂 芹菜" },
    { id: 510, name: "箱部 なる" },
  ];
  const tita = { shown: "ティータ・アヴェニアス", page: "ティータ・アヴェニアス" };
  const items = [
    { songs: [["《混乱》 ～ Muspell", "《混乱》 ～ Muspell"]], characters: [tita] },
    { songs: [["後夜祭", "後夜祭"]], characters: [{ shown: "星河 うた", page: "星河 うた" }, { shown: "フジキュー" }] },
    { songs: [["Overhea［r］t", "Overhea［r］t"]], characters: [{ shown: "MIR-203" }] },
    { songs: [["Over Heart", "Over Heart"]], characters: [{ shown: "芒崎 奏", page: "芒崎 奏" }] },
    { songs: [["Flower", "Flower"]], characters: [{ shown: "ASTERISM" }] },
    { songs: [["REL0VE REL1VE", "REL0VE REL1VE"]], characters: [{ shown: "宍戸 美鈴\n／It's meant to be.", page: "宍戸 美鈴／It's meant to be." }] },
    { songs: [["神鳴", "神鳴"]], characters: [{ shown: "覚醒機神 トール", page: "機神 トール" }, { shown: "アンシャール／セイクリッドナイト", page: "アンシャール・アウダーチア" }] },
    { songs: [["Utopithm", "Utopithm"]], characters: [{ shown: "memex", page: "memex／Utopithm" }] },
    { songs: [["GEMINI -C-", "GEMINI -C-"]], characters: [{ shown: "ジェミニ・α", page: "ジェミニ・α" }, { shown: "ジェミニ・Ω" }] },
    { songs: [["痛快リズムアクション「B.B.K.K.B.K.K.」"]], characters: [{ shown: "明坂 芹菜＆箱部 なる" }] },
    { songs: [["Change Our MIRAI！", "Change Our MIRAI！"]], characters: [{ shown: "イロドリミドリ" }] },
    { songs: [["モ°ルモ°ル", "モ°ルモ°ル"]], characters: [{ shown: "対応キャラ無し" }] },
    { songs: [["某首东方曲"]], characters: [tita] },
    { songs: [["国服没有的曲子"]], characters: [{ shown: "谁" }] },
  ];
  assert.deepEqual(Object.fromEntries(assignCharacters(items, { songs, characters })), {
    850: [{ name: "ティータ・アヴェニアス", id: 8790 }],
    276: [{ name: "星河 うた", id: 1890 }, { name: "フジキュー", id: 1891 }],
    2613: [{ name: "MIR-203", id: null }],                       // 宽松形式里跟彩绿的「Over Heart」一样，原样比就分得开
    1057: [{ name: "芒崎 奏", id: null }],                        // 彩绿也填；有角色页的对不上照样只记名字
    2430: [{ name: "宍戸 美鈴／It’s meant to be.", id: 17690 }],  // 撇号、换行不影响
    2700: [{ name: "覚醒機神 トール", id: 111 }, { name: "アンシャール・アウダーチア", id: 15630 }],
    2800: [{ name: "memex／Utopithm", id: null }],               // 只写了艺人名，记链接上的完整角色名
    202: [{ name: "ジェミニ・α", id: null }, { name: "ジェミニ・Ω", id: null }],   // 原创曲：没链接的变身形态也记
    2333: [{ name: "明坂 芹菜", id: 480 }, { name: "箱部 なる", id: 510 }],     // 「＆」连着的两个人拆开
    // 彩绿、音击舞萌的纯文字对不上落雪就不算：组合名（Flower、Change Our MIRAI！）、「対応キャラ無し」；东方曲不填
  });
});

test("头像替身：国服缺这张卡时借同一个人别的卡的头像，先挑原版卡；落雪有这张卡的、根本没这个人的都不借", () => {
  const characters = [
    { id: 2450, name: "箱部 なる／学園MVP編" },
    { id: 510, name: "箱部 なる" },
    { id: 11140, name: "葛城 華／襲来のシンセ研編" },
    { id: 11141, name: "葛城 華／なんかノイズにきこえる" },
    { id: 1962, name: "みるく＆しゃま" },
    { id: 13810, name: "しゃま／UNiVERSE" },
  ];
  const songs = {
    684: { characters: [{ name: "箱部 なる／波瀾の新入生編", id: null }, { name: "箱部 なる／学園MVP編", id: 2450, face: 1 }] },
    849: { characters: [{ name: "葛城 華", id: null }] },
    333: { characters: [{ name: "しゃま", id: null }, { name: "ジェミニ・α", id: null, face: 99 }] },
    1: { releaseJP: "2015-07-16" },
  };
  addFaces(songs, characters);
  assert.deepEqual(songs, {
    684: { characters: [{ name: "箱部 なる／波瀾の新入生編", id: null, face: 510 }, { name: "箱部 なる／学園MVP編", id: 2450 }] },
    849: { characters: [{ name: "葛城 華", id: null, face: 11140 }] },   // 没有原版卡：ID 最小的一张
    333: { characters: [{ name: "しゃま", id: null, face: 13810 }, { name: "ジェミニ・α", id: null }] },   // 「みるく＆しゃま」不是同一个人
    1: { releaseJP: "2015-07-16" },
  });
});

test("曲目页的「対応キャラ」：脚注去掉，换行分开，「／」不拆", () => {
  const html = `<table><tr><th>ジャンル</th><td>ORIGINAL</td></tr>
<tr><th>対応キャラ</th><td>${link("愛野 ヒカリ／最愛の光")}${note}<br>${link("天野 あい")}</td></tr></table>`;
  assert.deepEqual(charactersOn(html), ["愛野 ヒカリ／最愛の光", "天野 あい"]);
  assert.deepEqual(charactersOn("<table><tr><th>対応キャラ</th><td>-</td></tr></table>"), []);
});
