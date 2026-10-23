"use strict";
// OVER POWER 进度的算法（src/over-power.cjs）：每首歌只算 OP 最高的那张、满 OP 按最高定数，按全部曲目已解锁算；
// 分类按游戏里的顺序、版本按版本表归档、等级只算紫谱黑谱；推荐游玩打过的和没打过的分开；底色的条件。
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, bestCharts, summary, GENRES } = require("../src/over-power.cjs");

const VERSIONS = [
  { id: 0, title: "CHUNITHM", version: 10000 },
  { id: 1, title: "CHUNITHM PLUS", version: 10500 },
  { id: 15, title: "CHUNITHM SUN PLUS", version: 21500 },
  { id: 19, title: "CHUNITHM X-VERSE", version: 24000 },
  { id: 20, title: "CHUNITHM X-VERSE-X", version: 24500 },
];
const chart = (difficulty, level, value) => ({ difficulty, level, level_value: value, note_designer: "x", version: 10000 });
const song = (id, genre, version, charts, extra = {}) => ({ id, title: "曲" + id, artist: "x", genre, bpm: 180, version, difficulties: charts, ...extra });

// 1：原创、第一代，红黄绿紫都有；2：niconico、PLUS，ULTIMA 15.0 比紫谱高；3：东方，版本号 21600 不在版本表里（归到 SUN PLUS）；
// 4：已删除（disabled）；5：落雪新加的分类；8000：WORLD'S END
function catalogLike() {
  const songs = [
    song(1, "原创", 10000, [chart(0, "3", 3), chart(1, "7", 7), chart(2, "12", 12), chart(3, "14", 14)]),
    song(2, "niconico", 10500, [chart(2, "13", 13), chart(3, "14+", 14.5), chart(4, "15", 15)]),
    song(3, "东方Project", 21600, [chart(3, "13+", 13.5)]),
    song(4, "原创", 21500, [chart(3, "15", 15)], { disabled: true }),
    song(5, "新分类", 24000, [chart(3, "12", 12)]),
    song(8000, "WORLD'S END", 10000, [{ difficulty: 5, level: "0", level_value: 0, note_designer: "x", version: 10000, origin_id: 1, star: 5 }]),
  ];
  return { songs, versions: VERSIONS, isWorldsEnd: (item) => item.difficulties.some((d) => d.difficulty === 5) };
}

const score = (id, levelIndex, value, fullCombo = null, extra = {}) => ({ id, level_index: levelIndex, score: value, full_combo: fullCombo, clear: "clear", ...extra });
function myScores() {
  return [
    score(1, 0, 1010000, "alljusticecritical"),
    score(1, 3, 1010000, "alljusticecritical"),          // 满 OP：(14 + 3) × 5 = 85
    score(2, 2, 1009000, "alljustice"),                  // EXP 13.0：75 + 1500 × 0.0015 + 1 = 78.25
    score(2, 3, 1000000),                                // MAS 14.5：15.5 × 5 = 77.5，另一条记录是 FC → 78
    score(2, 3, 995000, "fullcombo"),
    score(3, 3, 387410, null, { clear: "failed" }),      // 被强制结束：OP 0，算没打过
    score(4, 3, 1010000, "alljusticecritical"),          // 已删除的曲目不算
    score(5, 3, 975000),                                 // 12.0 × 5 = 60
    score(8000, 5, 1000000),                             // WE 不算
    score(9999, 3, 1000000),                             // 曲库里没有
  ];
}

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, label + "：" + actual + " ≠ " + expected);

test("每张谱面：分数取最高的那条，FC / AJ 取所有记录里最好的；WE 和看不懂的记录跳过", () => {
  const best = bestCharts([...myScores(), score(1, 3, "x")]);
  assert.deepEqual([best.get("2:3").score, best.get("2:3").fullCombo], [1000000, "fullcombo"]);
  assert.equal(best.has("8000:5"), false);
  assert.equal(best.get("1:3").score, 1010000);
});

