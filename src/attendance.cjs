"use strict";
// /出勤记录 的数据层：落雪的 Recent 50 切成一场一场（一场就是一次出勤），取最近一场，同一张谱面合成一行；
// heatmap 画成近一年的日历。
//
// 两份数据（2026-10-22 拿作者的真数据核过）：
//   - Recent 50（开发者接口 /recents）：最近 50 次游玩，每条有 play_time（UTC，精确到分钟）和 upload_time
//     （哪次同步传上来的）。被技能强制结束的（clear 是 failed、分数很低）也在里面。
//     同一场里相邻两首差 1～5 分钟，两场之间差好几个小时，所以按「相邻两次隔了 2 小时以上」切场 ——
//     排卡排上一个多小时也还算同一场。
//   - heatmap（玩家接口 user/chunithm/player/heatmap）：{ "YYYY-MM-DD": 那天传上去的游玩条数 }。
//     记的是同步那天，不是打歌那天：10/16 打的两场（3 + 17 首）第二天才同步，heatmap 就在 10/17 记了 20 条。
//     日历照实画、标明「按同步那天」，不拿 Recent 50 去改：50 条以外的日子改不了，改一半更乱。
//     日期键当北京时间的日子（落雪是国内的站；实测的几次同步都不跨零点，没法分辨，按北京时间最说得通）。
//
// 新纪录：/scores 里这张谱面现在的最好成绩是这场打出来的 —— 分数等于这场的最高分，upload_time 跟打出它的那次游玩
// 是同一次同步（相差 15 秒以内；同一次同步的成绩最多差两三秒）。最好成绩的 upload_time 只在成绩变好时才变。
// 不能用最好成绩上的 play_time：那是最后一次打这张谱的时间，不是打出这个分数的时间
// （实测：一张 9/16 的最好成绩，10/19 又打了两次没破纪录，play_time 写的是 10/19）。

const DAY_MS = 86400000;
const OFFSET_MS = 8 * 3600000;        // 北京时间
const VISIT_GAP_MS = 2 * 3600000;     // 相邻两次游玩隔了这么久，就算两场
const RECENT_LIMIT = 50;              // Recent 50 最多这么多条：最近一场把它占满了，前面就可能还有被挤掉的
const SAME_SYNC_MS = 15000;           // 同一次同步（跟 history.cjs 的 BATCH_GAP_MS 一样）
const PLAY_MINUTES = 3;               // 最后一首也要打：时长 = 首末两次的间隔 + 一首（同一场里相邻两首中位数 3 分钟）
const ROW_LIMIT = 24;                 // 图上最多两栏 × 12 行（12 张以内排一栏，见 themes/attendance/renderer/theme.js）
const CALENDAR_WEEKS = 53;            // 近一年：53 周 × 7 天，周一在上
// 日历一格的深浅：那天传了几条。1～9、10～19、20～39、40 以上（一场打十几二十首；第一次同步会把全部最好成绩都传上去，几百条）
const LEVEL_FLOORS = [1, 10, 20, 40];

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const RANK_NAMES = { sssp: "SSS+", sss: "SSS", ssp: "SS+", ss: "SS", sp: "S+", s: "S", aaa: "AAA", aa: "AA", a: "A", bbb: "BBB", bb: "BB", b: "B", c: "C", d: "D" };
// 一场里同一张谱面打了几次，通关标记取这几次里最好的（分数取最高的那次，标记可能来自别的几次）
const CLEAR_ORDER = { failed: 0, clear: 1, hard: 2, brave: 3, absolute: 4, catastrophy: 5 };
const FC_ORDER = { fullcombo: 1, alljustice: 2, alljusticecritical: 3 };
const CHAIN_ORDER = { fullchain: 1, fullchain2: 2 };

