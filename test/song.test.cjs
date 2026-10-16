"use strict";
// /单曲：先测整理出图数据（纯函数），再走一遍端到端（假 QQ + 假落雪，出图换成假的、记下主题拿到的数据），
// 最后用本机的 Chrome / Edge 把 song 主题的两份示例数据真的渲染一次。
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
const { loadSongExtras } = require("../src/song-extras.cjs");
const { V } = require("../src/voice.cjs");
const { buildData, attachAssets, MAX_CANDIDATES } = require("../src/features/song.cjs");

const ROOT = path.resolve(__dirname, "..");
const FC1 = "123456789012345";
const FC2 = "102000000000002";

const notes = (total) => ({ total, tap: total - 30, hold: 10, slide: 10, air: 10, flick: 0 });
const chart = (difficulty, level, value, designer, total, version = 14000) =>
  ({ difficulty, level, level_value: value, note_designer: designer, version, notes: notes(total) });

// 小曲库：850 原创曲四个难度；3 带 ULTIMA；8020 是 3 的 WE；「曲 1」～「曲 12」用来试认不准的情况
function songList() {
  const songs = [
    { id: 850, title: "《混乱》 ～ Muspell", artist: "Norn", genre: "原创", bpm: 165, version: 14000,
      difficulties: [chart(0, "3", 3, "ミストルティン", 397), chart(1, "6", 6, "ぴちネコ", 603), chart(2, "11", 11, "Moon Strix", 1181), chart(3, "13+", 13.7, "écologie", 1620)] },
    { id: 3, title: "B.B.K.K.B.K.K.", artist: "nora2r", genre: "其他游戏", bpm: 170, version: 10000,
      difficulties: [chart(3, "12+", 12.5, "ロシェ＠ペンギン", 960, 10000), chart(4, "13+", 13.7, "Redarrow", 1626, 10000)] },
    { id: 8020, title: "B.B.K.K.B.K.K.", artist: "nora2r", genre: "其他游戏", bpm: 170, version: 10500,
      difficulties: [{ difficulty: 5, level: "0", level_value: 0, note_designer: "x", version: 10500, origin_id: 3, kanji: "戻", star: 4 }] },
  ];
  for (let i = 1; i <= 12; i++) {
    songs.push({ id: 900 + i, title: "曲 " + i + " 号", artist: "x", genre: "原创", bpm: 180, version: 24000, difficulties: [chart(3, "14", 14, "x", 1000, 24000)] });
  }
  return {
    songs,
    genres: [],
    versions: [{ id: 0, title: "CHUNITHM", version: 10000 }, { id: 8, title: "CHUNITHM CRYSTAL", version: 14000 }, { id: 9, title: "CHUNITHM X-VERSE", version: 24000 }],
  };
}

// 落雪 Score 的形状
const sc = (id, level_index, score, extra = {}) => ({
  id, song_name: "曲" + id, level: "", level_index, score, rating: 15, clear: "clear", full_combo: null, full_chain: null, rank: "sss", ...extra,
});

const extras = {
  get: (id) => ({
    850: { releaseJP: "2019-12-19", characters: [{ name: "国服没有的角色", id: null }, { name: "ティータ・アヴェニアス", id: 8790 }] },
    3: { releaseJP: "2015-07-16", characters: [{ name: "只有名字", id: null }] },
  })[id] || null,
};

