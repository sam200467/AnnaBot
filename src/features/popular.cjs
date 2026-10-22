"use strict";
// /热门谱面：落雪全站近 7 天、近 30 天上传最多的前 10 张谱面（公共接口 chunithm/song/popular），两张榜并排画在一张图上。
// 主题是 themes/popular/（原初的巫女萨拉基亚，设计说明见它的 README）。
// 落雪网页首页的「热门曲目」就是这份数据，但一次只能看一张榜；Anna 把两张榜放在一起，绑定了的再配上自己在这些谱面上的成绩
// （网页首页没有）。
//
//   /热门谱面            没绑定也能用，只是没有成绩那一栏
//   @某人 /热门谱面      带上 TA 的成绩（走开发者接口，受对方在落雪的第三方开关管）
//
// - 落雪写的是「近期全站玩家游玩最多」：数据只来自同步到落雪的玩家，不是官方的全国统计。
// - 时段是北京时间的整天：period_end 是北京时间零点（不含），图上写到前一天。updated_at 每小时 05 分变一次（2026-10-22 实测）。
// - 名次变化：previous_rank 是上一个同样长的时段里的名次，升了几名、降了几名；null 是新上榜（落雪网页写 NEW）。
// - 一行是一张谱面（曲目 + 难度），不只有 MASTER：EXPERT、ULTIMA 也会上榜。
// - 成绩：授权绑定读一次全部成绩；好友码绑定和查别人按曲目读 /bests?song_id=（两张榜去重后十来首，几首一组地读，别一下子压给落雪）。
//
// 主题吃的数据形状见 themes/popular/examples/preview-data.json；buildData 是纯函数，测试和示例数据都用它。

const { rankOf, stamp, playerView } = require("./best.cjs");
const { rating: singleRating, truncate } = require("../score-math.cjs");
const { WORLDS_END } = require("../catalog.cjs");

const RANGES = [{ key: "week", label: "近 7 天" }, { key: "month", label: "近 30 天" }];
const TOP = 10;
const SCORE_BATCH = 3;
// 画框里的画面照油画的比例，宽高以主题量出来的为准；JPEG 质量 76、1.5 倍（同 /年度总结、/同步记录），超过 5 MB 就在同一页面降质量重截
const RENDER = { width: 2800, height: 1900, format: "jpeg", quality: 76, scale: 1.5, maxBytes: 5_000_000, fallbackQualities: [70, 64] };

// 北京时间的「10/15」。exclusive：给的是时段的结束（不含），往前退 1 毫秒就是最后一天
function beijingDay(iso, { exclusive = false } = {}) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" })
    .formatToParts(new Date(time - (exclusive ? 1 : 0))).map((part) => [part.type, part.value]));
  return parts.month + "/" + parts.day;
}

// { kind: "up" | "down", value } / { kind: "same" } / { kind: "new" }
function changeOf(rank, previous) {
  const delta = previous === null || previous === undefined ? NaN : Number(previous) - Number(rank);
  if (!Number.isFinite(delta)) return { kind: "new" };
  if (delta === 0) return { kind: "same" };
  return delta > 0 ? { kind: "up", value: delta } : { kind: "down", value: -delta };
}

const chartKey = (id, levelIndex) => Number(id) + ":" + Number(levelIndex);

// 成绩表：曲目:难度 → 分数最高的那一条
function indexScores(list) {
  const map = new Map();
  for (const score of list || []) {
    if (!score || !Number.isFinite(Number(score.score))) continue;
    const key = chartKey(score.id, score.level_index);
    const previous = map.get(key);
    if (!previous || Number(score.score) > Number(previous.score)) map.set(key, score);
  }
  return map;
}

function scoreView(score, constant) {
  const value = Number(score.score);
  const given = score.rating === null || score.rating === undefined ? NaN : Number(score.rating);
  return {
    score: value,
    rank: score.rank || rankOf(value),
    clear: score.clear || null,
    fullCombo: score.full_combo || null,
    fullChain: score.full_chain || null,
    // WORLD'S END 没有定数，不写 Rating；落雪给了就用落雪的（跟网页一样），没给自己算
    rating: constant ? (Number.isFinite(given) ? given : truncate(singleRating(constant, value))) : null,
  };
}

function rowView(entry, { catalog, scores }) {
  const song = catalog.getSong(entry.id);
  const levelIndex = Number(entry.level_index);
  const chart = song ? catalog.chart(song, levelIndex) : null;
  const worldsEnd = levelIndex === WORLDS_END;
  const constant = !worldsEnd && Number(chart?.level_value) > 0 ? Number(chart.level_value) : null;
  const best = scores ? scores.get(chartKey(entry.id, levelIndex)) : null;
  return {
    rank: Number(entry.rank),
    change: changeOf(entry.rank, entry.previous_rank),
    id: Number(entry.id),
    // 曲名、曲师以榜单为准：新曲可能还没进 Anna 的曲库缓存
    title: entry.title || song?.title || "曲目 " + entry.id,
    artist: entry.artist || song?.artist || "",
    levelIndex,
    level: entry.level || chart?.level || "",
    constant,
    ...(worldsEnd ? { kanji: chart?.kanji || "", star: Number(chart?.star) || 0 } : {}),
    jacketId: song ? catalog.jacketId(song) : Number(entry.id),
    jacket: null,   // 出图前换成本地 file:// 地址（attachAssets）
    // 没打过是 null；没绑定时整张图都没有成绩这一栏（看 data.scored）
    score: best ? scoreView(best, constant) : null,
  };
}

