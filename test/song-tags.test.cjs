"use strict";
// src/song-tags.cjs：别名、四层标签（官方分类 / 世界观厂牌 / 来源游戏 / BMS）的匹配
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSongTags, loadSongTags, normalize } = require("../src/song-tags.cjs");

const tags = createSongTags({
  extras: {
    get: (id) => ({
      850: { labels: ["シビュラ精霊記レーベル", "精霊編"] },
      2000: { labels: ["Metaverseレーベル", "仮想世界編"] },
      3000: { labels: ["イロドリミドリ"] },
    }[id]),
  },
  origins: { 3: "音击", 4: "舞萌", 5: "両方" },
  bms: [6, "7"],
});

const song = (id, genre = "原创") => ({ id, title: "曲" + id, genre });

test("别名：中 / 日 / 英 / 缩写都认；同一个词不能指向两个标签", () => {
  for (const word of ["精灵记", "精霊記", "精霊记", "シビュラ精霊記", "シビュラ", "sibyl", "西比拉"]) {
    assert.equal(tags.resolve(word)?.key, "精灵记", word);
  }
  for (const word of ["音击", "音擊", "オンゲキ", "ongeki", "音击少女"]) assert.equal(tags.resolve(word)?.key, "音击", word);
  for (const word of ["舞萌", "maimai", "舞萌DX", "maimaiDX"]) assert.equal(tags.resolve(word)?.key, "舞萌", word);
  for (const word of ["BMS", "bms", "BOF", "BMS曲"]) assert.equal(tags.resolve(word)?.key, "BMS", word);
  for (const word of ["东方", "東方", "touhou", "东方project", "车万"]) assert.equal(tags.resolve(word)?.key, "东方", word);
  for (const word of ["彩绿", "イロドリミドリ", "irodori", "彩绿计划"]) assert.equal(tags.resolve(word)?.key, "彩绿", word);
  for (const word of ["流行动漫", "流行&动漫", "pops"]) assert.equal(tags.resolve(word)?.key, "流行动漫", word);
  for (const word of ["GUMIN", "愚民大陆", "愚民"]) assert.equal(tags.resolve(word)?.key, "GUMIN", word);
  for (const word of ["リレイション", "心连羁绊", "心连", "羁绊"]) assert.equal(tags.resolve(word)?.key, "リレイション", word);
  for (const word of ["Metaverse", "元宇宙", "虚拟世界", "电脑世界"]) assert.equal(tags.resolve(word)?.key, "Metaverse", word);
  for (const word of ["アニマリア", "群码动物仙境", "群马动物仙境", "动物仙境"]) assert.equal(tags.resolve(word)?.key, "アニマリア", word);
  for (const word of ["SeelischTact", "泽利"]) assert.equal(tags.resolve(word)?.key, "SeelischTact", word);
  for (const word of ["Genesis Of Destiny", "创世命运", "创世"]) assert.equal(tags.resolve(word)?.key, "GenesisOfDestiny", word);
  for (const word of ["オムニバス", "合集", "群星"]) assert.equal(tags.resolve(word)?.key, "オムニバス", word);
  for (const word of ["言ノ葉", "言叶", "言葉", "言ノ叶", "言叶计划", "言灵计划"]) assert.equal(tags.resolve(word)?.key, "言ノ葉", word);
  assert.equal(tags.resolve("不存在的分类"), null);
  for (const word of ["精霊編", "精霊编", "精灵篇", "スカージ編", "スカージ", "天灾篇"]) {
    assert.equal(tags.resolve(word)?.key, "精灵记", word + " 不是单独分类，落到父分类");
  }
  for (const word of ["仮想世界編", "仮想世界", "地上編", "地上篇", "新章", "电脑世界篇"]) {
    assert.equal(tags.resolve(word)?.key, "Metaverse", word + " 不是单独分类，落到父分类");
  }

  const owner = new Map();
  for (const def of tags.defs) {
    for (const alias of [...def.aliases, def.command]) {
      const key = normalize(alias);
      assert.ok(!owner.has(key) || owner.get(key) === def.key, "别名重复：" + alias + "（" + owner.get(key) + " / " + def.key + "）");
      owner.set(key, def.key);
    }
  }
});

test("匹配：官方分类看 genre，厂牌只看顶层栏目，来源看 origins（両方两个都算），BMS 看整理表", () => {
  assert.equal(tags.has(song(1, "原创"), "原创"), true);
  assert.equal(tags.has(song(1, "音击舞萌"), "原创"), false);
  assert.equal(tags.has(song(1, "音击舞萌"), "音击舞萌"), true);
  assert.equal(tags.has(song(3000, "彩绿"), "彩绿"), true);
  assert.equal(tags.has(song(3000, "彩绿"), "イロドリミドリ"), true, "彩绿的日文别名也能筛到");

  assert.equal(tags.has(song(850), "精灵记"), true, "顶层栏目");
  assert.equal(tags.has(song(850), "西比拉"), true, "别称也能命中");
  assert.equal(tags.has(song(850), "精霊編"), true, "章名落到父分类，不单独统计");
  assert.equal(tags.has(song(850), "スカージ編"), true);
  assert.equal(tags.has(song(2000), "Metaverse"), true);
  assert.equal(tags.has(song(2000), "元宇宙"), true);
  assert.equal(tags.has(song(2000), "仮想世界編"), true, "章名落到父分类");
  assert.equal(tags.has(song(2000), "精灵记"), false);
  assert.equal(tags.has(song(999), "精灵记"), false);

  assert.equal(tags.has(song(3, "音击舞萌"), "音击"), true);
  assert.equal(tags.has(song(4, "音击舞萌"), "舞萌"), true);
  assert.equal(tags.has(song(5, "音击舞萌"), "音击"), true, "両方：两边都算");
  assert.equal(tags.has(song(5, "音击舞萌"), "舞萌"), true);
  assert.equal(tags.has(song(8, "音击舞萌"), "音击"), false);

  assert.equal(tags.has(song(6, "其他游戏"), "BMS"), true);
  assert.equal(tags.has(song(7, "其他游戏"), "BMS"), true, "字符串 ID 也认");
  assert.equal(tags.has(song(8, "其他游戏"), "BMS"), false);
  assert.equal(tags.has(song(850), "不存在的分类"), false);
});

test("名字和翻页写法：显示名可以带空格，command 必须是能再解析的一个词", () => {
  assert.equal(tags.name("genesis"), "Genesis Of Destiny");
  assert.equal(tags.command("genesis"), "GenesisOfDestiny");
  assert.equal(tags.name("流行动漫"), "流行 & 动漫");
  assert.equal(tags.command("流行动漫"), "流行动漫");
  assert.equal(tags.command("BMS"), "BMS");
  assert.equal(tags.name(null), "");
  assert.equal(tags.command("不存在"), "");
});

test("默认数据能加载：精灵记、音击、BMS 都有实际曲目", () => {
  const real = loadSongTags();
  assert.equal(real.resolve("精灵记")?.key, "精灵记");
  assert.equal(real.has({ id: 850, genre: "原创" }, "精灵记"), true, "2026-10 的数据里 850 在精灵记里");
  assert.equal(real.has({ id: 730, genre: "音击舞萌" }, "音击"), true);
  assert.equal(real.has({ id: 45, genre: "其他游戏" }, "BMS"), true);
});
