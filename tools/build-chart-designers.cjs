#!/usr/bin/env node
"use strict";
// 离线读缓存的 wiki 源码：把单人栏中的署名归到栏目谱师，合作栏及组合署名分别归入每位参与谱师；不从介绍中的“猜测”推断身份。
const fs = require("node:fs");
const path = require("node:path");
const { normalize, splitCollaborators } = require("../src/chart-designers.cjs");
const ROOT = path.resolve(__dirname, "..");

const DIFF_MAP = { M: 3, U: 4 };
const VERSION_PREFIXES = ["PLUS～：", "AIR～：", "SUN PLUS～：", "NEW～：", "PARADISE～：", "STAR～：", "CRYSTAL～："];
const EXTRA_REDIRECTS = [
  ["翠楼屋", "サファ太"],
  ["緑化委員長", "はっぴー"],
];
const EXTRA_SOLO_CREDITS = {
  "ぴちネコ": ["Яussianblack"],
  "écologie": ["écologie*"],
  "じゃこレモン": ["Grim Shooter Lemon", "檸檬・優曇華院・イナバ"],
  "アミノハバキリ": ["ハバキリ@三角コーナー"],
  "すきやき奉行": ["最後に勝つのはやっぱり奉行よね！"],
};
const EXTRA_JOINT_CREDITS = {
  "合作だよ": ["ロシェ＠ペンギン", "ミニミライト", "ミストルティン", "アミノハバキリ", "じゃこレモン"],
  "チュウニ譜面ボーイズの反逆": ["ぴちネコ", "Techno Kitchen", "ミストルティン", "écologie", "じゃこレモン", "Moon Strix"],
  '譜面ボーイズからの祈り -Pray for "JUSTICE"-': ["Techno Kitchen", "アミノハバキリ", "ロシェ＠ペンギン", "Redarrow", "じゃこレモン", "小鳥遊さん"],
  "Don't Fight Chuni Fumen Boys": ["じゃこレモン", "ロシェ＠ペンギン", "アミノハバキリ", "Techno Kitchen"],
  "Chaotic Blade vs Blanc=diLLe": ["アミノハバキリ"],
  "りょっかとレモン": ["はっぴー", "じゃこレモン"],
};
const JOINT_SONGS = {
  "Gate of Fate": ["ロシェ＠ペンギン", "Revo@LC", "Techno Kitchen"],
  "怒槌": ["ロシェ＠ペンギン", "Techno Kitchen", "Revo@LC", "ぴちネコ"],
  "Contrapasso -inferno-": ["ロシェ＠ペンギン", "Techno Kitchen", "如月 ゆかり", "Revo@LC", "ぴちネコ"],
  "混沌を越えし我らが神聖なる調律主を讃えよ": ["ミストルティン", "ロシェ＠ペンギン", "ものくろっく", "Techno Kitchen", "Moon Strix"],
  "World Vanquisher": ["Jack", "Revo@LC", "ぴちネコ", "小鳥遊さん", "Techno Kitchen"],
  "Gate of Doom": ["Moon Strix", "LabiLabi", "すきやき奉行", "ものくろっく", "ぴちネコ", "ミストルティン"],
  "larva": ["じゃこレモン", "すきやき奉行", "Emerald", "ミストルティン"],
  "LAMIA": ["ミストルティン", "Redarrow", "ロシェ＠ペンギン", "じゃこレモン"],
  "Forsaken Tale": ["ミニミライト", "ロシェ＠ペンギン", "Clematis", "ミストルティン", "夕凪アロエ", "じゃこレモン", "みぞれヤナギ", "アミノハバキリ"],
  "Crossmythos Rhapsodia": ["アミノハバキリ", "ロシェ＠ペンギン", "じゃこレモン", "ミストルティン", "みぞれヤナギ"],
  "夜のサーカス": ["じゃこレモン", "ミストルティン", "ロシェ＠ペンギン"],
};

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
  let out = removeNotes(text).replace(/\[\[#[^>\]]*?\]\]/g, "").replace(/\[#.*?\]/g, "")
    .replace(/\[\[([^\]]*?)\]\]/g, (_, link) => link.split(">")[0])
    .replace(/&br;/g, " ").replace(/(?:BGCOLOR|COLOR|SIZE|CENTER|LEFT|RIGHT)(?:\([^)]*\))?:/gi, "");
  for (let i = 0; i < 6; i++) out = out.replace(/&(?:ruby|color|size|aname)(?:\([^)]*\))?\{([^{}]*)\};?/gi, "$1");
  out = out.replace(/'{2,3}/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/[“”]/g, '"').replace(/〖/g, "【").replace(/〗/g, "】").trim();
  for (const tag of VERSION_PREFIXES) {
    if (out.includes(tag)) out = out.split(tag).pop().trim();
  }
  return out;
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
    if (line.endsWith("|h")) { lastCredit = null; lastSong = ""; continue; }
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = line.slice(1, -1).split("|");
    if (cells[0].trim().startsWith("~曲名")) { lastCredit = null; lastSong = ""; continue; }
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
    if (!lastCredit || !(difficulty in DIFF_MAP) || !lastCredit.credit || lastCredit.credit === "~") continue;
    records.push({ owner, song: lastSong, difficulty: DIFF_MAP[difficulty], ...lastCredit, page, line: i + 1 });
  }
  return { records, redirects, aliases };
}