async function loadCatalog(t) {
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-song-"));
  t.after(async () => { await lx.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const catalog = createCatalog({ lxns: createLxnsClient({ baseUrl: lx.apiBase, retries: 0 }), cacheDir: dir });
  await catalog.ready();
  return catalog;
}

test("buildData：难度按顺序；同一谱面留最高分；没打过的 score 是 null；缺评级时按分数算；版本名去掉 CHUNITHM", async (t) => {
  const catalog = await loadCatalog(t);
  const song = catalog.getSong(850);
  const scores = [
    sc(850, 2, 1008120, { rank: undefined, clear: "hard", full_combo: "fullcombo", rating: 13.06 }),
    sc(850, 2, 1001000),
    sc(850, 0, 1009950, { rank: "sssp", full_combo: "alljusticecritical", full_chain: "fullchain2", rating: 5.15 }),
    sc(850, 3, 1006234, { rank: "ssp", clear: "brave", rating: 15.44 }),
  ];
  const data = buildData({ song, scores, catalog, extras, playerName: "测试玩家", now: new Date("2026-10-16T04:00:00Z") });
  assert.deepEqual(data.song, {
    id: 850, title: "《混乱》 ～ Muspell", artist: "Norn", genre: "原创", bpm: 165, version: "CRYSTAL", releaseJP: "2019-12-19",
    jacketId: 850, jacket: null,
    character: { name: "ティータ・アヴェニアス", id: 8790, icon: null },   // 好几个时先挑落雪认得的
  });
  assert.deepEqual(data.charts.map((c) => c.levelIndex), [0, 1, 2, 3]);
  assert.deepEqual(data.charts[1], { levelIndex: 1, level: "6", constant: 6, designer: "ぴちネコ", notes: 603, score: null });
  assert.deepEqual(data.charts[2], {
    levelIndex: 2, level: "11", constant: 11, designer: "Moon Strix", notes: 1181,
    score: 1008120, rank: "sss", clear: "hard", fullCombo: "fullcombo", fullChain: null, rating: 13.06,
  });
  assert.equal(data.charts[0].fullChain, "fullchain2");
  assert.equal(data.player, "测试玩家");
  assert.equal(data.time, "2026-10-16 12:00");
});

test("buildData：WE 曲绘用原曲、写属性和星级，对应角色用原曲的；无印版本就写 CHUNITHM；物量缺了是 null", async (t) => {
  const catalog = await loadCatalog(t);
  const we = buildData({ song: catalog.getSong(8020), scores: [], catalog, extras });
  assert.equal(we.song.jacketId, 3);
  assert.equal(we.song.version, "CHUNITHM");
  assert.deepEqual(we.song.character, { name: "只有名字", id: null, icon: null });
  assert.deepEqual(we.charts, [{ levelIndex: 5, level: "0", constant: null, designer: "x", notes: null, score: null, kanji: "戻", star: 4 }]);
  // 没有附加信息表也照样出数据
  const plain = buildData({ song: catalog.getSong(3), scores: [], catalog });
  assert.equal(plain.song.releaseJP, null);
  assert.equal(plain.song.character, null);
});

test("attachAssets：曲绘和落雪认得的角色头像换成本地地址；不认得的角色不去要图", async () => {
  const asked = [];
  const assets = { fileUrls: async (items) => { asked.push(...items); return items.map(([kind, id]) => "file:///" + kind + "/" + id + ".png"); } };
  const data = { song: { jacketId: 850, jacket: null, character: { name: "ティータ", id: 8790, icon: null } } };
  await attachAssets(data, assets);
  assert.deepEqual(asked, [["jacket", 850], ["character", 8790]]);
  assert.equal(data.song.jacket, "file:///jacket/850.png");
  assert.equal(data.song.character.icon, "file:///character/8790.png");
  const nameOnly = { song: { jacketId: 3, jacket: null, character: { name: "只有名字", id: null, icon: null } } };
  await attachAssets(nameOnly, assets);
  assert.deepEqual(asked.slice(2), [["jacket", 3]]);
  assert.equal(nameOnly.song.character.icon, null);
});

// ── 端到端 ──
async function setup(t) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-song-bot-"));
  const lxns = createLxnsClient({ baseUrl: lx.apiBase, devToken: lx.devToken, retries: 0 });
  const oauth = createOAuth({ clientId: lx.clientId, clientSecret: lx.clientSecret, siteUrl: lx.site });
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
  }, { lxns, oauth, bindings, catalog, assets, renderer, songExtras: extras, log: () => {} });
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
  return { lx, renders, group, last };
}

const BOT = { id: "BOT", member_openid: "BOT", is_you: true, bot: true };

