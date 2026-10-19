#!/usr/bin/env node
"use strict";
// 生成 src/data/song-origins.json：落雪把「音击舞萌」合成一个分类，这里拆出每首歌是从 オンゲキ 还是 maimai 来的。
// 落雪自己没有这个字段，OTOGE DB（github.com/zvuc/otoge-db）有分开的曲库：
//   ongeki/data/music.json        category === "オンゲキ" 是オンゲキ原创；"チュウマイ" 是从中二 / 舞萌移植过去的，不算
//   maimai/data/maimai_songs.json catcode !== "オンゲキ＆CHUNITHM" 算舞萌侧（后者是从中二 / 音击移植过去的）
// 按曲名匹配（catalog 的 loose：大小写、全半角、空格、常见标点都不看）。先原样比，再去掉 [..] / ［..］ 和 ～..～ 的
// 后缀比一次 —— 「D✪N’T ST✪P R✪CKIN’ ～[✪_✪] MIX～」在中二里带 remix 后缀，舞萌曲库里叫「D✪N’T ST✪P R✪CKIN’」。
// 两边都有的记「両方」；都对不上记进 unmatched，下次出新曲时看一眼。注意这是「从哪个游戏移植进来」，
// 不是「这首歌最初属于谁」——很多 BMS 曲在舞萌里也有，BMS 是另一张表（song-bms.json）。
//
// 用法：node tools/build-song-origins.cjs [--ongeki 文件] [--maimai 文件] [--songs 文件]
//   --ongeki / --maimai  用本地已经下好的 JSON（省一次下载）
//   --songs              用本地曲库缓存（默认走落雪公共接口，不要密钥）

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createLxnsClient } = require("../src/lxns.cjs");
const { loose } = require("../src/catalog.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src", "data", "song-origins.json");
const ONGEKI_URL = "https://raw.githubusercontent.com/zvuc/otoge-db/main/ongeki/data/music.json";
const MAIMAI_URL = "https://raw.githubusercontent.com/zvuc/otoge-db/main/maimai/data/maimai_songs.json";

function args() {
  const list = process.argv.slice(2);
  const option = (name) => {
    const i = list.indexOf(name);
    return i < 0 ? undefined : list[i + 1];
  };
  return { ongeki: option("--ongeki"), maimai: option("--maimai"), songs: option("--songs") };
}

// Node 自带的 fetch 不走代理，连 GitHub 会被重置；失败时退回 curl（curl 认 HTTPS_PROXY）
async function loadJson(url, file) {
  if (file) return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (res.ok) return await res.json();
  } catch {
    // 走下面的 curl
  }
  const text = execFileSync("curl", ["-s", "-f", "-L", "-m", "120", url], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return JSON.parse(text);
}

// 去掉 remix / 版本后缀再比一次。只去成对的方括号和波浪线，不要动曲名里的普通括号
const baseTitle = (title) => loose(String(title ?? "")
  .replace(/[\[［][^\]］]*[\]］]/g, "")
  .replace(/[～〜~][^～〜~]*[～〜~]/g, ""));

// 两边各自建一张「归一化曲名」集合。同一首歌的通常版和 LUNATIC 版在 OTOGE DB 里是两行，
// 曲名一样，按集合算一首，不会因为重复被当成「撞名」。
function titleSet(list, keep) {
  const set = new Set();
  for (const song of list) {
    if (!keep(song)) continue;
    const key = loose(song.title);
    if (key) set.add(key);
  }
  return set;
}

// songs：落雪曲库（至少要有 id/title/genre）。返回 { origins: Map(id → 音击|舞萌|両方), unmatched: [song] }
function classify({ songs, ongeki, maimai }) {
  const ongekiSet = titleSet(ongeki, (song) => song.category === "オンゲキ");
  const maimaiSet = titleSet(maimai, (song) => song.catcode !== "オンゲキ＆CHUNITHM");
  const hit = (set, song) => set.has(loose(song.title)) || set.has(baseTitle(song.title));
  const origins = new Map();
  const unmatched = [];
  for (const song of songs) {
    if (song.genre !== "音击舞萌" || song.id >= 8000) continue;
    const o = hit(ongekiSet, song);
    const m = hit(maimaiSet, song);
    if (o && m) origins.set(song.id, "両方");
    else if (o) origins.set(song.id, "音击");
    else if (m) origins.set(song.id, "舞萌");
    else unmatched.push(song);
  }
  return { origins, unmatched };
}

function writeOut(origins, unmatched) {
  const songs = Object.fromEntries([...origins].sort(([a], [b]) => a - b).map(([id, origin]) => [id, origin]));
  const text = JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: {
      ongeki: "OTOGE DB ongeki/data/music.json，category === オンゲキ",
      maimai: "OTOGE DB maimai/data/maimai_songs.json，catcode !== オンゲキ＆CHUNITHM",
      rule: "按曲名（loose）匹配，原样对不上时去掉 [..] / ～..～ 后缀再对一次；两边都有记「両方」",
    },
    songs,
    unmatched: unmatched.map((song) => song.id + " " + song.title),
  }, null, 1) + "\n";
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT + ".tmp", text);
  fs.renameSync(OUT + ".tmp", OUT);
}

async function main() {
  const opts = args();
  let songs;
  if (opts.songs) songs = JSON.parse(fs.readFileSync(path.resolve(opts.songs), "utf8")).data.songs;
  else songs = (await createLxnsClient({}).songList()).songs;
  const [ongeki, maimai] = await Promise.all([loadJson(ONGEKI_URL, opts.ongeki), loadJson(MAIMAI_URL, opts.maimai)]);
  const { origins, unmatched } = classify({ songs, ongeki, maimai });
  writeOut(origins, unmatched);
  const count = (value) => [...origins.values()].filter((origin) => origin === value).length;
  console.log("音击 " + count("音击") + "、舞萌 " + count("舞萌") + "、两边都有 " + count("両方") + "、没对上 " + unmatched.length
    + (unmatched.length ? "：" + unmatched.map((song) => song.id + " " + song.title).join("，") : ""));
  console.log("已写入 " + path.relative(ROOT, OUT));
}

module.exports = { classify, baseTitle, titleSet };

if (require.main === module) {
  main().catch((error) => {
    console.error("生成失败：" + (error?.stack || error));
    process.exit(1);
  });
}
