"use strict";
// /aj50：辅助分表。跟 /b50 一样分新老版本（旧曲 30 个位置 + 新曲 20 个位置），但只挑 AJ（含 AJC）的谱面。
//
// 跟 /aj30 的区别：/aj30 不分新旧、只排一栏 30 首；/aj50 分两栏、均值按 50 算。
// 新曲的边界跟 /b50 一样看落雪 /bests 的 new_bests（最老的那首新曲的版本）；所以除了全部成绩，还要读一下 /bests。
// 要每张谱面的分数和 FULL COMBO 标记，只收授权绑定（binding: "oauth"）；好友码绑定会被请去 /授权。
//
// 主题沿用 themes/best/（数据形状跟 /b50 一样，章节 key 是 old / new，见 best.cjs 的 buildData）。
// 这是辅助用的表，跟 /aj30 一样不进指令面板（panel: false），/帮助 里还会列出来。

const { buildData, attachAssets, pickAj50, OLD_SLOTS, NEW_SLOTS } = require("./best.cjs");

module.exports = {
  name: "aj50",
  words: ["aj50"],
  usage: "/aj50",
  summary: "辅助分表：分新旧，只挑 AJ（含 AJC）的谱面，旧曲 30 + 新曲 20（要授权）",
  panel: false,   // 辅助用，不放进 QQ 输入框打 / 弹出的指令面板
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    const { catalog } = ctx.services;
    // 先在出图队列外读一次：一张 AJ 都没有时用文字回，不用画一张全是空位的图
    const [player, scores, bests] = await Promise.all([ctx.player.player(), ctx.player.scores(), ctx.player.bests()]);
    const picked = pickAj50({ scores, bests, catalog });
    if (!picked.old.length && !picked.fresh.length) return ctx.reply(ctx.voice.aj50Empty);
    await ctx.image({
      kind: "aj50",
      label: "AJ50 成绩图",
      render: async () => {
        const { assets, renderer } = ctx.services;
        const data = buildData({ mode: "aj50", player, scores, bests, catalog });
        await attachAssets(data, assets);
        // 跟 /b50 /b30 同一种图：纹理多，JPEG 质量 76、宽 2100 的视口
        const image = await renderer.render("best", data, { width: 2100, height: 1000, format: "jpeg", quality: 76 });
        const old = data.chapters[0].scores.length;
        const fresh = data.chapters[1].scores.length;
        const caption = old < OLD_SLOTS || fresh < NEW_SLOTS ? ctx.voice.aj50Few(old, fresh) : "";
        return { buffer: image.buffer, caption };
      },
    });
  },
};
