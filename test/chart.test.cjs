"use strict";
// /谱面分析：拆「曲名 难度」、挑谱面（WE 是单独编号的曲目）、整理玩家那块（游玩记录排序、筛掉 90 万以下、排名、拿不到时写原因），
// 再走一遍端到端（假 QQ + 假落雪，出图换成假的、记下主题拿到的数据），最后用本机的 Chrome / Edge 把 chart 主题真的渲染一次。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMockOfficial } = require("./mock-official.cjs");
const { createMockLxns, PNG } = require("./mock-lxns.cjs");
const { createLxnsClient, LxnsError } = require("../src/lxns.cjs");
const { createOAuth } = require("../src/lxns-oauth.cjs");
const { openVault } = require("../src/vault.cjs");
const { createBindings } = require("../src/bindings.cjs");
const { createCatalog } = require("../src/catalog.cjs");
const { createAssets } = require("../src/assets.cjs");
const { createRenderer, findBrowser } = require("../src/renderer.cjs");
const { createAnnaBot } = require("../src/bot.cjs");
const { V } = require("../src/voice.cjs");
const { parseQuery, pickChart, buildData, playerView, beijingDay } = require("../src/features/chart.cjs");

const ROOT = path.resolve(__dirname, "..");
const FC1 = "123456789012345";
const FC2 = "102000000000002";
const FC3 = "103000000000003";

const notes = (total) => ({ total, tap: total - 40, hold: 10, slide: 10, air: 10, flick: 10 });
const chart = (difficulty, level, value, total) => ({ difficulty, level, level_value: value, note_designer: "谱师" + difficulty, version: 14000, notes: notes(total) });
const we = (id, origin, kanji) => ({ id, title: "曲" + origin, artist: "x", genre: "WORLD'S END", bpm: 170, version: 15000,
  difficulties: [{ difficulty: 5, level: "0", level_value: 0, note_designer: "x", version: 15000, origin_id: origin, kanji, star: 3, notes: notes(900) }] });

// 小曲库：853 原创曲四个难度；3 带 ULTIMA、有一个 WE 版 8020；851 有两个 WE 版
function songList() {
  return {
    songs: [
      { id: 853, title: "《最愛》 ～ Curse", artist: "James Landino", genre: "原创", bpm: 157, version: 14000,
        difficulties: [chart(0, "3", 3, 422), chart(1, "5", 5, 643), chart(2, "9+", 9.5, 1145), chart(3, "13+", 13.5, 1497)] },
      { id: 3, title: "曲3", artist: "x", genre: "其他游戏", bpm: 170, version: 10000, difficulties: [chart(3, "12+", 12.5, 960), chart(4, "13+", 13.7, 1626)] },
      { id: 851, title: "曲851", artist: "x", genre: "原创", bpm: 170, version: 14000, difficulties: [chart(3, "13", 13, 1300)] },
      we(8020, 3, "戻"), we(8030, 851, "嘘"), we(8031, 851, "狂"),
    ],
    genres: [],
    versions: [{ id: 0, title: "CHUNITHM", version: 10000 }, { id: 8, title: "CHUNITHM CRYSTAL", version: 14000 }],
  };
}

const extras = { get: (id) => (id === 853 ? { characters: [{ name: "ジュナ・サラキア", id: 8820 }] } : null) };

