#!/usr/bin/env node
"use strict";
// 打服务器部署包（照 MiaBot 的 qq-official/build-deploy.cjs 和 server-updates/ 那一套）：
//
//   npm run package          完整包：程序 + .env、config.local.json、绑定库、曲库和素材缓存。第一次部署、搬服务器用
//   npm run package:update   更新包：只有程序。服务器上已经装过 Anna，换新代码用
//
// 打出来是 dist/ 里的一个 zip（dist/ 不进仓库：完整包里有密钥和所有人的绑定）。拷到服务器解压，双击「安装Anna.cmd」，
// 换程序、放配置、开机自启、启动都是 tools/install.cjs 的事；「部署说明.txt」一起打进包里。
// 不想用 zip 就加 --no-zip：只留解开的文件夹，包里的部署说明也按文件夹写。
//
// 包里长这样：
//   AnnaBot-install-20261015-43bd5ed/
//     安装Anna.cmd  部署说明.txt  manifest.json（版本、每个文件的大小和 SHA256，安装时逐个核对）
//     app/          程序，服务器上整个换新
//     personal/     只有完整包有：.env、config.local.json、data/。服务器上已经有的不覆盖
//
// 程序挑哪些文件：src/ tools/ themes/ 里 git 不忽略的（还没提交的新文件也算，不然刚写的功能会漏掉），
// 加上 .gitignore 挡在仓库外的素材（themes/*/assets/、themes/shared/fonts|icons/），再加 node_modules 里的运行依赖，
// 服务器上不用 npm install。字体只带主题真用到的：fonts.css 里声明了七种，best 只用霞鹜文楷，全带的话包要大 30 多 MB。
//
// 完整包的讲究：
//   - 本机的 Anna 得停着。落雪的刷新令牌每刷新一次就换新、旧的立刻作废：打包以后本机再刷一次，服务器上那份就失效了。
//   - 主密钥：data/vault.key 是 DPAPI 封的，只有本机这个 Windows 用户解得开，拷过去没用。打包时把它解开，
//     写进包里 .env 的 ANNA_VAULT_KEY（服务器上为什么不用 DPAPI，见 tools/install.cjs 开头）。
//   - 只给本机检查脚本用的个人密钥（LXNS_USER_TOKEN，能改写你自己的成绩）和好友码不带。
//   - 用要装过去的那份配置跑一遍 loadConfig、用导出的主密钥解一遍绑定库：到了服务器上起不来的包不该出门。
//
// 用法：npm run package [-- --skip-tests] [--folder] [--no-zip]
//       只出文件夹用 npm run package:folder（PowerShell 里的 npm 是 npm.ps1，会把 -- 后面的参数吞掉）
//   --skip-tests  不跑测试（默认先跑一遍 npm test，没过不打包）
//   --folder      zip 之外再留一份解开的（dist/<包名>/），看看包里有什么
//   --no-zip      只出解开的文件夹，不打 zip；部署说明按文件夹写

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { parseEnv } = require("node:util");
const { execFileSync, spawnSync } = require("node:child_process");
const { loadConfig, ROOT } = require("../src/config.cjs");
const { loadMasterKey, openVault, keyFromBase64 } = require("../src/vault.cjs");
const { findAnna, TASK_NAME } = require("./background.cjs");
const { DEFAULT_TARGET } = require("./install.cjs");

// 程序：这几个目录里 git 不忽略的文件，加上顶层这几个
const PROGRAM_DIRS = ["src", "tools", "themes"];
const TOP_FILES = ["package.json", "config.example.json", ".env.example", "README.md"];
// .gitignore 挡在仓库外、出图又要用的素材（作者自己准备的背景图、字体、图标）
const ASSET = /^themes\/(?:[^/]+\/assets|shared\/fonts|shared\/icons)\//;
const JUNK = /(?:^|\/)(?:desktop\.ini|thumbs\.db|\.ds_store)$|\.(?:psd|tmp)$/i;
const FONT = /^themes\/shared\/fonts\/[^/]+\.(?:ttf|otf|woff2?)$/i;
// 只有本机的 tools/check-lxns.cjs 用，服务器用不上。个人 API 密钥还能改写你自己的成绩，更不该带出去
const LOCAL_ONLY_ENV = ["LXNS_USER_TOKEN", "LXNS_FRIEND_CODE"];

