"use strict";
// /分数列表（原名 /等级）：一批谱面的全部成绩（某个等级、某个定数，还能再按难度、版本、评级筛）。主题是 themes/list/（圣女安娜，设计说明见它的 README）。
// 照 MiaBot 的 /等级 做：没打过的谱面也列出来，灰着排在最后；抬头统计 AJC、AJ、FC、SSS+、SSS 各有几张。
// 右上角画玩家的名片板（名牌版、称号、★转生 Lv.等级、角色和段位），总 Rating 写在名片板里面 —— 作者 2026-10-18 要的，
// /b50 的总 Rating 是写在名牌版外面的。所以出图时除了全部成绩，还要读玩家资料（player）。
//
//   /分数列表 14+           Lv.14+ 的全部谱面，第 1 页
//   /分数列表 14+ 2         第 2 页（也认「第2页」「p2」）
//   /分数列表 14.5          定数 14.5（「定数 14」这样写整数也行）
//   /分数列表 14+ 紫        只看 MASTER。难度词同 /谱面分析：绿 黄 红 紫 黑、bas adv exp mas ult、basic … ultima
//   /分数列表 13+ X-VERSE   只看 X-VERSE 的曲（按曲目第一次出现的版本，跟 B50 分新旧曲一样）；PLUS 写成 + 也认
//   /分数列表 14 SSS以下    只看还没到 SSS 的（没打过的也算）；「SSS以上」是到了的；只写「SSS」是正好 SSS 这一档
//   /分数列表 精灵记        按分类筛（官方分类、世界观厂牌、音击/舞萌、BMS，词表见 src/song-tags.cjs）
//   /分数列表 精灵记 紫     分类只和难度、页码组合；分类默认只列紫谱、黑谱
//   /分数列表 精灵记 2      分类后面的数字是页码（不会再当成等级）
// 条件随便组合、顺序随意，作者 2026-10-17 定的这几种（「只看没 FC 的」不要）。至少要有等级、定数、难度、版本、分类里的一样：
// 只按评级筛的话，没打过的几千张谱面全算「SSS 以下」，没法看。
// 分类是离线表：官方分类直接看落雪的 genre；世界观厂牌在 song-extras.json 的 labels；音击/舞萌在 song-origins.json；
// BMS 在 song-bms.json。一次只认一个分类；分类后面不能再加等级、定数、版本、评级，只能加紫/黑和页码。
// 分类默认只统计紫谱（MASTER）和黑谱（ULTIMA），红黄绿不列；要看红黄绿就别带分类，按等级或定数查。
// 页码：写了「第 N 页」「pN」的直接认；分类后面的裸数字一定是页码；不带分类时，裸数字前面还没有等级、定数时是等级，
// 有了就是页码（MiaBot 的写法「/分数列表 14+ 2」）。
//
// 要具体分数，所以只认授权绑定（binding: "oauth"，好友码绑定的人会被请去 /授权）：读全部成绩，对上曲库里符合条件的谱面。
// 统计是包含关系（作者 2026-10-17 定的，MiaBot 同时改了）：AJ 里含 AJC、FC 里含 AJ，SSS 里含 SSS+。统计的是筛完的全部谱面，不只这一页。
// 排序：打过的按分数从高到低，没打过的排在后面、按定数从高到低。
// WORLD'S END 没有等级和定数，不列；曲库里标了 disabled（已删除）的曲目也不列。
// 主题吃的数据形状见 themes/list/examples/preview-data.json；parseQuery、selectCharts、buildData 是纯函数，测试和示例数据都用它们。

const { rankOf, stamp, playerView } = require("./best.cjs");
const { LEVEL_WORDS } = require("./chart.cjs");
const { rating } = require("../score-math.cjs");
const { LEVELS, WORLDS_END } = require("../catalog.cjs");
const { loadSongTags } = require("../song-tags.cjs");

// 主题的网格：抬头占第 1 行，安娜占右边两列、从第 1 行往下 7 行，所以前 6 行卡片只能排 3 列（18 张），
// 从第 8 行起才是 5 列。非最后一页排 18 + 12×5 = 78 张，最后一行正好填满（作者 2026-10-18 提的：
// 原来一页 80 张，换页前最后一行只剩 2 张、空 3 格）。最后一页不用再换页，放得下 80 张就不硬拆成两页。
const PER_PAGE = 78;
const MAX_PER_PAGE = 80;
// 2 倍图一页（78 张）要 5.4 MB（作者要 5 MB 以内）：曲绘、珐琅框都是细纹理，压不下去，所以这张图按 1.8 倍出；
// 78 张约 4.6 MB（见 themes/list/README.md）
const RENDER_SCALE = 1.8;

