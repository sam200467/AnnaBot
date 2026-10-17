"use strict";
// 分数算法（src/score-math.cjs）：单曲 Rating、OP 拿落雪真返回过的数核对（2026-10-17，定数 15.5 的混沌 MASTER），
// 分数线、容错按「一个 ATTACK 顶 51 个 JUSTICE、一个 MISS 顶 101 个」算。
const test = require("node:test");
const assert = require("node:assert/strict");
const { rating, truncate, overPower, justiceBudget, unitLoss, scoreLines, TABLE_LINES } = require("../src/score-math.cjs");

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, (message || "") + "：" + actual + " ≠ " + expected);

test("单曲 Rating：各档公式跟落雪返回的一样，1,009,000 封顶，低分不出负数", () => {
  near(rating(15.5, 1007725), 17.5225, "SSS");
  near(rating(15.5, 1003525), 16.8525, "SS");
  near(rating(15.5, 990107), 16.10428, "S");
  near(rating(15.5, 1006000), 17.2, "SS+");
  near(rating(15.5, 1009000), 17.65, "SSS+");
  near(rating(15.5, 1010000), 17.65, "过了 SSS+ 不再涨");
  near(rating(13, 950000), 11.5, "AA");
  near(rating(13, 912500), 9, "A");
  near(rating(13, 850000), 6, "BBB");
  assert.equal(rating(5, 600000), 0);
  assert.equal(rating(10, 400000), 0);
});

test("截到两位：加了容差，16.7 + 0.15 不会截成 16.84", () => {
  assert.equal(truncate(16.7 + 0.15), 16.85);
  assert.equal(truncate(16.8499), 16.84);
  assert.equal(truncate(17.5225), 17.52);
});

test("OVER POWER：SSS 往上每分 +0.0015；S 以上才有 FC/AJ 加成；理论值正好满", () => {
  near(overPower(15.5, 1007725, null).total, 87.8375, "落雪返回的");
  near(overPower(15.5, 1003525, null).total, 84.2625, "SS 是 Rating × 5");
  near(overPower(15.5, 1007725, "fullcombo").total, 88.3375, "FC +0.5");
  near(overPower(15.5, 1007725, "alljustice").total, 88.8375, "AJ +1");
  near(overPower(15.5, 970000, "fullcombo").total, 76, "S 以下没有 FC 加成");
  const max = overPower(15.5, 1010000, "alljusticecritical");
  near(max.total, max.max, "理论值");
  near(max.max, 92.5);
});

test("容错：打到某档最多能丢几个 JUSTICE；每个判定扣几分", () => {
  near(justiceBudget(2800, 1009000), 280);
  near(justiceBudget(1497, 1009000), 149.7);
  near(justiceBudget(2800, 1000000), 2800, "SS 正好是全 JUSTICE");
  const unit = unitLoss(2000);
  near(unit.justice, 5);
  near(unit.attack, 255);
  near(unit.miss, 505);
});

test("分数线表：只有 SSS+ 到 SS 四档；SS 的 JUSTICE 写物量；带了玩家分数就算还差多少", () => {
  assert.deepEqual(TABLE_LINES.map(([rank]) => rank), ["sssp", "sss", "ssp", "ss"]);
  const lines = scoreLines(2800, 15.5, 1007725);
  assert.deepEqual(lines[0], { rank: "sssp", score: 1009000, rating: 17.65, justice: 280, attack: 5, miss: 2, gap: 1275, gapJustice: 357 });
  assert.deepEqual(lines[1], { rank: "sss", score: 1007500, rating: 17.5, justice: 700, attack: 13, miss: 6, gap: null, gapJustice: null });
  assert.deepEqual(lines[3], { rank: "ss", score: 1000000, rating: 16.5, justice: 2800, attack: 54, miss: 27, gap: null, gapJustice: null });
  // 物量不是整数倍时往下取整；差的 JUSTICE 往上取整
  const odd = scoreLines(1497, 13.5, 1006812);
  assert.deepEqual(odd.map((line) => line.justice), [149, 374, 748, 1497]);
  assert.deepEqual(odd.map((line) => line.gapJustice), [328, 103, null, null]);
  // 没给分数：没有「还差」；没有定数（WORLD'S END）：Rating 是 null
  const plain = scoreLines(1000, null);
  assert.equal("gap" in plain[0], false);
  assert.deepEqual(plain.map((line) => line.rating), [null, null, null, null]);
});
