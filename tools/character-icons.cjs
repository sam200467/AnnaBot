#!/usr/bin/env node
"use strict";
// 落雪里没有的角色头像：从 CHUNITHM 攻略 wiki（wikiwiki.jp/chunithmwiki）角色页的立绘上截一块脸，做成 256 见方的头像，
// 放到 themes/shared/icons/character-jp/（文件名见 src/song-extras.cjs 的 jpIconName），/单曲 出图时给这些角色用。
// 作者 2026-10-16 让截的：对应角色里国服没这个人、也借不到同一个人别的卡头像的 29 个（言ノ葉 1st Season 一批、GEMINI 双子等）。
// 头像跟别的第三方素材一样不进仓库，打包时跟着 themes/shared/icons/ 走。
//
// 截哪一块写在 tools/character-icons.json：
//   { "name": 角色名（跟 src/data/song-extras.json 里写的一样）, "page": wiki 角色页, "image": 页里那张图的文件名,
//     "crop": [左, 上, 边长]（原图的像素，wiki 上的立绘一般 400 见方） }
// 新角色要截时往里加一条，跑一次，看 --sheet 出的总览图（头像裁成跟 /单曲 一样的圆章）再调坐标。
// 立绘先下到 data/character-art/（不进仓库），下过的不再下。wikiwiki 有频率限制（见 build-song-extras.cjs 的开头）：
// 角色页一页一页取、间隔至少 15 秒，403 / 429 就停；图在 cdn.wikiwiki.jp 上，也隔几秒取一张。
// 截图用出图的那套无头浏览器（src/renderer.cjs），页面是 tools/character-icons/crop/renderer/theme.html。
//
// 用法：node tools/character-icons.cjs [--sheet 总览图.png]

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRenderer } = require("../src/renderer.cjs");
const { jpIconName, JP_ICON_DIR } = require("../src/song-extras.cjs");

const ROOT = path.resolve(__dirname, "..");
const TABLE = path.join(__dirname, "character-icons.json");
const ART_DIR = path.join(ROOT, "data", "character-art");
const WIKI = "https://wikiwiki.jp/chunithmwiki/";
const SIZE = 256;
const PAGE_DELAY = 15000;
const CDN_DELAY = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (AnnaBot song-extras; low rate)" }, signal: AbortSignal.timeout(30000) });
  if (res.status === 403 || res.status === 429) throw new Error("wikiwiki 拒绝访问（HTTP " + res.status + "），过一段时间（至少半小时）再跑，下好的不会重下");
  if (!res.ok) throw new Error("HTTP " + res.status + "：" + url);
  return res;
}

// 角色页里那张图的原图地址。页面上显示的 <img src="…/::ref/<文件名>.webp"> 是缩到 400 见方的预览，
// 外面包着的 <a href="…/::attach/<文件名>?rev=…"> 才是原图（脸只占立绘的一小块，从预览里截 256 的头像会糊）
function imageUrl(html, image) {
  for (const m of html.matchAll(/href="([^"]*\/::attach\/[^"]*)"/g)) {
    const href = m[1].replace(/&amp;/g, "&");
    if (decodeURIComponent(href.split("::attach/")[1].split("?")[0]) === image) return href;
  }
  return null;
}

// 缺的立绘下下来。同一页上的几张（ジェミニ・α 和 Ω 在一页上）只取一次页面
async function fetchArt(entries) {
  const pages = new Map();
  let lastPage = 0;
  let lastImage = 0;
  for (const entry of entries) {
    const file = path.join(ART_DIR, entry.image);
    if (fs.existsSync(file)) continue;
    if (!pages.has(entry.page)) {
      await sleep(Math.max(0, lastPage + PAGE_DELAY - Date.now()));
      lastPage = Date.now();
      pages.set(entry.page, await (await get(WIKI + encodeURIComponent(entry.page))).text());
    }
    const src = imageUrl(pages.get(entry.page), entry.image);
    if (!src) {
      console.log("  " + entry.name + "：「" + entry.page + "」页里没找到 " + entry.image + "（wiki 换了图？去页面上看看新文件名）");
      continue;
    }
    await sleep(Math.max(0, lastImage + CDN_DELAY - Date.now()));
    lastImage = Date.now();
    const buffer = Buffer.from(await (await get(src)).arrayBuffer());
    fs.mkdirSync(ART_DIR, { recursive: true });
    fs.writeFileSync(file, buffer);
    console.log("  下好了：" + entry.name + "（" + entry.image + "）");
  }
}

async function main() {
  const at = process.argv.indexOf("--sheet");
  const sheet = at > 0 && process.argv[at + 1] ? path.resolve(process.argv[at + 1]) : null;
  const entries = JSON.parse(fs.readFileSync(TABLE, "utf8"));
  console.log("要截的角色 " + entries.length + " 个");
  await fetchArt(entries);

  const renderer = createRenderer({ themesDir: path.join(__dirname, "character-icons"), scale: 1 });
  fs.mkdirSync(JP_ICON_DIR, { recursive: true });
  const index = {};
  const made = [];
  for (const entry of entries) {
    const art = path.join(ART_DIR, entry.image);
    if (!fs.existsSync(art)) continue;
    const out = await renderer.render("crop", { src: pathToFileURL(art).href, crop: entry.crop, size: SIZE }, { width: SIZE, height: SIZE });
    const file = jpIconName(entry.name);
    fs.writeFileSync(path.join(JP_ICON_DIR, file), out.buffer);
    index[file] = { name: entry.name, page: entry.page, image: entry.image };
    made.push({ name: entry.name, src: pathToFileURL(path.join(JP_ICON_DIR, file)).href, crop: [0, 0, SIZE] });
  }
  // 给人看的对照表：哪张图是谁、从哪页截的（换图时找得到）
  fs.writeFileSync(path.join(JP_ICON_DIR, "index.json"), JSON.stringify(index, null, 1) + "\n");
  console.log("截好 " + made.length + " 个头像，在 " + path.relative(ROOT, JP_ICON_DIR));

  if (sheet) {
    const out = await renderer.render("crop", { sheet: made }, { width: 1400, height: 900 });
    fs.mkdirSync(path.dirname(sheet), { recursive: true });
    fs.writeFileSync(sheet, out.buffer);
    console.log("总览图：" + sheet);
  }
  await renderer.idle();
}

main().catch((error) => {
  console.error("失败：" + (error?.stack || error));
  process.exit(1);
});