async function loadCatalog(t) {
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-chart-"));
  t.after(async () => { await lx.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const catalog = createCatalog({ lxns: createLxnsClient({ baseUrl: lx.apiBase, retries: 0 }), cacheDir: dir });
  await catalog.ready();
  return catalog;
}

test("拆「曲名 难度」：最后一个词是难度词才拆；全角也认；不写难度是 null", () => {
  assert.deepEqual(parseQuery("混沌 紫"), { query: "混沌", levelIndex: 3 });
  assert.deepEqual(parseQuery("id407 MASTER"), { query: "id407", levelIndex: 3 });
  assert.deepEqual(parseQuery("混沌　ｕｌｔ"), { query: "混沌", levelIndex: 4 });
  assert.deepEqual(parseQuery("bbkkbkk we"), { query: "bbkkbkk", levelIndex: 5 });
  assert.deepEqual(parseQuery("最愛 绿谱"), { query: "最愛", levelIndex: 0 });
  assert.deepEqual(parseQuery("混沌を越えし我ら"), { query: "混沌を越えし我ら", levelIndex: null });
  assert.deepEqual(parseQuery("紫"), { query: "紫", levelIndex: null }, "只有一个词就当曲名");
  assert.deepEqual(parseQuery(""), { query: "", levelIndex: null });
});

test("挑谱面：默认 MASTER；没有的难度列出有的；普通曲要 WE 找 WE 版，有好几个让玩家挑；WE 曲要别的难度回原曲", async (t) => {
  const catalog = await loadCatalog(t);
  const pick = (id, level) => pickChart(catalog, catalog.getSong(id), level);
  assert.deepEqual([pick(853, null).song.id, pick(853, null).chart.difficulty], [853, 3]);
  assert.equal(pick(853, 0).chart.level, "3");
  assert.deepEqual(pick(853, 4).missing, { title: "《最愛》 ～ Curse", level: "ULTIMA", levels: ["BASIC", "ADVANCED", "EXPERT", "MASTER"] });
  assert.deepEqual([pick(3, 5).song.id, pick(3, 5).chart.difficulty], [8020, 5]);
  assert.deepEqual([pick(8020, null).song.id, pick(8020, null).chart.difficulty], [8020, 5]);
  assert.deepEqual([pick(8020, 4).song.id, pick(8020, 4).chart.difficulty], [3, 4]);
  assert.deepEqual(pick(851, 5).pick.map((song) => song.id), [8030, 8031]);
  assert.deepEqual(pick(853, 5).missing.level, "WORLD'S END");
});

const sc = (score, extra = {}) => ({ id: 853, level_index: 3, score, rank: "ssp", clear: "hard", full_combo: null, full_chain: null, ...extra });

test("玩家那块：游玩记录按游玩时间从早到晚、90 万以下不画但计数；日期是北京时间；排名按分数认自己", () => {
  assert.equal(beijingDay("2026-06-08T17:17:00Z"), "2026-06-09");
  const history = { list: [   // 落雪按上传时间倒序给
    sc(1006812, { play_time: "2026-06-08T14:17:00Z", upload_time: "2026-06-09T00:48:36Z" }),
    sc(142232, { clear: "failed", play_time: "2026-05-31T12:43:00Z", upload_time: "2026-05-31T15:03:53Z" }),
    sc(1003525, { play_time: "2026-05-30T04:09:00Z", upload_time: "2026-05-31T15:03:53Z" }),
    sc(992414, { upload_time: "2025-09-16T14:09:28Z" }),   // 没有游玩时间的用上传时间
  ] };
  const ranking = [{ ranking: 1, score: 1010000 }, { ranking: 2, score: 1009857 }, { ranking: 223, score: 1006812 }];
  const view = playerView({ best: sc(1006812, { rating: 15.3624, over_power: 76.812 }), history, ranking }, 13.5);
  assert.deepEqual(view, {
    score: 1006812, rank: "ssp", clear: "hard", fullCombo: null, fullChain: null,
    rating: 15.3624, op: 76.812, opMax: 82.5, ranking: 223, plays: 4, hidden: 1,
    history: [{ score: 992414, day: "2025-09-16" }, { score: 1003525, day: "2026-05-30" }, { score: 1006812, day: "2026-06-08" }],
    note: null,
  });
  // 落雪没给 Rating、OP 就自己算；排名里没有自己（不该发生）就不写
  const bare = playerView({ best: sc(1007725, { full_combo: "fullcombo" }), history: { list: [] }, ranking: null }, 15.5);
  assert.equal(bare.rating, 17.5225);
  assert.ok(Math.abs(bare.op - 88.3375) < 1e-9);
  assert.equal(bare.ranking, null);
  assert.equal(bare.note, V.chartHistoryShort(0, 0));
});

test("玩家那块：历史成绩没开放、没拿到、只有一条，都在曲线的位置写原因；WE 没有 Rating 和 OP", () => {
  const privacy = { error: new LxnsError("x", { status: 403, code: "privacy_history" }) };
  assert.equal(playerView({ best: sc(1000000), history: privacy }, 13.5).note, V.chartHistoryPrivate(true));
  assert.equal(playerView({ best: sc(1000000), history: privacy }, 13.5, { isSelf: false }).note, V.chartHistoryPrivate(false));
  assert.equal(playerView({ best: sc(1000000), history: { error: new Error("timeout") } }, 13.5).note, V.chartHistoryFailed);
  const one = playerView({ best: sc(1000000), history: { list: [sc(1000000, { upload_time: "2026-01-01T00:00:00Z" }), sc(10000, { upload_time: "2026-01-02T00:00:00Z" })] } }, 13.5);
  assert.deepEqual([one.plays, one.hidden, one.note], [2, 1, V.chartHistoryShort(2, 1)]);
  const worldsEnd = playerView({ best: sc(1008000, { rating: 0 }), history: { list: [] } }, null);
  assert.deepEqual([worldsEnd.rating, worldsEnd.op, worldsEnd.opMax], [null, null, null]);
});

test("buildData：曲目、谱面、每个判定扣几分、四档分数线；没有玩家时 player 是 null、表里没有「还差」", async (t) => {
  const catalog = await loadCatalog(t);
  const song = catalog.getSong(853);
  const data = buildData({ song, chart: catalog.chart(song, 3), catalog, extras, now: new Date("2026-10-17T04:00:00Z") });
  assert.deepEqual(data.song, { id: 853, title: "《最愛》 ～ Curse", artist: "James Landino", bpm: 157, version: "CRYSTAL", jacketId: 853, jacket: null,
    characters: [{ name: "ジュナ・サラキア", id: 8820, face: null, icon: null }] });
  assert.deepEqual(data.chart, { levelIndex: 3, level: "13+", constant: 13.5, fitConstant: null, designer: "谱师3",
    notes: { total: 1497, tap: 1457, hold: 10, slide: 10, air: 10, flick: 10 } });
  assert.deepEqual(data.unit, { justice: 6.68, attack: 340.7, miss: 674.7 });
  assert.deepEqual(data.lines.map((line) => [line.rank, line.justice, "gap" in line]), [["sssp", 149, false], ["sss", 374, false], ["ssp", 748, false], ["ss", 1497, false]]);
  assert.equal(data.player, null);
  assert.equal(data.time, "2026-10-17 12:00");
  const worldsEnd = buildData({ song: catalog.getSong(8020), chart: catalog.chart(catalog.getSong(8020), 5), catalog });
  assert.deepEqual([worldsEnd.song.jacketId, worldsEnd.chart.constant, worldsEnd.chart.kanji, worldsEnd.lines[0].rating], [3, null, "戻", null]);
});

test("buildData：拟合定数从 EazyChu 的表里拿（跟官方定数分开）；WE 和表里没有的谱面是 null", async (t) => {
  const catalog = await loadCatalog(t);
  const fitDiffs = { get: (songId, levelIndex) => (songId === 853 && levelIndex === 3 ? 13.502 : null) };
  const song = catalog.getSong(853);
  const data = buildData({ song, chart: catalog.chart(song, 3), catalog, fitDiffs });
  assert.deepEqual([data.chart.constant, data.chart.fitConstant], [13.5, 13.502]);
  // 拟合表里没有这张谱面：图上不写拟合定数
  const missing = buildData({ song: catalog.getSong(851), chart: catalog.chart(catalog.getSong(851), 3), catalog, fitDiffs });
  assert.equal(missing.chart.fitConstant, null);
  const worldsEnd = buildData({ song: catalog.getSong(8020), chart: catalog.chart(catalog.getSong(8020), 5), catalog, fitDiffs });
  assert.equal(worldsEnd.chart.fitConstant, null);
});

// ── 端到端 ──
async function setup(t) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-chart-bot-"));
  const lxns = createLxnsClient({ baseUrl: lx.apiBase, devToken: lx.devToken, retries: 0 });
  const oauth = createOAuth({ clientId: lx.clientId, clientSecret: lx.clientSecret, siteUrl: lx.site, apiBase: lx.apiBase });
  const vault = await openVault({ file: path.join(dir, "bindings.enc"), key: crypto.randomBytes(32) });
  const bindings = createBindings({ vault, lxns, oauth });
  const catalog = createCatalog({ lxns, cacheDir: path.join(dir, "cache") });
  await catalog.ready();
  const assets = createAssets({ cacheDir: path.join(dir, "assets"), baseUrl: lx.assetsBase });
  const renders = [];
  const renderer = { render: async (theme, data, options) => { renders.push({ theme, data, options }); return { buffer: PNG }; } };
  // 拟合定数表：853 MASTER 有一份，别的谱面没有（跟真表一样，WE 永远没有）
  const fitDiffs = { get: (songId, levelIndex) => (songId === 853 && levelIndex === 3 ? 13.502 : null) };
  const logs = [];
  const bot = createAnnaBot({
    allowedGroupIds: ["G1"], allowPrivateChat: true, admins: [], receiptDelayMs: 5000, generateCooldownMs: 0,
    qq: { appId: "1", clientSecret: "x", tokenUrl: qq.tokenUrl, apiBase: qq.apiBase, sandboxApiBase: qq.apiBase, sandbox: false,
      minSendIntervalMs: 0, jitterMs: 0, perTargetIntervalMs: 0, perTargetPerHour: 1000 },
  }, { lxns, oauth, bindings, catalog, assets, renderer, songExtras: extras, fitDiffs, log: (line) => logs.push(line) });
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
  return { lx, renders, group, last, authorize, logs };
}

const BOT = { id: "BOT", member_openid: "BOT", is_you: true, bot: true };
const hist = (score, day) => ({ id: 853, song_name: "x", level: "13+", level_index: 3, score, rating: 15, clear: "hard", full_combo: null, full_chain: null,
  rank: "ssp", play_time: day + "T12:00:00Z", upload_time: day + "T13:00:00Z" });

test("/谱面分析 端到端：没绑定也出图（只有分数线）；用法、找不到、没有这个难度各有回话；好友码绑定没开历史成绩写原因；授权的有曲线和排名；@别人", async (t) => {
  const s = await setup(t);
  const history = [hist(990000, "2026-01-02"), hist(1003000, "2026-02-03"), hist(450000, "2026-02-04"), hist(1006812, "2026-03-04")];
  const mine = [{ ...hist(1006812, "2026-03-04"), rating: 15.3624, over_power: 76.812 }];
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", scores: mine, history });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", scores: mine, history, ranking: [{ ranking: 1, score: 1010000 }, { ranking: 148, score: 1006812 }] });
  s.lx.addPlayer({ friendCode: FC3, name: "开了历史的", scores: mine, history, privacy: { history: true } });
  s.lx.state.assets.set("jacket/853", PNG);
  s.lx.state.assets.set("character/8820", PNG);

  // 没绑定：照样出图，没有「你的成绩」
  await s.group("/谱面分析 最愛");
  assert.equal(s.last().msg_type, 7);
  const plain = s.renders.at(-1);
  assert.equal(plain.theme, "chart");
  assert.deepEqual([plain.options.format, plain.options.quality], ["jpeg", 76]);
  assert.deepEqual([plain.data.song.id, plain.data.chart.levelIndex, plain.data.player], [853, 3, null]);
  // 版本和拟合定数也在数据里（图上写在难度旁边那格和版本那格）
  assert.deepEqual([plain.data.song.version, plain.data.chart.constant, plain.data.chart.fitConstant], ["CRYSTAL", 13.5, 13.502]);
  assert.match(plain.data.song.jacket, /^file:\/\/.*jacket[\\/]853\.png$/);
  assert.match(plain.data.song.characters[0].icon, /^file:\/\/.*character[\\/]8820\.png$/);

  await s.group("/谱面分析");
  assert.equal(s.last().content, V.chartUsage);
  await s.group("/谱面分析 完全不存在的歌 紫");
  assert.equal(s.last().content, V.songNotFound("完全不存在的歌"));
  await s.group("/谱面分析 最愛 黑");
  assert.equal(s.last().content, V.chartNoLevel("《最愛》 ～ Curse", "ULTIMA", ["BASIC", "ADVANCED", "EXPERT", "MASTER"]));
  await s.group("/谱面分析 曲851 we");
  assert.match(s.last().content, /有好几个 WORLD'S END 版[\s\S]*id8030[\s\S]*id8031/);
  const renders = s.renders.length;

  // 好友码绑定：落雪默认不开放历史成绩 → 曲线那里写原因；开发者接口没有排名
  await s.group("/绑定 " + FC1);
  await s.group("/谱面分析 id853 紫");
  const friend = s.renders.at(-1);
  assert.equal(s.renders.length, renders + 1);
  assert.deepEqual([friend.data.player.score, friend.data.player.ranking, friend.data.player.note], [1006812, null, V.chartHistoryPrivate(true)]);
  assert.equal(friend.data.lines[0].gap, 2188);

  // 授权绑定：曲线（90 万以下的不画）、排名都有，全走玩家接口
  await s.authorize("U2", FC2);
  const before = s.lx.state.requests.length;
  await s.group("/谱面分析 最愛", { user: "U2" });
  const oauth = s.renders.at(-1).data.player;
  assert.deepEqual(oauth.history.map((h) => h.score), [990000, 1003000, 1006812]);
  assert.deepEqual([oauth.plays, oauth.hidden, oauth.ranking, oauth.note], [4, 1, 148, null]);
  const asked = s.lx.state.requests.slice(before).filter((request) => request.path.includes("song_id=853"));
  assert.deepEqual(asked.map((request) => request.path.split("?")[0].replace(/^.*\/player/, "")).sort(), ["/bests", "/score/history", "/score/ranking"]);
  assert.ok(asked.every((request) => request.auth === "bearer"));

  // @ 没绑定的人：直接说，不出半张图
  const count = s.renders.length;
  await s.group("<@BOT> <@U9> /谱面分析 最愛", { mentions: [BOT, { id: "U9", member_openid: "U9" }] });
  assert.equal(s.last().content, V.otherNotBound);
  assert.equal(s.renders.length, count);

  // @ 开了历史成绩的好友码玩家：走开发者接口，曲线有了，排名没有，原因写「TA」
  await s.group("/绑定 " + FC3, { user: "U3" });
  const devBefore = s.lx.state.requests.length;
  await s.group("<@BOT> <@U3> /谱面分析 最愛", { user: "U2", mentions: [BOT, { id: "U3", member_openid: "U3" }] });
  const other = s.renders.at(-1).data.player;
  assert.deepEqual([other.history.length, other.ranking, other.note], [3, null, null]);
  assert.ok(s.lx.state.requests.slice(devBefore).filter((request) => request.path.includes("song_id=853")).every((request) => request.auth === "dev"));
  // @ 好友码玩家（没开历史）：原因写「TA」
  await s.group("<@BOT> <@U1> /谱面分析 最愛", { user: "U2", mentions: [BOT, { id: "U1", member_openid: "U1" }] });
  assert.equal(s.renders.at(-1).data.player.note, V.chartHistoryPrivate(false));
});

