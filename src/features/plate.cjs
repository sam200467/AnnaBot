"use strict";
// /牌子进度：一个版本的「牌子」完成到哪了。主题是 themes/plate/（希望之巫女涅菲谢，设计说明见它的 README）。
//
//   /牌子进度             当前版本
//   /牌子进度 SUN+        SUN PLUS（版本名的写法同 /分数列表：LUMINOUS PLUS、lmn+、xv 都认；ORIGIN / 初代 / 无印 是第一代）
//
// 中二没有舞萌那种按条件拿的名牌版（落雪的名牌版 plate/list 不带条件）。带条件的是每个版本三个「称号」
// （trophy/list 里 color 为 image 的）：Spirit of <版本>（该版本 BASIC～MASTER 全部谱面 S 以上）、Tribute（全部 SSS 以上）、
// Legend（全部 ALL JUSTICE）。ULTIMA、WORLD'S END 不算。称号的曲目表跟曲库按版本分组一模一样（2026-10-18 十九个版本逐一核过），
// 所以进度直接拿曲库 + 全部成绩算，不用另外读落雪的称号进度。X-VERSE 还没有这三个称号，照样能查：统计表照算，只是没有称号图。
//
// 每首歌一张卡片，画的是 MASTER（分数、封印、通关标记、定数）。BASIC～EXPERT 的进度不画在卡片上：
// 作者 2026-10-19 把脚下那三颗小牌子去掉了（图太挤，而且牌子进度主要在 MASTER），S / SSS / AJ 的逐难度数量看右上角的统计表。
// 要分数（S、SSS 按分数算），所以跟 /分数列表 一样只收授权绑定。
// 主题吃的数据形状见 themes/plate/examples/preview-data.json；pickVersion、songsOf、buildData 是纯函数，测试和示例数据都用它们。

const { rankOf, stamp, playerView } = require("./best.cjs");
const { parseQuery } = require("./level.cjs");

// 这张图按 1.5 倍出：宽 4482 CSS 像素，2 倍、1.8 倍都超过 5 MB（量过的数见 themes/plate/README.md）
const RENDER_SCALE = 1.5;

// 每个版本三个称号在落雪的 ID：[Spirit, Tribute, Legend]。新版本出了称号再加一行（trophy/list 里搜「Spirit of 版本名」）
const TROPHIES = new Map([
  [10000, [8754, 8755, 8756]], [10500, [8757, 8758, 8759]], [11000, [8760, 8761, 8762]], [11500, [8763, 8764, 8765]],
  [12000, [8766, 8767, 8768]], [12500, [8769, 8770, 8771]], [13000, [8772, 8773, 8774]], [13500, [8775, 8776, 8777]],
  [14000, [8778, 8779, 8780]], [14500, [8781, 8782, 8783]], [15000, [8784, 8785, 8786]], [15500, [8787, 8788, 8789]],
  [20000, [8790, 8791, 8792]], [20500, [8793, 8794, 8795]], [21000, [8796, 8797, 8798]], [21500, [8799, 8800, 8801]],
  [22000, [8802, 8803, 8804]], [22500, [8805, 8806, 8807]], [23000, [9705, 9706, 9707]],
]);

const SSS = 1007500;
const S = 975000;
const AJ = new Set(["alljustice", "alljusticecritical"]);
// 三种牌子的条件，顺序就是统计表的行。称号名里的版本名：第一代叫 ORIGIN（落雪的称号就这么写）
const CONDITIONS = [
  { key: "s", label: "S", name: "Spirit", met: (play) => play.score >= S },
  { key: "sss", label: "SSS", name: "Tribute", met: (play) => play.score >= SSS },
  { key: "aj", label: "AJ", name: "Legend", met: (play) => play.aj },
];
const DIFFICULTIES = [0, 1, 2, 3];
// 左下角各等级谱面数的那几格（BASIC～MASTER 一起数），固定这几档，各版本好比
const LEVEL_COLUMNS = ["15+", "15", "14+", "14", "13+", "13"];
// 难曲那几行：MASTER 最高的三个等级，每行最多这么多张曲绘（主题里曲绘 68px，一行 10 张，多的写 +N）
const HARD_ROWS = 3;
const HARD_PER_ROW = 10;

// 图上写的版本名：去掉开头的 CHUNITHM；第一代就叫 CHUNITHM（同 /分数列表）
const versionLabel = (entry) => (/^CHUNITHM ./.test(entry.title) ? entry.title.slice(9) : entry.title);
// 称号名里的版本名：第一代是 ORIGIN、ORIGIN PLUS
const trophyVersion = (entry) => {
  const label = versionLabel(entry);
  return label === "CHUNITHM" ? "ORIGIN" : label === "PLUS" ? "ORIGIN PLUS" : label;
};

