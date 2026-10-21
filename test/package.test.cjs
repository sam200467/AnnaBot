"use strict";
// 部署包：tools/build-package.cjs 打包、tools/install.cjs 安装。
// 程序部分用本仓库真的文件（安装程序靠它们跑），只是不带字体、图片这些大文件；
// 配置和数据换成临时目录里假的（假密钥、测试好友码），不碰本机的 .env 和 data/。不注册计划任务、不启动真的 Anna。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { buildPackage, createZip, installCmd, usedFonts, packagedEnv, deployGuide } = require("../tools/build-package.cjs");
const { install, checkConfig, autostartScript, taskCommand, parseArgs } = require("../tools/install.cjs");
const { powershell, psQuote } = require("../tools/background.cjs");
const { openVault } = require("../src/vault.cjs");

const windows = process.platform === "win32";
const FC = "123456789012345";
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
// 不拷字体、图片：一个 25 MB 的字体每个用例拷好几遍太慢。安装程序只靠 src/ 和 tools/ 就能跑
const small = (rel) => !/\.(?:ttf|otf|woff2?|png|webp|jpe?g)$/i.test(rel);

function tempDir(t, prefix = "anna-pkg-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

const readEnv = (dir) => parseEnv(fs.readFileSync(path.join(dir, ".env"), "utf8"));
const keyOf = (dir) => Buffer.from(readEnv(dir).ANNA_VAULT_KEY, "base64");

// 假的本机：.env、config.local.json、绑定库（2 人）、曲库缓存，外加不该带走的 vault.key、日志、试跑数据
async function fakeHome(t) {
  const home = tempDir(t, "anna-home-");
  const key = crypto.randomBytes(32);
  write(path.join(home, ".env"), [
    "QQ_APP_ID=1024", "QQ_APP_SECRET=qq-secret-abcdef", "LXNS_DEV_TOKEN=dev-token-abcdef",
    "LXNS_OAUTH_CLIENT_ID=client-1", "LXNS_OAUTH_CLIENT_SECRET=client-secret-abcdef",
    "ANNA_VAULT_KEY=" + key.toString("base64"), "LXNS_USER_TOKEN=personal-token-abcdef", "LXNS_FRIEND_CODE=" + FC, "",
  ].join("\n"));
  write(path.join(home, "config.local.json"), JSON.stringify({ allowedGroupIds: ["G1"], admins: ["ADMIN"] }, null, 2));
  const vault = await openVault({ file: path.join(home, "data", "bindings.enc"), key });
  await vault.set("U1", { friendCode: FC });
  await vault.set("U2", { friendCode: "102000000000002", oauth: { refreshToken: "refresh-token" } });
  write(path.join(home, "data", "cache", "songs.json"), "{}");
  write(path.join(home, "data", "cache", "assets", "jacket", "407.png"), crypto.randomBytes(64));
  write(path.join(home, "data", "vault.key"), "dpapi-sealed");
  write(path.join(home, "data", "logs", "anna-2026-10-01.log"), "日志");
  write(path.join(home, "data", "try", "bindings.enc"), "试跑");
  return { home, key };
}

const build = (t, options = {}) => buildPackage({ outDir: tempDir(t), zip: false, folder: true, filter: small, findRunning: async () => [], ...options });
// 安装时不碰真的进程、计划任务
const quiet = {
  platform: "win32", out: () => {},
  findAnna: async () => [], startAnna: async () => ({ code: 0, text: "假装启动了" }), setupTask: async () => ({ ok: true, text: "假装设好了" }),
};

test("完整包：程序、配置、绑定库、缓存都在；.env 换上导出的主密钥、不带个人密钥；vault.key、日志、试跑数据不带", async (t) => {
  const { home, key } = await fakeHome(t);
  const result = await build(t, { personalRoot: home });
  const { manifest, folderDir } = result;
  const paths = manifest.files.map((file) => file.path);
  assert.equal(manifest.kind, "install");
  assert.match(result.name, /^AnnaBot-install-\d{8}-\w+/);
  assert.deepEqual(manifest.personal, { bindings: 2, cacheFiles: 2 });
  for (const rel of ["app/src/main.cjs", "app/tools/install.cjs", "app/node_modules/ws/package.json", "app/themes/best/renderer/theme.html",
    "app/package.json", "personal/config.local.json", "personal/data/bindings.enc", "personal/data/cache/assets/jacket/407.png"]) {
    assert.ok(paths.includes(rel), rel);
  }
  const leaked = paths.filter((rel) => /^app\/(?:test|data|\.env$|config\.local\.json)|vault\.key|\/logs\/|\/try\//.test(rel));
  assert.deepEqual(leaked, []);
  for (const file of manifest.files) {
    const data = fs.readFileSync(path.join(folderDir, file.path));
    assert.equal(data.length, file.bytes, file.path);
    assert.equal(sha256(data), file.sha256, file.path);
  }
  for (const name of ["安装Anna.cmd", "部署说明.txt", "manifest.json"]) assert.ok(fs.existsSync(path.join(folderDir, name)), name);
  const guide = fs.readFileSync(path.join(folderDir, "部署说明.txt"), "utf8");
  assert.match(guide, /绑定数据（2 人）/);
  // build() 只出文件夹（zip: false），说明里就不该再让人解压 zip
  assert.match(guide, /把整个安装包文件夹拷到服务器/);
  assert.doesNotMatch(guide, /全部解压缩/);

  const envText = fs.readFileSync(path.join(folderDir, "personal", ".env"), "utf8");
  const env = parseEnv(envText);
  assert.equal(env.QQ_APP_SECRET, "qq-secret-abcdef");
  assert.equal(env.LXNS_OAUTH_CLIENT_SECRET, "client-secret-abcdef");
  assert.equal(env.ANNA_VAULT_KEY, key.toString("base64"));
  assert.ok(!envText.includes("personal-token-abcdef") && !envText.includes(FC), "个人密钥、好友码不带");
});

test("完整包：本机的 Anna 还开着就不打", { skip: !windows && "只在 Windows 上查进程" }, async (t) => {
  const { home } = await fakeHome(t);
  await assert.rejects(build(t, { personalRoot: home, findRunning: async () => [{ pid: 42 }] }), /^Error: 本机的 Anna 还开着（进程 42），先 npm stop/);
});

test("更新包只有程序", async (t) => {
  const { manifest, name } = await build(t, { kind: "update" });
  assert.match(name, /^AnnaBot-update-\d{8}-\w+/);
  assert.equal(manifest.personal, null);
  assert.ok(manifest.files.every((file) => file.path.startsWith("app/")));
});

test("全新安装：放好程序、配置和数据，生成启动器，主密钥解得开绑定库，记进日志", async (t) => {
  const { home } = await fakeHome(t);
  const pkg = await build(t, { personalRoot: home });
  const target = path.join(tempDir(t), "AnnaBot");
  const lines = [];
  const result = await install({ ...quiet, packageDir: pkg.folderDir, target, out: (line) => lines.push(line) });
  const text = lines.join("\n");
  assert.equal(result.code, 0, text);
  for (const rel of ["src/main.cjs", "node_modules/ws/index.js", ".env", "config.local.json", "data/bindings.enc", "data/cache/songs.json",
    "启动Anna.vbs", "停止Anna.vbs", "version.json"]) {
    assert.ok(fs.existsSync(path.join(target, rel)), rel);
  }
  assert.ok(!fs.existsSync(path.join(target, ".anna-new")) && !fs.existsSync(path.join(target, ".anna-old")), "中转目录收拾掉了");
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "version.json"), "utf8")).version, pkg.manifest.version);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "version.json"), "utf8")).notifyUpdate, false);
  assert.match(text, /：全新安装/);
  assert.match(text, /放好了 \.env、config\.local\.json、绑定库、曲库和素材缓存（2 个文件）/);
  assert.match(text, /绑定库：2 人，主密钥对得上/);
  assert.match(text, /开机自启：假装设好了/);
  assert.match(text, /自己电脑上的 Anna 别再开了/);
  const logs = path.join(target, "data", "logs");
  assert.match(fs.readdirSync(logs).map((name) => fs.readFileSync(path.join(logs, name), "utf8")).join(""), new RegExp("安装 " + pkg.name + "（全新安装）"));
});

