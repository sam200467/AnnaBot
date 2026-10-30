"use strict";
// /搜索歌曲：模糊找歌，列出各难度的定数和曲目 ID。曲名、别名、ID 都认，规则在 song-search.cjs。
//
// 别名直接用落雪曲库里的 alias/list（catalog.cjs 已经缓存并合并进搜索索引），不另外维护本地别名库 ——
// 社区新加的别名在落雪网站上改，Anna 下次刷新曲库（默认 6 小时）就跟着更新。
// 结果里只写 ID、曲名和难度，不把别名列出来（作者 2026-10-19 定的，MiaBot 搜索时也不显示别名）。
//
// 结果用 Markdown 发：曲名是指令链接，点一下把「/谱面分析 id…」填进输入框；不止一页时挂翻页按钮。
// 指令链接的写法和转义在 markdown.cjs，按钮的排法在 pager.cjs（跟 /分数列表 共用）。平台没有
// Markdown/按钮权限时传输层会自动退回纯文本 / 不带按钮的 Markdown（见 official-transport.cjs 的 sendMarkdown）。
// 查的是公开曲库，翻页按钮谁点都行，不绑发起人。
//
// 一页 8 首是照 MiaBot：曲名一行、谱面一行，8 首连抬头和翻页提示约 800 字，不会撑爆一条消息。

const { V } = require("../voice.cjs");
const { linkable, markdownLine, plainLine } = require("../markdown.cjs");
const { pagerKeyboard, pageLine } = require("../pager.cjs");

const PER_PAGE = 8;
// 曲库现在 1400 多首；给足上限，页数才算得准。搜索本身只遍历一次索引，不差这点。
const MAX_RESULTS = 2000;
const WORLDS_END = 5;
const LEVEL_WORDS = ["bas", "adv", "exp", "mas", "ult", "we"];
const LEVEL_SHORT = ["BAS", "ADV", "EXP", "MAS", "ULT", "WE"];

