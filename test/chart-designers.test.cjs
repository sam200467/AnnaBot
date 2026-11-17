"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDesignerIndex, parseDesignerQuery } = require("../src/chart-designers.cjs");

const song = (id, name, difficulty = 3, extra = {}) => ({ id, difficulties: [{ difficulty, note_designer: name }], ...extra });
const songs = [song(1, "Techno Kitchen"), song(2, "ぴちネコ", 4), song(3, "Techno Kitchen vs ぴちネコ"),
  song(4, "署名 2"), song(5, "删除署名", 3, { disabled: true }), song(6, "WE署名", 5), song(7, "红谱署名", 2)];
const index = createDesignerIndex(songs, { "ぴちネコ": ["猫"], "Techno Kitchen": ["厨房"] });

test("谱师原署名和维护的别名：全半角、大小写和空格统一；删除曲、WE、红谱不进索引，合作署名计入双方也保留独立查询", () => {
  assert.equal(index.resolve("ＴＥＣＨＮＯ　ＫＩＴＣＨＥＮ").name, "Techno Kitchen");
  assert.equal(index.resolve("猫").name, "ぴちネコ");
  assert.ok(index.resolve("厨房").credits.includes("technokitchenvsぴちネコ"));
  assert.ok(index.resolve("猫").credits.includes("technokitchenvsぴちネコ"));
  assert.notEqual(index.resolve("Techno Kitchen vs ぴちネコ"), index.resolve("厨房"));
  for (const name of ["删除署名", "WE署名", "红谱署名", "不存在"]) assert.equal(index.resolve(name), null);
  assert.throws(() => createDesignerIndex(songs, { "ぴちネコ": ["厨房"], "Techno Kitchen": ["厨房"] }), /别名重复/);
});

test("谱师只接受名字和空格数字页码，带空格名字不用引号；署名末尾数字优先当名字", () => {
  for (const text of ["Techno Kitchen 2", "厨房 2", '"Techno Kitchen" ２']) {
    const query = parseDesignerQuery(text, index);
    assert.equal(query.designer.name, "Techno Kitchen");
    assert.equal(query.page, 2);
  }
  assert.equal(parseDesignerQuery("猫", index).designer.name, "ぴちネコ");
  assert.equal(parseDesignerQuery("署名 2", index).page, null);
  assert.equal(parseDesignerQuery("署名 2 3", index).page, 3);
  for (const text of ["厨房 紫", "猫 SSS以下", "猫 14+", "猫 第2页", "猫 2 3"]) {
    assert.equal(parseDesignerQuery(text, index).designerError, "only");
  }
  for (const text of ["猫 0", "猫 99999999999999999999"]) {
    assert.equal(parseDesignerQuery(text, index).designerError, "usage");
  }
  assert.equal(parseDesignerQuery("谱师 猫", index), null, "命令不带谱师前缀");
  assert.equal(parseDesignerQuery("未知名字", index), null);
  assert.equal(parseDesignerQuery("14+ 紫", index), null);
});

test("有来源的马甲归入同一谱师，中文别名可挂在本名或马甲下；合作名同时计入双方", () => {
  const list = [song(1, "Techno Kitchen"), song(2, "wonder*"), song(3, "Techno Kitchen vs ぴちネコ"), song(4, "ZONE:SaFaRi vs. CODE:Ragnarok")];
  const grouped = createDesignerIndex(list, { "Techno Kitchen": ["厨房"], "wonder*": ["另一个简称"], "サファ太": ["safata"] });
  assert.equal(grouped.resolve("厨房"), grouped.resolve("wonder*"));
  assert.equal(grouped.resolve("厨房"), grouped.resolve("另一个简称"));
  assert.ok(grouped.resolve("wonder*").credits.includes("technokitchen"));
  assert.ok(grouped.resolve("wonder*").credits.includes("wonder*"));
  assert.ok(grouped.resolve("厨房").credits.includes("technokitchenvsぴちネコ"));
  assert.notEqual(grouped.resolve("Techno Kitchen vs ぴちネコ"), grouped.resolve("厨房"));
  assert.ok(grouped.resolve("safata").credits.includes("zone:safarivs.code:ragnarok"));
  assert.ok(grouped.resolve("Ragnarok").credits.includes("zone:safarivs.code:ragnarok"));
  const onlyAlt = createDesignerIndex([song(2, "wonder*")], { "Techno Kitchen": ["厨房"] });
  assert.equal(onlyAlt.resolve("厨房").name, "Techno Kitchen", "本名暂时不在曲库也能查到已知马甲");
  assert.throws(() => createDesignerIndex(list, {}, {
    A: { credits: ["Techno Kitchen", "wonder*"] }, B: { credits: ["wonder*"] },
  }), /马甲归属重复/);
});

