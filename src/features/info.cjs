"use strict";
// /信息：绑定的落雪账号、Rating、总游玩次数和 OP。玩家资料一次请求就能取全。

module.exports = {
  name: "info",
  words: ["信息", "info", "玩家信息", "我"],
  usage: "/信息",
  summary: "你的账号、Rating、总游玩次数和 OP 进度。（@ 别人，我也替 TA 看）",
  panel: false,   // 作者定的：指令面板只放常用的，手打和 /帮助 里照样有
  group: "查询",
  binding: "any",
  allowOthers: true,
  async run(ctx) {
    const player = await ctx.player.player();
    await ctx.reply(ctx.voice.info(player, ctx.player));
  },
};
