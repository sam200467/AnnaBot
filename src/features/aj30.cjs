"use strict";
// /aj30：辅助分表。全部成绩里只挑 AJ（含 AJC）的谱面，不分新曲老曲，按单曲 Rating 排成 B30。
//
// 跟 /b30 的区别只有筛选条件：/b30 是全部谱面里最高的 30 首，/aj30 是 AJ 谱面里最高的 30 首。
// 要读全部成绩里每张谱面的分数和 FULL COMBO 标记，所以跟 /分数列表、/牌子进度 一样只收授权绑定
// （binding: "oauth"，好友码绑定的人会被请去 /授权）。
//
// 主题沿用 themes/best/（数据形状跟 /b30 一样，章节 key 是 "aj"，见 best.cjs 的 buildData）。
// 这是辅助用的表，作者 2026-10-19 要求不进指令面板（panel: false），/帮助 里还会列出来。

const { buildData, attachAssets, pickAj30, OLD_SLOTS } = require("./best.cjs");

module.exports = {
  name: "aj30",
  words: ["aj30"],
  usage: "/aj30",
  summary: "只要 AJ（含 AJC）的谱面，不分新旧排成 B30。要授权。",
  panel: false,   // 辅助用，不放进 QQ 输入框打 / 弹出的指令面板
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    const { catalog } = ctx.services;
    // 先在出图队列外读一次：一张 AJ 都没有时用文字回，不用画一张全是空位的图
    const [player, scores] = await Promise.all([ctx.player.player(), ctx.player.scores()]);
    if (!pickAj30({ scores, catalog }).length) return ctx.reply(ctx.voice.aj30Empty);
    await ctx.image({
      kind: "aj30",
      label: "AJ30 成绩图",
      render: async () => {
        const { assets, renderer } = ctx.services;
        const data = buildData({ mode: "aj30", player, scores, catalog });
        await attachAssets(data, assets);
        // 跟 /b50 /b30 同一种图：纹理多，JPEG 质量 76、宽 2100 的视口
        const image = await renderer.render("best", data, { width: 2100, height: 1000, format: "jpeg", quality: 76 });
        const count = data.chapters[0].scores.length;
        return { buffer: image.buffer, caption: count < OLD_SLOTS ? ctx.voice.aj30Few(count) : "" };
      },
    });
  },
};
