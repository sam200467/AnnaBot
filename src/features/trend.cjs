"use strict";
const path = require("node:path");
const { buildFrom, collect, createHistoryStore } = require("../history.cjs");
const { parseWindow, buildTrendData } = require("../trend.cjs");
const { newVersionFloor } = require("./best.cjs");

module.exports = {
  name: "trend",
  words: ["分表变化"],
  usage: "/分表变化 本周 / 本月",
  summary: "看本周或本月 B50、B30、N20 的变化。要授权。",
  panel: "看本周或本月分表变化",
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    const now = ctx.now ? ctx.now() : new Date();
    const window = parseWindow(ctx.args, now);
    if (!window) return ctx.reply(ctx.voice.trendUsage);
    const [player, scores, bests] = await Promise.all([
      ctx.player.player(), ctx.player.scores(), ctx.player.bests(),
    ]);
    if (!Array.isArray(scores) || !scores.length) return ctx.reply(ctx.voice.historyNoScores);
    // 与推分记录共用历史库和锁；查询更早的区间时重建基线，后续两个功能均能增量补全。
    const store = ctx.services.historyStore ||
      createHistoryStore({ dir: path.join(ctx.config.workDir, "history"), log: ctx.log });
    const fetchHistory = (id, lv) => ctx.player.scoreHistory(id, lv);
    const state = await store.withLock(ctx.userId, async () => {
      let current = store.read(ctx.userId);
      if (current && String(current.friendCode) !== String(player.friend_code)) current = null;
      if (!current || Date.parse(current.at) > window.from.getTime()) {
        current = await buildFrom({ from: window.from, scores, fetchHistory, friendCode: player.friend_code });
      } else {
        await collect({ state: current, scores, fetchHistory });
      }
      try { await store.write(ctx.userId, current); }
      catch (error) { ctx.log("⚠ 分表变化写盘失败（本次照常显示）：" + error.message); }
      return current;
    });
    const data = buildTrendData({
      state, window, to: now, catalog: ctx.services.catalog,
      floor: newVersionFloor(bests, ctx.services.catalog),
    });
    return ctx.image({
      kind: "trend", label: "分表变化图",
      render: async () => {
        const image = await ctx.services.renderer.render("trend", data, { format: "jpeg", quality: 76, scale: 1.5 });
        return { buffer: image.buffer };
      },
    });
  },
};
