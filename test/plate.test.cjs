"use strict";
// /牌子进度：认版本名（缩写、第一代的叫法、不写就是当前版本）、挑这个版本的曲目、整理成绩（统计表每格各算各的、卡片排序、
// 称号拿没拿到、左下角总览），再走一遍端到端（假 QQ + 假落雪，出图换成假的、记下主题拿到的数据），
// 最后用本机的 Chrome / Edge 把 plate 主题真的渲染一次。
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
const { pickVersion, songsOf, buildData, attachAssets, TROPHIES, RENDER_SCALE } = require("../src/features/plate.cjs");

const ROOT = path.resolve(__dirname, "..");
const FC1 = "123456789012345";
const FC2 = "102000000000002";

const VERSIONS = [
  { id: 0, title: "CHUNITHM", version: 10000 },
  { id: 1, title: "CHUNITHM PLUS", version: 10500 },
  { id: 15, title: "CHUNITHM SUN PLUS", version: 21500 },
  { id: 16, title: "CHUNITHM LUMINOUS", version: 22000 },
  { id: 17, title: "CHUNITHM LUMINOUS PLUS", version: 22500 },
  { id: 19, title: "CHUNITHM X-VERSE", version: 24000 },
  { id: 20, title: "CHUNITHM X-VERSE-X", version: 24500 },
];
const chart = (difficulty, level, value) => ({ difficulty, level, level_value: value, note_designer: "x", version: 21500 });
const song = (id, version, master, extra = {}) => ({ id, title: "曲" + id, artist: "x", genre: "原创", bpm: 180, version,
  difficulties: [chart(0, "5", 5), chart(1, "8", 8), chart(2, "12", 12), chart(3, ...master)], ...extra });

// 小曲库：SUN PLUS 五首（2400～2404，2404 还有 ULTIMA），外加一首已删除的（2405）和一首 WE（8100）；
// LUMINOUS 一首（2500），第一代、PLUS 各一首，X-VERSE 两首（当前版本），X-VERSE-X 还没有曲
function songList() {
  const songs = [
    song(2400, 21500, ["15+", 15.5]), song(2401, 21500, ["15", 15.0]), song(2402, 21500, ["14+", 14.6]), song(2403, 21500, ["13", 13.0]),
    song(2404, 21500, ["14", 14.2]),
    song(2405, 21500, ["14", 14.0], { disabled: true }),
    song(2500, 22000, ["14", 14.0]), song(1, 10000, ["13", 13.0]), song(100, 10500, ["13+", 13.7]),
    song(3000, 24000, ["14+", 14.7]), song(3001, 24000, ["13+", 13.5]),
  ];
  songs[4].difficulties.push(chart(4, "15", 15.2));
  songs.push({ id: 8100, title: "曲2400", artist: "x", genre: "WORLD'S END", bpm: 180, version: 21500,
    difficulties: [{ difficulty: 5, level: "0", level_value: 0, note_designer: "x", version: 21500, origin_id: 2400, kanji: "狂", star: 5 }] });
  return { songs, genres: [], versions: VERSIONS };
}

const isWorldsEnd = (item) => item.difficulties.some((d) => d.difficulty === 5);
const catalogLike = () => {
  const { songs, versions } = songList();
  const latest = Math.max(...songs.map((item) => item.version));
  return { songs, versions, isWorldsEnd, jacketId: (item) => item.id, currentVersion: () => ({ version: latest, title: "CHUNITHM X-VERSE" }) };
};

const score = (id, levelIndex, value, extra = {}) => ({ id, song_name: "曲" + id, level: "x", level_index: levelIndex, score: value, rating: 15,
  clear: "clear", full_combo: null, full_chain: null, ...extra });
