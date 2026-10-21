"use strict";
// /年度总结：落雪年度总结数据怎么整理成图的数据（src/year-review.cjs）、指令怎么选年份 / 什么时候替玩家生成
// （src/features/year-review.cjs），以及落雪接口那几条路由（src/lxns.cjs，对假落雪）。数据都是编的。
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildYearView, snapshotRating, inclusiveRanks, inclusiveMarks, levelRows, totalUploads } = require("../src/year-review.cjs");
const feature = require("../src/features/year-review.cjs");
const { V } = require("../src/voice.cjs");
const { createLxnsClient, LxnsError } = require("../src/lxns.cjs");
const { createMockLxns } = require("./mock-lxns.cjs");

const catalog = {
  getSong: (id) => (Number(id) === 999 ? null : { id: Number(id), title: "测试曲 " + id }),
  jacketId: (song) => (song.id >= 8000 ? song.id - 8000 : song.id),
};
const best = (rating) => ({ id: 1, level_index: 3, rating });
const months = (fill) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, fill(i + 1)]));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " ≠ " + b);

function sampleReview(overrides = {}) {
  return {
    game: "chunithm", year: 2025, player_name: "测试玩家",
    player_total_uploads: { 10000: 30, 24000: 12 },
    player_upload_days: 5,
    player_most_uploaded_songs: { 407: 9, 3: 12, 8: 12, 50: 1, 999: 2 },
    player_most_uploaded_song: { latest_version: 407, all_version: 3 },
    player_monthly_uploads: months((m) => ({ 3: 20, 4: 22 })[m] || 0),
    player_song_timeline: months((m) => ({ 3: [3, 407, 8, 50], 4: [8020] })[m] || []),
    rank_distribute: { sssp: 2, sss: 5, ssp: 3, ss: 10, sp: 4, s: 6, aaa: 12 },
    full_combo_distribute: { alljusticecritical: 1, alljustice: 3, fullcombo: 6 },
    difficulty_distribute: { "14+": 20, 15: 12, 13: 4, 14: 6, "12+": 0 },
    rating_growth: {
      earliest_bests: { bests: [best(16), best(17)], new_bests: [] },
      latest_bests: { bests: [best(16.5), best(17.5)], new_bests: [] },
    },
    generate_time: "2026-01-02T03:04:05Z",
    ...overrides,
  };
}

test("整理图上的数：上传总数、排行（同样多按曲目 ID）、每月、包含关系的评级和全连、难度从低到高", () => {
  const data = buildYearView({ review: sampleReview(), catalog });
  assert.equal(data.year, 2025);
  assert.equal(data.uploads, 42);
  assert.equal(totalUploads(sampleReview()), 42);
  assert.equal(data.days, 5);
  assert.equal(data.generatedAt, "2026-01-02 11:04");
  assert.deepEqual(data.top.map((s) => [s.rank, s.id, s.count]), [[1, 3, 12], [2, 8, 12], [3, 407, 9], [4, 999, 2], [5, 50, 1]]);
  // 曲库里没有的曲目（新曲还没进曲库）也照样列，名字退回「曲目 ID」
  assert.equal(data.top[3].title, "曲目 999");
  assert.equal(data.months.length, 12);
  assert.equal(data.activeMonths, 2);
  assert.deepEqual(data.months[2].songs.map((s) => s.id), [3, 407, 8]);   // 每月最多 3 首
  // WORLD'S END（8000 起）用原曲的曲绘
  assert.equal(data.months[3].songs[0].jacketId, 20);
  assert.deepEqual(data.ranks, [{ label: "SSS+", key: "sssp", count: 2 }, { label: "SSS", key: "sss", count: 7 },
    { label: "SS", key: "ss", count: 20 }, { label: "S", key: "s", count: 30 }]);
  assert.deepEqual(data.marks.map((m) => [m.label, m.count]), [["FC", 10], ["AJ", 4], ["AJC", 1]]);
  assert.deepEqual(data.levels.map((l) => l.level), ["13", "14", "14+", "15"]);   // 0 条的 12+ 不画
  assert.equal(data.newest.id, 407);
});

