"use strict";
// /b50、/b30：成绩图，主题是 themes/felix/（横版，小时候的朱娜·菲利克斯，2026-10-20 起）。
// 以前的竖版 themes/best/（西比拉精灵记风格）还给 /aj30、/aj50、/拟合定数b30 用，两个主题吃同一种数据。
//
//   /b50  现行 Rating 的构成：旧版本曲目的 Best 30 + 当前版本新曲的 Best 20，这 50 首单曲 Rating 的平均就是玩家 Rating。
//         直接用落雪的 /bests（bests + new_bests），好友码绑定也带分数。
//   /b30  不分新旧，全部曲目里单曲 Rating 最高的 30 首（中二节奏 2026 以前的 B30 算法）。
//         授权绑定读全部成绩来挑，一定准。好友码绑定和查别人只有 /bests，从「旧曲前 30 + 新曲前 20」里挑：
//         前 30 里的旧曲一定都在旧曲前 30 里；新曲只有超过 20 首挤进前 30 时才会漏，这时图注里说一声。
//         （/bests 还有 selections：旧曲 B30 以外、理论上能进 B30 的成绩，Rating 都比旧曲第 30 低，挑前 30 用不上。）
//
// /aj30（src/features/aj30.cjs）的整理函数也放这里：数据形状跟 /b30 一样，只是只留 AJ / AJC 的谱面、不分新旧。
// /aj50（src/features/aj50.cjs）同理，只是分新老版本、旧曲 30 + 新曲 20（跟 /b50 一样）。
// /拟合定数b30（src/features/fit30.cjs）：把官方定数换成 EazyChu 的拟合定数，重算单曲 Rating 后取前 30，不分新旧。
//
// 主题吃的数据形状见 themes/best/examples/preview-data.json（felix 的示例数据同形）。buildData 是纯函数，测试和示例数据都用它。

const { rating: singleRating, truncate } = require("../score-math.cjs");

const OLD_SLOTS = 30;
const NEW_SLOTS = 20;
// felix 的图很大（B50 约 3900×2700 CSS 像素）：按 1.5 倍出，JPEG 质量 76 约 3.5 MB；2 倍就超过作者要的 5 MB 了
const RENDER_SCALE = 1.5;
// AJ 含 AJC：AJC 是 AJ 的更严一档，/牌子进度的 Legend 也是这么算的
const AJ = new Set(["alljustice", "alljusticecritical"]);
const RANKS = [[1009000, "sssp"], [1007500, "sss"], [1005000, "ssp"], [1000000, "ss"], [990000, "sp"], [975000, "s"],
  [950000, "aaa"], [925000, "aa"], [900000, "a"], [800000, "bbb"], [700000, "bb"], [600000, "b"], [500000, "c"]];

const rankOf = (score) => (RANKS.find(([min]) => Number(score) >= min) || [0, "d"])[1];

// 同一张谱面只留最好的一条；WORLD'S END 没有 Rating，不算。按单曲 Rating 从高到低，一样高时分数高的在前。
function rankScores(scores) {
  const best = new Map();
  for (const score of scores || []) {
    if (!score || !(Number(score.level_index) >= 0 && Number(score.level_index) <= 4)) continue;
    const key = score.id + ":" + score.level_index;
    const previous = best.get(key);
    if (!previous || (score.rating || 0) > (previous.rating || 0)) best.set(key, score);
  }
  return [...best.values()].sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.score || 0) - (a.score || 0));
}

// /b30 挑哪 30 首。scores：授权绑定读到的全部成绩（没有就是 null）；bests：落雪 /bests 的结果。
function pickBest30({ scores, bests, catalog }) {
  if (scores) {
    // 落雪说 disabled 的曲目不进 Rating 构成
    const usable = scores.filter((score) => !catalog?.getSong(score.id)?.disabled);
    return { list: rankScores(usable).slice(0, OLD_SLOTS), exact: true };
  }
  const fresh = bests?.new_bests || [];
  const list = rankScores([...(bests?.bests || []), ...fresh]).slice(0, OLD_SLOTS);
  const freshIn = list.filter((score) => fresh.includes(score)).length;
  return { list, exact: !(fresh.length >= NEW_SLOTS && freshIn >= NEW_SLOTS) };
}

