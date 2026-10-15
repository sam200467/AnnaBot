#!/usr/bin/env node
"use strict";
// 后台运行 Anna：「启动Anna.vbs」「停止Anna.vbs」（npm run launchers 生成）背后干活的就是这个文件，
// .vbs 只是把它藏起来跑，再把结果弹窗说一声。
//
// 用法：node tools/background.cjs start    无窗口启动，等连上 QQ 网关再报；已经有 Anna 在跑就不再开
//       node tools/background.cjs stop     停掉在跑的 Anna（npm stop 也是它）
//       加 --result <文件> 时结果写进这个文件（UTF-16LE，给 .vbs 读），不加就打在终端里。
// 退出码：0 成功，1 失败，2 要人看一眼（已经在跑了、启动了但还没连上）。.vbs 按它选弹窗的图标。
//
// 怎么认 Anna：命令行里带 src/main.cjs 的 node 进程 —— npm start、启动器、手打的 node src/main.cjs 都是这样。
// 写的是绝对路径时还得是这个目录下的那个，别的项目也叫 src/main.cjs 的话不会被误杀；
// 相对路径看不出是哪个目录的（Windows 拿不到别的进程的当前目录），只能算上。

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { loadConfig, ROOT } = require("../src/config.cjs");
const { createLog, logFile } = require("../src/log.cjs");

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// bot.cjs 的 watchGateway 连上网关时打的那句（测试会核对两边一致）
const READY_LINE = "QQ 网关已连上";
// 启动失败、崩溃的报错只打在 stderr（那时日志模块可能还没建起来）。后台跑没有窗口，所以接到这个文件里。
const STDERR_FILE = "stderr.log";

// Windows 命令行按空白切开、去掉引号。够认路径用，不管 \" 这类转义。
const splitCommandLine = (line) => (String(line || "").match(/(?:"[^"]*"|[^\s"])+/g) || []).map((arg) => arg.replace(/"/g, ""));

function isAnnaCommand(commandLine, root = ROOT) {
  const entry = path.win32.join(root, "src", "main.cjs").toLowerCase();
  return splitCommandLine(commandLine).slice(1).some((arg) => {
    const file = arg.replace(/\//g, "\\");
    if (path.win32.isAbsolute(file)) return path.win32.normalize(file).toLowerCase() === entry;
    return /(^|\\)src\\main\.cjs$/i.test(file);
  });
}

// 列出所有 node.exe 和它们的命令行。用 PowerShell 的 CIM：wmic 已经被微软弃用，新的 Windows 11 上直接没有（MiaBot 踩过）。
const LIST_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",   // 头一回用 CIM 模块时会往 stderr 打一段进度条
  // 不设的话按 GBK 代码页输出，命令行里的中文路径会乱码
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "$list = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; commandLine = [string]$_.CommandLine } })",
  "ConvertTo-Json -InputObject $list -Compress",
].join("\n");

async function listNodeProcesses() {
  let stdout;
  try {
    ({ stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(LIST_SCRIPT, "utf16le").toString("base64")],
      { encoding: "utf8", windowsHide: true, timeout: 60000 }));
  } catch (error) {
    // 别把 error.message 原样往外报：里面是整条命令，带一大串 base64
    throw new Error("查不了进程列表（PowerShell " + (error.killed ? "超时" : "出错，退出码 " + error.code) + "）");
  }
  return JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "[]");
}

async function findAnna({ root = ROOT, list = listNodeProcesses } = {}) {
  return (await list()).filter((proc) => proc.pid !== process.pid && isAnnaCommand(proc.commandLine, root));
}

// 日志目录跟 Anna 自己用的一样（workDir/logs）。读不了配置时 Anna 自己也起不来，报错会从 stderr 里看到，这里先按默认的 data/ 算。
function logsOf(root) {
  try {
    const config = loadConfig({ root, env: {}, requireQQ: false, requireGroups: false, requireLxns: false, requireFile: false });
    return { dir: path.join(config.workDir, "logs"), keepDays: config.logKeepDays };
  } catch {
    return { dir: path.join(root, "data", "logs"), keepDays: 14 };
  }
}

const sizeOf = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };
const readFrom = (file, offset) => { try { return fs.readFileSync(file).subarray(offset).toString("utf8"); } catch { return ""; } };
const pidList = (procs) => procs.map((proc) => proc.pid).join("、");
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
// 弹窗里的路径写成相对项目目录的，短一点
const shown = (root, file) => {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : file;
};
// 报错太长时只留开头：Node 崩溃时有用的（出错位置、错误信息）在最前面，后面是很长的调用栈
function head(text, maxLines = 10) {
  const lines = text.trim().split(/\r?\n/);
  return lines.length > maxLines ? lines.slice(0, maxLines).join("\n") + "\n…" : lines.join("\n");
}