test("Rating：2025 年快照没有新曲时照落雪网页按旧算法 (B30 + 最高 × 10) / 40，有新曲就是 B30 + N20 的平均", () => {
  const legacy = snapshotRating({ bests: [best(16), best(17)], new_bests: [] }, 2025);
  assert.equal(legacy.legacy, true);
  close(legacy.value, (33 + 17 * 10) / 40);
  const verse = snapshotRating({ bests: [best(16), best(17)], new_bests: [best(15)] }, 2026);
  assert.equal(verse.legacy, false);
  close(verse.value, (33 + 15) / 50);
  assert.equal(snapshotRating({ bests: [], new_bests: [] }, 2025), null);
  const data = buildYearView({ review: sampleReview(), catalog });
  assert.equal(data.rating.legacy, true);
  close(data.rating.gain, (34 + 175) / 40 - (33 + 170) / 40);
});

test("2024 年的数据没有分布和 Rating 成长，那几块就是 null（图上不画）；AJC 是 0 不列", () => {
  const review = sampleReview({ year: 2024, rank_distribute: undefined, full_combo_distribute: undefined,
    difficulty_distribute: undefined, rating_growth: undefined });
  const data = buildYearView({ review, catalog });
  assert.equal(data.ranks, null);
  assert.equal(data.marks, null);
  assert.equal(data.levels, null);
  assert.equal(data.rating, null);
  assert.deepEqual(inclusiveMarks({ fullcombo: 2, alljustice: 1 }).map((m) => m.label), ["FC", "AJ"]);
  assert.deepEqual(inclusiveRanks({}).map((r) => r.count), [0, 0, 0, 0]);
  assert.deepEqual(levelRows({ "15+": 1, abc: 3 }).map((l) => l.level), ["15+"]);
});

test("年份：不写就是北京时间的去年（元旦零点按北京时间换年），写年份认「2025」「2025年」", () => {
  assert.equal(feature.parseYear("", new Date("2026-03-01T12:00:00+08:00")), 2025);
  assert.equal(feature.parseYear("", new Date("2025-12-31T16:30:00Z")), 2025);   // 北京时间已经 2026-01-01
  assert.equal(feature.parseYear("", new Date("2025-12-31T15:30:00Z")), 2024);
  assert.equal(feature.parseYear("2024", new Date()), 2024);
  assert.equal(feature.parseYear("2024 年", new Date()), 2024);
  assert.equal(feature.parseYear("去年", new Date()), null);
  assert.equal(feature.parseYear("2024 2025", new Date()), null);
});

// 指令层（commands.cjs）已经查过授权绑定；这里只测功能自己的分支
function stubCtx({ args = "", now = "2026-03-01T12:00:00+08:00", respond }) {
  const replies = [];
  const images = [];
  const calls = [];
  const rendered = [];
  const ctx = {
    args, voice: V, now: () => new Date(now),
    reply: async (text) => { replies.push(text); },
    image: async (job) => { images.push(job); },
    services: {
      catalog,
      assets: { fileUrls: async (items) => items.map(([kind, id]) => "file:///" + kind + "/" + id + ".png") },
      renderer: { render: async (theme, data, options) => { rendered.push({ theme, data, options }); return { buffer: Buffer.from("jpg") }; } },
    },
    player: {
      yearInReview: async (year, options = {}) => {
        calls.push([year, Boolean(options.agree)]);
        const result = respond(year, options);
        if (result instanceof Error) throw result;
        return result;
      },
      player: async () => ({ name: "测试玩家", rating: 16.5, level: 30, reborn_count: 1, trophy: { name: "称号", color: "gold" },
        class_emblem: { base: 2, medal: 3 }, name_plate: { id: 20002 }, character: { id: 8830 } }),
    },
  };
  return { ctx, replies, images, calls, rendered };
}
const lxnsError = (code) => new LxnsError(code, { status: 400, code });

test("读到了就出图：名片板用现在的玩家资料，曲绘、名牌版、头像在队列里换成本地地址，JPEG 76、1.5 倍", async () => {
  const { ctx, replies, images, calls, rendered } = stubCtx({ respond: () => sampleReview() });
  await feature.run(ctx);
  assert.deepEqual(calls, [[2025, false]]);
  assert.deepEqual(replies, []);
  assert.equal(images.length, 1);
  assert.equal(images[0].kind, "yearReview");
  const out = await images[0].render();
  assert.ok(Buffer.isBuffer(out.buffer));
  assert.equal(rendered[0].theme, "year");
  assert.deepEqual(rendered[0].options, { format: "jpeg", quality: 76, scale: 1.5 });
  const data = rendered[0].data;
  assert.equal(data.player.name, "测试玩家");
  assert.equal(data.player.plate, "file:///plate/20002.png");
  assert.equal(data.player.character, "file:///character/8830.png");
  assert.equal(data.top[0].jacket, "file:///jacket/3.png");
});