// /拟合定数b30：把每张谱面的官方定数换成拟合定数，重算单曲 Rating 后取前 30。
// 拟合定数可能把原本排在 50 名开外的谱面抬进来，所以一定要读全部成绩；好友码的 /bests 不够。
function pickFit30({ scores, catalog, fitConstantOf }) {
  const usable = (scores || []).filter((score) => score && !catalog?.getSong(score.id)?.disabled);
  const rated = usable.map((score) => {
    const fit = fitConstantOf ? fitConstantOf(Number(score.id), Number(score.level_index)) : null;
    if (!fit) return score;
    return { ...score, fitConstant: fit, rating: truncate(singleRating(fit, Number(score.score) || 0), 2) };
  });
  return rankScores(rated).slice(0, OLD_SLOTS);
}

// /aj30、/aj50 共用的筛选：全部成绩里 FULL COMBO 是 AJ / AJC 的谱面。
// 跟 B30 一样，落雪标了 disabled 的曲目不算；WE 没有 Rating，rankScores 会滤掉。
function ajScores(scores, catalog) {
  return (scores || []).filter((score) =>
    score && AJ.has(score.full_combo) && !catalog?.getSong(score.id)?.disabled);
}

// /aj30 挑哪些：AJ 谱面不分新旧，按单曲 Rating 取前 30。
function pickAj30({ scores, catalog }) {
  return rankScores(ajScores(scores, catalog)).slice(0, OLD_SLOTS);
}

// 新曲的判定跟着落雪走：new_bests 里最老的那个版本往后都算新曲；落雪没给新曲时退回曲库的最新版本。
function newVersionFloor(bests, catalog) {
  const versions = (bests?.new_bests || []).map((score) => catalog.getSong(score.id)?.version).filter(Number.isFinite);
  return versions.length ? Math.min(...versions) : catalog.currentVersion().version;
}

const isNewVersion = (song, floor) => Boolean(song && floor !== null && song.version >= floor);

// /aj50 挑哪些：AJ 谱面里分新老版本，旧曲取前 30、新曲取前 20（跟 /b50 的两栏一样）。
// floor 用 /bests 的 new_bests 算，查不到就退回当前版本，所以这个功能要顺手读一下 /bests。
function pickAj50({ scores, bests, catalog }) {
  const floor = newVersionFloor(bests, catalog);
  const usable = ajScores(scores, catalog);
  const split = (fresh) => usable.filter((score) => isNewVersion(catalog?.getSong(score.id), floor) === fresh);
  return {
    old: rankScores(split(false)).slice(0, OLD_SLOTS),
    fresh: rankScores(split(true)).slice(0, NEW_SLOTS),
  };
}

function scoreView(score, { catalog, floor, fit, fitConstantOf }) {
  const song = catalog.getSong(score.id);
  const chart = song ? catalog.chart(song, score.level_index) : null;
  const officialConstant = Number.isFinite(chart?.level_value) && chart.level_value > 0 ? chart.level_value : null;
  // fit30 的 rating 在 pickFit30 里已经按拟合定数算好；没拟合定数的谱面退回官方定数和原来的 rating
  const fitConstant = fit && fitConstantOf
    ? (Number(score.fitConstant || fitConstantOf(Number(score.id), Number(score.level_index))) || null)
    : null;
  const view = {
    id: score.id,
    title: score.song_name || song?.title || "曲目 " + score.id,
    levelIndex: Number(score.level_index),
    level: score.level || chart?.level || "",
    constant: fit ? (fitConstant || officialConstant) : officialConstant,
    score: Number(score.score) || 0,
    rating: Number(score.rating) || 0,
    rank: score.rank || rankOf(score.score),
    clear: score.clear || null,
    fullCombo: score.full_combo || null,
    fullChain: score.full_chain || null,
    isNew: fit ? false : isNewVersion(song, floor),
    jacketId: song ? catalog.jacketId(song) : Number(score.id),
    jacket: null,   // 出图前换成本地 file:// 地址（attachAssets）
  };
  if (fit) {
    view.constantText = fitConstant ? "≈" + fitConstant.toFixed(2) : null;
    view.officialConstant = officialConstant;
    view.fitted = Boolean(fitConstant);
  }
  return view;
}