async function start({ root = ROOT, list, timeoutMs = 60000, pollMs = 250, now = () => new Date() } = {}) {
  const running = await findAnna({ root, list });
  if (running.length) {
    return { code: 2, text: "Anna 已经在运行了（进程 " + pidList(running) + "），没有再开一个：同时开两个，每句话会回两遍。\n" +
      "要重启的话，先双击「停止Anna.vbs」。" };
  }

  const logs = logsOf(root).dir;
  fs.mkdirSync(logs, { recursive: true });
  const errFile = path.join(logs, STDERR_FILE);
  fs.appendFileSync(errFile, "[" + now().toLocaleString("zh-CN", { hour12: false }) + "] 后台启动\n");
  const errOffset = sizeOf(errFile);
  // 只看这次启动以后新写的日志。文件按天分，跨了零点的话新一天的从头看。
  const offsets = new Map([[logFile(logs, now()), sizeOf(logFile(logs, now()))]]);

  const errFd = fs.openSync(errFile, "a");
  let child;
  try {
    // detached：这个脚本退出以后 Anna 接着跑。detached 的进程没有控制台，Anna 起子进程都得带 windowsHide，不然会弹黑框。
    // stdout 不要（日志模块自己写文件），stderr 接到 stderr.log。
    child = spawn(process.execPath, [path.join(root, "src", "main.cjs")],
      { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", "ignore", errFd] });
  } finally {
    fs.closeSync(errFd);
  }
  let exit = null;
  child.once("exit", (code, signal) => { exit = { code: code ?? signal }; });
  child.once("error", (error) => { exit = { error }; });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sleep(pollMs);
    if (exit) {
      const detail = exit.error ? exit.error.message : head(readFrom(errFile, errOffset));
      return { code: 1, text: detail
        ? "Anna 没能启动：\n" + detail + "\n\n（报错也记在 " + shown(root, errFile) + "）"
        : "Anna 刚启动就退出了（退出码 " + exit.code + "），没留下报错。看看日志：" + shown(root, logFile(logs, now())) };
    }
    const today = logFile(logs, now());
    if (!offsets.has(today)) offsets.set(today, 0);
    if ([...offsets].some(([file, offset]) => readFrom(file, offset).includes(READY_LINE))) {
      return { code: 0, pid: child.pid, text: "Anna 已在后台启动，连上 QQ 了（进程 " + child.pid + "）。" };
    }
    if (Date.now() >= deadline) {
      return { code: 2, pid: child.pid, text: "Anna 已在后台启动（进程 " + child.pid + "），但 " + Math.round(timeoutMs / 1000) +
        " 秒内还没连上 QQ。\n看看日志：" + shown(root, today) };
    }
  }
}

// taskkill /T 连子进程一起结束：正在出图时停的话，无头 Chrome 是 Anna 的子进程，不带 /T 它会一直留着。
// /F 是因为 Windows 上没法让别的进程收到 SIGTERM，main.cjs 里的收尾走不到。一般不要紧：绑定库每次改动都当场
// 原子写盘（vault.cjs 的 writeAtomic），强杀通常只丢掉正在处理的那条消息。唯一的坑是正赶上 OAuth 刷新令牌：
// 落雪一刷新，旧的刷新令牌立刻作废，新的还没写进绑定库就被杀的话，那个人得重新 /授权。窗口只有一次写盘那么长，
// 但刷新不只在有人查分时发生，启动时和之后每 6 小时的续期（main.cjs 的 keepAlive）也会刷。
async function killTree(pid) {
  try {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } catch (error) {
    // 进程在这之前自己退了的话 taskkill 也报错，那不算失败
    if (alive(pid)) throw new Error("taskkill 失败（退出码 " + error.code + "）");
  }
}

async function stop({ root = ROOT, list, kill = killTree, waitMs = 5000, now = () => new Date() } = {}) {
  const running = await findAnna({ root, list });
  if (!running.length) return { code: 0, text: "Anna 本来就没在运行。" };
  const problems = [];
  for (const proc of running) {
    try { await kill(proc.pid); } catch (error) { problems.push("进程 " + proc.pid + "：" + error.message); }
  }
  const deadline = Date.now() + waitMs;
  while (running.some((proc) => alive(proc.pid)) && Date.now() < deadline) await sleep(100);
  const left = running.filter((proc) => alive(proc.pid));
  if (left.length) {
    return { code: 1, text: "停止失败，进程 " + pidList(left) + " 还在。" + (problems.length ? "\n" + problems.join("\n") : "") };
  }
  // 记进 Anna 的日志：不然日志就那么断了，回头看不出是停掉的还是挂了
  const { dir, keepDays } = logsOf(root);
  createLog({ dir, keepDays, out: { log() {} }, now })("停止 Anna：结束了进程 " + pidList(running));
  return { code: 0, text: "Anna 已停止（结束了进程 " + pidList(running) + "）。" };
}

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--result");
  const resultFile = at >= 0 ? argv[at + 1] : "";
  let result;
  try {
    if (process.platform !== "win32") result = { code: 1, text: "后台启动器只支持 Windows。" };
    else if (argv[0] === "start") result = await start();
    else if (argv[0] === "stop") result = await stop();
    else result = { code: 1, text: "用法：node tools/background.cjs start|stop [--result 文件]" };
  } catch (error) {
    result = { code: 1, text: "出错了：" + (error?.message || error) };
  }
  // VBScript 读文件只认 ANSI 或 UTF-16LE（见 make-launchers.cjs），换行也得是 CRLF
  if (resultFile) fs.writeFileSync(resultFile, Buffer.from("\uFEFF" + result.text.replace(/\r?\n/g, "\r\n"), "utf16le"));
  else (result.code === 1 ? console.error : console.log)(result.text);
  process.exitCode = result.code;
}

if (require.main === module) void main();

module.exports = { start, stop, findAnna, listNodeProcesses, isAnnaCommand, splitCommandLine, READY_LINE, STDERR_FILE };