// 一共几页：前面的页固定 PER_PAGE，最后一页最多 MAX_PER_PAGE
function pageCount(total) {
  return Math.max(1, Math.ceil((total - MAX_PER_PAGE) / PER_PAGE) + 1);
}

const RANK_NAMES = { sssp: "SSS+", sss: "SSS", ssp: "SS+", ss: "SS", sp: "S+", s: "S", aaa: "AAA", aa: "AA", a: "A", bbb: "BBB", bb: "BB", b: "B", c: "C", d: "D" };
// 每一档的分数线（到了这个分就是这一档），跟 best.cjs 的 rankOf 一致
const RANK_FLOORS = { sssp: 1009000, sss: 1007500, ssp: 1005000, ss: 1000000, sp: 990000, s: 975000, aaa: 950000, aa: 925000, a: 900000,
  bbb: 800000, bb: 700000, b: 600000, c: 500000, d: 0 };
// 评级的写法：SSS+ 也写 sssp；「鸟」是 SSS、「鸟加」是 SSS+（舞萌那边的叫法，中二玩家也这么说）
const RANK_WORDS = new Map([
  ...Object.keys(RANK_NAMES).map((key) => [key, key]),
  ...Object.entries(RANK_NAMES).map(([key, name]) => [name.toLowerCase(), key]),
  ["鸟", "sss"], ["鳥", "sss"], ["鸟加", "sssp"], ["鸟+", "sssp"], ["鳥加", "sssp"], ["鳥+", "sssp"],
]);
const BELOW = new Set(["以下", "未达", "未到", "没到", "不到", "未满"]);
const ABOVE = new Set(["以上"]);

// 版本名比较时的写法：小写、PLUS 换成 +、去掉空格和连字符、去掉开头的 CHUNITHM（「CHUNITHM X-VERSE」→「xverse」，第一代「CHUNITHM」本身留着）
function versionKey(text) {
  const key = String(text || "").normalize("NFKC").toLowerCase().replace(/plus/g, "+").replace(/[\s\-_.·・]/g, "");
  return key.startsWith("chunithm") && key.length > 8 ? key.slice(8) : key;
}
// 社群里常见的缩写
const VERSION_ALIASES = new Map([["xv", "xverse"], ["lmn", "luminous"], ["lmn+", "luminous+"]]);
// 图上和提示里写的版本名：去掉开头的 CHUNITHM
const versionLabel = (entry) => (/^CHUNITHM ./.test(entry.title) ? entry.title.slice(9) : entry.title);

// 曲目属于哪个版本：版本表里不超过它的最近一个（同 catalog.versionTitle）
function versionOf(song, versions) {
  let found = null;
  for (const entry of versions) if (entry.version <= song.version && (!found || entry.version > found.version)) found = entry;
  return found;
}

// 「Lv.14+」「lv14+」「14＋」→ "14+"；不像等级返回 null
function levelOf(token) {
  const match = token.match(/^(?:lv\.?)?(\d{1,2})(\+?)$/);
  return match ? String(Number(match[1])) + match[2] : null;
}

