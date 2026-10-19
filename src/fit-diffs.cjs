"use strict";
// 拟合定数：EazyChu 根据玩家上传成绩算出来的“体感定数”，不是官方定数。
// 数据是开发机上用 tools/build-fit-diffs.cjs 抓的一次快照，生成 src/data/fit-diffs.json 随程序发布；
// 运行时只读这份表，不联网。
//
//   fitDiffs.get(2848, 2) → 10.184
//   表里没有这张谱面（新曲、WORLD'S END、国服还没上）→ null，调用方退回官方定数
//
// 文件缺了、坏了都不影响别的功能：get 返回 null；/拟合定数b30 会提示数据没加载。

const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "data", "fit-diffs.json");

function loadFitDiffs(file = FILE) {
  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    payload = {};
  }
  const charts = payload.charts || {};
  return {
    get(songId, levelIndex) {
      const list = charts[String(Number(songId))];
      if (!Array.isArray(list)) return null;
      const value = Number(list[Number(levelIndex)]);
      return Number.isFinite(value) && value > 0 ? value : null;
    },
    get source() { return payload.source || ""; },
    get capturedAt() { return payload.capturedAt || ""; },
    get size() { return Object.keys(charts).length; },
  };
}

module.exports = { loadFitDiffs, FILE };