const pad = (value) => String(value).padStart(2, "0");
// 北京时间的年月日、星期、时分：加 8 小时再按 UTC 读（中国没有夏令时）
function beijing(ms) {
  const d = new Date(ms + OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}
const dayKey = (ms) => { const t = beijing(ms); return t.year + "-" + pad(t.month) + "-" + pad(t.day); };
const clock = (ms) => { const t = beijing(ms); return pad(t.hour) + ":" + pad(t.minute); };
const dayText = (ms) => { const t = beijing(ms); return pad(t.month) + "/" + pad(t.day); };
// 北京时间那天零点（UTC 毫秒）
const dayStart = (ms) => Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;

function playsOf(recents) {
  return (Array.isArray(recents) ? recents : [])
    .map((play) => ({ ...play, ms: Date.parse(play?.play_time) }))
    .filter((play) => Number.isFinite(play.ms) && Number.isFinite(Number(play.id)))
    .sort((a, b) => a.ms - b.ms);
}

// 切成一场一场，时间正序（最后一场是最近的）；每场里也是时间正序
function splitVisits(recents, gapMs = VISIT_GAP_MS) {
  const visits = [];
  for (const play of playsOf(recents)) {
    const last = visits.at(-1);
    if (last && play.ms - last.at(-1).ms <= gapMs) last.push(play);
    else visits.push([play]);
  }
  return visits;
}

const better = (order, a, b) => ((order[a] || 0) >= (order[b] || 0) ? a : b);

// 同一张谱面合成一行；按这场第一次打它的时间排
function mergeCharts(plays, { catalog, bests = [] } = {}) {
  const bestOf = new Map((Array.isArray(bests) ? bests : []).map((score) => [score.id + ":" + score.level_index, score]));
  const groups = new Map();
  for (const play of plays) {
    const key = play.id + ":" + play.level_index;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(play);
  }
  const rows = [];
  for (const [key, list] of groups) {
    const top = list.reduce((a, b) => ((Number(b.score) || 0) > (Number(a.score) || 0) ? b : a));
    const id = Number(top.id);
    const levelIndex = Number(top.level_index);
    const song = catalog?.getSong(id) || null;
    const chart = song ? catalog.chart(song, levelIndex) : null;
    const best = bestOf.get(key);
    const newRecord = Boolean(best) && Number(best.score) === Number(top.score) &&
      Math.abs(Date.parse(best.upload_time) - Date.parse(top.upload_time)) <= SAME_SYNC_MS;
    rows.push({
      key, id, levelIndex,
      title: song?.title || top.song_name || "曲目 " + id,
      level: chart?.level || top.level || "",
      constant: Number(chart?.level_value) || null,
      count: list.length,
      failed: list.filter((play) => play.clear === "failed").length,
      // 每一次的分数，按先后；被技能强制结束的是 null（那次的分数没意义）
      attempts: list.map((play) => (play.clear === "failed" ? null : Number(play.score) || 0)),
      score: Number(top.score) || 0,
      rank: RANK_NAMES[top.rank] || "",
      clear: list.map((play) => play.clear).reduce((a, b) => better(CLEAR_ORDER, a, b)) || null,
      fc: list.map((play) => play.full_combo).reduce((a, b) => better(FC_ORDER, a, b)) || null,
      chain: list.map((play) => play.full_chain).reduce((a, b) => better(CHAIN_ORDER, a, b)) || null,
      newRecord,
      first: list[0].ms,
    });
  }
  return rows.sort((a, b) => a.first - b.first || a.key.localeCompare(b.key));
}

function levelOf(count) {
  let level = 0;
  LEVEL_FLOORS.forEach((floor, i) => { if (count >= floor) level = i + 1; });
  return level;
}

// 近一年的日历：53 列（周），每列周一到周日。今天以后的格子 future（不画）
function buildCalendar(heatmap, now) {
  const counts = heatmap && typeof heatmap === "object" ? heatmap : {};
  const today = dayStart(now);
  const weekday = (beijing(today).weekday + 6) % 7;            // 周一 0 … 周日 6
  const firstMonday = today - (weekday + (CALENDAR_WEEKS - 1) * 7) * DAY_MS;
  const weeks = [];
  const months = [];
  let activeDays = 0;
  for (let w = 0; w < CALENDAR_WEEKS; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const ms = firstMonday + (w * 7 + d) * DAY_MS;
      const key = dayKey(ms);
      const future = ms > today;
      const count = future ? 0 : Math.max(0, Number(counts[key]) || 0);
      if (count > 0) activeDays++;
      if (!future && beijing(ms).day === 1) months.push({ week: w, text: beijing(ms).month + "月" });
      days.push({ key, count, level: levelOf(count), future, today: ms === today });
    }
    weeks.push(days);
  }
  return { weeks, months, activeDays, from: weeks[0][0].key, to: dayKey(today) };
}

// 一场的谱面超过图上放得下的：出了新纪录的全留（抬头那格数了几张，列表里就得看得到），剩下的位置给后打的；
// 画出来还是按这场第一次打的先后排
function pickRows(rows, limit = ROW_LIMIT) {
  if (rows.length <= limit) return rows;
  const keep = new Set(rows.filter((row) => row.newRecord).slice(-limit));
  for (let i = rows.length - 1; i >= 0 && keep.size < limit; i--) keep.add(rows[i]);
  return rows.filter((row) => keep.has(row));
}

// recents：/recents 原样；heatmap：{ 日期: 条数 }；bests：/scores（全部最好成绩）。没有游玩记录返回 null
function buildAttendanceView({ recents, heatmap, bests, catalog, now = new Date() } = {}) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  const visits = splitVisits(recents);
  const plays = visits.at(-1);
  if (!plays) return null;
  const rows = mergeCharts(plays, { catalog, bests });
  const start = plays[0].ms;
  const end = plays.at(-1).ms;
  const shown = pickRows(rows);
  // 不是今年的出勤，日期前面带上年份
  const year = beijing(start).year;
  const date = (year !== beijing(at).year ? year + "/" : "") + dayText(start);
  return {
    title: "出勤记录",
    time: dayText(at) + " " + clock(at),
    visit: {
      date, weekday: WEEKDAYS[beijing(start).weekday],
      start: clock(start), end: clock(end),
      minutes: Math.round((end - start) / 60000) + PLAY_MINUTES,
      plays: plays.length, charts: rows.length,
      failed: plays.filter((play) => play.clear === "failed").length,
      newRecords: rows.filter((row) => row.newRecord).length,
      // 最近一场就是 Recent 50 的全部：前面还有没有被挤掉的，看不出来
      truncated: visits.length === 1 && (Array.isArray(recents) ? recents.length : 0) >= RECENT_LIMIT,
    },
    rows: shown,
    omitted: rows.length - shown.length,
    calendar: buildCalendar(heatmap, at),
  };
}

module.exports = {
  VISIT_GAP_MS, ROW_LIMIT, CALENDAR_WEEKS, LEVEL_FLOORS,
  splitVisits, mergeCharts, pickRows, buildCalendar, buildAttendanceView, levelOf,
};
