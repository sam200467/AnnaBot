#!/usr/bin/env node
"use strict";
// 生成 src/data/song-extras.json：每首歌的日服上线日期；原创、彩绿（イロドリミドリ）、音击舞萌（maimai / オンゲキ）的曲子
// 还有对应角色（落雪的角色 ID，/单曲 出图时拿它的头像）。
// 落雪的曲库里没有这两样，所以在开发机上离线生成一份、随程序发布 —— 服务器在国内，不指望它连得上 GitHub 和 wikiwiki。
//
//   日服上线日期：OTOGE DB（github.com/zvuc/otoge-db，社区维护的日服曲库）music-ex.json 的 date_added，一次拉完。
//     Node 自带的 fetch 不走代理，连 GitHub 会被重置，所以这一份用 curl 拉（curl 认 HTTPS_PROXY 环境变量）；
//     也可以先自己下好，用 --otoge 文件路径 指定。
//   对应角色：CHUNITHM 攻略 wiki（wikiwiki.jp/chunithmwiki）的「キャラクター世界観」1～3 页。这三页按レーベル列出每个角色和它的主题曲
//     （「キャラクター｜テーマ曲」的表），2026-10-16 三页就对上了 396 首原创曲里的 388 首，彩绿、音击舞萌各 49 首（这两类
//     很多是组合唱的、或者没有对应角色的移植曲）。第 3 页（maimai / オンゲキ）写的是角色在原作里的主题曲，不全是中二里的対応キャラ。
//     曲名对上落雪曲库：先原样比，再不分大小写，最后用 catalog 的宽松形式，哪一级先对上唯一一首就用哪一级
//     （宽松形式里「Overhea[r]t」和彩绿的「Over Heart」是一个样子，「Flower」和「FLOWER」要靠大小写分开）。
//     角色名按 NFKC、去空格后完全一致对上落雪的角色列表，撇号、连字符先统一（wiki 写「It's」，落雪是「It’s」）。表里的几种写法：
//       - 合并单元格：一首歌几个角色（「星河 うた」下面一行「(フジキュー)」）、一个角色几首歌，都是 rowspan
//       - 变身后的形态写成「(覚醒機神 トール)」、链接指向变身前的角色页。落雪里两种形态各有 ID，先按写出来的名字找，找不到再按链接
//       - VTuber 那些只写艺人名，链接才是完整的角色名（「memex」→「memex／Utopithm」）
//       - 「(上記2名)」指表里上面两个角色
//       - 没链接的纯文字：原创曲的表里是变身后的形态（「(ジェミニ・Ω)」）；彩绿、オンゲキ的表里多半是组合名（「(ASTERISM)」），
//         第 3 页还有一张中二里没实装的角色表 —— 所以这两类对不上落雪的纯文字不算
//     对不上的（国服没有这张卡）只记名字；同一个人别的卡落雪有的，再记那张卡的 ID 借它的头像（face，见 addFaces），
//     落雪里根本没这个人的，图上只写名字。
//   汇总页里没有的，退回去查曲目页信息表里的「対応キャラ」（2026-10-16 原创曲剩下的 8 首里 6 首本来就没有对应角色）。
//     wikiwiki 有频率限制：2026-10-16 隔 1.2 秒连抓 5 页就回 429，再抓就整段时间都回 403。
//     所以一页一页慢慢来（间隔至少 15 秒），429 了等一会儿再试，403 就停下（被拒了，过一段时间再跑，别换线路硬抓）；
//     查过的曲目页下次不再查，出新版本时再跑一次只补新曲。跑一半中断了也没关系，每查几页就写一次盘。
//
// 用法：node tools/build-song-extras.cjs [--delay 15000] [--limit 数量] [--recheck] [--otoge 文件]
//   --delay   两次请求 wiki 之间等多久（毫秒，至少 15000）
//   --limit   这次最多查多少个曲目页（试跑用；三张汇总页每次都取）
//   --recheck 已经查过的曲目页也重查一遍（wiki 上补了对应角色时用）

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createLxnsClient } = require("../src/lxns.cjs");
const { loose } = require("../src/catalog.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src", "data", "song-extras.json");
const OTOGE_URL = "https://raw.githubusercontent.com/zvuc/otoge-db/master/chunithm/data/music-ex.json";
const WIKI = "https://wikiwiki.jp/chunithmwiki/";
const SUMMARY_PAGES = ["キャラクター世界観1", "キャラクター世界観2", "キャラクター世界観3"];
// 要填对应角色的曲目分类（落雪的叫法）：原创、イロドリミドリ、maimai / オンゲキ
const ORIGINAL = "原创";
const GENRES = [ORIGINAL, "彩绿", "音击舞萌"];
const MIN_DELAY = 15000;