const sumOf = (list) => list.reduce((total, score) => total + (Number(score.rating) || 0), 0);

// 一栏成绩：平均按空位数算（没打满的位置算 0，跟 Rating 的算法一致）。
// 以前还有「地板」（最后一位的 Rating），图上跟均值写在章节名右边，作者嫌跟页眉的格子重复，2026-10-16 删了
function chapter(key, list, slots, options) {
  return {
    key,
    slots,
    average: sumOf(list) / slots,
    scores: list.map((score) => scoreView(score, options)),
  };
}

function playerView(player) {
  return {
    name: player?.name || "",
    level: Number.isFinite(player?.level) ? player.level : null,
    reborn: Number(player?.reborn_count) || 0,
    rating: Number(player?.rating) || 0,
    trophy: player?.trophy?.name ? { name: player.trophy.name, color: player.trophy.color || "normal" } : null,
    // 段位（CLASS 勋章）：base 是缎带（通关整个组别），medal 是勋章（通关任意一组），0 是没有；1～6 对应 I～V、∞。
    // 图标不在落雪的素材服务器上，主题直接读 themes/shared/icons/class_emblem/
    classEmblem: { base: Number(player?.class_emblem?.base) || 0, medal: Number(player?.class_emblem?.medal) || 0 },
    plateId: player?.name_plate?.id ?? null,
    characterId: player?.character?.id ?? null,
    plate: null,
    character: null,
  };
}

// 2026-10-14 08:05（北京时间）
function stamp(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day + " " + parts.hour + ":" + parts.minute;
}

// mode：b50 | b30 | aj30 | aj50 | fit30。scores 只有授权绑定才有（aj30 / aj50 / fit30 一定要）。
// fit30 的 fitConstantOf(songId, levelIndex) 由 /拟合定数b30 传进来（src/fit-diffs.cjs 的表）。
function buildData({ mode, player, bests, scores = null, catalog, now = new Date(), fitConstantOf = null }) {
  const fit = mode === "fit30";
  const floor = fit ? null : newVersionFloor(bests, catalog);
  const options = { catalog, floor, fit, fitConstantOf };
  let chapters;
  let rating;
  let exact = true;
  if (mode === "b50") {
    const old = rankScores(bests?.bests).slice(0, OLD_SLOTS);
    const fresh = rankScores(bests?.new_bests).slice(0, NEW_SLOTS);
    chapters = [chapter("old", old, OLD_SLOTS, options), chapter("new", fresh, NEW_SLOTS, options)];
    rating = (sumOf(old) + sumOf(fresh)) / (OLD_SLOTS + NEW_SLOTS);
  } else if (mode === "aj50") {
    // 分新旧两栏、只留 AJ 谱面：旧曲 30 个位置、新曲 20 个位置，均值按 50 算
    const picked = pickAj50({ scores, bests, catalog });
    chapters = [chapter("old", picked.old, OLD_SLOTS, options), chapter("new", picked.fresh, NEW_SLOTS, options)];
    rating = (sumOf(picked.old) + sumOf(picked.fresh)) / (OLD_SLOTS + NEW_SLOTS);
  } else if (mode === "aj30") {
    // 只认授权读到的全部成绩：只从 /bests 的前 50 首里挑会漏掉排名更低的 AJ 谱面
    const picked = pickAj30({ scores, catalog });
    chapters = [chapter("aj", picked, OLD_SLOTS, options)];
    rating = chapters[0].average;
  } else if (fit) {
    // 拟合定数会改变排名，必须从全部成绩里挑；只读 /bests 的前 50 首会漏
    const picked = pickFit30({ scores, catalog, fitConstantOf });
    chapters = [chapter("fit", picked, OLD_SLOTS, options)];
    rating = chapters[0].average;
  } else {
    const picked = pickBest30({ scores, bests, catalog });
    chapters = [chapter("all", picked.list, OLD_SLOTS, options)];
    rating = chapters[0].average;
    exact = picked.exact;
  }
  const data = { mode, player: playerView(player), chapters, rating, exact, time: stamp(now) };
  if (fit) {
    const picked = chapters[0].scores;
    const missing = picked.filter((score) => !score.fitted).length;
    // 页眉第三格要跟 /b30 的「Best 30」对得上：官方定数下全部成绩的前 30 首均值，不是玩家总 Rating（B50）
    const official = pickBest30({ scores, catalog }).list;
    data.fit = { fitted: picked.length - missing, missing, officialAverage: sumOf(official) / OLD_SLOTS };
  }
  return data;
}

