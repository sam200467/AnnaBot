#!/usr/bin/env node
"use strict";
// 生成 src/data/song-search.json：曲名搜索用的两张表（怎么用见 src/song-search.cjs）。
// 在开发机上离线生成、随程序发布：运行时不用 opencc-js（Anna 运行时只依赖 ws），服务器在国内也连不上 GitHub。
// opencc-js 是开发依赖（package.json 的 devDependencies，钉在 1.4.2），npm install 就装上；打包只带 dependencies，服务器上没有它。
//
//   variants：简体、繁体、日文新字体的对照。用 opencc-js（OpenCC 的字典，Apache-2.0；跟 MiaBot 用的同一版），
//     把每个汉字在简体、台湾、香港、日文、OpenCC 标准繁体之间各个方向都转一遍，转得到一起的字连成一组。
//     只照 MiaBot 那样「新字体 → 繁体 → 简体」单向转不够：OpenCC 把「闘」转成「鬭」，「鬭」再转简体还是「鬭」，
//     「大乱斗」就搜不到《タテマエと本心の大乱闘》；反过来「斗」转日文是「闘」，所以要各个方向都转才连得上。
//     「姫 / 姬」「郷 / 乡」「焔 / 焰」也是这样连上的。「燄」OpenCC 不认识，手动补（EXTRA）。
//     每组挑一个代表字（优先简体，只是为了表好读，搜索只看是不是同一组），表里写「代表字: 同组的其他字」。
//     收的是基本区、扩展 A 区里 OpenCC 会转的全部汉字（2026-10-16：3092 组、47 KB，最大的一组 6 个字），不只是现在曲名、
//     别名里有的（那样只有 600 来组）：落雪的别名运行时每 6 小时刷新一次，新别名、新曲里的字也要能简繁互通，不用为这个重新生成。
//   readings：每首歌的官方片假名读音（去掉了浊点、小字、长音的写法：「タテマエトホンシンノタイラントウ」）。
//     来自 OTOGE DB（github.com/zvuc/otoge-db，社区维护的日服曲库）chunithm/data/music-ex.json 的 reading，
//     曲目 ID 跟落雪的一致（2026-10-16 落雪 1406 首普通曲全对得上，曲名也一样）。
//     WE 不记，运行时用原曲的；英文曲名的 reading 只是去掉空格的大写字母，没用，也不记。
//     日服有、国服还没有的歌照样记上，国服以后上了就不用重新生成；拉落雪曲库只为核对（ID 对上、曲名不一样的不记）。
//     Node 自带的 fetch 不走代理，连 GitHub 会被重置，所以跟 build-song-extras.cjs 一样退回用 curl（认 HTTPS_PROXY 环境变量）。
//
// 新版本出曲后跑一次（主要是补读音）：npm run song-search [-- --otoge 文件]
//   --otoge   先自己下好的 music-ex.json

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createLxnsClient } = require("../src/lxns.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "src", "data", "song-search.json");
const OTOGE_URL = "https://raw.githubusercontent.com/zvuc/otoge-db/master/chunithm/data/music-ex.json";
// OpenCC 的几种写法：简体、台湾、香港、日文新字体、OpenCC 标准繁体（opencc-js 里叫 t）
const SCRIPTS = ["cn", "tw", "hk", "jp", "t"];
// 基本区、扩展 A 区、兼容区（兼容区的字运行时 NFKC 先换掉了，只剩十几个本身就是正式汉字的，比如「﨑」）
const RANGES = [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]];
// OpenCC 没有的异体字，一串是一组
const EXTRA = ["焰焔燄"];

function args() {
  const list = process.argv.slice(2);
  const option = (name) => {
    const i = list.indexOf(name);
    return i < 0 ? undefined : list[i + 1];
  };
  const unknown = list.filter((arg, i) => arg.startsWith("--") && arg !== "--otoge" && list[i - 1] !== "--otoge");
  if (unknown.length) throw new Error("不认识的参数：" + unknown.join(" ") + "\n用法：npm run song-search [-- --otoge 文件]");
  return { otoge: option("--otoge") };
}

function loadOpenCC() {
  let OpenCC;
  try {
    OpenCC = require("opencc-js");
  } catch {
    throw new Error("没装 opencc-js：先在 Anna 的目录下 npm install（它在 devDependencies 里）");
  }
  // 版本号记进生成的文件（它的 exports 没放出 package.json，直接读文件）
  let version = "?";
  try {
    version = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "opencc-js", "package.json"), "utf8")).version;
  } catch {
    // 读不到就写个问号
  }
  return { OpenCC, version };
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

// GB2312 里的汉字（简体常用字），挑代表字用
function gb2312() {
  const decoder = new TextDecoder("gb2312");
  const set = new Set();
  for (let hi = 0xb0; hi <= 0xf7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const ch = decoder.decode(Uint8Array.of(hi, lo));
      if (/^\p{Script=Han}$/u.test(ch)) set.add(ch);
    }
  }
  return set;
}