test("全曲：每首只算 OP 最高的那张（可以是红谱），满 OP 按最高定数（黑谱比紫谱高时是黑谱）；删掉的和 WE 不算", () => {
  const result = analyze({ catalog: catalogLike(), scores: myScores() });
  const byId = new Map(result.entries.map((entry) => [entry.song.id, entry]));
  assert.deepEqual([...byId.keys()], [1, 2, 3, 5]);
  near(byId.get(1).op, 85, "曲 1 理论值");
  assert.equal(byId.get(1).max, 85);
  near(byId.get(2).op, 78.25, "曲 2 取红谱");
  assert.deepEqual([byId.get(2).best.chart.difficulty, byId.get(2).top.chart.difficulty, byId.get(2).max], [2, 4, 90]);
  near(byId.get(2).charts.find((item) => item.chart.difficulty === 3).op, 78, "紫谱的最高分配上另一条记录的 FC");
  assert.deepEqual([byId.get(3).op, byId.get(3).best], [0, null], "被强制结束的记录 OP 是 0，当没打过");

  near(result.total.op, 85 + 78.25 + 60, "全曲 OP");
  assert.equal(result.total.max, 85 + 90 + 82.5 + 75);
  assert.deepEqual([result.total.count, result.total.played, result.total.percent], [4, 3, 67.14]);
});

test("分类按游戏里的顺序，落雪新加的分类排最后，没有歌的分类不列；版本按版本表归档（不在表里的取前一个版本）", () => {
  const result = analyze({ catalog: catalogLike(), scores: myScores() });
  assert.equal(GENRES.length, 7);
  assert.deepEqual(result.genres.map((group) => [group.name, group.count, group.played]),
    [["niconico", 1, 1], ["东方Project", 1, 0], ["原创", 1, 1], ["新分类", 1, 1]]);
  assert.deepEqual(result.versions.map((group) => [group.version, group.name, group.count]),
    [[10000, "CHUNITHM", 1], [10500, "CHUNITHM PLUS", 1], [21500, "SUN PLUS", 1], [24000, "X-VERSE", 1]], "第二代写全，不然一列里只有个「PLUS」");
  assert.equal(result.versions[2].percent, 0);
});

test("等级：只算紫谱、黑谱，每张各算各的（同一首歌的紫谱、黑谱落在各自的等级），从高到低、同一个数字 + 在前", () => {
  const result = analyze({ catalog: catalogLike(), scores: myScores() });
  assert.deepEqual(result.levels.map((group) => group.level), ["15", "14+", "14", "13+", "12"], "红谱的 13、12 和红黄绿的 7、3 都不算");
  const twelve = result.levels.find((group) => group.level === "12");
  assert.deepEqual([twelve.count, twelve.played, twelve.op, twelve.max, twelve.percent], [1, 1, 60, 75, 80], "曲 1 的红谱 12 不算");
  const fifteen = result.levels.find((group) => group.level === "15");
  assert.deepEqual([fifteen.count, fifteen.played, fifteen.max], [1, 0, 90], "黑谱 15 算；删掉的曲 4 的紫谱 15 不算");
});

test("百分比截到两位、不四舍五入（97.499 不能写成 97.50）；空的一组是 0", () => {
  assert.equal(summary([{ op: 97.4999, max: 100 }]).percent, 97.49);
  assert.equal(summary([{ op: 97.5, max: 100 }]).percent, 97.5);
  assert.equal(summary([]).percent, 0);
});

test("推荐游玩：打过的挑「推满能涨最多」的那张打过的谱面、按能涨多少排（理论值不列），没打过的按满 OP 排", () => {
  const { headroom } = analyze({ catalog: catalogLike(), scores: myScores() });
  assert.deepEqual(headroom.played.map((entry) => [entry.song.id, entry.pick.chart.difficulty, entry.gain]), [[5, 3, 15], [2, 3, 9.25]],
    "曲 2 黑谱没打过，打过的紫谱推满（87.5）比现在（78.25）多 9.25");
  assert.deepEqual(headroom.unplayed.map((entry) => entry.song.id), [3]);
});

