"use strict";
// 曲目的附加信息：日服上线日期、原创曲的对应角色。落雪的曲库里没有这两样，
// 由 tools/build-song-extras.cjs 在开发机上生成 src/data/song-extras.json、随程序发布（来源和做法见那个工具的开头）。
//
//   songExtras.get(850) → { releaseJP: "2019-12-19", characters: [{ name: "ティータ・アヴェニアス", id: 8790 }] }
//
// 文件缺了、坏了都不影响出图：get 返回 null，图上就不写这两样。

const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "data", "song-extras.json");

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

module.exports = { loadSongExtras, FILE };