function args() {
  const list = process.argv.slice(2);
  const option = (name) => {
    const i = list.indexOf(name);
    return i < 0 ? undefined : list[i + 1];
  };
  return {
    delay: Math.max(MIN_DELAY, Number(option("--delay")) || MIN_DELAY),
    limit: Number(option("--limit")) || Infinity,
    recheck: list.includes("--recheck"),
    otoge: option("--otoge"),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 比名字用：全半角统一、去空格，几种撇号、引号、连字符各归成一种
const unify = (text) => String(text ?? "").normalize("NFKC")
  .replace(/[‐‑‒–—―−]/g, "-").replace(/[‘’′]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, "");

function readOut() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    return { songs: {} };
  }
}

function writeOut(out) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // 按 ID 排好再写，每次生成的 diff 只有真正变了的那几行
  const songs = Object.fromEntries(Object.entries(out.songs).sort(([a], [b]) => Number(a) - Number(b)));
  const text = JSON.stringify({ ...out, generatedAt: new Date().toISOString(), songs }, null, 1) + "\n";
  fs.writeFileSync(OUT + ".tmp", text);
  fs.renameSync(OUT + ".tmp", OUT);
}

async function loadOtoge(file) {
  if (file) return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  try {
    const res = await fetch(OTOGE_URL, { signal: AbortSignal.timeout(30000) });
    if (res.ok) return await res.json();
  } catch {
    // 走下面的 curl
  }
  const text = execFileSync("curl", ["-s", "-f", "-L", "-m", "120", OTOGE_URL], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return JSON.parse(text);
}

const decode = (text) => text
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

// 一格里的字：脚注（「*7」，class 是 note_super 的锚点）去掉，<br> 当换行
const cellText = (html) => decode(html
  .replace(/<a [^>]*class="note_super[^"]*"[^>]*>[\s\S]*?<\/a>/g, "")
  .replace(/<br[^>]*>/gi, "\n").replace(/<[^>]+>/g, "")).trim();

// 一格里指向 wiki 页面的链接：[{ text: 写出来的字, page: 页面名 }]（脚注、外链不算）
function cellLinks(html) {
  const links = [];
  for (const m of html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)) {
    const href = /href="([^"]*)"/.exec(m[1])?.[1] || "";
    if (!href.startsWith("/chunithmwiki/")) continue;
    const title = /title="([^"]*)"/.exec(m[1])?.[1];
    links.push({ text: cellText(m[2]), page: title ? decode(title) : decodeURIComponent(href.slice("/chunithmwiki/".length)).replace(/#.*/, "") });
  }
  return links;
}

// 整个名字套在括号里（「(覚醒機神 トール)」「(イロドリミドリ)」）就去掉括号；「星街すいせい(ホロライブ)」不动
const unwrap = (text) => text.replace(/^[(（]([\s\S]*)[)）]$/, "$1").trim();

// HTML 表格摊成格子：合并单元格（rowspan / colspan）展开，被合并的几个位置指向同一个格子对象
function tableGrid(table) {
  const grid = [];
  [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].forEach((row, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const m of row[1].matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/g)) {
      while (grid[r][c]) c++;
      const rows = Number(/rowspan="(\d+)"/.exec(m[1])?.[1]) || 1;
      const cols = Number(/colspan="(\d+)"/.exec(m[1])?.[1]) || 1;
      const cell = { html: m[2] };
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) (grid[r + i] = grid[r + i] || [])[c + j] = cell;
      c += cols;
    }
  });
  return grid;
}

// 角色那一格：有链接就一个链接一个角色（链接外面的字是注释，比如「ムテキねこ(イロドリミドリ)」），没有链接就整格是一个名字
function cellCharacters(html) {
  const links = cellLinks(html);
  if (links.length) return links.map((link) => ({ shown: unwrap(link.text), page: link.page }));
  const text = unwrap(cellText(html));
  return text ? [{ shown: text }] : [];
}