// 参数 → 版本表里的一项。空参数是当前版本；认不出来返回 { unknown: [词] }。
// 版本名交给 /分数列表 的 parseQuery 认（同一套写法和缩写），这里只先把第一代的叫法换成曲库里的「CHUNITHM」
function pickVersion(args, catalog) {
  const text = String(args || "").normalize("NFKC").trim();
  if (!text) {
    const current = catalog.currentVersion();
    return { version: catalog.versions.find((entry) => entry.version === current.version) || null };
  }
  const renamed = text.replace(/origin|初代|无印|無印/gi, " chunithm ");
  const parsed = parseQuery(renamed, { versions: catalog.versions });
  const extra = [...parsed.unknown];
  if (parsed.level) extra.push(parsed.level);
  if (parsed.constant !== null) extra.push(String(parsed.constant));
  if (parsed.page !== null) extra.push(String(parsed.page));
  if (parsed.levelIndex !== null || parsed.worldsEnd || parsed.rank) extra.push(text);
  if (!parsed.version || extra.length) return { unknown: extra.length ? [...new Set(extra)] : [text] };
  return { version: parsed.version };
}

// 这个版本的曲目（WORLD'S END 是单独的曲目，不算；曲库标了 disabled 的也不算）。曲目属于版本表里不超过它的最近一个版本
function songsOf(catalog, version) {
  const versions = [...catalog.versions].sort((a, b) => a.version - b.version);
  const next = versions.find((entry) => entry.version > version.version);
  return catalog.songs.filter((song) => !song.disabled && !catalog.isWorldsEnd(song)
    && song.version >= version.version && (!next || song.version < next.version));
}

// songs：songsOf 挑出来的曲目；scores：落雪的全部成绩（玩家接口 /scores）；player：落雪的玩家资料（名片板用）
function buildData({ version, songs, scores, player = null, catalog, now = new Date() }) {
  // 每张谱面留分数最高的那条；AJ 看所有记录（万一最高分那条不是 AJ）
  const best = new Map();
  for (const score of scores || []) {
    if (!score || !(score.level_index >= 0 && score.level_index <= 3) || !Number.isFinite(Number(score.score))) continue;
    const key = score.id + ":" + score.level_index;
    const old = best.get(key);
    const aj = AJ.has(score.full_combo) || Boolean(old && old.aj);
    if (!old || Number(score.score) > old.score) best.set(key, { score: Number(score.score), aj, raw: score });
    else old.aj = aj;
  }
  const playOf = (song, difficulty) => best.get(song.id + ":" + difficulty) || null;
  const chartOf = (song, difficulty) => (song.difficulties || []).find((chart) => chart.difficulty === difficulty) || null;

  const cards = songs.map((song) => {
    const master = chartOf(song, 3);
    const play = playOf(song, 3);
    return {
      songId: song.id,
      jacketId: catalog.jacketId ? catalog.jacketId(song) : song.id,
      title: song.title,
      levelIndex: 3,
      level: master ? master.level : "",
      constant: master ? Number(master.level_value) || null : null,
      score: play ? play.score : null,
      rank: play ? rankOf(play.score) : null,
      fullCombo: play ? (play.raw.full_combo || (play.aj ? "alljustice" : null)) : null,
      clear: play ? play.raw.clear || null : null,
      fullChain: play ? play.raw.full_chain || null : null,
    };
  });
  // MASTER 分数从高到低，没打过的排最后（按定数从高到低）
  cards.sort((a, b) => ((a.score === null) - (b.score === null)) || (b.score ?? 0) - (a.score ?? 0)
    || (b.constant ?? 0) - (a.constant ?? 0) || a.songId - b.songId);
  cards.forEach((card, i) => { card.index = i + 1; });

  // 右上角的统计表：每种牌子、每个难度达成了几首（每格各算各的，不按包含关系推）
  const table = {
    total: songs.length,
    rows: CONDITIONS.map((condition) => ({
      key: condition.key,
      label: condition.label,
      name: condition.name,
      counts: DIFFICULTIES.map((difficulty) => songs.filter((song) => {
        const play = playOf(song, difficulty);
        return play ? condition.met(play) : false;
      }).length),
    })),
  };

  // 左下角的版本总览：曲数、谱面数、各等级的谱面数、最难的几档 MASTER 的曲绘、三个称号
  const charts = songs.flatMap((song) => DIFFICULTIES.map((difficulty) => chartOf(song, difficulty)).filter(Boolean));
  const masters = songs.map((song) => ({ song, chart: chartOf(song, 3) })).filter((item) => item.chart);
  const levels = [...new Set(masters.map((item) => item.chart.level))]
    .sort((a, b) => parseFloat(b) - parseFloat(a) || (b.endsWith("+") - a.endsWith("+")));
  const hard = levels.slice(0, HARD_ROWS).map((level) => {
    const list = masters.filter((item) => item.chart.level === level)
      .sort((a, b) => Number(b.chart.level_value) - Number(a.chart.level_value) || a.song.id - b.song.id);
    return {
      level,
      count: list.length,
      jackets: list.slice(0, HARD_PER_ROW).map((item) => ({ jacketId: catalog.jacketId ? catalog.jacketId(item.song) : item.song.id, jacket: null })),
    };
  });
  const ids = TROPHIES.get(version.version) || null;
  const trophies = ids ? CONDITIONS.map((condition, i) => ({
    key: condition.key,
    label: condition.label,
    name: condition.name + " of " + trophyVersion(version),
    id: ids[i],
    image: null,
    done: songs.length > 0 && table.rows[i].counts.every((count) => count === songs.length),
  })) : [];

  return {
    version: { id: version.version, name: versionLabel(version), title: version.title },
    title: { main: versionLabel(version), sub: "牌子进度" },
    player: playerView(player),
    table,
    cards,
    overview: {
      songs: songs.length,
      charts: charts.length,
      levels: LEVEL_COLUMNS.map((level) => ({ level, count: charts.filter((chart) => chart.level === level).length })),
      hard,
      trophies,
    },
    credit: "Generated by Anna Bot · 数据来自落雪查分器 · " + stamp(now),
  };
}

