"use strict";
// 中二节奏的分数算法：单曲 Rating、OVER POWER、分数线和容错。/谱面分析 用。
//
// Rating 和 OP 的公式照落雪前端 src/utils/chunithm/rating.ts、overPower.ts（github.com/Lxns-Network/maimai-prober-frontend，
// 注释里说跟后端一致）。2026-10-17 拿真成绩核过：定数 15.5 打 1,007,725 → Rating 17.5225、OP 87.8375，跟落雪返回的一模一样。
//
// 容错：每个物量一样重，J-CRITICAL 一个记 1,010,000 / N 分；JUSTICE 少 1%（10,000 / N 分）、ATTACK 少 51%、MISS 少 101%。
// 所以拿「丢了几个 JUSTICE」当单位最好算：一个 ATTACK 顶 51 个 JUSTICE、一个 MISS 顶 101 个，
// 打到 target 分最多能丢 (1,010,000 − target) × N / 10,000 个 JUSTICE。

const MAX_SCORE = 1010000;

// 评级分数线：从高到低
const RANK_LINES = [
  ["sssp", 1009000],
  ["sss", 1007500],
  ["ssp", 1005000],
  ["ss", 1000000],
  ["sp", 990000],
  ["s", 975000],
];
// 分数线表只列 SS 往上四档：S、S+ 两行作者 2026-10-17 说没必要
const TABLE_LINES = RANK_LINES.slice(0, 4);

// 单曲 Rating（没截断）。1,009,000 封顶，再往上不涨
function rating(constant, score) {
  let value = 0;
  if (score >= 1009000) value = constant + 2.15;
  else if (score >= 1007500) value = constant + 2 + (score - 1007500) / 10000;
  else if (score >= 1005000) value = constant + 1.5 + (score - 1005000) / 5000;
  else if (score >= 1000000) value = constant + 1 + (score - 1000000) / 10000;
  else if (score >= 975000) value = constant + (score - 975000) / 25000;
  else if (score >= 925000) value = constant - 3 + ((score - 925000) / 50000) * 3;
  else if (score >= 900000) value = constant - 5 + ((score - 900000) / 25000) * 2;
  else if (score >= 800000) value = ((constant - 5) / 2) * (1 + (score - 800000) / 100000);
  else if (score >= 500000) value = ((score - 500000) / 300000) * ((constant - 5) / 2);
  return Math.max(0, value);
}

// 往下截到两位，跟落雪一样加 1e-8：不然 16.7 + 0.15 = 16.849999… 会被截成 16.84
function truncate(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.floor(value * scale + 1e-8) / scale;
}

// OVER POWER：SSS（1,007,500）往上每分 +0.0015，过了 Rating 的封顶还接着涨；
// S 以上 FC +0.5、AJ / AJC +1；理论值再 +0.25。满的时候正好是 (定数 + 3) × 5
function overPower(constant, score, fullCombo) {
  const scorePower = score > 1007500 ? (constant + 2) * 5 + (score - 1007500) * 0.0015 : rating(constant, score) * 5;
  const combo = score < 975000 || !fullCombo ? 0 : fullCombo === "fullcombo" ? 0.5 : 1;
  const theory = score === MAX_SCORE ? 0.25 : 0;
  return { total: scorePower + combo + theory, max: (constant + 3) * 5 };
}

// 打到 target 分最多能丢几个 JUSTICE（没取整）
function justiceBudget(notes, target) {
  return ((MAX_SCORE - target) * notes) / 10000;
}

// 每个判定比 J-CRITICAL 少几分
function unitLoss(notes) {
  return { justice: 10000 / notes, attack: 510000 / notes, miss: 1010000 / notes };
}

// 1e-9：(1,010,000 − target) × N / 10,000 本该是整数时，浮点误差别让它少算一个
const whole = (value) => Math.floor(value + 1e-9);

// 分数线表（SSS+、SSS、SS+、SS）：每一档的分数、单曲 Rating（截到两位；没有定数的 WORLD'S END 是 null）、
// 另外全打 J-CRITICAL 时最多能有几个 JUSTICE / ATTACK / MISS。
// SS 那档的 JUSTICE 正好等于物量（全打 JUSTICE 也是 SS），照算出来的数写（作者不要「不限」）。
// 给了 score（玩家这张谱的最好成绩）就再算每一档还差几分、合几个 JUSTICE；已经到了的是 null
function scoreLines(notes, constant, score) {
  return TABLE_LINES.map(([rank, line]) => {
    const budget = justiceBudget(notes, line);
    const row = {
      rank,
      score: line,
      rating: constant ? truncate(rating(constant, line)) : null,
      justice: whole(budget),
      attack: whole(budget / 51),
      miss: whole(budget / 101),
    };
    if (Number.isFinite(score)) {
      const gap = line - score;
      row.gap = gap > 0 ? gap : null;
      // 往上取整：差 0.3 个 JUSTICE 也得少丢一个
      row.gapJustice = gap > 0 ? Math.ceil((gap * notes) / 10000 - 1e-9) : null;
    }
    return row;
  });
}

module.exports = { MAX_SCORE, RANK_LINES, TABLE_LINES, rating, truncate, overPower, justiceBudget, unitLoss, scoreLines };
