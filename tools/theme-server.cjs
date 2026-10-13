#!/usr/bin/env node
"use strict";
// 主题实时预览：npm run theme -- <主题名> [--port 47900]
// 用浏览器打开它打印的地址就是这个主题，数据是 examples/preview-data.json。
// 改了 CSS / JS / 示例数据后刷新浏览器就能看到，不用一遍遍出图。只监听本机（127.0.0.1）。
//
// 跟正式出图的区别只在数据怎么进页面：这里是在 theme.html 的 <head> 里插一段脚本设 window.__THEME_DATA__，
// 落雪素材（"lxns:jacket/407"）换成 /_lxns/jacket/407.png，从本地缓存给（没缓存就先下载）。
// 页面右下角会显示 ThemeKit 的状态：画完了（__THEME_READY__）还是出错了（__THEME_ERROR__）。

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { loadConfig } = require("../src/config.cjs");
const { createAssets } = require("../src/assets.cjs");
const { readExampleData, resolveAssetRefs } = require("./theme-data.cjs");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};

const STATUS_BADGE = `<script>
setInterval(function () {
  var el = document.getElementById("__theme_status__");
  if (!el) { el = document.createElement("div"); el.id = "__theme_status__";
    el.style.cssText = "position:fixed;right:8px;bottom:8px;padding:4px 8px;font:12px sans-serif;border-radius:4px;z-index:2147483647;color:#fff;max-width:60vw;white-space:pre-wrap";
    document.body && document.body.appendChild(el); }
  var error = window.__THEME_ERROR__, ready = window.__THEME_READY__ === true, size = window.__THEME_SIZE__;
  el.style.background = error ? "#c0392b" : ready ? "#27ae60" : "#7f8c8d";
  el.textContent = error ? "出错：" + error : ready ? "画好了" + (size ? "（" + size.width + "×" + size.height + "）" : "") : "还没画完";
}, 300);
</script>`;

async function main() {
  const list = process.argv.slice(2);
  const portAt = list.indexOf("--port");
  const port = portAt >= 0 ? Number(list.splice(portAt, 2)[1]) : 47900;
  const theme = list[0];
  if (!theme) throw new Error("用法：npm run theme -- <主题名> [--port 47900]");

  const config = loadConfig({ requireQQ: false, requireGroups: false, requireLxns: false, requireFile: false });
  const themesDir = path.join(config.root, "themes");
  if (!fs.existsSync(path.join(themesDir, theme, "renderer", "theme.html"))) throw new Error("找不到主题 " + theme);
  const assets = createAssets({ cacheDir: path.join(config.workDir, "cache", "assets"), log: console.log });
  const page = "/themes/" + encodeURIComponent(theme) + "/renderer/theme.html";

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") {
        res.writeHead(302, { Location: page });
        return res.end();
      }
      const asset = pathname.match(/^\/_lxns\/(jacket|character|trophy|plate|icon)\/(\d+)\.png$/);
      if (asset) {
        const file = await assets.file(asset[1], asset[2]);
        if (!file) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": "image/png" });
        return fs.createReadStream(file).pipe(res);
      }
      if (!pathname.startsWith("/themes/")) { res.writeHead(404); return res.end(); }
      const file = path.resolve(themesDir, "." + pathname.slice("/themes".length));
      if (!file.startsWith(themesDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end();
      }
      const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
      if (pathname === decodeURIComponent(page)) {
        // 每次刷新都重新读示例数据，改了数据刷新就生效
        const data = await resolveAssetRefs(readExampleData(themesDir, theme), (kind, id) => "/_lxns/" + kind + "/" + id + ".png");
        const inject = "<script>window.__THEME_DATA__ = " + JSON.stringify(data).replace(/</g, "\\u003c") + ";</script>" + STATUS_BADGE;
        const html = fs.readFileSync(file, "utf8").replace(/<head[^>]*>/i, (head) => head + inject);
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        return res.end(html);
      }
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(error?.message || error));
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log("主题 " + theme + " 的实时预览：http://127.0.0.1:" + port + "/");
    console.log("改完 CSS / JS / examples/preview-data.json 后刷新浏览器。Ctrl+C 退出。");
  });
}

main().catch((error) => {
  console.error("启动失败：" + (error?.message || error));
  process.exit(1);
});
