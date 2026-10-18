"use strict";
// /分数列表（原名 /等级）：拆参数（等级、定数、页码、难度、版本、评级随便组合）、挑谱面、整理成绩（排序、包含关系的统计、评级筛选、分页），
// 再走一遍端到端（假 QQ + 假落雪，出图换成假的、记下主题拿到的数据），最后用本机的 Chrome / Edge 把 list 主题真的渲染一次。
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
const { createRenderer, findBrowser } = require("../src/renderer.cjs");
const { createAnnaBot } = require("../src/bot.cjs");
const { V } = require("../src/voice.cjs");
const { parseQuery, resolveCharts, buildData, describe, commandOf, pageCount, PER_PAGE, RENDER_SCALE } = require("../src/features/level.cjs");

const ROOT = path.resolve(__dirname, "..");
const FC1 = "123456789012345";
const FC2 = "102000000000002";

const VERSIONS = [
  { id: 0, title: "CHUNITHM", version: 10000 },
  { id: 11, title: "CHUNITHM PARADISE LOST", version: 15500 },
  { id: 18, title: "CHUNITHM VERSE", version: 23000 },
  { id: 19, title: "CHUNITHM X-VERSE", version: 24000 },
  { id: 20, title: "CHUNITHM X-VERSE-X", version: 24500 },
];
const chart = (difficulty, level, value) => ({ difficulty, level, level_value: value, note_designer: "x", version: 23000 });

// 小曲库：100 首（1000～1099）各有一张 Lv.14+ 的 MASTER，定数 14.5 / 14.6 / 14.7 轮着，单号是 X-VERSE、双号是 VERSE；
// 2000 有 EXPERT 13 和 ULTIMA 14+；3000 已删除（disabled）；8001 是 WE；4000 是 PARADISE LOST 的 Lv.13
function songList() {
  const songs = [];
  for (let i = 0; i < 100; i++) {
    songs.push({ id: 1000 + i, title: "曲" + (1000 + i), artist: "x", genre: "原创", bpm: 180, version: i % 2 ? 24000 : 23000,
      difficulties: [chart(2, "12", 12.0), chart(3, "14+", 14.5 + (i % 3) / 10)] });
  }
  songs.push({ id: 2000, title: "曲2000", artist: "x", genre: "原创", bpm: 180, version: 10000, difficulties: [chart(2, "13", 13.2), chart(4, "14+", 14.9)] });
  songs.push({ id: 3000, title: "删掉的曲", artist: "x", genre: "原创", bpm: 180, version: 10000, disabled: true, difficulties: [chart(3, "14+", 14.8)] });
  songs.push({ id: 4000, title: "曲4000", artist: "x", genre: "原创", bpm: 180, version: 15500, difficulties: [chart(3, "13", 13.0)] });
  songs.push({ id: 8001, title: "曲2000", artist: "x", genre: "WORLD'S END", bpm: 180, version: 15500,
    difficulties: [{ difficulty: 5, level: "0", level_value: 0, note_designer: "x", version: 15500, origin_id: 2000, kanji: "狂", star: 5 }] });
  return { songs, genres: [], versions: VERSIONS };
}

const score = (id, levelIndex, value, extra = {}) => ({ id, song_name: "曲" + id, level: "14+", level_index: levelIndex, score: value, rating: 16,
  clear: "clear", full_combo: null, full_chain: null, rank: "sss", ...extra });
// 1000～1039 打过：1,009,500 起每首少 500 分；1000 AJC、1001 AJ、1002 FC；2000 的 ULTIMA 打过；1000 还有一条更低的旧成绩、9999 是曲库里没有的
function myScores() {
  const list = [];
  for (let i = 0; i < 40; i++) {
    const fc = ["alljusticecritical", "alljustice", "fullcombo"][i] || null;
    list.push(score(1000 + i, 3, 1009500 - i * 500, { full_combo: fc, full_chain: i === 3 ? "fullchain2" : null, clear: i === 4 ? "catastrophy" : "clear" }));
  }
  list.push(score(2000, 4, 1005000, { rating: 16.9 }), score(1000, 3, 990000), score(9999, 3, 1000000));
  return list;
}

const catalogLike = () => {
  const { songs, versions } = songList();
  return { songs, versions, isWorldsEnd: (song) => song.difficulties.some((d) => d.difficulty === 5), jacketId: (song) => song.id };
};

