#!/usr/bin/env node
"use strict";
// 服务器上的安装程序。tools/build-package.cjs 打的包解压后，双击「安装Anna.cmd」跑的就是它（包里的 app/tools/install.cjs）。
//
// 用法：安装Anna.cmd [安装目录，默认 C:\AnnaBot] [--check] [--no-autostart] [--no-start]
//   --check         只检查安装包和这台电脑，什么都不改
//   --no-autostart  不设开机自启（已经设了的会去掉）
//   --no-start      装完不启动
//
// 全新安装和更新走同一套：
//   1. 按 manifest.json 逐个核对文件。没解压完、在压缩包预览里直接双击、传坏了，都在这一步拦下，这时什么都还没动
//   2. 看这台电脑：Node 版本、Chrome / Edge、字体
//   3. 停掉安装目录里正在跑的 Anna：换文件时它不能开着
//   4. 换程序：app/ 先整个拷到安装目录下的 .anna-new/，再把 src/ themes/ tools/ node_modules/ 这些逐个换过去，
//      中途失败就把换过去的换回来，不会留下一半新一半旧的程序。旧版本多出来的文件跟着整个目录一起去掉
//   5. 配置和数据（完整包才有）：服务器上没有的才放，已经有的一律不动 —— 服务器上的绑定库比包里的新
//   6. 用装好的配置跑一遍 loadConfig、用主密钥解一遍绑定库；生成「启动Anna.vbs」「停止Anna.vbs」
//   7. 开机自启：计划任务 AnnaBot，开机后以当前用户的身份运行，没人登录也跑（S4U：不存密码）。要管理员权限，没有就跳过
//   8. 启动 Anna，等它连上 QQ 网关（tools/background.cjs 的 start：有计划任务就交给计划任务启动）
//
// 服务器上的绑定库主密钥写在 .env 的 ANNA_VAULT_KEY 里，不用 DPAPI（.env 里没有的话，第 6 步会补上）：
//   - S4U 的计划任务拿不到用户的密码，DPAPI 在那里解不开
//   - 云服务器在控制台「重置密码」是强制重置，DPAPI 封过的东西从此再也解不开，所有人的绑定跟着没了
// .env 里本来就有 AppSecret 和落雪密钥，安装目录本来就得按敏感文件对待。

// 先查 Node 版本：太旧的 Node 连下面的模块都加载不了，报出来的错看不出原因
if (require.main === module && Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Node.js 版本太旧（" + process.version + "）：Anna 要 22 或更新的版本。到 https://nodejs.org 下载 LTS 装上，再双击「安装Anna.cmd」。");
  process.exit(1);
}

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { loadConfig } = require("../src/config.cjs");
const { loadMasterKey, openVault, keyFromBase64 } = require("../src/vault.cjs");
const { findBrowser } = require("../src/renderer.cjs");
const { createLog } = require("../src/log.cjs");
const background = require("./background.cjs");
const { writeLaunchers } = require("./make-launchers.cjs");

const PACKAGE = path.resolve(__dirname, "..", "..");
const DEFAULT_TARGET = "C:\\AnnaBot";
// 服务器自己的东西，换程序时绝不能碰。包里的 app/ 不该有这几个（打包脚本不会放），这里再挡一道
const OWN = new Set([".env", "config.local.json", "data"]);
// 出图用到的 Windows 自带字体：fonts.css 的 Anna Script（分数、定数、格言），best 主题里的符号
const FONTS = [["segoesc.ttf", "Segoe Script"], ["segoescb.ttf", "Segoe Script Bold"], ["seguisym.ttf", "Segoe UI Symbol"], ["seguihis.ttf", "Segoe UI Historic"]];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => fs.existsSync(file);
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
const rmrf = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

