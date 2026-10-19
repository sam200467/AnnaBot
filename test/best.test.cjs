"use strict";
// /b50、/b30、/aj30、/aj50：先测挑歌和整理出图数据（纯函数），再走一遍端到端（假 QQ + 假落雪，出图换成假的、记下主题拿到的数据），
// 最后用本机的 Chrome / Edge 把 best 主题真的渲染一次。
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
const panel = require("../src/command-panel.cjs");
const features = require("../src/features/index.cjs");
const { buildData, attachAssets, pickBest30, pickAj30, pickAj50, pickFit30, rankScores } = require("../src/features/best.cjs");

const ROOT = path.resolve(__dirname, "..");
const FC1 = "123456789012345";
const FC2 = "102000000000002";
const FC3 = "103000000000003";
const FC4 = "104000000000004";

// 小曲库：旧版本（13000）1～41 号，41 号被落雪标成 disabled；当前版本（24000）101～130 号；8001 是 1 号的 WE
function songList() {
  const song = (id, version, constant, extra = {}) => ({
    id, title: "曲" + id, artist: "x", genre: "原创", bpm: 180, version, ...extra,
    difficulties: [{ difficulty: 3, level: "14", level_value: constant, note_designer: "x", version }],
  });
  const songs = [];
  for (let id = 1; id <= 41; id++) songs.push(song(id, 13000, 14 + (id % 10) / 10, id === 41 ? { disabled: true } : {}));
  for (let id = 101; id <= 130; id++) songs.push(song(id, 24000, 14 + (id % 10) / 10));
  songs.push({ id: 8001, title: "曲1", artist: "x", genre: "原创", bpm: 180, version: 13000,
    difficulties: [{ difficulty: 5, level: "0", level_value: 0, note_designer: "x", version: 13000, origin_id: 1, kanji: "狂", star: 3 }] });
  return { songs, genres: [], versions: [{ id: 1, title: "CHUNITHM AMAZON", version: 13000 }, { id: 2, title: "CHUNITHM X-VERSE", version: 24000 }] };
}

// 落雪 Score 的形状（带分数的那种）
const sc = (id, rating, extra = {}) => ({
  id, song_name: "曲" + id, level: "14", level_index: 3, score: 1007000, rating,
  clear: "clear", full_combo: null, full_chain: null, rank: "sss", ...extra,
});
const range = (from, to, rating) => Array.from({ length: to - from + 1 }, (_, i) => sc(from + i, rating(i)));
const ajRange = (from, to, rating) => range(from, to, rating).map((score) => ({ ...score, full_combo: "alljustice" }));
const ids = (list) => list.map((score) => score.id);

