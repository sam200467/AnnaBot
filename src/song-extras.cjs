"use strict";
// 曲目的附加信息：日服上线日期，原创、彩绿、音击舞萌曲的对应角色，世界观厂牌 labels（/分数列表 分类筛用）。落雪的曲库里没有这些，
// 由 tools/build-song-extras.cjs 在开发机上生成 src/data/song-extras.json、随程序发布（来源和做法见那个工具的开头）。
//
//   songExtras.get(850) → { releaseJP: "2019-12-19", labels: ["シビュラ精霊記レーベル", "精霊編"],
//                          characters: [{ name: "ティータ・アヴェニアス", id: 8790 }] }
//   国服没有这张卡时 id 是 null，同一个人别的卡落雪有的话 face 是那张卡的 ID（借它的头像）：
//   { name: "箱部 なる／波瀾の新入生編", id: null, face: 510 }
//
// 文件缺了、坏了都不影响出图：get 返回 null，图上就不写这些。
//
// 落雪里根本没有的角色（国服没这个人，也借不到头像），头像是作者让从 wikiwiki 角色页的立绘上截的：
// tools/character-icons.cjs 生成，放在 themes/shared/icons/character-jp/，跟别的第三方素材一样不进仓库、打包时带上。
// 文件名是角色名（NFKC）sha1 的前 12 位：名字里有「／」「＆」这类字，部署包是 zip，中日文文件名解压时怕乱码。
// 那张图不在（换了机器、没跑过工具）就照旧只写名字。

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "data", "song-extras.json");
const JP_ICON_DIR = path.join(__dirname, "..", "themes", "shared", "icons", "character-jp");

const jpIconName = (name) => crypto.createHash("sha1").update(String(name).normalize("NFKC")).digest("hex").slice(0, 12) + ".png";

// 这个角色截好的头像文件；没有就是 null
function jpIconFile(name, dir = JP_ICON_DIR) {
  const file = path.join(dir, jpIconName(name));
  return fs.existsSync(file) ? file : null;
}

function loadSongExtras(file = FILE) {
  let songs = {};
  try {
    songs = JSON.parse(fs.readFileSync(file, "utf8")).songs || {};
  } catch {
    songs = {};
  }
  return {
    get: (id) => songs[String(id)] || null,
    get size() { return Object.keys(songs).length; },
  };
}

module.exports = { loadSongExtras, jpIconName, jpIconFile, FILE, JP_ICON_DIR };
