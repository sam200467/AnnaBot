"use strict";
// 曲名搜索（src/song-search.cjs）：假名折叠和罗马音、生成好的对照表和读音（src/data/song-search.json）、各种写法认歌、
// catalog.resolve 认不认，最后是 /单曲 只找到相近曲名时的回话。曲名是落雪真曲库里挑的（公开的曲目信息）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSearchIndex, loadSearchData, foldKana, romajiToKana, queryKana, distance, infixDistance } = require("../src/song-search.cjs");
const { createCatalog, isWorldsEnd } = require("../src/catalog.cjs");
const { createLxnsClient } = require("../src/lxns.cjs");
const { createMockLxns } = require("./mock-lxns.cjs");
const { V } = require("../src/voice.cjs");
const songFeature = require("../src/features/song.cjs");

const chart = (difficulty, extra = {}) => ({ difficulty, level: "13", level_value: 13, note_designer: "x", version: 10000, ...extra });
const song = (id, title) => ({ id, title, artist: "x", genre: "原创", bpm: 180, version: 10000, difficulties: [chart(3)] });
const we = (id, title, origin) => ({ ...song(id, title), difficulties: [chart(5, { level: "0", level_value: 0, origin_id: origin, kanji: "狂", star: 3 })] });

// 2026-10-16 落雪曲库里的：《混乱》《偏愛》《封焔》带别名；两组 WE 和原曲同名；《FLOWER》《Flower》只差大小写、
// 《Over Heart》《Overhea[r]t》只差空格标点。只有「曲 39 号」是编的：它的 ID 39 跟曲名《39》撞上
const SONGS = [
  song(850, "《混乱》 ～ Muspell"), song(2093, "《偏愛》 ～ Shattered Memories"), song(2050, "封焔の135秒"),
  song(896, "タテマエと本心の大乱闘"), song(628, "サドマミホリック"), song(2453, "ちょっとあざとい"),
  song(3, "B.B.K.K.B.K.K."), we(8020, "B.B.K.K.B.K.K.", 3), song(2101, "ラグトレイン"), we(8238, "ラグトレイン", 2101),
  song(203, "FLOWER"), song(2663, "Flower"), song(1057, "Over Heart"), song(2613, "Overhea[r]t"),
  song(2233, "Λzure Vixen"), song(2533, "ΩΩPARTS"), song(1088, "GranFatalité"), song(478, "Fire◎Flower"),
  song(768, "39"), song(39, "曲 39 号"),
];
const ALIASES = { 850: ["混乱", "泰达"], 2093: ["偏爱", "镜女"], 2050: ["封焰"] };

const originOf = (s) => (isWorldsEnd(s) ? s.difficulties[0].origin_id : s.id);
const makeIndex = (data = loadSearchData()) => createSearchIndex({ songs: SONGS, aliasesOf: (id) => ALIASES[id] || [], originOf, isWorldsEnd, data });
const ids = (results) => results.map((r) => r.song.id);

test("假名折叠：平片假名、浊点、小字、长音都抹平，跟官方读音的写法一致", () => {
  assert.equal(foldKana("しゅがーそんぐ"), foldKana("シユカソンク"));
  assert.equal(foldKana("トウキョウ"), foldKana("トキヨ"));
  assert.equal(foldKana("ヴァンパイア"), "ウアンハイア");
  assert.equal(foldKana("千本桜"), "千本桜", "汉字原样留着");
});

test("罗马音：赫本式、训令式都收，拆不干净就不是罗马音；查询词太短的不比", () => {
  assert.equal(romajiToKana("shinbun"), romajiToKana("sinbun"));
  assert.equal(romajiToKana("shimbun"), romajiToKana("shinbun"));
  assert.equal(romajiToKana("kitto"), "キット");
  assert.equal(romajiToKana("kon'ya"), "コンヤ");
  assert.equal(romajiToKana("love"), null);
  assert.equal(romajiToKana("16bit"), null);
  assert.equal(queryKana("a"), "");
  assert.equal(queryKana("さど"), queryKana("sado"));
  assert.equal(queryKana("Sado"), queryKana("サド"));
  assert.equal(queryKana("tōkyō"), queryKana("tokyo"), "带长音符号的罗马音");
});