async function loadCatalog(t) {
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-best-"));
  t.after(async () => { await lx.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const catalog = createCatalog({ lxns: createLxnsClient({ baseUrl: lx.apiBase, retries: 0 }), cacheDir: dir });
  await catalog.ready();
  return catalog;
}

test("rankScores：同一张谱面留最好的一条，WE 不算，按单曲 Rating 排、一样高时分数高的在前", () => {
  const list = rankScores([sc(1, 15), sc(2, 16), sc(1, 15.5), sc(8001, 20, { level_index: 5 }), sc(3, 16, { score: 1009000 })]);
  assert.deepEqual(list.map((score) => score.id + ":" + score.rating), ["3:16", "2:16", "1:15.5"]);
});

test("/b30 挑歌：授权读全部成绩取前 30（去掉 disabled）；好友码只能从旧曲前 30 + 新曲前 20 里挑", async (t) => {
  const catalog = await loadCatalog(t);
  const old = range(1, 40, (i) => 16 - i * 0.01);
  const fresh = range(101, 125, (i) => 17 - i * 0.01);

  const full = pickBest30({ scores: [...old, ...fresh, sc(41, 18)], bests: null, catalog });
  assert.equal(full.exact, true);
  assert.deepEqual(ids(full.list), [...ids(fresh), 1, 2, 3, 4, 5]);

  // 新曲前 20 全挤进了前 30：第 21 首往后的新曲落雪没给，可能漏
  const partial = pickBest30({ scores: null, bests: { bests: old.slice(0, 30), new_bests: fresh.slice(0, 20), selections: [] }, catalog });
  assert.equal(partial.exact, false);
  assert.deepEqual(ids(partial.list), [...ids(fresh.slice(0, 20)), ...ids(old.slice(0, 10))]);

  // 新曲没占满前 30 的 20 个位置，或者新曲本来就不到 20 首：不会漏
  const lowFresh = range(101, 120, (i) => 15.95 - i * 0.01);
  assert.equal(pickBest30({ scores: null, bests: { bests: old.slice(0, 30), new_bests: lowFresh }, catalog }).exact, true);
  assert.equal(pickBest30({ scores: null, bests: { bests: old.slice(0, 30), new_bests: fresh.slice(0, 12) }, catalog }).exact, true);
});

test("buildData /b50：旧曲 30 + 新曲 20 两栏，均值按空位数算，Rating 是 50 首的平均；定数、新曲标记、北京时间", async (t) => {
  const catalog = await loadCatalog(t);
  const old = range(1, 30, (i) => 16.3 - i * 0.01);
  const fresh = range(101, 120, (i) => 15.5 - i * 0.01);
  const player = {
    name: "测试玩家", level: 50, reborn_count: 1, rating: 16.01,
    trophy: { id: 1, name: "测试称号", color: "gold" }, name_plate: { id: 2, name: "x" }, character: { id: 3, name: "x", level: 10 },
  };
  const data = buildData({ mode: "b50", player, bests: { bests: old, new_bests: fresh, selections: [] }, catalog, now: new Date("2026-10-13T16:05:00Z") });

  assert.equal(data.mode, "b50");
  assert.equal(data.time, "2026-10-14 00:05");
  assert.equal(data.exact, true);
  assert.deepEqual(data.player, {
    name: "测试玩家", level: 50, reborn: 1, rating: 16.01, trophy: { name: "测试称号", color: "gold" },
    classEmblem: { base: 0, medal: 0 }, plateId: 2, characterId: 3, plate: null, character: null,
  });
  const [oldChapter, newChapter] = data.chapters;
  assert.deepEqual([oldChapter.key, oldChapter.slots, oldChapter.scores.length], ["old", 30, 30]);
  assert.deepEqual([newChapter.key, newChapter.slots, newChapter.scores.length], ["new", 20, 20]);
  const sum = (list) => list.reduce((total, score) => total + score.rating, 0);
  assert.ok(Math.abs(oldChapter.average - sum(old) / 30) < 1e-9);
  assert.ok(Math.abs(data.rating - (sum(old) + sum(fresh)) / 50) < 1e-9);
  assert.deepEqual(oldChapter.scores[0], {
    id: 1, title: "曲1", levelIndex: 3, level: "14", constant: 14.1, score: 1007000, rating: 16.3, rank: "sss",
    clear: "clear", fullCombo: null, fullChain: null, isNew: false, jacketId: 1, jacket: null,
  });
  assert.equal(newChapter.scores[0].isNew, true);

  // 没打满：均值照样除以 30（空位算 0，跟 Rating 一致）
  const few = buildData({ mode: "b50", player, bests: { bests: old.slice(0, 12), new_bests: [] }, catalog });
  assert.equal(few.chapters[0].scores.length, 12);
  assert.ok(Math.abs(few.chapters[0].average - sum(old.slice(0, 12)) / 30) < 1e-9);
  assert.equal(few.chapters[1].scores.length, 0);
});

test("buildData /b30：一栏 30 首，新曲照落雪的 new_bests 认；曲库里没有的曲子退回等级、没有定数", async (t) => {
  const catalog = await loadCatalog(t);
  const old = range(1, 40, (i) => 16 - i * 0.01);
  const fresh = range(101, 125, (i) => 17 - i * 0.01);
  const unknown = sc(999, 18, { song_name: "还没进曲库的歌", level: "15+" });
  const data = buildData({
    mode: "b30", player: { name: "测试玩家", rating: 16, class_emblem: { base: 2, medal: 4 } }, catalog,
    bests: { bests: old.slice(0, 30), new_bests: fresh.slice(0, 20) }, scores: [...old, ...fresh, unknown],
  });
  assert.equal(data.chapters.length, 1);
  const [chapter] = data.chapters;
  assert.deepEqual([chapter.key, chapter.scores.length], ["all", 30]);
  assert.deepEqual(chapter.scores[0], {
    id: 999, title: "还没进曲库的歌", levelIndex: 3, level: "15+", constant: null, score: 1007000, rating: 18, rank: "sss",
    clear: "clear", fullCombo: null, fullChain: null, isNew: false, jacketId: 999, jacket: null,
  });
  assert.deepEqual(chapter.scores.filter((score) => score.isNew).length, 25);
  assert.equal(data.rating, chapter.average);
  assert.deepEqual([data.player.plateId, data.player.characterId, data.player.trophy], [null, null, null]);
  assert.deepEqual(data.player.classEmblem, { base: 2, medal: 4 });
});

test("/aj30 挑歌：只留 AJ / AJC（不分新旧），去掉 FC、disabled、WE，按单曲 Rating 取前 30", async (t) => {
  const catalog = await loadCatalog(t);
  const old = ajRange(1, 30, (i) => 16 - i * 0.01);
  const fresh = ajRange(101, 110, (i) => 17 - i * 0.01);
  // AJC 也算 AJ
  const ajc = sc(25, 18, { full_combo: "alljusticecritical" });
  const scores = [
    ...old.filter((score) => score.id !== 25), ajc, ...fresh,
    sc(31, 19, { full_combo: "fullcombo" }),   // 只有 FC，不算
    sc(32, 20, { full_combo: null }),          // 没有 FC 标记，不算
    sc(41, 21, { full_combo: "alljustice" }),  // 曲库标了 disabled
    sc(8001, 22, { level_index: 5, full_combo: "alljustice" }),   // WE 没有 Rating
  ];

  const picked = pickAj30({ scores, catalog });
  assert.equal(picked.length, 30);
  assert.deepEqual(ids(picked), [25, ...ids(fresh), ...ids(old.slice(0, 19))]);

  const data = buildData({ mode: "aj30", player: { name: "测试玩家", rating: 16.5 }, scores, catalog });
  const [chapter] = data.chapters;
  assert.deepEqual([data.mode, data.exact, chapter.key, chapter.slots, chapter.scores.length], ["aj30", true, "aj", 30, 30]);
  assert.deepEqual(chapter.scores.map((score) => score.id), ids(picked));
  const sum = chapter.scores.reduce((total, score) => total + score.rating, 0);
  assert.ok(Math.abs(chapter.average - sum / 30) < 1e-9);
  assert.equal(data.rating, chapter.average);
  assert.equal(chapter.scores[0].fullCombo, "alljusticecritical", "AJC 也算 AJ，而且排第一");
  assert.equal(chapter.scores.filter((score) => score.isNew).length, 10, "新曲照当前版本算 New，不分新旧都进表");
  assert.ok(chapter.scores.every((score) => score.fullCombo === "alljustice" || score.fullCombo === "alljusticecritical"));

  // 不到 30 首：位置还是 30 个，空位按 0 算（跟 Rating 一致）
  const few = buildData({ mode: "aj30", player: { name: "测试玩家" }, scores: ajRange(1, 5, () => 16), catalog });
  assert.deepEqual([few.chapters[0].slots, few.chapters[0].scores.length], [30, 5]);
  assert.ok(Math.abs(few.chapters[0].average - 5 * 16 / 30) < 1e-9);
});

test("/aj50 挑歌：AJ 谱面分新老版本，旧曲前 30 + 新曲前 20；去掉 FC、disabled、WE", async (t) => {
  const catalog = await loadCatalog(t);
  const old = ajRange(1, 35, (i) => 16 - i * 0.01);
  const fresh = ajRange(101, 125, (i) => 17 - i * 0.01);
  const bests = { bests: old.slice(0, 30), new_bests: fresh.slice(0, 20), selections: [] };
  const scores = [
    ...old, ...fresh,
    sc(31, 18, { full_combo: "fullcombo" }),   // 只有 FC，不算
    sc(41, 19, { full_combo: "alljustice" }),  // 曲库标了 disabled
    sc(8001, 20, { level_index: 5, full_combo: "alljustice" }),   // WE 没有 Rating
  ];

  const picked = pickAj50({ scores, bests, catalog });
  assert.deepEqual(ids(picked.old), ids(old.slice(0, 30)));
  assert.deepEqual(ids(picked.fresh), ids(fresh.slice(0, 20)));

  const data = buildData({ mode: "aj50", player: { name: "测试玩家", rating: 16.5 }, scores, bests, catalog });
  assert.deepEqual(data.chapters.map((chapter) => [chapter.key, chapter.slots, chapter.scores.length]),
    [["old", 30, 30], ["new", 20, 20]]);
  const sum = (list) => list.reduce((total, score) => total + score.rating, 0);
  const expected = (sum(old.slice(0, 30)) + sum(fresh.slice(0, 20))) / 50;
  assert.ok(Math.abs(data.rating - expected) < 1e-9);
  assert.equal(data.exact, true);
  assert.ok(data.chapters[0].scores.every((score) => !score.isNew));
  assert.ok(data.chapters[1].scores.every((score) => score.isNew));
  assert.ok(data.chapters.flatMap((chapter) => chapter.scores).every((score) =>
    score.fullCombo === "alljustice" || score.fullCombo === "alljusticecritical"));

  // 不到 50 首：旧曲 30 个位置、新曲 20 个位置，空位按 0 算
  const few = buildData({
    mode: "aj50", player: { name: "测试玩家" }, catalog,
    scores: [...ajRange(1, 5, () => 16), ...ajRange(101, 103, () => 17)],
    bests: { new_bests: [sc(101, 17, { full_combo: "alljustice" })] },
  });
  assert.deepEqual(few.chapters.map((chapter) => chapter.scores.length), [5, 3]);
  assert.ok(Math.abs(few.chapters[0].average - 5 * 16 / 30) < 1e-9);
  assert.ok(Math.abs(few.chapters[1].average - 3 * 17 / 20) < 1e-9);
  assert.ok(Math.abs(few.rating - (5 * 16 + 3 * 17) / 50) < 1e-9);
});

test("/拟合定数b30：定数换成拟合值后重算 Rating、重新排序；没有拟合值的退回官方定数", async (t) => {
  const catalog = await loadCatalog(t);
  // 三首官方定数都是 14.x；拟合定数把 3 号抬到 16.0、1 号抬到 15.5、2 号压到 14.0
  const fit = (id) => ({ 1: 15.5, 2: 14.0, 3: 16.0 }[id] ?? null);
  const scores = [
    sc(1, 16.0, { score: 1009000 }),
    sc(2, 16.5, { score: 1009000 }),
    sc(3, 15.0, { score: 1009000 }),
    sc(999, 17.0, { song_name: "还没进曲库的歌", level: "15+" }),   // 拟合表里没有，退回官方/原 Rating
  ];
  const data = buildData({ mode: "fit30", player: { name: "测试玩家", rating: 16.3 }, scores, catalog, fitConstantOf: fit });

  assert.deepEqual([data.mode, data.exact, data.chapters.length], ["fit30", true, 1]);
  const chapter = data.chapters[0];
  assert.deepEqual([chapter.key, chapter.slots, chapter.scores.length], ["fit", 30, 4]);
  // 重算后的 Rating：3 号 18.15 > 1 号 17.65 > 未知 17.0 > 2 号 16.15
  assert.deepEqual(chapter.scores.map((score) => score.id), [3, 1, 999, 2]);
  const first = chapter.scores[0];
  assert.equal(first.constant, 16);
  assert.equal(first.constantText, "≈16.00");
  assert.equal(first.officialConstant, 14.3);
  assert.equal(first.fitted, true);
  assert.equal(first.rating, 18.15);
  assert.equal(first.isNew, false);
  const unknown = chapter.scores[2];
  assert.deepEqual([unknown.constant, unknown.constantText, unknown.officialConstant, unknown.fitted, unknown.rating],
    [null, null, null, false, 17]);
  assert.deepEqual(data.fit, { fitted: 3, missing: 1, officialAverage: 2.15 });
  assert.ok(Math.abs(data.rating - (18.15 + 17.65 + 17 + 16.15) / 30) < 1e-9);

  // 只从 /bests 前 50 挑会漏：这里确认 pickFit30 读的是全部成绩
  assert.deepEqual(pickFit30({ scores, catalog, fitConstantOf: fit }).map((score) => score.id), [3, 1, 999, 2]);
});

test("/aj30、/aj50 是辅助表：功能表里有，指令面板里没有", () => {
  for (const name of ["aj30", "aj50"]) {
    const feature = features.find((entry) => entry.name === name);
    assert.ok(feature, name);
    assert.equal(feature.panel, false, name);
    assert.ok(!panel.panelItems(features).some((item) => item.name === "/" + name), name);
  }
});

test("attachAssets：曲绘、名牌版、角色一次要齐，没有的是 null", async (t) => {
  const catalog = await loadCatalog(t);
  const data = buildData({
    mode: "b50", catalog, player: { name: "x", rating: 15, name_plate: { id: 2 }, character: { id: 3 } },
    bests: { bests: [sc(1, 16), sc(2, 15)], new_bests: [sc(101, 15)] },
  });
  const asked = [];
  await attachAssets(data, {
    fileUrls: async (items) => {
      asked.push(...items);
      return items.map(([kind, id]) => (id === 2 && kind === "jacket" ? null : "file:///" + kind + "/" + id + ".png"));
    },
  });
  assert.deepEqual(asked, [["jacket", 1], ["jacket", 2], ["jacket", 101], ["plate", 2], ["character", 3]]);
  assert.deepEqual(data.chapters.flatMap((chapter) => chapter.scores.map((score) => score.jacket)),
    ["file:///jacket/1.png", null, "file:///jacket/101.png"]);
  assert.equal(data.player.plate, "file:///plate/2.png");
  assert.equal(data.player.character, "file:///character/3.png");
});

// ── 端到端 ──
async function setup(t) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns({ songList: songList() });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-best-bot-"));
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
  }, { lxns, oauth, bindings, catalog, assets, renderer, log: () => {},
    fitDiffs: {
      get: (id) => ({ 1: 15.5, 2: 14.0, 3: 16.0 }[id] ?? null),
      source: "测试拟合表", capturedAt: "2026-10-19", size: 3,
    },
  });
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
  return { qq, lx, renders, group, last, authorize };
}