// 这两个字符用 fromCharCode 写：源码里写成 \u 转义的话，经过命令行或编辑工具时容易被换成字符本身，肉眼看不出来
const NUL = String.fromCharCode(0);
const BOM = String.fromCharCode(0xfeff);

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const day = (d) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
const mb = (bytes) => (bytes / 1048576).toFixed(1) + " MB";

function gitFiles(root, dirs) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...dirs],
    { cwd: root, encoding: "utf8", windowsHide: true }).split(NUL).filter(Boolean);
}

function gitInfo(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  try {
    return { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--", ...PROGRAM_DIRS, ...TOP_FILES) !== "" };
  } catch {
    return { commit: "", dirty: false };
  }
}

// rel 目录下所有文件（相对 root、用 / 分隔）
function walk(root, rel) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const child = rel + "/" + entry.name;
    return entry.isDirectory() ? walk(root, child) : entry.isFile() ? [child] : [];
  });
}

// fonts.css 里每个 @font-face 的字体名，和它 url() 里的文件名
function fontFaces(css) {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
    family: (/font-family:\s*["']?([^"';]+)/.exec(body)?.[1] || "").trim(),
    files: [...body.matchAll(/url\(\s*["']?([^"')]+)/g)].map((match) => path.posix.basename(match[1])),
  }));
}

// 字体文件只留用得到的：fonts.css 给它起的名字（比如 "Anna Hand"）或者文件名本身，在主题、代码里出现过。
// 浏览器只下载页面真用到的字体，没用到的放在包里也只是占地方。
function usedFonts(fontFiles, fontsCss, sources) {
  const faces = fontFaces(fontsCss);
  return fontFiles.filter((file) => {
    const base = path.posix.basename(file);
    return sources.includes(base) || faces.some((face) => face.family && face.files.includes(base) && sources.includes(face.family));
  });
}

// node_modules 里的运行依赖：package.json 的 dependencies，连同它们自己的依赖（npm 把依赖平铺在顶层）
function runtimeDeps(root) {
  const files = [];
  const seen = new Set();
  const depsOf = (file) => Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).dependencies || {});
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const pkg = path.join(root, "node_modules", name, "package.json");
    if (!fs.existsSync(pkg)) throw new Error("node_modules 里没有 " + name + "：先 npm install");
    files.push(...walk(root, "node_modules/" + name));
    depsOf(pkg).forEach(visit);
  };
  depsOf(path.join(root, "package.json")).forEach(visit);
  return files;
}

function programFiles(root, { listFiles = gitFiles } = {}) {
  // 删了还没提交的，git 还会列出来，跳过
  const listed = listFiles(root, PROGRAM_DIRS).filter((rel) => fs.existsSync(path.join(root, rel)));
  const assets = walk(root, "themes").filter((rel) => ASSET.test(rel));
  let files = [...new Set([...listed, ...assets])].filter((rel) => !JUNK.test(rel));
  const fontsCss = path.join(root, "themes", "shared", "fonts.css");
  if (fs.existsSync(fontsCss)) {
    const sources = files.filter((rel) => /^(?:src|themes)\/.+\.(?:c?js|mjs|css|html)$/i.test(rel) && rel !== "themes/shared/fonts.css")
      .map((rel) => fs.readFileSync(path.join(root, rel), "utf8")).join("\n");
    const used = new Set(usedFonts(files.filter((rel) => FONT.test(rel)), fs.readFileSync(fontsCss, "utf8"), sources));
    files = files.filter((rel) => !FONT.test(rel) || used.has(rel));
  }
  return [...files, ...TOP_FILES.filter((rel) => fs.existsSync(path.join(root, rel))), ...runtimeDeps(root)].sort();
}

// 打完整包前本机的 Anna 得停着（见文件开头）
async function assertStopped(root, findRunning = findAnna) {
  if (process.platform !== "win32" || !findRunning) return;
  const running = await findRunning({ root });
  if (!running.length) return;
  throw new Error("本机的 Anna 还开着（进程 " + running.map((proc) => proc.pid).join("、") + "），先 npm stop 停掉再打完整包。\n" +
    "  落雪的刷新令牌一刷新就换新、旧的立刻作废：打包以后这边再刷新一次，服务器上那份就失效了，那个人得重新 /授权。\n" +
    "  所以完整包打好以后，本机的 Anna 就别再开了。只想更新服务器上的程序，用 npm run package:update。");
}