test("去年的没生成过：先说一声，再带 agree 生成；更早的年份没生成过就是过了期限，不替玩家生成", async () => {
  let generated = false;
  const lastYear = stubCtx({ respond: (year, { agree }) => {
    if (agree) { generated = true; return sampleReview(); }
    return lxnsError("agree_required");
  } });
  await feature.run(lastYear.ctx);
  assert.deepEqual(lastYear.calls, [[2025, false], [2025, true]]);
  assert.equal(generated, true);
  assert.deepEqual(lastYear.replies, [V.yearReviewGenerating(2025)]);
  assert.equal(lastYear.images.length, 1);

  const older = stubCtx({ args: "2024", respond: () => lxnsError("agree_required") });
  await feature.run(older.ctx);
  assert.deepEqual(older.calls, [[2024, false]]);
  assert.deepEqual(older.replies, [V.yearReviewClosed(2024)]);
  assert.equal(older.images.length, 0);

  const invalid = stubCtx({ args: "2024", respond: () => lxnsError("invalid_year") });
  await feature.run(invalid.ctx);
  assert.deepEqual(invalid.replies, [V.yearReviewClosed(2024)]);
});

test("今年和以后、2024 以前、看不懂的写法、一整年没上传，都只回一句话", async () => {
  const cases = [
    ["2026", V.yearReviewTooEarly(2026)],
    ["2030", V.yearReviewTooEarly(2030)],
    ["2023", V.yearReviewTooOld(2024)],
    ["去年", V.yearReviewUsage],
  ];
  for (const [args, expected] of cases) {
    const { ctx, replies, calls } = stubCtx({ args, respond: () => sampleReview() });
    await feature.run(ctx);
    assert.deepEqual(replies, [expected], args);
    assert.deepEqual(calls, [], args);
  }
  const empty = stubCtx({ respond: () => sampleReview({ player_total_uploads: {} }) });
  await feature.run(empty.ctx);
  assert.deepEqual(empty.replies, [V.yearReviewEmpty(2025)]);
  assert.equal(empty.images.length, 0);
  // 别的落雪错误往上抛，由指令层翻成玩家看的话
  const broken = stubCtx({ respond: () => new LxnsError("boom", { status: 500, code: "server" }) });
  await assert.rejects(feature.run(broken.ctx), { code: "server" });
});

test("落雪接口：没生成过是 agree_required，带 agree=true 生成后就能读；分享链接不用鉴权；错误按类归好", async (t) => {
  const mock = createMockLxns();
  await mock.start();
  t.after(() => mock.stop());
  const review = sampleReview();
  mock.addPlayer({ friendCode: "101", name: "测试玩家", reviews: { 2025: { data: review, needsAgree: true } } });
  mock.state.access.set("at-test", { friendCode: "101", expiresAt: Date.now() + 60000 });
  mock.state.shares.set("2025/tok en", review);
  const lxns = createLxnsClient({ baseUrl: mock.apiBase, devToken: mock.devToken, retryDelayMs: 10 });
  const user = lxns.user({ bearer: "at-test" });

  await assert.rejects(user.yearInReview(2025), { code: "agree_required" });
  assert.equal((await user.yearInReview(2025, { agree: true })).player_upload_days, 5);
  assert.ok(mock.state.requests.some((r) => r.path === "/api/v0/user/chunithm/player/year-in-review/2025?agree=true"));
  assert.equal((await user.yearInReview(2025)).year, 2025);   // 生成过以后不带 agree 也能读
  await assert.rejects(user.yearInReview(2023), { code: "invalid_year" });

  assert.equal((await lxns.yearInReviewShare(2025, "tok en")).year, 2025);
  assert.equal(mock.state.requests.at(-1).auth, "none");
  await assert.rejects(lxns.yearInReviewShare(2025, "nope"), { code: "review_not_found" });
});
