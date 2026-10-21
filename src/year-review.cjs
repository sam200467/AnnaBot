"use strict";
// 年度总结：把落雪 user/chunithm/player/year-in-review/{year} 的数据整理成 themes/year 要的样子。
//
// 落雪这些数都是「上传记录」的条数，不是游玩次数：一首歌一年里上传过几次成绩就算几次；
// 评级、FC、难度分布也是按上传的成绩记录数，每种分布加起来都等于上传总数（2026-10-21 拿真数据核过）。
// 图上一律写「上传」，不写「游玩」。
//
// 字段（落雪前端 src/pages/public/YearInReview.tsx 的 YearInReviewProps，加真数据里多出来的 generate_time）：
//   player_total_uploads        { 版本号: 条数 }，10000 是 NEW 以前的全部版本
//   player_upload_days          有上传的天数
//   player_most_uploaded_songs  { 曲目 ID: 条数 }，最多 10 首
//   player_most_uploaded_song   { latest_version: 当前版本新曲里上传最多的曲目 ID（0 = 没有）, all_version }
//   player_monthly_uploads      { 1..12: 条数 }
//   player_song_timeline        { 1..12: [当月上传最多的曲目 ID，最多 3 首] }，没上传的月份是空数组
//   rank_distribute             { d … sssp: 条数 }，互斥（每条记录只算它自己的评级）
//   full_combo_distribute       { fullcombo / alljustice / alljusticecritical: 条数 }，互斥
//   difficulty_distribute       { "14" / "14+" …: 条数 }
//   rating_growth               { earliest_bests, latest_bests }：年内第一次、最后一次上传时的 bests（同 /bests 的形状）
// 2025 年起才有后面这几项分布和 rating_growth；2024 的数据没有，图上那几块就不画。

const OLD_SLOTS = 30;
const NEW_SLOTS = 20;

// 评级从低到高；图上按包含关系数（SSS 含 SSS+，SS 含 SS+ 以上……），跟 /分数列表 的统计格一样
const RANK_ORDER = ["d", "c", "b", "bb", "bbb", "a", "aa", "aaa", "s", "sp", "ss", "ssp", "sss", "sssp"];
const RANK_CELLS = [["SSS+", "sssp"], ["SSS", "sss"], ["SS", "ss"], ["S", "s"]];

const sum = (list) => list.reduce((acc, value) => acc + (Number(value) || 0), 0);
const byRating = (a, b) => (Number(b?.rating) || 0) - (Number(a?.rating) || 0);

// 年内某次快照的 Rating。VERSE 以后是旧曲 B30 + 新曲 N20 的平均；落雪 2025 年存下来的快照里
// new_bests 是空的（国服那时还没换算法），落雪前端这时按 (B30 + 最高一首 × 10) / 40 算（旧算法：
// Best 30 + Recent 10，Recent 拿最高那首顶）。照它算，标上 legacy，图上注明是旧算法。
function snapshotRating(bests, year) {
  const old = [...(bests?.bests || [])].sort(byRating).slice(0, OLD_SLOTS);
  const fresh = [...(bests?.new_bests || [])].sort(byRating).slice(0, NEW_SLOTS);
  if (!old.length && !fresh.length) return null;
  if (!fresh.length && year <= 2025) {
    return { value: (sum(old.map((s) => s.rating)) + (Number(old[0]?.rating) || 0) * 10) / 40, legacy: true };
  }
  return { value: (sum(old.map((s) => s.rating)) + sum(fresh.map((s) => s.rating))) / (OLD_SLOTS + NEW_SLOTS), legacy: false };
}

function ratingGrowth(growth, year) {
  const start = snapshotRating(growth?.earliest_bests, year);
  const end = snapshotRating(growth?.latest_bests, year);
  if (!start || !end) return null;
  return { start: start.value, end: end.value, gain: end.value - start.value, legacy: start.legacy || end.legacy };
}

function inclusiveRanks(dist) {
  if (!dist || typeof dist !== "object") return null;
  const count = (key) => sum(RANK_ORDER.slice(RANK_ORDER.indexOf(key)).map((k) => dist[k]));
  return RANK_CELLS.map(([label, key]) => ({ label, key, count: count(key) }));
}