// .env 的值：普通的原样写，带空格、# 这类字符的加引号
function envValue(value) {
  if (/^[\w.~+/=:@-]*$/.test(value)) return value;
  return value.includes("'") ? "\"" + value + "\"" : "'" + value + "'";
}

// 包里的 .env：照 .env.example（template）的样子、带着注释填上本机的值，换上导出的主密钥，去掉只有本机用的
function packagedEnv(template, env, key) {
  const values = { ...env, ANNA_VAULT_KEY: key.toString("base64") };
  for (const name of LOCAL_ONLY_ENV) delete values[name];
  const seen = new Set();
  const lines = template.split(/\r?\n/).map((line) => {
    const name = /^([A-Za-z_]\w*)=/.exec(line)?.[1];
    if (!name) return line;
    seen.add(name);
    return name + "=" + envValue(values[name] ?? "");
  });
  const extra = Object.keys(values).filter((name) => !seen.has(name) && values[name] !== "");
  if (extra.length) lines.push("# ── 本机 .env 里另外写的 ──", ...extra.map((name) => name + "=" + envValue(values[name])), "");
  const text = "# 安装包生成：值来自打包那台电脑的 .env，ANNA_VAULT_KEY 是打包时导出的绑定库主密钥。\n" + lines.join("\n");
  // 写好再读一遍对一对：值里有引号这类字符写坏了的话，宁可不打包，也别让服务器拿到一份读错的密钥
  const back = parseEnv(text);
  for (const [name, value] of Object.entries(values)) {
    if ((back[name] ?? "") !== value) throw new Error(".env 里 " + name + " 的值没法原样写进安装包（里面有引号之类的字符？）");
  }
  return text;
}

async function personalFiles(root, { findRunning, template } = {}) {
  await assertStopped(root, findRunning);
  const envFile = path.join(root, ".env");
  if (!fs.existsSync(envFile)) throw new Error("本机没有 .env，打不了完整包（完整包要带上密钥）。只打程序用 npm run package:update");
  const env = parseEnv(fs.readFileSync(envFile, "utf8"));
  // 用要装过去的这份配置检查一遍：缺密钥、群白名单是空的，到服务器上一样起不来
  const config = loadConfig({ root, env });
  if (config.workDir !== path.join(root, "data")) throw new Error("config.local.json 的 workDir 不是默认的 ./data：安装包只认 data/，先改回去再打包");

  const vaultFile = path.join(config.workDir, "bindings.enc");
  let key;
  let bindings = 0;
  if (fs.existsSync(vaultFile)) {
    ({ key } = await loadMasterKey({ envKey: config.vaultKey, keyFile: path.join(config.workDir, "vault.key"), vaultFile }));
    bindings = (await openVault({ file: vaultFile, key })).size;
  } else {
    // 还没人绑定过：服务器上从一把新的主密钥开始（不在本机生成 vault.key）
    key = config.vaultKey ? keyFromBase64(config.vaultKey, "ANNA_VAULT_KEY") : crypto.randomBytes(32);
  }

  const entries = [
    { path: "personal/.env", data: Buffer.from(packagedEnv(template, env, key), "utf8") },
    { path: "personal/config.local.json", source: path.join(root, "config.local.json") },
  ];
  if (fs.existsSync(vaultFile)) entries.push({ path: "personal/data/bindings.enc", source: vaultFile });
  // 曲库和素材缓存也带上：落雪的素材服务器慢还限频，服务器第一次出 B50 不用再现下 50 张曲绘（要等 40 秒左右）。
  // vault.key（拷过去也解不开）、logs/、try/（npm run try 的试跑数据）不带。
  const cache = walk(root, "data/cache").filter((rel) => !JUNK.test(rel));
  for (const rel of cache) entries.push({ path: "personal/" + rel, source: path.join(root, rel) });
  return { entries, bindings, cacheFiles: cache.length };
}

