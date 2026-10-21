"use strict";
// /年度总结：落雪的「年度总结」（user/chunithm/player/year-in-review/{年}）画成 Anna 自己的图（themes/year）。
// 不截落雪网页的图：那是一长页 Mantine 网页，还要登录网站；落雪给的 JSON 足够自己画。
//
// - 只能看自己：开发者接口没有这条路由，只能用授权令牌读（binding: "oauth"）。
// - 不写年份就看去年（北京时间）。落雪规定 Y 年的数据只能在 Y+1 年里生成，所以：
//   读的时候先不带 agree；没生成过（400 agree_required）而且正好是去年，就替玩家按一次网页上的「生成数据」
//   （带 agree=true；玩家自己发了指令，就当他同意了），先回一句让他等；更早的年份没生成过就是过了期限，落雪那边没有数据。
// - 生成慢（当场统计），放在出图队列外面做：队列里一次只出一张图，别让它堵住别人。

const { playerView } = require("./best.cjs");
const { buildYearView, attachYearAssets, totalUploads } = require("../year-review.cjs");

// 落雪的年度总结从 2024 年开始（前端 config.ts 的 SUPPORTED_YEARS）
const FIRST_YEAR = 2024;

function beijingYear(date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric" }).format(date));
}

// "" → 去年；"2025" / "2025年" → 2025；别的写法 null
function parseYear(args, now) {
  const text = String(args || "").trim();
  if (!text) return beijingYear(now) - 1;
  const match = text.match(/^(\d{4})\s*年?$/);
  return match ? Number(match[1]) : null;
}

module.exports = {
  name: "yearReview",
  words: ["年度总结"],
  usage: "/年度总结 [年份]",
  summary: "看去年在落雪上传成绩的年度总结，也能写年份。要授权。",
  panel: "看去年的年度总结",
  group: "查询",
  binding: "oauth",
  FIRST_YEAR,
  parseYear,
  async run(ctx) {
    const now = ctx.now ? ctx.now() : new Date();
    const thisYear = beijingYear(now);
    const year = parseYear(ctx.args, now);
    if (year === null) return ctx.reply(ctx.voice.yearReviewUsage);
    if (year >= thisYear) return ctx.reply(ctx.voice.yearReviewTooEarly(year));
    if (year < FIRST_YEAR) return ctx.reply(ctx.voice.yearReviewTooOld(FIRST_YEAR));

    let review;
    try {
      review = await ctx.player.yearInReview(year);
    } catch (error) {
      // 更早的年份落雪也回 agree_required（2026 年读 2024 年就是这样），不是 invalid_year：期限按年份自己判断
      if (error?.code === "invalid_year" || (error?.code === "agree_required" && year !== thisYear - 1)) {
        return ctx.reply(ctx.voice.yearReviewClosed(year));
      }
      if (error?.code !== "agree_required") throw error;
      await ctx.reply(ctx.voice.yearReviewGenerating(year));
      review = await ctx.player.yearInReview(year, { agree: true });
    }
    if (!review || totalUploads(review) === 0) return ctx.reply(ctx.voice.yearReviewEmpty(year));

    // 名片板（名牌版、称号、头像、段位、总 Rating）用现在的玩家资料；读不到就不画那一块
    const player = await ctx.player.player().catch(() => null);
    const data = buildYearView({ review, catalog: ctx.services.catalog, player: player ? playerView(player) : null });
    return ctx.image({
      kind: "yearReview", label: "年度总结图",
      render: async () => {
        await attachYearAssets(data, ctx.services.assets);
        const image = await ctx.services.renderer.render("year", data, { format: "jpeg", quality: 76, scale: 1.5 });
        return { buffer: image.buffer };
      },
    });
  },
};
