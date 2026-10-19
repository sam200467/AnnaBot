"use strict";
// /拟合定数b30：把每张谱面的官方定数换成 EazyChu 的拟合定数，重新算单曲 Rating，再不分新旧取最高的 30 首。
//
// 跟 /b30 的区别：
//   - 定数用 src/data/fit-diffs.json 里的拟合值（见 fit-diffs.cjs），不是官方定数
//   - 单曲 Rating 用 score-math.rating(拟合定数, 分数) 重算，排序也按重算后的值
//   - 拟合定数会改变排名，原本 50 名开外的谱面可能被抬进前 30，所以必须读全部成绩（binding: "oauth"）；
//     好友码绑定只有 /bests 的前 50 首，会漏。
//   - 不分新旧，只排一栏 30 首。
//
// 主题沿用 themes/best/（mode 是 fit30，章节 key 是 fit）。图注会说清：不到 30 首、以及有几张谱面没有拟合定数。

const { buildData, attachAssets } = require("./best.cjs");
const { loadFitDiffs } = require("../fit-diffs.cjs");

const fallback = loadFitDiffs();

module.exports = {
  name: "fit30",
  words: ["拟合定数b30", "fit30"],
  usage: "/拟合定数b30",
  summary: "把定数换成拟合定数，重算单曲 Rating，再取最高的 30 首。要授权。",
  panel: false,   // 只隐藏 QQ 指令面板入口，仍可手动发送指令使用
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    const table = ctx.services.fitDiffs || fallback;
    if (!table || table.size === 0) return ctx.reply(ctx.voice.fit30NoData);

    const { catalog } = ctx.services;
    const [player, scores] = await Promise.all([ctx.player.player(), ctx.player.scores()]);
    if (!Array.isArray(scores) || !scores.length) return ctx.reply(ctx.voice.fit30Empty);

    const data = buildData({
      mode: "fit30", player, scores, catalog,
      fitConstantOf: (songId, levelIndex) => table.get(songId, levelIndex),
    });
    const picked = data.chapters[0].scores;
    if (!picked.length) return ctx.reply(ctx.voice.fit30Empty);
    data.fit.source = table.source;
    data.fit.capturedAt = table.capturedAt;

    const caption = ctx.voice.fit30Note(picked.length, data.fit.missing);
    await ctx.image({
      kind: "fit30",
      label: "拟合定数 B30 成绩图",
      render: async () => {
        const { assets, renderer } = ctx.services;
        await attachAssets(data, assets);
        // 竖版的 best 主题（/b30 原来的样子，它 2026-10-20 换成了横版 felix）：纹理多，JPEG 质量 76、宽 2100 的视口
        const image = await renderer.render("best", data, { width: 2100, height: 1000, format: "jpeg", quality: 76 });
        return { buffer: image.buffer, caption };
      },
    });
  },
};