// ── zip ──────────────────────────────────────────────────────────────
// 极简的 zip 写入（deflate），只为打包用。文件名按 UTF-8 存，打上 UTF-8 标志（第 11 位），路径用 /：
// 资源管理器的「全部解压缩」、Expand-Archive 都认这个标志。不打的话中文文件名在非中文系统上会乱码
// （MiaBot 的 tools/zip-server-update.ps1 说明了 bsdtar 的这个坑）。
// 不支持 zip64：单个文件和整个包都要小于 4 GB、文件少于 65535 个，Anna 的包远远到不了。

const crc32 = zlib.crc32 || ((data) => {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
});

function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function createZip(file) {
  const fd = fs.openSync(file, "w");
  const central = [];
  let offset = 0;
  const write = (buffer) => { fs.writeSync(fd, buffer); offset += buffer.length; };
  return {
    add(name, data, mtime = new Date()) {
      const nameBytes = Buffer.from(name, "utf8");
      const deflated = zlib.deflateRawSync(data);
      const stored = deflated.length >= data.length;   // 压不小的（已经压过的图片）就原样存
      const body = stored ? data : deflated;
      const entry = { nameBytes, method: stored ? 0 : 8, ...dosTime(mtime), crc: crc32(data), compressed: body.length, size: data.length, offset };
      if (offset + 30 + nameBytes.length + body.length > 0xffffffff || central.length >= 0xffff) throw new Error("包太大了，这个 zip 写法不支持");
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);                  // 解压需要 2.0
      header.writeUInt16LE(0x0800, 6);              // 文件名是 UTF-8
      header.writeUInt16LE(entry.method, 8);
      header.writeUInt16LE(entry.time, 10);
      header.writeUInt16LE(entry.date, 12);
      header.writeUInt32LE(entry.crc, 14);
      header.writeUInt32LE(entry.compressed, 18);
      header.writeUInt32LE(entry.size, 22);
      header.writeUInt16LE(nameBytes.length, 26);
      write(header);
      write(nameBytes);
      write(body);
      central.push(entry);
    },
    close() {
      const start = offset;
      for (const entry of central) {
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4);                // 写入方：2.0，MS-DOS
        header.writeUInt16LE(20, 6);
        header.writeUInt16LE(0x0800, 8);
        header.writeUInt16LE(entry.method, 10);
        header.writeUInt16LE(entry.time, 12);
        header.writeUInt16LE(entry.date, 14);
        header.writeUInt32LE(entry.crc, 16);
        header.writeUInt32LE(entry.compressed, 20);
        header.writeUInt32LE(entry.size, 24);
        header.writeUInt16LE(entry.nameBytes.length, 28);
        header.writeUInt32LE(0x20, 38);             // 普通文件（存档位）
        header.writeUInt32LE(entry.offset, 42);
        write(header);
        write(entry.nameBytes);
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(central.length, 8);
      end.writeUInt16LE(central.length, 10);
      end.writeUInt32LE(offset - start, 12);
      end.writeUInt32LE(start, 16);
      write(end);
      fs.closeSync(fd);
    },
    abort() {
      try { fs.closeSync(fd); } catch { /* 已经关了 */ }
      fs.rmSync(file, { force: true });
    },
  };
}

// ── 包里的两个说明性文件 ──────────────────────────────────────────────

// 安装Anna.cmd：只是个壳，检查有没有 node、包解压了没有，然后交给 app/tools/install.cjs，中文的提示都由它打印。
// 这个文件必须是纯 ASCII：cmd 按控制台代码页读 .cmd，中文写在里面会乱码。所以没装 Node、没解压这两种情况只能用英文说。
// 里面也不能调 PowerShell：2026-10-15 本机实测，带 powershell -EncodedCommand 的 .cmd 一运行就被杀毒软件
// （火绒 / 腾讯电脑管家）当病毒删掉了。Node 运行时调 PowerShell 没事（vault.cjs、background.cjs 一直这么用）。
function installCmd() {
  return [
    "@echo off",
    "rem Anna installer, written by tools/build-package.cjs. Keep this file ASCII (cmd.exe reads it in the console",
    "rem code page) and keep PowerShell out of it (antivirus deletes batch files that run powershell -EncodedCommand).",
    "setlocal",
    "where node >nul 2>nul",
    "if errorlevel 1 goto nonode",
    "if not exist \"%~dp0app\\tools\\install.cjs\" goto unpacked",
    "node \"%~dp0app\\tools\\install.cjs\" %*",
    "set \"CODE=%ERRORLEVEL%\"",
    "echo.",
    "pause",
    "exit /b %CODE%",
    ":nonode",
    "echo Node.js was not found. Install Node.js 22 or newer first: https://nodejs.org (LTS, keep \"Add to PATH\" checked),",
    "echo then double-click this file again. If you still see this message after installing, sign out and sign back in.",
    "echo.",
    "pause",
    "exit /b 1",
    ":unpacked",
    "echo This package is not fully extracted. Right-click the zip, choose \"Extract All\", then double-click this file",
    "echo inside the extracted folder.",
    "echo.",
    "pause",
    "exit /b 1",
    "",
  ].join("\r\n");
}