test("/单曲 端到端：没绑定先提示；不写曲名给用法；找不到、认不准各有回话；认准了出图；@别人走开发者接口", async (t) => {
  const s = await setup(t);
  s.lx.addPlayer({ friendCode: FC1, name: "测试玩家", scores: [sc(850, 3, 1006234, { rank: "ssp", rating: 15.44 })] });
  s.lx.addPlayer({ friendCode: FC2, name: "另一位", scores: [sc(850, 0, 1009950, { rank: "sssp", rating: 5.15 })] });
  s.lx.state.assets.set("jacket/850", PNG);
  s.lx.state.assets.set("character/8790", PNG);

  await s.group("/单曲 混乱");
  assert.equal(s.last().content, V.needBinding);
  await s.group("/绑定 " + FC1);
  await s.group("/绑定 " + FC2, { user: "U2" });

  await s.group("/单曲");
  assert.equal(s.last().content, V.songUsage);
  await s.group("/单曲 完全不存在的歌");
  assert.equal(s.last().content, V.songNotFound("完全不存在的歌"));

  // 「曲」开头的有 12 首：列前 MAX_CANDIDATES 首，说还有几首
  await s.group("/单曲 曲");
  const ambiguous = s.last().content;
  assert.match(ambiguous, /对上了好几首/);
  assert.equal(ambiguous.split("\n").filter((line) => line.startsWith("id")).length, MAX_CANDIDATES);
  assert.match(ambiguous, new RegExp("还有 " + (12 - MAX_CANDIDATES) + " 首"));
  assert.equal(s.renders.length, 0, "认不准时不出图");

  await s.group("/单曲 混乱");
  assert.equal(s.last().msg_type, 7);
  const own = s.renders.at(-1);
  assert.equal(own.theme, "song");
  assert.deepEqual([own.options.format, own.options.quality], ["jpeg", 76]);
  assert.equal(own.data.song.id, 850);
  assert.equal(own.data.player, "测试玩家");
  assert.match(own.data.song.jacket, /^file:\/\/.*jacket[\\/]850\.png$/);
  assert.match(own.data.song.character.icon, /^file:\/\/.*character[\\/]8790\.png$/);
  assert.deepEqual(own.data.charts.map((c) => c.score), [null, null, null, 1006234]);

  // U1 @ U2：查 U2 的，只走开发者接口
  const before = s.lx.state.requests.length;
  await s.group("<@BOT> <@U2> /单曲 id850", { mentions: [BOT, { id: "U2", member_openid: "U2" }] });
  const other = s.renders.at(-1);
  assert.equal(other.data.player, "另一位");
  assert.deepEqual(other.data.charts.map((c) => c.score), [1009950, null, null, null]);
  const asked = s.lx.state.requests.slice(before).filter((request) => request.path.includes("song_id=850"));
  assert.ok(asked.length && asked.every((request) => request.auth === "dev"));
});

// ── 真的渲染一次 ──
const skip = !findBrowser() && "没找到 Chrome / Edge";

// 示例数据里的 "lxns:jacket/850" 不联网，换成空（曲绘、头像缺了主题也要照样出图）
function exampleData(file) {
  const raw = fs.readFileSync(path.join(ROOT, "themes", "song", "examples", file), "utf8");
  return JSON.parse(raw, (key, value) => (typeof value === "string" && value.startsWith("lxns:") ? null : value));
}

// 画布 1824×1140 + 四边羊皮纸 12 + 画框（左 97、右 95、上 97、下 95，按画框原图量的尺寸算，见 theme.js 的 framePadding）
test("song 主题：原创曲、五个难度两份示例数据都能出图，2040×1356", { skip }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anna-scratch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const renderer = createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1, tmpDir: tmp });
  for (const file of ["preview-data.json", "ultima.json"]) {
    const out = await renderer.render("song", exampleData(file), { width: 2100, height: 1400, format: "jpeg" });
    assert.deepEqual([out.width, out.height], [2040, 1356], file);
  }
  await renderer.idle();
  assert.deepEqual(fs.readdirSync(tmp), [], "浏览器临时目录都删掉了");
});

test("附加信息表：读得到就按 ID 给，文件缺了不报错", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-extras-"));
  try {
    const file = path.join(dir, "song-extras.json");
    fs.writeFileSync(file, JSON.stringify({ songs: { 850: { releaseJP: "2019-12-19" } } }));
    const table = loadSongExtras(file);
    assert.deepEqual(table.get(850), { releaseJP: "2019-12-19" });
    assert.equal(table.get(1), null);
    assert.equal(loadSongExtras(path.join(dir, "missing.json")).get(850), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