test("更新：先停掉正在跑的 Anna 再换文件；程序整个换新，旧版本多出来的去掉；服务器上的配置和数据不动", async (t) => {
  const { home } = await fakeHome(t);
  const full = await build(t, { personalRoot: home });
  const target = path.join(tempDir(t), "AnnaBot");
  await install({ ...quiet, packageDir: full.folderDir, target });

  // 服务器上跑了一阵：配置改过，多了一个人绑定，程序目录里有旧版本留下的文件
  const configFile = path.join(target, "config.local.json");
  fs.writeFileSync(configFile, JSON.stringify({ allowedGroupIds: ["G1", "G2"] }));
  await (await openVault({ file: path.join(target, "data", "bindings.enc"), key: keyOf(target) })).set("U3", { friendCode: "103000000000003" });
  write(path.join(target, "src", "old-feature.cjs"), "旧版本的");
  fs.writeFileSync(path.join(target, "src", "main.cjs"), "旧版本的 main");

  const update = await build(t, { kind: "update" });
  const events = [];
  const lines = [];
  const result = await install({
    ...quiet, packageDir: update.folderDir, target, out: (line) => lines.push(line),
    findAnna: async () => [{ pid: 4321 }],
    stopAnna: async () => {
      events.push("停：" + fs.readFileSync(path.join(target, "src", "main.cjs"), "utf8"));
      return { code: 0, text: "停了" };
    },
    startAnna: async () => {
      events.push("启动");
      return { code: 0, text: "起来了" };
    },
  });
  const text = lines.join("\n");
  assert.equal(result.code, 0, text);
  assert.deepEqual(events, ["停：旧版本的 main", "启动"], "停的时候还是旧程序，换完才启动");
  const release = JSON.parse(fs.readFileSync(path.join(target, "version.json"), "utf8"));
  assert.equal(release.notifyUpdate, true);
  assert.deepEqual(release.notes, update.manifest.notes);
  assert.ok(release.notes.length);
  assert.ok(!fs.existsSync(path.join(target, "src", "old-feature.cjs")));
  assert.equal(fs.readFileSync(path.join(target, "src", "main.cjs"), "utf8"), fs.readFileSync(path.join(__dirname, "..", "src", "main.cjs"), "utf8"));
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).allowedGroupIds, ["G1", "G2"]);
  assert.match(text, /：更新（现在装的是 /);
  assert.match(text, /停掉了正在运行的 Anna（进程 4321）/);
  assert.match(text, /绑定库：3 人/);
  assert.doesNotMatch(text, /自己电脑上的 Anna 别再开了/);

  // 完整包再装一遍：包里的配置和数据不覆盖服务器上的
  const again = [];
  await install({ ...quiet, packageDir: full.folderDir, target, out: (line) => again.push(line) });
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).allowedGroupIds, ["G1", "G2"]);
  assert.equal((await openVault({ file: path.join(target, "data", "bindings.enc"), key: keyOf(target) })).size, 3);
  assert.match(again.join("\n"), /服务器上已经有的没动：\.env、config\.local\.json、绑定库、曲库和素材缓存（2 个文件）/);
});

