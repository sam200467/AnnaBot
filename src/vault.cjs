"use strict";
// 绑定库：openid → 绑定条目，整份 AES-256-GCM 加密后存成一个文件（默认 data/bindings.enc）。
// 条目长什么样由 bindings.cjs 决定，这里只管加密、读写和不丢数据。
//
// 主密钥（32 字节）从哪来，按顺序：
//   1. 环境变量 ANNA_VAULT_KEY（base64）—— 非 Windows 部署、或者迁移到别的机器时用
//   2. Windows：keyFile（默认 data/vault.key），里面是用 DPAPI（当前 Windows 用户）加密过的主密钥，
//      第一次启动时自动生成。只拷走 data 目录、或者换一个 Windows 用户运行，都解不开 —— 这正是用 DPAPI 的目的。
//      迁移服务器前先在旧机器上运行 tools/vault-key.cjs 导出主密钥，到新机器上设成 ANNA_VAULT_KEY。
//   3. 都没有：拒绝启动。
// MiaBot 用的是单独编译的 C# 小程序（mia-vault.cs）做 DPAPI；这里改成启动时调一次 PowerShell 解开主密钥，
// 之后的加解密都在进程内做 —— OAuth 令牌每 15 分钟就要刷新、写盘，每次都起一个外部程序太慢。
//
// 改动先落到内存（同步），再排队写盘。写盘失败时内存里的数据还在，下一次写盘会把它一起写进去：
// OAuth 刷新令牌是滚动的，旧的一刷新就作废，宁可内存里先拿着新的，也不能因为一次写盘失败就丢掉。
// 文件解不开时**绝不覆盖**：那里面是所有人的绑定，覆盖了就全没了。

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MAGIC = Buffer.from("ANV1");
const AAD = Buffer.from("anna-vault-v1");
// DPAPI 的附加熵。改了就解不开已有的 vault.key（所有绑定跟着失效），别动。
const DPAPI_ENTROPY = "AnnaBotVaultKeyV1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decrypt(blob, key) {
  if (blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error("不是 Anna 的绑定库文件");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(4, 16));
  decipher.setAAD(AAD);
  decipher.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]);
}

// stderr 被重定向时 PowerShell 会在最前面加一行「#< CLIXML」，后面可能还跟着 <Objs> 包着的错误记录。
// 脚本自己写出的那句在这行和 <Objs> 之间；<Objs> 里的 Error 记录也捞出来。
function powerShellError(stderr) {
  const text = String(stderr || "");
  if (!text.startsWith("#< CLIXML")) return text.trim() || "未知错误";
  const body = text.slice("#< CLIXML".length);
  const plain = body.split("<Objs")[0].trim();
  const records = [...body.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]
    .replace(/_x000D__x000A_/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim());
  return [plain, ...records].filter(Boolean).join(" ").replace(/\s+/g, " ") || "未知错误";
}

// PowerShell 脚本走 -EncodedCommand（UTF-16LE base64），省得跟命令行引号较劲；数据走标准输入。
function runPowerShell(script, input) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error("PowerShell 退出码 " + code + "：" + powerShellError(err).slice(0, 300)));
    });
    child.stdin.end(input);
  });
}

// 中文 Windows 上 PowerShell 默认按 GBK 往外写，错误还会包成 CLIXML：
// 这里自己接住异常，按 UTF-8 只写一句错误消息出来。
function dpapiScript(method) {
  return [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$ProgressPreference = 'SilentlyContinue'",
    "try {",
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    "$entropy = [Text.Encoding]::UTF8.GetBytes('" + DPAPI_ENTROPY + "')",
    "$result = [Security.Cryptography.ProtectedData]::" + method +
      "($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($result))",
    "} catch { $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }; [Console]::Error.Write($e.Message); exit 1 }",
  ].join("\n");
}

const dpapi = {
  async protect(buffer) { return Buffer.from(await runPowerShell(dpapiScript("Protect"), buffer.toString("base64")), "base64"); },
  async unprotect(buffer) { return Buffer.from(await runPowerShell(dpapiScript("Unprotect"), buffer.toString("base64")), "base64"); },
};

function keyFromBase64(text, label) {
  const key = Buffer.from(String(text).trim(), "base64");
  if (key.length !== 32) throw new Error(label + " 必须是 32 字节的 base64（现在是 " + key.length + " 字节）");
  return key;
}