test("拆参数：等级、定数、页码、难度、版本、评级随便组合；光秃秃的整数先当等级，有了等级或定数以后是页码", () => {
  const parse = (args) => {
    const q = parseQuery(args, { versions: VERSIONS });
    return { level: q.level, constant: q.constant, levelIndex: q.levelIndex, version: q.version?.title || null, rank: q.rank, page: q.page, unknown: q.unknown };
  };
  const base = { level: null, constant: null, levelIndex: null, version: null, rank: null, page: null, unknown: [] };
  assert.deepEqual(parse("14+"), { ...base, level: "14+" });
  assert.deepEqual(parse("Lv.14+ 2"), { ...base, level: "14+", page: 2 });
  assert.deepEqual(parse("lv 14＋　第３页"), { ...base, level: "14+", page: 3 }, "全角也认");
  assert.deepEqual(parse("14 p2"), { ...base, level: "14", page: 2 });
  assert.deepEqual(parse("14.5"), { ...base, constant: 14.5 });
  assert.deepEqual(parse("定数14 2"), { ...base, constant: 14, page: 2 }, "「定数」后面的整数也是定数");
  assert.deepEqual(parse("14+ 紫"), { ...base, level: "14+", levelIndex: 3 });
  assert.deepEqual(parse("ult 13+"), { ...base, level: "13+", levelIndex: 4 });
  assert.deepEqual(parse("13+ x-verse"), { ...base, level: "13+", version: "CHUNITHM X-VERSE" });
  assert.deepEqual(parse("xv"), { ...base, version: "CHUNITHM X-VERSE" }, "缩写");
  assert.deepEqual(parse("paradise lost 13"), { ...base, level: "13", version: "CHUNITHM PARADISE LOST" }, "两个词的版本名");
  assert.deepEqual(parse("chunithm x-verse-x 14"), { ...base, level: "14", version: "CHUNITHM X-VERSE-X" }, "拼得最长的那个版本");
  assert.deepEqual(parse("14 SSS以下"), { ...base, level: "14", rank: { key: "sss", mode: "below" } });
  assert.deepEqual(parse("14 sss 以下"), { ...base, level: "14", rank: { key: "sss", mode: "below" } });
  assert.deepEqual(parse("未达鸟加 14"), { ...base, level: "14", rank: { key: "sssp", mode: "below" } });
  assert.deepEqual(parse("14 s+以上"), { ...base, level: "14", rank: { key: "sp", mode: "above" } });
  assert.deepEqual(parse("14 ss"), { ...base, level: "14", rank: { key: "ss", mode: "exact" } });
  assert.deepEqual(parse("14+ 啥 呢"), { ...base, level: "14+", unknown: ["啥", "呢"] });
  assert.equal(parseQuery("14+ we").worldsEnd, true);
  assert.equal(parseQuery("master 2").level, "2", "没有等级时 2 先当等级（挑谱面时对不上再改当页码）");
});

test("挑谱面：等级、定数、难度、版本都对上；WE 和已删除的曲不列；「master 2」对不上 Lv.2 时改当第 2 页", () => {
  const catalog = catalogLike();
  const pick = (args) => resolveCharts(catalog, parseQuery(args, { versions: VERSIONS }));
  assert.equal(pick("14+").charts.length, 101, "100 张 MASTER + 2000 的 ULTIMA，不含删掉的 3000");
  assert.equal(pick("14.6").charts.length, 33);
  assert.deepEqual(pick("14+ 黑").charts.map(({ song }) => song.id), [2000]);
  assert.equal(pick("14+ x-verse").charts.length, 50);
  assert.deepEqual(pick("paradise lost").charts.map(({ song }) => song.id), [4000]);
  assert.equal(pick("16").charts.length, 0);
  const fallback = pick("master 2");
  assert.deepEqual([fallback.query.level, fallback.query.page, fallback.charts.length], [null, 2, 101], "MASTER 一共 101 张（含 4000 的 Lv.13）");
  assert.deepEqual([pick("12 2").query.level, pick("12 2").query.page], ["12", 2], "有等级时后面的数本来就是页码");
});

test("分页：非最后一页 78 张（18 + 12×5，最后一行排满），最后一页最多 80 张", () => {
  assert.deepEqual([0, 1, 78, 80, 81, 158, 159].map(pageCount), [1, 1, 1, 1, 2, 2, 3]);
});