// 拆参数。versions 是曲库的版本表（认版本名用），tags 是分类表（认精灵记、音击、BMS 用）。
// 返回：
//   { level, constant, levelIndex, version, rank: { key, mode: below | above | exact }, tag, tagConflict, page, unknown: [看不懂的词], worldsEnd, bare }
// level 是字符串（"14+"），constant 是数（14.5），version 是版本表里的一项，tag 是 song-tags 的一项；没写的是 null。page 没写是 null。
// bare：等级是从光秃秃的整数认的（「/分数列表 master 2」的 2），对不上谱面时 resolveCharts 会改当页码；
// 分类后面的裸数字在 parseQuery 末尾直接当页码，不会留成等级。
// tagConflict：分类又跟等级、定数、版本、评级或第二个分类一起写了，调用方要提示只允许难度和页码。
function parseQuery(args, { versions = [], tags = null } = {}) {
  const tagIndex = tags || loadSongTags();
  const query = { level: null, constant: null, levelIndex: null, version: null, rank: null, tag: null, tagConflict: false, page: null, unknown: [], worldsEnd: false, bare: false };
  let text = String(args || "").normalize("NFKC").toLowerCase();
  // 页码先拿掉：「第 2 页」「2页」「p2」「page 2」
  text = text.replace(/第\s*(\d+)\s*页|(\d+)\s*页|(?<![a-z])p(?:age)?\s*(\d+)(?![\d.+])/g, (all, a, b, c) => {
    query.page = Number(a || b || c);
    return " ";
  });
  // 「SSS以下」「未达SSS」这种粘在一起的拆开；「定数14.5」同理
  text = text.replace(/(以下|以上|未达|未到|没到|不到|未满|定数)/g, " $1 ");
  const tokens = text.split(/\s+/).filter(Boolean);
  const versionKeys = new Map(versions.map((entry) => [versionKey(entry.title), entry]));
  const findVersion = (key) => versionKeys.get(VERSION_ALIASES.get(key) || key) || null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "lv" || token === "lv.") continue;
    if (token === "定数") {
      // 「定数 14」：后面那个数就算整数也是定数
      const next = tokens[i + 1];
      if (next && /^\d{1,2}(\.\d)?$/.test(next)) { query.constant = Number(next); i++; } else query.unknown.push(token);
      continue;
    }
    if (/^\d{1,2}\.\d$/.test(token)) { query.constant = Number(token); continue; }
    const level = levelOf(token);
    if (level !== null) {
      if (/^\d+$/.test(token) && (query.level !== null || query.constant !== null)) {
        if (query.page === null) query.page = Number(token); else query.unknown.push(token);
      } else [query.level, query.bare] = [level, /^\d+$/.test(token)];
      continue;
    }
    if (LEVEL_WORDS.has(token)) {
      const index = LEVEL_WORDS.get(token);
      if (index === WORLDS_END) query.worldsEnd = true; else query.levelIndex = index;
      continue;
    }
    // 评级：「SSS 以下」「以下」跟在后面；「未达 SSS」「未达」在前面
    if (RANK_WORDS.has(token)) {
      const after = tokens[i + 1];
      const mode = BELOW.has(after) ? "below" : ABOVE.has(after) ? "above" : "exact";
      if (mode !== "exact") i++;
      query.rank = { key: RANK_WORDS.get(token), mode };
      continue;
    }
    if (BELOW.has(token) && RANK_WORDS.has(tokens[i + 1] || "")) {
      query.rank = { key: RANK_WORDS.get(tokens[i + 1]), mode: "below" };
      i++;
      continue;
    }
    // 版本名可能有好几个词（PARADISE LOST、LUMINOUS PLUS）：从这里往后拼，拼得最长的那个算
    let matched = 0;
    for (let j = tokens.length; j > i; j--) {
      const entry = findVersion(versionKey(tokens.slice(i, j).join("")));
      if (entry) { query.version = entry; matched = j - i; break; }
    }
    if (matched) { i += matched - 1; continue; }
    // 分类：可能是一个词（音击、BMS），也可能带空格（Genesis Of Destiny、流行 & 动漫）。
    // 版本名先试，分类在后面试，避免把版本名吃掉；最多往后拼 3 个词
    let tag = null;
    let tagLength = 0;
    for (let j = Math.min(tokens.length, i + 3); j > i; j--) {
      tag = tagIndex.resolve(tokens.slice(i, j).join(""));
      if (tag) { tagLength = j - i; break; }
    }
    if (tag) {
      if (query.tag) query.tagConflict = true;
      else query.tag = tag;
      i += tagLength - 1;
      continue;
    }
    query.unknown.push(token);
  }
  if (query.tag) {
    // 分类后面只允许难度和页码。光秃秃的整数一定是页码，不再当等级
    if (query.bare && query.level && query.page === null) {
      query.page = Number(query.level);
      query.level = null;
      query.bare = false;
    }
    // 等级、定数、版本、评级都不能跟分类一起写；第二个分类也算冲突
    if (query.level || query.constant !== null || query.version || query.rank) query.tagConflict = true;
  }
  return query;
}

