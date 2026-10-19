"use strict";
// /谱面分析：一张谱面的分数线、容错，和玩家在这张谱上的成绩、游玩记录曲线。主题是 themes/chart/（设计说明见它的 README）。
//
//   /谱面分析 曲名 难度          难度写在最后，不写就是 MASTER（WE 曲是 WORLD'S END）。难度词照 MiaBot 的谱面分析：
//                                绿 黄 红 紫 黑、bas adv exp mas ult、basic … ultima，再加 we
//   @某人 /谱面分析 曲名 难度    带上 TA 的成绩（走开发者接口，受对方在落雪的第三方开关管）
//
// 不绑定也能用：分数线、容错只看谱面（MiaBot 的谱面分析就只有这些），所以功能表里写 binding: "none"，有没有绑定在 run 里自己看。
// 绑定了的多一块「你的成绩」：
//   - 最好成绩：/bests?song_id=（好友码绑定也带分数），这张谱没打过就不画这块
//   - 游玩记录：score/history。授权的走玩家接口；好友码绑定（和查别人）走开发者接口，要对方开着「允许读取历史成绩」（默认关），
//     关着就在曲线的位置写一句原因，不让整张图出不来
//   - 落雪排名：score/ranking，只有玩家接口有（授权的才有）。返回前 10 名加自己那一条、同分同名次，按最好成绩认自己
// 分数线、容错、Rating、OP 的算法在 src/score-math.cjs。主题吃的数据形状见 themes/chart/examples/preview-data.json；
// buildData 是纯函数，测试和示例数据都用它。版本名（曲库的版本表）和拟合定数（src/fit-diffs.cjs 的表）也在这里算好。

const { rankOf, stamp } = require("./best.cjs");
const { attachAssets, charactersOf, MAX_CANDIDATES } = require("./song.cjs");
const { rating, overPower, unitLoss, scoreLines } = require("../score-math.cjs");
const { LEVELS, WORLDS_END } = require("../catalog.cjs");
const { V } = require("../voice.cjs");

const MASTER = 3;
// 游玩记录里低于 90 万的不画：多半是被技能强制结束的那几次（落雪自己的曲线也这么筛，作者 2026-10-17 定的提示语见主题）
const HISTORY_FLOOR = 900000;

// 难度词：照 MiaBot 的谱面分析（mia-core.cjs 的 CHART_INFO_DIFFICULTY_ALIASES），加上中二的 ULTIMA 和 WORLD'S END
const LEVEL_WORDS = new Map([
  ...["basic", "bas", "bsc", "绿", "绿谱", "緑", "緑譜"].map((word) => [word, 0]),
  ...["advanced", "adv", "黄", "黄谱", "黃", "黃譜"].map((word) => [word, 1]),
  ...["expert", "exp", "红", "红谱", "紅", "紅譜"].map((word) => [word, 2]),
  ...["master", "mas", "mst", "紫", "紫谱", "紫譜"].map((word) => [word, 3]),
  ...["ultima", "ult", "黑", "黑谱", "黒", "黒譜"].map((word) => [word, 4]),
  ...["we", "worldsend", "world'send"].map((word) => [word, WORLDS_END]),
]);

// 「曲名 难度」：最后一个词是难度词才拆出来。levelIndex 是 null 表示没写难度
function parseQuery(args) {
  const text = String(args || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const match = text.match(/^(.*\S)\s+(\S+)$/);
  const levelIndex = match ? LEVEL_WORDS.get(match[2].toLowerCase()) : undefined;
  return levelIndex === undefined ? { query: text, levelIndex: null } : { query: match[1], levelIndex };
}

// 认出来的曲子 + 要的难度 → 哪首歌的哪张谱面。WE 是单独编号的曲目（8000 起，只有 WORLD'S END 一个难度）：
//   普通曲要 WE → 找它的 WE 版（有好几个版本的让玩家挑）；WE 曲要别的难度 → 回原曲找
function pickChart(catalog, song, levelIndex) {
  const worldsEnd = catalog.isWorldsEnd(song);
  let target = song;
  let level = levelIndex ?? (worldsEnd ? WORLDS_END : MASTER);
  if (level === WORLDS_END && !worldsEnd) {
    const versions = catalog.songs.filter((other) => catalog.isWorldsEnd(other) && catalog.jacketId(other) === song.id);
    if (versions.length > 1) return { pick: versions };
    if (versions.length === 1) target = versions[0];
  } else if (level !== WORLDS_END && worldsEnd) {
    target = catalog.getSong(catalog.jacketId(song)) || song;
  }
  const chart = catalog.chart(target, level);
  if (!chart) {
    const levels = [...(target.difficulties || [])].sort((a, b) => a.difficulty - b.difficulty).map((d) => LEVELS[d.difficulty]);
    return { missing: { title: target.title, level: LEVELS[level], levels } };
  }
  return { song: target, chart };
}

// 北京时间的日子「2026-06-08」：曲线下面写日期用，主题不管时区
function beijingDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}

