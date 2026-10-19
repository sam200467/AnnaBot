"use strict";
// /信息：绑定的落雪账号和 Rating。纯文字，主要用来确认绑定和数据链路是通的。

module.exports = {
  name: "info",
  words: ["信息", "info", "玩家信息", "我"],
  usage: "/信息",
  summary: "你留在我这里的名字和 Rating。（@ 别人，我也替 TA 看）",
  panel: false,   // 作者定的：指令面板只放常用的，手打和 /帮助 里照样有
  group: "查询",
  binding: "any",
  allowOthers: true,
  async run(ctx) {
    const player = await ctx.player.player();
    await ctx.reply(ctx.voice.info(player, ctx.player));
  },
};
