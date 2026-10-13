#!/usr/bin/env node
"use strict";
// 导出绑定库主密钥，迁移服务器时用：npm run vault-key -- --export
//
// Windows 上主密钥由 DPAPI 保护，只有当初生成它的那个 Windows 用户在那台机器上解得开（见 src/vault.cjs）。
// 要换机器或换用户运行时：在旧机器上导出 → 新机器的 .env 里设 ANNA_VAULT_KEY=导出的值 → 把 data/ 整个拷过去。
// ⚠ 导出的值能解开所有人的绑定（含 OAuth 令牌）。只在迁移时用，别留在聊天记录、截图和网盘里。

const path = require("node:path");
const { loadConfig } = require("../src/config.cjs");
const { loadMasterKey } = require("../src/vault.cjs");

async function main() {
  if (!process.argv.includes("--export")) {
    console.log("这个工具会把绑定库主密钥打印出来（迁移服务器用）。确定要导出的话加上 --export：npm run vault-key -- --export");
    return;
  }
  const config = loadConfig({ requireQQ: false, requireGroups: false, requireLxns: false, requireFile: false });
  const keyFile = path.join(config.workDir, "vault.key");
  const vaultFile = path.join(config.workDir, "bindings.enc");
  const { key, source } = await loadMasterKey({ envKey: config.vaultKey, keyFile, vaultFile });
  if (source === "dpapi-new") console.log("（之前还没有主密钥，刚生成了一把新的）");
  console.log("ANNA_VAULT_KEY=" + key.toString("base64"));
}

main().catch((error) => {
  console.error("导出失败：" + (error?.message || error));
  process.exit(1);
});
