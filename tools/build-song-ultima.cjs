#!/usr/bin/env node
"use strict";
// 日服 ULTIMA 追加版本：查每个版本的「楽曲一覧(追加日順)」，只认明确标为 ULTIMA 的行。
// 落雪实测把现有 ULTIMA 的 version 都填成歌曲初出版本；OTOGE DB 的 date_updated 又会被难度改动覆盖，
// 两者都不能拿来推算追加版本。离线整理后合并进 song-extras.json，服务器出图不联网查 wiki。
// 用法：node tools/build-song-ultima.cjs [--pages 本地目录] [--songs 曲库JSON] [--delay 15000]
// 本地目录放 NEW.txt、NEW-PLUS.txt 等 wiki 源代码，或同名 .html；缺少的文件会报错，不联网补抓。
// 支持带 L123: 前缀的公开索引文本。直连被 403 拒绝时立即停止，保留之前的资料。

const fs = require("node:fs");
const path = require("node:path");
const { createLxnsClient } = require("../src/lxns.cjs");
const { tableGrid, cellText, cellLinks, songMatcher, fetchWiki } = require("./build-song-extras.cjs");

const VERSIONS = ["NEW", "NEW PLUS", "SUN", "SUN PLUS", "LUMINOUS", "LUMINOUS PLUS", "VERSE", "X-VERSE", "X-VERSE-X", "Mate"];
const pageUrl = (version) => "https://wikiwiki.jp/chunithmwiki/" + encodeURIComponent("CHUNITHM " + version + " 楽曲一覧(追加日順)");
const OUT = path.join(__dirname, "..", "src", "data", "song-extras.json");

function ultimaSongs(body) {
  const result = [];
  // LUMINOUS 的 Halcyon 把 ULTIMA 误写成 LEVEL，但仍使用 ULTIMA 专属的红色单元格；只修正这一种组合。
  body = body.replace(/BGCOLOR\(#ff1c33\):LEVEL/g, "BGCOLOR(#ff1c33):ULTIMA")
    .replace(/(<t[dh]\b[^>]*(?:background(?:-color)?\s*:\s*#ff1c33|bgcolor=["']#ff1c33)[^>]*>)\s*LEVEL(?=\s*<\/t[dh]>)/gi, "$1ULTIMA");
  if (/<table\b/i.test(body)) {
    for (const match of body.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
      for (const row of tableGrid(match[0])) {
        if (!row[1] || !row.some((cell) => cell && cellText(cell.html) === "ULTIMA")) continue;
        const names = cellLinks(row[1].html).flatMap((link) => [link.text, link.page]);
        if (names.length) result.push([...new Set(names)]);
      }
    }
  } else {
    let names = [];
    for (const line of body.split(/\r?\n/)) {
      const text = line.replace(/^L\d+:\s*/, "").trim();
      if (!text.startsWith("|")) continue;
      const cells = text.split("|").slice(1, -1);
      if (cells.length < 4) { names = []; continue; }
      if (cells[1] !== "~") {
        names = [...cells[1].matchAll(/\[\[([^\]]+)\]\]/g)].flatMap((m) => m[1].split(">"))
          .map(cellText);
      }
      if (names.length && cells.some((cell) => /(?:^|:)ULTIMA$/.test(cell))) result.push([...new Set(names)]);
    }
  }
  return result;
}

function assignUltimaVersions(pages, songs) {
  const findSong = songMatcher(songs.filter((song) => song.id < 8000 && song.difficulties?.some((chart) => chart.difficulty === 4)));
  const versions = new Map();
  for (const version of VERSIONS) {
    if (typeof pages[version] !== "string") throw new Error("缺少 " + version + " 的追加清单");
    const items = ultimaSongs(pages[version]);
    if (!items.length) throw new Error(version + " 没有解析到 ULTIMA 行，先检查页面格式");
    for (const names of items) {
      const song = names.map(findSong).find(Boolean);
      // 偶尔复活时再次列出同一张谱面，按版本顺序留首次出现的版本。
      if (song && !versions.has(song.id)) versions.set(song.id, version);
    }
  }
  return versions;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const dir = option("--pages");
  const songFile = option("--songs");
  const raw = songFile ? JSON.parse(fs.readFileSync(songFile, "utf8")) : await createLxnsClient({}).songList();
  const songs = raw.songs || raw.data?.songs;
  if (!Array.isArray(songs) || !songs.length) throw new Error("曲库没有歌曲");
  const pages = {};
  for (const [i, version] of VERSIONS.entries()) {
    if (dir) {
      const stem = path.join(dir, version.replaceAll(" ", "-"));
      const file = [stem + ".txt", stem + ".html"].find((file) => fs.existsSync(file));
      if (!file) throw new Error("缺少本地清单：" + stem + ".txt / .html");
      pages[version] = fs.readFileSync(file, "utf8");
    } else {
      if (i) await new Promise((resolve) => setTimeout(resolve, Math.max(15000, Number(option("--delay")) || 15000)));
      pages[version] = await fetchWiki(pageUrl(version));
      if (!pages[version]) throw new Error(version + " 的追加清单不存在");
    }
  }
  const versions = assignUltimaVersions(pages, songs);
  const targets = songs.filter((song) => song.id < 8000 && song.difficulties?.some((chart) => chart.difficulty === 4));
  const missing = targets.filter((song) => !versions.has(song.id));
  // 格式改变或曲名没对上时保留原文件，别把不完整的资料发布出去。
  if (missing.length) throw new Error("以下 ULTIMA 没对上追加清单：" + missing.map((song) => song.id + " " + song.title).join("、"));
  const out = JSON.parse(fs.readFileSync(OUT, "utf8"));
  for (const [id, version] of versions) out.songs[id] = { ...out.songs[id], ultimaVersionJP: version };
  out.sources.ultimaVersionJP = { description: "CHUNITHM 攻略 wiki 各版本「楽曲一覧(追加日順)」中明确标为 ULTIMA 的行；按曲名对上落雪，复活重列时保留最早版本", pages: VERSIONS.map(pageUrl) };
  out.generatedAt = new Date().toISOString();
  fs.writeFileSync(OUT + ".tmp", JSON.stringify(out, null, 1) + "\n");
  fs.renameSync(OUT + ".tmp", OUT);
  console.log("日服 ULTIMA 追加版本：" + versions.size + " / " + targets.length + " 首");
}

module.exports = { VERSIONS, ultimaSongs, assignUltimaVersions };
if (require.main === module) main().catch((error) => { console.error("生成失败：" + error.message); process.exitCode = 1; });
