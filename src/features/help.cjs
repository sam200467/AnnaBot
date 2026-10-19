"use strict";
// /帮助：清单由 commands.cjs 按各功能的 usage / summary / group 拼出来，加了新功能这里不用改。

module.exports = {
  name: "help",
  words: ["帮助", "help", "幫助", "菜单", "指令"],
  usage: "/帮助",
  summary: "就是你现在看的这些。",
  panel: "我都能替你做什么",
  group: "其他",
  async run(ctx) {
    await ctx.reply(ctx.helpText());
  },
};
