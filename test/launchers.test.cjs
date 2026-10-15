"use strict";
// 无窗口启动器：tools/make-launchers.cjs 生成的 .vbs，tools/background.cjs 的启动、停止。
// 不碰真的 Anna：start / stop 一律传假的进程列表（本机可能正开着一个 npm start，相对路径的命令行是认得上的），
// 起的都是临时目录里的假 main.cjs。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildLaunchers, writeLaunchers } = require("../tools/make-launchers.cjs");
const { start, stop, isAnnaCommand, splitCommandLine, listNodeProcesses, READY_LINE, STDERR_FILE } = require("../tools/background.cjs");
const { logFile } = require("../src/log.cjs");

const windows = process.platform === "win32";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid, ms = 5000) {
  const deadline = Date.now() + ms;
  while (alive(pid) && Date.now() < deadline) await sleep(50);
  return !alive(pid);
}

// 临时目录里放一个假的 src/main.cjs。收尾时先结束它起来的进程、等它真没了（Windows 上进程的当前目录删不掉），再删目录。
// 删目录用异步的 rm：同步的 rmSync 碰到 EBUSY 不重试。
function fakeAnna(t, mainSource) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anna-bg-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "main.cjs"), mainSource);
  const pids = [];
  t.after(async () => {
    for (const pid of pids) { try { process.kill(pid); } catch { /* 已经自己退了 */ } }
    for (const pid of pids) await gone(pid);
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return { root, logs: path.join(root, "data", "logs"), track: (pid) => { if (pid) pids.push(pid); } };
}

// 照真 Anna 的样子写日志，300 毫秒后「连上网关」，几秒后自己退出（收尾没杀掉也不会一直挂着）
const CONNECTS = [
  '"use strict";',
  'const path = require("node:path");',
  "const { createLog } = require(" + JSON.stringify(path.join(__dirname, "..", "src", "log.cjs")) + ");",
  'const log = createLog({ dir: path.join(__dirname, "..", "data", "logs"), out: { log() {} } });',
  'log("Anna 启动｜假的");',
  "setTimeout(() => log(" + JSON.stringify(READY_LINE) + "), 300);",
  "setTimeout(() => {}, 5000);",
].join("\n");

test("认 Anna：命令行里带 src/main.cjs 的 node 进程；写的是绝对路径时要是这个目录的", () => {
  const root = "F:\\bots\\Anna Bot";
  const anna = [
    "node  src/main.cjs",                                                         // npm start
    "node src\\main.cjs",
    "node .\\src\\main.cjs --inspect",
    '"C:\\Program Files\\nodejs\\node.exe" "F:\\bots\\Anna Bot\\src\\main.cjs"',   // 启动器
    '"C:\\Program Files\\nodejs\\node.exe" "f:/BOTS/anna bot/src/main.cjs"',       // 大小写、斜杠不一样
  ];
  const others = [
    '"C:\\Program Files\\nodejs\\node.exe" "D:\\别的项目\\src\\main.cjs"',         // 别的项目也叫 src/main.cjs
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs/node_modules/npm/bin/npm-cli.js" start',
    '"node"   "C:\\Users\\someone\\AppData\\Roaming\\npm\\node_modules\\openalex-mcp\\build\\index.js" ',
    'node tools\\background.cjs start --result "C:\\Temp\\rad1.tmp"',
    "node src/main.cjs.bak",
    "node mysrc/main.cjs",
    "node --test test/*.test.cjs",
    "src/main.cjs",
    "",
    null,
  ];
  for (const line of anna) assert.ok(isAnnaCommand(line, root), line);
  for (const line of others) assert.ok(!isAnnaCommand(line, root), String(line));
  assert.deepEqual(splitCommandLine('"C:\\a b\\node.exe"  x  "y z" --k="v w"'), ["C:\\a b\\node.exe", "x", "y z", "--k=v w"]);
});

test("生成启动器：UTF-16LE + BOM、CRLF；用脚本自己所在的目录；引号双写；按退出码选弹窗", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-vbs-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const texts = buildLaunchers();
  assert.deepEqual(Object.keys(texts).sort(), ["停止Anna.vbs", "启动Anna.vbs"].sort());
  assert.deepEqual(writeLaunchers(dir).sort(), Object.keys(texts).sort());
  for (const [name, text] of Object.entries(texts)) {
    const bytes = fs.readFileSync(path.join(dir, name));
    assert.equal(bytes.subarray(0, 2).toString("hex"), "fffe", name + " 开头是 UTF-16LE 的 BOM");
    assert.equal(bytes.subarray(2).toString("utf16le"), text);
    assert.doesNotMatch(text, /(^|[^\r])\n/, "换行都是 CRLF");
    assert.match(text, /^shell\.CurrentDirectory = fso\.GetParentFolderName\(WScript\.ScriptFullName\)$/m);
    assert.match(text, /^If code = 0 Then\r\n {2}shell\.Popup text, 5, "Anna", 64 \+ 4096$/m);
  }
  assert.match(texts["启动Anna.vbs"], /^code = shell\.Run\("node tools\\background\.cjs start --result """ & result & """", 0, True\)$/m);
  assert.match(texts["停止Anna.vbs"], /^code = shell\.Run\("node tools\\background\.cjs stop --result """ & result & """", 0, True\)$/m);
});

test("启动器等的那句跟 bot.cjs 连上网关时打的一致", () => {
  assert.ok(fs.readFileSync(path.join(__dirname, "..", "src", "bot.cjs"), "utf8").includes('"' + READY_LINE + '"'));
});

test("后台启动：等到连上 QQ 网关才报成功，启动器退了 Anna 接着跑；已经有 Anna 在跑就不再开", async (t) => {
  const { root, logs, track } = fakeAnna(t, CONNECTS);
  const result = await start({ root, list: async () => [], timeoutMs: 15000 });
  track(result.pid);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.text, "Anna 已在后台启动，连上 QQ 了（进程 " + result.pid + "）。");
  assert.ok(alive(result.pid));
  assert.match(fs.readFileSync(path.join(logs, STDERR_FILE), "utf8"), /后台启动/);

  const running = [
    { pid: result.pid, commandLine: '"node.exe" "' + path.join(root, "src", "main.cjs") + '"' },
    { pid: 99, commandLine: "node other.js" },
  ];
  const again = await start({ root, list: async () => running });
  assert.equal(again.code, 2);
  assert.match(again.text, new RegExp("^Anna 已经在运行了（进程 " + result.pid + "），没有再开一个"));
});

test("后台启动：起不来时把 stderr 里的报错带回来；超时没连上也说一声，不拿上次留下的那句充数", async (t) => {
  const failing = fakeAnna(t, 'console.error("启动失败：找不到 config.local.json"); process.exit(1);');
  const failed = await start({ root: failing.root, list: async () => [] });
  assert.equal(failed.code, 1);
  assert.equal(failed.text, "Anna 没能启动：\n启动失败：找不到 config.local.json\n\n（报错也记在 " + path.join("data", "logs", STDERR_FILE) + "）");
  assert.match(fs.readFileSync(path.join(failing.logs, STDERR_FILE), "utf8"), /后台启动\n启动失败：找不到 config\.local\.json/);

  const crashing = fakeAnna(t, 'throw new Error("坏了");');
  const crashed = await start({ root: crashing.root, list: async () => [] });
  assert.equal(crashed.code, 1);
  assert.match(crashed.text, /^Anna 没能启动：\n[\s\S]*Error: 坏了/);

  const slow = fakeAnna(t, "setTimeout(() => {}, 5000);");
  fs.mkdirSync(slow.logs, { recursive: true });
  fs.writeFileSync(logFile(slow.logs, new Date()), "[00:00:00] " + READY_LINE + "\n");
  const late = await start({ root: slow.root, list: async () => [], timeoutMs: 800 });
  slow.track(late.pid);
  assert.equal(late.code, 2, late.text);
  assert.match(late.text, /^Anna 已在后台启动（进程 \d+），但 1 秒内还没连上 QQ。/);
});

test("停止：只结束认出来的进程，连它的子进程一起；记进日志；没在跑也照实说", { skip: !windows && "taskkill 只有 Windows 有" }, async (t) => {
  const { root, logs } = fakeAnna(t, "");
  // 假的 Anna 自己再起一个子进程（相当于出图时的无头 Chrome），把子进程号打出来
  const victim = spawn(process.execPath, ["-e", [
    'const { spawn } = require("node:child_process");',
    'const kid = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: "ignore", windowsHide: true });',
    "console.log(kid.pid);",
    "setTimeout(() => {}, 15000);",
  ].join("\n")], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const bystander = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: "ignore", windowsHide: true });
  t.after(() => { victim.kill(); bystander.kill(); });
  const grandchild = Number(await new Promise((resolve) => victim.stdout.once("data", (chunk) => resolve(String(chunk).trim()))));

  const list = async () => [
    { pid: victim.pid, commandLine: "node  src/main.cjs" },
    { pid: bystander.pid, commandLine: "node other.js" },
  ];
  const result = await stop({ root, list });
  assert.deepEqual(result, { code: 0, text: "Anna 已停止（结束了进程 " + victim.pid + "）。" });
  assert.ok(await gone(victim.pid), "Anna 没了");
  assert.ok(await gone(grandchild), "它的子进程也没了");
  assert.ok(alive(bystander.pid), "别的 node 进程不动");
  assert.match(fs.readFileSync(logFile(logs, new Date()), "utf8"), new RegExp("停止 Anna：结束了进程 " + victim.pid));

  assert.deepEqual(await stop({ root, list: async () => [{ pid: bystander.pid, commandLine: "node other.js" }] }),
    { code: 0, text: "Anna 本来就没在运行。" });
});

test("进程列表：PowerShell 查得到 node 进程，命令行里的中文不乱码", { skip: !windows && "只有 Windows 用" }, async (t) => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "测试参数"], { stdio: "ignore", windowsHide: true });
  t.after(() => child.kill());
  const found = (await listNodeProcesses()).find((proc) => proc.pid === child.pid);
  assert.ok(found, "列表里有刚起的进程");
  assert.match(found.commandLine, /测试参数/);
});
