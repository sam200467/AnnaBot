"use strict";
// 曲目分类标签：官方分类、世界观厂牌、来源游戏、BMS。
//
// 数据分四层：
//   genre   直接看曲库的 song.genre（落雪官方分类，100% 覆盖，新曲不用维护）
//   label   来自 src/data/song-extras.json 的 labels（tools/build-song-extras.cjs 从 wiki「キャラクター世界観」页的 h2/h3 栏目生成）。
//           /分数列表 只用顶层栏目；精霊編、地上編这些章名映射到父分类，不单独统计
//   origin  来自 src/data/song-origins.json（tools/build-song-origins.cjs 从 OTOGE DB 的オンゲキ / maimai 曲库反查）
//   list    来自 src/data/song-bms.json（tools/build-song-bms.cjs 从萌百备注整理的 BMS / BOF 曲目 ID）
//
// 一个标签可以只属于其中一层，匹配时看对应的字段；「音击」只看 origin，「彩绿」只看 genre，互不干扰。
// 标签别名都在 DEFINITIONS 里：中文、日文、英文、常见缩写都可以；命令里翻页用 command（不带空格，保证能再解析回来）。
//
// 为什么不在曲库上直接加字段：曲库每 6 小时从落雪刷新一次，分类表是离线生成的；分开以后新曲至少还能按官方分类筛。

const fs = require("node:fs");
const path = require("node:path");
const { loadSongExtras } = require("./song-extras.cjs");

const ORIGINS_FILE = path.join(__dirname, "data", "song-origins.json");
const BMS_FILE = path.join(__dirname, "data", "song-bms.json");

// 比较别名用：全半角统一、小写、去空格（「Genesis Of Destiny」和「genesisofdestiny」算一个）
const normalize = (text) => String(text ?? "").normalize("NFKC").toLowerCase().replace(/[\s　]+/g, "");

