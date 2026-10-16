"use strict";
// 用本机真的 Chrome / Edge 出图。没装浏览器的机器上跳过。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { createRenderer, findBrowser, PROFILE_PREFIX, LEFTOVER_AGE_MS } = require("../src/renderer.cjs");
const { PNG } = require("./mock-lxns.cjs");

const ROOT = path.resolve(__dirname, "..");
const skip = !findBrowser() && "没找到 Chrome / Edge";

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// 浏览器临时目录放进测试自己的临时目录：不碰系统临时目录，也好检查删干净了没有
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-scratch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}
const leftovers = (dir) => fs.readdirSync(dir).filter((name) => name.startsWith(PROFILE_PREFIX));

// 造一个浏览器临时目录，修改时间设成 ageMs 以前（建立时间改不了，清扫取两者里早的那个）
function fakeProfile(dir, name, ageMs) {
  const profile = path.join(dir, name);
  fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
  fs.writeFileSync(path.join(profile, "Default", "Preferences"), "{}");
  const time = new Date(Date.now() - ageMs);
  fs.utimesSync(profile, time, time);
  return profile;
}

// 临时主题目录：带上真的 theme-kit.js，再放几个小主题
function themes(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-themes-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "shared"));
  fs.copyFileSync(path.join(ROOT, "themes", "shared", "theme-kit.js"), path.join(dir, "shared", "theme-kit.js"));
  const add = (name, body) => {
    fs.mkdirSync(path.join(dir, name, "renderer"), { recursive: true });
    fs.writeFileSync(path.join(dir, name, "renderer", "theme.html"),
      "<!doctype html><html><head><meta charset=utf-8><script src=\"../../shared/theme-kit.js\"></script></head>" +
      "<body style=\"margin:0\">" + body + "</body></html>");
  };
  add("sized", `<div id="box" style="width:300px;height:200px;background:#123"><img id="img"></div><script>
    const data = ThemeKit.data(); document.getElementById("img").src = data.image;
    ThemeKit.done({ element: document.getElementById("box") });</script>`);
  add("boom", `<script>ThemeKit.data().nothing.here;</script>`);
  add("never", `<p>永远不说画好了</p>`);
  return dir;
}

test("按主题量出来的尺寸截图，倍率生效；本地图片能加载；出完图浏览器和临时目录都收拾掉，顺带清掉以前留下的", { skip }, async (t) => {
  const dir = themes(t);
  const tmp = scratch(t);
  fakeProfile(tmp, PROFILE_PREFIX + "old", 2 * LEFTOVER_AGE_MS);
  const image = path.join(dir, "1x1.png");
  fs.writeFileSync(image, PNG);
  const logs = [];
  const renderer = createRenderer({ themesDir: dir, scale: 2, tmpDir: tmp, log: (line) => logs.push(line) });
  const out = await renderer.render("sized", { image: pathToFileURL(image).href });
  assert.equal(out.format, "png");
  assert.deepEqual(pngSize(out.buffer), { width: 600, height: 400 });
  assert.deepEqual({ width: out.width, height: out.height }, { width: 600, height: 400 });
  const jpeg = await renderer.render("sized", { image: "" }, { scale: 1, format: "jpeg" });
  assert.equal(jpeg.buffer[0], 0xff);
  await renderer.idle();
  assert.deepEqual(leftovers(tmp), []);
  // 第一张图出完扫过一次，第二张不再扫
  assert.deepEqual(logs.filter((line) => line.startsWith("清掉了")), ["清掉了 1 个以前出图留下的临时浏览器目录"]);
});

test("主题脚本出错时马上带着原因失败，不等到超时；浏览器和临时目录照样收拾掉", { skip }, async (t) => {
  const tmp = scratch(t);
  const renderer = createRenderer({ themesDir: themes(t), timeoutMs: 20000, tmpDir: tmp });
  const started = Date.now();
  await assert.rejects(renderer.render("boom", {}), /主题 boom 出错：TypeError/);
  assert.ok(Date.now() - started < 15000);
  await renderer.idle();
  assert.deepEqual(leftovers(tmp), []);
});

test("主题一直不说画好了：超时报错，临时目录照样收拾掉", { skip }, async (t) => {
  const tmp = scratch(t);
  const renderer = createRenderer({ themesDir: themes(t), timeoutMs: 1500, tmpDir: tmp });
  await assert.rejects(renderer.render("never", {}), /等待超时/);
  await renderer.idle();
  assert.deepEqual(leftovers(tmp), []);
});