// 曲目那一格：一个链接一首（写出来的曲名、页面名都拿去对），没有链接的是 wiki 上没有页面的曲子；「(対応楽曲無し)」不算
function cellSongs(html) {
  const links = cellLinks(html);
  if (links.length) return links.map((link) => [link.text, link.page]);
  const text = cellText(html);
  return text && !/^[(（]?対応楽曲/.test(text) ? [[text]] : [];
}

// 汇总页里的「角色 → 主题曲」表：[{ songs: [[曲名的几种写法]...], characters: [{ shown, page }] }]，曲目一格一项
function themeSongs(html) {
  const items = [];
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    let charCol = -1;
    let songCol = -1;
    const bySong = new Map();   // 曲目那一格 → 它那几行的角色格
    const resolved = new Map(); // 角色格 → 里面的角色（按行的顺序解析，「上記2名」才数得对）
    const recent = [];
    for (const row of tableGrid(table[0])) {
      // 表头：「キャラクター｜テーマ曲｜アーティスト」「キャラクター/アーティスト｜テーマ曲」「キャラクター｜対応楽曲｜アーティスト」
      const texts = Array.from(row, (cell) => (cell ? cellText(cell.html) : ""));
      const head = [texts.findIndex((text) => /^キャラクター/.test(text)), texts.findIndex((text) => /^(テーマ曲|対応楽曲)$/.test(text))];
      if (head[0] >= 0 && head[1] >= 0) {
        [charCol, songCol] = head;
        continue;
      }
      const chara = row[charCol];
      const song = row[songCol];
      if (!chara || !song || chara === song) continue;   // 不是这种表，或者是「▼ CHUNITHM NEW」那种占一整行的版本标题
      if (!resolved.has(chara)) {
        const above = /^上記(\d+)名$/.exec(unwrap(cellText(chara.html)).normalize("NFKC"));
        const list = above ? recent.slice(-Number(above[1])) : cellCharacters(chara.html);
        if (!above) recent.push(...list);
        resolved.set(chara, list);
      }
      if (!bySong.has(song)) bySong.set(song, []);
      if (!bySong.get(song).includes(chara)) bySong.get(song).push(chara);
    }
    for (const [song, charas] of bySong) {
      const songs = cellSongs(song.html);
      const characters = charas.flatMap((cell) => resolved.get(cell));
      if (songs.length && characters.length) items.push({ songs, characters });
    }
  }
  return items;
}

// 曲名 → 落雪曲目：从严到宽三级，哪一级先有结果就看哪一级；那一级对上好几首就算对不上
function songMatcher(songs) {
  const levels = [unify, (text) => unify(text).toLowerCase(), (text) => loose(unify(text))].map((keyOf) => {
    const map = new Map();
    for (const song of songs) {
      const key = keyOf(song.title);
      if (key) map.set(key, [...(map.get(key) || []), song]);
    }
    return { keyOf, map };
  });
  return (title) => {
    for (const { keyOf, map } of levels) {
      const hits = map.get(keyOf(title)) || [];
      if (hits.length) return hits.length === 1 ? hits[0] : null;
    }
    return null;
  };
}

// 名字 → 落雪角色 { name, id }：几种写法按顺序试，第一个完全一致的；都不是就 null
function characterMatcher(characters) {
  const byName = new Map(characters.map((chara) => [unify(chara.name), chara]));
  return (names) => {
    for (const name of names) {
      const chara = name ? byName.get(unify(name)) : null;
      if (chara) return { name: chara.name, id: chara.id };
    }
    return null;
  };
}

// 汇总页的表对上落雪：Map(曲目 ID → [{ name, id }])，只要 GENRES 里那几类。WE 不算（/单曲 拿原曲的）；跟别的曲子撞名时也对不上，宁缺毋滥
function assignCharacters(items, { songs, characters }) {
  const findSong = songMatcher(songs.filter((song) => song.id < 8000));
  const findChara = characterMatcher(characters);
  // 一个角色对上落雪：对得上的带 ID；对不上的（国服没这个角色），wiki 上有角色页就只记名字。
  // 没链接的纯文字：原创曲那几张表里是变身后的形态（「(ジェミニ・Ω)」），也只记名字；彩绿、音击舞萌的表里
  // 多半是组合名（「(イロドリミドリ)」「(ASTERISM)」）或者中二里没实装的角色，落雪对不上就不算。「明坂 芹菜＆箱部 なる」拆开对
  const resolve = ({ shown, page }, original) => {
    const found = findChara([shown, page]);
    if (found) return [found];
    if (page) return [{ name: page, id: null }];
    const parts = shown.split(/[＆&]/).map((part) => part.trim());
    const each = parts.map((part) => findChara([part]));
    if (parts.length > 1 && each.every(Boolean)) return each;
    return original && !/^対応キャラ/.test(shown) ? [{ name: shown, id: null }] : [];
  };
  const result = new Map();
  for (const item of items) {
    for (const names of item.songs) {
      const song = names.map(findSong).find(Boolean);
      if (!GENRES.includes(song?.genre)) continue;
      const charas = item.characters.flatMap((entry) => resolve(entry, song.genre === ORIGINAL));
      if (!charas.length) continue;
      const list = result.get(song.id) || [];
      for (const chara of charas) if (!list.some((had) => had.name === chara.name)) list.push(chara);
      result.set(song.id, list);
    }
  }
  return result;
}