// 异体字组：每个字在各种写法之间转一遍，转出来是另一个字（单个字）就连到一起
function variantGroups(OpenCC, chars) {
  const converters = [];
  for (const from of SCRIPTS) {
    for (const to of SCRIPTS) if (from !== to) converters.push({ toCn: to === "cn", convert: OpenCC.Converter({ from, to }) });
  }
  const parent = new Map();
  const find = (ch) => {
    let root = ch;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(ch) !== root) {
      const next = parent.get(ch);
      parent.set(ch, root);
      ch = next;
    }
    return root;
  };
  const add = (ch) => { if (!parent.has(ch)) parent.set(ch, ch); };
  const union = (a, b) => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const intoCn = new Map(); // 字 → 有几个别的字转简体时转成它（挑代表字用）
  for (const ch of chars) {
    add(ch);
    for (const { toCn, convert } of converters) {
      const out = convert(ch);
      if (out === ch || [...out].length !== 1) continue;
      union(ch, out);
      if (toCn) intoCn.set(out, (intoCn.get(out) || 0) + 1);
    }
  }
  for (const [first, ...rest] of EXTRA.map((group) => [...group])) for (const ch of rest) union(first, ch);
  const groups = new Map();
  for (const ch of parent.keys()) {
    const root = find(ch);
    groups.set(root, [...(groups.get(root) || []), ch]);
  }
  const simplified = gb2312();
  const byCode = (a, b) => a.codePointAt(0) - b.codePointAt(0);
  const variants = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // 代表字：GB2312 里有的优先，再看被转成它的次数，再按码位
    const [main, ...others] = [...members].sort((a, b) => Number(simplified.has(b)) - Number(simplified.has(a))
      || (intoCn.get(b) || 0) - (intoCn.get(a) || 0) || byCode(a, b));
    variants.push([main, others.sort(byCode).join("")]);
  }
  return variants.sort(([a], [b]) => byCode(a, b));
}

const hasKana = (text) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
const sameTitle = (a, b) => String(a ?? "").normalize("NFKC").trim() === String(b ?? "").normalize("NFKC").trim();

async function main() {
  const opts = args();
  const { OpenCC, version } = loadOpenCC();
  const lxns = createLxnsClient({});
  const [list, aliasList, otoge] = await Promise.all([lxns.songList(), lxns.aliasList(), loadOtoge(opts.otoge)]);
  console.log("落雪曲库 " + list.songs.length + " 首、别名 " + (aliasList?.aliases?.length || 0) + " 条；OTOGE DB " + otoge.length + " 首");

  // 汉字：三个区的全部，再加上曲名、别名里不在这三个区的（扩展 B 区以后的字）
  const chars = new Set();
  for (const [from, to] of RANGES) {
    for (let code = from; code <= to; code++) {
      const ch = String.fromCodePoint(code);
      if (ch.normalize("NFKC") === ch) chars.add(ch);
    }
  }
  const texts = [...list.songs.map((song) => song.title), ...(aliasList?.aliases || []).flatMap((entry) => entry.aliases)];
  for (const text of texts) for (const ch of String(text).normalize("NFKC")) if (/\p{Script=Han}/u.test(ch)) chars.add(ch);
  const variants = variantGroups(OpenCC, chars);
  console.log("异体字：" + variants.length + " 组，" + variants.reduce((n, [, others]) => n + [...others].length, 0) + " 个字换成代表字");

  // 读音：普通曲（WE 用原曲的），有假名的才记；跟落雪 ID 对上但曲名不一样的不记
  const lxnsById = new Map(list.songs.map((song) => [String(song.id), song]));
  const readings = [];
  const mismatched = [];
  for (const song of otoge) {
    if (song.we_kanji || song.we_star || !/^\d+$/.test(String(song.id)) || !hasKana(song.reading || "")) continue;
    const lxnsSong = lxnsById.get(String(song.id));
    if (lxnsSong && !sameTitle(lxnsSong.title, song.title)) {
      mismatched.push(song.id + "（落雪《" + lxnsSong.title + "》，OTOGE DB《" + song.title + "》）");
      continue;
    }
    readings.push([Number(song.id), String(song.reading).normalize("NFKC").trim()]);
  }
  readings.sort(([a], [b]) => a - b);
  const withReading = new Set(readings.map(([id]) => id));
  // 落雪的普通曲里曲名带假名、汉字的（英文曲名本来就不需要读音），看看还有哪些没有
  const wanted = list.songs.filter((song) => !song.difficulties?.some((d) => d.difficulty === 5)
    && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(song.title));
  const missing = wanted.filter((song) => !withReading.has(song.id));
  console.log("读音：" + readings.length + " 首；落雪曲名带假名或汉字的普通曲 " + wanted.length + " 首，"
    + (missing.length ? "缺 " + missing.length + " 首：" + missing.map((song) => song.id + "《" + song.title + "》").join("，") : "都有"));
  if (mismatched.length) console.warn("⚠ 曲名对不上、没记读音的：" + mismatched.join("，"));

  const out = {
    generatedAt: new Date().toISOString(),
    sources: {
      variants: "opencc-js " + version + "（OpenCC 的字典，Apache-2.0）：简体、台湾、香港、日文新字体、标准繁体之间单字互转连成的异体字组，另补 " + EXTRA.join("、"),
      readings: "OTOGE DB（github.com/zvuc/otoge-db）chunithm/data/music-ex.json 的 reading",
    },
    variants: Object.fromEntries(variants),
    readings: Object.fromEntries(readings),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT + ".tmp", JSON.stringify(out, null, 1) + "\n");
  fs.renameSync(OUT + ".tmp", OUT);
  console.log("已写入 " + path.relative(ROOT, OUT) + "（" + Math.round(fs.statSync(OUT).size / 1024) + " KB）");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("生成失败：" + (error?.stack || error));
    process.exit(1);
  });
}