// FC 含 AJ、AJ 含 AJC；AJC 是 0 就不列
function inclusiveMarks(dist) {
  if (!dist || typeof dist !== "object") return null;
  const ajc = Number(dist.alljusticecritical) || 0;
  const aj = ajc + (Number(dist.alljustice) || 0);
  const fc = aj + (Number(dist.fullcombo) || 0);
  return [{ label: "FC", kind: "fc", count: fc }, { label: "AJ", kind: "aj", count: aj },
    ...(ajc ? [{ label: "AJC", kind: "ajc", count: ajc }] : [])];
}

// 难度按定数档从低到高：14 < 14+ < 15
const levelKey = (level) => parseFloat(level) + (String(level).endsWith("+") ? 0.5 : 0);
function levelRows(dist) {
  if (!dist || typeof dist !== "object") return null;
  return Object.entries(dist)
    .map(([level, count]) => ({ level, count: Number(count) || 0 }))
    .filter((row) => row.count > 0 && Number.isFinite(levelKey(row.level)))
    .sort((a, b) => levelKey(a.level) - levelKey(b.level));
}

function songView(catalog, id) {
  const song = catalog.getSong(id);
  return { id: Number(id), title: song?.title || "曲目 " + id, jacketId: song ? catalog.jacketId(song) : Number(id), jacket: null };
}

// 2026-10-21 19:07（北京时间）
function beijingTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day + " " + parts.hour + ":" + parts.minute;
}

// 这一年一共上传了多少条（player_total_uploads 按版本分，加起来）
const totalUploads = (review) => sum(Object.values(review?.player_total_uploads || {}));

// review：落雪返回的 data；player：playerView（名片板），没有就不画
function buildYearView({ review, catalog, player = null, example = false }) {
  const year = Number(review.year);
  // 排行照落雪前端：条数多的在前，同样多的按曲目 ID 从小到大（Object.entries 对数字键本来就是这个顺序）
  const top = Object.entries(review.player_most_uploaded_songs || {})
    .map(([id, count]) => ({ id: Number(id), count: Number(count) || 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.id - b.id)
    .slice(0, 10)
    .map((row, i) => ({ rank: i + 1, count: row.count, ...songView(catalog, row.id) }));
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const ids = review.player_song_timeline?.[month] || [];
    return { month, count: Number(review.player_monthly_uploads?.[month]) || 0, songs: ids.slice(0, 3).map((id) => songView(catalog, id)) };
  });
  const newest = Number(review.player_most_uploaded_song?.latest_version) || 0;
  return {
    year,
    example,
    generatedAt: beijingTime(review.generate_time),
    player,
    uploads: totalUploads(review),
    days: Number(review.player_upload_days) || 0,
    rating: ratingGrowth(review.rating_growth, year),
    top,
    months,
    activeMonths: months.filter((m) => m.count > 0).length,
    ranks: inclusiveRanks(review.rank_distribute),
    marks: inclusiveMarks(review.full_combo_distribute),
    levels: levelRows(review.difficulty_distribute),
    newest: newest ? songView(catalog, newest) : null,
  };
}

// 曲绘、名牌版、角色头像换成本地 file:// 地址（落雪素材慢，只在出图队列里做）
async function attachYearAssets(data, assets) {
  const items = [];
  const targets = [];
  const songs = [...data.top, ...data.months.flatMap((m) => m.songs), ...(data.newest ? [data.newest] : [])];
  for (const song of songs) {
    items.push(["jacket", song.jacketId]);
    targets.push((url) => { song.jacket = url; });
  }
  if (data.player?.plateId != null) {
    items.push(["plate", data.player.plateId]);
    targets.push((url) => { data.player.plate = url; });
  }
  if (data.player?.characterId != null) {
    items.push(["character", data.player.characterId]);
    targets.push((url) => { data.player.character = url; });
  }
  const urls = await assets.fileUrls(items);
  urls.forEach((url, i) => targets[i](url));
  return data;
}

module.exports = { buildYearView, attachYearAssets, totalUploads, snapshotRating, ratingGrowth, inclusiveRanks, inclusiveMarks, levelRows };
