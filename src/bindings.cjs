"use strict";
// 绑定：QQ openid → 落雪玩家。两种方式，存在同一个绑定库里（vault.cjs，整份加密）：
//
//   好友码（/绑定 好友码）：走开发者接口。B30、单曲、最近成绩、收藏品进度都有；
//     全部成绩只有评级和 FC 标记、没有分数。好友码不是秘密，谁都能绑任何人的好友码 ——
//     跟其他用开发者接口的机器人一样，由玩家自己在落雪的「允许第三方读取」开关里管。
//   OAuth（/授权）：走玩家接口，全部成绩带分数。同时记下好友码：令牌失效（过期、被撤销）时
//     退回开发者接口，B30 这些照样能查，只有要全部分数的功能会请玩家重新授权。
//
// 条目：{ friendCode, playerName, method: "friendCode" | "oauth", boundAt,
//         oauth?: { accessToken, refreshToken, expiresAt, scope, refreshedAt, status: "ok" | "expired" } }
//
// 刷新令牌是滚动的：每次刷新拿到新的，旧的立刻作废。所以
//   - 同一个人同一时刻只能有一个刷新在跑（两个查询同时触发刷新，后一个拿着作废的令牌会把授权弄坏）
//   - 新令牌先写进绑定库（内存立即生效）再用
//   - 只有落雪明确回 invalid_grant 才判定授权失效；网络错误不算，下次再试
//
// 功能代码只用 player(openid) 拿到的那组方法，不用管这个人是哪种绑定。

const { LxnsError } = require("./lxns.cjs");
const { OAuthError } = require("./lxns-oauth.cjs");

const mask = (openid) => String(openid).slice(0, 6) + "…";

function normalizeFriendCode(input) {
  const code = String(input ?? "").normalize("NFKC").replace(/[\s-]/g, "");
  return /^\d{6,20}$/.test(code) ? code : null;
}