function buildGroups(songs, pages) {
  const parsed = pages.map(({ text, page }) => parseSource(text, page));
  const redirectMap = new Map([
    ...parsed.flatMap((entry) => entry.redirects).map((entry) => [normalize(entry.from), entry.to]),
    ...EXTRA_REDIRECTS.map(([from, to]) => [normalize(from), to]),
  ]);
  const root = (name) => {
    const seen = new Set();
    while (redirectMap.has(normalize(name)) && !seen.has(normalize(name))) {
      seen.add(normalize(name)); name = redirectMap.get(normalize(name));
    }
    return name;
  };
  const local = new Map();
  const bySongDiff = new Map();
  const masterTitles = new Map();
  for (const song of songs) {
    if (song.disabled || song.difficulties.some((chart) => chart.difficulty === 5)) continue;
    for (const chart of song.difficulties) {
      if ((chart.difficulty === 3 || chart.difficulty === 4) && chart.note_designer) {
        const name = String(chart.note_designer).trim();
        local.set(normalize(name), name);
        if (song.title) {
          if (chart.difficulty === 3) masterTitles.set(normalize(song.title), song.title);
          const sk = normalize(song.title) + ":" + chart.difficulty;
          bySongDiff.set(sk, bySongDiff.has(sk) ? null : name);
        }
      }
    }
  }
  const allRecords = parsed.flatMap((entry) => entry.records);
  const unknownCredits = new Set([
    ...allRecords.filter((record) => record.page === 5 && record.owner === "譜面製作者不明").map((record) => normalize(record.credit)),
    normalize("譜面ボーイズからの挑戦状"),
    normalize("(表記無し)"),
  ]);
  const candidates = new Map();
  for (const record of allRecords) {
    if (record.page === 5) continue;
    const owner = root(record.owner);
    if (owner === "Toaster" || owner === "背景担当K") continue;
    let key = normalize(record.credit);
    if (key === normalize("(表記無し)")) continue;
    const actual = bySongDiff.get(normalize(record.song) + ":" + record.difficulty);
    if (actual && (!local.has(key) || normalize(actual) !== normalize(owner))) {
      key = normalize(actual);
    }
    if (!local.has(key) || unknownCredits.has(key)) continue;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({ ...record, owner });
  }
  const groups = {};
  const ensureGroup = (name) => {
    if (!groups[name]) {
      groups[name] = {
        credits: [name],
        jointCredits: [],
        jointSongs: [],
        sources: [],
        evidenceByCredit: {},
        evidence: "wiki 谱师栏目中的单人署名与合作署名；未合并介绍中的推测身份。",
      };
    }
    return groups[name];
  };
  const addEvidence = (group, creditName, record) => {
    const source = "https://wikiwiki.jp/chunithmwiki/譜面制作者一覧" + record.page;
    if (!group.sources.includes(source)) group.sources.push(source);
    if (!group.evidenceByCredit[creditName]) {
      group.evidenceByCredit[creditName] = { source, line: record.line, song: record.song, difficulty: record.difficulty };
    }
  };
  const conflicts = [];
  for (const [key, records] of candidates) {
    const owners = [...new Set(records.map((record) => record.owner))];
    const soloOwners = [...new Set(records.filter((record) => !record.joint).map((record) => record.owner))];
    const isJoint = records.some((record) => record.joint) || owners.length > 1;
    const creditName = local.get(key);
    if (soloOwners.length > 1) {
      conflicts.push({ credit: creditName, owners: soloOwners });
      continue;
    }
    if (!isJoint && owners.length === 1) {
      const group = ensureGroup(owners[0]);
      if (!group.credits.some((credit) => normalize(credit) === key)) group.credits.push(creditName);
      for (const record of records) addEvidence(group, creditName, record);
    } else if (owners.length > 1 && soloOwners.length === 1 && key === normalize(soloOwners[0])) {
      const group = ensureGroup(soloOwners[0]);
      if (!group.credits.some((credit) => normalize(credit) === key)) group.credits.push(creditName);
      for (const record of records.filter((r) => r.owner === soloOwners[0])) addEvidence(group, creditName, record);
    } else {
      for (const owner of owners) {
        const group = ensureGroup(owner);
        if (!group.jointCredits.some((credit) => normalize(credit) === key)) group.jointCredits.push(creditName);
        for (const record of records.filter((r) => r.owner === owner)) addEvidence(group, creditName, record);
      }
    }
  }
  for (const redirect of parsed.flatMap((entry) => entry.redirects)) {
    const group = groups[root(redirect.from)];
    if (group && !group.credits.some((credit) => normalize(credit) === normalize(redirect.from))) group.credits.push(redirect.from);
  }
  for (const [from] of EXTRA_REDIRECTS) {
    const group = groups[root(from)];
    if (group && !group.credits.some((credit) => normalize(credit) === normalize(from))) group.credits.push(from);
  }
  for (const alias of parsed.flatMap((entry) => entry.aliases)) {
    const group = groups[root(alias.owner)];
    if (group && !group.credits.some((credit) => normalize(credit) === normalize(alias.name))) group.credits.push(alias.name);
  }
  for (const [ownerName, extraCredits] of Object.entries(EXTRA_SOLO_CREDITS)) {
    const group = groups[root(ownerName)];
    if (!group) continue;
    for (const credit of extraCredits) {
      const key = normalize(credit);
      if (local.has(key) && !group.credits.some((c) => normalize(c) === key)) {
        group.credits.push(local.get(key));
      }
    }
  }
  for (const [credit, owners] of Object.entries(EXTRA_JOINT_CREDITS)) {
    const key = normalize(credit);
    if (!local.has(key)) continue;
    const creditName = local.get(key);
    for (const ownerName of owners) {
      const group = groups[root(ownerName)];
      if (group && !group.credits.some((c) => normalize(c) === key) && !group.jointCredits.some((c) => normalize(c) === key)) {
        group.jointCredits.push(creditName);
      }
    }
  }
  for (const [title, owners] of Object.entries(JOINT_SONGS)) {
    const key = normalize(title);
    if (!masterTitles.has(key)) continue;
    const realTitle = masterTitles.get(key);
    for (const ownerName of owners) {
      const group = groups[root(ownerName)];
      if (group && !group.jointSongs.some((t) => normalize(t) === key)) group.jointSongs.push(realTitle);
    }
  }
  const soloLookup = new Map();
  for (const [name, group] of Object.entries(groups)) {
    for (const credit of group.credits) soloLookup.set(normalize(credit), name);
  }
  for (const [key, raw] of local) {
    const parts = splitCollaborators(raw);
    if (parts.length < 2) continue;
    for (const part of parts) {
      const owner = soloLookup.get(normalize(part));
      if (!owner) continue;
      const group = groups[owner];
      if (!group.credits.some((c) => normalize(c) === key) && !group.jointCredits.some((c) => normalize(c) === key)) {
        group.jointCredits.push(raw);
      }
    }
  }
  for (const group of Object.values(groups)) {
    group.source = group.sources[0];
    group.credits = [group.credits[0], ...group.credits.slice(1).sort((a, b) => a.localeCompare(b, "ja"))];
    group.jointCredits.sort((a, b) => a.localeCompare(b, "ja"));
    if (group.jointSongs.length) group.jointSongs.sort((a, b) => a.localeCompare(b, "ja"));
    else delete group.jointSongs;
  }
  const covered = new Set(Object.values(groups).flatMap((g) => [...g.credits, ...g.jointCredits].map(normalize)));
  return { groups, conflicts, matchedCredits: covered.size, rawCredits: local.size,
    excludedCredits: [...local].filter(([key]) => !covered.has(key)).map(([, credit]) => credit), records: allRecords };
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
