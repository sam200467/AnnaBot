"use strict";
// 配置：密钥放 .env（从 .env.example 复制），其余设置放 config.local.json（从 config.example.json 复制）。
// 两份都不进仓库。各项的说明写在 config.example.json 里。
// 相对路径一律按项目根目录解析，不用 process.cwd() —— 启动器、计划任务的工作目录不一定是项目目录（MiaBot 踩过）。

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const DEFAULTS = Object.freeze({
  sandbox: false,
  allowedGroupIds: [],
  allowPrivateChat: true,
  admins: [],
  workDir: "./data",
  acceptBareGroupCommands: false,
  reuseLatestPassiveCredential: true,
  markdown: true,
  keyboard: true,
  commandPanel: true,
  generateCooldownMs: 3000,
  receiptDelayMs: 1500,
  maxQueue: 10,
  browserPath: "",
  renderScale: 2,
  catalogRefreshHours: 6,
  oauthKeepAliveDays: 20,
  logKeepDays: 14,
});

// 这些设置原样交给 official-transport.cjs（不填就用它的默认值）。
const TRANSPORT_KEYS = ["minSendIntervalMs", "jitterMs", "perTargetIntervalMs", "perTargetPerHour", "dailyCap",
  "duplicateWindowMs", "markdown", "keyboard", "reuseLatestPassiveCredential", "maxImageBytes"];

const SECRET_NAMES = ["QQ_APP_SECRET", "LXNS_DEV_TOKEN", "LXNS_OAUTH_CLIENT_SECRET", "ANNA_VAULT_KEY", "LXNS_USER_TOKEN"];

// requireQQ：要连 QQ（正式启动、探针）；requireGroups：白名单不能是空的（正式启动）；
// requireLxns：要开发者密钥；requireFile：没有 config.local.json 时报错，false 时退回 config.example.json（工具脚本用）。
function loadConfig({ root = ROOT, env, file, requireQQ = true, requireGroups = true, requireLxns = true, requireFile = true } = {}) {
  if (!env) {
    try { process.loadEnvFile(path.join(root, ".env")); } catch { /* 没有 .env 就只看环境变量 */ }
    env = process.env;
  }
  let configFile = file || path.join(root, "config.local.json");
  if (!fs.existsSync(configFile) && !requireFile && !file) configFile = path.join(root, "config.example.json");
  if (!fs.existsSync(configFile)) throw new Error("找不到 config.local.json —— 从 config.example.json 复制一份再改");
  const raw = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const settings = { ...DEFAULTS };
  for (const [key, value] of Object.entries(raw)) if (!key.startsWith("_")) settings[key] = value;
  if (!Array.isArray(settings.allowedGroupIds) || !Array.isArray(settings.admins)) {
    throw new Error("config.local.json 的 allowedGroupIds 和 admins 都要写成数组，比如 [\"1A2B3C…\"]");
  }

  const secret = (name) => String(env[name] ?? "").trim();
  const qq = { appId: secret("QQ_APP_ID"), clientSecret: secret("QQ_APP_SECRET"), sandbox: settings.sandbox !== false };
  for (const key of TRANSPORT_KEYS) if (settings[key] !== undefined) qq[key] = settings[key];

  const config = {
    ...settings,
    root,
    workDir: path.resolve(root, String(settings.workDir || "./data")),
    allowedGroupIds: (settings.allowedGroupIds || []).map(String),
    admins: (settings.admins || []).map(String),
    qq,
    lxns: {
      devToken: secret("LXNS_DEV_TOKEN"),
      oauthClientId: secret("LXNS_OAUTH_CLIENT_ID"),
      oauthClientSecret: secret("LXNS_OAUTH_CLIENT_SECRET"),
    },
    vaultKey: secret("ANNA_VAULT_KEY"),
    // 日志里要抹掉的值
    secrets: SECRET_NAMES.map(secret).filter(Boolean),
  };

  if (requireQQ && (!qq.appId || !qq.clientSecret)) {
    throw new Error(".env 里缺少 QQ_APP_ID / QQ_APP_SECRET（QQ 开放平台 q.qq.com → 开发设置）");
  }
  if (requireGroups && config.allowedGroupIds.length === 0) {
    throw new Error("config.local.json 的 allowedGroupIds 是空的，拒绝启动（免得误入陌生群）。\n" +
      "  这里填的不是群号，是 group_openid。拿法：npm run probe，然后在群里 @ 机器人一次，探针会把它打出来。");
  }
  if (requireLxns && !config.lxns.devToken) throw new Error(".env 里缺少 LXNS_DEV_TOKEN（落雪开发者面板 → API 密钥）");
  return config;
}

module.exports = { loadConfig, DEFAULTS, ROOT };