// 落雪按上传时间倒序给；画的时候按游玩时间（没有的用上传时间）从早到晚
function sortHistory(list) {
  const at = (score) => Date.parse(score.play_time || score.upload_time) || 0;
  return (list || []).filter((score) => Number.isFinite(Number(score?.score))).sort((a, b) => at(a) - at(b));
}

// 玩家这张谱的那块：best 是 /bests?song_id= 里这张谱的成绩；history 是 { list } 或 { error }；ranking 是排名列表（拿不到是 null）
function playerView({ best, history, ranking }, constant, { isSelf = true } = {}) {
  const score = Number(best.score);
  const op = constant ? overPower(constant, score, best.full_combo) : null;
  const number = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : null);
  const view = {
    score,
    rank: best.rank || rankOf(score),
    clear: best.clear || null,
    fullCombo: best.full_combo || null,
    fullChain: best.full_chain || null,
    // WORLD'S END 没有定数，不算 Rating、OP；落雪给了就用落雪的（跟它网页上的一样），没给自己算
    rating: constant ? number(best.rating) ?? rating(constant, score) : null,
    op: constant ? number(best.over_power) ?? op.total : null,
    opMax: constant ? op.max : null,
    ranking: (ranking || []).find((row) => Number(row?.score) === score)?.ranking ?? null,
    plays: 0,
    hidden: 0,
    history: [],
    note: null,
  };
  if (history?.error) {
    view.note = history.error.code === "privacy_history" ? V.chartHistoryPrivate(isSelf) : V.chartHistoryFailed;
    return view;
  }
  const all = sortHistory(history?.list);
  const shown = all.filter((row) => Number(row.score) >= HISTORY_FLOOR);
  Object.assign(view, {
    plays: all.length,
    hidden: all.length - shown.length,
    history: shown.map((row) => ({ score: Number(row.score), day: beijingDay(row.play_time || row.upload_time) })),
  });
  if (shown.length < 2) view.note = V.chartHistoryShort(all.length, shown.length);
  return view;
}

// song、chart：曲库里的曲目和谱面；player：loadPlayer 拿来的（没绑定、没打过是 null）；extras：song-extras.cjs；
// fitDiffs：拟合定数表（src/fit-diffs.cjs，/拟合定数b30 也用）。表里没有这张谱面就是 null，图上不写
function buildData({ song, chart, catalog, extras = null, fitDiffs = null, player = null, isSelf = true, now = new Date() }) {
  const notes = chart.notes || {};
  const constant = chart.difficulty !== WORLDS_END && Number(chart.level_value) > 0 ? Number(chart.level_value) : null;
  // 拟合定数只对普通难度有意义：WORLD'S END 没有定数，EazyChu 的表里也没有
  const fitConstant = constant && fitDiffs ? fitDiffs.get(song.id, chart.difficulty) : null;
  const view = player ? playerView(player, constant, { isSelf }) : null;
  const unit = unitLoss(notes.total);
  return {
    song: {
      id: song.id,
      title: song.title,
      artist: song.artist || "",
      bpm: song.bpm || null,
      // 「CHUNITHM CRYSTAL」写成「CRYSTAL」，跟 /单曲 一样
      version: song.version ? catalog.versionTitle(song).replace(/^CHUNITHM\s+(?=\S)/, "") : "",
      jacketId: catalog.jacketId(song),
      jacket: null,   // 出图前换成本地 file:// 地址（attachAssets）
      characters: charactersOf(song, extras, catalog),
    },
    chart: {
      levelIndex: chart.difficulty,
      level: chart.level || "",
      constant,
      fitConstant,
      designer: chart.note_designer || "",
      notes: { total: notes.total, tap: notes.tap || 0, hold: notes.hold || 0, slide: notes.slide || 0, air: notes.air || 0, flick: notes.flick || 0 },
      ...(chart.difficulty === WORLDS_END ? { kanji: chart.kanji || "", star: Number(chart.star) || 0 } : {}),
    },
    // 每个判定扣几分：JUSTICE 小，留两位；ATTACK、MISS 留一位
    unit: { justice: Math.round(unit.justice * 100) / 100, attack: Math.round(unit.attack * 10) / 10, miss: Math.round(unit.miss * 10) / 10 },
    lines: scoreLines(notes.total, constant, view ? view.score : undefined),
    player: view,
    time: stamp(now),
  };
}