// 曲绘、名牌版、角色换成本地 file:// 地址。落雪素材很慢，第一次出 B50 可能要现下几十张，所以只在出图队列里调。
async function attachAssets(data, assets) {
  const items = [];
  const targets = [];
  for (const chapterData of data.chapters) {
    for (const score of chapterData.scores) {
      items.push(["jacket", score.jacketId]);
      targets.push((url) => { score.jacket = url; });
    }
  }
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

function feature(mode) {
  const isB50 = mode === "b50";
  return {
    name: mode,
    words: isB50 ? ["b50", "best50"] : ["b30", "best30"],
    usage: "/" + mode,
    summary: isB50 ? "旧曲 B30 + 新曲 N20 的成绩图，你的 Rating 就是从这儿来的。（@ 别人也看）"
      : "不分新旧，单曲 Rating 最高的 30 首。（@ 别人也看）",
    panel: isB50 ? "旧曲 30 + 新曲 20 的成绩图" : "不分新旧的 B30 成绩图",
    group: "查询",
    binding: "any",
    allowOthers: true,
    async run(ctx) {
      await ctx.image({
        kind: mode,
        label: isB50 ? "B50 成绩图" : "B30 成绩图",
        render: async () => {
          const { assets, catalog, renderer } = ctx.services;
          // /b30 有授权就读全部成绩挑（准）；/bests 照样要，用来判断哪些算新曲
          const full = !isB50 && ctx.player.hasFullScores;
          const [player, bests, scores] = await Promise.all([
            ctx.player.player(), ctx.player.bests(), full ? ctx.player.scores() : null,
          ]);
          const data = buildData({ mode, player, bests, scores, catalog });
          await attachAssets(data, assets);
          // 纹理多，出 JPEG（质量 76 同其他图）。尺寸以主题量出来的为准（B50 宽约 3900、/b30 约 3500 CSS 像素，
          // 画框里的画面照油画的比例），视口只要别太窄。曲绘花哨的号可能更大，超过 5 MB 就在同一页面降质量重新截
          const image = await renderer.render("felix", data, {
            width: 3400, height: 1200, format: "jpeg", quality: 76, scale: RENDER_SCALE,
            maxBytes: 5_000_000, fallbackQualities: [70, 64],
          });
          const caption = data.exact ? "" : ctx.voice.bestMaybeIncomplete(ctx.subject.isSelf && Boolean(ctx.services.bindings?.oauthEnabled));
          return { buffer: image.buffer, caption };
        },
      });
    },
  };
}

// 功能清单（index.cjs 里展开）只认数组里的两个功能；整理数据的函数挂在数组上，给测试和示例数据用。
module.exports = Object.assign([feature("b50"), feature("b30")], {
  buildData, attachAssets, pickBest30, pickAj30, pickAj50, pickFit30, rankScores, rankOf, stamp, playerView, newVersionFloor,
  OLD_SLOTS, NEW_SLOTS, RENDER_SCALE,
});