// 曲绘、称号图、名牌版、角色换成本地 file:// 地址。落雪素材很慢，第一次出一个版本要现下几十张曲绘，所以只在出图队列里调
async function attachAssets(data, assets) {
  const items = [];
  const targets = [];
  const add = (kind, id, set) => { items.push([kind, id]); targets.push(set); };
  for (const card of data.cards) add("jacket", card.jacketId, (url) => { card.jacket = url; });
  for (const row of data.overview.hard) for (const item of row.jackets) add("jacket", item.jacketId, (url) => { item.jacket = url; });
  for (const trophy of data.overview.trophies) add("trophy", trophy.id, (url) => { trophy.image = url; });
  if (data.player.plateId !== null) add("plate", data.player.plateId, (url) => { data.player.plate = url; });
  if (data.player.characterId !== null) add("character", data.player.characterId, (url) => { data.player.character = url; });
  const urls = await assets.fileUrls(items);
  urls.forEach((url, i) => targets[i](url));
  return data;
}

module.exports = Object.assign({
  name: "plate",
  // 舞萌那边（MiaBot）叫 /牌子，这里两个都认
  words: ["牌子进度", "牌子", "plate"],
  usage: "/牌子进度 SUN PLUS",
  summary: "这个版本离 Spirit（全 S）、Tribute（全 SSS）、Legend（全 AJ）还差多少。要授权。",
  panel: "版本称号（牌子）的完成进度",
  group: "查询",
  binding: "oauth",
  async run(ctx) {
    const { catalog } = ctx.services;
    const voice = ctx.voice;
    const picked = pickVersion(ctx.args, catalog);
    if (!picked.version) return ctx.reply(picked.unknown ? voice.plateUnknown(picked.unknown) : voice.plateUsage);
    const version = picked.version;
    const songs = songsOf(catalog, version);
    // 版本表里会先列出还没有曲目的下一个版本（X-VERSE-X 这种）
    if (!songs.length) return ctx.reply(voice.plateNoSongs(versionLabel(version)));

    await ctx.image({
      kind: "plate",
      label: "牌子进度",
      render: async () => {
        const { assets, renderer } = ctx.services;
        // 玩家资料跟成绩一起取：资料里的总 Rating、名牌版、称号要画在左上角的名片板上
        const [scores, player] = await Promise.all([ctx.player.scores(), ctx.player.player()]);
        const data = buildData({ version, songs, scores, player, catalog });
        await attachAssets(data, assets);
        // 宽 4300 左右（画框加十列卡片），高跟着曲数走；视口只要不比它窄。JPEG 质量 76 同其他图，倍率见 RENDER_SCALE
        const options = { width: 4600, height: 2400, format: "jpeg", quality: 76, scale: RENDER_SCALE };
        let image = await renderer.render("plate", data, options);
        // 实物框和卡片纹理增加 JPEG 体积；仅超限时降低压缩质量，保持文字大小和出图分辨率。
        for (const quality of [68, 60, 52]) {
          if (image.buffer.length <= 5_000_000) break;
          image = await renderer.render("plate", data, { ...options, quality });
        }
        return { buffer: image.buffer };
      },
    });
  },
}, { pickVersion, songsOf, buildData, attachAssets, versionLabel, TROPHIES, RENDER_SCALE });