test("只有程序、服务器上还没配置：程序照装，说清楚缺什么，不启动", async (t) => {
  const pkg = await build(t, { kind: "update" });
  const target = path.join(tempDir(t), "AnnaBot");
  const lines = [];
  let started = false;
  const result = await install({
    ...quiet, packageDir: pkg.folderDir, target, out: (line) => lines.push(line),
    startAnna: async () => { started = true; return { code: 0, text: "" }; },
  });
  assert.equal(result.code, 2);
  assert.equal(started, false);
  assert.match(lines.join("\n"), /× 缺 \.env、config\.local\.json/);
  assert.ok(fs.existsSync(path.join(target, "src", "main.cjs")));
});

test("安装包传坏了、安装目录里是别人的东西、装进安装包里面：一律不动手", async (t) => {
  const pkg = await build(t, { kind: "update" });
  const target = path.join(tempDir(t), "AnnaBot");
  fs.appendFileSync(path.join(pkg.folderDir, "app", "src", "bot.cjs"), "\n// 传坏了");
  await assert.rejects(install({ ...quiet, packageDir: pkg.folderDir, target }), /安装包不完整或者传坏了（1 个文件）：\napp\/src\/bot\.cjs（内容对不上）/);
  assert.ok(!fs.existsSync(target));

  const good = await build(t, { kind: "update" });
  const other = tempDir(t);
  write(path.join(other, "src", "index.js"), "别人的项目");
  await assert.rejects(install({ ...quiet, packageDir: good.folderDir, target: other }), /看着不像 Anna 的安装目录/);
  assert.deepEqual(fs.readdirSync(other), ["src"]);
  assert.equal(fs.readFileSync(path.join(other, "src", "index.js"), "utf8"), "别人的项目");
  await assert.rejects(install({ ...quiet, packageDir: good.folderDir, target: path.join(good.folderDir, "装这里") }), /安装目录不能在安装包里面/);
});

