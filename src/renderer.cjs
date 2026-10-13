"use strict";
// 出图：用本机的 Chrome / Edge 无头模式打开主题页面，截图成 PNG（或 JPEG）。
//
// 做法跟 MiaBot 一样（它的 app-template.js 里 launchEdge / CDP 那两段，踩过的坑都带过来了）：
// 每张图起一个全新的无头浏览器，用完就关，不常驻 —— 慢一两秒，但不会有浏览器挂掉、标签页越积越多这类问题。
// 跟 MiaBot 不同的一点：数据不写进主题目录，而是在页面脚本运行之前注入 window.__THEME_DATA__，
// 主题目录里只有模板本身，两张图同时渲染也不会互相覆盖数据文件。
//
// 主题约定（详见 themes/README.md）：
//   themes/<名字>/renderer/theme.html 读 window.__THEME_DATA__ 画图；
//   画完（字体、图片都加载好）后设 window.__THEME_READY__ = true，出错就设 window.__THEME_ERROR__ = "原因"；
//   想指定截图尺寸就设 window.__THEME_SIZE__ = { width, height }（CSS 像素），不设就按页面实际大小。
//   themes/shared/theme-kit.js 的 ThemeKit.done() 会替主题等字体和图片，再设好这几个变量。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const BROWSER_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
];

// 一张图最多这么多像素（按输出像素算，已经乘过倍率）。超了多半是主题算错了尺寸，渲出来也发不出去。
const MAX_PIXELS = 50_000_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser(preferred) {
  if (preferred) return fs.existsSync(preferred) ? preferred : null;
  return BROWSER_CANDIDATES.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function killBrowser(proc) {
  try {
    // Chrome 会带一串子进程，Windows 上要连进程树一起杀
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else proc.kill("SIGKILL");
  } catch { /* 已经退出了 */ }
}

// Chrome DevTools Protocol 客户端，照 MiaBot 的 CDP 类写的。用 Node 22 自带的 WebSocket。
class CDP {
  constructor(wsUrl, { commandTimeoutMs = 30000 } = {}) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.commandTimeoutMs = commandTimeoutMs;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("连接浏览器调试端口超时")); this.close(); }, 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("无法连接浏览器调试端口")); }, { once: true });
    });
    this.ws.addEventListener("close", () => this.rejectPending("浏览器连接已关闭"));
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = message.id && this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error("CDP 错误：" + message.error.message));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("浏览器命令 " + method + " 超时（" + this.commandTimeoutMs / 1000 + " 秒）"));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "未知错误";
      throw new Error("页面执行出错：" + String(detail).slice(0, 500));
    }
    return result.result?.value;
  }

  // 只等导航「落地」，不等 load：load 会被没加载完的图片拖住。页面画没画好由主题的 __THEME_READY__ 说了算。
  async navigate(url, timeoutMs) {
    await this.send("Page.navigate", { url });
    await this.waitFor(`location.href !== "about:blank" && document.readyState !== "loading"`, timeoutMs, 100);
  }

  async waitFor(expression, timeoutMs, intervalMs) {
    const started = Date.now();
    for (;;) {
      try {
        const value = await this.evaluate(expression);
        if (value) return value;
      } catch { /* 导航途中上下文会换，下一轮再试 */ }
      if (Date.now() - started > timeoutMs) throw new Error("等待超时：" + expression.slice(0, 80));
      await sleep(intervalMs);
    }
  }

  rejectPending(message) {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error(message)); }
    this.pending.clear();
  }

  close() {
    this.rejectPending("浏览器连接已关闭");
    try { this.ws?.close(); } catch { /* 已关 */ }
  }
}