// SUN PLUS 的成绩：每格达成几首在下面的测试里数着写；2403 的 EXPERT 最高分那条不是 AJ，AJ 在另一条分低一点的记录里
function myScores() {
  return [
    score(2400, 0, 1010000, { full_combo: "alljusticecritical" }), score(2400, 1, 1009000, { full_combo: "alljustice" }),
    score(2400, 2, 1007600), score(2400, 3, 998000, { clear: "hard" }),
    score(2401, 0, 1009000), score(2401, 1, 1008000), score(2401, 2, 980000),
    score(2402, 0, 1010000, { full_combo: "alljustice" }), score(2402, 1, 1010000, { full_combo: "alljustice" }),
    score(2402, 2, 1009000, { full_combo: "alljustice" }), score(2402, 3, 1009500, { full_combo: "alljusticecritical", full_chain: "fullchain2" }),
    score(2402, 3, 1000000),
    score(2403, 0, 950000), score(2403, 2, 1007000), score(2403, 2, 1006000, { full_combo: "alljustice" }), score(2403, 3, 1007500),
    score(2404, 3, 1009000, { full_combo: "fullcombo" }), score(2404, 4, 1009900),
    score(2500, 0, 1010000, { full_combo: "alljustice" }), score(2500, 1, 1010000, { full_combo: "alljustice" }),
    score(2500, 2, 1010000, { full_combo: "alljustice" }), score(2500, 3, 1010000, { full_combo: "alljusticecritical" }),
    score(9999, 3, 1000000),
  ];
}

test("认版本：缩写、PLUS 写成 +、第一代叫 ORIGIN / 初代 / 无印；不写是当前版本；夹了别的东西算看不懂", () => {
  const catalog = catalogLike();
  const pick = (text) => {
    const result = pickVersion(text, catalog);
    return result.version ? result.version.version : result;
  };
  assert.equal(pick(""), 24000);
  for (const text of ["SUN PLUS", "sun+", "ＳＵＮ＋", "CHUNITHM SUN PLUS"]) assert.equal(pick(text), 21500, text);
  for (const text of ["lmn+", "LUMINOUS PLUS"]) assert.equal(pick(text), 22500, text);
  for (const text of ["xv", "X-VERSE"]) assert.equal(pick(text), 24000, text);
  for (const text of ["origin", "初代", "无印", "CHUNITHM"]) assert.equal(pick(text), 10000, text);
  for (const text of ["origin plus", "初代+", "無印 PLUS"]) assert.equal(pick(text), 10500, text);
  assert.deepEqual(pick("啥"), { unknown: ["啥"] });
  assert.deepEqual(pick("SUN+ 14+"), { unknown: ["14+"] });
  assert.deepEqual(pick("SUN+ 紫"), { unknown: ["SUN+ 紫"] });
});

test("挑曲目：这个版本的、不含 WE 和已删除的；版本表里还没有曲的版本挑出来是空的", () => {
  const catalog = catalogLike();
  const ids = (version) => songsOf(catalog, VERSIONS.find((v) => v.version === version)).map((item) => item.id);
  assert.deepEqual(ids(21500), [2400, 2401, 2402, 2403, 2404]);
  assert.deepEqual(ids(10000), [1]);
  assert.deepEqual(ids(24000), [3000, 3001]);
  assert.deepEqual(ids(24500), []);
});

function build(versionNumber, scores = myScores(), player = { name: "测试玩家", rating: 16.53, name_plate: { id: 20002 }, character: { id: 8830 } }) {
  const catalog = catalogLike();
  const version = VERSIONS.find((v) => v.version === versionNumber);
  return buildData({ version, songs: songsOf(catalog, version), scores, player, catalog, now: new Date("2026-10-18T04:00:00Z") });
}

test("buildData：统计表每格各算各的（S、SSS 看分数，AJ 看所有记录）；ULTIMA、别的版本、曲库里没有的成绩不算", () => {
  const data = build(21500);
  assert.equal(data.table.total, 5);
  assert.deepEqual(data.table.rows.map((row) => [row.key, row.name, row.counts]), [
    ["s", "Spirit", [3, 3, 4, 4]],
    ["sss", "Tribute", [3, 3, 2, 3]],
    ["aj", "Legend", [2, 2, 2, 1]],
  ]);
  assert.deepEqual([data.version, data.title], [{ id: 21500, name: "SUN PLUS", title: "CHUNITHM SUN PLUS" }, { main: "SUN PLUS", sub: "牌子进度" }]);
  assert.deepEqual([data.player.name, data.player.plateId, data.player.characterId], ["测试玩家", 20002, 8830]);
  assert.equal(data.credit, "Generated by Anna Bot · 数据来自落雪查分器 · 2026-10-18 12:00");
});

