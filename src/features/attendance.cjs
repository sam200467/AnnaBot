"use strict";
// /出勤记录：最近一次出勤打了哪些谱面、几点到几点，加一条近一年的同步日历（themes/attendance）。
// 跟 /同步记录 不一样：这里没涨分的、被技能强制结束的游玩都算。
//
// 数据整理在 src/attendance.cjs：Recent 50 切场、同一张谱面合成一行、全部最好成绩对出哪几张是这场破的纪录；
// 日历是落雪的 heatmap（按同步那天记）。heatmap 和全部成绩只有授权读得到（开发者接口的 heatmap 要对方开着
// 「允许读取历史成绩」，默认关），所以只认授权绑定、只能看自己。Recent 50 走开发者接口（授权绑定也存着好友码）。

const { buildAttendanceView } = require("../attendance.cjs");

module.exports = {
  name: "attendance",
  words: ["出勤记录", "出勤"],
  usage: "/出勤记录",
  summary: "看最近一次出勤打了哪些谱面、打了多久，和近一年的同步日历。要授权。",
  panel: "看最近一次出勤打了什么",
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    if (String(ctx.args || "").trim()) return ctx.reply(ctx.voice.attendanceUsage);
    const [recents, heatmap, bests] = await Promise.all([ctx.player.recents(), ctx.player.heatmap(), ctx.player.scores()]);
    const data = buildAttendanceView({ recents, heatmap, bests, catalog: ctx.services.catalog, now: ctx.now() });
    if (!data) return ctx.reply(ctx.voice.attendanceNoPlays);
    return ctx.image({
      kind: "attendance", label: "出勤记录图",
      render: async () => {
        const image = await ctx.services.renderer.render("attendance", data, { format: "jpeg", quality: 76, scale: 1.5 });
        return { buffer: image.buffer };
      },
    });
  },
};
