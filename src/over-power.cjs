"use strict";
// OVER POWER 进度：全曲 OP 按分类、版本、等级拆开，外加推荐游玩（OP 还能涨最多的谱面）和底色（レーティングポゼッション）的条件。
//
// 游戏怎么算（wikiwiki「レーティング・OVER POWER」；2026-10-23 拿作者的真成绩核过，见 CLAUDE.md「OVER POWER」）：
//   - 一张谱面的 OP 见 score-math.overPower：满的时候是 (定数 + 3) × 5
//   - 全曲、分类、版本：每首歌只算 OP 最高的那一张（BASIC～ULTIMA 都可能是它），满 OP 按这首歌最高的定数算；
//     WORLD'S END 不算。作者的号：这样加出来 39,254.18，游戏里是 39,251.97
//   - 等级：游戏里等级文件夹是例外，每张谱面各算各的。这里只算紫谱、黑谱（作者 2026-10-23：红谱混进 14 这些格子看不懂）
// 游戏的分母只算已经解锁的歌，可落雪不知道谁解锁了哪些。作者 2026-10-23 定的：一律按全部曲目已解锁算，
// 图上注明可能跟游戏里有出入（作者的号：游戏 33.98%，按全解锁算 33.41%）。
// 每张谱面都用曲库现在的定数重算，不用落雪成绩里存的 over_power：分子分母用同一套定数，改过定数的谱面也不会对不上。

const { overPower, truncate } = require("./score-math.cjs");

const MAX_LEVEL_INDEX = 4;   // ULTIMA；WORLD'S END（5）不算 OP
// 游戏里分类文件夹的顺序（POPS & ANIME、niconico、東方Project、VARIETY、イロドリミドリ、ゲキマイ、ORIGINAL），名字用落雪的
const GENRES = ["流行 & 动漫", "niconico", "东方Project", "其他游戏", "彩绿", "音击舞萌", "原创"];
// 同一张谱面的几条记录里取最好的通关标记：游戏里最高分和 FC / AJ 是分开记的，OP 也是分开加的
const LAMPS = { fullcombo: 1, alljustice: 2, alljusticecritical: 3 };
const lampRank = (fullCombo) => LAMPS[fullCombo] || 0;
const constantOf = (chart) => Number(chart?.level_value) || 0;
const maxOf = (constant) => (constant + 3) * 5;

// 底色（金底、蓝底这些）：VERSE～X-VERSE-X 的条件，国服 X-VERSE 照这套。官方没公布，是玩家总结的（wikiwiki、日本玩家的问答）：
// 四档都要 Rating 16.00 以上，全部 MASTER 和 ULTIMA 到某个评级，金以上还要全曲 OP 到某个百分比。
// 落雪的 rating_possession：normal / copper / silver / gold / platina / rainbow（copper 的条件没查到，当成还没有底色）
const POSSESSION = [
  { key: "silver", name: "银", rank: "s", score: 975000, percent: null },
  { key: "gold", name: "金", rank: "sp", score: 990000, percent: 97.5 },
  { key: "platina", name: "铂", rank: "ss", score: 1000000, percent: 99 },
  { key: "rainbow", name: "虹", rank: "sss", score: 1007500, percent: 99.5 },
];
const POSSESSION_RATING = 16;

// 每张谱面的最好成绩：分数取最高的那条，通关标记取所有记录里最好的
function bestCharts(scores) {
  const best = new Map();
  for (const row of scores || []) {
    const levelIndex = Number(row?.level_index);
    const score = Number(row?.score);
    if (!(levelIndex >= 0 && levelIndex <= MAX_LEVEL_INDEX) || !Number.isFinite(score)) continue;
    const key = row.id + ":" + levelIndex;
    const old = best.get(key);
    if (!old) {
      best.set(key, { score, fullCombo: row.full_combo || null, row });
      continue;
    }
    if (score > old.score) Object.assign(old, { score, row });
    if (lampRank(row.full_combo) > lampRank(old.fullCombo)) old.fullCombo = row.full_combo;
  }
  return best;
}