test("主密钥：.env 里没有时，有 vault.key 就转写进去，什么都没有就新生成；有绑定库却没有密钥、密钥不对都报出来", async (t) => {
  const target = tempDir(t);
  const envFile = path.join(target, ".env");
  const baseEnv = "QQ_APP_ID=1\r\nQQ_APP_SECRET=s-abcdef\r\nLXNS_DEV_TOKEN=d-abcdef\r\n";
  write(path.join(target, "config.local.json"), JSON.stringify({ allowedGroupIds: ["G1"] }));

  write(envFile, baseEnv);
  let result = await checkConfig(target);
  assert.deepEqual(result.problems, []);
  assert.equal(result.bindings, null);
  assert.match(result.notes[0], /生成了绑定库主密钥/);
  assert.equal(keyOf(target).length, 32);
  assert.match(fs.readFileSync(envFile, "utf8"), /^QQ_APP_ID=1\r\n[\s\S]*\r\nANNA_VAULT_KEY=\S+\r\n$/, "原来的行不动，换行照旧是 CRLF");

  // 以前在这台机器上用 DPAPI 跑过
  const key = crypto.randomBytes(32);
  write(envFile, baseEnv + "ANNA_VAULT_KEY=\r\n");
  write(path.join(target, "data", "vault.key"), "dpapi-sealed");
  await (await openVault({ file: path.join(target, "data", "bindings.enc"), key })).set("U1", { friendCode: FC });
  const protector = { unprotect: async () => key, protect: async () => { throw new Error("不该生成新的"); } };
  result = await checkConfig(target, { protector });
  assert.deepEqual(result.problems, []);
  assert.equal(result.bindings, 1);
  assert.match(result.notes[0], /转写进了 \.env/);
  assert.deepEqual(keyOf(target), key);

  fs.rmSync(path.join(target, "data", "vault.key"));
  write(envFile, baseEnv);
  assert.match((await checkConfig(target)).problems[0], /有绑定库 .*，但 \.env 里没有 ANNA_VAULT_KEY/);

  write(envFile, baseEnv + "ANNA_VAULT_KEY=" + crypto.randomBytes(32).toString("base64") + "\r\n");
  assert.match((await checkConfig(target)).problems[0], /绑定库 .* 解不开/);
});

test("zip：Expand-Archive 解得开，中文文件名不乱，压缩的、原样存的、空文件都对", { skip: !windows && "用 Windows 自带的 Expand-Archive 验" }, async (t) => {
  const dir = tempDir(t);
  const files = {
    "包/安装Anna.cmd": Buffer.from("@echo off\r\n"),
    "包/部署说明.txt": Buffer.from("中文说明，压得小\n".repeat(200)),
    "包/app/src/随机.bin": crypto.randomBytes(5000),
    "包/app/空.txt": Buffer.alloc(0),
  };
  const zipFile = path.join(dir, "测试 包.zip");
  const zip = createZip(zipFile);
  for (const [name, data] of Object.entries(files)) zip.add(name, data, new Date(2026, 9, 15, 12, 34, 56));
  zip.close();
  const out = path.join(dir, "解开");
  await powershell("$ErrorActionPreference = 'Stop'\nExpand-Archive -LiteralPath " + psQuote(zipFile) + " -DestinationPath " + psQuote(out), { what: "解不开 zip" });
  for (const [name, data] of Object.entries(files)) assert.deepEqual(fs.readFileSync(path.join(out, ...name.split("/"))), data, name);
  assert.equal(fs.statSync(path.join(out, "包", "部署说明.txt")).mtime.getFullYear(), 2026);
});

test("安装Anna.cmd：纯 ASCII、CRLF；不调 PowerShell（杀毒软件会把它当病毒删掉）；没装 node、没解压时说一声", () => {
  const text = installCmd();
  assert.match(text, /^[\x00-\x7f]*$/);
  assert.doesNotMatch(text, /(^|[^\r])\n/);
  assert.doesNotMatch(text.replace(/^rem .*$/gm, ""), /powershell/i);
  assert.match(text, /^node "%~dp0app\\tools\\install\.cjs" %\*$/m);
  assert.match(text, /^:nonode\r\necho Node\.js was not found\./m);
  assert.match(text, /^:unpacked\r\necho This package is not fully extracted\./m);
});