test("buildData：打过的按分数从高到低、没打过的按定数排在后面；统计是包含关系；同一张谱只认最好的成绩；分页编号接着上一页", () => {
  const catalog = catalogLike();
  const { query, charts } = resolveCharts(catalog, parseQuery("14+", { versions: VERSIONS }));
  const data = buildData({ query, charts, scores: myScores(), catalog, page: 1, now: new Date("2026-10-17T04:00:00Z") });
  assert.deepEqual(data.title, { prefix: "Lv.", main: "14+", sub: "全谱面成绩" });
  assert.deepEqual([data.page, data.pages, data.charts.length], [1, 2, PER_PAGE]);
  assert.deepEqual(data.stats, { total: 101, played: 41, ajc: 1, aj: 2, fc: 3, sssp: 2, sss: 5 });
  assert.deepEqual(data.charts[0], { index: 1, jacketId: 1000, jacket: null, title: "曲1000", levelIndex: 3, level: "14+", constant: 14.5,
    score: 1009500, rank: "sssp", fullCombo: "alljusticecritical", clear: "clear", fullChain: null, rating: 16 });
  const playedScores = [...Array.from({ length: 40 }, (_, i) => 1009500 - i * 500), 1005000].sort((a, b) => b - a);
  assert.deepEqual(data.charts.slice(0, 41).map((c) => c.score), playedScores, "1000 那条更低的旧成绩不算，9999 不在曲库里");
  assert.deepEqual([data.charts[9].title, data.charts[10].title], ["曲2000", "曲1009"], "同分时定数高的在前");
  const unplayed = data.charts.slice(41);
  assert.ok(unplayed.every((c) => c.score === null && c.rank === null && c.rating === null));
  assert.deepEqual(unplayed.slice(0, 3).map((c) => c.constant), [14.7, 14.7, 14.7], "没打过的定数高的在前");
  assert.equal(data.credit, "Generated by Anna Bot · 数据来自落雪查分器 · 2026-10-17 12:00");
  const second = buildData({ query, charts, scores: myScores(), catalog, page: 2 });
  assert.deepEqual([second.page, second.charts.length, second.charts[0].index, second.charts.at(-1).index], [2, 23, 79, 101]);
  assert.equal(buildData({ query, charts, scores: myScores(), catalog, page: 9 }).page, 2, "页码超了按最后一页");
});

test("buildData：评级筛选（以下含没打过的、以上和正好不含）；副标题写筛选条件；翻页指令照着认得的写法拼", () => {
  const catalog = catalogLike();
  const build = (args) => {
    const { query, charts } = resolveCharts(catalog, parseQuery(args, { versions: VERSIONS }));
    return { query, data: buildData({ query, charts, scores: myScores(), catalog }) };
  };
  const below = build("14+ SSS以下");
  assert.deepEqual([below.data.stats.total, below.data.stats.played, below.data.stats.sss], [96, 36, 0]);
  assert.equal(below.data.title.sub, "未达 SSS");
  assert.equal(build("14+ sss以上").data.stats.total, 5);
  assert.equal(build("14+ sss").data.stats.total, 3, "正好 SSS：1,007,500～1,008,999");
  const version = build("x-verse 紫 ss以下");
  assert.deepEqual(version.data.title, { prefix: "", main: "X-VERSE", sub: "MASTER · 未达 SS" });
  assert.equal(describe(version.query), "MASTER · X-VERSE · 未达 SS");
  assert.equal(commandOf("分数列表", below.query, 2), "/分数列表 14+ SSS以下 2");
  assert.equal(commandOf("分数列表", version.query, 3), "/分数列表 MASTER X-VERSE SS以下 第3页", "没有等级或定数时页码要写「第N页」");
  assert.deepEqual(build("13.0").data.title, { prefix: "定数", main: "13.0", sub: "全谱面成绩" });
});

