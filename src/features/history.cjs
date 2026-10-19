"use strict";
// /推分记录：按“一次同步”看账号 Rating 涨了多少。
//
//   /推分记录          最近一批（按 upload_time）
//   /推分记录 今天      今天 0 点（昨天收盘）到现在
//   /推分记录 7天 / 15天 / 本月
//
// 数据层在 src/history.cjs：落雪没有给机器人“同步结果”，所以用每条成绩的 upload_time 分批、
// 用单谱 /score/history 补旧值，再从基线重放 B50。第一次查某个窗口要逐首读历史，会慢一点；之后只补新上传。
// 这个功能只认授权绑定：要每一分的具体分数和历史成绩（好友码绑定的 /scores 没有分数）。

const path = require("node:path");
const { parseWindow, latestFrom, buildFrom, collect, buildReport, createHistoryStore } = require("../history.cjs");
const { newVersionFloor } = require("./best.cjs");
const { buildImageData, parseImageArgs } = require("../history-view.cjs");

module.exports = {
  name: "history",
  words: ["推分记录"],
  usage: "/推分记录（最新 / 今天 / 7天 / 15天 / 本月，可加 第2页）",
  summary: "看最近一次推分，或者今天、7 天、15 天、本月的记录。要授权。",
  panel: "看最近一次推了多少分",
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    const now = ctx.now ? ctx.now() : new Date();
    const query = parseImageArgs(ctx.args);
    let window = parseWindow(query.windowArg, { now });
    if (!window) return ctx.reply(ctx.voice.historyUsage);

    const { catalog } = ctx.services;
    const [player, scores, bests] = await Promise.all([
      ctx.player.player(), ctx.player.scores(), ctx.player.bests(),
    ]);
    if (!Array.isArray(scores) || !scores.length) return ctx.reply(ctx.voice.historyNoScores);

    const latestAt = latestFrom(scores);
    let from = window.kind === "latest" ? latestAt : window.from;
    if (!from) return ctx.reply(ctx.voice.historyEmpty(window.label));
    // 今天/7天/本月：最近一批比窗口还早（比如今天还没打）时也把它收进基线，
    // 这样“今天没有推分”还能说出最近一次是什么时候。
    if (window.kind !== "latest" && latestAt && latestAt < from) from = latestAt;
    if (window.kind === "latest") window = { ...window, from };

    // 测试和工具脚本不一定装 services.historyStore；按 workDir 现开一个
    const store = ctx.services.historyStore ||
      createHistoryStore({ dir: path.join(ctx.config.workDir, "history"), log: ctx.log });
    const fetchHistory = (songId, levelIndex) => ctx.player.scoreHistory(songId, levelIndex);

    const state = await store.withLock(ctx.userId, async () => {
      let current = store.read(ctx.userId);
      if (current && String(current.friendCode) !== String(player.friend_code)) current = null;
      if (!current || new Date(current.at).getTime() > from.getTime()) {
        current = await buildFrom({ from, scores, fetchHistory, friendCode: player.friend_code });
      } else {
        await collect({ state: current, scores, fetchHistory });
      }
      try {
        await store.write(ctx.userId, current);
      } catch (error) {
        ctx.log("⚠ 推分记录写盘失败（这次先照常显示）：" + error.message);
      }
      return current;
    });

    const report = buildReport({
      state, window, to: now, catalog,
      floor: newVersionFloor(bests, catalog),
      player,
    });
    if (window.kind === "today" && !report.batches.length) {
      return ctx.reply(ctx.voice.historyTodayNone(report.latest));
    }
    if (!report.batches.length) {
      return ctx.reply(window.kind === "latest" ? ctx.voice.historyNoRecords : ctx.voice.historyEmpty(window.label));
    }
    const data = buildImageData(report, { page: query.page });
    if (query.page > data.pages) return ctx.reply(ctx.voice.historyNoPage(data.pages));
    return ctx.image({
      kind: "history", label: "推分记录图",
      render: async () => {
        const image = await ctx.services.renderer.render("history", data, { format: "jpeg", quality: 76, scale: 1.5 });
        const next = data.page < data.pages ? "/推分记录 " + (query.windowArg || "最新") + " 第" + (data.page + 1) + "页" : null;
        return { buffer: image.buffer, caption: data.pages > 1 ? ctx.voice.historyPage(data.page, data.pages, next) : "" };
      },
    });
  },
};
