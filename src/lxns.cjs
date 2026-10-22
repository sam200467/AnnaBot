"use strict";
// 落雪查分器（maimai.lxns.net）中二节奏接口。只管请求、解包和错误，不缓存（缓存在 catalog.cjs / assets.cjs）。
//
// 三种鉴权各走各的路径（2026-10-13 用真实密钥逐个实测过）：
//   - 公共接口 /chunithm/...：不带密钥。直接返回数据，没有外面那层 { success, data }
//   - 开发者接口 /chunithm/player/{好友码}/...：Authorization: <开发者密钥>，能查任何玩家，
//     但受玩家自己的「允许第三方读取」开关管：读玩家信息、读谱面成绩默认开，读历史成绩（trend 等）默认关。
//     /scores 只给简化成绩（评级、CLEAR、FC 标记），**没有分数** —— 要分数得走 OAuth
//   - 玩家接口 /user/chunithm/player/...：Authorization: Bearer <OAuth 访问令牌> 或 X-User-Token: <个人密钥>，
//     只能查授权的那个人，不受第三方开关管，/scores 带完整分数。文档只列了几个，完整列表在前端源码
//     （github.com/Lxns-Network/maimai-prober-frontend）里
//
// 实测到的几个坑：
//   - 单曲全难度成绩是 GET .../bests?song_id=（返回 Score[]），不是 .../score —— 那个是 405
//   - .../best?song_id&level_index 查没玩过的谱面返回 200 + data:null，不是 404
//   - 好友码不存在 404「player not found」；不是数字 400「invalid friend code」
//   - 第三方开关关着时 403「allow third party fetch history is disabled」这种句子

const DEFAULT_BASE = "https://maimai.lxns.net/api/v0";

