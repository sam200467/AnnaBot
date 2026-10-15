"use strict";
// /状态（谁都能用）和 /刷新曲库（管理员，不在帮助里列出）。

const status = {
  name: "status",
  words: ["状态", "狀態", "status"],
  usage: "/状态",
  summary: "看看我的运行状态",
  panel: false,   // 作者定的：指令面板只放常用的，手打和 /帮助 里照样有
  group: "其他",
  async run(ctx) {
    await ctx.reply(ctx.statusText());
  },
};

// 落雪曲库平时每 catalogRefreshHours 小时自动刷新一次；新曲刚上线想马上用时手动刷。
const refreshCatalog = {
  name: "refreshcatalog",
  words: ["刷新曲库", "refreshcatalog"],
  usage: "/刷新曲库",
  summary: "马上从落雪重新拉曲目和别名",
  group: "管理",
  adminOnly: true,
  hidden: true,
  async run(ctx) {
    const result = await ctx.services.catalog.refresh();
    await ctx.reply("曲库刷新好了：" + result.songs + " 首，别名 " + result.aliases + " 条。");
  },
};

module.exports = [status, refreshCatalog];
