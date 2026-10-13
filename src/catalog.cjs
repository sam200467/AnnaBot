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

const fs = require("node:fs");
const path = require("node:path");

const LEVELS = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "ULTIMA", "WORLD'S END"];
const WORLDS_END = 5;

// 宽松形式：去掉空格和常见标点，大小写、全半角统一。全是符号的曲名去完是空的，那时退回 plain。
const loose = (text) => String(text ?? "").normalize("NFKC").toLowerCase()
  .replace(/[\s　・·\-_~〜～!！?？.,，。、:：;；'"“”‘’`()（）[\]【】「」『』<>《》]/g, "");
const plain = (text) => String(text ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const key = (text) => loose(text) || plain(text);

const isWorldsEnd = (song) => Boolean(song?.difficulties?.some((d) => d.difficulty === WORLDS_END));

function createCatalog({ lxns, cacheDir, refreshMs = 6 * 60 * 60 * 1000, now = Date.now, log = () => {} } = {}) {
  const songsFile = path.join(cacheDir, "songs.json");
  const aliasesFile = path.join(cacheDir, "aliases.json");
  let data = null;          // { songs, genres, versions }
  let aliasMap = new Map(); // songId -> string[]
  let byId = new Map();
  let index = [];
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
    index = songList.songs.map((song) => ({
      song,
      title: key(song.title),
      aliases: (aliasMap.get(song.id) || []).map(key).filter(Boolean),
    }));
    fetchedAt = at;
  }

  function readCache() {
    try {
      const songs = JSON.parse(fs.readFileSync(songsFile, "utf8"));
      const aliases = fs.existsSync(aliasesFile) ? JSON.parse(fs.readFileSync(aliasesFile, "utf8")) : { data: { aliases: [] } };
      if (!Array.isArray(songs?.data?.songs)) return null;
      return { songs: songs.data, aliases: aliases.data, at: Number(songs.fetchedAt) || 0 };
    } catch {
      return null;
    }
  }

  function writeCache(file, payload) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: now(), data: payload }));
    fs.renameSync(tmp, file);
  }

  async function refresh() {
    const [songs, aliases] = await Promise.all([lxns.songList(), lxns.aliasList()]);
    if (!Array.isArray(songs?.songs) || !songs.songs.length) throw new Error("落雪返回的曲目列表是空的");
    build(songs, aliases, now());
    try {
      writeCache(songsFile, songs);
      writeCache(aliasesFile, aliases);
    } catch (error) {
      log("⚠ 曲库缓存写不进去：" + error.message);
    }
    return { songs: songs.songs.length, aliases: aliases?.aliases?.length || 0 };
  }

  async function ready() {
    const cached = readCache();
    if (cached && now() - cached.at < refreshMs) {
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

  // 排名：0 id123 写法｜1 曲名完全一致、或纯数字对上 ID｜2 别名完全一致｜3 曲名开头｜4 别名开头｜5 曲名包含｜6 别名包含
  // 同一名次里普通曲排在 WE 前面，再按 ID。
  function search(query, { limit = 20 } = {}) {
    requireData();
    const raw = String(query ?? "").normalize("NFKC").trim();
    if (!raw) return [];
    const hits = new Map();
    const add = (song, rank, via) => {
      if (!song) return;
      const previous = hits.get(song.id);
      if (!previous || rank < previous.rank) hits.set(song.id, { song, rank, via });
    };
    const idOnly = raw.match(/^id\s*(\d{1,5})$/i);
    if (idOnly) {
      add(byId.get(Number(idOnly[1])), 0, "id");
    } else {
      if (/^\d{1,5}$/.test(raw)) add(byId.get(Number(raw)), 1, "id");
      const q = key(raw);
      for (const item of index) {
        if (item.title === q) add(item.song, 1, "title");
        else if (item.aliases.includes(q)) add(item.song, 2, "alias");
        else if (item.title.startsWith(q)) add(item.song, 3, "title");
        else if (item.aliases.some((alias) => alias.startsWith(q))) add(item.song, 4, "alias");
        else if (q.length >= 2 && item.title.includes(q)) add(item.song, 5, "title");
        else if (q.length >= 2 && item.aliases.some((alias) => alias.includes(q))) add(item.song, 6, "alias");
      }
    }
    return [...hits.values()]
      .sort((a, b) => a.rank - b.rank || Number(isWorldsEnd(a.song)) - Number(isWorldsEnd(b.song)) || a.song.id - b.song.id)
      .slice(0, limit);
  }

  // 认出唯一一首就给 song；认不准时 song 是 null，candidates 按排名列出来让玩家挑。
  // 普通曲和它的 WE 版同名时取普通曲（WE 留在 candidates 里），要 WE 的功能自己挑。
  function resolve(query) {
    const results = search(query, { limit: 30 });
    if (!results.length) return { song: null, candidates: [] };
    const best = results.filter((r) => r.rank === results[0].rank);
    const normal = best.filter((r) => !isWorldsEnd(r.song));
    const pool = normal.length ? normal : best;
    return { song: pool.length === 1 ? pool[0].song : null, candidates: results.map((r) => r.song) };
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
    // 曲绘 ID：WE 用原曲的
    jacketId: (song) => (isWorldsEnd(song) ? song.difficulties[0].origin_id || song.id : song.id),
    chart: (song, levelIndex) => song?.difficulties?.find((d) => d.difficulty === Number(levelIndex)) || null,
  };
}

module.exports = { createCatalog, LEVELS, WORLDS_END, isWorldsEnd, loose };