function deployGuide(manifest, { zip = true } = {}) {
  const full = manifest.kind === "install";
  const lines = [
    "Anna 部署说明（" + manifest.name + "）",
    "",
    full
      ? "这是完整安装包：程序 + 配置、密钥、绑定数据（" + manifest.personal.bindings + " 人）、曲库和素材缓存。第一次部署、搬服务器用。"
      : "这是更新包：只有程序，不带配置和数据。服务器上已经装过 Anna 才能用。",
    "",
    ...((manifest.notes || []).length ? ["本次更新", ...manifest.notes.map((note) => "  · " + note), ""] : []),
    "一、服务器要什么",
    "  · Windows 64 位。Windows Server 2019 / 2022 要选「带桌面体验」的镜像（Server Core 没有浏览器，出不了图）",
    "  · Node.js 22 或更新：https://nodejs.org 下载 LTS 的 Windows 安装包（.msi），安装时勾上 Add to PATH",
    "  · Chrome 或 Edge（出图用）。Windows Server 2022、Windows 10/11 自带 Edge，不用另装",
    "  · 和 MiaBot 放在同一台服务器上也行，两个机器人互不影响",
    "",
    "二、安装（更新也是这样）",
    zip
      ? "  1. 把 zip 拷到服务器（远程桌面里直接复制粘贴），右键 →「全部解压缩」"
      : "  1. 把整个安装包文件夹拷到服务器（远程桌面里直接复制粘贴），里面就是安装包",
    "  2. 双击" + (zip ? "解压出来的" : "文件夹里的") + "「安装Anna.cmd」。默认装到 " + DEFAULT_TARGET + "；想装到别处，在命令行里运行：安装Anna.cmd D:\\AnnaBot",
    "  3. 等它跑完，最后显示「连上 QQ 了」就是好了",
    "  它会依次：核对安装包 → 检查 Node、浏览器、字体 → 停掉正在跑的 Anna → 换程序 → 放配置和数据（服务器上已经有的不动）",
    "  → 设开机自启 → 启动 Anna，等它连上 QQ。",
    "  开机自启要管理员权限：用 Administrator 登录的云服务器默认就有；没有的话右键「安装Anna.cmd」→「以管理员身份运行」。",
    "",
  ];
  if (full) {
    lines.push(
      "三、第一次部署（从自己电脑搬过来）",
      "  · 自己电脑上的 Anna 打包前已经停了，以后别再开：同一个机器人连两次，每句话会回两遍；",
      "    那边再刷新一次落雪的授权令牌，服务器上对应的人就得重新 /授权。自己电脑设了开机启动 Anna 的话，记得去掉。",
      "  · 装好后到群里 @Anna 发 /状态 和 /b50，图出得来就全通了（安装程序就是用开机自启的计划任务启动的，跟重启后一样）。",
      "  · 这个包里有 QQ 机器人密钥、落雪密钥、绑定库主密钥和所有人的绑定：别放网盘、别发群里。装好以后把" +
        (zip ? " zip 和解压出来的文件夹" : "安装包文件夹") + "删掉。",
      "",
    );
  }
  lines.push(
    (full ? "四" : "三") + "、平时",
    "  · 日志：安装目录\\data\\logs\\anna-日期.log；起不来的报错在同一个目录的 stderr.log",
    "  · 重启：双击安装目录里的「停止Anna.vbs」，再双击「启动Anna.vbs」。设了开机自启时它会交给计划任务 " + TASK_NAME + " 去启动，",
    "    注销远程桌面也不影响。改了 .env、config.local.json 都要重启才生效",
    "  · 服务器重启以后 Anna 自己会起来（开机 30 秒后）",
    "",
    (full ? "五" : "四") + "、更新",
    "  在自己电脑上 npm run package:update 打更新包，" + (zip ? "拷过来解压" : "拷过来") + "，同样双击「安装Anna.cmd」。",
    "  它会先停掉 Anna，换完程序再启动；.env、config.local.json、data 都不动。",
    "  更新后连上 QQ 会向白名单群主动发送更新日志，需开启群内「机器人主动在群聊内发言」并具备平台权限。",
    "  主动发送失败时等下一条可回复消息触发补发（未开接收全部消息时需 @Anna）；发送成功后不重复发。",
    "  QQ 输入框里打 / 弹出的指令清单，Anna 启动时会自己更新，不用另外操作。",
    "  回退：把上一个安装包或更新包再装一遍。",
    "",
    (full ? "六" : "五") + "、不用了",
    "  双击「停止Anna.vbs」，在管理员命令行里运行 schtasks /Delete /TN " + TASK_NAME + " /F 去掉开机自启，再删掉安装目录。",
    "",
    (full ? "七" : "六") + "、出了问题",
    "  · 提示没找到 Node.js：装完 Node 后注销重新登录一次",
    "  · 「绑定库解不开」：.env 里的 ANNA_VAULT_KEY 跟 data\\bindings.enc 不是一对。别删绑定库，用打包时那份 .env 里的 ANNA_VAULT_KEY",
    "  · 能回话、出不了图：日志里找「没找到 Chrome 或 Edge」，装个 Chrome，或者在 config.local.json 的 browserPath 写上浏览器路径",
    "  · 每句话回两遍：有两个 Anna 连着同一个机器人，多半是自己电脑上的还开着",
    "  · 服务器上的绑定库主密钥写在 .env 的 ANNA_VAULT_KEY 里，没用 DPAPI：开机自启的计划任务用不了 DPAPI，",
    "    云服务器在控制台重置密码也会让 DPAPI 封的东西再也解不开。所以安装目录要按敏感文件对待。",
    "",
  );
  return lines.join("\n");
}

