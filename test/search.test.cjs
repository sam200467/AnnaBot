"use strict";
// /搜索歌曲：先测参数、谱面写法、Markdown 链接和翻页按钮（纯函数），再走一遍端到端
// （假 QQ + 假落雪，真的曲库/别名/指令层）：别名直接来自落雪的 alias/list，不需要另建别名库。
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
const { createAnnaBot } = require("../src/bot.cjs");
const { V } = require("../src/voice.cjs");
const {
  parseArgs, chartText, analysisCommand, buildReply, PER_PAGE,
} = require("../src/features/search.cjs");

const chart = (difficulty, level, value, extra = {}) =>
  ({ difficulty, level, level_value: value, note_designer: "x", version: 24000, ...extra });
const song = (id, title, difficulties) =>
  ({ id, title, artist: "x", genre: "原创", bpm: 180, version: 24000, difficulties });

// 850 四个难度；2093 带落雪别名；3 和 8020 是同名普通曲 + WE；777 只有 ULTIMA；
// 1001～1009 用来翻页（9 首，正好两页）。
function songList() {
  const songs = [
    song(850, "《混乱》 ～ Muspell", [chart(0, "3", 3), chart(1, "6", 6), chart(2, "11", 11), chart(3, "13+", 13.7)]),
    song(2093, "偏愛", [chart(2, "12", 12), chart(3, "14", 14)]),
    song(3, "B.B.K.K.B.K.K.", [chart(3, "12+", 12.5)]),
    song(8020, "B.B.K.K.B.K.K.", [chart(5, "0", 0, { star: 4, kanji: "戻", origin_id: 3 })]),
    song(777, "只有黑谱", [chart(4, "13+", 13.7)]),
  ];
  for (let i = 1; i <= 9; i++) songs.push(song(1000 + i, "测试曲 " + i, [chart(3, "14", 14)]));
  return {
    songs,
    genres: [],
    versions: [{ id: 0, title: "CHUNITHM", version: 10000 }, { id: 1, title: "CHUNITHM X-VERSE", version: 24000 }],
  };
}
const ALIASES = { aliases: [{ song_id: 850, aliases: ["混沌"] }, { song_id: 2093, aliases: ["偏爱", "镜女"] }] };