// 条件写成一行字（图上的副标题、找不到时的回话都用）。skip 是已经写成大标题的那一样
function describe(query, skip = null, tags = null) {
  const tagIndex = tags || loadSongTags();
  const parts = [];
  if (query.level && skip !== "level") parts.push("Lv." + query.level);
  if (query.constant !== null && skip !== "constant") parts.push("定数 " + query.constant.toFixed(1));
  if (query.tag && skip !== "tag") parts.push(tagIndex.name(query.tag));
  if (query.levelIndex !== null && skip !== "levelIndex") {
    parts.push(query.tag && query.levelIndex === 3 ? "紫谱" : query.tag && query.levelIndex === 4 ? "黑谱" : LEVELS[query.levelIndex]);
  }
  if (query.version && skip !== "version") parts.push(versionLabel(query.version));
  if (query.rank) {
    const name = RANK_NAMES[query.rank.key];
    parts.push(query.rank.mode === "below" ? "未达 " + name : query.rank.mode === "above" ? name + " 以上" : "评级 " + name);
  }
  return parts.join(" · ");
}

// 大标题：等级 > 定数 > 分类 > 版本 > 难度，挑最前面有的那一样；其余条件写在下面一行
function titleOf(query, tags = null) {
  const tagIndex = tags || loadSongTags();
  let title;
  let skip;
  if (query.level) [title, skip] = [{ prefix: "Lv.", main: query.level }, "level"];
  else if (query.constant !== null) [title, skip] = [{ prefix: "定数", main: query.constant.toFixed(1) }, "constant"];
  else if (query.tag) [title, skip] = [{ prefix: "", main: tagIndex.name(query.tag) }, "tag"];
  else if (query.version) [title, skip] = [{ prefix: "", main: versionLabel(query.version) }, "version"];
  else [title, skip] = [{ prefix: "", main: LEVELS[query.levelIndex] }, "levelIndex"];
  const sub = describe(query, skip, tagIndex) || (query.tag ? "紫谱 · 黑谱" : "全谱面成绩");
  return { ...title, sub };
}

// 翻页提示里写的指令：照着 parseQuery 认得的写法拼回去。页码写成光秃秃的数要前面有等级或定数，不然会被当成等级
function commandOf(word, query, page, tags = null) {
  const tagIndex = tags || loadSongTags();
  const parts = ["/" + word];
  if (query.level) parts.push(query.level);
  if (query.constant !== null) parts.push(query.constant.toFixed(1));
  if (query.tag) parts.push(tagIndex.command(query.tag));
  if (query.levelIndex !== null) parts.push(LEVELS[query.levelIndex]);
  if (query.version) parts.push(versionLabel(query.version));
  if (query.rank) {
    const name = RANK_NAMES[query.rank.key];
    parts.push(query.rank.mode === "below" ? name + "以下" : query.rank.mode === "above" ? name + "以上" : name);
  }
  parts.push(query.tag || query.level || query.constant !== null ? String(page) : "第" + page + "页");
  return parts.join(" ");
}

// 曲库里符合等级、定数、难度、版本、分类的谱面（评级要看成绩，在 buildData 里筛）
function selectCharts(catalog, query, tags = null) {
  const tagIndex = tags || loadSongTags();
  const list = [];
  const versions = catalog.versions;
  for (const song of catalog.songs) {
    if (song.disabled || catalog.isWorldsEnd(song)) continue;
    if (query.version && versionOf(song, versions)?.version !== query.version.version) continue;
    if (query.tag && !tagIndex.has(song, query.tag)) continue;
    for (const chart of song.difficulties || []) {
      if (!(chart.difficulty >= 0 && chart.difficulty < WORLDS_END)) continue;
      // 分类列表默认只统计紫谱（MASTER）和黑谱（ULTIMA），红黄绿不放进来
      if (query.tag && chart.difficulty < 3) continue;
      if (query.levelIndex !== null && chart.difficulty !== query.levelIndex) continue;
      if (query.level && chart.level !== query.level) continue;
      if (query.constant !== null && Math.round(Number(chart.level_value) * 10) !== Math.round(query.constant * 10)) continue;
      list.push({ song, chart });
    }
  }
  return list;
}

