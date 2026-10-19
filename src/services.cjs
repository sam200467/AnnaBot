"use strict";
// 把各个模块按配置装起来。正式启动（main.cjs）和工具脚本（tools/）都用它，保证两边拿到的是同一套东西。
//
// 数据都在 workDir（默认 data/）下：
//   bindings.enc   绑定库（加密）          vault.key   主密钥（DPAPI 加密，只有本机这个 Windows 用户解得开）
//   cache/         落雪曲库和别名           cache/assets/  落雪图片素材
//   logs/          日志

const path = require("node:path");
const { createLxnsClient } = require("./lxns.cjs");
const { createOAuth } = require("./lxns-oauth.cjs");
const { openVault, loadMasterKey } = require("./vault.cjs");
const { createBindings } = require("./bindings.cjs");
const { createCatalog } = require("./catalog.cjs");
const { createAssets } = require("./assets.cjs");
const { createRenderer } = require("./renderer.cjs");
const { loadSongExtras } = require("./song-extras.cjs");
const { loadFitDiffs } = require("./fit-diffs.cjs");

// needs：只装用得到的部分。工具脚本出个预览图不需要碰绑定库（也就不用解主密钥）。
// vaultDir：绑定库和主密钥放哪（默认 workDir）。npm run try 用单独的一份，不碰正式绑定。
async function createServices(config, { log = () => {}, fetchImpl, needs = ["bindings"], vaultDir } = {}) {
  const workDir = config.workDir;
  const lxns = createLxnsClient({ devToken: config.lxns.devToken, log, ...(fetchImpl ? { fetchImpl } : {}) });
  const oauth = createOAuth({
    clientId: config.lxns.oauthClientId, clientSecret: config.lxns.oauthClientSecret,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const catalog = createCatalog({ lxns, cacheDir: path.join(workDir, "cache"), refreshMs: config.catalogRefreshHours * 60 * 60 * 1000, log });
  const assets = createAssets({ cacheDir: path.join(workDir, "cache", "assets"), log, ...(fetchImpl ? { fetchImpl } : {}) });
  const renderer = createRenderer({ themesDir: path.join(config.root, "themes"), browserPath: config.browserPath, scale: config.renderScale, log });
  // 日服上线日期、原创曲的对应角色（随程序发布的一份表，见 song-extras.cjs）
  const songExtras = loadSongExtras();
  // 拟合定数快照（EazyChu，见 fit-diffs.cjs 和 tools/build-fit-diffs.cjs）
  const fitDiffs = loadFitDiffs();
  const services = { lxns, oauth, catalog, assets, renderer, songExtras, fitDiffs, vault: null, bindings: null, keySource: "" };

  if (needs.includes("bindings")) {
    const dir = vaultDir || workDir;
    const vaultFile = path.join(dir, "bindings.enc");
    const { key, source } = await loadMasterKey({ envKey: config.vaultKey, keyFile: path.join(dir, "vault.key"), vaultFile });
    services.vault = await openVault({ file: vaultFile, key, log });
    services.bindings = createBindings({ vault: services.vault, lxns, oauth, log });
    services.keySource = source;
  }
  return services;
}

module.exports = { createServices };
