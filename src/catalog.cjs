"use strict";
// 曲库：落雪的曲目列表和别名列表（公共接口，不用密钥），缓存在 cacheDir 下。
// 启动时先读缓存，不超过 refreshMs 就直接用；过期或没有就去拉。拉失败但有旧缓存时用旧的 ——
// 曲库晚几个小时更新没关系，机器人起不来才是问题。之后每 refreshMs 在后台刷新一次。
//
// 2026-10-13 的数据长这样（写搜索规则时照着它来的）：
//   - 1458 首，其中 WORLD'S END 52 首。WE 是单独的曲目（ID 8000 起），只有一个难度（5），
//     定数是 0、用 star 表示星级；曲绘要用 difficulties[0].origin_id（原曲 ID）
//   - 48 组重名，全是「普通曲 + 它的 WE 版」，普通曲之间没有重名
//   - 有纯数字曲名（「010」「39」），所以纯数字既可能是 ID 也可能是曲名；「id39」只认 ID
//   - 别名 787 条，其中 21 条指向曲库里没有的曲目（忽略），14 个别名被好几首歌共用
// 2026-10-16 起曲目列表带物量（song/list?notes=true，/单曲 要用），缓存文件里记一个 notes: true。
// 之前写的缓存没有这个标记、也没有物量，当成过期的去重拉（拉不到时照样用它，只是没有物量）。
// 认歌（search / resolve）的规则在 song-search.cjs：简繁日汉字互通、假名和罗马音、拼错了给相近的候选。

const fs = require("node:fs");
const path = require("node:path");
const { createSearchIndex, loadSearchData } = require("./song-search.cjs");

const LEVELS = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "ULTIMA", "WORLD'S END"];
const WORLDS_END = 5;