// 1. 按清单核对安装包
function readPackage(dir) {
  const manifestFile = path.join(dir, "manifest.json");
  if (!exists(manifestFile)) throw new Error("找不到 manifest.json：这个脚本要在解压出来的安装包里运行（双击包里的「安装Anna.cmd」）");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const bad = [];
  for (const file of manifest.files) {
    if (!/^(?:app|personal)\/./.test(file.path) || file.path.split("/").includes("..")) throw new Error("安装包的清单不对：" + file.path);
    let data;
    try { data = fs.readFileSync(path.join(dir, file.path)); } catch { bad.push(file.path + "（缺了）"); continue; }
    if (data.length !== file.bytes || sha256(data) !== file.sha256) bad.push(file.path + "（内容对不上）");
  }
  if (bad.length) {
    throw new Error("安装包不完整或者传坏了（" + bad.length + " 个文件）：\n" + bad.slice(0, 8).join("\n") + (bad.length > 8 ? "\n…" : "") +
      "\n重新解压一遍，还不行就重新拷一份安装包。什么都还没改。");
  }
  const app = manifest.files.filter((file) => file.path.startsWith("app/"));
  const personal = manifest.files.filter((file) => file.path.startsWith("personal/"));
  const own = app.find((file) => OWN.has(file.path.split("/")[1]));
  if (own) throw new Error("安装包的程序部分里不该有 " + own.path);
  if (!app.some((file) => file.path === "app/src/main.cjs")) throw new Error("安装包里没有程序（app/src/main.cjs）");
  return { manifest, app, personal };
}

// 2. 这台电脑
function checkMachine({ platform = process.platform, fontsDir = path.join(process.env.WINDIR || "C:\\Windows", "Fonts") } = {}) {
  const lines = [{ ok: true, text: "Node.js " + process.version }];
  const browser = findBrowser();
  lines.push(browser
    ? { ok: true, text: "浏览器：" + browser }
    : { ok: false, text: "没找到 Chrome 或 Edge：能回话，但出不了图。装一个 Chrome，或者在 config.local.json 的 browserPath 写上浏览器的路径" });
  if (platform === "win32") {
    const missing = FONTS.filter(([file]) => !exists(path.join(fontsDir, file))).map(([, name]) => name);
    lines.push(missing.length
      ? { ok: false, text: "缺字体 " + missing.join("、") + "：图里的分数、定数会换成别的字体显示" }
      : { ok: true, text: "字体：Segoe Script、Segoe UI Symbol 这几个都在" });
  }
  return lines;
}

// 安装目录里现在是什么。只有程序会被整个换掉，所以只看 app/ 顶层的名字（src、themes、package.json…）会不会撞上别人的东西；
// 配置和数据只在没有时才放，撞不坏。
function inspectTarget(target, app) {
  const names = new Set(app.map((file) => file.path.split("/")[1]));
  const anna = exists(path.join(target, "version.json")) || (exists(path.join(target, "src", "main.cjs")) && exists(path.join(target, "src", "vault.cjs")));
  const clash = exists(target) ? fs.readdirSync(target).filter((name) => names.has(name)) : [];
  if (!anna && clash.length) {
    throw new Error(target + " 里已经有别的东西（" + clash.join("、") + "），看着不像 Anna 的安装目录。换一个空目录，或者确认里面的东西没用了先清空。");
  }
  let installed = null;
  try { installed = JSON.parse(fs.readFileSync(path.join(target, "version.json"), "utf8")); } catch { /* 第一次装，或者是手动拷过去的 */ }
  return { fresh: !anna, installed, names };
}

// 杀毒软件正在扫刚拷进来的文件时，Windows 上改名会报 EPERM / EBUSY，等一下再试
async function renameRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= 20 || !["EPERM", "EBUSY", "EACCES"].includes(error?.code)) throw error;
      await sleep(250);
    }
  }
}