// 「/搜索歌曲 混沌 --page 2」，也认「第 2 页」「p2」。光秃秃的数字不当页码 —— 曲名里有《39》。
function parseArgs(args) {
  let text = String(args || "").normalize("NFKC").trim();
  let page = 1;
  const patterns = [
    /(?:^|\s)--page\s*(?:=\s*)?(\d+)\s*$/i,
    /(?:^|\s)第\s*(\d+)\s*页\s*$/,
    /\s+p(\d+)\s*$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    page = Math.max(1, Math.floor(Number(match[1]) || 1));
    text = text.slice(0, match.index).trim();
    break;
  }
  // 照着封面抄曲名时可能连引号一起抄进来；只在两头有引号时去掉，曲名中间的引号不动。
  text = text.replace(/^[「『“"']|[」』”"']$/g, "").trim();
  return { query: text, page };
}

// 一张谱面写成「MAS 14.5」「WE ★4 戻」；定数没有就退回等级（「13+」）
function chartText(chart) {
  const difficulty = Number(chart?.difficulty);
  if (difficulty === WORLDS_END) {
    const star = Number(chart.star);
    const kanji = String(chart.kanji || "").trim();
    return "WE" + (star > 0 ? " ★" + star : "") + (kanji ? " " + kanji : "");
  }
  const label = LEVEL_SHORT[difficulty] || ("难度" + (Number.isInteger(difficulty) ? difficulty : "?"));
  const constant = Number(chart?.level_value);
  const level = String(chart?.level ?? "").trim();
  return label + " " + (constant > 0 ? String(Number(constant.toFixed(1))) : (level || "?"));
}

// 点曲名后填进输入框的命令。默认 MASTER（不写难度就是 MASTER），所以有 MASTER 时留个空格让用户补颜色；
// 没有 MASTER 的（只有 ULTIMA 之类）直接填上最高那张的难度词，WE 曲填 we。
function analysisCommand(song, charts, catalog) {
  const id = "id" + song.id;
  if (catalog.isWorldsEnd(song)) return "/谱面分析 " + id + " we";
  if (charts.some((chart) => Number(chart.difficulty) === 3)) return "/谱面分析 " + id + " ";
  const highest = charts
    .map((chart) => Number(chart.difficulty))
    .filter((level) => level >= 0 && level < WORLDS_END)
    .sort((a, b) => b - a)[0];
  return "/谱面分析 " + id + (highest === undefined ? "" : " " + LEVEL_WORDS[highest]);
}

// 结果的一行写成 markdown.cjs 的数组；整行都是 { hint } 的只在 Markdown 里出现
const isHintLine = (line) => line.length > 0 && line.every((part) => part?.hint);

// 参数 + 曲库 → 要发的东西。纯函数，测试和功能都走这里。
// 返回 { kind: "text", text } 或 { kind: "markdown", markdown, text, keyboard?, markdownWithoutKeyboard? }。
// text 是 Markdown 被拒时的纯文本；markdownWithoutKeyboard 是按钮被拒（或配置关了按钮）时用的正文。
function buildReply(args, catalog, voice = V) {
  const { query, page } = parseArgs(args);
  if (!query || query.length > 100) return { kind: "text", text: voice.searchUsage };
  const found = catalog.search(query, { limit: MAX_RESULTS });
  if (!found.length) return { kind: "text", text: voice.searchNotFound(query) };
  const pages = Math.max(1, Math.ceil(found.length / PER_PAGE));
  if (page > pages) return { kind: "text", text: voice.searchNoPage(pages) };
  const shown = found.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const lines = [[voice.searchFound(found.length, page, pages)]];
  let linked = false;
  for (const result of shown) {
    const song = result.song;
    const charts = [...(song.difficulties || [])].sort((a, b) => Number(a.difficulty) - Number(b.difficulty));
    const worldsEnd = catalog.isWorldsEnd(song);
    const title = "id" + song.id + "   " + song.title + (worldsEnd ? "【WORLD'S END】" : "") + (song.disabled ? "（已删除）" : "");
    const command = analysisCommand(song, charts, catalog);
    const titlePart = linkable(title, command) ? { text: title, command } : title;
    if (titlePart !== title) linked = true;
    lines.push([""], [titlePart], [charts.length ? charts.map(chartText).join(" / ") : voice.searchNoCharts]);
  }
  if (found.some((result) => result.fuzzy)) lines.push([""], [voice.searchFuzzy]);

  const jump = (target) => "/搜索歌曲 " + query + " --page " + target;
  let pagerLine = null;
  if (pages > 1) {
    pagerLine = pageLine(page, pages, page < pages ? jump(page + 1) : null, voice);
    lines.push([""], pagerLine);
  }
  if (linked) lines.push([""], [{ hint: voice.searchHint }]);

  // 有按钮时正文里那行「下一页：…」换成按钮提示；按钮被拒时传输层改发 markdownWithoutKeyboard，
  // 原来那行可点的指令还在。没有按钮的中文提示不会出现在纯文本里。
  const withButtons = pagerLine
    ? lines.map((line) => (line === pagerLine ? [voice.pageButtons(page, pages)] : line))
    : lines;
  const text = lines.filter((line) => !isHintLine(line)).map(plainLine).join("\n").replace(/\n+$/, "");
  const keyboard = pages > 1 ? pagerKeyboard({ page, pages, jump, input: "/搜索歌曲 " + query + " --page ", labels: voice.pagerLabels }) : null;
  return {
    kind: "markdown",
    markdown: withButtons.map(markdownLine).join("\n"),
    text,
    ...(keyboard ? { keyboard, markdownWithoutKeyboard: lines.map(markdownLine).join("\n") } : {}),
  };
}

module.exports = Object.assign({
  name: "search",
  words: ["搜索歌曲", "搜歌", "查歌", "songsearch"],
  usage: "/搜索歌曲 曲名线索",
  summary: "记不清曲名也没关系：曲名、别名、ID 都能找，列出各难度的定数和曲目 ID。",
  panel: "记不清曲名？我连定数一起找",
  group: "查询",
  binding: "none",
  async run(ctx) {
    const reply = buildReply(ctx.args, ctx.services.catalog, ctx.voice);
    if (reply.kind === "text") return ctx.reply(reply.text);
    await ctx.replyMarkdown(reply.markdown, reply.text, {
      heading: true,
      ...(reply.keyboard ? { keyboard: reply.keyboard, markdownWithoutKeyboard: reply.markdownWithoutKeyboard } : {}),
    });
  },
}, { parseArgs, chartText, analysisCommand, buildReply, PER_PAGE });
