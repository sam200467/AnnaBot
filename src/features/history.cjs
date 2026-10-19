"use strict";
// /推分记录：按“一次同步”看账号 Rating 涨了多少。
//
//   /推分记录          最近一批（按 upload_time）
// 只接受无参数指令，横版图展示最近一批，超量明细注明省略数量。
//
// 数据层在 src/history.cjs：落雪没有给机器人“同步结果”，所以用每条成绩的 upload_time 分批、
// 用单谱 /score/history 补旧值，再从基线重放 B50。第一次查某个窗口要逐首读历史，会慢一点；之后只补新上传。
// 这个功能只认授权绑定：要每一分的具体分数和历史成绩（好友码绑定的 /scores 没有分数）。

const path = require("node:path");
const { latestFrom, buildFrom, collect, buildReport, createHistoryStore } = require("../history.cjs");
const { newVersionFloor } = require("./best.cjs");
const { buildImageData } = require("../history-view.cjs");

module.exports = {
  name: "history",
  words: ["推分记录"],
  usage: "/推分记录",
  summary: "看最新一次更新的成绩与 Rating 变化。要授权。",
  panel: "看最近一次推了多少分",
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    const now = ctx.now ? ctx.now() : new Date();
    if (String(ctx.args || "").trim()) return ctx.reply(ctx.voice.historyUsage);

    const { catalog } = ctx.services;
    const [player, scores, bests] = await Promise.all([
      ctx.player.player(), ctx.player.scores(), ctx.player.bests(),
    ]);
    if (!Array.isArray(scores) || !scores.length) return ctx.reply(ctx.voice.historyNoScores);

    const from = latestFrom(scores);
    if (!from) return ctx.reply(ctx.voice.historyNoRecords);
    const window = { kind:"latest",label:"最近一次",from };

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
    if (!report.batches.length) {
      return ctx.reply(ctx.voice.historyNoRecords);
    }
    const data = buildImageData(report);
    return ctx.image({
      kind: "history", label: "推分记录图",
      render: async () => {
        const image = await ctx.services.renderer.render("history", data, { format: "jpeg", quality: 76, scale: 1.5 });
        return { buffer: image.buffer };
      },
    });
  },
};