// 4. 换程序
async function installProgram({ packageDir, target, app }) {
  const stage = path.join(target, ".anna-new");
  const old = path.join(target, ".anna-old");
  fs.mkdirSync(target, { recursive: true });
  rmrf(stage);   // 上次中断留下的
  rmrf(old);
  for (const file of app) {
    const to = path.join(stage, ...file.path.split("/").slice(1));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(packageDir, file.path), to);
  }
  fs.mkdirSync(old);
  const steps = [];
  try {
    for (const name of fs.readdirSync(stage)) {
      const step = { name, hadOld: exists(path.join(target, name)), moved: false };
      steps.push(step);
      if (step.hadOld) await renameRetry(path.join(target, name), path.join(old, name));
      await renameRetry(path.join(stage, name), path.join(target, name));
      step.moved = true;
    }
  } catch (error) {
    for (const step of steps.reverse()) {
      try {
        if (step.moved) await renameRetry(path.join(target, step.name), path.join(stage, step.name));
        if (step.hadOld && exists(path.join(old, step.name))) await renameRetry(path.join(old, step.name), path.join(target, step.name));
      } catch { /* 换不回去的还在 .anna-old 里，下面的报错会说 */ }
    }
    throw new Error("换程序文件失败，已经换回原来的了：" + error.message + "\n（要是还缺东西，原来的文件在 " + old + " 里）");
  }
  // 删不掉就留着（多半是杀毒软件还拿着），下次安装会先清
  try { rmrf(old); rmrf(stage); } catch { /* 留着 */ }
}

// 5. 配置和数据：服务器上没有的才放
function installPersonal({ packageDir, target, personal }) {
  const added = [];
  const kept = [];
  for (const file of personal) {
    const rel = file.path.slice("personal/".length);
    const to = path.join(target, ...rel.split("/"));
    if (exists(to)) { kept.push(rel); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(packageDir, file.path), to);
    added.push(rel);
  }
  return { added, kept };
}

function describe(rels) {
  const cache = rels.filter((rel) => rel.startsWith("data/cache/")).length;
  const named = rels.filter((rel) => !rel.startsWith("data/cache/")).map((rel) => (rel === "data/bindings.enc" ? "绑定库" : rel));
  return [...named, ...(cache ? ["曲库和素材缓存（" + cache + " 个文件）"] : [])].join("、");
}

// .env 里改一个值（没有这一行就加在最后），别的行原样留着
function setEnvValue(file, name, value) {
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const line = new RegExp("^" + name + "=.*$", "m");
  fs.writeFileSync(file, line.test(text) ? text.replace(line, () => name + "=" + value) : text.replace(/\s*$/, "") + eol + name + "=" + value + eol);
}

// 6. 用装好的配置检查一遍。problems 是起不来的问题，warnings 是起得来但有功能用不了
async function checkConfig(target, { protector } = {}) {
  const result = { config: null, bindings: null, notes: [], warnings: [], problems: [] };
  const missing = [".env", "config.local.json"].filter((name) => !exists(path.join(target, name)));
  if (missing.length) {
    result.problems.push("缺 " + missing.join("、") + "：在安装目录里照着 .env.example、config.example.json 复制一份填好（或者装一遍完整包），" +
      "再双击「启动Anna.vbs」");
    return result;
  }
  const envFile = path.join(target, ".env");
  let config;
  try { config = loadConfig({ root: target, env: parseEnv(fs.readFileSync(envFile, "utf8")) }); } catch (error) {
    result.problems.push(error.message);
    return result;
  }
  const vaultFile = path.join(config.workDir, "bindings.enc");
  const keyFile = path.join(config.workDir, "vault.key");
  if (!config.vaultKey) {
    let key = null;
    if (exists(keyFile)) {
      // 以前在这台机器上用 DPAPI 跑过：现在是安装的人自己登录着，解得开，趁现在转写进 .env
      try { ({ key } = await loadMasterKey({ keyFile, vaultFile, ...(protector ? { protector } : {}) })); } catch (error) {
        result.problems.push(error.message);
        return result;
      }
      result.notes.push("主密钥从 data\\vault.key（DPAPI）转写进了 .env 的 ANNA_VAULT_KEY：开机自启的计划任务用不了 DPAPI");
    } else if (exists(vaultFile)) {
      result.problems.push("有绑定库 " + vaultFile + "，但 .env 里没有 ANNA_VAULT_KEY、也没有 vault.key，解不开。把打包时那份 .env 里的 ANNA_VAULT_KEY 加回来");
      return result;
    } else {
      key = crypto.randomBytes(32);
      result.notes.push("生成了绑定库主密钥，写在 .env 的 ANNA_VAULT_KEY");
    }
    setEnvValue(envFile, "ANNA_VAULT_KEY", key.toString("base64"));
    config.vaultKey = key.toString("base64");
  }
  if (exists(vaultFile)) {
    try { result.bindings = (await openVault({ file: vaultFile, key: keyFromBase64(config.vaultKey, "ANNA_VAULT_KEY") })).size; } catch (error) {
      result.problems.push(error.message);
      return result;
    }
  }
  if (config.browserPath && !exists(config.browserPath)) {
    result.warnings.push("config.local.json 的 browserPath 在这台机器上不存在，出不了图：改成 \"\"（自动找），或者这台机器上的浏览器路径");
  }
  result.config = config;
  return result;
}