const BOT = { id: "BOT", member_openid: "BOT", is_you: true, bot: true };

test("/b50 /b30 端到端：没绑定先提示；好友码绑定出图；新曲可能漏时图注说明；@别人走开发者接口；授权读全部成绩", async (t) => {
  const s = await setup(t);
  // 新曲 Rating 都比旧曲高：新曲前 20 全进前 30
  const old = range(1, 40, (i) => 16 - i * 0.01);
  const fresh = range(101, 125, (i) => 17 - i * 0.01);
  const bests = { bests: old.slice(0, 30), new_bests: fresh.slice(0, 20), selections: [] };
  s.lx.addPlayer({ friendCode: FC1, name: "测试玩家", rating: 16.5, scores: [...old, ...fresh], bests });
  s.lx.addPlayer({ friendCode: FC2, name: "另一位", rating: 15, scores: [...old, ...fresh], bests });
  s.lx.state.assets.set("jacket/1", PNG);
  s.lx.state.assets.set("jacket/101", PNG);

  await s.group("/b50");
  assert.equal(s.last().content, V.needBinding);

  await s.group("/绑定 " + FC1);
  await s.group("/b50");
  assert.equal(s.last().msg_type, 7);
  assert.equal(s.last().content, undefined);                    // 没有图注就不带文字（带空格会在图下面多一行空白）
  const b50 = s.renders.at(-1);
  assert.equal(b50.theme, "best");
  assert.deepEqual([b50.options.format, b50.options.quality], ["jpeg", 76]);
  assert.deepEqual(b50.data.chapters.map((chapter) => chapter.scores.length), [30, 20]);
  assert.match(b50.data.chapters[0].scores[0].jacket, /^file:\/\/.*jacket[\\/]1\.png$/);
  assert.equal(b50.data.chapters[0].scores[1].jacket, null);   // 落雪上没有这张图

  await s.group("/b30");
  assert.equal(s.renders.at(-1).data.mode, "b30");
  assert.equal(s.renders.at(-1).data.exact, false);
  assert.equal(s.last().content, V.bestMaybeIncomplete(true));
  assert.match(s.last().content, /可能漏了几首.*\/授权/);

  // U2 @ U1：替别人查，只走开发者接口，图注里不叫人去授权
  await s.group("<@BOT> <@U1> /b30", { user: "U2", mentions: [BOT, { id: "U1", member_openid: "U1" }] });
  assert.equal(s.last().content, V.bestMaybeIncomplete(false));
  assert.ok(s.lx.state.requests.slice(-2).every((request) => request.auth === "dev"));

  // 授权绑定：/b30 读全部成绩挑，准了，不再有图注
  await s.authorize("U3", FC2);
  const before = s.lx.state.requests.length;
  await s.group("/b30", { user: "U3" });
  assert.ok(s.lx.state.requests.slice(before).some((request) => request.auth === "bearer" && request.path.endsWith("/scores")));
  assert.equal(s.renders.at(-1).data.exact, true);
  assert.equal(s.last().content, undefined);
});