test("底色：全部 MASTER、ULTIMA 到某个评级（没打过的算没到），金以上还要全曲 OP；四档都要 Rating 16", () => {
  const result = analyze({ catalog: catalogLike(), scores: myScores(), player: { rating: 16.5, rating_possession: "normal" } });
  const { possession } = result;
  assert.equal(possession.charts, 5);
  assert.deepEqual(possession.tiers.map((tier) => [tier.key, tier.below, tier.done]),
    [["silver", 2, false], ["gold", 3, false], ["platina", 3, false], ["rainbow", 4, false]]);
  assert.equal(possession.next.key, "silver");
  const gold = analyze({ catalog: catalogLike(), scores: myScores(), player: { rating: 16.5, rating_possession: "gold" } }).possession;
  assert.equal(gold.next.key, "platina");
  assert.deepEqual(gold.tiers.map((tier) => [tier.key, tier.below, tier.done]),
    [["silver", 2, true], ["gold", 3, true], ["platina", 3, false], ["rainbow", 4, false]],
    "游戏里拿到的那档和下面的都算达成（游戏只看解锁了的歌），「还差几张」照算但不当真");
  assert.equal(analyze({ catalog: catalogLike(), scores: myScores(), player: { rating_possession: "rainbow" } }).possession.next, null);
  assert.equal(analyze({ catalog: catalogLike(), scores: myScores(), player: { rating_possession: "copper" } }).possession.next.key, "silver");

  const one = { songs: [song(1, "原创", 10000, [chart(3, "14", 14)])], versions: VERSIONS, isWorldsEnd: () => false };
  const perfect = [score(1, 3, 1010000, "alljusticecritical")];
  assert.ok(analyze({ catalog: one, scores: perfect, player: { rating: 16 } }).possession.tiers.every((tier) => tier.done));
  assert.ok(analyze({ catalog: one, scores: perfect, player: { rating: 15.99 } }).possession.tiers.every((tier) => !tier.done), "Rating 不到 16 哪档都不算");
});

// ── /OP进度：整理成主题的数据、端到端、真的渲染一次 ──
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
const feature = require("../src/features/over-power.cjs");

const ROOT = path.resolve(__dirname, "..");
const FC1 = "123456789012345";
const FC2 = "102000000000002";
const withJackets = () => ({ ...catalogLike(), jacketId: (item) => item.id });
const PLAYER = { name: "测试玩家", rating: 16.53, rating_possession: "normal", name_plate: { id: 20002 }, character: { id: 8830 } };

test("buildData：全曲、分类、版本照算；等级只列 10～15+；底色写国服的叫法；名片板和页脚", () => {
  const data = feature.buildData({ player: PLAYER, scores: myScores(), catalog: withJackets(), now: new Date("2026-10-23T04:00:00Z") });
  assert.deepEqual(data.total, { percent: 67.14, op: 223.25, max: 332.5, played: 3, count: 4 });
  assert.deepEqual(data.genres.map((group) => group.name), ["niconico", "东方Project", "原创", "新分类"]);
  assert.deepEqual(data.versions.map((group) => group.name), ["CHUNITHM", "CHUNITHM PLUS", "SUN PLUS", "X-VERSE"]);
  assert.deepEqual(data.levels.map((group) => group.level), ["15", "14+", "14", "13+", "12"], "只算紫谱、黑谱");
  assert.deepEqual([data.possession.current, data.possession.currentName, data.possession.next], ["normal", "无底色", "silver"]);
  assert.deepEqual(data.possession.tiers.map((tier) => [tier.name, tier.rank, tier.percent]),
    [["蓝底", "S", null], ["金底", "S+", 97.5], ["铂底", "SS", 99], ["虹底", "SSS", 99.5]]);
  assert.deepEqual([data.player.name, data.player.plateId, data.player.characterId], ["测试玩家", 20002, 8830]);
  assert.equal(data.note, feature.NOTE);
  assert.equal(data.credit, "Generated by Anna Bot · 数据来自落雪查分器 · 2026-10-23 12:00");
});

test("buildData：推荐游玩里打过的画挑出来的那张和它的真实分数，没打过的画定数最高的那张", () => {
  const data = feature.buildData({ player: PLAYER, scores: myScores(), catalog: withJackets() });
  const view = (song) => [song.songId, song.levelIndex, song.constant, song.score, song.gap];
  assert.deepEqual(data.headroom.played.songs.map(view), [[5, 3, 12, 975000, 15], [2, 3, 14.5, 1000000, 9.25]],
    "曲 2 的黑谱没打过：画打过的紫谱和它的分数，不写「这张没打过」");
  assert.deepEqual(data.headroom.unplayed.songs.map(view), [[3, 3, 13.5, null, 82.5]]);
  assert.deepEqual([data.headroom.unplayed.count, data.headroom.unplayed.max], [1, 82.5]);
  assert.ok([...data.headroom.played.songs, ...data.headroom.unplayed.songs].every((song) => song.jacket === null));
});