// 7. 开机自启 ─────────────────────────────────────────────────────────

// cmd /s /c 会去掉最外面那对引号，剩下的原样执行。Anna 起不来时报错只打在 stderr（见 background.cjs），接到 stderr.log
function taskCommand({ node, target, errLog }) {
  return "/d /s /c \"\"" + node + "\" \"" + path.join(target, "src", "main.cjs") + "\" 2>>\"" + errLog + "\"\"";
}

const ADMIN_CHECK = "if (-not ([Security.Principal.WindowsPrincipal]$me).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) " +
  "{ [Console]::Out.Write('not-admin'); exit 0 }";

function powershellTry(lines) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
    "try {",
    "  $me = [Security.Principal.WindowsIdentity]::GetCurrent()",
    ...lines.map((line) => "  " + line),
    "} catch { $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }; [Console]::Error.Write($e.Message); exit 1 }",
  ].join("\n");
}

// dryRun：只拼出任务、不注册，把要紧的设置打成 JSON（测试用，不用管理员权限，也不改系统）
function autostartScript({ node, target, errLog, dryRun = false }) {
  const q = background.psQuote;
  return powershellTry([
    ...(dryRun ? [] : [ADMIN_CHECK]),
    "$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument " + q(taskCommand({ node, target, errLog })) + " -WorkingDirectory " + q(target),
    // 开机等 30 秒再起：网络还没好的话，头几次连 QQ 网关、落雪都会失败（会自己重试，只是日志里一串报错）
    "$trigger = New-ScheduledTaskTrigger -AtStartup",
    "$trigger.Delay = 'PT30S'",
    // S4U：不存密码，没人登录也跑。代价是拿不到密码，DPAPI 用不了（所以主密钥放在 .env，见文件开头）
    "$principal = New-ScheduledTaskPrincipal -UserId $me.Name -LogonType S4U -RunLevel Limited",
    // 默认设置会在任务跑满 3 天时把它停掉（ExecutionTimeLimit = PT72H）。机器人要一直跑，改成不限时
    "$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew " +
      "-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)",
    "$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description " +
      q("Anna QQ 机器人（" + target + "），由安装程序 tools/install.cjs 注册"),
    ...(dryRun
      ? ["[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ user = $task.Principal.UserId; logon = [string]$task.Principal.LogonType; " +
          "limit = $task.Settings.ExecutionTimeLimit; multiple = [string]$task.Settings.MultipleInstances; " +
          "trigger = $task.Triggers[0].CimClass.CimClassName; delay = $task.Triggers[0].Delay; " +
          "execute = $task.Actions[0].Execute; arguments = $task.Actions[0].Arguments; dir = $task.Actions[0].WorkingDirectory }))"]
      : ["Register-ScheduledTask -TaskName " + q(background.TASK_NAME) + " -InputObject $task -Force | Out-Null", "[Console]::Out.Write('ok ' + $me.Name)"]),
  ]);
}

function removeTaskScript() {
  return powershellTry([ADMIN_CHECK, "Unregister-ScheduledTask -TaskName " + background.psQuote(background.TASK_NAME) + " -Confirm:$false", "[Console]::Out.Write('ok')"]);
}