// 宽松形式：去掉空格和常见标点，大小写、全半角统一（tools/build-song-extras.cjs 拿它对 wiki 上的曲名；搜索用 song-search.cjs 的）
const loose = (text) => String(text ?? "").normalize("NFKC").toLowerCase()
  .replace(/[\s　・·\-_~〜～!！?？.,，。、:：;；'"“”‘’`()（）[\]【】「」『』<>《》]/g, "");

const isWorldsEnd = (song) => Boolean(song?.difficulties?.some((d) => d.difficulty === WORLDS_END));
// 曲绘 ID：WE 用原曲的（读音也用原曲的）
const jacketId = (song) => (isWorldsEnd(song) ? song.difficulties[0].origin_id || song.id : song.id);

// searchData：认歌用的异体字表和读音（默认读 src/data/song-search.json，测试可以换）
function createCatalog({ lxns, cacheDir, refreshMs = 6 * 60 * 60 * 1000, now = Date.now, log = () => {}, searchData = loadSearchData() } = {}) {
  const songsFile = path.join(cacheDir, "songs.json");
  const aliasesFile = path.join(cacheDir, "aliases.json");
  let data = null;          // { songs, genres, versions }
  let aliasMap = new Map(); // songId -> string[]
  let byId = new Map();
  let index = null;
  let fetchedAt = 0;
  let timer = null;

  function build(songList, aliasList, at) {
    data = songList;
    byId = new Map(songList.songs.map((song) => [song.id, song]));
    aliasMap = new Map();
    for (const entry of aliasList?.aliases || []) {
      if (!byId.has(entry.song_id)) continue;
      aliasMap.set(entry.song_id, [...(aliasMap.get(entry.song_id) || []), ...entry.aliases]);
    }
    index = createSearchIndex({ songs: songList.songs, aliasesOf: (id) => aliasMap.get(id) || [], originOf: jacketId, isWorldsEnd, data: searchData });
    fetchedAt = at;
  }

  function readCache() {
    try {
      const songs = JSON.parse(fs.readFileSync(songsFile, "utf8"));
      const aliases = fs.existsSync(aliasesFile) ? JSON.parse(fs.readFileSync(aliasesFile, "utf8")) : { data: { aliases: [] } };
      if (!Array.isArray(songs?.data?.songs)) return null;
      return { songs: songs.data, aliases: aliases.data, at: Number(songs.fetchedAt) || 0, withNotes: songs.notes === true };
    } catch {
      return null;
    }
  }

  function writeCache(file, payload, extra = {}) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: now(), ...extra, data: payload }));
    fs.renameSync(tmp, file);
  }

  async function refresh() {
    const [songs, aliases] = await Promise.all([lxns.songList({ notes: true }), lxns.aliasList()]);
    if (!Array.isArray(songs?.songs) || !songs.songs.length) throw new Error("落雪返回的曲目列表是空的");
    build(songs, aliases, now());
    try {
      writeCache(songsFile, songs, { notes: true });
      writeCache(aliasesFile, aliases);
    } catch (error) {
      log("⚠ 曲库缓存写不进去：" + error.message);
    }
    return { songs: songs.songs.length, aliases: aliases?.aliases?.length || 0 };
  }

  async function ready() {
    const cached = readCache();
    if (cached && cached.withNotes && now() - cached.at < refreshMs) {
      build(cached.songs, cached.aliases, cached.at);
      return { source: "cache" };
    }
    try {
      await refresh();
      return { source: "lxns" };
    } catch (error) {
      if (!cached) throw new Error("拉不到落雪曲库，本地也没有缓存：" + error.message);
      build(cached.songs, cached.aliases, cached.at);
      log("⚠ 拉落雪曲库失败，先用 " + new Date(cached.at).toLocaleString("zh-CN") + " 的缓存：" + error.message);
      return { source: "stale-cache" };
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      refresh().then((r) => log("曲库已刷新：" + r.songs + " 首，别名 " + r.aliases + " 条"))
        .catch((error) => log("⚠ 曲库刷新失败（继续用旧的）：" + error.message));
    }, refreshMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function requireData() {
    if (!data) throw new Error("曲库还没加载（先 await catalog.ready()）");
  }

  // [{ song, rank, via, gap, fuzzy }]，按排名排好（排名表见 song-search.cjs 的文件头）
  function search(query, { limit = 20 } = {}) {
    requireData();
    return index.search(query, { limit });
  }

  // 认出唯一一首就给 song；认不准时 song 是 null，candidates 按排名列出来让玩家挑。
  // 普通曲和它的 WE 版同名时取普通曲（WE 留在 candidates 里），要 WE 的功能自己挑。
  // 曲名相近的、查询词里含着曲名的只是猜的（fuzzy: true），只有一首也不直接认定，让玩家确认。
  function resolve(query) {
    const results = search(query, { limit: 30 });
    const candidates = results.map((r) => r.song);
    if (!results.length || results[0].fuzzy) return { song: null, candidates, fuzzy: Boolean(results.length) };
    const best = results.filter((r) => r.rank === results[0].rank && r.gap === results[0].gap);
    const normal = best.filter((r) => !isWorldsEnd(r.song));
    const pool = normal.length ? normal : best;
    return { song: pool.length === 1 ? pool[0].song : null, candidates, fuzzy: false };
  }

  // 已经有曲目上线的最新版本（版本表里可能先列出还没有曲目的下一个版本）。
  function currentVersion() {
    requireData();
    const latest = Math.max(...data.songs.map((song) => song.version));
    const entry = data.versions.find((v) => v.version === latest);
    return { version: latest, title: entry?.title || String(latest) };
  }

  return {
    LEVELS,
    ready,
    refresh,
    start,
    stop,
    get loaded() { return Boolean(data); },
    get size() { return data ? data.songs.length : 0; },
    get fetchedAt() { return fetchedAt; },
    get songs() { requireData(); return data.songs; },
    get versions() { requireData(); return data.versions; },
    get genres() { requireData(); return data.genres; },
    currentVersion,
    getSong: (id) => byId.get(Number(id)) || null,
    aliasesOf: (id) => [...(aliasMap.get(Number(id)) || [])],
    search,
    resolve,
    isWorldsEnd,
    jacketId,
    // 版本名：落雪曲目的 version 是首次出现的版本号（14000），换成版本表里的名字（CHUNITHM CRYSTAL）。
    // 版本表里没有正好这个号的，取不超过它的最近一个版本
    versionTitle: (song) => {
      if (!song || !data) return "";
      const entry = [...data.versions].filter((v) => v.version <= song.version).sort((a, b) => b.version - a.version)[0];
      return entry?.title || String(song.version);
    },
    chart: (song, levelIndex) => song?.difficulties?.find((d) => d.difficulty === Number(levelIndex)) || null,
  };
}

module.exports = { createCatalog, LEVELS, WORLDS_END, isWorldsEnd, loose };