test("/aj30 端到端：好友码请去授权；授权后只排 AJ/AJC 的 B30；不到 30 首、没有 AJ 都有说法", async (t) => {
  const s = await setup(t);
  const scores = [...ajRange(1, 25, (i) => 16 - i * 0.01), ...ajRange(101, 110, (i) => 17 - i * 0.01),
    sc(31, 18.5, { full_combo: "fullcombo" })];   // 分数更高但只是 FC，不能进 AJ30
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", rating: 16.2, scores });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", rating: 16.5, scores });
  s.lx.addPlayer({ friendCode: FC3, name: "五首 AJ", rating: 12, scores: ajRange(1, 5, () => 15) });
  s.lx.addPlayer({ friendCode: FC4, name: "没有 AJ", rating: 10, scores: [sc(1, 18, { full_combo: "fullcombo" })] });
  for (const id of [...Array.from({ length: 25 }, (_, i) => i + 1), ...Array.from({ length: 10 }, (_, i) => 101 + i)]) {
    s.lx.state.assets.set("jacket/" + id, PNG);
  }

  await s.group("/aj30");
  assert.equal(s.last().content, V.needBinding);

  await s.group("/绑定 " + FC1);
  await s.group("/aj30");
  assert.equal(s.last().content, V.needOAuth("aj30"));
  assert.equal(s.renders.length, 0);

  await s.authorize("U3", FC2);
  await s.group("/aj30", { user: "U3" });
  const render = s.renders.at(-1);
  assert.equal(render.theme, "best");
  assert.deepEqual([render.data.mode, render.data.chapters.length, render.data.chapters[0].key], ["aj30", 1, "aj"]);
  const cards = render.data.chapters[0].scores;
  assert.deepEqual([cards.length, render.data.chapters[0].slots], [30, 30]);
  assert.ok(cards.every((score) => score.fullCombo === "alljustice" || score.fullCombo === "alljusticecritical"));
  assert.ok(!cards.some((score) => score.id === 31), "只是 FC 的高分不能挤进 AJ30");
  assert.equal(s.last().msg_type, 7);
  assert.equal(s.last().content, undefined, "满 30 首不带图注");

  // 只有 5 首 AJ：图上有 30 个位置，图注说清空位按 0 算
  await s.authorize("U4", FC3);
  await s.group("/aj30", { user: "U4" });
  assert.equal(s.renders.at(-1).data.chapters[0].scores.length, 5);
  assert.equal(s.last().content, V.aj30Few(5));

  // 一张 AJ 都没有：不出一张空图，直接用文字回
  await s.authorize("U5", FC4);
  const count = s.renders.length;
  await s.group("/aj30", { user: "U5" });
  assert.equal(s.last().content, V.aj30Empty);
  assert.equal(s.renders.length, count);
});