async function setupAutostart({ target, config, enable, ps = background.powershell, find = background.scheduledTask.find }) {
  const name = background.TASK_NAME;
  if (!enable) {
    if (!(await find(target).catch(() => null))) return { ok: true, text: "没设（--no-autostart）" };
    const out = await ps(removeTaskScript(), { what: "去不掉计划任务 " + name });
    return out === "not-admin"
      ? { ok: false, text: "计划任务 " + name + " 还在：去掉它要管理员权限（右键「安装Anna.cmd」→「以管理员身份运行」）" }
      : { ok: true, text: "去掉了计划任务 " + name };
  }
  const errLog = path.join(config.workDir, "logs", background.STDERR_FILE);
  fs.mkdirSync(path.dirname(errLog), { recursive: true });
  const out = await ps(autostartScript({ node: process.execPath, target, errLog }), { what: "设不了开机自启" });
  if (out === "not-admin") return { ok: false, text: "没设：要管理员权限。右键「安装Anna.cmd」→「以管理员身份运行」，再装一遍就会设上" };
  return { ok: true, text: "计划任务 " + name + "，开机 30 秒后以 " + out.replace(/^ok /, "") + " 的身份运行，不用登录" };
}

// ── 安装 ──────────────────────────────────────────────────────────────

// 边装边往 out 打进度，返回 { code }：0 好了，1 失败，2 装好了但有要看一眼的。出错（还什么都没动、或者换回去了）就抛出来。
async function install({
  packageDir = PACKAGE, target = DEFAULT_TARGET, check = false, autostart = true, start = true,
  platform = process.platform, out = console.log, protector, fontsDir,
  findAnna = background.findAnna, stopAnna = background.stop, startAnna = background.start, setupTask = setupAutostart,
} = {}) {
  target = path.resolve(target);
  const say = (mark, text) => out("  " + mark + " " + String(text).replace(/\n/g, "\n    "));
  const pkg = readPackage(packageDir);
  const { manifest } = pkg;
  if (inside(target, packageDir)) throw new Error("安装目录不能在安装包里面：" + target);
  const where = inspectTarget(target, pkg.app);
  if (inside(packageDir, target) && where.names.has(path.relative(target, packageDir).split(path.sep)[0])) {
    throw new Error("安装包放在了安装目录里会被换掉的地方（" + packageDir + "），先挪到别处");
  }

  out("Anna 安装程序：" + manifest.name + (pkg.personal.length ? "（完整包：带配置、密钥和绑定数据）" : "（更新包：只有程序）"));
  out("安装到 " + target + "：" + (where.fresh ? "全新安装" : "更新" + (where.installed ? "（现在装的是 " + where.installed.version + "）" : "")));
  out("");
  say("√", "安装包：" + manifest.files.length + " 个文件，都核对过了");
  for (const line of checkMachine({ platform, fontsDir })) say(line.ok ? "√" : "!", line.text);
  if (check) {
    out("");
    out("只检查（--check），什么都没改。");
    return { code: 0 };
  }
  if (platform !== "win32") {
    throw new Error("一键安装只支持 Windows。别的系统：把 app/ 和 personal/ 里的东西合到一个目录，装好 Chrome，用 node src/main.cjs 启动");
  }

  if (!where.fresh) {
    const running = await findAnna({ root: target });
    if (running.length) {
      const stopped = await stopAnna({ root: target });
      if (stopped.code !== 0) throw new Error("停不掉正在运行的 Anna，没敢换文件：" + stopped.text);
      say("√", "停掉了正在运行的 Anna（进程 " + running.map((proc) => proc.pid).join("、") + "）");
    }
  }
  await installProgram({ packageDir, target, app: pkg.app });
  fs.writeFileSync(path.join(target, "version.json"), JSON.stringify({
    name: manifest.name, version: manifest.version, commit: manifest.commit, builtAt: manifest.builtAt,
    installedAt: new Date().toISOString(), previous: where.installed?.version || null,
    notifyUpdate: !where.fresh, notes: manifest.notes || [],
  }, null, 2) + "\n");
  say("√", "程序：" + (where.fresh ? "装好了" : "换成了 " + manifest.version) + "（" + pkg.app.length + " 个文件）");

  let placed = { added: [], kept: [] };
  if (pkg.personal.length) {
    placed = installPersonal({ packageDir, target, personal: pkg.personal });
    if (placed.added.length) say("√", "放好了 " + describe(placed.added));
    if (placed.kept.length) say("√", "服务器上已经有的没动：" + describe(placed.kept) + "（要换成包里的，先删掉服务器上的再装一遍）");
  }
  writeLaunchers(target);
  say("√", "启动器：启动Anna.vbs、停止Anna.vbs");

  const checked = await checkConfig(target, { protector });
  for (const note of checked.notes) say("√", note);
  for (const warning of checked.warnings) say("!", warning);
  if (checked.problems.length) {
    for (const problem of checked.problems) say("×", problem);
    out("");
    out("程序装好了，但配置还有问题（上面打 × 的）。改好以后双击安装目录里的「启动Anna.vbs」。");
    return { code: 2 };
  }
  say("√", checked.bindings === null ? "绑定库：还没有人绑定" : "绑定库：" + checked.bindings + " 人，主密钥对得上");
  // 记进 Anna 的日志：回头翻日志看得出什么时候装过哪个版本
  createLog({ dir: path.join(checked.config.workDir, "logs"), keepDays: checked.config.logKeepDays, out: { log() {} } })(
    "安装 " + manifest.name + (where.installed ? "（之前是 " + where.installed.version + "）" : where.fresh ? "（全新安装）" : ""));

  const task = await setupTask({ target, config: checked.config, enable: autostart }).catch((error) => ({ ok: false, text: error.message }));
  say(task.ok ? "√" : "!", "开机自启：" + task.text);

  let started = null;
  if (start) {
    started = await startAnna({ root: target });
    say(started.code === 0 ? "√" : started.code === 2 ? "!" : "×", "启动：" + started.text);
  }

  out("");
  out(!started ? "装好了，没有启动（--no-start）。" : started.code === 0 ? "装好了。到群里 @Anna 发 /状态、/b50 试一下。" : "装好了，但 Anna 还没起来，看上面的提示。");
  out("  安装目录 " + target + "：日志在 data\\logs\\；停止、启动 Anna 双击里面的「停止Anna.vbs」「启动Anna.vbs」");
  out("  以后更新：在自己电脑上 npm run package:update 打更新包，拷过来同样双击「安装Anna.cmd」");
  if (placed.added.includes(".env") || placed.added.includes("data/bindings.enc")) {
    out("  ! 自己电脑上的 Anna 别再开了：同一个机器人连两次，每句话会回两遍；那边再刷新一次落雪令牌，这边对应的人就得重新 /授权。");
    out("  ! 安装包里有密钥和所有人的绑定，装好以后把 zip 和解压出来的文件夹都删掉。");
  }
  if (started && started.code !== 0) return { code: started.code };
  return { code: task.ok && !checked.warnings.length ? 0 : 2 };
}

function parseArgs(argv) {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const unknown = flags.filter((flag) => !["--check", "--no-autostart", "--no-start"].includes(flag));
  if (unknown.length) throw new Error("不认识的参数：" + unknown.join(" ") + "\n用法：安装Anna.cmd [安装目录] [--check] [--no-autostart] [--no-start]");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  if (positional.length > 1) throw new Error("安装目录只能写一个（路径里有空格的话加引号）");
  return { target: positional[0] || DEFAULT_TARGET, check: flags.includes("--check"), autostart: !flags.includes("--no-autostart"), start: !flags.includes("--no-start") };
}

async function main() {
  try {
    process.exitCode = (await install(parseArgs(process.argv.slice(2)))).code;
  } catch (error) {
    console.error("");
    console.error("× " + (error?.message || error));
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { install, readPackage, inspectTarget, installProgram, checkConfig, setEnvValue, autostartScript, taskCommand, parseArgs, DEFAULT_TARGET };
