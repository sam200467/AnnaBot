"use strict";
const path = require("node:path");
const { buildFrom, collect, createHistoryStore } = require("../history.cjs");
const { parseWindow, buildTrendData } = require("../trend.cjs");
const { newVersionFloor, playerView } = require("./best.cjs");

// 名牌版、角色头像换成本地 file:// 地址。落雪素材慢，只在出图队列里做（跟 /分数列表 一样）。
// 少了任何一张（玩家没设、图没下到）主题那边有退路：象牙纸的牌子、一颗星。
async function attachAssets(data, assets) {
  const items = [];
  const targets = [];
  if (data.player.plateId !== null) {
    items.push(["plate", data.player.plateId]);
    targets.push((url) => { data.player.plate = url; });
  }
  if (data.player.characterId !== null) {
    items.push(["character", data.player.characterId]);
    targets.push((url) => { data.player.character = url; });
  }
  if (!items.length) return data;
  const urls = await assets.fileUrls(items);
  urls.forEach((url, i) => targets[i](url));
  return data;
}

module.exports = {
  name: "trend",
  words: ["分表变化"],
  usage: "/分表变化 本周 / 本月",
  summary: "看本周或本月 B50、B30、N20 的变化。要授权。",
  panel: "看本周或本月分表变化",
  group: "查询",
  binding: "oauth",
  attachAssets,
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
    const data = {
      ...buildTrendData({
        state, window, to: now, catalog: ctx.services.catalog,
        floor: newVersionFloor(bests, ctx.services.catalog),
      }),
      // 右上角名片板：名牌版、称号、★转生 Lv.等级 + 名字、角色头像和段位（跟 /分数列表 一样）
      player: playerView(player),
    };
    return ctx.image({
      kind: "trend", label: "分表变化图",
      render: async () => {
        await attachAssets(data, ctx.services.assets);
        const image = await ctx.services.renderer.render("trend", data, { format: "jpeg", quality: 76, scale: 1.5 });
        return { buffer: image.buffer };
      },
    });
  },
};