test("buildData：卡片画 MASTER，按分数从高到低、没打过的排最后；不再带 BASIC～EXPERT 的小牌子", () => {
  const { cards } = build(21500);
  assert.deepEqual(cards.map((card) => [card.index, card.songId, card.score, card.rank]), [
    [1, 2402, 1009500, "sssp"], [2, 2404, 1009000, "sssp"], [3, 2403, 1007500, "sss"], [4, 2400, 998000, "sp"], [5, 2401, null, null],
  ]);
  assert.ok(cards.every((card) => !("tiers" in card)), "作者 2026-10-19 把卡片脚下的三颗小牌子去掉了，数据里也不再带 tiers");
  assert.deepEqual([cards[0].fullCombo, cards[0].fullChain, cards[0].constant, cards[0].level], ["alljusticecritical", "fullchain2", 14.6, "14+"],
    "同一张谱只认分最高的那条");
  assert.deepEqual([cards[3].clear, cards[4].fullCombo, cards[4].levelIndex], ["hard", null, 3]);
});

test("buildData：左下角总览（各等级谱面数、最难三档 MASTER）；称号全达成才亮，还没有称号的版本是空的", () => {
  const data = build(21500);
  assert.deepEqual([data.overview.songs, data.overview.charts], [5, 20]);
  assert.deepEqual(data.overview.levels.map((item) => item.level + ":" + item.count), ["15+:1", "15:1", "14+:1", "14:1", "13+:0", "13:1"]);
  assert.deepEqual(data.overview.hard.map((row) => [row.level, row.count, row.jackets.map((item) => item.jacketId)]),
    [["15+", 1, [2400]], ["15", 1, [2401]], ["14+", 1, [2402]]]);
  assert.deepEqual(data.overview.trophies.map((item) => [item.id, item.name, item.done]),
    [[8799, "Spirit of SUN PLUS", false], [8800, "Tribute of SUN PLUS", false], [8801, "Legend of SUN PLUS", false]]);

  const luminous = build(22000);
  assert.deepEqual(luminous.overview.trophies.map((item) => item.done), [true, true, true]);
  assert.deepEqual(build(10000).overview.trophies.map((item) => item.name), ["Spirit of ORIGIN", "Tribute of ORIGIN", "Legend of ORIGIN"]);
  assert.deepEqual(build(10500).overview.trophies.map((item) => item.name)[0], "Spirit of ORIGIN PLUS");
  assert.deepEqual(build(24000).overview.trophies, [], "X-VERSE 还没有称号，照样能查");
  assert.deepEqual(build(24000, []).table.rows.map((row) => row.counts), [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "一首没打过也能出");
});

test("称号表：十九个版本，每个版本三个 ID 连着（Spirit、Tribute、Legend）", () => {
  assert.equal(TROPHIES.size, 19);
  for (const [version, ids] of TROPHIES) {
    assert.equal(ids.length, 3, String(version));
    assert.deepEqual([ids[1] - ids[0], ids[2] - ids[1]], [1, 1], String(version));
  }
  assert.deepEqual(TROPHIES.get(21500), [8799, 8800, 8801]);
  assert.deepEqual(TROPHIES.get(23000), [9705, 9706, 9707]);
});

test("attachAssets：卡片和总览的曲绘、称号图、名牌版、角色一次要齐，没有的是 null", async () => {
  const data = build(21500);
  const asked = [];
  const assets = { fileUrls: async (items) => { asked.push(...items); return items.map(([kind, id]) => (id === 2401 ? null : "file:///" + kind + "/" + id + ".png")); } };
  await attachAssets(data, assets);
  assert.equal(asked.length, 5 + 3 + 3 + 2);
  assert.equal(data.cards[0].jacket, "file:///jacket/2402.png");
  assert.equal(data.cards[4].jacket, null);
  assert.equal(data.overview.hard[0].jackets[0].jacket, "file:///jacket/2400.png");
  assert.deepEqual(data.overview.trophies.map((item) => item.image), ["file:///trophy/8799.png", "file:///trophy/8800.png", "file:///trophy/8801.png"]);
  assert.deepEqual([data.player.plate, data.player.character], ["file:///plate/20002.png", "file:///character/8830.png"]);
});

// ── 端到端 ──
async function setup(t) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-plate-bot-"));
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

test("/牌子进度 端到端：好友码绑定请去授权；授权的出图（JPEG 76、倍率见 RENDER_SCALE），不写版本是当前版本；看不懂、没有曲目用文字回", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", scores: myScores() });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", scores: myScores() });
  for (const id of [2400, 2401, 2402, 2403, 2404, 3000, 3001]) s.lx.state.assets.set("jacket/" + id, PNG);
  for (const id of [8799, 8800, 8801]) s.lx.state.assets.set("trophy/" + id, PNG);

  await s.group("/牌子进度 SUN+");
  assert.equal(s.last().content, V.needBinding);
  await s.group("/绑定 " + FC1);
  await s.group("/牌子进度 SUN+");
  assert.equal(s.last().content, V.needOAuth("牌子进度"));
  assert.equal(s.renders.length, 0);

  await s.authorize("U2", FC2);
  const opts = { user: "U2" };
  await s.group("/牌子进度 SUN+", opts);
  const first = s.renders.at(-1);
  assert.equal(first.theme, "plate");
  assert.deepEqual([first.options.format, first.options.quality, first.options.scale], ["jpeg", 76, RENDER_SCALE]);
  assert.deepEqual([first.data.version.name, first.data.cards.length, first.data.table.rows[0].counts], ["SUN PLUS", 5, [3, 3, 4, 4]]);
  assert.deepEqual([first.data.player.name, first.data.player.rating], ["授权玩家", 17], "名片板上的名字和总 Rating 跟着出图数据一起取");
  assert.match(first.data.cards[0].jacket, /^file:\/\/.*jacket[\\/]2402\.png$/);
  assert.match(first.data.overview.trophies[0].image, /^file:\/\/.*trophy[\\/]8799\.png$/);
  assert.equal(s.last().msg_type, 7);

  await s.group("/牌子", opts);
  assert.deepEqual([s.renders.at(-1).data.version.name, s.renders.at(-1).data.overview.trophies.length], ["X-VERSE", 0], "不写版本是当前版本，还没有称号也照样出图");

  const count = s.renders.length;
  await s.group("/牌子进度 啥", opts);
  assert.equal(s.last().content, V.plateUnknown(["啥"]));
  await s.group("/牌子进度 X-VERSE-X", opts);
  assert.equal(s.last().content, V.plateNoSongs("X-VERSE-X"));
  assert.equal(s.renders.length, count);
});

