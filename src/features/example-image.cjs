"use strict";
// 出图功能的参考写法（管理员指令，不在帮助里列出）。新的出图功能照这个文件的结构写：
//   1. 指令层已经按 binding 查好了绑定：ctx.player 就是这个人的查分入口（见 src/bindings.cjs 的 createPlayerApi）
//   2. 交给 ctx.image()：排队、冷却、「正在生成」占位、发图都由它管，render 里只管把图做出来
//   3. render 里取数据 → 落雪素材换成本地 file:// 地址（assets.fileUrls，慢，所以放在队列里做）→ renderer.render(主题, 数据)
// 落雪的错误（玩家关了第三方读取之类）直接抛出来就行，voice.cjs 的 errorText 会换成玩家看得懂的话。
// _example 主题只是演示，正式功能各用各的主题（themes/<名字>/）。

module.exports = {
  name: "exampleimage",
  words: ["示例图", "exampleimage"],
  usage: "/示例图",
  summary: "出图流程演示",
  group: "管理",
  binding: "any",
  adminOnly: true,
  hidden: true,
  async run(ctx) {
    await ctx.image({
      kind: "example",
      label: "示例图",
      render: async () => {
        const { assets, catalog, renderer } = ctx.services;
        const [player, bests] = await Promise.all([ctx.player.player(), ctx.player.bests()]);
        const top = [...bests.bests, ...(bests.new_bests || [])].sort((a, b) => b.rating - a.rating).slice(0, 5);
        const song = top.length ? catalog.getSong(top[0].id) : null;
        const [jacket] = song ? await assets.fileUrls([["jacket", catalog.jacketId(song)]]) : [null];
        return renderer.render("_example", {
          player: { name: player.name, rating: player.rating },
          jacket,
          songs: top.map((score) => ({ title: score.song_name, level: catalog.LEVELS[score.level_index], score: score.score })),
        });
      },
    });
  },
};