// ── 真的渲染一次 ──
const skip = !findBrowser() && "没找到 Chrome / Edge";

// 示例数据里的 "lxns:jacket/853" 不联网，换成空（曲绘、头像缺了主题也要照样出图）
function exampleData() {
  const raw = fs.readFileSync(path.join(ROOT, "themes", "chart", "examples", "preview-data.json"), "utf8");
  return JSON.parse(raw, (key, value) => (typeof value === "string" && value.startsWith("lxns:") ? null : value));
}

// 宽固定 2240；高跟着正文走，至少 2240 / 1.75 = 1280（只有分数线、没有玩家那块的时候就是这么高）
test("chart 主题：示例数据（带曲线）、没有玩家、玩家没曲线三种都能出图", { skip }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anna-scratch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const renderer = createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1, tmpDir: tmp });
  const full = exampleData();
  const out = await renderer.render("chart", full, { width: 2300, height: 1500, format: "jpeg" });
  assert.equal(out.width, 2240);
  assert.ok(out.height > 1280 && out.height < 1500, "带曲线的高度：" + out.height);
  // 没有玩家那块：顺便去掉拟合定数、换一个长版本名（PARADISE LOST），主题都要撑得住
  const bare = { ...exampleData(), player: null };
  bare.chart = { ...bare.chart, fitConstant: null };
  bare.song = { ...bare.song, version: "PARADISE LOST" };
  bare.lines = bare.lines.map(({ gap: _g, gapJustice: _j, ...line }) => line);
  const short = await renderer.render("chart", bare, { width: 2300, height: 1500, format: "jpeg" });
  assert.deepEqual([short.width, short.height], [2240, 1280]);
  const noted = exampleData();
  Object.assign(noted.player, { history: [], plays: 0, hidden: 0, note: V.chartHistoryPrivate(true) });
  const withNote = await renderer.render("chart", noted, { width: 2300, height: 1500, format: "jpeg" });
  assert.equal(withNote.width, 2240);
  await renderer.idle();
  assert.deepEqual(fs.readdirSync(tmp), [], "浏览器临时目录都删掉了");
});