test("编辑距离：整串比；只比曲名里最像的一段", () => {
  assert.equal(distance("conflikt", "conflict"), 1);
  assert.equal(distance("", "abc"), 3);
  assert.equal(infixDistance("shatered", "偏爱shatteredmemories"), 1);
  assert.equal(infixDistance("memories", "偏爱shatteredmemories"), 0);
});

test("对照表和读音（src/data/song-search.json）：简体、繁体、日文新字体在同一组；读音按曲目 ID，WE 不单独记", () => {
  const { variants, readings } = loadSearchData();
  const same = (a, b) => (variants.get(a) ?? a) === (variants.get(b) ?? b);
  for (const pair of ["闘斗", "鬭斗", "鬥斗", "亂乱", "愛爱", "戦战", "戰战", "姫姬", "焔焰", "燄焰", "気气", "桜樱", "竜龙", "龍龙"]) {
    assert.ok(same(...pair), pair + " 应该是同一组");
  }
  assert.ok(!same("乱", "斗"));
  assert.match(readings.get(896), /^タテマエトホンシン/);
  assert.match(readings.get(628), /^サトマミ/);
  assert.equal(readings.has(3), false, "英文曲名的读音只是大写字母，不记");
  assert.ok([...readings.keys()].every((id) => id < 8000), "WE 不单独记，用原曲的");
  // 文件缺了也能搜，只是不能简繁互通
  const empty = loadSearchData(path.join(os.tmpdir(), "anna-no-such-file.json"));
  assert.equal(empty.variants.size + empty.readings.size, 0);
  assert.deepEqual(ids(makeIndex(empty).search("偏爱")), [2093]);
  assert.deepEqual(ids(makeIndex(empty).search("大乱斗")), []);
});

test("认歌：简繁日汉字互通 ——「偏爱」「偏愛」「鏡女」「大乱斗」「混亂」「封焔」", () => {
  const index = makeIndex();
  assert.deepEqual(ids(index.search("偏爱")), [2093]);
  assert.deepEqual(ids(index.search("偏愛")), [2093]);
  assert.deepEqual(ids(index.search("鏡女")), [2093]);                // 别名是简体「镜女」
  assert.deepEqual(ids(index.search("大乱斗")), [896]);              // 曲名是「大乱闘」
  assert.deepEqual(ids(index.search("大亂鬥")), [896]);
  const chaos = index.search("混亂");
  assert.deepEqual([chaos[0].song.id, chaos[0].rank, chaos[0].via], [850, 2, "alias"]);
  assert.deepEqual(ids(index.search("封焔")), [2050]);               // 别名写的是「封焰」
});

test("认歌：假名、罗马音 —— 曲名、别名都没对上才按读音比", () => {
  const index = makeIndex();
  const first = (q) => { const [r] = index.search(q); return r && [r.song.id, r.via]; };
  assert.deepEqual(first("さどまみ"), [628, "title"]);              // 平假名换成片假名，直接对上曲名
  assert.deepEqual(first("さとまみ"), [628, "kana"]);               // 少了浊点，按读音
  assert.deepEqual(first("sadomami"), [628, "kana"]);
  assert.deepEqual(ids(index.search("sado")), [628, 2453]);         // 读音开头的排在读音包含的前面（チヨツトアサトイ）
  assert.deepEqual(first("tatemae"), [896, "kana"]);
  assert.deepEqual(first("たいらんとう"), [896, "kana"]);            // 对着官方读音打汉字那一段
  assert.deepEqual(first("honshin"), [896, "kana"]);
  assert.deepEqual(ids(index.search("ragutorein")), [2101, 8238]);  // WE 用原曲的读音，排在原曲后面
});

test("认歌：去重音、希腊字母的拼法、去掉符号再比", () => {
  const index = makeIndex();
  assert.deepEqual(ids(index.search("fatalite")), [1088]);
  assert.deepEqual(ids(index.search("azure vixen")), [2233]);       // Λ 当 A 用
  assert.deepEqual(ids(index.search("ooparts")), [2533]);
  assert.deepEqual(ids(index.search("omegaomegaparts")), [2533]);
  const bare = index.search("fire flower");
  assert.deepEqual([bare[0].song.id, bare[0].rank], [478, 1]);       // 《Fire◎Flower》去掉 ◎ 以后完全一致
});

