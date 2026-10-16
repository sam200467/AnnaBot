#!/usr/bin/env node
"use strict";
// 生成 src/data/song-extras.json：每首歌的日服上线日期，原创曲还有对应角色（落雪的角色 ID，/单曲 出图时拿它的头像）。
// 落雪的曲库里没有这两样，所以在开发机上离线生成一份、随程序发布 —— 服务器在国内，不指望它连得上 GitHub 和 wikiwiki。
//
//   日服上线日期：OTOGE DB（github.com/zvuc/otoge-db，社区维护的日服曲库）music-ex.json 的 date_added，一次拉完。
//     Node 自带的 fetch 不走代理，连 GitHub 会被重置，所以这一份用 curl 拉（curl 认 HTTPS_PROXY 环境变量）；
//     也可以先自己下好，用 --otoge 文件路径 指定。
//   对应角色：CHUNITHM 攻略 wiki（wikiwiki.jp/chunithmwiki）每首原创曲页面信息表里的「対応キャラ」，
//     按名字对上落雪的角色列表（2026-10-16 抽查 6 个全都一字不差）。对不上的（国服没有这个角色）只记名字，图上只写名字不放头像。
//     wikiwiki 有频率限制：2026-10-16 隔 1.2 秒连抓 5 页就回 429，再抓就整段时间都回 403。
//     所以一页一页慢慢来（默认间隔 15 秒），429 了等一会儿再试，403 就停下（被拒了，过一段时间再跑，别换线路硬抓）；
//     已经查过的下次不再查，出新版本时再跑一次只补新曲。跑一半中断了也没关系，每查几页就写一次盘。
//
// 用法：node tools/build-song-extras.cjs [--delay 15000] [--limit 数量] [--recheck] [--otoge 文件]
//   --limit   这次最多查多少页 wiki（试跑用）
//   --recheck 已经查过的原创曲也重查一遍（wiki 上补了对应角色时用）

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createLxnsClient } = require("../src/lxns.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src", "data", "song-extras.json");
const OTOGE_URL = "https://raw.githubusercontent.com/zvuc/otoge-db/master/chunithm/data/music-ex.json";
const WIKI = "https://wikiwiki.jp/chunithmwiki/";
const ORIGINAL = "原创";

function args() {
  const list = process.argv.slice(2);
  const option = (name) => {
    const i = list.indexOf(name);
    return i < 0 ? undefined : list[i + 1];
  };
  return {
    delay: Number(option("--delay")) || 15000,
    limit: Number(option("--limit")) || Infinity,
    recheck: list.includes("--recheck"),
    otoge: option("--otoge"),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (name) => String(name || "").normalize("NFKC").replace(/\s+/g, "");

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

// 曲目页信息表里「対応キャラ」那一格。几个角色时 wiki 里用换行或「、」隔开。
// 不能按「／」拆：角色的变体名本身就带它（「愛野 ヒカリ／最愛の光」）
function charactersOn(html) {
  const strip = (s) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
  for (const row of html.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const cells = [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => strip(m[1]));
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

async function main() {
  const opts = args();
  const out = readOut();
  out.sources = {
    releaseJP: "OTOGE DB（github.com/zvuc/otoge-db）chunithm/data/music-ex.json 的 date_added",
    characters: "CHUNITHM 攻略 wiki（wikiwiki.jp/chunithmwiki）曲目页的「対応キャラ」，按名字对上落雪角色列表的 ID",
  };
  out.songs = out.songs || {};

  const lxns = createLxnsClient({});
  const [list, charList, otoge] = await Promise.all([lxns.songList(), lxns.collectionList("character"), loadOtoge(opts.otoge)]);
  const otogeById = new Map(otoge.map((song) => [String(song.id), song]));
  const charByName = new Map();
  for (const chara of charList.characters || []) charByName.set(norm(chara.name), chara.id);
  console.log("落雪曲库 " + list.songs.length + " 首，角色 " + charByName.size + " 个；OTOGE DB " + otoge.length + " 首");

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

  // 对应角色：原创曲（不含 WE），一页一页查
  const todo = list.songs.filter((song) => song.genre === ORIGINAL && song.id < 8000 && (opts.recheck || !out.songs[song.id]?.wikiChecked));
  console.log("要查 wiki 的原创曲：" + todo.length + " 首（间隔 " + opts.delay / 1000 + " 秒）");
  let done = 0;
  let found = 0;
  let unmatched = 0;
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; console.log("收到 Ctrl+C，写完这一页就停"); });
  for (const song of todo) {
    if (stopping || done >= opts.limit) break;
    const target = wikiUrl(otogeById.get(String(song.id))?.wikiwiki_url, song.title);
    try {
      const html = await fetchWiki(target);
      const names = html ? charactersOn(html) : [];
      const characters = names.map((name) => ({ name, id: charByName.get(norm(name)) ?? null }));
      const entry = out.songs[song.id] || {};
      if (characters.length) entry.characters = characters;
      else delete entry.characters;
      entry.wikiChecked = true;
      out.songs[song.id] = entry;
      if (characters.length) found++;
      unmatched += characters.filter((c) => c.id === null).length;
      console.log("  " + song.id + " " + song.title + " → " + (characters.map((c) => c.name + (c.id === null ? "（落雪没有）" : "#" + c.id)).join("、") || (html ? "没有对应角色" : "wiki 上没有这一页")));
    } catch (error) {
      console.log("  " + song.id + " " + song.title + " 查不到：" + error.message + "（下次再查）");
      if (error.blocked) {
        console.log("wikiwiki 现在拒绝访问，先停下。过一段时间（至少半小时）再跑一次，会从这里接着查。");
        break;
      }
    }
    done++;
    if (done % 5 === 0) writeOut(out);
    await sleep(opts.delay);
  }
  writeOut(out);
  const left = list.songs.filter((song) => song.genre === ORIGINAL && song.id < 8000 && !out.songs[song.id]?.wikiChecked).length;
  console.log("这次查了 " + done + " 页：" + found + " 首有对应角色，" + unmatched + " 个角色在落雪找不到；还剩 " + left + " 首没查。");
  console.log("已写入 " + path.relative(ROOT, OUT));
}

main().catch((error) => {
  console.error("生成失败：" + (error?.stack || error));
  process.exit(1);
});
