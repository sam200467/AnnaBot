"use strict";
// /b50、/b30：成绩图，主题是 themes/best/（西比拉精灵记风格）。
//
//   /b50  现行 Rating 的构成：旧版本曲目的 Best 30 + 当前版本新曲的 Best 20，这 50 首单曲 Rating 的平均就是玩家 Rating。
//         直接用落雪的 /bests（bests + new_bests），好友码绑定也带分数。
//   /b30  不分新旧，全部曲目里单曲 Rating 最高的 30 首（中二节奏 2026 以前的 B30 算法）。
//         授权绑定读全部成绩来挑，一定准。好友码绑定和查别人只有 /bests，从「旧曲前 30 + 新曲前 20」里挑：
//         前 30 里的旧曲一定都在旧曲前 30 里；新曲只有超过 20 首挤进前 30 时才会漏，这时图注里说一声。
//         （/bests 还有 selections：旧曲 B30 以外、理论上能进 B30 的成绩，Rating 都比旧曲第 30 低，挑前 30 用不上。）
//
// /aj30（src/features/aj30.cjs）的整理函数也放这里：数据形状跟 /b30 一样，只是只留 AJ / AJC 的谱面、不分新旧。
//
// 主题吃的数据形状见 themes/best/examples/preview-data.json。buildData 是纯函数，测试和示例数据都用它。

const OLD_SLOTS = 30;
const NEW_SLOTS = 20;
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

// /aj30 挑哪些：全部成绩里 FULL COMBO 是 AJ / AJC 的谱面，不分新旧，按单曲 Rating 取前 30。
// 跟 B30 一样，落雪标了 disabled 的曲目不算；WE 没有 Rating，rankScores 会滤掉。
function pickAj30({ scores, catalog }) {
  const usable = (scores || []).filter((score) =>
    score && AJ.has(score.full_combo) && !catalog?.getSong(score.id)?.disabled);
  return rankScores(usable).slice(0, OLD_SLOTS);
}

// 新曲的判定跟着落雪走：new_bests 里最老的那个版本往后都算新曲；落雪没给新曲时退回曲库的最新版本。
function newVersionFloor(bests, catalog) {
  const versions = (bests?.new_bests || []).map((score) => catalog.getSong(score.id)?.version).filter(Number.isFinite);
  return versions.length ? Math.min(...versions) : catalog.currentVersion().version;
}

function scoreView(score, { catalog, floor }) {
  const song = catalog.getSong(score.id);
  const chart = song ? catalog.chart(song, score.level_index) : null;
  return {
    id: score.id,
    title: score.song_name || song?.title || "曲目 " + score.id,
    levelIndex: Number(score.level_index),
    level: score.level || chart?.level || "",
    constant: Number.isFinite(chart?.level_value) && chart.level_value > 0 ? chart.level_value : null,
    score: Number(score.score) || 0,
    rating: Number(score.rating) || 0,
    rank: score.rank || rankOf(score.score),
    clear: score.clear || null,
    fullCombo: score.full_combo || null,
    fullChain: score.full_chain || null,
    isNew: Boolean(song && floor !== null && song.version >= floor),
    jacketId: song ? catalog.jacketId(song) : Number(score.id),
    jacket: null,   // 出图前换成本地 file:// 地址（attachAssets）
  };
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

// mode：b50 | b30。scores 只有 /b30 的授权绑定才有。
function buildData({ mode, player, bests, scores = null, catalog, now = new Date() }) {
  const floor = newVersionFloor(bests, catalog);
  const options = { catalog, floor };
  let chapters;
  let rating;
  let exact = true;
  if (mode === "b50") {
    const old = rankScores(bests?.bests).slice(0, OLD_SLOTS);
    const fresh = rankScores(bests?.new_bests).slice(0, NEW_SLOTS);
    chapters = [chapter("old", old, OLD_SLOTS, options), chapter("new", fresh, NEW_SLOTS, options)];
    rating = (sumOf(old) + sumOf(fresh)) / (OLD_SLOTS + NEW_SLOTS);
  } else if (mode === "aj30") {
    // 只认授权读到的全部成绩：只从 /bests 的前 50 首里挑会漏掉排名更低的 AJ 谱面
    const picked = pickAj30({ scores, catalog });
    chapters = [chapter("aj", picked, OLD_SLOTS, options)];
    rating = chapters[0].average;
  } else {
    const picked = pickBest30({ scores, bests, catalog });
    chapters = [chapter("all", picked.list, OLD_SLOTS, options)];
    rating = chapters[0].average;
    exact = picked.exact;
  }
  return { mode, player: playerView(player), chapters, rating, exact, time: stamp(now) };
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
    summary: isB50 ? "成绩图：旧曲 B30 + 新曲 N20，也就是 Rating 的构成（@ 别人看 TA 的）"
      : "成绩图：不分新旧，单曲 Rating 最高的 30 首（@ 别人看 TA 的）",
    panel: isB50 ? "旧曲 B30 + 新曲 N20 成绩图" : "不分新旧的 B30 成绩图",
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
          // 纹理多，PNG 要十几 MB。JPEG 质量 76：卡片加宽以后 B50 约 4 MB（82 是 4.7 MB，作者要 5 MB 以内，曲绘花哨的号还会更大），放大看也没有明显的压缩痕迹
          // 宽度以主题量出来的为准（画框加上内容约 2040 CSS 像素），这里的视口只要不比它窄
          const image = await renderer.render("best", data, { width: 2100, height: 1000, format: "jpeg", quality: 76 });
          const caption = data.exact ? "" : ctx.voice.bestMaybeIncomplete(ctx.subject.isSelf && Boolean(ctx.services.bindings?.oauthEnabled));
          return { buffer: image.buffer, caption };
        },
      });
    },
  };
}

// 功能清单（index.cjs 里展开）只认数组里的两个功能；整理数据的函数挂在数组上，给测试和示例数据用。
module.exports = Object.assign([feature("b50"), feature("b30")], {
  buildData, attachAssets, pickBest30, pickAj30, rankScores, rankOf, stamp, playerView, OLD_SLOTS, NEW_SLOTS,
});
