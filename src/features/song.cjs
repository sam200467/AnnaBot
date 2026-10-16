"use strict";
// /单曲：一首歌各难度的成绩图，主题是 themes/song/（西比拉精灵记风格：油画背景加火之巫女的立绘，设计说明见它的 README）。
//
//   /单曲 曲名          曲名写一部分、别名、ID（id850）都行；认不准时列出候选，让玩家用 ID 再发一次
//   @某人 /单曲 曲名     看别人的（走开发者接口，受对方在落雪的「允许第三方读取」开关管）
//
// 成绩用落雪的 /bests?song_id=：这首歌所有谱面的最好成绩，好友码绑定也带分数（不用授权）。
// 曲目信息来自曲库（物量要曲库带 notes 拉，见 catalog.cjs）；日服上线日期和原创曲的对应角色来自 song-extras.cjs。
// 主题吃的数据形状见 themes/song/examples/preview-data.json。buildData 是纯函数，测试和示例数据都用它。

const { rankOf, stamp } = require("./best.cjs");

const WORLDS_END = 5;
const MAX_CANDIDATES = 8;

// 同一张谱面有好几条时留分数最高的
function bestByLevel(scores) {
  const best = new Map();
  for (const score of scores || []) {
    const level = Number(score?.level_index);
    if (!Number.isInteger(level)) continue;
    const previous = best.get(level);
    if (!previous || (Number(score.score) || 0) > (Number(previous.score) || 0)) best.set(level, score);
  }
  return best;
}

// 对应角色：只有原创曲有，WE 版用原曲的。好几个时先挑落雪认得的（有头像），都不认得就取第一个、只写名字
function characterOf(song, extras, catalog) {
  const own = extras?.get(song.id)?.characters;
  const origin = catalog.isWorldsEnd(song) ? extras?.get(catalog.jacketId(song))?.characters : null;
  const list = (own?.length ? own : origin) || [];
  const pick = list.find((chara) => Number.isInteger(chara.id)) || list[0];
  return pick ? { name: pick.name, id: Number.isInteger(pick.id) ? pick.id : null, icon: null } : null;
}

function chartView(chart, score) {
  const view = {
    levelIndex: chart.difficulty,
    level: chart.level || "",
    constant: Number(chart.level_value) > 0 ? Number(chart.level_value) : null,
    designer: chart.note_designer || "",
    notes: Number(chart.notes?.total) || null,
    score: null,   // 没打过
  };
  if (chart.difficulty === WORLDS_END) Object.assign(view, { kanji: chart.kanji || "", star: Number(chart.star) || 0 });
  if (score && Number.isFinite(Number(score.score))) {
    Object.assign(view, {
      score: Number(score.score),
      rank: score.rank || rankOf(score.score),
      clear: score.clear || null,
      fullCombo: score.full_combo || null,
      fullChain: score.full_chain || null,
      rating: Number(score.rating) || 0,
    });
  }
  return view;
}

// song：曲库里的曲目；scores：落雪 /bests?song_id= 的结果；extras：song-extras.cjs；playerName：图底下写这是谁的成绩
function buildData({ song, scores, catalog, extras = null, playerName = "", now = new Date() }) {
  const byLevel = bestByLevel(scores);
  const charts = [...(song.difficulties || [])]
    .sort((a, b) => a.difficulty - b.difficulty)
    .map((chart) => chartView(chart, byLevel.get(chart.difficulty)));
  return {
    song: {
      id: song.id,
      title: song.title,
      artist: song.artist || "",
      genre: song.genre || "",
      bpm: song.bpm || null,
      // 「CHUNITHM CRYSTAL」写成「CRYSTAL」，格子窄；无印就是「CHUNITHM」
      version: catalog.versionTitle(song).replace(/^CHUNITHM\s+(?=\S)/, ""),
      releaseJP: extras?.get(song.id)?.releaseJP || null,
      jacketId: catalog.jacketId(song),
      jacket: null,   // 出图前换成本地 file:// 地址（attachAssets）
      character: characterOf(song, extras, catalog),
    },
    charts,
    player: playerName,
    time: stamp(now),
  };
}

// 曲绘、角色头像换成本地 file:// 地址（落雪素材慢，只在出图队列里调）
async function attachAssets(data, assets) {
  const character = data.song.character;
  const items = [["jacket", data.song.jacketId]];
  if (Number.isInteger(character?.id)) items.push(["character", character.id]);
  const [jacket, icon] = await assets.fileUrls(items);
  data.song.jacket = jacket;
  if (Number.isInteger(character?.id)) character.icon = icon;
  return data;
}

module.exports = Object.assign({
  name: "song",
  words: ["单曲", "song"],
  usage: "/单曲 曲名",
  summary: "一首歌各难度的成绩，曲名写一部分、别名或 ID 都行（@ 别人看 TA 的）",
  panel: "一首歌各难度的成绩",
  group: "查询",
  binding: "any",
  allowOthers: true,
  async run(ctx) {
    const query = ctx.args.trim();
    if (!query) return ctx.reply(ctx.voice.songUsage);
    const { catalog } = ctx.services;
    // 认歌放在排队前面：认不准时马上回候选，不占出图队列
    const { song, candidates, fuzzy } = catalog.resolve(query);
    if (!song) {
      if (!candidates.length) return ctx.reply(ctx.voice.songNotFound(query));
      const shown = candidates.slice(0, MAX_CANDIDATES);
      const lines = shown.map((item) => ctx.voice.songCandidate(item, catalog.isWorldsEnd(item)));
      const more = candidates.length - shown.length;
      return ctx.reply(fuzzy ? ctx.voice.songMaybe(query, lines, more) : ctx.voice.songAmbiguous(query, lines, more));
    }
    await ctx.image({
      kind: "song",
      label: "单曲成绩图",
      render: async () => {
        const { assets, renderer, songExtras } = ctx.services;
        const scores = await ctx.player.songBests(song.id);
        const data = buildData({ song, scores, catalog, extras: songExtras, playerName: ctx.player.playerName });
        await attachAssets(data, assets);
        // 油画纹理多，跟 /b50 一样出 JPEG 质量 76：两倍图 4080×2712 约 1.3 MB。页面 2040×1356，视口给大一点
        const image = await renderer.render("song", data, { width: 2100, height: 1400, format: "jpeg", quality: 76 });
        return { buffer: image.buffer };
      },
    });
  },
}, { buildData, attachAssets, MAX_CANDIDATES });
