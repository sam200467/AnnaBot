"use strict";
// 用本机真的 Chrome / Edge 出图。没装浏览器的机器上跳过。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRenderer, findBrowser } = require("../src/renderer.cjs");
const { PNG } = require("./mock-lxns.cjs");

const ROOT = path.resolve(__dirname, "..");
const skip = !findBrowser() && "没找到 Chrome / Edge";

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
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

test("按主题量出来的尺寸截图，倍率生效；本地图片能加载", { skip }, async (t) => {
  const dir = themes(t);
  const image = path.join(dir, "1x1.png");
  fs.writeFileSync(image, PNG);
  const renderer = createRenderer({ themesDir: dir, scale: 2 });
  const out = await renderer.render("sized", { image: pathToFileURL(image).href });
  assert.equal(out.format, "png");
  assert.deepEqual(pngSize(out.buffer), { width: 600, height: 400 });
  assert.deepEqual({ width: out.width, height: out.height }, { width: 600, height: 400 });
  const jpeg = await renderer.render("sized", { image: "" }, { scale: 1, format: "jpeg" });
  assert.equal(jpeg.buffer[0], 0xff);
});

test("主题脚本出错时马上带着原因失败，不等到超时", { skip }, async (t) => {
  const renderer = createRenderer({ themesDir: themes(t), timeoutMs: 20000 });
  const started = Date.now();
  await assert.rejects(renderer.render("boom", {}), /主题 boom 出错：TypeError/);
  assert.ok(Date.now() - started < 15000);
});

test("主题一直不说画好了：超时报错", { skip }, async (t) => {
  const renderer = createRenderer({ themesDir: themes(t), timeoutMs: 1500 });
  await assert.rejects(renderer.render("never", {}), /等待超时/);
});

test("没有这个主题、指定的浏览器不存在：直接报错", async (t) => {
  await assert.rejects(createRenderer({ themesDir: themes(t) }).render("nope", {}), /找不到主题 nope/);
  await assert.rejects(createRenderer({ themesDir: themes(t), browserPath: "C:\\nope\\chrome.exe" }).render("sized", {}), /配置的浏览器不存在/);
});

test("仓库自带的示例主题能出图", { skip }, async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "themes", "_example", "examples", "preview-data.json"), "utf8"));
  data.jacket = "";   // 不联网
  const out = await createRenderer({ themesDir: path.join(ROOT, "themes"), scale: 1 }).render("_example", data);
  assert.equal(pngSize(out.buffer).width, 720);
});