// 头像替身：国服缺的只是这一张卡（「箱部 なる／波瀾の新入生編」），同一个人别的卡落雪有（「箱部 なる」），
// 就记下那张卡的 ID（face）拿它的头像，名字照写原来的（作者 2026-10-16 同意的）。同一个人按名字里「／」前面那段算
// （落雪的变体卡都叫「人名／副标题」）；先挑跟人名同名的原版卡，没有就挑 ID 最小的一张。落雪里没这个人的只写名字
function addFaces(songs, characters) {
  const person = (name) => unify(name).split("/")[0];   // unify 做过 NFKC，全角「／」已经成了「/」
  const cards = new Map();
  for (const chara of [...characters].sort((a, b) => a.id - b.id)) {
    const key = person(chara.name);
    const had = cards.get(key);
    if (!had || (unify(chara.name) === key && unify(had.name) !== key)) cards.set(key, chara);
  }
  for (const entry of Object.values(songs)) {
    for (const chara of entry.characters || []) {
      const card = chara.id === null ? cards.get(person(chara.name)) : null;
      if (card) chara.face = card.id;
      else delete chara.face;
    }
  }
}

// 曲目页信息表里「対応キャラ」那一格。几个角色时 wiki 里用换行或「、」隔开。
// 不能按「／」拆：角色的变体名本身就带它（「愛野 ヒカリ／最愛の光」）
function charactersOn(html) {
  for (const row of html.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const cells = [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => cellText(m[1]));
    if (cells.length >= 2 && cells[0] === "対応キャラ") {
      return cells[1].split(/\n|、|\s\/\s/).map((s) => s.trim()).filter((s) => s && s !== "-" && s !== "なし");
    }
  }
  return [];
}

// otoge-db 给的地址有的转义过、有的没有，统一成转义好的
function wikiUrl(raw, title) {
  let page = raw ? raw.slice(raw.indexOf("/chunithmwiki/") + "/chunithmwiki/".length) : title;
  try { if (/%[0-9a-f]{2}/i.test(page)) page = decodeURIComponent(page); } catch { /* 原样用 */ }
  return WIKI + encodeURIComponent(page).replace(/%2F/g, "/");
}

async function fetchWiki(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (AnnaBot song-extras; low rate)" }, signal: AbortSignal.timeout(30000) });
    if (res.status === 429) {
      const wait = Math.min(600000, 60000 * 2 ** attempt);
      console.log("  wiki 说太快了（429），等 " + wait / 1000 + " 秒");
      await sleep(wait);
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 403) throw Object.assign(new Error("wikiwiki 拒绝访问（403）"), { blocked: true });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  }
  throw new Error("一直 429，放弃这一页");
}

const describe = (characters) => characters.map((c) => c.name + (c.id === null ? "（落雪没有）" : "#" + c.id)).join("、");
const BLOCKED = "wikiwiki 现在拒绝访问，先停下。过一段时间（至少半小时）再跑一次，会从这里接着查。";

