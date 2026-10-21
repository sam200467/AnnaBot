#!/usr/bin/env node
"use strict";
// 离线读缓存的 wiki 源码：只把单人栏中与本地谱面署名完全一致的名字归到栏目谱师。
// 合作栏、颜色标出的合作署名和冲突归属保留原样；不从介绍中的“猜测”推断身份。
const fs = require("node:fs");
const path = require("node:path");
const { normalize } = require("../src/chart-designers.cjs");
const ROOT = path.resolve(__dirname, "..");

function removeNotes(text) {
  let depth = 0;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text.slice(i, i + 2) === "((") { depth++; i++; }
    else if (depth && text.slice(i, i + 2) === "))") { depth--; i++; }
    else if (!depth) out += text[i];
  }
  return out;
}

function plain(text) {
  let out = removeNotes(text).replace(/\[\[#.*?\]\]/g, "").replace(/\[#.*?\]/g, "")
    .replace(/\[\[([^\]]*?)\]\]/g, (_, link) => link.split(">")[0])
    .replace(/&br;/g, " ").replace(/(?:BGCOLOR|COLOR|SIZE|CENTER|LEFT|RIGHT)(?:\([^)]*\))?:/g, "");
  for (let i = 0; i < 6; i++) out = out.replace(/&(?:ruby|color|size|aname)(?:\([^)]*\))?\{([^{}]*)\};?/g, "$1");
  return out.replace(/'{2,3}/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").trim();
}

function parseSource(text, page) {
  const records = [];
  const redirects = [];
  const aliases = [];
  let owner = "";
  let aliasFold = false;
  let lastCredit = null;
  let lastSong = "";
  for (const [i, original] of text.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (/^\*(?!\*)/.test(line)) { owner = plain(line.slice(1)); aliasFold = false; lastCredit = null; lastSong = ""; continue; }
    if (!owner || line.startsWith("//")) continue;
    if (/^#fold\(.*別名義/.test(line)) aliasFold = true;
    if (line === "}}") aliasFold = false;
    const alias = /^-別名義[：:]([^\n]+)/.exec(line)?.[1] || (aliasFold ? /^-''([^']+)''/.exec(line)?.[1] : null);
    if (alias) aliases.push({ owner, name: plain(alias), page, line: i + 1 });
    const redirect = /^(?:→\[\[([^>\]]+)>|\[\[→([^>\]]+)>)/.exec(line);
    if (redirect) redirects.push({ from: owner, to: plain(redirect[1] || redirect[2]), page, line: i + 1 });
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = line.slice(1, -1).split("|");
    if (cells[0].includes("曲名")) { lastCredit = null; lastSong = ""; continue; }
    if (!cells[0].includes("[[") && cells[0] !== "~") continue;
    if (cells[0] !== "~") lastSong = plain(cells[0]);
    const diffAt = cells.findIndex((cell, c) => c > 0 && /^[BAEMU]$/.test(plain(cell).replace(/^~/, "")));
    if (diffAt < 0) continue;
    const difficulty = plain(cells[diffAt]).replace(/^~/, "");
    const creditAt = cells.findIndex((cell, c) => c > diffAt && cell !== ">");
    if (creditAt < 0) continue;
    const raw = cells[creditAt];
    if (raw !== "~") {
      lastCredit = { credit: plain(raw), joint: /BGCOLOR\(#ddddff\)/i.test(raw) ||
        (cells.length === 5 && creditAt === 4) || /&color\(red\)/i.test(raw) };
    }
    if (!lastCredit || !["M", "U"].includes(difficulty) || !lastCredit.credit || lastCredit.credit === "~") continue;
    records.push({ owner, song: lastSong, difficulty: difficulty === "M" ? 3 : 4, ...lastCredit, page, line: i + 1 });
  }
  return { records, redirects, aliases };
}

function buildGroups(songs, pages) {
  const parsed = pages.map(({ text, page }) => parseSource(text, page));
  const redirectMap = new Map(parsed.flatMap((entry) => entry.redirects).map((entry) => [normalize(entry.from), entry.to]));
  const root = (name) => {
    const seen = new Set();
    while (redirectMap.has(normalize(name)) && !seen.has(normalize(name))) {
      seen.add(normalize(name)); name = redirectMap.get(normalize(name));
    }
    return name;
  };
  const local = new Map();
  for (const song of songs) {
    if (song.disabled || song.difficulties.some((chart) => chart.difficulty === 5)) continue;
    for (const chart of song.difficulties) if ([3, 4].includes(chart.difficulty) && chart.note_designer) {
      local.set(normalize(chart.note_designer), chart.note_designer);
    }
  }
  const candidates = new Map();
  const allRecords = parsed.flatMap((entry) => entry.records);
  // 同一合作谱可能在其中一人的栏目里没涂合作色，另一人栏目却明确标合作；跨页统一排除。
  const excluded = new Set(allRecords.filter((record) => record.joint || record.page === 5).map((record) => normalize(record.credit)));
  for (const record of allRecords) {
    const key = normalize(record.credit);
    if (!local.has(key) || excluded.has(key) || record.page === 5) continue;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({ ...record, owner: root(record.owner) });
  }
  const groups = {};
  const conflicts = [];
  for (const [key, records] of candidates) {
    const owners = [...new Set(records.map((record) => record.owner))];
    if (owners.length !== 1) { conflicts.push({ credit: local.get(key), owners }); continue; }
    const name = owners[0];
    if (!groups[name]) groups[name] = { credits: [name], sources: [], evidenceByCredit: {}, evidence: "wiki 谱师栏目中的单人署名；排除合作栏，未合并介绍中的推测身份。" };
    const group = groups[name];
    if (!group.credits.some((credit) => normalize(credit) === key)) group.credits.push(local.get(key));
    for (const record of records) {
      const source = "https://wikiwiki.jp/chunithmwiki/譜面制作者一覧" + record.page;
      if (!group.sources.includes(source)) group.sources.push(source);
      if (!group.evidenceByCredit[local.get(key)]) group.evidenceByCredit[local.get(key)] = {
        source, line: record.line, song: record.song, difficulty: record.difficulty,
      };
    }
  }
  for (const redirect of parsed.flatMap((entry) => entry.redirects)) {
    const group = groups[root(redirect.from)];
    if (group && !group.credits.some((credit) => normalize(credit) === normalize(redirect.from))) group.credits.push(redirect.from);
  }
  for (const alias of parsed.flatMap((entry) => entry.aliases)) {
    const group = groups[root(alias.owner)];
    if (group && !group.credits.some((credit) => normalize(credit) === normalize(alias.name))) group.credits.push(alias.name);
  }
  for (const group of Object.values(groups)) {
    group.source = group.sources[0];
    group.credits = [group.credits[0], ...group.credits.slice(1).sort((a, b) => a.localeCompare(b, "ja"))];
  }
  return { groups, conflicts, matchedCredits: candidates.size, rawCredits: local.size,
    excludedCredits: [...local].filter(([key]) => excluded.has(key)).map(([, credit]) => credit), records: allRecords };
}

function main() {
  const cache = path.join(ROOT, "data/wiki-pages/designers");
  const pages = [1, 2, 3, 4, 5].map((page) => ({ page, text: fs.readFileSync(path.join(cache, page + ".wiki.txt"), "utf8") }));
  if (pages.some(({ text }) => text.includes("MISSING LINE"))) throw new Error("缓存有缺行，不生成归属表");
  const songs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/cache/songs.json"), "utf8")).data.songs;
  const result = buildGroups(songs, pages);
  fs.writeFileSync(path.join(cache, "audit.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(cache, "groups-candidate.json"), JSON.stringify(result.groups, null, 2) + "\n");
  console.log(JSON.stringify({ groups: Object.keys(result.groups).length, matchedCredits: result.matchedCredits,
    rawCredits: result.rawCredits, conflicts: result.conflicts }, null, 2));
}

module.exports = { plain, parseSource, buildGroups };
if (require.main === module) main();