test("开机自启：S4U、开机 30 秒后、不限时、不重复开；stderr 接到日志", { skip: !windows && "只有 Windows 有计划任务" }, async () => {
  const options = { node: "C:\\Program Files\\nodejs\\node.exe", target: "D:\\Anna 机器人", errLog: "D:\\Anna 机器人\\data\\logs\\stderr.log" };
  // dryRun 只拼出任务对象、不注册：不用管理员权限，也不改系统
  const task = JSON.parse(await powershell(autostartScript({ ...options, dryRun: true })));
  assert.equal(task.logon, "S4U");
  assert.equal(task.limit, "PT0S");
  assert.equal(task.multiple, "IgnoreNew");
  assert.equal(task.trigger, "MSFT_TaskBootTrigger");
  assert.equal(task.delay, "PT30S");
  assert.equal(task.execute, "cmd.exe");
  assert.equal(task.dir, "D:\\Anna 机器人");
  assert.equal(task.arguments, "/d /s /c \"\"C:\\Program Files\\nodejs\\node.exe\" \"D:\\Anna 机器人\\src\\main.cjs\" 2>>\"D:\\Anna 机器人\\data\\logs\\stderr.log\"\"");
  assert.equal(task.arguments, taskCommand(options));
  const real = autostartScript(options);
  assert.match(real, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
  assert.match(real, /Register-ScheduledTask -TaskName 'AnnaBot' -InputObject \$task -Force/);
});

test("字体只带用得到的：fonts.css 里的名字或者文件名在主题里出现过", () => {
  const css = "@font-face { font-family: \"Anna Hand\"; src: local(\"X\"), url(\"fonts/Hand.ttf\") format(\"truetype\"); }\n" +
    "@font-face { font-family: \"Anna Song\"; src: url(\"fonts/Song.ttf\"); }\n" +
    "@font-face { font-family: \"Anna Script\"; src: local(\"Segoe Script\"); }";
  const fonts = ["themes/shared/fonts/Hand.ttf", "themes/shared/fonts/Song.ttf", "themes/shared/fonts/Direct.otf"];
  const theme = ".a { font-family: \"Anna Hand\", serif; }\n@font-face { font-family: Own; src: url(\"../../shared/fonts/Direct.otf\"); }";
  assert.deepEqual(usedFonts(fonts, css, theme), ["themes/shared/fonts/Hand.ttf", "themes/shared/fonts/Direct.otf"]);
});

test("包里的 .env：照模板填，带特殊字符的加引号，模板外的也带上，只有本机用的去掉", () => {
  const template = "# 注释留着\nQQ_APP_ID=\nLXNS_USER_TOKEN=\nANNA_VAULT_KEY=\n";
  const key = crypto.randomBytes(32);
  const text = packagedEnv(template, { QQ_APP_ID: "1", QQ_APP_SECRET: "a b#c", LXNS_USER_TOKEN: "mine-abcdef", EXTRA: "x" }, key);
  const env = parseEnv(text);
  assert.equal(env.QQ_APP_ID, "1");
  assert.equal(env.QQ_APP_SECRET, "a b#c");
  assert.equal(env.EXTRA, "x");
  assert.equal(env.ANNA_VAULT_KEY, key.toString("base64"));
  assert.ok(!text.includes("mine-abcdef"));
  assert.match(text, /^# 注释留着$/m);
});

test("部署说明：打 zip 和只出文件夹两种写法", () => {
  const manifest = { name: "AnnaBot-install-20261019-abcdef", kind: "install", personal: { bindings: 0, cacheFiles: 0 } };
  const zipped = deployGuide(manifest);
  assert.match(zipped, /把 zip 拷到服务器/);
  assert.match(zipped, /解压出来的「安装Anna\.cmd」/);
  const folder = deployGuide(manifest, { zip: false });
  assert.match(folder, /把整个安装包文件夹拷到服务器/);
  assert.match(folder, /文件夹里的「安装Anna\.cmd」/);
  assert.doesNotMatch(folder, /全部解压缩/);
});

test("安装参数", () => {
  assert.deepEqual(parseArgs([]), { target: "C:\\AnnaBot", check: false, autostart: true, start: true });
  assert.deepEqual(parseArgs(["D:\\Anna", "--no-start", "--no-autostart"]), { target: "D:\\Anna", check: false, autostart: false, start: false });
  assert.throws(() => parseArgs(["--force"]), /不认识的参数：--force/);
});
