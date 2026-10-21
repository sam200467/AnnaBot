"use strict";
// 固定横版展示最近一批；明细按单曲 Rating 降序截取，统计仍用整批数据。
const { formatTime } = require("./history.cjs");
const DETAIL_LIMIT = 8;
const CHANGE_LIMIT = 7;
const decorate = (row) => ({ ...row, levelIndex: Number(row.key.split(":")[1]) });
const fcRank = (value) => ({ alljusticecritical:3, alljustice:2, fullcombo:1 }[value] || 0);
function buildImageData(report) {
  const batch = report.batches.at(-1);
  if (!batch) throw new Error("最新一次没有可展示的同步记录");
  const events = batch.events.map(decorate);
  const sorted = [...events].sort((a,b) => b.rating-a.rating || b.score-a.score || a.key.localeCompare(b.key));
  const changed = new Map(events.map((row) => [row.key,row]));
  const entrants = new Set(batch.entered.map((row) => row.key));
  const gains = [...batch.entered.map((row) => ({ ...changed.get(row.key), ...decorate(row), change:"enter" })),
    ...sorted.filter((row) => row.inB50 && !entrants.has(row.key)).map((row) => ({ ...row, change:"up" }))];
  const changes = [...gains, ...batch.left.map((row) => ({ ...decorate(row), change:"leave" }))];
  changes.sort((a,b) => ({ enter:0,leave:1,up:2 }[a.change]-{ enter:0,leave:1,up:2 }[b.change]) || b.rating-a.rating);
  return {
    title:"同步记录", time:formatTime(new Date(report.to).getTime()), batchTime:batch.timeText,
    rating:{ start:batch.before,end:batch.after,gain:batch.impact,now:report.rating.now },
    counts:{ total:events.length,entered:batch.entered.length,left:batch.left.length,improved:gains.length-batch.entered.length,
      outside:events.filter((row) => !row.inB50).length,marks:events.filter((row) => fcRank(row.fc)>fcRank(row.prevFc)).length },
    changes:changes.slice(0,CHANGE_LIMIT),changesTotal:changes.length,changesOmitted:Math.max(0,changes.length-CHANGE_LIMIT),
    events:sorted.slice(0,DETAIL_LIMIT),omitted:Math.max(0,events.length-DETAIL_LIMIT),
  };
}
module.exports = { buildImageData, DETAIL_LIMIT, CHANGE_LIMIT };
