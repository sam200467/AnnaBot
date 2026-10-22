"use strict";
// /热门谱面：落雪热门榜怎么整理成图的数据（名次变化、北京时间的时段、定数、玩家成绩），成绩按绑定方式怎么读，
// 再走一遍端到端（假 QQ + 假落雪，出图换成假的、记下主题拿到的数据）。数据都是编的。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMockOfficial } = require("./mock-official.cjs");
const { createMockLxns, PNG } = require("./mock-lxns.cjs");
const { createLxnsClient } = require("../src/lxns.cjs");
const { createOAuth } = require("../src/lxns-oauth.cjs");
const { openVault } = require("../src/vault.cjs");
const { createBindings } = require("../src/bindings.cjs");
const { createCatalog } = require("../src/catalog.cjs");
const { createAssets } = require("../src/assets.cjs");
const { createAnnaBot } = require("../src/bot.cjs");
const { V } = require("../src/voice.cjs");
const feature = require("../src/features/popular.cjs");

const { buildData, loadScores, indexScores, changeOf, beijingDay } = feature;
const FC1 = "123456789012345";
const FC2 = "102000000000002";

const chart = (difficulty, level, value) => ({ difficulty, level, level_value: value, note_designer: "谱师", version: 14000 });
// 小曲库：853 四个难度；3 有 MASTER、ULTIMA；851 只有 MASTER；8020 是 3 的 WORLD'S END 版
function songList() {
  return {
    songs: [
      { id: 853, title: "《最愛》 ～ Curse", artist: "James Landino", genre: "原创", bpm: 157, version: 14000,
        difficulties: [chart(0, "3", 3), chart(1, "5", 5), chart(2, "9+", 9.5), chart(3, "13+", 13.5)] },
      { id: 3, title: "曲3", artist: "x", genre: "其他游戏", bpm: 170, version: 10000, difficulties: [chart(3, "12+", 12.5), chart(4, "13+", 13.7)] },
      { id: 851, title: "曲851", artist: "x", genre: "原创", bpm: 170, version: 14000, difficulties: [chart(3, "13", 13)] },
      { id: 8020, title: "曲3", artist: "x", genre: "WORLD'S END", bpm: 170, version: 15000,
        difficulties: [{ difficulty: 5, level: "0", level_value: 0, note_designer: "x", version: 15000, origin_id: 3, kanji: "戻", star: 4 }] },
    ],
    genres: [],
    versions: [{ id: 0, title: "CHUNITHM", version: 10000 }, { id: 8, title: "CHUNITHM CRYSTAL", version: 14000 }],
  };
}

const entry = (rank, previous, id, levelIndex, level, title = "榜上的曲" + id) =>
  ({ id, title, artist: "榜上的曲师", rank, previous_rank: previous, level_index: levelIndex, level });
// 照落雪 2026-10-22 的真数据编：时段是北京时间整天（period_end 是北京时间零点），updated_at 每小时变
function lists() {
  return {
    week: {
      range: "week", period_start: "2026-10-14T16:00:00Z", period_end: "2026-10-21T16:00:00Z", updated_at: "2026-10-22T04:05:00.002Z",
      // 故意打乱顺序：图上按名次排
      songs: [entry(2, 5, 3, 4, "13+"), entry(1, 1, 853, 3, "13+"), entry(3, null, 851, 3, "13"), entry(4, 2, 8020, 5, "☆4"), entry(5, 4, 9999, 2, "11")],
    },
    month: {
      range: "month", period_start: "2026-09-21T16:00:00Z", period_end: "2026-10-21T16:00:00Z", updated_at: "2026-10-22T03:05:00.001Z",
      songs: [entry(1, 2, 3, 3, "12+"), entry(2, 1, 853, 3, "13+")],
    },
  };
}

const score = (id, levelIndex, value, extra = {}) => ({ id, song_name: "x", level: "x", level_index: levelIndex, score: value,
  rating: 15.1, clear: "clear", full_combo: null, full_chain: null, rank: "ss", ...extra });

