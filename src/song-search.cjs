"use strict";
// 曲名搜索：catalog.cjs 的 search / resolve 靠它认歌（/单曲 这类指令里写的曲名）。
// 照着 MiaBot 的搜索做的（mia-core.cjs 的 normalizeSongQuery、song-kana.cjs、qq-official/song-search.cjs），补了几样。
//
// 查询词和曲名、别名走同一条归一化（fold）：
//   - NFKC（全半角统一）、不分大小写，拉丁字母去掉重音（「fatalite」找到《GranFatalité》）
//   - 平假名换成片假名（「さどまみ」找到《サドマミホリック》）
//   - 简体、繁体、日文新字体互通：同一组异体字换成同一个字（「大乱斗」找到《タテマエと本心の大乱闘》，「混亂」找到《混乱》）。
//     对照表是 src/data/song-search.json 的 variants，tools/build-song-search.cjs 用 opencc-js 离线生成（运行时不装它）
// 比的时候再去掉空格和标点（keyOf）。希腊字母的曲名另记几种拉丁拼法，当别名用（「azure vixen」找到《Λzure Vixen》）。
//
// 排名（小的在前；同一名次里再看 gap，然后普通曲排在 WE 前面，再按 ID）：
//   0 「id123」写法，只认 ID
//   1 曲名完全一致，或者纯数字对上 ID ｜ 2 别名完全一致 ｜ 3 曲名开头 ｜ 4 别名开头 ｜ 5 曲名包含 ｜ 6 别名包含
//     曲名完全一致的几首，照原样打的那首在前（gap，见 exactness）
//     一首都没对上时，曲名、别名、查询词都去掉符号（☆ ♪ → 这些，打的人一般不打）再比一遍，名次照旧
//   7 读音完全一致 ｜ 8 读音开头 ｜ 9 读音包含：还没有才按假名比，平假名、片假名、罗马音都行。读音是官方的片假名读音
//     （song-search.json 的 readings，WE 用原曲的）和曲名里本来的假名，两边都「折叠」过（见 foldKana）。
//     前面有结果就不比读音，免得「sage」这种英文词顺带按「サケ」拖出一串歌（MiaBot 的经验）
//   10 查询词里含着完整曲名（抄曲名时连作者一起抄进来了）｜ 11 曲名相近（拼错、多打少打几个字，按编辑距离，差得少的在前）：
//     再没有才找，只当候选（fuzzy），resolve 不直接认定。MiaBot 只比整个曲名；这里查询词长一点时也比曲名里最像的一段，
//     只打了曲名的一部分又打错的（「shatered」）也找得到。拿真曲库造了一千多个拼错的查询试过，平均一次只出一两首候选

const fs = require("node:fs");
const path = require("node:path");

const DATA_FILE = path.join(__dirname, "data", "song-search.json");

// 文件缺了、坏了都不影响认歌：没有对照表就只按原字比，没有读音就只比曲名里的假名
function loadSearchData(file = DATA_FILE) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    raw = {};
  }
  const variants = new Map();
  for (const [main, others] of Object.entries(raw.variants || {})) for (const ch of others) variants.set(ch, main);
  const readings = new Map(Object.entries(raw.readings || {}).map(([id, reading]) => [Number(id), String(reading)]));
  return { variants, readings };
}

// ── 归一化 ──

// 拉丁字母上的重音和几个合字。只去拉丁字母后面的附加符号，假名的浊点不能动
const LATIN_LETTERS = { ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ł: "l", ı: "i" };
const plainLatin = (text) => text.normalize("NFD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC")
  .replace(/[øæœßđłı]/g, (ch) => LATIN_LETTERS[ch]);
const toKatakana = (text) => text.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

function makeFold(variants) {
  return (text) => {
    let out = "";
    for (const ch of toKatakana(plainLatin(String(text ?? "").normalize("NFKC").toLowerCase()))) out += variants.get(ch) ?? ch;
    return out;
  };
}