async function main() {
  const opts = args();
  const out = readOut();
  out.sources = {
    releaseJP: "OTOGE DB（github.com/zvuc/otoge-db）chunithm/data/music-ex.json 的 date_added",
    characters: "CHUNITHM 攻略 wiki（wikiwiki.jp/chunithmwiki）「キャラクター世界観」1～3 页的角色和主题曲表，那里没有的曲子查曲目页的「対応キャラ」；按名字对上落雪角色列表的 ID",
  };
  out.songs = out.songs || {};

  const lxns = createLxnsClient({});
  const [list, charList, otoge] = await Promise.all([lxns.songList(), lxns.collectionList("character"), loadOtoge(opts.otoge)]);
  const otogeById = new Map(otoge.map((song) => [String(song.id), song]));
  const findChara = characterMatcher(charList.characters || []);
  console.log("落雪曲库 " + list.songs.length + " 首，角色 " + (charList.characters || []).length + " 个；OTOGE DB " + otoge.length + " 首");

  // 日服上线日期：全部曲目
  let dated = 0;
  for (const song of list.songs) {
    const entry = out.songs[song.id] || {};
    const raw = otogeById.get(String(song.id))?.date_added;
    if (/^\d{8}$/.test(raw || "")) {
      entry.releaseJP = raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8);
      dated++;
    }
    if (Object.keys(entry).length) out.songs[song.id] = entry;
  }
  console.log("日服上线日期：" + dated + " 首");
  writeOut(out);

  // 对应角色（一）：三张汇总页
  const targets = list.songs.filter((song) => GENRES.includes(song.genre) && song.id < 8000);
  const tally = (songs) => GENRES.map((genre) => genre + " " + songs.filter((song) => song.genre === genre).length).join("、");
  const items = [];
  for (const [i, page] of SUMMARY_PAGES.entries()) {
    if (i) await sleep(opts.delay);
    try {
      const html = await fetchWiki(WIKI + encodeURIComponent(page));
      if (!html) throw new Error("页面没有了（404），看看 wiki 是不是改了名字");
      const found = themeSongs(html);
      console.log("汇总页 " + page + "：" + found.length + " 项");
      items.push(...found);
    } catch (error) {
      console.log("汇总页 " + page + " 取不到：" + error.message + "。这次不动对应角色。");
      if (error.blocked) console.log(BLOCKED);
      return;
    }
  }
  const covered = assignCharacters(items, { songs: list.songs, characters: charList.characters || [] });
  if (covered.size < targets.length / 2) {
    // 平时能对上八成。对上这么少多半是 wiki 改了表格的样子，这时候别退去一页页查几百首
    console.log("汇总页只对上 " + covered.size + " / " + targets.length + " 首，不正常（wiki 可能改版了），先停下，看看 themeSongs 还认不认得那几张表。");
    return;
  }
  for (const [id, characters] of covered) out.songs[id] = { ...out.songs[id], characters };
  addFaces(out.songs, charList.characters || []);
  const unmatched =[...covered].flatMap(([id, characters]) => characters.filter((c) => c.id === null).map((c) => id + " " + c.name));
  console.log("汇总页对上 " + covered.size + " / " + targets.length + " 首（" + tally(list.songs.filter((song) => covered.has(song.id))) + "）；"
    + "角色在落雪找不到、只记名字的 " + unmatched.length + " 个：" + (unmatched.join("，") || "无"));
  writeOut(out);

  // 对应角色（二）：汇总页里没有的，一页一页查曲目页
  const todo = targets.filter((song) => !covered.has(song.id) && (opts.recheck || !out.songs[song.id]?.wikiChecked));
  console.log("要查曲目页的：" + todo.length + " 首（间隔 " + opts.delay / 1000 + " 秒，大约 " + Math.ceil(todo.length * opts.delay / 60000) + " 分钟）");
  let done = 0;
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; console.log("收到 Ctrl+C，写完这一页就停"); });
  for (const song of todo) {
    if (stopping || done >= opts.limit) break;
    await sleep(opts.delay);
    const target = wikiUrl(otogeById.get(String(song.id))?.wikiwiki_url, song.title);
    try {
      const html = await fetchWiki(target);
      const characters = (html ? charactersOn(html) : []).map((name) => findChara([name]) || { name, id: null });
      const entry = out.songs[song.id] || {};
      if (characters.length) entry.characters = characters;
      else delete entry.characters;
      entry.wikiChecked = true;
      out.songs[song.id] = entry;
      console.log("  " + song.id + " " + song.title + " → " + (describe(characters) || (html ? "没有对应角色" : "wiki 上没有这一页")));
    } catch (error) {
      console.log("  " + song.id + " " + song.title + " 查不到：" + error.message + "（下次再查）");
      if (error.blocked) {
        console.log(BLOCKED);
        break;
      }
    }
    done++;
    if (done % 5 === 0) writeOut(out);
  }
  addFaces(out.songs, charList.characters || []);
  writeOut(out);
  const left = targets.filter((song) => !covered.has(song.id) && !out.songs[song.id]?.wikiChecked);
  const withChara = targets.filter((song) => out.songs[song.id]?.characters?.length);
  console.log("一共 " + targets.length + " 首（" + tally(targets) + "）：有对应角色的 " + withChara.length + " 首（" + tally(withChara) + "；"
    + "汇总页 " + covered.size + "，曲目页 " + (withChara.length - covered.size) + "），"
    + "还剩 " + left.length + " 首没查" + (left.length ? "：" + left.map((song) => song.id + " " + song.title).join("，") : "") + "。");
  console.log("已写入 " + path.relative(ROOT, OUT));
}

module.exports = { themeSongs, assignCharacters, addFaces, charactersOn };

if (require.main === module) {
  main().catch((error) => {
    console.error("生成失败：" + (error?.stack || error));
    process.exit(1);
  });
}