// ── 打包 ──────────────────────────────────────────────────────────────

// 返回 { name, zipFile, folderDir, manifest, bytes, zipBytes }。filter 只给测试用（不想每次都拷 25 MB 的字体）。
async function buildPackage({
  root = ROOT, personalRoot = root, kind = "install", outDir = path.join(root, "dist"), zip = true, folder = false,
  listFiles, findRunning, filter = () => true, now = new Date(), git = gitInfo,
} = {}) {
  if (kind !== "install" && kind !== "update") throw new Error("kind 只能是 install 或 update");
  const { commit, dirty } = git(root);
  const notesFile = path.join(root, "src", "data", "update-notes.json");
  const notes = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, "utf8")) : [];
  if (!Array.isArray(notes) || notes.some((note) => typeof note !== "string" || !note.trim()) || notes.join("\n").length > 1500) {
    throw new Error("src/data/update-notes.json 要写成非空文字组成的数组，总长度不超过 1500 字");
  }
  const version = day(now) + "-" + (commit ? commit.slice(0, 7) : "nogit") + (dirty ? "-dirty" : "");
  const name = "AnnaBot-" + kind + "-" + version;
  const entries = programFiles(root, { listFiles }).filter(filter).map((rel) => ({ path: "app/" + rel, source: path.join(root, rel) }));
  const personal = kind === "install"
    ? await personalFiles(personalRoot, { findRunning, template: fs.readFileSync(path.join(root, ".env.example"), "utf8") })
    : null;
  if (personal) entries.push(...personal.entries);

  fs.mkdirSync(outDir, { recursive: true });
  const folderDir = folder ? path.join(outDir, name) : null;
  if (folderDir && fs.existsSync(folderDir)) {
    // 只删自己打的（有 manifest.json），别的同名目录不碰
    if (!fs.existsSync(path.join(folderDir, "manifest.json"))) throw new Error("输出目录里已经有别的东西：" + folderDir);
    fs.rmSync(folderDir, { recursive: true, force: true });
  }
  const zipFile = zip ? path.join(outDir, name + ".zip") : null;
  const archive = zipFile ? createZip(zipFile) : null;
  const put = (rel, data, mtime) => {
    archive?.add(name + "/" + rel, data, mtime);
    if (!folderDir) return;
    const file = path.join(folderDir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };

  try {
    const files = [];
    let bytes = 0;
    for (const entry of entries) {
      const data = entry.data || fs.readFileSync(entry.source);
      put(entry.path, data, entry.source ? fs.statSync(entry.source).mtime : now);
      files.push({ path: entry.path, bytes: data.length, sha256: sha256(data) });
      bytes += data.length;
    }
    const manifest = {
      name, kind, version, commit, dirty, builtAt: now.toISOString(), node: ">=22", notes,
      personal: personal && { bindings: personal.bindings, cacheFiles: personal.cacheFiles },
      files,
    };
    put("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"), now);
    put("安装Anna.cmd", Buffer.from(installCmd(), "utf8"), now);
    put("部署说明.txt", Buffer.from(BOM + deployGuide(manifest, { zip: Boolean(zipFile) }).replace(/\n/g, "\r\n"), "utf8"), now);
    archive?.close();
    return { name, zipFile, folderDir, manifest, bytes, zipBytes: zipFile ? fs.statSync(zipFile).size : 0 };
  } catch (error) {
    archive?.abort();
    throw error;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((arg) => !["--update", "--skip-tests", "--folder", "--no-zip"].includes(arg));
  if (unknown.length) throw new Error("不认识的参数：" + unknown.join(" ") + "\n用法：npm run package [-- --skip-tests] [--folder] [--no-zip]；只打程序：npm run package:update");
  const kind = argv.includes("--update") ? "update" : "install";
  const zip = !argv.includes("--no-zip");
  const folder = !zip || argv.includes("--folder");   // 只出文件夹时 --folder 是必须的
  if (kind === "install") await assertStopped(ROOT);   // 先查这个，别白跑一遍测试
  if (!argv.includes("--skip-tests")) {
    console.log("先跑一遍测试（npm test）…");
    const tests = spawnSync(process.execPath, ["--test", "--test-timeout=90000", "test/*.test.cjs"], { cwd: ROOT, stdio: "inherit", windowsHide: true });
    if (tests.status !== 0) throw new Error("测试没过，不打包。");
  }
  const result = await buildPackage({ kind, zip, folder });
  const { manifest } = result;
  const app = manifest.files.filter((file) => file.path.startsWith("app/")).length;
  console.log("");
  const where = result.zipFile || result.folderDir;
  console.log("打好了" + (result.zipFile ? "：" : "文件夹：") + path.relative(ROOT, where) + "（" +
    mb(result.zipFile ? result.zipBytes : result.bytes) + "，程序 " + app + " 个文件" +
    (manifest.personal ? "，配置和数据 " + (manifest.files.length - app) + " 个文件）" : "；不带配置和数据）"));
  if (result.zipFile && result.folderDir) console.log("解开的一份在 " + path.relative(ROOT, result.folderDir));
  if (manifest.dirty) console.log("⚠ 有没提交的改动：包里是磁盘上现在的代码，版本号带 -dirty。");
  if (manifest.personal) {
    console.log("  绑定库 " + manifest.personal.bindings + " 人，曲库和素材缓存 " + manifest.personal.cacheFiles + " 个文件；主密钥写进了包里的 .env");
    console.log("⚠ 包里有 QQ 机器人密钥、落雪密钥、绑定库主密钥和所有人的绑定：别放网盘、别发群里，用远程桌面直接拷到服务器。");
    console.log("⚠ 本机的 Anna 从现在起别再开：包里的授权令牌是现在这份，这边再刷新一次，服务器上对应的就失效了。");
    console.log("下一步：" + (zip ? "把 zip 拷到服务器，解压" : "把整个文件夹拷到服务器") + "，双击「安装Anna.cmd」。详细步骤见包里的「部署说明.txt」。");
  } else {
    console.log("下一步：拷到服务器" + (zip ? "解压，" : "，") + "双击「安装Anna.cmd」：先停掉 Anna、换程序、再启动，配置和数据不动。");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("打包失败：" + (error?.message || error));
    process.exit(1);
  });
}

module.exports = { buildPackage, programFiles, usedFonts, fontFaces, packagedEnv, createZip, installCmd, deployGuide, LOCAL_ONLY_ENV };