test("截图有自己的时限（没有显卡的服务器上它最慢）；日志里分段记下起浏览器、排版、截图各花了多久", { skip }, async (t) => {
  const dir = themes(t);
  const tmp = scratch(t);
  const logs = [];
  const renderer = createRenderer({ themesDir: dir, scale: 1, tmpDir: tmp, log: (line) => logs.push(line) });
  await renderer.render("sized", { image: "" });
  assert.match(logs.find((line) => line.startsWith("出图 sized")), /，[\d.]+ 秒（起浏览器 [\d.]+、排版 [\d.]+、截图 [\d.]+）$/);
  // 2026-10-16 服务器上 B50 截图超过了所有命令共用的 30 秒。时限给到 1 毫秒：超时的一定是截图这一步，前面的命令照旧
  const hasty = createRenderer({ themesDir: dir, scale: 1, tmpDir: tmp, captureTimeoutMs: 1 });
  await assert.rejects(hasty.render("sized", { image: "" }), /浏览器命令 Page\.captureScreenshot 超时/);
  await renderer.idle();
  await hasty.idle();
  assert.deepEqual(leftovers(tmp), []);
});

test("浏览器起不来（刚启动就退出）：报错之前先把临时目录删掉", async (t) => {
  const tmp = scratch(t);
  // 拿 node 冒充浏览器：它不认识 --headless=new 这些参数，马上就退出
  const renderer = createRenderer({ themesDir: themes(t), browserPath: process.execPath, tmpDir: tmp });
  await assert.rejects(renderer.render("sized", { image: "" }), /浏览器启动后立刻退出了/);
  assert.deepEqual(leftovers(tmp), []);
});

test("跑完就退的进程（测试、npm run preview）也等临时目录删完再退出", { skip }, async (t) => {
  const dir = themes(t);
  const tmp = scratch(t);
  // 以前删目录挂在 unref 的定时器上，这种进程出完图就退了，目录全留下（2026-10-15 积了 1.4 GB）
  const script = "require(" + JSON.stringify(path.join(ROOT, "src", "renderer.cjs")) + ").createRenderer({ themesDir: " + JSON.stringify(dir) +
    ", tmpDir: " + JSON.stringify(tmp) + ", scale: 1 }).render(\"sized\", { image: \"\" }).then(() => console.log(\"出好了\"));";
  const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  assert.equal(child.stdout.trim(), "出好了", child.stderr);
  assert.deepEqual(leftovers(tmp), []);
});

test("清扫：删掉一小时以前的旧目录；新的（可能正在出图）、不是浏览器临时目录的都不动", async (t) => {
  const tmp = scratch(t);
  fakeProfile(tmp, PROFILE_PREFIX + "old1", 2 * LEFTOVER_AGE_MS);
  fakeProfile(tmp, PROFILE_PREFIX + "old2", 30 * LEFTOVER_AGE_MS);
  fakeProfile(tmp, PROFILE_PREFIX + "busy", 60 * 1000);
  fakeProfile(tmp, "anna-themes-old", 2 * LEFTOVER_AGE_MS);
  fs.writeFileSync(path.join(tmp, PROFILE_PREFIX + "file"), "不是目录");
  const logs = [];
  const renderer = createRenderer({ themesDir: tmp, tmpDir: tmp, log: (line) => logs.push(line) });
  assert.deepEqual(await renderer.sweep(), { removed: 2, failed: 0 });
  assert.deepEqual(fs.readdirSync(tmp).sort(), [PROFILE_PREFIX + "busy", PROFILE_PREFIX + "file", "anna-themes-old"]);
  assert.deepEqual(logs, ["清掉了 2 个以前出图留下的临时浏览器目录"]);
  assert.deepEqual(await renderer.sweep(), { removed: 0, failed: 0 });
  assert.equal(logs.length, 1, "没东西可删的时候不打日志");
});

test("没有这个主题、指定的浏览器不存在：直接报错", async (t) => {
  await assert.rejects(createRenderer({ themesDir: themes(t) }).render("nope", {}), /找不到主题 nope/);
  await assert.rejects(createRenderer({ themesDir: themes(t), browserPath: "C:\\nope\\chrome.exe" }).render("sized", {}), /配置的浏览器不存在/);
});

test("仓库自带的示例主题能出图", { skip }, async (t) => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "themes", "_example", "examples", "preview-data.json"), "utf8"));
  data.jacket = "";   // 不联网
  const tmp = scratch(t);
  const renderer = createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1, tmpDir: tmp });
  const out = await renderer.render("_example", data);
  assert.equal(pngSize(out.buffer).width, 720);
  await renderer.idle();
  assert.deepEqual(leftovers(tmp), []);
});
