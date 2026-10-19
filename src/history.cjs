"use strict";
// /推分记录 的数据层：把落雪的成绩变化整理成“一次一次同步”，再从基线重放 B50 算账号 Rating。
//
// 为什么不读落雪的同步结果：网页 /user/sync 的“这次改了哪几首、旧值→新值”来自 /user/crawl/status
// （SSE，网站登录令牌），不是公开 API，OAuth 的 read_player 也拿不到。所以 Anna 自己记账：
//   - /scores 每条成绩带 upload_time（这条成绩最后一次被同步的时间），时间相近的归成一次同步；
//   - 每首谱的 /score/history 有这张谱每一次上传（分数、Rating、FC、play_time），用它补旧值；
//   - 第一次查某个窗口时，把窗口起点那一刻的成绩倒推出来当基线；之后只补新上传。
//
// 存一份基线 + 一串事件，不存每次的整份快照。画图时从基线按时间重放：
//   单曲 Rating = rating(定数, 分数)（src/score-math.cjs，跟落雪返回的值核过，562/562 一致）
//   账号 Rating = (旧曲前 30 + 新曲前 20 的 Rating 和) / 50
//   一次同步的影响 = (同步后前 50 和 - 同步前前 50 和) / 50
//
// 时间一律按北京时间（Asia/Shanghai）分天；批次按 upload_time 分，相差 ≤15 秒算同一批
// （实测同一批最多差 2～3 秒）。play_time 可能为空，只作参考，不用来分批。
//
// 数据文件是 data/history/<openid 的 sha256 前 24 位>.json，不写 openid 明文。存的是：
//   baseline  基线那一刻的成绩（每首一条，只有分数 / FC / OP）
//   cursor    每首谱上次处理到的 upload_time
//   events    之后每一次成绩变化（旧分 → 新分、时间、play_time）
// 画图时从 baseline 开始按 events 重放，所以不用存每次的整份快照。

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { rating: singleRating } = require("./score-math.cjs");

const VERSION = 1;
const BATCH_GAP_MS = 15000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const FC_RANK = { alljusticecritical: 3, alljustice: 2, fullcombo: 1 };

const BEIJING = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const pad = (value) => String(value).padStart(2, "0");