async function loadCatalog(t) {
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-popular-"));
  t.after(async () => { await lx.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const catalog = createCatalog({ lxns: createLxnsClient({ baseUrl: lx.apiBase, retries: 0 }), cacheDir: dir });
  await catalog.ready();
  return catalog;
}

test("名次变化：上一期的名次减这一期的，0 是没变，没有上一期是新上榜", () => {
  assert.deepEqual(changeOf(3, 9), { kind: "up", value: 6 });
  assert.deepEqual(changeOf(8, 4), { kind: "down", value: 4 });
  assert.deepEqual(changeOf(1, 1), { kind: "same" });
  assert.deepEqual(changeOf(7, null), { kind: "new" });
  assert.deepEqual(changeOf(7, undefined), { kind: "new" });
});

test("时段按北京时间写：开始那天照写，结束是零点（不含）就写前一天；跨月、读不懂的也不出错", () => {
  assert.equal(beijingDay("2026-10-14T16:00:00Z"), "10/15");
  assert.equal(beijingDay("2026-10-21T16:00:00Z", { exclusive: true }), "10/21");
  assert.equal(beijingDay("2026-09-30T16:00:00Z", { exclusive: true }), "9/30");
  assert.equal(beijingDay("2026-12-31T16:00:00Z"), "1/1");
  assert.equal(beijingDay(""), "");
});

test("整理两张榜：按名次排、定数从曲库来（WE 没有）、曲库里没有的新曲照样列；更新时间取两张里晚的那个", async (t) => {
  const catalog = await loadCatalog(t);
  const data = buildData({ ...lists(), catalog, now: new Date("2026-10-22T05:00:00Z") });
  assert.deepEqual(data.ranges.map((range) => [range.key, range.label, range.start, range.end]),
    [["week", "近 7 天", "10/15", "10/21"], ["month", "近 30 天", "9/22", "10/21"]]);
  const week = data.ranges[0].rows;
  assert.deepEqual(week.map((row) => [row.rank, row.id, row.levelIndex]), [[1, 853, 3], [2, 3, 4], [3, 851, 3], [4, 8020, 5], [5, 9999, 2]]);
  assert.deepEqual(week.map((row) => row.change.kind), ["same", "up", "new", "down", "down"]);
  assert.deepEqual(week.map((row) => row.constant), [13.5, 13.7, 13, null, null]);
  // WORLD'S END 用原曲的曲绘、带上难度字和星数；曲库没有的曲目曲绘就按榜上的 ID
  assert.deepEqual([week[3].jacketId, week[3].kanji, week[3].star], [3, "戻", 4]);
  assert.deepEqual([week[4].jacketId, week[4].title, week[4].level], [9999, "榜上的曲9999", "11"]);
  assert.equal(week[0].title, "榜上的曲853", "曲名以榜单为准");
  assert.equal(data.updatedAt, "2026-10-22 12:05");
  assert.equal(data.time, "2026-10-22 13:00");
  // 没绑定：整张图没有成绩那一栏
  assert.equal(data.scored, false);
  assert.ok(week.every((row) => row.score === null));
  assert.equal(data.player, null);
});

test("成绩：同一张谱面取最高的一条；落雪给了 Rating 就用它，没给自己算（WE 不算）；数一数每张榜打过几张", async (t) => {
  const catalog = await loadCatalog(t);
  const scores = indexScores([
    score(853, 3, 1004000), score(853, 3, 1007600, { rating: 15.51, full_combo: "alljustice", rank: "sss" }),
    score(853, 2, 1010000),                              // 别的难度，不在榜上
    score(3, 4, 1009000, { rating: null, rank: "sssp" }),  // 落雪没给 Rating：13.7 + 2.15
    score(8020, 5, 998000, { rating: 0 }),
  ]);
  const data = buildData({ ...lists(), catalog, scores });
  assert.equal(data.scored, true);
  const [week, month] = data.ranges;
  assert.deepEqual(week.rows[0].score, { score: 1007600, rank: "sss", clear: "clear", fullCombo: "alljustice", fullChain: null, rating: 15.51 });
  assert.equal(week.rows[1].score.rating, 15.85);
  assert.equal(week.rows[2].score, null, "没打过");
  assert.deepEqual([week.rows[3].score.score, week.rows[3].score.rating], [998000, null]);
  assert.deepEqual([week.played, month.played], [3, 1]);
});

test("读成绩：授权绑定一次读全部；别的按曲目读、两张榜去重、几首一组", async () => {
  const calls = [];
  const oauth = { hasFullScores: true, scores: async () => { calls.push("scores"); return [score(3, 3, 1000000)]; },
    songBests: async () => { throw new Error("不该按曲目读"); } };
  const full = await loadScores(oauth, [...lists().week.songs, ...lists().month.songs]);
  assert.deepEqual(calls, ["scores"]);
  assert.equal(full.get("3:3").score, 1000000);

  let running = 0;
  let peak = 0;
  const friend = { hasFullScores: false, songBests: async (id) => {
    calls.push(id);
    running++; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return id === 853 ? [score(853, 3, 1001000), score(853, 0, 1010000)] : [];
  } };
  const some = await loadScores(friend, [...lists().week.songs, ...lists().month.songs]);
  assert.deepEqual(calls.slice(1).sort((a, b) => a - b), [3, 851, 853, 8020, 9999]);
  assert.equal(peak, 3);
  assert.equal(some.get("853:3").score, 1001000);
  assert.equal(some.size, 2);
});

test("落雪接口：热门榜是公共接口（不带密钥），外面那层 { success, data } 拆掉", async (t) => {
  const mock = createMockLxns({ popular: lists() });
  await mock.start();
  t.after(() => mock.stop());
  const lxns = createLxnsClient({ baseUrl: mock.apiBase, devToken: mock.devToken, retries: 0 });
  const week = await lxns.popular("week");
  assert.equal(week.songs.length, 5);
  assert.equal(mock.state.requests.at(-1).path, "/api/v0/chunithm/song/popular?range=week");
  assert.equal(mock.state.requests.at(-1).auth, "none");
  assert.equal((await lxns.popular("month")).range, "month");
});

// ── 端到端 ──
async function setup(t, { popular = lists() } = {}) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns({ songList: songList(), popular });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-popular-bot-"));
  const lxns = createLxnsClient({ baseUrl: lx.apiBase, devToken: lx.devToken, retries: 0 });
  const oauth = createOAuth({ clientId: lx.clientId, clientSecret: lx.clientSecret, siteUrl: lx.site, apiBase: lx.apiBase });
  const vault = await openVault({ file: path.join(dir, "bindings.enc"), key: crypto.randomBytes(32) });
  const bindings = createBindings({ vault, lxns, oauth });
  const catalog = createCatalog({ lxns, cacheDir: path.join(dir, "cache") });
  await catalog.ready();
  const assets = createAssets({ cacheDir: path.join(dir, "assets"), baseUrl: lx.assetsBase });
  const renders = [];
  const renderer = { render: async (theme, data, options) => { renders.push({ theme, data, options }); return { buffer: PNG }; } };
  const bot = createAnnaBot({
    allowedGroupIds: ["G1"], allowPrivateChat: true, admins: [], receiptDelayMs: 5000, generateCooldownMs: 0,
    qq: { appId: "1", clientSecret: "x", tokenUrl: qq.tokenUrl, apiBase: qq.apiBase, sandboxApiBase: qq.apiBase, sandbox: false,
      minSendIntervalMs: 0, jitterMs: 0, perTargetIntervalMs: 0, perTargetPerHour: 1000 },
  }, { lxns, oauth, bindings, catalog, assets, renderer, log: () => {} });
  t.after(async () => {
    bot.stop();
    await qq.stop();
    await lx.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let seq = 0;
  const group = (content, { user = "U1", mentions } = {}) => bot.handleEvent(mentions ? "GROUP_MESSAGE_CREATE" : "GROUP_AT_MESSAGE_CREATE", {
    id: "m" + (++seq), group_openid: "G1", author: { member_openid: user }, content: mentions ? content : " " + content,
    ...(mentions ? { mentions } : {}),
  });
  const last = () => qq.state.sent.at(-1).body;
  async function authorize(user, friendCode) {
    await group("/授权", { user });
    const url = last().content.match(/https?:\/\/\S+/)[0];
    const code = lx.approve(friendCode, new URL(url).searchParams.get("code_challenge"));
    await group("/授权 " + code, { user });
  }
  return { lx, renders, group, last, authorize };
}

const BOT = { id: "BOT", member_openid: "BOT", is_you: true, bot: true };
const mine = () => [score(853, 3, 1006812, { rating: 15.36 }), score(3, 3, 1009000, { rating: 14.65, full_combo: "alljusticecritical", rank: "sssp" })];

test("/热门谱面 端到端：没绑定也出图（没有成绩）；好友码按曲目读；授权的一次读全部；@ 没绑定的人、多写了字、空榜都只回一句", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", scores: mine() });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", scores: mine() });
  s.lx.state.assets.set("jacket/853", PNG);

  await s.group("/热门谱面");
  assert.equal(s.last().msg_type, 7);
  const plain = s.renders.at(-1);
  assert.equal(plain.theme, "popular");
  assert.deepEqual(plain.options, feature.RENDER);
  assert.deepEqual([plain.data.scored, plain.data.player], [false, null]);
  assert.deepEqual(plain.data.ranges.map((range) => range.rows.length), [5, 2]);
  assert.match(plain.data.ranges[0].rows[0].jacket, /^file:\/\/.*jacket[\\/]853\.png$/);

  // 好友码绑定：两张榜去重后五首，各读一次 /bests?song_id=（开发者接口）
  await s.group("/绑定 " + FC1);
  const before = s.lx.state.requests.length;
  await s.group("/热门谱面");
  const friend = s.renders.at(-1).data;
  assert.equal(friend.scored, true);
  assert.equal(friend.player.name, "好友码玩家");
  assert.deepEqual(friend.ranges[0].rows.map((row) => row.score && row.score.score), [1006812, null, null, null, null]);
  assert.deepEqual(friend.ranges[1].rows.map((row) => row.score && row.score.score), [1009000, 1006812]);
  const perSong = s.lx.state.requests.slice(before).filter((request) => request.path.includes("/bests?song_id="));
  assert.equal(perSong.length, 5);
  assert.ok(perSong.every((request) => request.auth === "dev"));

  // 授权绑定：一次 /scores，不按曲目读
  await s.authorize("U2", FC2);
  const mark = s.lx.state.requests.length;
  await s.group("/热门谱面", { user: "U2" });
  const oauth = s.lx.state.requests.slice(mark).filter((request) => request.path.includes("/player"));
  assert.deepEqual(oauth.map((request) => request.path.replace(/^.*\/player/, "")).sort(), ["", "/scores"]);
  assert.ok(oauth.every((request) => request.auth === "bearer"));
  assert.equal(s.renders.at(-1).data.ranges[1].rows[0].score.fullCombo, "alljusticecritical");

  // @ 绑定了的人：查 TA 的（开发者接口）；@ 没绑定的人：直接说，不出图
  await s.group("<@BOT> <@U1> /热门谱面", { user: "U2", mentions: [BOT, { id: "U1", member_openid: "U1" }] });
  assert.equal(s.renders.at(-1).data.isSelf, false);
  assert.equal(s.renders.at(-1).data.player.name, "好友码玩家");
  const count = s.renders.length;
  await s.group("<@BOT> <@U9> /热门谱面", { mentions: [BOT, { id: "U9", member_openid: "U9" }] });
  assert.equal(s.last().content, V.otherNotBound);
  await s.group("/热门谱面 本周");
  assert.equal(s.last().content, V.popularUsage);
  assert.equal(s.renders.length, count);
});