test("/aj50 端到端：好友码请去授权；授权后分新旧两栏只排 AJ/AJC；不足 50 首、没有 AJ 都有说法", async (t) => {
  const s = await setup(t);
  const old = ajRange(1, 25, (i) => 16 - i * 0.01);
  const fresh = ajRange(101, 110, (i) => 17 - i * 0.01);
  const bests = { bests: old.slice(0, 20), new_bests: fresh.slice(0, 10), selections: [] };
  const scores = [...old, ...fresh, sc(31, 18.5, { full_combo: "fullcombo" })];   // 高分但只是 FC
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", rating: 16.2, scores, bests });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", rating: 16.5, scores, bests });
  s.lx.addPlayer({ friendCode: FC3, name: "五首旧曲 AJ", rating: 12, scores: ajRange(1, 5, () => 15) });
  s.lx.addPlayer({ friendCode: FC4, name: "没有 AJ", rating: 10, scores: [sc(1, 18, { full_combo: "fullcombo" })] });
  for (const id of [...Array.from({ length: 25 }, (_, i) => i + 1), ...Array.from({ length: 10 }, (_, i) => 101 + i)]) {
    s.lx.state.assets.set("jacket/" + id, PNG);
  }

  await s.group("/aj50");
  assert.equal(s.last().content, V.needBinding);

  await s.group("/绑定 " + FC1);
  await s.group("/aj50");
  assert.equal(s.last().content, V.needOAuth("aj50"));
  assert.equal(s.renders.length, 0);

  await s.authorize("U3", FC2);
  await s.group("/aj50", { user: "U3" });
  const render = s.renders.at(-1);
  assert.equal(render.theme, "best");
  assert.deepEqual([render.data.mode, render.data.chapters.length], ["aj50", 2]);
  assert.deepEqual(render.data.chapters.map((chapter) => [chapter.key, chapter.slots, chapter.scores.length]),
    [["old", 30, 25], ["new", 20, 10]]);
  const cards = render.data.chapters.flatMap((chapter) => chapter.scores);
  assert.ok(cards.every((score) => score.fullCombo === "alljustice" || score.fullCombo === "alljusticecritical"));
  assert.ok(!cards.some((score) => score.id === 31), "只是 FC 的高分不能挤进 AJ50");
  assert.ok(render.data.chapters[0].scores.every((score) => !score.isNew));
  assert.ok(render.data.chapters[1].scores.every((score) => score.isNew));
  assert.equal(s.last().msg_type, 7);
  assert.equal(s.last().content, V.aj50Few(25, 10));

  // 只有 5 首旧曲 AJ、没有新曲 AJ：两栏位置照旧，图注说清空位按 0 算
  await s.authorize("U4", FC3);
  await s.group("/aj50", { user: "U4" });
  assert.deepEqual(s.renders.at(-1).data.chapters.map((chapter) => chapter.scores.length), [5, 0]);
  assert.equal(s.last().content, V.aj50Few(5, 0));

  // 一张 AJ 都没有：不出一张空图，直接用文字回
  await s.authorize("U5", FC4);
  const count = s.renders.length;
  await s.group("/aj50", { user: "U5" });
  assert.equal(s.last().content, V.aj50Empty);
  assert.equal(s.renders.length, count);
});