// ── 端到端 ──
async function setup(t) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-level-bot-"));
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
  const group = (content, { user = "U1" } = {}) => bot.handleEvent("GROUP_AT_MESSAGE_CREATE", {
    id: "m" + (++seq), group_openid: "G1", author: { member_openid: user }, content: " " + content,
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

test("/分数列表 端到端：好友码绑定请去授权；授权的出图（1.8 倍、JPEG 76）、翻页提示；用法、看不懂、WE、没有谱面、页码超了、只按评级都用文字回", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", scores: myScores() });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", scores: myScores() });
  for (let id = 1000; id < 1100; id++) s.lx.state.assets.set("jacket/" + id, PNG);
  s.lx.state.assets.set("jacket/2000", PNG);

  await s.group("/分数列表 14+");
  assert.equal(s.last().content, V.needBinding);
  await s.group("/绑定 " + FC1);
  await s.group("/分数列表 14+");
  assert.equal(s.last().content, V.needOAuth("分数列表"));
  assert.equal(s.renders.length, 0);

  await s.authorize("U2", FC2);
  const opts = { user: "U2" };
  await s.group("/分数列表 14+", opts);
  const first = s.renders.at(-1);
  assert.equal(first.theme, "list");
  assert.deepEqual([first.options.format, first.options.quality, first.options.scale], ["jpeg", 76, RENDER_SCALE]);
  assert.deepEqual([first.data.page, first.data.pages, first.data.charts.length, first.data.stats.played], [1, 2, 78, 41]);
  assert.match(first.data.charts[0].jacket, /^file:\/\/.*jacket[\\/]1000\.png$/);
  assert.equal(s.last().msg_type, 7);
  assert.equal(s.last().content, V.levelPage(1, 2, "/分数列表 14+ 2"));
  await s.group("/分数列表 14+ 2", opts);
  assert.deepEqual([s.renders.at(-1).data.page, s.last().content], [2, V.levelPage(2, 2, null)]);
  await s.group("/lv 14+ 黑", opts);
  assert.deepEqual([s.renders.at(-1).data.charts.length, s.last().content], [1, undefined], "只有一页不带图注");

  const count = s.renders.length;
  await s.group("/分数列表", opts);
  assert.equal(s.last().content, V.levelUsage);
  await s.group("/分数列表 14+ 啥", opts);
  assert.equal(s.last().content, V.levelUnknown(["啥"]));
  await s.group("/分数列表 we", opts);
  assert.equal(s.last().content, V.levelNoWorldsEnd);
  await s.group("/分数列表 16", opts);
  assert.equal(s.last().content, V.levelEmpty("Lv.16"));
  await s.group("/分数列表 14+ 3", opts);
  assert.equal(s.last().content, V.levelNoPage(2));
  await s.group("/分数列表 SSS以下", opts);
  assert.equal(s.last().content, V.levelNeedMain);
  await s.group("/分数列表 14+ 黑 sss以上", opts);
  assert.equal(s.last().content, V.levelEmpty("Lv.14+ · ULTIMA · SSS 以上"), "按评级筛先读成绩，一张不剩用文字回");
  assert.equal(s.renders.length, count);

  // 按评级筛：成绩在排队前读好，出图时不再读一遍
  const before = s.lx.state.requests.filter((r) => r.path.endsWith("/scores")).length;
  await s.group("/分数列表 14+ SSS以下", opts);
  assert.deepEqual([s.renders.at(-1).data.stats.total, s.renders.at(-1).data.title.sub], [96, "未达 SSS"]);
  assert.equal(s.lx.state.requests.filter((r) => r.path.endsWith("/scores")).length, before + 1);
  // master 2：没有 Lv.2 的 MASTER，当成第 2 页
  await s.group("/分数列表 master 2", opts);
  assert.deepEqual([s.renders.at(-1).data.page, s.renders.at(-1).data.title.main], [2, "MASTER"]);
});

// ── 真的渲染一次 ──
const skip = !findBrowser() && "没找到 Chrome / Edge";

// 示例数据里的 "lxns:jacket/…" 不联网，换成空（曲绘缺了主题也要照样出图）
function exampleData(file) {
  const raw = fs.readFileSync(path.join(ROOT, "themes", "list", "examples", file), "utf8");
  return JSON.parse(raw, (key, value) => (typeof value === "string" && value.startsWith("lxns:") ? null : value));
}

// 宽固定 2060（珐琅框加五列卡片）；高跟着卡片走，凑成 5 的倍数（1.8 倍出图时才是整像素）
test("list 主题：满页、带没打过的、大标题是版本名三种都能出图", { skip }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anna-scratch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const renderer = createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1, tmpDir: tmp });
  for (const file of ["preview-data.json", "page-2.json", "version.json"]) {
    const out = await renderer.render("list", exampleData(file), { width: 2100, height: 1500, format: "jpeg" });
    assert.equal(out.width, 2060, file);
    assert.equal(out.height % 5, 0, file + " 的高度：" + out.height);
  }
  await renderer.idle();
  assert.deepEqual(fs.readdirSync(tmp), [], "浏览器临时目录都删掉了");
});