function rangeView({ key, label }, popular, options) {
  const rows = [...(popular?.songs || [])]
    .sort((a, b) => Number(a.rank) - Number(b.rank))
    .slice(0, TOP)
    .map((entry) => rowView(entry, options));
  return {
    key,
    label,
    start: beijingDay(popular?.period_start),
    end: beijingDay(popular?.period_end, { exclusive: true }),
    rows,
    // 这张榜上打过几张（只在有成绩时有意义）
    played: rows.filter((row) => row.score).length,
  };
}

// week、month：落雪返回的两张榜；scores：indexScores 的结果（没绑定是 null）；player：best.cjs 的 playerView（名片板），没有就不画
function buildData({ week, month, catalog, scores = null, player = null, isSelf = true, now = new Date() }) {
  const lists = { week, month };
  const options = { catalog, scores };
  const updated = [week?.updated_at, month?.updated_at].map((value) => Date.parse(value)).filter(Number.isFinite);
  return {
    ranges: RANGES.map((range) => rangeView(range, lists[range.key], options)),
    scored: Boolean(scores),
    isSelf,
    player,
    updatedAt: updated.length ? stamp(new Date(Math.max(...updated))) : "",
    time: stamp(now),
  };
}

// 两张榜上的谱面里，玩家的成绩。授权绑定一次读全部；别的按曲目读，几首一组
async function loadScores(api, entries) {
  if (api.hasFullScores) return indexScores(await api.scores());
  const ids = [...new Set((entries || []).map((entry) => Number(entry.id)).filter(Number.isFinite))];
  const lists = [];
  for (let i = 0; i < ids.length; i += SCORE_BATCH) {
    lists.push(...await Promise.all(ids.slice(i, i + SCORE_BATCH).map((id) => api.songBests(id))));
  }
  return indexScores(lists.flat());
}

// 曲绘、名牌版、角色换成本地 file:// 地址（落雪素材慢，只在出图队列里做；两张榜里重复的曲绘素材缓存会合并）
async function attachAssets(data, assets) {
  const items = [];
  const targets = [];
  for (const range of data.ranges) {
    for (const row of range.rows) {
      items.push(["jacket", row.jacketId]);
      targets.push((url) => { row.jacket = url; });
    }
  }
  if (data.player?.plateId != null) {
    items.push(["plate", data.player.plateId]);
    targets.push((url) => { data.player.plate = url; });
  }
  if (data.player?.characterId != null) {
    items.push(["character", data.player.characterId]);
    targets.push((url) => { data.player.character = url; });
  }
  const urls = await assets.fileUrls(items);
  urls.forEach((url, i) => targets[i](url));
  return data;
}

module.exports = Object.assign({
  name: "popular",
  words: ["热门谱面", "熱門譜面", "热门曲目", "熱門曲目", "热门", "popular"],
  usage: "/热门谱面",
  summary: "落雪全站近 7 天、近 30 天最热门的谱面；绑定了还能看到你在这些谱面上的成绩。（@ 别人也看）",
  panel: "落雪近期最热门的谱面",
  group: "查询",
  binding: "none",
  allowOthers: true,
  async run(ctx) {
    if (ctx.args) return ctx.reply(ctx.voice.popularUsage);
    const { lxns, bindings, catalog } = ctx.services;
    // 有绑定就带上成绩；@ 了没绑定的人直接说（不能悄悄只出榜单，看的人会以为 TA 一张都没打过）
    const isSelf = ctx.subject.isSelf;
    const api = bindings ? bindings.player(ctx.subject.openid, { thirdParty: !isSelf }) : null;
    if (!api && !isSelf) return ctx.reply(ctx.voice.otherNotBound);

    // 榜单放在排队前面拿：两张都是空的就直接说（落雪网页这时也不显示这一块），不占出图队列
    const [week, month] = await Promise.all(RANGES.map(({ key }) => lxns.popular(key)));
    if (!week?.songs?.length && !month?.songs?.length) return ctx.reply(ctx.voice.popularEmpty);

    await ctx.image({
      kind: "popular",
      label: "热门谱面图",
      render: async () => {
        const { assets, renderer } = ctx.services;
        const entries = [...(week?.songs || []), ...(month?.songs || [])];
        // 名片板读不到（对方关了「允许读取玩家信息」这类）就不画那一块；成绩读不到照常报错，跟 /单曲 一样
        const [scores, player] = api
          ? await Promise.all([loadScores(api, entries), api.player().catch(() => null)])
          : [null, null];
        const data = buildData({ week, month, catalog, scores, player: player ? playerView(player) : null, isSelf, now: ctx.now() });
        await attachAssets(data, assets);
        const image = await renderer.render("popular", data, RENDER);
        return { buffer: image.buffer };
      },
    });
  },
}, { buildData, loadScores, attachAssets, indexScores, changeOf, beijingDay, RANGES, RENDER });