test("认歌：id 写法只认 ID；纯数字既是 ID 又是曲名时都列上；只差大小写、标点的曲名照原样打能分出来", () => {
  const index = makeIndex();
  assert.deepEqual(index.search("id896").map((r) => [r.song.id, r.rank]), [[896, 0]]);
  assert.deepEqual(ids(index.search("ID 896")), [896]);
  assert.deepEqual(ids(index.search("id9999")), [], "不存在的 ID 不去找相近的");
  assert.deepEqual(index.search("39").map((r) => [r.song.id, r.rank]), [[39, 1], [768, 1]]);
  const gaps = (q) => index.search(q).filter((r) => r.rank === 1).map((r) => [r.song.id, r.gap]);
  assert.deepEqual(gaps("Flower"), [[2663, 0], [203, 1]]);
  assert.deepEqual(gaps("flower"), [[203, 1], [2663, 1]]);
  assert.deepEqual(gaps("Over Heart"), [[1057, 0], [2613, 2]]);
});

test("认歌：拼错了、多抄了几个字，只给相近的候选（fuzzy）", () => {
  const index = makeIndex();
  const fuzzy = (q) => index.search(q).map((r) => [r.song.id, r.via, r.fuzzy]);
  assert.deepEqual(fuzzy("shatered memories"), [[2093, "similar", true]]);
  assert.deepEqual(fuzzy("Muspelll"), [[850, "similar", true]]);
  assert.deepEqual(fuzzy("タテマエと本心の大乱闘 MASTER"), [[896, "contained", true]]);
  assert.deepEqual(fuzzy("完全不存在的歌"), []);
  assert.deepEqual(fuzzy("xz"), [], "太短的不找相近的");
});

async function loadCatalog(t) {
  const aliasList = { aliases: Object.entries(ALIASES).map(([id, aliases]) => ({ song_id: Number(id), aliases })) };
  const lx = createMockLxns({ songList: { songs: SONGS, genres: [], versions: [{ id: 0, title: "CHUNITHM", version: 10000 }] }, aliasList });
  await lx.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-search-"));
  t.after(async () => { await lx.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const catalog = createCatalog({ lxns: createLxnsClient({ baseUrl: lx.apiBase, retries: 0 }), cacheDir: dir });
  await catalog.ready();
  return catalog;
}

test("catalog.resolve：认出唯一一首才给 song；WE 和原曲同名取原曲；相近的只当候选", async (t) => {
  const catalog = await loadCatalog(t);
  const resolved = (q) => {
    const { song: hit, candidates, fuzzy } = catalog.resolve(q);
    return { song: hit?.id ?? null, candidates: candidates.map((s) => s.id), fuzzy };
  };
  assert.deepEqual(resolved("大乱斗"), { song: 896, candidates: [896], fuzzy: false });
  assert.deepEqual(resolved("B.B.K.K.B.K.K."), { song: 3, candidates: [3, 8020], fuzzy: false });
  assert.deepEqual(resolved("ragutorein"), { song: 2101, candidates: [2101, 8238], fuzzy: false });
  assert.deepEqual(resolved("id8020"), { song: 8020, candidates: [8020], fuzzy: false });
  assert.deepEqual(resolved("shatered memories"), { song: null, candidates: [2093], fuzzy: true });
  assert.deepEqual(resolved("39"), { song: null, candidates: [39, 768], fuzzy: false });
  assert.equal(resolved("Over Heart").song, 1057);
  assert.equal(resolved("Overhea[r]t").song, 2613);
  assert.deepEqual(resolved("overheart"), { song: null, candidates: [1057, 2613], fuzzy: false });
  assert.deepEqual(resolved("不存在的歌"), { song: null, candidates: [], fuzzy: false });
});

test("/单曲：只找到相近的曲名时问「是不是这首」、不出图；认不准还是「对上了好几首」", async (t) => {
  const catalog = await loadCatalog(t);
  const replies = [];
  const run = (args) => songFeature.run({
    args, voice: V, services: { catalog },
    reply: async (text) => { replies.push(text); },
    image: async () => { throw new Error("认不准时不该出图"); },
  });
  await run("Muspelll");
  assert.equal(replies.at(-1), V.songMaybe("Muspelll", [V.songCandidate(catalog.getSong(850), false)], 0));
  assert.match(replies.at(-1), /是不是这首？/);
  await run("flower");
  assert.match(replies.at(-1), /对上了好几首/);
});