class LxnsError extends Error {
  constructor(message, { status = 0, code = "unknown", path = "" } = {}) {
    super(message);
    this.name = "LxnsError";
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

// 服务器给的英文消息归成几类，上层（voice.cjs）按类给玩家看的话。
function classify(status, message) {
  const text = String(message || "").toLowerCase();
  if (status === 401) return "unauthorized";
  if (status === 403 && text.includes("allow third party fetch history")) return "privacy_history";
  if (status === 403 && text.includes("allow third party fetch scores")) return "privacy_scores";
  if (status === 403 && text.includes("allow third party")) return "privacy_player";
  if (status === 403) return "forbidden";
  // 年度总结（2026-10-21 实测）：没生成过是 400 agree is required；不能生成的年份是 400 invalid year；
  // 分享链接不对是 404 year in review not found
  if (status === 400 && text.includes("agree is required")) return "agree_required";
  if (status === 400 && text.includes("invalid year")) return "invalid_year";
  if (status === 404 && text.includes("year in review")) return "review_not_found";
  if (status === 404 && text.includes("player")) return "player_not_found";
  if (status === 404) return "not_found";
  if (status === 400 && text.includes("friend code")) return "invalid_friend_code";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unknown";
}

const RETRYABLE = new Set(["network", "server", "rate_limited", "timeout"]);

function createLxnsClient(options = {}) {
  const base = String(options.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  const devToken = String(options.devToken || "").trim();
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 20000;
  const retries = Number.isInteger(options.retries) ? options.retries : 1;
  const retryDelayMs = options.retryDelayMs ?? 800;
  const log = options.log || (() => {});
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function once(path, { headers, query, timeout = timeoutMs }) {
    const url = new URL(base + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    let res;
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new LxnsError(timeout ? "请求落雪查分器超时" : "连不上落雪查分器：" + (error?.cause?.code || error?.message || error),
        { code: timeout ? "timeout" : "network", path });
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 原样当错误信息 */ }
    if (!res.ok || json?.success === false) {
      const status = res.ok ? Number(json?.code) || 0 : res.status;
      const message = json?.message || text.slice(0, 200) || "HTTP " + res.status;
      throw new LxnsError(message, { status, code: classify(status, message), path });
    }
    return json && typeof json === "object" && "success" in json ? json.data : json;
  }

  // 只重试一次「过一会儿可能就好」的错误；401/403/404 这类重试也没用。
  // 有副作用、又慢的请求（生成年度总结）单独给超时、不重试：超时了落雪那边可能还在生成，再发一遍没意义
  async function get(path, { headers = {}, query, timeout, retry = true } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(path, { headers, query, timeout });
      } catch (error) {
        if (!(error instanceof LxnsError) || !RETRYABLE.has(error.code) || !retry || attempt >= retries) throw error;
        log("落雪接口 " + path.replace(/\/player\/\d+/, "/player/…") + " 失败（" + error.code + "），稍后重试");
        await sleep(error.code === "rate_limited" ? retryDelayMs * 2 : retryDelayMs);
      }
    }
  }

  function friendPath(friendCode) {
    const code = String(friendCode ?? "").trim();
    if (!/^\d{1,20}$/.test(code)) throw new LxnsError("好友码只能是数字", { status: 400, code: "invalid_friend_code" });
    return "/chunithm/player/" + code;
  }

  // 参数不对、没配密钥也返回失败的 Promise，不同步抛 —— 调用方只要 await / .catch 一种写法。
  async function devGet(friendCode, sub = "", query) {
    const path = friendPath(friendCode) + sub;
    if (!devToken) throw new LxnsError("没有配置开发者密钥（LXNS_DEV_TOKEN）", { code: "no_dev_token", path });
    return get(path, { headers: { Authorization: devToken }, query });
  }

  // 开发者接口：按好友码查任意玩家（受玩家的第三方开关管）。
  const dev = {
    player: (friendCode) => devGet(friendCode),
    // { bests: B30, selections: 候选 10, new_bests: 新曲 20 }
    bests: (friendCode) => devGet(friendCode, "/bests"),
    // 单曲全部难度 Score[]
    songBests: (friendCode, songId) => devGet(friendCode, "/bests", { song_id: songId }),
    // 单张谱面 Score，没玩过是 null
    best: (friendCode, songId, levelIndex) => devGet(friendCode, "/best", { song_id: songId, level_index: levelIndex }),
    recents: (friendCode) => devGet(friendCode, "/recents"),
    // 简化成绩 SimpleScore[]：没有 score / rating 字段
    simpleScores: (friendCode) => devGet(friendCode, "/scores"),
    trend: (friendCode, version) => devGet(friendCode, "/trend", { version }),
    // 一张谱面每次上传的成绩 Score[]（按上传时间倒序，没过的、被技能强制结束的也在里面）。
    // 要对方同时开着「允许读取历史成绩」（默认关）和「允许读取谱面成绩」，关着是 403 privacy_history
    scoreHistory: (friendCode, songId, levelIndex) => devGet(friendCode, "/score/history", { song_id: songId, level_index: levelIndex }),
    collection: (friendCode, type, id) => devGet(friendCode, "/" + type + "/" + id),
  };

  // 玩家接口：auth 是 { bearer } 或 { userToken }，只能查这个令牌背后的那个人。
  function user(auth) {
    const headers = auth?.bearer ? { Authorization: "Bearer " + auth.bearer }
      : auth?.userToken ? { "X-User-Token": auth.userToken } : null;
    if (!headers) throw new LxnsError("玩家接口缺少令牌", { code: "unauthorized" });
    const userGet = (path, query, options) => get("/user/chunithm/player" + path, { headers, query, ...options });
    return {
      player: () => userGet(""),
      bests: () => userGet("/bests"),
      songBests: (songId) => userGet("/bests", { song_id: songId }),
      // 全部成绩 Score[]，带分数
      scores: () => userGet("/scores"),
      trend: (version) => userGet("/trend", { version }),
      // 同开发者接口的 scoreHistory；OAuth 的 read_player 权限包括历史成绩（落雪 OAuth 文档写的）
      scoreHistory: (songId, levelIndex) => userGet("/score/history", { song_id: songId, level_index: levelIndex }),
      // 这张谱面在落雪的排名：前 10 名再加自己那一条 [{ ranking, score, upload_time, player_name? }]，同分同名次。
      // 文档没列，前端的成绩详情在用（2026-10-17 用个人密钥实测）；开发者接口没有这个
      scoreRanking: (songId, levelIndex) => userGet("/score/ranking", { song_id: songId, level_index: levelIndex }),
      collection: (type, id) => userGet("/" + type + "/" + id),
      // 年度总结（文档没列，落雪前端的年度总结页在用；2026-10-21 用 OAuth 实测能读，开发者接口没有这条路由）。
      // 没生成过的年份先是 400 agree_required，带 agree=true 就是网页上的「生成数据」：当场统计、慢，
      // 只有 Y 年的数据能在 Y+1 年里生成，别的年份是 400 invalid_year
      yearInReview: (year, { agree = false } = {}) => userGet("/year-in-review/" + year, agree ? { agree: "true" } : undefined,
        agree ? { timeout: 180000, retry: false } : undefined),
    };
  }

  return {
    dev,
    user,
    hasDevToken: Boolean(devToken),
    // 公共接口
    songList: (query) => get("/chunithm/song/list", { query }),
    song: (songId) => get("/chunithm/song/" + songId),
    aliasList: () => get("/chunithm/alias/list"),
    // type: trophy | character | plate | icon
    collectionList: (type) => get("/chunithm/" + type + "/list"),
    // 玩家在落雪网页上公开分享的年度总结（链接 …/year-in-review/{年}/share/{token} 里的 token），不用鉴权
    yearInReviewShare: (year, token) => get("/chunithm/year-in-review/" + year + "/share/" + encodeURIComponent(token)),
    // 热门谱面：全站近 7 天（week）/ 近 30 天（month）上传最多的前 10 张谱面，落雪首页「热门曲目」就是它（文档没列）。
    // { range, period_start, period_end, updated_at, songs: [{ id, title, artist, rank, previous_rank, level_index, level }] }。
    // 2026-10-22 实测：公共接口却包了一层 { success, data }；时段是北京时间的整天（period_end 是北京时间零点），
    // updated_at 每小时 05 分变一次；previous_rank 是上一个同样长的时段里的名次，null 是新上榜
    popular: (range) => get("/chunithm/song/popular", { query: { range } }),
  };
}

module.exports = { createLxnsClient, LxnsError, classify, DEFAULT_BASE };