// 版本表里不超过 version 的最近一项（曲目的 version 是它第一次出现的版本号）
function folderOf(versions, version) {
  let found = null;
  for (const entry of versions) if (entry.version <= version && (!found || entry.version > found.version)) found = entry;
  return found;
}

// 每首歌一项：几张谱面各自的 OP，这首歌的 OP（最高的那张）和满 OP（最高定数）。
// 算哪些歌：曲库里除了 WORLD'S END 和标了 disabled（删掉了）的都算 —— 这就是「全部已解锁」
function songEntries({ catalog, scores }) {
  const best = bestCharts(scores);
  const entries = [];
  for (const song of catalog.songs) {
    if (song.disabled || catalog.isWorldsEnd(song)) continue;
    const charts = (song.difficulties || [])
      .filter((chart) => chart.difficulty >= 0 && chart.difficulty <= MAX_LEVEL_INDEX && constantOf(chart) > 0)
      .map((chart) => {
        const play = best.get(song.id + ":" + chart.difficulty) || null;
        const constant = constantOf(chart);
        return {
          chart,
          play,
          op: play ? overPower(constant, play.score, play.fullCombo).total : 0,
          max: maxOf(constant),
        };
      });
    if (!charts.length) continue;
    // 满 OP 看定数最高的那张（同样高时取难度高的：ULTIMA 的定数都比 MASTER 高，这只是保险）
    const top = charts.reduce((a, b) => (b.max > a.max || (b.max === a.max && b.chart.difficulty > a.chart.difficulty) ? b : a));
    // 「打过」= 拿到了 OP。被技能强制结束的记录（clear 是 failed，分数几十万甚至 0）OP 是 0，当没打过：
    // 作者的号有 24 条，不这样的话「打过、离满 OP 最远」那栏全是这种 0 分记录
    const best1 = charts.filter((item) => item.op > 0).reduce((a, b) => (!a || b.op > a.op ? b : a), null);
    entries.push({ song, charts, top, best: best1, op: best1 ? best1.op : 0, max: top.max });
  }
  return entries;
}

const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);

// 一组歌（或谱面）的合计。percent 截到两位，跟游戏一样写 33.98%；截断不四舍五入，免得 97.499 写成 97.50 被当成够了金底
function summary(items) {
  const op = sum(items, (item) => item.op);
  const max = sum(items, (item) => item.max);
  return {
    count: items.length,
    played: items.filter((item) => item.op > 0).length,
    op,
    max,
    percent: max > 0 ? truncate((op / max) * 100, 2) : 0,
  };
}

function byGenre(entries) {
  const names = [...GENRES, ...new Set(entries.map((entry) => entry.song.genre).filter((genre) => !GENRES.includes(genre)))];
  return names.map((name) => ({ name, ...summary(entries.filter((entry) => entry.song.genre === name)) }))
    .filter((group) => group.count > 0);
}

// 图上写的版本名：去掉开头的 CHUNITHM，第一代就叫 CHUNITHM（同 /分数列表、/牌子进度）。
// 第二代只剩「PLUS」看不出是哪个版本，在一整列版本名里写全「CHUNITHM PLUS」
const versionLabel = (entry) => {
  const label = /^CHUNITHM ./.test(entry.title) ? entry.title.slice(9) : entry.title;
  return label === "PLUS" ? "CHUNITHM PLUS" : label;
};

function byVersion(entries, versions) {
  const groups = new Map();
  for (const entry of entries) {
    const folder = folderOf(versions, entry.song.version);
    const key = folder ? folder.version : entry.song.version;
    if (!groups.has(key)) groups.set(key, { version: key, name: folder ? versionLabel(folder) : String(key), items: [] });
    groups.get(key).items.push(entry);
  }
  return [...groups.values()].sort((a, b) => a.version - b.version)
    .map(({ version, name, items }) => ({ version, name, ...summary(items) }));
}