// 挑谱面，顺带处理「/分数列表 master 2」：没写等级时光秃秃的整数先当等级（Lv.2 的 MASTER），一张都对不上、又有难度或版本撑着时，
// 改当页码再挑一次（MASTER 的第 2 页）。返回 { query, charts }，query 可能是改过的
function resolveCharts(catalog, query, tags = null) {
  const charts = selectCharts(catalog, query, tags);
  if (charts.length || !query.bare || query.page !== null || (query.levelIndex === null && !query.version)) return { query, charts };
  const retry = { ...query, level: null, bare: false, page: Number(query.level) };
  return { query: retry, charts: selectCharts(catalog, retry, tags) };
}

const keyOf = (id, levelIndex) => id + ":" + levelIndex;

function passesRank(row, rank) {
  if (!rank) return true;
  const floor = RANK_FLOORS[rank.key];
  if (rank.mode === "below") return row.score === null || row.score < floor;
  if (row.score === null) return false;
  return rank.mode === "above" ? row.score >= floor : row.rank === rank.key;
}

// charts：selectCharts 挑出来的谱面；scores：落雪的全部成绩（玩家接口 /scores）；player：落雪的玩家资料（名牌版、称号、总 Rating 用）。
// page 超出范围时按最后一页算（调用方先查过）
function buildData({ query, charts, scores, player = null, catalog, page = 1, now = new Date(), tags = null }) {
  const best = new Map();
  for (const score of scores || []) {
    if (!score || !Number.isFinite(Number(score.score))) continue;
    const key = keyOf(score.id, score.level_index);
    if (!best.has(key) || Number(score.score) > Number(best.get(key).score)) best.set(key, score);
  }
  const rows = charts.map(({ song, chart }) => {
    const mine = best.get(keyOf(song.id, chart.difficulty)) || null;
    const constant = Number(chart.level_value) > 0 ? Number(chart.level_value) : null;
    const score = mine ? Number(mine.score) : null;
    return {
      songId: song.id,
      jacketId: catalog.jacketId(song),
      jacket: null,   // 出图前换成本地 file:// 地址（attachAssets）
      title: song.title,
      levelIndex: chart.difficulty,
      level: chart.level,
      constant,
      score,
      rank: mine ? rankOf(score) : null,
      fullCombo: mine?.full_combo || null,
      clear: mine?.clear || null,
      fullChain: mine?.full_chain || null,
      // 落雪给的单曲 Rating；万一没有就按定数算（同落雪的公式）
      rating: mine ? (Number.isFinite(Number(mine.rating)) ? Number(mine.rating) : (constant ? rating(constant, score) : 0)) : null,
    };
  }).filter((row) => passesRank(row, query.rank));

  rows.sort((a, b) => {
    if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
    return (b.score ?? 0) - (a.score ?? 0) || (b.constant ?? 0) - (a.constant ?? 0) || a.songId - b.songId || b.levelIndex - a.levelIndex;
  });

  const played = rows.filter((row) => row.score !== null);
  const count = (test) => played.filter(test).length;
  const stats = {
    total: rows.length,
    played: played.length,
    ajc: count((row) => row.fullCombo === "alljusticecritical"),
    aj: count((row) => row.fullCombo === "alljustice" || row.fullCombo === "alljusticecritical"),
    fc: count((row) => Boolean(row.fullCombo)),
    sssp: count((row) => row.rank === "sssp"),
    sss: count((row) => row.rank === "sssp" || row.rank === "sss"),
  };
  const pages = pageCount(rows.length);
  const current = Math.min(Math.max(1, page), pages);
  // 前面的页固定 PER_PAGE（最后一行是满的），最后一页取到末尾（最多 MAX_PER_PAGE）
  const start = (current - 1) * PER_PAGE;
  const end = current < pages ? start + PER_PAGE : rows.length;
  const cards = rows.slice(start, end).map((row, i) => {
    const { songId: _s, ...card } = row;
    return { index: start + i + 1, ...card };
  });
  return {
    title: titleOf(query, tags),
    page: current,
    pages,
    stats,
    player: playerView(player),
    charts: cards,
    credit: "Generated by Anna Bot · 数据来自落雪查分器 · " + stamp(now),
  };
}