// 玩家这张谱的成绩、游玩记录、排名。最好成绩拿不到（对方关了「允许读取谱面成绩」这类）照常报错，跟 /单曲 一样；
// 游玩记录、排名拿不到只是少一块，不耽误出图
async function loadPlayer(api, songId, levelIndex, { log = () => {} } = {}) {
  const scores = await api.songBests(songId);
  const best = (scores || []).filter((score) => Number(score?.level_index) === levelIndex)
    .reduce((top, score) => (!top || Number(score.score) > Number(top.score) ? score : top), null);
  if (!best) return null;
  const [history, ranking] = await Promise.all([
    api.scoreHistory(songId, levelIndex).then((list) => ({ list }), (error) => {
      if (error?.code !== "privacy_history") log("游玩记录没拿到（" + songId + "/" + levelIndex + "）：" + error.message);
      return { error };
    }),
    api.scoreRanking(songId, levelIndex).catch((error) => {
      log("落雪排名没拿到（" + songId + "/" + levelIndex + "）：" + error.message);
      return null;
    }),
  ]);
  return { best, history, ranking };
}

module.exports = Object.assign({
  name: "chart",
  words: ["谱面分析", "譜面分析", "chartinfo", "谱面"],
  usage: "/谱面分析 曲名 难度",
  summary: "一张谱面的分数线和容错；绑定了还能看到你的成绩和游玩记录。难度不写就是 MASTER。（@ 别人也看）",
  panel: "谱面分数线、容错和游玩记录",
  group: "查询",
  binding: "none",
  allowOthers: true,
  async run(ctx) {
    const { query, levelIndex } = parseQuery(ctx.args);
    if (!query) return ctx.reply(ctx.voice.chartUsage);
    const { catalog, bindings } = ctx.services;

    // 认歌放在排队前面：认不准时马上回候选，不占出图队列（同 /单曲）。
    // 最后一个词像难度、拆掉以后却认不准的，可能是曲名本身以难度词结尾（「… We」）：整句当曲名再认一次，认准了就用整句
    let found = catalog.resolve(query);
    let wanted = levelIndex;
    if (levelIndex !== null && !found.song) {
      const whole = catalog.resolve(String(ctx.args).normalize("NFKC").trim());
      if (whole.song || (!found.candidates.length && whole.candidates.length)) [found, wanted] = [whole, null];
    }
    const listOf = (songs) => songs.slice(0, MAX_CANDIDATES).map((item) => ctx.voice.songCandidate(item, catalog.isWorldsEnd(item)));
    if (!found.song) {
      if (!found.candidates.length) return ctx.reply(ctx.voice.songNotFound(query));
      const more = found.candidates.length - Math.min(found.candidates.length, MAX_CANDIDATES);
      return ctx.reply(found.fuzzy ? ctx.voice.songMaybe(query, listOf(found.candidates), more) : ctx.voice.songAmbiguous(query, listOf(found.candidates), more));
    }
    const picked = pickChart(catalog, found.song, wanted);
    if (picked.pick) return ctx.reply(ctx.voice.chartPickWorldsEnd(found.song.title, listOf(picked.pick)));
    if (picked.missing) return ctx.reply(ctx.voice.chartNoLevel(picked.missing.title, picked.missing.level, picked.missing.levels));
    const { song, chart } = picked;
    if (!(Number(chart.notes?.total) > 0)) return ctx.reply(ctx.voice.chartNoNotes(song.title));

    // 有绑定就带上成绩；@ 了没绑定的人直接说（不能悄悄只出谱面那半张，看的人会以为 TA 没打过）
    const isSelf = ctx.subject.isSelf;
    const api = bindings.player(ctx.subject.openid, { thirdParty: !isSelf });
    if (!api && !isSelf) return ctx.reply(ctx.voice.otherNotBound);

    await ctx.image({
      kind: "chart",
      label: "谱面分析图",
      render: async () => {
        const { assets, renderer, songExtras, fitDiffs } = ctx.services;
        const player = api ? await loadPlayer(api, song.id, chart.difficulty, { log: ctx.log }) : null;
        const data = buildData({ song, chart, catalog, extras: songExtras, fitDiffs, player, isSelf });
        await attachAssets(data, assets);
        // 油画纹理多，出 JPEG 质量 76（同 /b50、/单曲）：两倍图 4480×2850 左右约 1.5 MB。页面 2240 宽、高跟着内容走，视口给大一点
        const image = await renderer.render("chart", data, { width: 2300, height: 1500, format: "jpeg", quality: 76 });
        return { buffer: image.buffer };
      },
    });
  },
}, { parseQuery, pickChart, buildData, loadPlayer, playerView, beijingDay, HISTORY_FLOOR, LEVEL_WORDS });