// 等级：只算紫谱、黑谱，每张谱面各算各的（一首歌的紫谱、黑谱分别落在自己的等级里）。从高到低，同一个数字 + 在前
const levelOrder = (a, b) => parseFloat(b) - parseFloat(a) || (b.endsWith("+") - a.endsWith("+"));
function byLevel(entries) {
  const groups = new Map();
  for (const entry of entries) {
    for (const item of entry.charts) {
      if (item.chart.difficulty !== 3 && item.chart.difficulty !== 4) continue;
      const level = item.chart.level;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(item);
    }
  }
  return [...groups.keys()].sort(levelOrder).map((level) => ({ level, ...summary(groups.get(level)) }));
}

// 底色：现在是哪一档、下一档还差什么。评级看全部曲目的 MASTER 和 ULTIMA（没打过的也算没到）。
// 游戏里已经拿到的那档和它下面的几档一律算达成（信游戏的）：游戏只看解锁了的歌，按全解锁算可能还「差几张」，
// 图上写「金底 ✓」旁边又写「蓝底还差 72 张」就自相矛盾了
function possession({ entries, player, percent }) {
  const charts = entries.flatMap((entry) => entry.charts.filter((item) => item.chart.difficulty === 3 || item.chart.difficulty === 4));
  const current = String(player?.rating_possession || "normal");
  const rating = Number(player?.rating) || 0;
  const reached = POSSESSION.findIndex((tier) => tier.key === current);
  const tiers = POSSESSION.map((tier, index) => {
    const below = charts.filter((item) => !item.play || item.play.score < tier.score).length;
    return {
      key: tier.key,
      name: tier.name,
      rank: tier.rank,
      below,
      percent: tier.percent,
      done: index <= reached || (rating >= POSSESSION_RATING && below === 0 && (tier.percent === null || percent >= tier.percent)),
    };
  });
  return { current, rating, ratingNeeded: POSSESSION_RATING, charts: charts.length, tiers, next: tiers[reached + 1] || null };
}

// 推荐游玩（「OP 还能涨最多」）：打过的和没打过的分开排 ——
// 没打过的一首就差一整首（满 OP 七八十），混在一起列出来全是没打过的歌（作者的号：918 首没打过，前几十名全是）。
//   没打过的：按满 OP 排，画定数最高的那张。
//   打过的：在打过的几张谱面（被强制结束的也算打过，分数照写）里挑「推到满分这首歌的 OP 能涨最多」的那张，
//     按能涨多少排。画的就是这张谱面和它的真实分数（作者 2026-10-23：别写「这张没打过」，写真实分数）；
//     定数最高的那张没打过（比如只打过紫谱、黑谱没碰）时，它不在这排，算法上也只是少涨那么一点
function headroom(entries) {
  const played = [];
  for (const entry of entries) {
    if (!entry.best) continue;
    let pick = null;
    for (const item of entry.charts) {
      if (!item.play) continue;
      const gain = item.max - entry.op;
      if (gain > 1e-9 && (!pick || gain > pick.gain)) pick = { chart: item, gain };
    }
    if (pick) played.push({ ...entry, pick: pick.chart, gain: pick.gain });
  }
  played.sort((a, b) => b.gain - a.gain || b.max - a.max || a.song.id - b.song.id);
  const unplayed = entries.filter((entry) => !entry.best)
    .sort((a, b) => b.max - a.max || a.song.id - b.song.id);
  return { played, unplayed };
}

function analyze({ catalog, scores, player = null }) {
  const entries = songEntries({ catalog, scores });
  const total = summary(entries);
  return {
    entries,
    total,
    genres: byGenre(entries),
    versions: byVersion(entries, catalog.versions || []),
    levels: byLevel(entries),
    headroom: headroom(entries),
    possession: possession({ entries, player, percent: total.percent }),
  };
}

module.exports = { analyze, bestCharts, songEntries, summary, byGenre, byVersion, byLevel, possession, headroom, versionLabel, GENRES, POSSESSION };
