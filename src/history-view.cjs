"use strict";
// 图片展示数据：窗口裁切、区间净变化、按行数分页。主题只排版，不重算 Rating。
const { formatTime } = require("./history.cjs");
const DETAIL_ROWS = 16;
const SUMMARY_ROWS = 8;

function parseImageArgs(args) {
  const text = String(args || "").normalize("NFKC").trim();
  const match = text.match(/^(.*?)\s*第\s*([1-9]\d*)\s*页$/);
  return { windowArg: match ? match[1].trim() : text, page: match ? Number(match[2]) : 1 };
}

function buildImageData(report, { page = 1 } = {}) {
  const fromMs = new Date(report.from).getTime();
  const toMs = new Date(report.to).getTime();
  const decorate = (row) => ({ ...row, levelIndex: Number(row.key.split(":")[1]) });
  const changed = new Map();
  for (const batch of report.batches) for (const row of batch.events) {
    const previous = changed.get(row.key);
    changed.set(row.key, { ...row, prevScore: previous ? previous.prevScore : row.prevScore,
      prevRating: previous ? previous.prevRating : row.prevRating, updates: (previous?.updates || 0) + 1 });
  }
  const summary = report.composition || { entered: [], improved: [], left: [] };
  const gains = [...summary.entered.map((row) => ({ ...changed.get(row.key), ...row, change: "enter" })),
    ...summary.improved.map((row) => ({ ...changed.get(row.key), ...row, change: "up" }))].map(decorate);
  const losses = summary.left.map(decorate);
  // 一批过大时允许续页；每段的组头明确写“整批”，不把批次涨幅分摊到歌曲。
  const detailPages = [];
  let blocks = [], used = 0;
  for (const batch of [...report.batches].reverse()) {
    const rows = batch.events.map(decorate);
    if (!rows.length) continue;
    let offset = 0;
    while (offset < rows.length) {
      if (used >= DETAIL_ROWS - 1) { detailPages.push(blocks); blocks = []; used = 0; }
      const take = Math.min(rows.length - offset, DETAIL_ROWS - used - 1);
      blocks.push({ timeText: batch.timeText, before: batch.before, after: batch.after, impact: batch.impact,
        continued: offset > 0, hasMore: offset + take < rows.length, total: rows.length, events: rows.slice(offset, offset + take) });
      used += take + 1;
      offset += take;
    }
  }
  if (blocks.length || !detailPages.length) detailPages.push(blocks);
  const pages = Math.max(detailPages.length, Math.ceil(gains.length / SUMMARY_ROWS), Math.ceil(losses.length / SUMMARY_ROWS), 1);
  const slice = (rows) => rows.slice((page - 1) * SUMMARY_ROWS, page * SUMMARY_ROWS);
  // 起点是窗口开始前的值，最新批次也保留起点和结果两个点；前端按批次等距排。
  const points = [{ ms: fromMs, rating: report.rating.start, label: "起点" },
    ...report.batches.map((batch) => ({ ms: batch.ms, rating: batch.after,
      label: formatTime(batch.ms, { withDate: report.window.kind !== "today" && report.window.kind !== "latest" }) }))];
  return {
    title: "推分记录", windowLabel: report.window.label, kind: report.window.kind,
    range: formatTime(fromMs) + " — " + formatTime(toMs), time: formatTime(toMs),
    rating: report.rating, counts: report.counts, page, pages, points,
    composition: { gains: slice(gains), left: slice(losses), entered: summary.entered.length,
      improved: summary.improved.length, removed: losses.length, totalGains: gains.length },
    batches: detailPages[page - 1] || [],
  };
}

module.exports = { buildImageData, parseImageArgs, DETAIL_ROWS, SUMMARY_ROWS };
