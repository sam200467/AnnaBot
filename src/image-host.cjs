"use strict";
// 临时图片网址：多页的图（/分数列表）跟翻页按钮合成一条 Markdown 时用。照 MiaBot 素材检索网页的 /shared/（asset-browser.cjs）。
//
// 为什么要它：QQ 的图片消息挂不了按钮，按钮只能跟 Markdown；Markdown 里的图又只能写网址，由 QQ 自己来取 ——
// 刚画好的成绩图没有网址，所以在 Anna 自己的进程里开一个小网页服务，把图临时放在 /shared/<随机串>.jpg。
// QQ 的服务器要打得开这个地址：服务器的安全组和 Windows 防火墙放行端口，publicBaseUrl 写外网地址
// （MiaBot 的素材网页就是 http://公网IP:47831，2026-10-10 线上合成过一条）。
// QQ 取不到图（端口没放行、地址写错）时这边察觉不到，消息里会没有图 —— 所以默认关（config 的 pagedImageInMarkdown），
// 开了以后要在群里看一眼。
//
// 只发这些临时图，别的地址一律 404：地址是 32 位随机串，猜不到；24 小时后作废；最多留 MAX 张，多了先丢最旧的。
// QQ 什么时候来取图（发送时一次，还是每次有人看都来）没法确认，所以留得久一点（MiaBot 同样）。
// 没起来（端口被占）、没填 publicBaseUrl 时不拦着 Anna 启动：publish 给不出地址，调用方照旧发图片 + 翻页消息。
// 消息发出去以后盯一下（publish 返回的 sent()）：CHECK_MS 内没人来取图就记一句警告，多半是端口没放行或地址不对；
// 来取了也记一句。这样群里的图没出来时，看日志就分得清是没取到，还是取到了 QQ 不显示（比如图太大）。
// 不记来取图的 IP：万一是群友的客户端直接来取，那就是别人的地址了。

const crypto = require("node:crypto");
const http = require("node:http");

const DEFAULT_PORT = 47832;   // MiaBot 的素材网页占着 47831，两个机器人可能在同一台服务器上
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX = 30;
const CHECK_MS = 60 * 1000;

// 成绩图有 PNG 也有 JPG（/分数列表 出的是 JPG）。按文件头认，认不出返回 null。照 MiaBot 的 asset-browser.cjs：
// 尺寸 PNG 读 IHDR；JPG 找 SOF 段（C0–CF，除了 C4 DHT、C8、CC DAC）。
function imageInfo(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : null;
  if (!data || data.length < 24) return null;
  if (data.readUInt32BE(0) === 0x89504e47 && data.toString("ascii", 12, 16) === "IHDR") {
    return { type: "png", mime: "image/png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) { i++; continue; }
      const marker = data[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: "jpg", mime: "image/jpeg", width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
      }
      if (marker === 0xd9 || marker === 0xda) return null;   // 到了图像数据还没见到 SOF
      i += 2 + length;
    }
  }
  return null;
}

// host / port：监听在哪（默认所有网卡的 47832，QQ 从外网来取）；port 写 0 是测试用的，起来以后用 port() 读实际的。
// publicBaseUrl：QQ 打得开的地址，比如 http://服务器公网IP:47832。
function createImageHost({ host = "0.0.0.0", port = DEFAULT_PORT, publicBaseUrl = "", ttlMs = TTL_MS, max = MAX, checkMs = CHECK_MS,
  now = Date.now, log = () => {} } = {}) {
  const base = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
  const shared = new Map();   // 随机串 -> { buffer, mime, expiry, fetched }
  const watching = new Set();   // sent() 起的定时器，停的时候清掉
  let listening = false;

  function prune() {
    for (const [token, entry] of shared) if (entry.expiry <= now()) shared.delete(token);
    while (shared.size > max) shared.delete(shared.keys().next().value);
  }

  // 返回 { url, width, height, sent }；服务没起来、没填 publicBaseUrl、不是认得的 PNG/JPG 都返回 null。
  // sent()：引用这张图的消息发出去了，开始盯 QQ 来不来取（没发出去就别调，不然会白报一句警告）
  function publish(buffer) {
    const info = imageInfo(buffer);
    if (!listening || !base || !info) return null;
    const token = crypto.randomBytes(16).toString("hex");
    const entry = { buffer, mime: info.mime, expiry: now() + ttlMs, fetched: false };
    shared.set(token, entry);
    prune();
    const sent = () => {
      const timer = setTimeout(() => {
        watching.delete(timer);
        if (!entry.fetched) {
          log("⚠ 合成一条的图发出去 " + Math.round(checkMs / 1000) + " 秒了，还没人来取（" + token.slice(0, 8) + "…）：" +
            "多半是端口没放行或 publicBaseUrl 不对，群里那条消息会没有图");
        }
      }, checkMs);
      timer.unref?.();
      watching.add(timer);
    };
    return { url: base + "/shared/" + token + "." + info.type, width: info.width, height: info.height, sent };
  }

  const server = http.createServer((req, res) => {
    // 只看路径：QQ 取图时万一带了查询串也认得
    let pathname = "";
    try { pathname = new URL(req.url || "/", "http://localhost").pathname; } catch { /* 怪地址当 404 */ }
    const match = (req.method === "GET" || req.method === "HEAD") && pathname.match(/^\/shared\/([0-9a-f]{32})\.(?:png|jpg)$/);
    prune();
    const entry = match ? shared.get(match[1]) : null;
    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    if (!entry.fetched) {
      entry.fetched = true;
      log("合成一条的图有人来取了（" + match[1].slice(0, 8) + "…，" + Math.round(entry.buffer.length / 1024) + " KiB）");
    }
    res.writeHead(200, { "Content-Type": entry.mime, "Content-Length": entry.buffer.length, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
    res.end(entry.buffer);
  });

  return {
    publish,
    port: () => server.address()?.port ?? null,
    get listening() { return listening; },
    // 起来了返回 true；没填地址、端口被占返回 false 并记一句（不抛：Anna 照常启动，翻页另发一条）
    start() {
      if (!base) {
        log("⚠ 开了 pagedImageInMarkdown，但 imageHost.publicBaseUrl 没填：多页的图照旧发图片 + 翻页消息");
        return Promise.resolve(false);
      }
      if (listening) return Promise.resolve(true);
      return new Promise((resolve) => {
        const fail = (error) => {
          log("⚠ 临时图片服务没起来（" + host + ":" + port + "，" + (error?.code || error?.message || error) + "）：多页的图照旧发图片 + 翻页消息");
          resolve(false);
        };
        server.once("error", fail);
        server.listen(port, host, () => {
          server.off("error", fail);
          listening = true;
          log("多页的图跟翻页按钮合成一条：开｜临时图片服务监听 " + host + ":" + server.address().port + "，QQ 从 " + base + "/shared/ 取图");
          resolve(true);
        });
      });
    },
    // 连带断开还连着的（QQ 取图的长连接），不然关机时要等它们自己断
    stop() {
      listening = false;
      shared.clear();
      for (const timer of watching) clearTimeout(timer);
      watching.clear();
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

module.exports = { createImageHost, imageInfo, DEFAULT_PORT };
