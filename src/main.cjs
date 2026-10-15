"use strict";
// 启动入口：npm start。

const path = require("node:path");
const { loadConfig } = require("./config.cjs");
const { createLog } = require("./log.cjs");
const { createServices } = require("./services.cjs");
const { createAnnaBot } = require("./bot.cjs");

async function main() {
  const config = loadConfig();
  const log = createLog({ dir: path.join(config.workDir, "logs"), secrets: config.secrets, keepDays: config.logKeepDays });
  const services = await createServices(config, { log });
  log("绑定库：" + services.vault.size + " 人｜主密钥来自 " +
    ({ env: "ANNA_VAULT_KEY", dpapi: "vault.key（DPAPI）", "dpapi-new": "新生成的 vault.key（DPAPI）" })[services.keySource]);
  if (!services.oauth.enabled) log("提示：.env 里没配 LXNS_OAUTH_CLIENT_ID / LXNS_OAUTH_CLIENT_SECRET，/授权 不可用。");
  if (!services.renderer.findBrowser()) log("⚠ 没找到 Chrome 或 Edge，出图功能用不了（可以在 config.local.json 的 browserPath 指定）。");
  // 上次被强行结束（npm stop、关机）时正在出图的话，浏览器临时目录来不及删，启动时清一遍（在后台做，不耽误连 QQ）
  void services.renderer.sweep();

  const loaded = await services.catalog.ready();
  log("曲库：" + services.catalog.size + " 首，" + services.catalog.currentVersion().title +
    ({ cache: "（本地缓存）", lxns: "（刚从落雪拉取）", "stale-cache": "（⚠ 落雪拉不到，用的旧缓存）" })[loaded.source]);
  services.catalog.start();

  // 很久没查分的人的刷新令牌，在 30 天过期之前替他续上。每 6 小时看一次。
  const keepAliveMs = config.oauthKeepAliveDays * 24 * 60 * 60 * 1000;
  const keepAlive = () => services.bindings.keepAlive(keepAliveMs)
    .then(({ refreshed, expired }) => { if (refreshed || expired) log("OAuth 续期：续上 " + refreshed + " 人，失效 " + expired + " 人"); })
    .catch((error) => log("⚠ OAuth 续期出错：" + error.message));
  setInterval(keepAlive, 6 * 60 * 60 * 1000).unref();
  void keepAlive();

  const bot = createAnnaBot(config, { ...services, log });
  await bot.start();

  const shutdown = async () => {
    bot.stop();
    services.catalog.stop();
    await services.vault.flush();
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    // 启动失败时也抹掉可能混进错误里的令牌
    console.error("启动失败：" + String(error?.message || error).replace(/QQBot [\w.-]+/g, "QQBot ***").replace(/Bearer [\w.-]+/g, "Bearer ***"));
    process.exit(1);
  });
}

module.exports = { main };