// 曲绘、名牌版、角色换成本地 file:// 地址。落雪素材很慢，第一次出一页可能要现下几十张，所以只在出图队列里调
async function attachAssets(data, assets) {
  const items = data.charts.map((chart) => ["jacket", chart.jacketId]);
  const targets = data.charts.map((chart) => (url) => { chart.jacket = url; });
  if (data.player.plateId !== null) {
    items.push(["plate", data.player.plateId]);
    targets.push((url) => { data.player.plate = url; });
  }
  if (data.player.characterId !== null) {
    items.push(["character", data.player.characterId]);
    targets.push((url) => { data.player.character = url; });
  }
  const urls = await assets.fileUrls(items);
  urls.forEach((url, i) => targets[i](url));
  return data;
}

module.exports = Object.assign({
  name: "level",
  // 正式名是 /分数列表；等级 / 等級 / level / lv 是旧名和简称，照旧能打
  words: ["分数列表", "等级", "等級", "level", "lv"],
  usage: "/分数列表 14+（或 /分数列表 精灵记）",
  summary: "按等级、定数或者分类（精灵记、音击、BMS……）列一批谱面，没打过的灰着排在最后；分类默认只列紫谱/黑谱，最多再加紫/黑和页码；一页 78 张。要授权。",
  panel: "按等级、定数、分类查成绩",
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    const { catalog } = ctx.services;
    const voice = ctx.voice;
    const tags = ctx.services.songTags || loadSongTags();
    const parsed = parseQuery(ctx.args, { versions: catalog.versions, tags });
    if (parsed.worldsEnd) return ctx.reply(voice.levelNoWorldsEnd);
    if (parsed.tagConflict) return ctx.reply(voice.levelTagOnly);
    if (parsed.unknown.length) return ctx.reply(voice.levelUnknown(parsed.unknown));
    if (!parsed.level && parsed.constant === null && parsed.levelIndex === null && !parsed.version && !parsed.tag) {
      return ctx.reply(parsed.rank ? voice.levelNeedMain : voice.levelUsage);
    }
    if (parsed.page !== null && parsed.page < 1) return ctx.reply(voice.levelUsage);
    // 分类只统计紫谱、黑谱；写红黄绿就没东西可列
    if (parsed.tag && parsed.levelIndex !== null && parsed.levelIndex < 3) return ctx.reply(voice.levelTagDifficulty);
    // 曲库里根本没有的等级（16、5+）直接说，不去读成绩
    const { query: wanted, charts } = resolveCharts(catalog, parsed, tags);
    if (!charts.length) return ctx.reply(voice.levelEmpty(describe(parsed, null, tags)));
    const query = wanted;
    // 不按评级筛时每张谱面都列（没打过的灰着），页数现在就知道，成绩放到出图队列里再读（先回「正在生成」）；
    // 按评级筛要先读成绩才知道剩几张：一张不剩、页码超了都得用文字回，不能等进了队列才发现
    const page = query.page || 1;
    let scores = null;
    let total = charts.length;
    if (query.rank) {
      scores = await ctx.player.scores();
      total = buildData({ query, charts, scores, catalog, tags }).stats.total;
      if (!total) return ctx.reply(voice.levelEmpty(describe(query, null, tags)));
    }
    const pages = pageCount(total);
    if (page > pages) return ctx.reply(voice.levelNoPage(pages));

    await ctx.image({
      kind: "level",
      label: "成绩列表",
      render: async () => {
        const { assets, renderer } = ctx.services;
        // 玩家资料跟成绩一起取：资料里的总 Rating、名牌版、称号要画在右上角的名片板上
        const [allScores, player] = await Promise.all([scores || ctx.player.scores(), ctx.player.player()]);
        const data = buildData({ query, charts, scores: allScores, player, catalog, page, tags });
        await attachAssets(data, assets);
        // 宽 2060（画框加五列卡片），高跟着卡片走；视口只要不比它窄。JPEG 质量 76 同其他图，倍率见 RENDER_SCALE
        const image = await renderer.render("list", data, { width: 2100, height: 1500, format: "jpeg", quality: 76, scale: RENDER_SCALE });
        const next = data.page < data.pages ? commandOf(ctx.feature.words[0], query, data.page + 1, tags) : null;
        return { buffer: image.buffer, caption: data.pages > 1 ? voice.levelPage(data.page, data.pages, next) : "" };
      },
    });
  },
}, { parseQuery, selectCharts, resolveCharts, buildData, attachAssets, describe, titleOf, commandOf, versionKey, pageCount, PER_PAGE, MAX_PER_PAGE, RENDER_SCALE });