// 比的形式：去掉空格和标点（「～」NFKC 以后是「~」，算数学符号，也去掉）。全是标点的去完是空的，那时留着标点
const keyOf = (folded) => folded.replace(/[\s\p{P}~]/gu, "") || folded.replace(/\s+/g, " ").trim();
// 再去掉符号。全是符号的去完是空的，空的不拿去比（空串哪首歌都「包含」）
const bareOf = (key) => key.replace(/\p{S}/gu, "");
// 曲名完全一致时差在哪：0 原样一样，1 只差大小写，2 差在空格、标点、简繁这些。《FLOWER》和《Flower》、
// 《Over Heart》和《Overhea[r]t》比的形式是同一个，照原样打的要认得出是哪首
const tidy = (text) => String(text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const exactness = (title, query) => (title === query ? 0 : title.toLowerCase() === query.toLowerCase() ? 1 : 2);

// 希腊字母曲名的拉丁拼法：照读音转写、照字母名、照字形（《Λzure Vixen》的 Λ 是当 A 用的）
const GREEK_SOUND = { α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o" };
const GREEK_NAME = { α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ζ: "zeta", η: "eta", θ: "theta", ι: "iota", κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", ο: "omicron", π: "pi", ρ: "rho", σ: "sigma", ς: "sigma", τ: "tau", υ: "upsilon", φ: "phi", χ: "chi", ψ: "psi", ω: "omega" };
const GREEK_LOOK = { ...GREEK_SOUND, λ: "a" };
function greekSpellings(key) {
  const plain = key.normalize("NFD").replace(/(\p{Script=Greek})\p{M}+/gu, "$1").normalize("NFC");
  if (!/\p{Script=Greek}/u.test(plain)) return [];
  return [...new Set([GREEK_SOUND, GREEK_NAME, GREEK_LOOK].map((map) => plain.replace(/\p{Script=Greek}/gu, (ch) => map[ch] ?? ch)))];
}

// ── 假名读音（MiaBot 的 song-kana.cjs）──
// 比的是「折叠」过的片假名，两边走同一套规则：平假名换成片假名；去掉浊点、半浊点（ガ→カ、パ→ハ），小字换大字（ッ→ツ、ャ→ヤ），
// ヲ→オ；去掉长音符「ー」，再把拖长的元音并掉（カア→カ、トウ→ト、オオ→オ）。
// 这么粗是照着官方读音来的：《千本桜》是「センホンサクラ」、《シュガーソングとビターステップ》是「シユカソンクトヒタステツフ」，
// 浊点、小字、长音全没了。打的人也就不用在乎「shuga」「shugaa」「shuga-」、「toukyou」「tokyo」该打哪个。

const SMALL = { ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ", ヵ: "カ", ヶ: "ケ", ヲ: "オ", ヰ: "イ", ヱ: "エ" };
const ROWS = {
  ア: "アカサタナハマヤラワ", イ: "イキシチニヒミリ", ウ: "ウクスツヌフムユル", エ: "エケセテネヘメレ", オ: "オコソトノホモヨロ",
};
const VOWEL_OF = {};
for (const [vowel, row] of Object.entries(ROWS)) for (const kana of row) VOWEL_OF[kana] = vowel;

function foldKana(value) {
  const katakana = toKatakana(String(value ?? "").normalize("NFKC"));
  const plain = katakana.normalize("NFD").replace(/[\u3099\u309a]/g, "").normalize("NFC")   // 拆开后的浊点、半浊点
    .replace(/[ァィゥェォッャュョヮヵヶヲヰヱ]/g, (ch) => SMALL[ch]).replace(/ー/g, "");
  let out = "";
  for (const ch of plain) {
    const before = VOWEL_OF[out.at(-1)];
    if (before && (ch === before || (before === "オ" && ch === "ウ"))) continue;
    out += ch;
  }
  return out;
}

// 罗马音 → 片假名。赫本式、训令式都收（shi/si、chi/ti、tsu/tu、fu/hu、ji/zi、sha/sya……），
// 浊音反正要折叠掉，这里照样转出来就行。整串拆不干净就不算罗马音，返回 null。
const SYLLABLES = {
  a: "ア", i: "イ", u: "ウ", e: "エ", o: "オ",
  ka: "カ", ki: "キ", ku: "ク", ke: "ケ", ko: "コ", ga: "ガ", gi: "ギ", gu: "グ", ge: "ゲ", go: "ゴ",
  sa: "サ", si: "シ", shi: "シ", su: "ス", se: "セ", so: "ソ", za: "ザ", zi: "ジ", ji: "ジ", zu: "ズ", ze: "ゼ", zo: "ゾ",
  ta: "タ", ti: "チ", chi: "チ", tu: "ツ", tsu: "ツ", te: "テ", to: "ト", da: "ダ", di: "ヂ", du: "ヅ", de: "デ", do: "ド",
  na: "ナ", ni: "ニ", nu: "ヌ", ne: "ネ", no: "ノ",
  ha: "ハ", hi: "ヒ", hu: "フ", fu: "フ", he: "ヘ", ho: "ホ", ba: "バ", bi: "ビ", bu: "ブ", be: "ベ", bo: "ボ",
  pa: "パ", pi: "ピ", pu: "プ", pe: "ペ", po: "ポ",
  ma: "マ", mi: "ミ", mu: "ム", me: "メ", mo: "モ", ya: "ヤ", yu: "ユ", yo: "ヨ",
  ra: "ラ", ri: "リ", ru: "ル", re: "レ", ro: "ロ", wa: "ワ", wi: "ウィ", we: "ウェ", wo: "ヲ",
  fa: "ファ", fi: "フィ", fe: "フェ", fo: "フォ", va: "ヴァ", vi: "ヴィ", vu: "ヴ", ve: "ヴェ", vo: "ヴォ",
  thi: "ティ", dhi: "ディ", tyi: "ティ", dyi: "ディ", je: "ジェ", che: "チェ", she: "シェ",
};
for (const [head, kana] of Object.entries({ k: "キ", g: "ギ", n: "ニ", h: "ヒ", b: "ビ", p: "ピ", m: "ミ", r: "リ", s: "シ", z: "ジ", t: "チ", d: "ヂ" })) {
  for (const [vowel, small] of [["a", "ャ"], ["u", "ュ"], ["o", "ョ"]]) SYLLABLES[head + "y" + vowel] = kana + small;
}
for (const [head, kana] of [["sh", "シ"], ["ch", "チ"], ["j", "ジ"]]) {
  for (const [vowel, small] of [["a", "ャ"], ["u", "ュ"], ["o", "ョ"]]) SYLLABLES[head + vowel] = kana + small;
}
const LONGEST = Math.max(...Object.keys(SYLLABLES).map((syllable) => syllable.length));

function romajiToKana(value) {
  const text = String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s'’]+/g, (gap) => (gap.includes("'") || gap.includes("’") ? "'" : ""));
  if (!/^[a-z'\-]+$/.test(text)) return null;
  let out = "";
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === "-") { out += "ー"; i++; continue; }
    if (ch === "'") { i++; continue; }
    // 促音：辅音重写（kk、tt、ss……）或者 tch
    if (/[bcdfghjkmpqrstvwxyz]/.test(ch) && (text[i + 1] === ch || (ch === "t" && text[i + 1] === "c"))) { out += "ッ"; i++; continue; }
    if (ch === "n") {
      // nn、n'、词尾的 n、后面跟辅音（y 除外）的 n 都是「ン」
      if (text[i + 1] === "n") { out += "ン"; i += 2; continue; }
      if (i + 1 >= text.length || text[i + 1] === "'" || !/[aiueoy]/.test(text[i + 1])) { out += "ン"; i++; continue; }
    }
    if (ch === "m" && /[bpm]/.test(text[i + 1] || "")) { out += "ン"; i++; continue; }  // 赫本式 shimbun
    let hit = "";
    for (let len = Math.min(LONGEST, text.length - i); len > 0 && !hit; len--) {
      const kana = SYLLABLES[text.slice(i, i + len)];
      if (kana) { hit = kana; i += len; }
    }
    if (!hit) return null;
    out += hit;
  }
  return out;
}

// 查询词换成折叠后的片假名：本来就是假名的直接折叠，整串是罗马音的先转假名（带长音符号的「tōkyō」也认）。
// 太短的（折叠后不到两个假名）不拿来比，一个假名几乎哪首歌都含。
function queryKana(value) {
  const text = plainLatin(String(value ?? "").normalize("NFKC").trim());
  if (!text) return "";
  let kana = "";
  if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー\s・]+$/u.test(text)) kana = text.replace(/[\s・]+/g, "");
  else kana = romajiToKana(text) || "";
  const folded = foldKana(kana);
  return [...folded].length >= 2 ? folded : "";
}

// ── 相近的曲名 ──

// 编辑距离（增、删、改各算一步），按字（码位）算
function distance(a, b) {
  const s = [...a];
  const t = [...b];
  let row = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const next = [i];
    for (let j = 1; j <= t.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    row = next;
  }
  return row[t.length];
}

// 查询词跟曲名里最像的一段差几步，曲名前后多出来的字不算：只打了曲名的一部分、又打错了
function infixDistance(needle, hay) {
  const s = [...needle];
  const t = [...hay];
  let row = new Array(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    const next = [i];
    for (let j = 1; j <= t.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    row = next;
  }
  return Math.min(...row);
}

// 容几个错：不到 3 个字不找；3、4 个字容 1 个，再长的容四分之一、最多 3 个（MiaBot 的规矩）
const typoLimit = (length) => (length < 3 ? -1 : length < 5 ? 1 : Math.min(3, Math.floor(length / 4)));
// 查询词至少这么长才拿去跟曲名的一段比：短了几乎哪首歌里都有一段只差一个字的
const INFIX_MIN = 5;

// ── 索引 ──
// songs：曲库；aliasesOf(id)：别名；originOf(song)：读音用哪首的（WE 用原曲的）；isWorldsEnd(song)：排序时 WE 往后放
function createSearchIndex({ songs, aliasesOf = () => [], originOf = (song) => song.id, isWorldsEnd = () => false, data = loadSearchData() }) {
  const fold = makeFold(data.variants);
  const byId = new Map(songs.map((song) => [song.id, song]));
  const entries = songs.map((song) => {
    const title = keyOf(fold(song.title));
    const aliases = [...new Set([...aliasesOf(song.id).map((alias) => keyOf(fold(alias))), ...greekSpellings(title)])].filter(Boolean);
    return {
      song,
      plain: tidy(song.title),
      worldsEnd: isWorldsEnd(song),
      // 两种比法：留着符号的、去掉符号的（见文件头）
      forms: [{ title, aliases }, { title: bareOf(title), aliases: aliases.map(bareOf).filter(Boolean) }],
      kana: [...new Set([foldKana(title), foldKana(data.readings.get(originOf(song)) || "")])].filter(Boolean),
    };
  });
  const entryOf = new Map(entries.map((entry) => [entry.song, entry]));

  function byText(q, form, raw, add) {
    const long = q.length >= 2;
    for (const entry of entries) {
      const { title, aliases } = entry.forms[form];
      if (title === q) add(entry, 1, "title", exactness(entry.plain, raw));
      else if (aliases.includes(q)) add(entry, 2, "alias");
      else if (title.startsWith(q)) add(entry, 3, "title");
      else if (aliases.some((alias) => alias.startsWith(q))) add(entry, 4, "alias");
      else if (long && title.includes(q)) add(entry, 5, "title");
      else if (long && aliases.some((alias) => alias.includes(q))) add(entry, 6, "alias");
    }
  }

  function byKana(kana, add) {
    if (!kana) return;
    for (const entry of entries) {
      if (entry.kana.includes(kana)) add(entry, 7, "kana");
      else if (entry.kana.some((key) => key.startsWith(kana))) add(entry, 8, "kana");
      else if (entry.kana.some((key) => key.includes(kana))) add(entry, 9, "kana");
    }
  }

  function bySimilar(needle, add) {
    const length = [...needle].length;
    const limit = typoLimit(length);
    if (limit < 0) return;
    for (const entry of entries) {
      const title = entry.forms[1].title || entry.forms[0].title;
      const size = [...title].length;
      // 曲名得占查询词的一半以上：长查询里碰巧含着《Ring》这种短曲名的不算（MiaBot 的规矩）
      if (size >= 3 && size * 2 >= length && needle.includes(title)) {
        add(entry, 10, "contained");
        continue;
      }
      let d = Math.abs(size - length) <= limit ? distance(needle, title) : Infinity;
      if (length >= INFIX_MIN && size > length) d = Math.min(d, infixDistance(needle, title));
      if (d <= limit) add(entry, 11, "similar", d);
    }
  }

  // [{ song, rank, via, gap, fuzzy }]。gap 是同一名次里再分的先后：曲名完全一致时差在哪（exactness），曲名相近时差几个字
  function search(query, { limit = 20 } = {}) {
    const raw = tidy(query);
    if (!raw) return [];
    const hits = new Map();
    const add = (entry, rank, via, gap = 0) => {
      if (!entry) return;
      const previous = hits.get(entry.song.id);
      if (!previous || rank < previous.rank || (rank === previous.rank && gap < previous.gap)) hits.set(entry.song.id, { entry, rank, via, gap });
    };
    const idOnly = raw.match(/^id\s*(\d{1,5})$/i);
    if (idOnly) {
      add(entryOf.get(byId.get(Number(idOnly[1]))), 0, "id");
    } else {
      if (/^\d{1,5}$/.test(raw)) add(entryOf.get(byId.get(Number(raw))), 1, "id");
      const q = keyOf(fold(raw));
      const bare = bareOf(q);
      byText(q, 0, raw, add);
      if (!hits.size && bare) byText(bare, 1, raw, add);
      if (!hits.size) byKana(queryKana(raw), add);
      if (!hits.size) bySimilar(bare || q, add);
    }
    return [...hits.values()]
      .sort((a, b) => a.rank - b.rank || a.gap - b.gap || Number(a.entry.worldsEnd) - Number(b.entry.worldsEnd) || a.entry.song.id - b.entry.song.id)
      .slice(0, limit)
      .map(({ entry, rank, via, gap }) => ({ song: entry.song, rank, via, gap, fuzzy: rank >= 10 }));
  }

  return { search };
}

module.exports = { createSearchIndex, loadSearchData, foldKana, romajiToKana, queryKana, distance, infixDistance, DATA_FILE };
