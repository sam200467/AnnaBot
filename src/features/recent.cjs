"use strict";
// /r30 读取每次游玩，不能用最好成绩或列表的 buildData：它们会合并同谱、按分数排序。
const { playerView, rankOf, stamp, attachAssets, renderBest } = require("./best.cjs");
const { rating } = require("../score-math.cjs");

const LIMIT = 30;

function buildData({ recents, player, catalog, now = new Date() }) {
  const records = Array.isArray(recents) ? recents : [];
  // 缺少游玩时间时不能拿同步时间顶替；同一分钟保留接口顺序，不猜测先后。
  const timed = records.filter((play) => play && Number.isFinite(Date.parse(play.play_time)));
  const charts = [...timed].sort((a, b) => Date.parse(b.play_time) - Date.parse(a.play_time)).slice(0, LIMIT)
    .map((play, i) => {
      const song = catalog.getSong(play.id);
      const chart = song ? catalog.chart(song, play.level_index) : null;
      const constant = Number(chart?.level_value) > 0 ? Number(chart.level_value) : null;
      const score = play.score == null ? null : Number(play.score);
      return {
        index: i + 1, id: play.id, title: play.song_name || song?.title || "曲目 " + play.id,
        levelIndex: Number(play.level_index), level: play.level || chart?.level || "", constant, score,
        rating: play.rating == null ? (constant && score !== null ? rating(constant, score) : null) : Number(play.rating),
        rank: play.rank || (score !== null ? rankOf(score) : null),
        clear: play.clear || null, fullCombo: play.full_combo || null, fullChain: play.full_chain || null,
        jacketId: song ? catalog.jacketId(song) : Number(play.id), jacket: null,
        playTime: play.play_time, playTimeText: stamp(new Date(play.play_time)),
      };
    });
  const omitted = records.length - timed.length;
  return {
    mode: "r30", player: playerView(player),
    chapters: [{ key: "recent", slots: LIMIT, scores: charts }],
    uniqueCharts: new Set(charts.map((row) => row.id + ":" + row.levelIndex)).size,
    note: "已同步的最近 " + charts.length + " 次游玩 · 重复游玩分别保留\n" +
      "从左到右、从上到下 · 游玩时间为北京时间" +
      (omitted ? "\n另有 " + omitted + " 条缺少有效游玩时间，未列入" : ""),
    time: stamp(now),
  };
}

module.exports = Object.assign({
  name: "r30", words: ["r30"], usage: "/r30",
  summary: "最近 30 次游玩，按时间从新到旧排成一页；重复游玩分别保留。（@ 别人也看）",
  panel: "最近 30 次游玩的成绩图",
  group: "查询", binding: "any", allowOthers: true,
  async run(ctx) {
    if (String(ctx.args || "").trim()) return ctx.reply(ctx.voice.recentUsage);
    const [recents, player] = await Promise.all([ctx.player.recents(), ctx.player.player()]);
    const data = buildData({ recents, player, catalog: ctx.services.catalog, now: ctx.now() });
    if (!data.chapters[0].scores.length) return ctx.reply(ctx.voice.recentEmpty);
    return ctx.image({
      kind: "r30", label: "最近 30 次游玩",
      render: async () => {
        const { assets, renderer } = ctx.services;
        await attachAssets(data, assets);
        const image = await renderBest(renderer, data);
        return { buffer: image.buffer };
      },
    });
  },
}, { buildData, LIMIT });