test("attachAssets：两排曲绘、名牌版、角色一次要齐，没有的是 null", async () => {
  const data = feature.buildData({ player: PLAYER, scores: myScores(), catalog: withJackets() });
  const asked = [];
  const assets = { fileUrls: async (items) => { asked.push(...items); return items.map(([kind, id]) => (id === 2 ? null : "file:///" + kind + "/" + id + ".png")); } };
  await feature.attachAssets(data, assets);
  assert.deepEqual(asked, [["jacket", 3], ["jacket", 5], ["jacket", 2], ["plate", 20002], ["character", 8830]]);
  assert.deepEqual(data.headroom.played.songs.map((song) => song.jacket), ["file:///jacket/5.png", null]);
  assert.deepEqual([data.player.plate, data.player.character], ["file:///plate/20002.png", "file:///character/8830.png"]);
});

async function setup(t) {
  const qq = createMockOfficial();
  await qq.start();
  const { songs, versions } = catalogLike();
  const lx = createMockLxns({ songList: { songs, genres: [], versions } });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-op-bot-"));
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

test("/OP进度 端到端：好友码绑定请去授权；授权的出图（JPEG 76、倍率见 RENDER_SCALE），名片板和底色跟着出图数据一起取；带参数回用法", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", scores: myScores() });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", scores: myScores(), rating_possession: "silver" });
  for (const id of [2, 3, 5]) s.lx.state.assets.set("jacket/" + id, PNG);

  await s.group("/OP进度");
  assert.equal(s.last().content, V.needBinding);
  await s.group("/绑定 " + FC1);
  await s.group("/OP进度");
  assert.equal(s.last().content, V.needOAuth("OP进度"));
  assert.equal(s.renders.length, 0);

  await s.authorize("U2", FC2);
  const opts = { user: "U2" };
  await s.group("/op进度", opts);
  const first = s.renders.at(-1);
  assert.equal(first.theme, "over-power");
  assert.deepEqual([first.options.format, first.options.quality, first.options.scale, first.options.width, first.options.height],
    ["jpeg", 76, feature.RENDER_SCALE, 2700, 1780]);
  assert.deepEqual([first.options.maxBytes, first.options.fallbackQualities], [5_000_000, [68, 60, 52]]);
  assert.deepEqual([first.data.total.percent, first.data.player.name, first.data.possession.currentName], [67.14, "授权玩家", "蓝底"]);
  assert.match(first.data.headroom.played.songs[0].jacket, /^file:\/\/.*jacket[\\/]5\.png$/);
  assert.equal(s.last().msg_type, 7);

  await s.group("/OP", opts);
  assert.equal(s.renders.length, 2, "/op 也认");
  await s.group("/OP进度 金底", opts);
  assert.equal(s.last().content, V.overPowerUsage);
  assert.equal(s.renders.length, 2);
});

// ── 真的渲染一次 ──
const skip = !findBrowser() && "没找到 Chrome / Edge";

// 示例数据里的 "lxns:…" 不联网，换成空（曲绘、名牌版缺了主题也要照样出图）；油画、画框、立绘在 assets/，没准备时也照样出
function exampleData(file) {
  const raw = fs.readFileSync(path.join(ROOT, "themes", "over-power", "examples", file), "utf8");
  return JSON.parse(raw, (key, value) => (typeof value === "string" && value.startsWith("lxns:") ? null : value));
}

test("over-power 主题：没底色的、拿着蓝底的两份示例都能出图，固定 2700×1780", { skip }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anna-scratch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const renderer = createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1, tmpDir: tmp });
  for (const file of ["preview-data.json", "high.json"]) {
    const out = await renderer.render("over-power", exampleData(file), { width: 2700, height: 1780, format: "jpeg" });
    assert.deepEqual([out.width, out.height], [2700, 1780], file);
  }
  await renderer.idle();
  assert.deepEqual(fs.readdirSync(tmp), [], "浏览器临时目录都删掉了");
});