test("/拟合定数b30 端到端：好友码请去授权；授权后按拟合定数重排；不足 30 首有图注", async (t) => {
  const s = await setup(t);
  const scores = [
    sc(1, 16.0, { score: 1009000 }),
    sc(2, 16.5, { score: 1009000 }),
    sc(3, 15.0, { score: 1009000 }),
  ];
  s.lx.addPlayer({ friendCode: FC1, name: "好友码玩家", rating: 16.2, scores });
  s.lx.addPlayer({ friendCode: FC2, name: "授权玩家", rating: 16.3, scores });
  for (const id of [1, 2, 3]) s.lx.state.assets.set("jacket/" + id, PNG);

  await s.group("/拟合定数b30");
  assert.equal(s.last().content, V.needBinding);

  await s.group("/绑定 " + FC1);
  await s.group("/拟合定数b30");
  assert.equal(s.last().content, V.needOAuth("拟合定数b30"));
  assert.equal(s.renders.length, 0);

  await s.authorize("U3", FC2);
  await s.group("/拟合定数b30", { user: "U3" });
  const render = s.renders.at(-1);
  assert.equal(render.theme, "best");
  assert.deepEqual([render.data.mode, render.data.chapters.length], ["fit30", 1]);
  const [chapter] = render.data.chapters;
  assert.deepEqual([chapter.key, chapter.slots, chapter.scores.length], ["fit", 30, 3]);
  // 拟合定数：3 号 16.0（18.15）> 1 号 15.5（17.65）> 2 号 14.0（16.15）
  assert.deepEqual(chapter.scores.map((score) => score.id), [3, 1, 2]);
  assert.deepEqual([chapter.scores[0].constant, chapter.scores[0].rating, chapter.scores[0].constantText],
    [16, 18.15, "≈16.00"]);
  assert.deepEqual(render.data.fit, {
    fitted: 3, missing: 0, officialAverage: (16 + 16.5 + 15) / 30,
    source: "测试拟合表", capturedAt: "2026-10-19",
  });
  assert.equal(s.last().msg_type, 7);
  assert.equal(s.last().content, V.fit30Note(3, 0));

  // 功能表里有、指令面板里也有（不是辅助表）
  const feature = features.find((entry) => entry.name === "fit30");
  assert.ok(feature);
  assert.ok(panel.panelItems(features).some((item) => item.name === "/拟合定数b30"));
});