// ── 真的渲染一次 ──
const skip = !findBrowser() && "没找到 Chrome / Edge";

// 示例数据里的 "lxns:…" 不联网，换成空（曲绘、称号图缺了主题也要照样出图）；油画和立绘在 assets/，没准备时也照样出
function exampleData(file) {
  const raw = fs.readFileSync(path.join(ROOT, "themes", "plate", "examples", file), "utf8");
  return JSON.parse(raw, (key, value) => (typeof value === "string" && value.startsWith("lxns:") ? null : value));
}

// 宽固定 4432（100px 实物框加十列卡片）；高跟着曲数走，凑成 10 的倍数（1.5、1.4 倍出图时都是整像素）
test("plate 主题：SUN PLUS、曲目最多的 NEW、还没有称号的 X-VERSE 都能出图", { skip }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anna-scratch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const renderer = createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1, tmpDir: tmp });
  for (const file of ["preview-data.json", "new.json", "xverse.json"]) {
    const out = await renderer.render("plate", exampleData(file), { width: 4600, height: 2400, format: "jpeg" });
    assert.equal(out.width, 4432, file);
    assert.equal(out.height % 10, 0, file + " 的高度：" + out.height);
  }
  await renderer.idle();
  assert.deepEqual(fs.readdirSync(tmp), [], "浏览器临时目录都删掉了");
});