function createBindings({ vault, lxns, oauth = null, now = Date.now, log = () => {}, accessMarginMs = 60_000 } = {}) {
  const refreshing = new Map();   // openid -> Promise<访问令牌 | null>
  const iso = () => new Date(now()).toISOString();
  const logWrite = (error) => log("⚠ 绑定库写盘失败（内存里已更新）：" + error.message);

  async function bindFriendCode(openid, input) {
    const code = normalizeFriendCode(input);
    if (!code) throw new LxnsError("好友码只能是数字", { status: 400, code: "invalid_friend_code" });
    const player = await lxns.dev.player(code);
    const previous = vault.get(openid);
    await vault.set(openid, { friendCode: String(player.friend_code || code), playerName: player.name, method: "friendCode", boundAt: iso() });
    return { player, previous };
  }

  function startOAuth(openid) {
    if (!oauth?.enabled) throw new OAuthError("没有配置 OAuth 应用", { code: "disabled" });
    return oauth.createAuthorization(openid);
  }

  // 授权成功但落雪账号里没有中二数据时，player() 会抛 player_not_found，这时不保存。
  async function finishOAuth(openid, code) {
    if (!oauth?.enabled) throw new OAuthError("没有配置 OAuth 应用", { code: "disabled" });
    const tokens = await oauth.exchange(openid, code);
    const player = await lxns.user({ bearer: tokens.accessToken }).player();
    const previous = vault.get(openid);
    await vault.set(openid, {
      friendCode: String(player.friend_code), playerName: player.name, method: "oauth", boundAt: iso(),
      oauth: { ...tokens, refreshedAt: now(), status: "ok" },
    });
    return { player, previous };
  }

  async function unbind(openid) {
    oauth?.cancel?.(openid);
    return vault.delete(openid);
  }

  async function refreshNow(openid) {
    const entry = vault.get(openid);
    if (!entry?.oauth || entry.oauth.status === "expired") return null;
    const used = entry.oauth.refreshToken;
    // 刷新期间这个人重新授权了的话，绑定库里已经是新令牌，别拿这次的结果把它盖掉。
    const stillSame = (current) => current?.oauth?.refreshToken === used;
    let tokens;
    try {
      tokens = await oauth.refresh(used);
    } catch (error) {
      if (error?.code !== "invalid_grant") throw error;
      await vault.update(openid, (current) => (stillSame(current)
        ? { ...current, oauth: { ...current.oauth, accessToken: "", status: "expired" } } : undefined)).catch(logWrite);
      log("OAuth 授权已失效（" + mask(openid) + "），之后退回好友码查询");
      return null;
    }
    await vault.update(openid, (current) => (stillSame(current)
      ? { ...current, oauth: { ...tokens, refreshedAt: now(), status: "ok" } } : undefined)).catch(logWrite);
    return tokens.accessToken;
  }

  // 有效的访问令牌；授权失效或不是 OAuth 绑定时是 null。force：不管有没有过期都刷新一次。
  function accessToken(openid, { force = false } = {}) {
    const key = String(openid);
    if (refreshing.has(key)) return refreshing.get(key);
    const entry = vault.get(key);
    if (!entry?.oauth || entry.oauth.status === "expired") return Promise.resolve(null);
    if (!force && entry.oauth.accessToken && entry.oauth.expiresAt - accessMarginMs > now()) {
      return Promise.resolve(entry.oauth.accessToken);
    }
    if (!oauth?.enabled) return Promise.resolve(null);
    const job = refreshNow(key).finally(() => refreshing.delete(key));
    refreshing.set(key, job);
    return job;
  }

  // thirdParty：替别人查（群里 @ 了别人）。这时只走开发者接口 —— 受对方在落雪的「允许第三方读取」开关管，
  // 不拿对方的授权令牌：对方授权的是「Anna 替我查我自己」，不是「谁都能借 Anna 看我的全部成绩」。
  function createPlayerApi(openid, entry, { thirdParty = false } = {}) {
    const friendCode = entry.friendCode;
    const isOAuth = entry.method === "oauth";
    const oauthOk = !thirdParty && isOAuth && entry.oauth?.status !== "expired" && Boolean(oauth?.enabled);

    // 走玩家接口；访问令牌被拒（401）时强制刷新一次再试。拿不到令牌（授权失效）时用 fallback（开发者接口），
    // 没有 fallback 的（全部成绩）报 oauth_expired，由 voice.cjs 请玩家重新授权。
    async function viaUser(call, fallback) {
      let token = await accessToken(openid);
      if (token) {
        try {
          return await call(lxns.user({ bearer: token }));
        } catch (error) {
          if (error?.code !== "unauthorized") throw error;
          token = await accessToken(openid, { force: true });
          if (token) return call(lxns.user({ bearer: token }));
        }
      }
      if (fallback) return fallback();
      throw new LxnsError("授权失效，需要重新授权", { code: "oauth_expired" });
    }
    const either = (userCall, devCall) => (oauthOk ? viaUser(userCall, friendCode ? devCall : null) : devCall());

    return {
      openid,
      friendCode,
      playerName: entry.playerName,
      method: entry.method,
      boundAt: entry.boundAt,
      // 能不能读全部成绩的具体分数（等级成绩、分表这类功能要）
      hasFullScores: oauthOk,
      // 曾经授权过、现在失效了：基础功能退回好友码，要分数的功能请玩家重新 /授权
      oauthExpired: !thirdParty && isOAuth && !oauthOk,
      player: () => either((u) => u.player(), () => lxns.dev.player(friendCode)),
      // { bests: 旧版本 B30, new_bests: 新曲 20, selections: 候选 10 }
      bests: () => either((u) => u.bests(), () => lxns.dev.bests(friendCode)),
      // 单曲全部难度 Score[]
      songBests: (songId) => either((u) => u.songBests(songId), () => lxns.dev.songBests(friendCode, songId)),
      // 最近 50 条，只有开发者接口有
      recents: () => lxns.dev.recents(friendCode),
      // 全部成绩 Score[]（带分数），只有 OAuth 能读
      scores: () => (oauthOk ? viaUser((u) => u.scores(), null)
        : Promise.reject(new LxnsError("需要授权才能读全部分数", { code: isOAuth ? "oauth_expired" : "need_oauth" }))),
      // 全部成绩的简化版（评级、CLEAR、FC 标记，没有分数），任何绑定都能读
      simpleScores: () => lxns.dev.simpleScores(friendCode),
      trend: (version) => either((u) => u.trend(version), () => lxns.dev.trend(friendCode, version)),
      // 一张谱面每次上传的成绩。好友码（和查别人）走开发者接口，要对方开着「允许读取历史成绩」
      scoreHistory: (songId, levelIndex) => either((u) => u.scoreHistory(songId, levelIndex), () => lxns.dev.scoreHistory(friendCode, songId, levelIndex)),
      // 这张谱面在落雪的排名，只有玩家接口有：好友码绑定、查别人、授权失效时都是 null
      scoreRanking: (songId, levelIndex) => (oauthOk ? viaUser((u) => u.scoreRanking(songId, levelIndex), () => null) : Promise.resolve(null)),
      // type: trophy | character | plate | icon
      collection: (type, id) => either((u) => u.collection(type, id), () => lxns.dev.collection(friendCode, type, id)),
    };
  }

  // 这个人的查分入口；没绑定是 null。
  function player(openid, { thirdParty = false } = {}) {
    const entry = vault.get(openid);
    return entry ? createPlayerApi(String(openid), entry, { thirdParty }) : null;
  }

  // 刷新令牌 30 天不用就过期。很久没查分的人，在过期前替他刷新一次，免得回来时要重新授权。
  async function keepAlive(maxAgeMs) {
    let refreshed = 0;
    let expired = 0;
    for (const [openid, entry] of vault.entries()) {
      if (entry.method !== "oauth" || entry.oauth?.status === "expired") continue;
      if (now() - (entry.oauth?.refreshedAt || 0) < maxAgeMs) continue;
      try {
        if (await accessToken(openid, { force: true })) refreshed++;
        else expired++;
      } catch (error) {
        log("续期 OAuth 令牌失败（" + mask(openid) + "）：" + error.message);
      }
    }
    return { refreshed, expired };
  }

  function stats() {
    const counts = { total: 0, friendCode: 0, oauth: 0, oauthExpired: 0 };
    for (const [, entry] of vault.entries()) {
      counts.total++;
      if (entry.method === "oauth") {
        counts.oauth++;
        if (entry.oauth?.status === "expired") counts.oauthExpired++;
      } else counts.friendCode++;
    }
    return counts;
  }

  return {
    get: (openid) => vault.get(openid),
    player,
    bindFriendCode,
    startOAuth,
    finishOAuth,
    unbind,
    accessToken,
    keepAlive,
    stats,
    oauthEnabled: Boolean(oauth?.enabled),
  };
}

module.exports = { createBindings, normalizeFriendCode };