test("wiki 明确公开的马甲能查同一组；Violetta、Ragnarok 的推测身份保持独立", () => {
  const list = ["ぴちネコ", "CODE:CatastroPhe", "Moon Strix", "六次元モーター", "Damnation",
    "ミストルティン", "Ragnarok", "アミノハバキリ", "Violetta", "ロシェ＠ペンギン", "CODE:Emperor"]
    .map((name, i) => song(i + 1, name));
  const index = createDesignerIndex(list, {});
  assert.equal(index.resolve("CatastroPhe"), index.resolve("ぴちネコ"));
  assert.equal(index.resolve("六次元モーター"), index.resolve("Moon Strix"));
  assert.equal(index.resolve("Damnation"), index.resolve("Moon Strix"));
  assert.equal(index.resolve("CODE:Emperor"), index.resolve("ロシェ＠ペンギン"));
  assert.notEqual(index.resolve("Violetta"), index.resolve("アミノハバキリ"));
  assert.notEqual(index.resolve("Ragnarok"), index.resolve("ミストルティン"));
});

test("作者确认的未证实身份按独立署名查询；START、Fahrenheit 不并入猜测对象，Toaster 不添加", () => {
  const names = ['START "A I R "', "Revo@LC", "Fahrenheit 212", "譜面-100号", "透明絵具"];
  const index = createDesignerIndex(names.map((name, i) => song(i + 1, name)), {});
  assert.notEqual(index.resolve('START "A I R "'), index.resolve("Revo@LC"));
  assert.notEqual(index.resolve("Fahrenheit 212"), index.resolve("譜面-100号"));
  assert.deepEqual(index.resolve("Fahrenheit 212").credits, ["fahrenheit212"]);
  assert.equal(parseDesignerQuery('START "A I R " 2', index).designer.name, 'START "A I R "');
  assert.equal(parseDesignerQuery('START "A I R " 2', index).page, 2);
  assert.equal(index.resolve("透明絵具").name, "透明絵具");
  assert.equal(index.resolve("Toaster"), null);
  assert.equal(Object.hasOwn(require("../src/data/chart-designer-identities.json"), "Toaster"), false);
});

test("作者配置的中文别名、翠楼屋并入沙发太、绿化委员长并入哈皮都能正确解析", () => {
  const realSongs = [
    "ぴちネコ", "ロシェ＠ペンギン", "じゃこレモン", "Techno Kitchen", "Redarrow", "Revo@LC",
    "はっぴー", "小鳥遊さん", "譜面-100号", "サファ太", "チャン@DP皆伝", "Luxizhel",
    "翠楼屋", "緑化委員長", "ZONE:SaFaRi vs. CODE:Ragnarok",
  ].map((name, i) => song(i + 1, name));
  const realIndex = createDesignerIndex(realSongs);
  assert.equal(realIndex.resolve("桃子猫").name, "ぴちネコ");
  assert.equal(realIndex.resolve("企鹅").name, "ロシェ＠ペンギン");
  assert.equal(realIndex.resolve("柠檬").name, "じゃこレモン");
  assert.equal(realIndex.resolve("科技厨房").name, "Techno Kitchen");
  assert.equal(realIndex.resolve("红箭").name, "Redarrow");
  assert.equal(realIndex.resolve("revolc").name, "Revo@LC");
  assert.equal(realIndex.resolve("哈皮").name, "はっぴー");
  assert.equal(realIndex.resolve("绿化委员长").name, "はっぴー");
  assert.equal(realIndex.resolve("緑化委員長").name, "はっぴー");
  assert.equal(realIndex.resolve("小鸟游").name, "小鳥遊さん");
  assert.equal(realIndex.resolve("谱面100号").name, "譜面-100号");
  assert.equal(realIndex.resolve("沙发太").name, "サファ太");
  assert.equal(realIndex.resolve("safata").name, "サファ太");
  assert.equal(realIndex.resolve("翠楼屋").name, "サファ太");
  assert.equal(realIndex.resolve("dp皆传").name, "チャン@DP皆伝");
  assert.equal(realIndex.resolve("泸溪河").name, "Luxizhel");
});
