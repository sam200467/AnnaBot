"use strict";
// 查询边界统一按北京时间，不受服务器时区影响。
const { replay, formatTime, formatDay } = require("./history.cjs");
const DAY_MS = 86400000;
const OFFSET_MS = 8 * 3600000;

function parseWindow(args, now = new Date()) {
  const label = String(args || "").trim();
  const kinds = { 本周: "week", 本月: "month", 半年: "halfYear", 今年: "year" };
  if (!Object.hasOwn(kinds, label)) return null;
  const local = new Date(now.getTime() + OFFSET_MS);
  let start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), label === "本月" ? 1 : local.getUTCDate());
  if (label === "本周") start -= ((local.getUTCDay() + 6) % 7) * DAY_MS;
  if (label === "半年") {
    // 按日历回溯六个月；月末超出目标月份时收至该月最后一天，避免 Date 自动滚到下个月。
    const month = local.getUTCMonth() - 6;
    const lastDay = new Date(Date.UTC(local.getUTCFullYear(), month + 1, 0)).getUTCDate();
    start = Date.UTC(local.getUTCFullYear(), month, Math.min(local.getUTCDate(), lastDay));
  }
  if (label === "今年") start = Date.UTC(local.getUTCFullYear(), 0, 1);
  return { kind: kinds[label], label, from: new Date(start - OFFSET_MS) };
}

function buildTrendData({ state, window, to = new Date(), catalog, floor } = {}) {
  const fromMs = window.from.getTime(), toMs = to.getTime();
  if (Date.parse(state.at) > fromMs || toMs < fromMs) throw new Error("推分记录的历史基线未覆盖查询区间");
  // 只消费旧模块公开的重放结果，不改变 /同步记录 的计算或展示。
  const { points: oldPoints, batches, initial } = replay(state, { catalog, floor });
  const points = oldPoints.map((point, i) => {
    const rows = i === 0 ? initial : batches[i - 1].afterRows;
    return { ...point,
      b30: rows.filter((row) => !row.isNew).reduce((sum, row) => sum + row.rating, 0) / 30,
      n20: rows.filter((row) => row.isNew).reduce((sum, row) => sum + row.rating, 0) / 20,
    };
  });
  let baseline = points[0];
  // 起点表示区间开始前一刻；零点正好上传的成绩也要计入区间涨幅。
  for (const point of points.slice(1)) {
    if (point.ms >= fromMs) break;
    baseline = point;
  }
  const updates = points.slice(1).filter((point) => point.ms >= fromMs && point.ms <= toMs);
  let startRows = initial, endRows = initial;
  for (const batch of batches) {
    if (batch.ms < fromMs) startRows = batch.afterRows;
    if (batch.ms <= toMs) endRows = batch.afterRows;
  }
  // 按区间首尾的 B50 比较谱面（曲目＋难度）：只数最后仍在表内的更新，
  // 新进只计一首，移出不另加一首，同一谱面更新多次也只计一次。
  const beforeByKey = new Map(startRows.map(row => [row.key, row]));
  const updatedCharts = endRows.filter(row => {
    const before = beforeByKey.get(row.key);
    return !before || row.score !== before.score || row.fc !== before.fc;
  }).length;
  const selected = [{ ...baseline, ms: fromMs }, ...updates];
  if (selected.at(-1).ms < toMs) selected.push({ ...selected.at(-1), ms: toMs });
  const series = [
    { key: "rating", title: "B50", subtitle: "分表均值", divisor: 50 },
    { key: "b30", title: "B30", subtitle: "旧曲部分", divisor: 30 },
    { key: "n20", title: "N20", subtitle: "新曲部分", divisor: 20 },
  ].map((meta) => {
    const values = selected.map((point) => ({ ms: point.ms, value: point[meta.key] }));
    const start = values[0].value, end = values.at(-1).value;
    return { ...meta, start, end, gain: end - start, points: values };
  });
  return {
    title: "推分记录", period: window.label, from: fromMs, to: toMs,
    rangeText: formatTime(fromMs) + " — " + formatTime(toMs),
    time: formatTime(toMs), batches: updates.length, updatedCharts, series,
    ticks: makeTicks(fromMs, toMs),
  };
}

// 长区间最多五个日期刻度，避免挤满标签；曲线仍保留每一批数据。
function makeTicks(from, to) {
  if (from === to) return [{ ms: from, label: formatDay(from) }];
  const count = Math.min(5, Math.max(2, Math.ceil((to - from) / DAY_MS) + 1));
  const ticks = Array.from({ length: count }, (_, i) => {
    const ms = from + (to - from) * i / (count - 1);
    return { ms, label: to - from < DAY_MS ? formatTime(ms, { withDate: false }) : formatDay(ms) };
  });
  // 周初只有一两天时，等距采样可能落在同一天；保留首尾，去掉重复的日期标签。
  return ticks.filter((tick, i) => i === 0 || i === ticks.length - 1 ||
    (tick.label !== ticks[0].label && tick.label !== ticks.at(-1).label &&
      !ticks.slice(1, i).some(previous => previous.label === tick.label)));
}

module.exports = { parseWindow, buildTrendData };