async function loadCatalog(t) {
  const lx = createMockLxns({ songList: songList(), aliasList: ALIASES });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-search-"));
  t.after(async () => { await lx.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const catalog = createCatalog({ lxns: createLxnsClient({ baseUrl: lx.apiBase, retries: 0 }), cacheDir: dir });
  await catalog.ready();
  return catalog;
}

async function setupBot(t, { markdown = true, keyboard = true } = {}) {
  const qq = createMockOfficial();
  await qq.start();
  const lx = createMockLxns({ songList: songList(), aliasList: ALIASES });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-search-bot-"));
  const lxns = createLxnsClient({ baseUrl: lx.apiBase, devToken: lx.devToken, retries: 0 });
  const oauth = createOAuth({ clientId: lx.clientId, clientSecret: lx.clientSecret, siteUrl: lx.site });
  const vault = await openVault({ file: path.join(dir, "bindings.enc"), key: crypto.randomBytes(32) });
  const bindings = createBindings({ vault, lxns, oauth });
  const catalog = createCatalog({ lxns, cacheDir: path.join(dir, "cache") });
  await catalog.ready();
  const bot = createAnnaBot({
    allowedGroupIds: ["G1"], allowPrivateChat: true, admins: [],
    receiptDelayMs: 0, generateCooldownMs: 0,
    qq: { appId: "1", clientSecret: "x", tokenUrl: qq.tokenUrl, apiBase: qq.apiBase, sandboxApiBase: qq.apiBase, sandbox: false,
      markdown, keyboard, minSendIntervalMs: 0, jitterMs: 0, perTargetIntervalMs: 0, perTargetPerHour: 1000 },
  }, { lxns, oauth, bindings, catalog, renderer: { render: async () => ({ buffer: PNG }) }, log: () => {} });
  t.after(async () => {
    bot.stop();
    await qq.stop();
    await lx.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  let seq = 0;
  const group = (content) => bot.handleEvent("GROUP_AT_MESSAGE_CREATE", {
    id: "m" + (++seq), group_openid: "G1", author: { member_openid: "U1" }, content: " " + content,
  });
  return { qq, lx, bot, group };
}

test("参数：--page、第 N 页、pN 都认；纯数字和裸 p2 不当页码", () => {
  assert.deepEqual(parseArgs("混沌 --page 2"), { query: "混沌", page: 2 });
  assert.deepEqual(parseArgs("混沌 --page=3"), { query: "混沌", page: 3 });
  assert.deepEqual(parseArgs("混沌 第 3 页"), { query: "混沌", page: 3 });
  assert.deepEqual(parseArgs("混沌 p2"), { query: "混沌", page: 2 });
  assert.deepEqual(parseArgs("39"), { query: "39", page: 1 });
  assert.deepEqual(parseArgs("p2"), { query: "p2", page: 1 }, "裸 p2 可能是曲名");
  assert.deepEqual(parseArgs("「混乱」"), { query: "混乱", page: 1 });
  assert.deepEqual(parseArgs("--page 2"), { query: "", page: 2 });
  assert.deepEqual(parseArgs("混沌 --page 0"), { query: "混沌", page: 1 });
});

test("谱面写法：定数优先、整数不带小数点、WE 写星级和汉字；点曲名的命令按难度补全", async (t) => {
  const catalog = await loadCatalog(t);
  assert.equal(chartText(chart(3, "14", 14)), "MAS 14");
  assert.equal(chartText(chart(3, "14+", 14.5)), "MAS 14.5");
  assert.equal(chartText(chart(0, "3", 0)), "BAS 3");
  assert.equal(chartText(chart(5, "0", 0, { star: 4, kanji: "戻" })), "WE ★4 戻");
  const charts = (id) => catalog.getSong(id).difficulties;
  assert.equal(analysisCommand(catalog.getSong(850), charts(850), catalog), "/谱面分析 id850 ");
  assert.equal(analysisCommand(catalog.getSong(777), charts(777), catalog), "/谱面分析 id777 ult");
  assert.equal(analysisCommand(catalog.getSong(8020), charts(8020), catalog), "/谱面分析 id8020 we");
});

test("buildReply：落雪别名能搜到，结果里只写曲名（不显示别名）", async (t) => {
  const catalog = await loadCatalog(t);
  const hit = buildReply("镜女", catalog);
  assert.equal(hit.kind, "markdown");
  assert.match(hit.markdown, /^查到 1 首：/);
  assert.ok(!hit.markdown.includes("别名："), "搜索界面不列别名");
  assert.ok(hit.markdown.includes('<qqbot-cmd-input text="/谱面分析 id2093 " show="id2093   偏愛" reference="false" />'));
  assert.match(hit.markdown, /EXP 12 \/ MAS 14/);
  assert.ok(hit.text.includes("id2093   偏愛"));
  assert.ok(!hit.text.includes("别名："));
  assert.ok(!hit.text.includes("qqbot-cmd-input"));
  assert.ok(!hit.text.includes(V.searchHint), "提示只在 Markdown 里出现");
  assert.equal(hit.keyboard, undefined);
});

test("buildReply：同名普通曲和 WE 都列出来，WE 的曲名指向 we", async (t) => {
  const catalog = await loadCatalog(t);
  const hit = buildReply("B.B.K.K.", catalog);
  assert.equal(hit.kind, "markdown");
  assert.ok(hit.markdown.includes('show="id3   B.B.K.K.B.K.K."'));
  assert.ok(hit.markdown.includes('show="id8020   B.B.K.K.B.K.K.【WORLD\'S END】"'));
  assert.ok(hit.markdown.includes('text="/谱面分析 id8020 we"'));
  assert.match(hit.markdown, /WE ★4 戻/);
});

test("buildReply：多页带按钮和可点的下一页；最后一页不放下一页", async (t) => {
  const catalog = await loadCatalog(t);
  const first = buildReply("测试曲", catalog);
  assert.match(first.markdown, /^查到 9 首（第 1\/2 页）：/);
  assert.ok(first.markdown.includes("点下面的按钮翻页"));
  assert.ok(first.markdownWithoutKeyboard.includes('下一页：<qqbot-cmd-input text="/搜索歌曲 测试曲 --page 2"'));
  assert.ok(first.text.includes("下一页：/搜索歌曲 测试曲 --page 2"));
  assert.ok(!first.text.includes("点曲名会填入"));
  assert.equal(first.text.split("\n").filter((line) => /^id100\d   /.test(line)).length, PER_PAGE);
  assert.equal(first.keyboard.rows.length, 2);
  const next = first.keyboard.rows.flatMap((row) => row.buttons).find((button) => button.id === "next");
  assert.equal(next.action.type, 1);
  assert.equal(next.action.data, "/搜索歌曲 测试曲 --page 2");
  const page = first.keyboard.rows.flatMap((row) => row.buttons).find((button) => button.id === "page");
  assert.equal(page.action.type, 2);
  assert.equal(page.action.enter, false);
  assert.equal(page.action.data, "/搜索歌曲 测试曲 --page ");

  const last = buildReply("测试曲 --page 2", catalog);
  assert.match(last.markdown, /^查到 9 首（第 2\/2 页）：/);
  assert.ok(last.markdownWithoutKeyboard.includes("已到最后一页"));
  assert.ok(last.text.includes("已到最后一页"));
  assert.ok(!last.keyboard.rows.flatMap((row) => row.buttons).some((button) => button.id === "next"));
});

test("buildReply：空参数、找不到、页码超出", async (t) => {
  const catalog = await loadCatalog(t);
  assert.deepEqual(buildReply("", catalog), { kind: "text", text: V.searchUsage });
  assert.deepEqual(buildReply("完全不存在的歌", catalog), { kind: "text", text: V.searchNotFound("完全不存在的歌") });
  assert.deepEqual(buildReply("测试曲 --page 3", catalog), { kind: "text", text: V.searchNoPage(2) });
});

test("端到端：/搜索歌曲 用落雪别名命中，发 Markdown；不绑定也能用", async (t) => {
  const s = await setupBot(t);
  await s.group("/搜索歌曲 镜女");
  const body = s.qq.state.sent.at(-1).body;
  assert.equal(body.msg_type, 2);
  assert.match(body.markdown.content, /^### 查到 1 首：/);
  assert.match(body.markdown.content, /id2093   偏愛/);
  assert.ok(!body.markdown.content.includes("别名："), "搜索界面只写曲名，不列别名");
  assert.equal(body.keyboard, undefined);
});

test("端到端：多页挂翻页按钮；点按钮按用户发的话执行", async (t) => {
  const s = await setupBot(t);
  await s.group("/搜索歌曲 测试曲");
  const body = s.qq.state.sent.at(-1).body;
  assert.equal(body.msg_type, 2);
  assert.match(body.markdown.content, /^### 查到 9 首（第 1\/2 页）：/);
  assert.ok(body.keyboard?.content?.rows?.length);
  const next = body.keyboard.content.rows.flatMap((row) => row.buttons).find((button) => button.id === "next");
  assert.equal(next.action.data, "/搜索歌曲 测试曲 --page 2");

  await s.bot.handleEvent("INTERACTION_CREATE", {
    id: "itr-search-1", group_openid: "G1", group_member_openid: "U1",
    data: { resolved: { button_data: next.action.data } },
  });
  assert.ok(s.qq.state.acks.some((ack) => ack.id === "itr-search-1"));
  assert.match(s.qq.state.sent.at(-1).body.markdown.content, /^### 查到 9 首（第 2\/2 页）：/);
});

test("端到端：平台拒收 Markdown，退回纯文本，下一页指令还在", async (t) => {
  // 关掉按钮，第一条就是不带按钮的 Markdown；不然 failNext 会先落在「带按钮」那一步，
  // 走的是按钮降级（去掉按钮重发），测不到 Markdown 被拒。
  const s = await setupBot(t, { keyboard: false });
  await s.group("/帮助");                       // 先拿一次 access_token，别让 failNext 落在换令牌上
  s.qq.failNext(400, 40034012, "不允许发送原生 markdown");
  await s.group("/搜索歌曲 测试曲");
  const body = s.qq.state.sent.at(-1).body;
  assert.equal(body.msg_type, 0);
  assert.match(body.content, /id1001/);
  assert.ok(body.content.includes("下一页：/搜索歌曲 测试曲 --page 2"));
  assert.ok(!body.content.includes("qqbot-cmd-input"));
});

test("端到端：平台拒收按钮，去掉按钮，正文改回可点的下一页", async (t) => {
  const s = await setupBot(t);
  await s.group("/帮助");
  s.qq.failNext(400, 40034999, "不允许发送按钮");
  await s.group("/搜索歌曲 测试曲");
  const body = s.qq.state.sent.at(-1).body;
  assert.equal(body.msg_type, 2);
  assert.equal(body.keyboard, undefined);
  assert.match(body.markdown.content, /^### 查到 9 首（第 1\/2 页）：/);
  assert.ok(body.markdown.content.includes('下一页：<qqbot-cmd-input text="/搜索歌曲 测试曲 --page 2"'));
});

test("端到端：关掉 Markdown 配置就只发纯文本", async (t) => {
  const s = await setupBot(t, { markdown: false });
  await s.group("/搜索歌曲 镜女");
  const body = s.qq.state.sent.at(-1).body;
  assert.equal(body.msg_type, 0);
  assert.match(body.content, /id2093/);
  assert.ok(!body.content.includes("qqbot-cmd-input"));
});
