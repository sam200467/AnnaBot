"use strict";
// 假的落雪查分器：公共接口、开发者接口、玩家接口、OAuth 令牌接口和素材服务器，供测试用。
// 行为照 2026-10-13 对真落雪的实测写的（见 src/lxns.cjs、src/lxns-oauth.cjs 开头的记录）：
//   - 开发者/玩家接口包一层 { success, code, data }，公共接口不包
//   - 第三方开关关着时 403「allow third party fetch xxx is disabled」
//   - 令牌接口校验 client_secret、redirect_uri、PKCE（S256）；刷新令牌每用一次就换新的，旧的作废
//
//   const mock = createMockLxns(); await mock.start();
//   mock.addPlayer({ friendCode: "101", name: "测试玩家", rating: 17 });
//   const code = mock.approve("101", codeChallenge);   // 相当于玩家在授权页点了同意

const crypto = require("node:crypto");
const http = require("node:http");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a2f00000000049454e44ae426082", "hex");

function createMockLxns(options = {}) {
  const devToken = options.devToken || "dev-token";
  const clientId = options.clientId || "client-id";
  const clientSecret = options.clientSecret || "client-secret";
  const accessTtl = options.accessTtl || 900;
  const state = {
    players: new Map(),       // friendCode -> 玩家
    codes: new Map(),         // 授权码 -> { friendCode, challenge }
    access: new Map(),        // 访问令牌 -> { friendCode, expiresAt }
    refresh: new Map(),       // 刷新令牌 -> friendCode（用过就删）
    requests: [],             // { method, path, auth }，auth: dev | bearer | user | none
    tokenGrants: [],          // 令牌接口收到的 grant_type
    assets: new Map([["jacket/407", PNG], ["jacket/3", PNG]]),
    songList: options.songList || {
      songs: [
        { id: 3, title: "B.B.K.K.B.K.K.", artist: "nora2r", genre: "其他游戏", bpm: 170, version: 10000,
          difficulties: [{ difficulty: 3, level: "12+", level_value: 12.5, note_designer: "x", version: 10000 }] },
        { id: 407, title: "混沌を越えし我らが神聖なる調律主を讃えよ", artist: "x", genre: "原创", bpm: 200, version: 13000,
          difficulties: [{ difficulty: 3, level: "15+", level_value: 15.5, note_designer: "x", version: 13000 }] },
        { id: 8020, title: "B.B.K.K.B.K.K.", artist: "nora2r", genre: "其他游戏", bpm: 170, version: 10500,
          difficulties: [{ difficulty: 5, level: "0", level_value: 0, note_designer: "x", version: 10500, origin_id: 3, kanji: "戻", star: 4 }] },
      ],
      genres: [{ id: 1, genre: "原创" }],
      versions: [{ id: 1, title: "CHUNITHM", version: 10000 }, { id: 2, title: "CHUNITHM X-VERSE", version: 13000 }, { id: 3, title: "NEXT", version: 99999 }],
    },
    aliasList: options.aliasList || { aliases: [{ song_id: 3, aliases: ["bbkkbkk"] }, { song_id: 407, aliases: ["混沌"] }, { song_id: 999, aliases: ["不存在"] }] },
    failNext: null,           // { status, body, times }
    tokenDelayMs: 0,          // 令牌接口故意慢一点，测并发刷新
  };
  let port = 0;
  const server = http.createServer();

  const json = (res, status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  const ok = (res, data) => json(res, 200, { success: true, code: 200, data });
  const fail = (res, status, message) => json(res, status, { success: false, code: status, message });

  function playerView(p) {
    return { name: p.name, rating: p.rating, friend_code: Number(p.friendCode), level: 1, upload_time: "2026-10-13T07:49:32Z" };
  }
  function score(id, level_index, value, full = true) {
    const base = { id, song_name: "曲" + id, level: "15", level_index, clear: "clear", full_combo: null, full_chain: null, rank: "sss" };
    return full ? { ...base, score: value, rating: 17.5, over_power: 80 } : base;
  }

  function playerRoutes(res, p, rest, query, viaDev) {
    if (viaDev && !p.privacy.player) return fail(res, 403, "allow third party fetch player is disabled");
    if (rest === "") return ok(res, playerView(p));
    if (viaDev && !p.privacy.scores && rest !== "/trend") return fail(res, 403, "allow third party fetch scores is disabled");
    if (rest === "/bests" && query.get("song_id")) return ok(res, p.scores.filter((s) => String(s.id) === query.get("song_id")));
    if (rest === "/bests") return ok(res, p.bests || { bests: p.scores.slice(0, 30), selections: [], new_bests: [] });
    if (rest === "/scores") return ok(res, viaDev ? p.scores.map(({ score: _s, rating: _r, over_power: _o, ...simple }) => simple) : p.scores);
    if (rest === "/recents") return ok(res, p.scores.slice(0, 50));
    if (rest === "/trend") {
      if (viaDev && !p.privacy.history) return fail(res, 403, "allow third party fetch history is disabled");
      return ok(res, [{ rating: p.rating, date: "2026-10-13" }]);
    }
    // 一张谱面的上传历史：开发者接口要对方开着历史成绩（上面已经查过谱面成绩的开关）
    if (rest === "/score/history") {
      if (viaDev && !p.privacy.history) return fail(res, 403, "allow third party fetch history is disabled");
      return ok(res, (p.history || []).filter((s) => String(s.id) === query.get("song_id") && String(s.level_index) === query.get("level_index")));
    }
    // 排名只有玩家接口有（开发者接口走到最后的 404）
    if (rest === "/score/ranking" && !viaDev) return ok(res, p.ranking || []);
    if (rest === "/best") {
      const hit = p.scores.find((s) => String(s.id) === query.get("song_id") && String(s.level_index) === query.get("level_index"));
      return ok(res, hit || null);
    }
    return fail(res, 404, "resource not found");
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => resolve(raw));
    });
  }

  async function token(req, res) {
    const params = new URLSearchParams(await readBody(req));
    state.tokenGrants.push(params.get("grant_type"));
    if (state.tokenDelayMs) await new Promise((r) => setTimeout(r, state.tokenDelayMs));
    if (params.get("client_id") !== clientId) return json(res, 401, { error: "invalid_client", error_description: "invalid client ID" });
    if (params.get("client_secret") !== clientSecret) return json(res, 401, { error: "invalid_client", error_description: "invalid client secret" });
    let friendCode;
    if (params.get("grant_type") === "authorization_code") {
      const entry = state.codes.get(params.get("code"));
      if (!entry) return json(res, 400, { error: "invalid_grant", error_description: "authorization code is invalid" });
      if (params.get("redirect_uri") !== "urn:ietf:wg:oauth:2.0:oob") return json(res, 400, { error: "invalid_grant", error_description: "redirect uri mismatch" });
      const challenge = crypto.createHash("sha256").update(String(params.get("code_verifier") || "")).digest("base64url");
      if (challenge !== entry.challenge) return json(res, 400, { error: "invalid_grant", error_description: "code verifier mismatch" });
      state.codes.delete(params.get("code"));
      friendCode = entry.friendCode;
    } else if (params.get("grant_type") === "refresh_token") {
      friendCode = state.refresh.get(params.get("refresh_token"));
      if (!friendCode) return json(res, 400, { error: "invalid_grant", error_description: "refresh token is invalid" });
      state.refresh.delete(params.get("refresh_token"));   // 滚动：旧的立刻作废
    } else {
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    const access = "at-" + crypto.randomBytes(8).toString("hex");
    const refresh = "rt-" + crypto.randomBytes(8).toString("hex");
    state.access.set(access, { friendCode, expiresAt: Date.now() + accessTtl * 1000 });
    state.refresh.set(refresh, friendCode);
    return json(res, 200, { access_token: access, token_type: "Bearer", expires_in: accessTtl, refresh_token: refresh, scope: "read_player" });
  }

  server.on("request", async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const auth = String(req.headers.authorization || "");
    const kind = auth.startsWith("Bearer ") ? "bearer" : auth ? "dev" : req.headers["x-user-token"] ? "user" : "none";
    state.requests.push({ method: req.method, path: url.pathname + url.search, auth: kind });

    if (state.failNext) {
      const f = state.failNext;
      if (f.times > 1) f.times -= 1; else state.failNext = null;
      return json(res, f.status, f.body || { success: false, code: f.status, message: "mock failure" });
    }
    if (req.method === "POST" && url.pathname === "/api/v0/oauth/token") return token(req, res);
    const asset = url.pathname.match(/^\/assets\/chunithm\/(\w+)\/(\d+)\.png$/);
    if (asset) {
      const body = state.assets.get(asset[1] + "/" + asset[2]);
      if (!body) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(body);
    }
    if (url.pathname === "/api/v0/chunithm/song/list") return json(res, 200, state.songList);
    if (url.pathname === "/api/v0/chunithm/alias/list") return json(res, 200, state.aliasList);

    const dev = url.pathname.match(/^\/api\/v0\/chunithm\/player\/([^/]+)(\/.*)?$/);
    if (dev) {
      if (auth !== devToken) return fail(res, 401, "unauthorized");
      if (!/^\d+$/.test(dev[1])) return fail(res, 400, "invalid friend code");
      const p = state.players.get(dev[1]);
      if (!p) return fail(res, 404, "player not found");
      return playerRoutes(res, p, dev[2] || "", url.searchParams, true);
    }
    const user = url.pathname.match(/^\/api\/v0\/user\/chunithm\/player(\/.*)?$/);
    if (user) {
      const bearer = auth.startsWith("Bearer ") ? state.access.get(auth.slice(7)) : null;
      if (!bearer || bearer.expiresAt <= Date.now()) return fail(res, 401, "unauthorized");
      const p = state.players.get(bearer.friendCode);
      if (!p) return fail(res, 404, "player not found");
      return playerRoutes(res, p, user[1] || "", url.searchParams, false);
    }
    return fail(res, 404, "resource not found");
  });

  return {
    state,
    clientId,
    clientSecret,
    devToken,
    get site() { return "http://127.0.0.1:" + port; },
    get apiBase() { return "http://127.0.0.1:" + port + "/api/v0"; },
    get assetsBase() { return "http://127.0.0.1:" + port + "/assets/chunithm"; },
    start() {
      return new Promise((resolve) => server.listen(0, "127.0.0.1", () => { port = server.address().port; resolve(port); }));
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    // bests：/bests 原样返回的 { bests, new_bests, selections }，不给就拿 scores 的前 30 凑；
    // history：score/history 用的 Score[]（按 id、level_index 筛）；ranking：score/ranking 原样返回的列表
    addPlayer({ friendCode, name, rating = 17, privacy = {}, scores, bests, history = [], ranking = [] } = {}) {
      const p = {
        friendCode: String(friendCode), name, rating,
        privacy: { player: true, scores: true, history: false, ...privacy },
        scores: scores || [score(407, 3, 1007725), score(3, 3, 1009000)],
        bests: bests || null,
        history,
        ranking,
      };
      state.players.set(String(friendCode), p);
      return p;
    },
    // 玩家在授权页点了同意：返回页面上显示的那个授权码
    approve(friendCode, challenge) {
      const code = crypto.randomBytes(2).toString("hex").toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase() + "-" +
        crypto.randomBytes(2).toString("hex").toUpperCase();
      state.codes.set(code, { friendCode: String(friendCode), challenge });
      return code;
    },
    // 让所有访问令牌立刻过期（模拟过了 15 分钟）
    expireAccessTokens() { for (const entry of state.access.values()) entry.expiresAt = 0; },
    // 玩家在落雪撤销了授权：刷新令牌全部作废
    revoke(friendCode) {
      for (const [token, code] of state.refresh) if (code === String(friendCode)) state.refresh.delete(token);
      for (const [token, entry] of state.access) if (entry.friendCode === String(friendCode)) state.access.delete(token);
    },
    failNext(status, body, times = 1) { state.failNext = { status, body, times }; },
    count: (predicate) => state.requests.filter(predicate).length,
  };
}

module.exports = { createMockLxns, PNG };