// genre：落雪官方分类；label：wiki 厂牌 / 章节；origin：来源游戏；list："bms" 整理表。
// command 是翻页提示里写的词，必须是一个 token（不能有空格），并且要在 aliases 里能查到。
const DEFINITIONS = [
  // ── 官方分类（落雪 genre）──
  { key: "原创", name: "原创", command: "原创", genre: "原创", aliases: ["原创", "原创曲", "original", "オリジナル"] },
  { key: "niconico", name: "niconico", command: "niconico", genre: "niconico", aliases: ["niconico", "ニコニコ", "niko", "vocaloid", "ボカロ"] },
  { key: "东方", name: "东方Project", command: "东方", genre: "东方Project", aliases: ["东方", "東方", "东方project", "東方project", "touhou", "车万"] },
  { key: "音击舞萌", name: "音击舞萌", command: "音击舞萌", genre: "音击舞萌", aliases: ["音击舞萌", "音擊舞萌", "ゲキマイ", "gekimai"] },
  { key: "彩绿", name: "彩绿", command: "彩绿", genre: "彩绿", aliases: ["彩绿", "彩綠", "イロドリミドリ", "irodori", "irodorimidori", "彩绿计划"] },
  { key: "流行动漫", name: "流行 & 动漫", command: "流行动漫", genre: "流行 & 动漫", aliases: ["流行动漫", "流行", "pops", "anime", "pops&anime", "流行&动漫"] },
  { key: "其他游戏", name: "其他游戏", command: "其他游戏", genre: "其他游戏", aliases: ["其他游戏", "其他", "variety"] },

  // ── 来源游戏（song-origins.json）──
  { key: "音击", name: "音击", command: "音击", origin: "音击", aliases: ["音击", "音擊", "オンゲキ", "ongeki", "音击少女"] },
  { key: "舞萌", name: "舞萌", command: "舞萌", origin: "舞萌", aliases: ["舞萌", "maimai", "マイマイ", "舞萌DX", "maimaiDX"] },

  // ── 世界观厂牌（song-extras.json 的 labels；只用顶层栏目，章不再单独做分类）──
  { key: "精灵记", name: "精灵记", command: "精灵记", label: "シビュラ精霊記レーベル", aliases: ["精灵记", "精霊記", "精霊记", "シビュラ精霊記", "シビュラ", "sibyl", "西比拉", "西比拉精灵记", "精灵传记", "精霊編", "精霊编", "精灵篇", "精霊篇", "スカージ編", "スカージ", "scourge", "天灾篇", "天災篇"] },
  { key: "SeelischTact", name: "SeelischTact", command: "SeelischTact", label: "SeelischTactレーベル", aliases: ["seelischtact", "seelisch", "ゼーリシュタクト", "ゼーリ", "泽利"] },
  { key: "GUMIN", name: "GUMIN", command: "GUMIN", label: "GUMINレーベル", aliases: ["gumin", "グミン", "愚民大陆", "愚民"] },
  { key: "リレイション", name: "リレイション", command: "リレイション", label: "リレイションレーベル", aliases: ["リレイション", "リレーション", "relation", "心连羁绊", "心连", "羁绊"] },
  { key: "GenesisOfDestiny", name: "Genesis Of Destiny", command: "GenesisOfDestiny", label: "Genesis Of Destinyレーベル", aliases: ["genesisofdestiny", "genesis", "god", "ジェネシス", "创世命运", "创世"] },
  { key: "Metaverse", name: "Metaverse", command: "Metaverse", label: "Metaverseレーベル", aliases: ["metaverse", "メタバース", "元宇宙", "虚拟世界", "虚拟世界篇", "电脑世界", "电脑世界篇", "仮想世界編", "仮想世界", "地上編", "地上篇", "新章"] },
  { key: "アニマリア", name: "アニマリア", command: "アニマリア", label: "アニマリアレーベル", aliases: ["アニマリア", "animalia", "群码动物仙境", "群马动物仙境", "动物仙境"] },
  { key: "オムニバス", name: "オムニバス", command: "オムニバス", label: "オムニバスレーベル", aliases: ["オムニバス", "omnibus", "vtuber", "合集", "群星"] },
  { key: "其他原创", name: "其他原创", command: "其他原创", label: "他のORIGINAL関連", aliases: ["其他原创", "其他原创曲", "杂项原创", "その他", "otheroriginal"] },
  { key: "言ノ葉", name: "言ノ葉Project", command: "言ノ葉", label: "言ノ葉Project", aliases: ["言ノ葉", "言叶", "言葉", "言ノ叶", "kotonoha", "言ノ葉project", "言叶计划", "言灵计划"] },

  // ── 整理表（song-bms.json）──
  { key: "BMS", name: "BMS", command: "BMS", list: "bms", aliases: ["bms", "bof", "bofu", "bms曲"] },
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// extras：有 get(id) 的 song-extras；origins：{ "曲目 ID": "音击" | "舞萌" | "両方" }；bms：曲目 ID 数组
function createSongTags({ extras = loadSongExtras(), origins = {}, bms = [] } = {}) {
  const defs = DEFINITIONS.map((def) => ({ ...def, command: def.command || def.key }));
  const byAlias = new Map();
  for (const def of defs) {
    for (const alias of [...(def.aliases || []), def.command]) {
      const key = normalize(alias);
      if (key && !byAlias.has(key)) byAlias.set(key, def);
    }
  }
  const bmsSet = new Set(bms.map(Number));
  const labelsOf = (song) => extras.get(song.id)?.labels || [];
  const originOf = (song) => origins[String(song.id)] || null;

  // tag 可以是 resolve 出来的定义，也可以直接写词（测试、调试用）
  function has(song, tag) {
    const def = typeof tag === "string" ? byAlias.get(normalize(tag)) : tag;
    if (!def) return false;
    if (def.genre && song.genre === def.genre) return true;
    if (def.label && labelsOf(song).includes(def.label)) return true;
    if (def.origin && (originOf(song) === def.origin || originOf(song) === "両方")) return true;
    if (def.list === "bms" && bmsSet.has(Number(song.id))) return true;
    return false;
  }

  function resolve(word) {
    return byAlias.get(normalize(word)) || null;
  }
  function name(tag) {
    const def = typeof tag === "string" ? resolve(tag) : tag;
    return def?.name || "";
  }
  function command(tag) {
    const def = typeof tag === "string" ? resolve(tag) : tag;
    return def?.command || "";
  }

  return { defs, resolve, has, name, command, labelsOf, originOf, bmsSet };
}

let cached = null;
// 正式运行时用的一份（数据文件缺了也不影响启动：genre 照常，其他层为空）
function loadSongTags(options = {}) {
  if (!cached) {
    const origins = options.origins ?? readJson(ORIGINS_FILE).songs ?? {};
    const bms = options.bms ?? readJson(BMS_FILE).songs ?? [];
    cached = createSongTags({ origins, bms, ...(options.extras ? { extras: options.extras } : {}) });
  }
  return cached;
}

module.exports = { createSongTags, loadSongTags, normalize, DEFINITIONS, ORIGINS_FILE, BMS_FILE };