async function launchBrowser(browserPath, timeoutMs) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-render-"));
  const args = [
    "--headless=new",
    "--user-data-dir=" + userDataDir,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=msEdgeFirstRunExperience",
    "--disable-extensions",
    "--allow-file-access-from-files",
    "--hide-scrollbars",
    "--mute-audio",
    "about:blank",
  ];
  const proc = spawn(browserPath, args, { stdio: "ignore", windowsHide: true });
  let exited = false;
  proc.on("exit", () => { exited = true; });
  proc.on("error", () => { exited = true; });
  const fail = (message) => { killBrowser(proc); cleanup(userDataDir); return new Error(message); };

  // 浏览器把调试端口写进 DevToolsActivePort。Windows 上文件刚出现时可能还锁着、或者还没写完，
  // 这时读会报 EBUSY / EPERM 或读到空内容 —— 读不到有效端口就等一下再读。
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  let port = NaN;
  while (Date.now() < deadline && !exited) {
    try {
      port = parseInt(fs.readFileSync(portFile, "utf8").split("\n")[0].trim(), 10);
      if (port > 0) break;
    } catch (error) {
      if (!["ENOENT", "EBUSY", "EPERM", "EACCES"].includes(error?.code)) throw fail("读浏览器调试端口失败：" + error.message);
    }
    await sleep(100);
  }
  if (!(port > 0)) throw fail(exited ? "浏览器启动后立刻退出了（" + browserPath + "）" : "浏览器启动超时（没等到调试端口）");

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(3000) });
      const page = (await res.json()).find((target) => target.type === "page");
      if (page) return { proc, wsUrl: page.webSocketDebuggerUrl, userDataDir };
    } catch { /* 还没就绪 */ }
    await sleep(100);
  }
  throw fail("拿不到浏览器页面");
}

// 浏览器退出后文件还会被占用一会儿，异步慢慢删，删不掉也不要紧（在系统临时目录里）。
function cleanup(dir) {
  setTimeout(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }, () => {}), 500).unref?.();
}

function createRenderer({ themesDir, browserPath = "", scale = 2, timeoutMs = 60000, log = () => {} } = {}) {
  // 返回 { buffer, width, height, format }，width/height 是输出图片的像素尺寸。
  // options.width/height 是初始视口（CSS 像素），主题按它排版；截图尺寸以主题量出来的为准。
  async function render(theme, data, options = {}) {
    const {
      width = 1280, height = 720, format = "png", quality = 90,
    } = options;
    const outputScale = options.scale || scale;
    const html = path.join(themesDir, theme, "renderer", "theme.html");
    if (!fs.existsSync(html)) throw new Error("找不到主题 " + theme + "（" + html + "）");
    const executable = findBrowser(browserPath);
    if (!executable) throw new Error(browserPath ? "配置的浏览器不存在：" + browserPath : "没找到 Chrome 或 Edge，出不了图");

    const started = Date.now();
    let browser = null;
    let cdp = null;
    try {
      browser = await launchBrowser(executable, 30000);
      cdp = new CDP(browser.wsUrl);
      await cdp.connect();
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__THEME_DATA__ = " + JSON.stringify(data ?? null) + ";" });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: outputScale, mobile: false });
      await cdp.navigate(pathToFileURL(html).href, timeoutMs);
      const state = await cdp.waitFor(
        "window.__THEME_ERROR__ ? { error: String(window.__THEME_ERROR__) } : (window.__THEME_READY__ === true ? { ok: true } : null)",
        timeoutMs, 100);
      if (state.error) throw new Error("主题 " + theme + " 出错：" + state.error);

      const size = await cdp.evaluate(`(() => {
        const s = window.__THEME_SIZE__;
        if (s && s.width > 0 && s.height > 0) return { width: Math.ceil(s.width), height: Math.ceil(s.height) };
        const e = document.documentElement, b = document.body || e;
        return { width: Math.ceil(Math.max(e.scrollWidth, b.scrollWidth)), height: Math.ceil(Math.max(e.scrollHeight, b.scrollHeight)) };
      })()`);
      if (size.width * size.height * outputScale * outputScale > MAX_PIXELS) {
        throw new Error("图太大了：" + size.width + "×" + size.height + " ×" + outputScale + " 倍");
      }
      // 视口改成内容的大小再截，长图才不会被视口截断；改完等两帧让布局稳定。
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: outputScale, mobile: false });
      await cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const shot = await cdp.send("Page.captureScreenshot", {
        format,
        ...(format === "jpeg" ? { quality } : {}),
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
      });
      const buffer = Buffer.from(shot.data || "", "base64");
      if (buffer.length < 100) throw new Error("截图数据异常");
      log("出图 " + theme + "：" + size.width * outputScale + "×" + size.height * outputScale + "，" +
        Math.round(buffer.length / 1024) + " KiB，" + ((Date.now() - started) / 1000).toFixed(1) + " 秒");
      return { buffer, width: size.width * outputScale, height: size.height * outputScale, format };
    } finally {
      cdp?.close();
      if (browser) {
        killBrowser(browser.proc);
        cleanup(browser.userDataDir);
      }
    }
  }

  return { render, findBrowser: () => findBrowser(browserPath) };
}

module.exports = { createRenderer, findBrowser };