// 返回 { key, source }。source 只用来写启动日志：env / dpapi / dpapi-new。
async function loadMasterKey({ envKey, keyFile, vaultFile, platform = process.platform, protector = dpapi } = {}) {
  if (String(envKey || "").trim()) return { key: keyFromBase64(envKey, "ANNA_VAULT_KEY"), source: "env" };
  if (platform !== "win32") {
    throw new Error("非 Windows 系统要在 .env 里设置 ANNA_VAULT_KEY（32 字节 base64，可以用 " +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" 生成）");
  }
  if (fs.existsSync(keyFile)) {
    let plain;
    try { plain = await protector.unprotect(fs.readFileSync(keyFile)); }
    catch (error) {
      throw new Error("解不开主密钥 " + keyFile + "：它只能由当初生成它的那个 Windows 用户解开。" +
        "换了机器或用户的话，在原机器上用 tools/vault-key.cjs 导出主密钥，设成 ANNA_VAULT_KEY。（" + error.message + "）");
    }
    if (plain.length !== 32) throw new Error("主密钥文件 " + keyFile + " 内容不对");
    return { key: plain, source: "dpapi" };
  }
  // 绑定库在、主密钥却没了：新生成一把也解不开旧库，直接报错，别让人以为重新生成就好了。
  if (vaultFile && fs.existsSync(vaultFile)) {
    throw new Error("找到了绑定库 " + vaultFile + "，但主密钥文件 " + keyFile + " 不见了。" +
      "把原来的 vault.key 放回去，或者设置导出过的 ANNA_VAULT_KEY。");
  }
  const key = crypto.randomBytes(32);
  const sealed = await protector.protect(key);
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, sealed, { flag: "wx" });
  return { key, source: "dpapi-new" };
}

async function writeAtomic(file, data) {
  const tmp = file + "." + process.pid + ".tmp";
  await fsp.writeFile(tmp, data);
  // Windows 上目标文件正被杀毒软件之类读着时 rename 会报 EPERM/EBUSY，等一下再试。
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error?.code)) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw error;
      }
      await sleep(50 * (attempt + 1));
    }
  }
}

async function openVault({ file, key, log = () => {} } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("绑定库需要 32 字节主密钥");
  let entries = {};
  if (fs.existsSync(file)) {
    try {
      entries = JSON.parse(decrypt(fs.readFileSync(file), key).toString("utf8")).entries || {};
    } catch (error) {
      throw new Error("绑定库 " + file + " 解不开（主密钥不对或文件损坏）。为了不覆盖已有的绑定，拒绝启动。（" + error.message + "）");
    }
  }
  const map = new Map(Object.entries(entries));
  let chain = Promise.resolve();

  async function write() {
    const payload = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), entries: Object.fromEntries(map) });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await writeAtomic(file, encrypt(Buffer.from(payload, "utf8"), key));
  }

  // 每次写的都是写那一刻的完整内容，所以前一次失败了，后一次成功就把它补上了。
  function persist() {
    const run = chain.then(write);
    chain = run.catch((error) => log("⚠ 绑定库写盘失败：" + error.message + "（内存里的数据还在，下次改动时会重写）"));
    return run;
  }

  const copy = (value) => (value === undefined || value === null ? null : structuredClone(value));

  return {
    file,
    get size() { return map.size; },
    has: (openid) => map.has(String(openid)),
    get: (openid) => copy(map.get(String(openid))),
    entries: () => [...map].map(([openid, entry]) => [openid, copy(entry)]),
    set(openid, entry) {
      map.set(String(openid), copy(entry));
      return persist();
    },
    // fn 拿到当前条目的副本（没有就是 null），返回新条目；返回 undefined 表示不改，返回 null 表示删掉。
    update(openid, fn) {
      const key = String(openid);
      const next = fn(copy(map.get(key)));
      if (next === undefined) return chain;
      if (next === null) map.delete(key);
      else map.set(key, copy(next));
      return persist();
    },
    async delete(openid) {
      const existed = map.delete(String(openid));
      if (existed) await persist();
      return existed;
    },
    flush: () => chain,
  };
}

module.exports = { openVault, loadMasterKey, encrypt, decrypt, dpapi, keyFromBase64 };