// ── 真的渲染一次 ──
const skip = !findBrowser() && "没找到 Chrome / Edge";

// 示例数据里的 "lxns:jacket/123" 不联网，换成空（主题要能照样出图）
function exampleData(file) {
  const raw = fs.readFileSync(path.join(ROOT, "themes", "best", "examples", file), "utf8");
  return JSON.parse(raw, (key, value) => (typeof value === "string" && value.startsWith("lxns:") ? null : value));
}

// 宽 = 内容 1824 + 两边羊皮纸 12 + 画框（左 97、右 95，按画框原图量的尺寸算，见 theme.js 的 FRAME）
test("best 主题：B50、B30、AJ30、AJ50、拟合 B30 都能出图，宽 2040", { skip }, async (t) => {
  // 浏览器临时目录放测试自己的目录里，不碰系统临时目录
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anna-scratch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const renderer = createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1, tmpDir: tmp });
  for (const file of ["preview-data.json", "b30.json", "aj30.json", "aj50.json", "fit30.json"]) {
    const out = await renderer.render("best", exampleData(file), { width: 2100, format: "jpeg" });
    assert.equal(out.width, 2040, file);
    assert.ok(out.height > 1500, file);
  }
  // 希腊字母曲名走另一条排版路径（两倍字号 + zoom，见 theme.css 的 .title-line.greek），也出一张确认版式没被撑坏
  const withGreek = exampleData("preview-data.json");
  withGreek.chapters[0].scores[0].title = "ΩΩPARTS";
  const greek = await renderer.render("best", withGreek, { width: 2100, format: "jpeg" });
  assert.equal(greek.width, 2040, "greek");
  assert.ok(greek.height > 1500, "greek");
  await renderer.idle();
  assert.deepEqual(fs.readdirSync(tmp), [], "浏览器临时目录都删掉了");
});