function beijingParts(date) {
  const parts = Object.fromEntries(BEIJING.formatToParts(date).map(({ type, value }) => [type, value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

// 北京时间某一天的 0 点（days 是相对今天的天数，month 是本月 1 日）
function beijingMidnight(date = new Date(), { days = 0, month = false } = {}) {
  const parts = beijingParts(date);
  const utc = month ? Date.UTC(parts.year, parts.month - 1, 1) : Date.UTC(parts.year, parts.month - 1, parts.day + days);
  return new Date(utc - BEIJING_OFFSET_MS);
}

function formatTime(ms, { withDate = true } = {}) {
  const parts = beijingParts(new Date(ms));
  const hm = pad(parts.hour) + ":" + pad(parts.minute);
  return withDate ? pad(parts.month) + "/" + pad(parts.day) + " " + hm : hm;
}

function formatDay(ms) {
  const parts = beijingParts(new Date(ms));
  return pad(parts.month) + "/" + pad(parts.day);
}

function dayKey(ms) {
  const parts = beijingParts(new Date(ms));
  return parts.year + "-" + pad(parts.month) + "-" + pad(parts.day);
}

// 命令参数：不带、最新、今天、7天、15天、本月。别的天数（14 天、8 天）不认。
function parseWindow(arg, { now = new Date() } = {}) {
  const text = String(arg ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
  if (!text || text === "最新") return { kind: "latest", label: "最近一次", from: null };
  if (text === "今天") return { kind: "today", label: "今天", from: beijingMidnight(now) };
  if (text === "7天" || text === "七天") return { kind: "7d", label: "最近 7 天", from: beijingMidnight(now, { days: -6 }) };
  if (text === "15天" || text === "十五天") return { kind: "15d", label: "最近 15 天", from: beijingMidnight(now, { days: -14 }) };
  if (text === "本月" || text === "这个月") return { kind: "month", label: "本月", from: beijingMidnight(now, { month: true }) };
  return null;
}

function keyOf(value, levelIndex) {
  // 事件里存的是 lv（省空间），成绩和历史里是 level_index，两种都认
  if (value && typeof value === "object") return Number(value.id) + ":" + Number(value.level_index ?? value.lv);
  return Number(value) + ":" + Number(levelIndex);
}

function keyParts(key) {
  const [id, lv] = String(key).split(":").map(Number);
  return { id, lv };
}

const uploadOf = (score) => Date.parse(score?.upload_time);
const recordOf = (score) => ({ score: Number(score?.score) || 0, fc: score?.full_combo || null, op: Number(score?.over_power) || 0 });
const fcRank = (fc) => FC_RANK[fc] || 0;

// 落雪给的历史是倒序；统一成时间正序，并带上 ms 方便比
function sortHistory(list) {
  return (Array.isArray(list) ? list : [])
    .filter((record) => record && Number.isFinite(Date.parse(record.upload_time)))
    .map((record) => ({ ...record, ms: Date.parse(record.upload_time) }))
    .sort((a, b) => a.ms - b.ms || (Number(a.score) || 0) - (Number(b.score) || 0));
}

function lastAtOrBefore(records, ms) {
  let found = null;
  for (const record of records) {
    const at = Number.isFinite(record.ms) ? record.ms : Date.parse(record.upload_time);
    if (!Number.isFinite(at)) continue;
    if (at <= ms) found = record; else break;
  }
  return found;
}

// 同一张谱一批里可能传了两次（先失败后成功）：按时间聚堆，一堆里取最高分那条
function better(a, b) {
  if ((Number(a.score) || 0) !== (Number(b.score) || 0)) return (Number(a.score) || 0) > (Number(b.score) || 0);
  const fa = fcRank(a.full_combo || a.fc);
  const fb = fcRank(b.full_combo || b.fc);
  if (fa !== fb) return fa > fb;
  return (a.ms || 0) > (b.ms || 0);
}

function eventOf(record, previous) {
  const at = Date.parse(record.upload_time);
  const previousScore = previous ? Number(previous.score) || 0 : null;
  return {
    t: record.upload_time,
    ms: at,
    id: Number(record.id),
    lv: Number(record.level_index),
    score: Number(record.score) || 0,
    fc: record.full_combo || null,
    op: Number(record.over_power) || 0,
    prev: previousScore,
    prevFc: previous ? (previous.full_combo || previous.fc || null) : null,
    prevOp: previous ? (Number(previous.over_power) || 0) : null,
    play: record.play_time || null,
  };
}

// records 是这张谱从 from 之后的每一次上传；before 是 from 之前最后一条（没有就是第一次打）。
// 同一批只留最好的一条；分数没涨、FC 也没变好的批不产生事件。
function toEvents(records, before, gapMs = BATCH_GAP_MS) {
  const list = sortHistory(records);
  const groups = [];
  for (const record of list) {
    const last = groups.at(-1);
    if (last && record.ms - last.at(-1).ms <= gapMs) last.push(record);
    else groups.push([record]);
  }
  const events = [];
  let previous = before
    ? { score: Number(before.score) || 0, fc: before.full_combo || before.fc || null, over_power: Number(before.over_power) || 0 }
    : null;
  for (const group of groups) {
    const best = group.reduce((a, b) => (better(b, a) ? b : a));
    const bestFc = best.full_combo || best.fc || null;
    if (!previous || (Number(best.score) || 0) > previous.score || fcRank(bestFc) > fcRank(previous.fc)) {
      events.push(eventOf(best, previous));
      previous = { score: Number(best.score) || 0, fc: bestFc, over_power: Number(best.over_power) || 0 };
    }
  }
  return events;
}

// 最近一批的起点（upload_time 相差 ≤15 秒的最后一堆）
function latestFrom(scores, gapMs = BATCH_GAP_MS) {
  // 只看进 B50 的难度（0～4）；WORLD'S END 没有 Rating，它的上传时间不该决定“最近一批”
  const times = [...new Set((scores || [])
    .filter((score) => Number(score.level_index) >= 0 && Number(score.level_index) <= 4)
    .map(uploadOf).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!times.length) return null;
  let start = times.at(-1);
  for (let i = times.length - 2; i >= 0; i--) {
    if (times[i + 1] - times[i] <= gapMs) start = times[i];
    else break;
  }
  return new Date(start);
}

// 从 from 那一刻重建：from 之前的成绩当基线，之后的上传（逐首读历史）当事件。
// 第一次查、或者查的窗口比现有基线更早时用。请求数 = 窗口内变过的谱面数。
async function buildFrom({ from, scores, fetchHistory, friendCode = "", gapMs = BATCH_GAP_MS } = {}) {
  if (!(from instanceof Date) || !Number.isFinite(from.getTime())) throw new Error("buildFrom 需要 from");
  const fromMs = from.getTime();
  const baseline = {};
  const cursor = {};
  const events = [];
  for (const score of scores || []) {
    const lv = Number(score.level_index);
    // WORLD'S END 没有 Rating，也不进 B50；不用为它读历史
    if (!(lv >= 0 && lv <= 4)) continue;
    const key = keyOf(score);
    const uploadMs = uploadOf(score);
    if (!Number.isFinite(uploadMs)) continue;
    if (uploadMs < fromMs) {
      baseline[key] = recordOf(score);
      cursor[key] = score.upload_time;
      continue;
    }
    // 只认当前成绩这条（upload_time）之前的历史：/scores 是“现在”，历史里不该有更晚的；
    // 真有的话（服务端不一致、测试数据）也只处理到这条，别把未来当成已经发生。
    let history = sortHistory(await fetchHistory(score.id, lv)).filter((record) => record.ms <= uploadMs);
    if (!history.length) history = [{ ...score, id: Number(score.id), level_index: lv }];
    const before = lastAtOrBefore(history, fromMs - 1);
    if (before) baseline[key] = recordOf(before);
    let fresh = history.filter((record) => record.ms >= fromMs);
    if (!fresh.length) fresh = [{ ...score, id: Number(score.id), level_index: lv }];
    events.push(...toEvents(fresh, before, gapMs));
    cursor[key] = score.upload_time;
  }
  events.sort((a, b) => a.ms - b.ms);
  return { v: VERSION, friendCode: String(friendCode || ""), at: from.toISOString(), baseline, cursor, events };
}

// 在现有基线上补新上传：只读 upload_time 比游标新的谱面，写进 events。
async function collect({ state, scores, fetchHistory, gapMs = BATCH_GAP_MS } = {}) {
  if (!state?.baseline || !state?.cursor || !Array.isArray(state.events)) throw new Error("collect 需要有效的 state");
  let changed = false;
  for (const score of scores || []) {
    const lv = Number(score.level_index);
    if (!(lv >= 0 && lv <= 4)) continue;
    const key = keyOf(score);
    const uploadMs = uploadOf(score);
    if (!Number.isFinite(uploadMs)) continue;
    const cursorMs = state.cursor[key] ? Date.parse(state.cursor[key]) : null;
    if (cursorMs !== null && uploadMs <= cursorMs) continue;

    let history = sortHistory(await fetchHistory(score.id, lv)).filter((record) => record.ms <= uploadMs);
    if (!history.length) history = [{ ...score, id: Number(score.id), level_index: lv }];
    if (!(key in state.baseline)) {
      const at = Date.parse(state.at);
      const beforeAt = Number.isFinite(at) ? lastAtOrBefore(history, at) : null;
      if (beforeAt) state.baseline[key] = recordOf(beforeAt);
    }
    const since = cursorMs !== null ? cursorMs : (Number.isFinite(Date.parse(state.at)) ? Date.parse(state.at) : 0);
    const previous = lastAtOrBefore(history, since);
    const fresh = history.filter((record) => record.ms > since);
    if (fresh.length) {
      state.events.push(...toEvents(fresh, previous, gapMs));
      changed = true;
    } else if (uploadMs > since) {
      // 历史里没有当前这条（比如服务端还没写进历史）：按当前成绩补一条，别漏掉
      state.events.push(eventOf({ ...score, id: Number(score.id), level_index: lv }, previous));
      changed = true;
    }
    state.cursor[key] = score.upload_time;
  }
  if (changed) state.events.sort((a, b) => a.ms - b.ms);
  return state;
}

// 曲目信息缓存：每个事件都要拿定数、曲名、版本
function createInfo(catalog, floor) {
  const cache = new Map();
  return (key) => {
    if (cache.has(key)) return cache.get(key);
    const { id, lv } = keyParts(key);
    const song = catalog?.getSong?.(id) || null;
    const chart = catalog?.chart?.(song, lv) || song?.difficulties?.find((entry) => entry.difficulty === lv) || null;
    const meta = {
      key, id, lv,
      title: song?.title || "曲目 " + id,
      level: chart?.level || "",
      constant: Number(chart?.level_value) || 0,
      // 落雪标了 disabled 的曲目不进 Rating 构成（跟 best.cjs 一样）
      disabled: Boolean(song?.disabled),
      isNew: Boolean(song && Number.isFinite(floor) && Number(song.version) >= floor),
    };
    cache.set(key, meta);
    return meta;
  };
}

// 前 50：旧曲 30 + 新曲 20；空位按 0 算（跟游戏一样，总数除 50）
function b50(map, info) {
  const rows = [];
  for (const [key, record] of map) {
    const meta = info(key);
    if (!meta || meta.disabled || !(meta.constant > 0)) continue;
    const value = singleRating(meta.constant, Number(record.score) || 0);
    if (!(value > 0)) continue;
    rows.push({ key, title: meta.title, level: meta.level, isNew: meta.isNew, score: Number(record.score) || 0, fc: record.fc || null, rating: value });
  }
  const order = (a, b) => b.rating - a.rating || b.score - a.score;
  const old = rows.filter((row) => !row.isNew).sort(order).slice(0, 30);
  const fresh = rows.filter((row) => row.isNew).sort(order).slice(0, 20);
  const total = old.reduce((sum, row) => sum + row.rating, 0) + fresh.reduce((sum, row) => sum + row.rating, 0);
  return { rating: total / 50, old, fresh, keys: new Set([...old, ...fresh].map((row) => row.key)) };
}

function rowOf(top, key) {
  return top.old.find((row) => row.key === key) || top.fresh.find((row) => row.key === key) || null;
}

function viewEvent(event, before, after, info) {
  const key = keyOf(event);
  const meta = info(key);
  const value = meta.constant > 0 ? singleRating(meta.constant, event.score) : 0;
  const previous = event.prev === null || event.prev === undefined || meta.constant <= 0
    ? null : singleRating(meta.constant, event.prev);
  const inBefore = before.keys.has(key);
  const inAfter = after.keys.has(key);
  const action = event.prev === null || event.prev === undefined
    ? "first"
    : inAfter && !inBefore ? "enter"
      : inAfter ? (event.score > event.prev ? "up" : "fc")
        : "outside";
  return {
    key, title: meta.title, level: meta.level, constant: meta.constant, isNew: meta.isNew,
    score: event.score, prevScore: event.prev, rating: value, prevRating: previous,
    deltaScore: event.prev === null || event.prev === undefined ? null : event.score - event.prev,
    deltaRating: previous === null ? null : value - previous,
    fc: event.fc, prevFc: event.prevFc, play: event.play, action, inB50: inAfter,
  };
}

function groupEvents(events, gapMs = BATCH_GAP_MS) {
  const list = (events || [])
    .map((event) => ({ ...event, ms: Number.isFinite(event.ms) ? event.ms : Date.parse(event.t) }))
    .filter((event) => Number.isFinite(event.ms))
    .sort((a, b) => a.ms - b.ms);
  const groups = [];
  for (const event of list) {
    const last = groups.at(-1);
    if (last && event.ms - last.at(-1).ms <= gapMs) last.push(event);
    else groups.push([event]);
  }
  return groups;
}

// 从基线开始按时间重放；每一批算一次前后的 B50
function replay(state, { catalog, floor } = {}) {
  const info = createInfo(catalog, floor);
  const map = new Map(Object.entries(state.baseline || {}).map(([key, record]) => [key, { ...record }]));
  let top = b50(map, info);
  const points = [{ ms: Date.parse(state.at), t: state.at, rating: top.rating }];
  const batches = [];
  for (const group of groupEvents(state.events || [])) {
    const before = top;
    for (const event of group) map.set(keyOf(event), { score: event.score, fc: event.fc, op: event.op });
    const after = b50(map, info);
    const events = group
      .map((event) => viewEvent(event, before, after, info))
      .filter((event) => event.rating > 0 || (event.prevRating || 0) > 0 || event.action === "fc");
    const entered = [...after.keys].filter((key) => !before.keys.has(key)).map((key) => rowOf(after, key)).filter(Boolean);
    const left = [...before.keys].filter((key) => !after.keys.has(key)).map((key) => rowOf(before, key)).filter(Boolean);
    batches.push({
      ms: group[0].ms, t: group[0].t, timeText: formatTime(group[0].ms),
      before: before.rating, after: after.rating, impact: after.rating - before.rating,
      events, entered, left,
    });
    points.push({ ms: group[0].ms, t: group[0].t, rating: after.rating });
    top = after;
  }
  return { points, batches };
}

function ratingAt(points, ms) {
  if (!points.length) return 0;
  let value = points[0].rating;
  for (const point of points) {
    if (point.ms <= ms) value = point.rating;
    else break;
  }
  return value;
}

function groupDays(batches) {
  const map = new Map();
  for (const batch of batches) {
    const key = dayKey(batch.ms);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(batch);
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    label: formatDay(list[0].ms),
    gain: list.at(-1).after - list[0].before,
    batches: list.length,
    rated: list.filter((batch) => Math.abs(batch.impact) >= 0.0005).length,
    entered: new Set(list.flatMap((batch) => batch.entered.map((row) => row.key))).size,
    left: new Set(list.flatMap((batch) => batch.left.map((row) => row.key))).size,
    outside: list.reduce((count, batch) => count + batch.events.filter((event) => !event.inB50).length, 0),
  }));
}

// 画图/回话用的整理结果。window 是 parseWindow 的结果（最新档的 from 由调用方补上）。
function buildReport({ state, window, to = new Date(), catalog, floor, player } = {}) {
  const { points, batches: all } = replay(state, { catalog, floor });
  const from = window?.from || new Date(state.at);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const start = ratingAt(points, fromMs - 1);
  const end = ratingAt(points, toMs);
  const batches = all.filter((batch) => batch.ms >= fromMs && batch.ms <= toMs);
  const enteredKeys = new Set(batches.flatMap((batch) => batch.entered.map((row) => row.key)));
  const leftKeys = new Set(batches.flatMap((batch) => batch.left.map((row) => row.key)));
  const outside = batches.reduce((count, batch) => count + batch.events.filter((event) => !event.inB50).length, 0);
  return {
    window, from, to, points, batches,
    latest: all.at(-1) || null,
    days: groupDays(batches),
    counts: {
      batches: batches.length,
      rated: batches.filter((batch) => Math.abs(batch.impact) >= 0.0005).length,
      outside, entered: enteredKeys.size, left: leftKeys.size,
    },
    rating: { start, end, gain: end - start, now: Number(player?.rating) || end },
  };
}

function hashOpenid(openid) {
  return crypto.createHash("sha256").update(String(openid)).digest("hex").slice(0, 24);
}

async function writeAtomic(file, data) {
  const tmp = file + "." + process.pid + ".tmp";
  await fsp.writeFile(tmp, data);
  // Windows 上目标文件正被杀毒软件之类读着时 rename 会报 EPERM/EBUSY，等一下再试（同 vault.cjs）
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error?.code)) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

// 每人一个文件；同一个人的读改写排成一队（两条指令同时来时不互相盖掉）。
function createHistoryStore({ dir, log = () => {} } = {}) {
  if (!dir) throw new Error("推分记录需要一个目录");
  const queues = new Map();
  const fileOf = (openid) => path.join(dir, hashOpenid(openid) + ".json");

  function read(openid) {
    try {
      const state = JSON.parse(fs.readFileSync(fileOf(openid), "utf8"));
      if (!state || state.v !== VERSION || typeof state.baseline !== "object" || !Array.isArray(state.events) || typeof state.at !== "string") {
        throw new Error("格式不对");
      }
      return state;
    } catch (error) {
      if (error?.code !== "ENOENT") log("⚠ 推分记录读不出来，按没有处理：" + error.message);
      return null;
    }
  }

  async function write(openid, state) {
    fs.mkdirSync(dir, { recursive: true });
    await writeAtomic(fileOf(openid), JSON.stringify(state));
  }

  function withLock(openid, fn) {
    const key = String(openid);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  }

  return { read, write, withLock, fileOf };
}

module.exports = {
  VERSION, BATCH_GAP_MS, parseWindow, beijingMidnight, formatTime, formatDay,
  keyOf, latestFrom, buildFrom, collect, replay, buildReport, groupEvents, toEvents, b50,
  createHistoryStore, hashOpenid,
};
