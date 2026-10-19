"use strict";
// 主题共用的小工具（themes/shared/theme-kit.js）：Rating 颜色档、通关标记的文字。
// 分档照游戏 VERSE 以后的颜色（chunithm.org 的 Rating 表、wikiwiki「レーティングの色分け」），
// 15.25 以后游戏里还有星、17 以后是更深的虹，这里只验颜色档。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

// theme-kit 是浏览器里的 IIFE，加载时只碰 window；给它一个最小的 window 就能在 Node 里跑
function loadThemeKit() {
  const code = fs.readFileSync(path.join(ROOT, "themes", "shared", "theme-kit.js"), "utf8");
  const window = { addEventListener() {} };
  vm.runInNewContext(code, { window, document: {}, Image: function () {}, console });
  return window.ThemeKit;
}

test("ratingTier：0 绿、4 橙、7 赤、10 紫、12 铜、13.25 银、14.5 金、15.25 铂、16 虹、17 虹极", () => {
  const { ratingTier } = loadThemeKit();
  const cases = [
    [0, "green"], [3.99, "green"],
    [4, "orange"], [6.99, "orange"],
    [7, "red"], [9.99, "red"],
    [10, "purple"], [11.99, "purple"],
    [12, "bronze"], [13.24, "bronze"],
    [13.25, "silver"], [14.49, "silver"],
    [14.5, "gold"], [15.24, "gold"],
    [15.25, "platina"], [15.99, "platina"],
    [16, "rainbow"], [16.99, "rainbow"],
    [17, "rainbow-deep"], [17.5, "rainbow-deep"],
  ];
  for (const [value, tier] of cases) assert.equal(ratingTier(value), tier, "Rating " + value);
  // 没有 Rating（还没绑定、接口没给）当 0 算，落在绿档
  for (const value of [null, undefined, NaN, ""]) assert.equal(ratingTier(value), "green", "空值 " + String(value));
});

test("MARKS：FC/AJ/AJC 原样，长的通关标记缩写到牌子上放得下", () => {
  const { MARKS } = loadThemeKit();
  // VM 里造出来的对象跟这边的 Object.prototype 不是一个，不能直接 deepEqual；逐个字段比
  assert.equal(MARKS.fullcombo.text, "FC");
  assert.equal(MARKS.fullcombo.kind, "fc");
  assert.equal(MARKS.alljustice.text, "AJ");
  assert.equal(MARKS.alljustice.kind, "aj");
  assert.equal(MARKS.alljusticecritical.text, "AJC");
  assert.equal(MARKS.alljusticecritical.kind, "ajc");
  assert.equal(MARKS.hard.text, "HARD");
  assert.equal(MARKS.brave.text, "BRAVE");
  assert.equal(MARKS.absolute.text, "ABS");
  assert.equal(MARKS.catastrophy.text, "CATA");
  assert.equal(MARKS.fullchain.text, "CHAIN");
  assert.equal(MARKS.fullchain2.text, "CHAIN+");
  assert.equal(MARKS.fullchain2.kind, "chain gold");
  // 所有标记都得有配色 class，不然牌子上没有底色
  for (const [key, item] of Object.entries(MARKS)) {
    assert.ok(item.text && item.kind, key + " 缺文字或 class");
  }
});
