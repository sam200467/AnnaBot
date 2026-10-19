#!/usr/bin/env node
"use strict";
// 生成 src/data/song-bms.json：国服曲库里哪些是 BMS / BOF 出身的曲子。
// 落雪没有「BMS」这个字段；「其他游戏」里混着 BMS、Cytus、Deemo、Arcaea、Groove Coaster……这里只做 BMS。
// 来源是萌娘百科「CHUNITHM/曲目列表」VARIETY 表的备注：备注里写了 BMS、BOF、BOFU、BOFXV 之类就是 BMS 系。
// 萌百是 CC BY-NC-SA，这里只取「哪首歌是 BMS」这个事实（曲目 ID 列表），不复制正文；曲子对不上国服曲库的不算。
// 新版本出曲后要重新跑一次：萌百页面可能被 Cloudflare 挡，先自己用浏览器打开、把 wikitext 存下来，用 --wiki 文件。
//
// 用法：node tools/build-song-bms.cjs [--wiki 文件] [--songs 文件]
//   --wiki   本地的 wikitext（默认从 moegirl.icu 的 action=raw 拉）
//   --songs  本地曲库缓存（默认走落雪公共接口）

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createLxnsClient } = require("../src/lxns.cjs");
const { loose } = require("../src/catalog.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src", "data", "song-bms.json");
const WIKI_URL = "https://moegirl.icu/index.php?title=CHUNITHM/%E6%9B%B2%E7%9B%AE%E5%88%97%E8%A1%A8&action=raw";

function args() {
  const list = process.argv.slice(2);
  const option = (name) => {
    const i = list.indexOf(name);
    return i < 0 ? undefined : list[i + 1];
  };
  return { wiki: option("--wiki"), songs: option("--songs") };
}

async function loadWiki(file) {
  if (file) return fs.readFileSync(path.resolve(file), "utf8");
  try {
    const res = await fetch(WIKI_URL, { headers: { "user-agent": "Mozilla/5.0 (AnnaBot song-bms; low rate)" }, signal: AbortSignal.timeout(30000) });
    if (res.ok) return await res.text();
  } catch {
    // 走下面的 curl
  }
  return execFileSync("curl", ["-s", "-f", "-L", "-m", "120", "-A", "Mozilla/5.0", WIKI_URL], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

// 去掉 wiki 标记，只留显示的字
function plain(text) {
  return text
    .replace(/\{\{lj\|([^}]*)\}\}/g, "$1")
    .replace(/\{\{color\|[^|]*\|([^}]*)\}\}/g, "$1")
    .replace(/'''?/g, "")
    .replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

const unify = (text) => String(text ?? "").normalize("NFKC")
  .replace(/[‐‑‒–—―−]/g, "-").replace(/[‘’′]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, "");

// 曲名 → 落雪曲目：原样、不分大小写、宽松三级；那一级对上好几首就算对不上（跟 build-song-extras 一样）
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

// wikitext → [{ title, note }]：表格行里备注带 BMS / BOF 的
function bmsRows(wiki) {
  const rows = [];
  for (const line of wiki.split(/\r?\n/)) {
    if (!line.startsWith("|") || !/\b(?:BMS|BOF)/i.test(line)) continue;
    const cells = line.replace(/^\|/, "").split("||");
    if (cells.length < 6) continue;
    const title = plain(cells[0]);
    if (title) rows.push({ title, note: plain(cells[cells.length - 1]) });
  }
  return rows;
}

function writeOut(ids, unmatched) {
  const songs = [...ids].sort((a, b) => a - b);
  const text = JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: "萌娘百科「CHUNITHM/曲目列表」VARIETY 表备注里写了 BMS / BOF 的行，按曲名对上国服曲库；只取曲目 ID，不复制正文",
    songs,
    unmatched,
  }, null, 1) + "\n";
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT + ".tmp", text);
  fs.renameSync(OUT + ".tmp", OUT);
}

async function main() {
  const opts = args();
  const wiki = await loadWiki(opts.wiki);
  const songs = opts.songs
    ? JSON.parse(fs.readFileSync(path.resolve(opts.songs), "utf8")).data.songs
    : (await createLxnsClient({}).songList()).songs;
  const findSong = songMatcher(songs.filter((song) => song.id < 8000));
  const rows = bmsRows(wiki);
  const ids = new Set();
  const unmatched = [];
  for (const row of rows) {
    const song = findSong(row.title);
    if (song) ids.add(song.id);
    else unmatched.push(row.title);
  }
  writeOut(ids, unmatched);
  console.log("BMS / BOF 行 " + rows.length + "，对上国服曲库 " + ids.size + " 首"
    + (unmatched.length ? "；没对上 " + unmatched.length + "：" + unmatched.join("，") : ""));
  console.log("已写入 " + path.relative(ROOT, OUT));
}

module.exports = { bmsRows, songMatcher, plain };

if (require.main === module) {
  main().catch((error) => {
    console.error("生成失败：" + (error?.stack || error));
    process.exit(1);
  });
}