test("/热门谱面：落雪两张榜都是空的就只回一句，不出图", async (t) => {
  const s = await setup(t, { popular: {} });
  await s.group("/热门谱面");
  assert.equal(s.last().content, V.popularEmpty);
  assert.equal(s.renders.length, 0);
});

// ── 真的渲染一次 ──
const { createRenderer, findBrowser } = require("../src/renderer.cjs");
const ROOT = path.resolve(__dirname, "..");
const skip = !findBrowser() && "没找到 Chrome / Edge";

// 示例数据里的 "lxns:jacket/…" 不联网，换成空（曲绘、名牌版缺了主题也要照样出图）
function exampleData(name) {
  const raw = fs.readFileSync(path.join(ROOT, "themes", "popular", "examples", name), "utf8");
  return JSON.parse(raw, (key, value) => (typeof value === "string" && value.startsWith("lxns:") ? null : value));
}

// 高固定 1780；宽照油画的比例，至少 2800（右边要站得下萨拉基亚）
test("popular 主题：示例数据（带成绩和名片板）、没绑定（没有成绩那一栏）都能出图", { skip }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anna-scratch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const renderer = createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1, tmpDir: tmp });
  const options = { ...feature.RENDER, scale: 1, maxBytes: 0 };
  const full = await renderer.render("popular", exampleData("preview-data.json"), options);
  assert.equal(full.height, 1780);
  assert.ok(full.width >= 2800 && full.width <= 3000, "宽：" + full.width);
  const bare = await renderer.render("popular", exampleData("unbound.json"), options);
  assert.deepEqual([bare.width, bare.height], [full.width, 1780]);
  // 一张榜是空的（落雪偶尔会这样）也不能出错
  const empty = exampleData("unbound.json");
  empty.ranges[1].rows = [];
  await renderer.render("popular", empty, options);
  await renderer.idle();
  assert.deepEqual(fs.readdirSync(tmp), [], "浏览器临时目录都删掉了");
});
