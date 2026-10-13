"use strict";
// 落雪 OAuth：无回调地址 + PKCE（流程 2026-10-13 用 tools/check-oauth.cjs 跑通过）。
//
//   /授权          → createAuthorization(openid)：生成这个人专属的授权链接。code_challenge 写在链接里，
//                    code_verifier 只留在本机内存，pendingTtlMs 后作废
//   玩家打开链接授权 → 落雪页面直接显示授权码（形如 ABCD-EFGH-IJKL，「无回调地址」模式）
//   /授权 授权码    → exchange(openid, code)：用**这个人自己的** verifier 去换令牌
//
// 为什么非要 PKCE：QQ 官方机器人不能主动私聊，绑定常常就在群里进行，授权码会被别人看见。
// 有了 PKCE，别人抢先把你的授权码发给 Anna 也没用 —— 那会配上他自己的 verifier（或者他根本没有），
// 落雪那边对不上，兑换失败。
//
// 令牌：访问令牌 15 分钟（expires_in=900）；刷新令牌 30 天，每次刷新都会换一个新的、旧的立刻作废。
// 刷新的串行和写回绑定库由 bindings.cjs 负责，这里只管跟落雪的令牌接口说话。

const crypto = require("node:crypto");

const OOB_REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";   // 勾选「无回调地址」时落雪登记的回调地址
const DEFAULT_SITE = "https://maimai.lxns.net";

class OAuthError extends Error {
  constructor(message, { status = 0, code = "unknown" } = {}) {
    super(message);
    this.name = "OAuthError";
    this.status = status;
    this.code = code;
  }
}

function createOAuth(options = {}) {
  const clientId = String(options.clientId || "").trim();
  const clientSecret = String(options.clientSecret || "").trim();
  const site = String(options.siteUrl || DEFAULT_SITE).replace(/\/+$/, "");
  const scope = options.scope || "read_player";
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const pendingTtlMs = options.pendingTtlMs || 10 * 60 * 1000;
  const timeoutMs = options.timeoutMs || 20000;
  const pending = new Map();   // openid -> { verifier, expiresAt }

  function prune() {
    const current = now();
    for (const [openid, entry] of pending) if (entry.expiresAt <= current) pending.delete(openid);
  }

  function pendingFor(openid) {
    prune();
    return pending.get(String(openid)) || null;
  }

  // 同一个人再发一次 /授权 就换一条新链接，旧链接换来的授权码随之作废。
  function createAuthorization(openid) {
    if (!clientId || !clientSecret) throw new OAuthError("没有配置 OAuth 应用", { code: "disabled" });
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const expiresAt = now() + pendingTtlMs;
    prune();
    pending.set(String(openid), { verifier, expiresAt });
    const url = new URL("/oauth/authorize", site);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: OOB_REDIRECT_URI,
      scope,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return { url: url.href, expiresAt };
  }

  async function requestToken(params) {
    let res;
    try {
      res = await fetchImpl(site + "/api/v0/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new OAuthError("连不上落雪查分器：" + (error?.cause?.code || error?.message || error), { code: "network" });
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      // 令牌接口的错误是标准扁平格式 { error, error_description }，没有 success/code/data 那层
      throw new OAuthError(body.error_description || body.error || "HTTP " + res.status,
        { status: res.status, code: body.error || (res.status >= 500 ? "server" : "unknown") });
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: now() + Number(body.expires_in || 900) * 1000,
      scope: body.scope || scope,
    };
  }

  // 授权码输错（invalid_grant）时不清掉这次授权，玩家在有效期内改正了再发一次还能用。
  async function exchange(openid, code) {
    const entry = pendingFor(openid);
    if (!entry) throw new OAuthError("没有进行中的授权", { code: "no_pending" });
    const tokens = await requestToken({
      grant_type: "authorization_code",
      code: String(code).trim(),
      redirect_uri: OOB_REDIRECT_URI,
      code_verifier: entry.verifier,
    });
    pending.delete(String(openid));
    return tokens;
  }

  function refresh(refreshToken) {
    if (!refreshToken) return Promise.reject(new OAuthError("没有刷新令牌", { code: "invalid_grant" }));
    return requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  return {
    enabled: Boolean(clientId && clientSecret),
    scope,
    pendingTtlMs,
    createAuthorization,
    hasPending: (openid) => Boolean(pendingFor(openid)),
    cancel: (openid) => pending.delete(String(openid)),
    exchange,
    refresh,
  };
}

module.exports = { createOAuth, OAuthError, OOB_REDIRECT_URI };
