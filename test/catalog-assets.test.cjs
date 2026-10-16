"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLxnsClient } = require("../src/lxns.cjs");
const { createCatalog } = require("../src/catalog.cjs");
const { createAssets } = require("../src/assets.cjs");
const { createMockLxns, PNG } = require("./mock-lxns.cjs");

async function setup(t) {
  const mock = createMockLxns();
  await mock.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-cat-"));
  t.after(async () => { await mock.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const lxns = createLxnsClient({ baseUrl: mock.apiBase, devToken: mock.devToken, retries: 0 });
  return { mock, lxns, dir };
}

test("曲库：搜索排名 —— id 写法、曲名、别名、开头、包含；普通曲排在同名 WE 前面", async (t) => {
  const { lxns, dir } = await setup(t);
  const catalog = createCatalog({ lxns, cacheDir: dir });
  assert.deepEqual(await catalog.ready(), { source: "lxns" });
  assert.equal(catalog.size, 3);
  assert.equal(catalog.search("id407")[0].song.id, 407);
  assert.equal(catalog.search("id1").length, 0);
  assert.equal(catalog.resolve("混沌").song.id, 407);                 // 别名
  assert.equal(catalog.resolve("ＢＢＫＫＢＫＫ").song.id, 3);           // 全角 + 去标点后对上别名
  const same = catalog.resolve("B.B.K.K.B.K.K.");                   // 普通曲和 WE 同名
  assert.equal(same.song.id, 3);
  assert.deepEqual(same.candidates.map((s) => s.id), [3, 8020]);
  assert.equal(catalog.resolve("不存在的歌").song, null);
  assert.deepEqual(catalog.aliasesOf(999), []);                      // 指向不存在曲目的别名被忽略
});

test("曲库：WE 曲绘用原曲 ID；当前版本取有曲目的最新版本", async (t) => {
  const { lxns, dir } = await setup(t);
  const catalog = createCatalog({ lxns, cacheDir: dir });
  await catalog.ready();
  assert.equal(catalog.jacketId(catalog.getSong(8020)), 3);
  assert.equal(catalog.jacketId(catalog.getSong(407)), 407);
  assert.deepEqual(catalog.currentVersion(), { version: 13000, title: "CHUNITHM X-VERSE" });
  assert.equal(catalog.chart(catalog.getSong(407), 3).level_value, 15.5);
});

test("曲库：缓存新鲜就不去拉；落雪挂了用旧缓存；都没有才报错", async (t) => {
  const { mock, lxns, dir } = await setup(t);
  await createCatalog({ lxns, cacheDir: dir }).ready();
  const before = mock.state.requests.length;
  assert.deepEqual(await createCatalog({ lxns, cacheDir: dir }).ready(), { source: "cache" });
  assert.equal(mock.state.requests.length, before);
  mock.failNext(500, undefined, 10);
  const stale = createCatalog({ lxns, cacheDir: dir, refreshMs: 0, log: () => {} });
  assert.deepEqual(await stale.ready(), { source: "stale-cache" });
  assert.equal(stale.size, 3);
  mock.failNext(500, undefined, 10);
  await assert.rejects(createCatalog({ lxns, cacheDir: path.join(dir, "empty") }).ready(), /没有缓存/);
});

test("曲库：带物量拉（notes=true）；以前没带物量写的缓存当过期重拉", async (t) => {
  const { mock, lxns, dir } = await setup(t);
  // 2026-10-16 以前的缓存：没有 notes 标记
  fs.writeFileSync(path.join(dir, "songs.json"), JSON.stringify({ fetchedAt: Date.now(), data: mock.state.songList }));
  assert.deepEqual(await createCatalog({ lxns, cacheDir: dir }).ready(), { source: "lxns" });
  assert.ok(mock.state.requests.some((r) => r.path === "/api/v0/chunithm/song/list?notes=true"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "songs.json"), "utf8")).notes, true);
  // 重拉以后的缓存带标记，下次直接用
  assert.deepEqual(await createCatalog({ lxns, cacheDir: dir }).ready(), { source: "cache" });
});

test("曲库：版本名，版本表里没有正好这个号时取不超过它的最近一个", async (t) => {
  const { lxns, dir } = await setup(t);
  const catalog = createCatalog({ lxns, cacheDir: dir });
  await catalog.ready();
  assert.equal(catalog.versionTitle(catalog.getSong(3)), "CHUNITHM");
  assert.equal(catalog.versionTitle(catalog.getSong(8020)), "CHUNITHM");          // 10500 不在版本表里
  assert.equal(catalog.versionTitle(catalog.getSong(407)), "CHUNITHM X-VERSE");
});

test("素材：下载一次后走缓存；同时要同一张只下载一次；404 记住不反复撞", async (t) => {
  const { mock, dir } = await setup(t);
  const assets = createAssets({ cacheDir: dir, baseUrl: mock.assetsBase });
  const count = () => mock.count((r) => r.path.startsWith("/assets/"));
  const [a, b] = await Promise.all([assets.file("jacket", 407), assets.file("jacket", 407)]);
  assert.equal(a, b);
  assert.ok(fs.readFileSync(a).equals(PNG));
  assert.equal(count(), 1);
  await assets.file("jacket", 407);
  assert.equal(count(), 1);
  assert.equal(await assets.file("jacket", 12345), null);
  assert.equal(await assets.file("jacket", 12345), null);
  assert.equal(count(), 2);
  assert.match(await assets.fileUrl("jacket", 3), /^file:\/\//);
  const urls = await assets.fileUrls([["jacket", 407], ["jacket", 12345], ["plate", 1]]);
  assert.match(urls[0], /^file:/);
  assert.equal(urls[1], null);
  assert.equal(urls[2], null);
});

test("素材：种类和 ID 都要合法（防止拼出奇怪的路径）", async (t) => {
  const { dir } = await setup(t);
  const assets = createAssets({ cacheDir: dir, baseUrl: "http://127.0.0.1:9" });
  assert.throws(() => assets.file("../etc", 1), /不认识/);
  assert.throws(() => assets.file("jacket", "../1"), /只能是数字/);
});
