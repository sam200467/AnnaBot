#!/usr/bin/env node
"use strict";
// 只取五张谱师汇总页，缓存优先；串行、至少隔 45 秒，403/429 立即停，不自动重试、不换线路。
// 作者明确要求继续时可用 --resume，在至少五分钟冷却后开启新一轮；默认仍冷却一小时。
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const dir = path.resolve(__dirname, "../data/wiki-pages/designers");
const stateFile = path.join(dir, "requests.json");
const delay = 45000;
async function main() {
  fs.mkdirSync(dir, { recursive: true });
  const cached = (page) => fs.existsSync(path.join(dir, page + ".html")) || fs.existsSync(path.join(dir, page + ".wiki.txt"));
  if ([1, 2, 3, 4, 5].every(cached)) { console.log("五张汇总页已有缓存，不发送网络请求"); return; }
  let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
  const cooldown = process.argv.includes("--resume") ? 5 * 60 * 1000 : 60 * 60 * 1000;
  const remaining = state.blockedAt ? cooldown - (Date.now() - state.blockedAt) : 0;
  if (remaining > 0) throw new Error("此前访问被拒，仍需冷却 " + Math.ceil(remaining / 1000) + " 秒；缓存仍可使用");
  for (let page = 1; page <= 5; page++) {
    const file = path.join(dir, page + ".html");
    if (cached(page)) { console.log("使用缓存：" + page); continue; }
    const wait = Math.max(0, delay - (Date.now() - (state.lastRequest || 0)));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    state.lastRequest = Date.now();
    fs.writeFileSync(stateFile, JSON.stringify(state));
    const url = "https://wikiwiki.jp/chunithmwiki/" + encodeURIComponent("譜面制作者一覧" + page);
    const result = execFileSync("curl.exe", ["-sS", "--max-time", "45", "-w", "\n%{http_code}", url],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    const split = result.lastIndexOf("\n");
    const status = Number(result.slice(split + 1));
    if (status === 403 || status === 429) {
      fs.writeFileSync(path.join(dir, page + ".denied.html"), result.slice(0, split));
      state.blockedAt = Date.now();
      fs.writeFileSync(stateFile, JSON.stringify(state));
      throw new Error("wikiwiki HTTP " + status + "，已停止所有请求；保留已下载缓存");
    }
    if (status !== 200) throw new Error("wikiwiki HTTP " + status + "，停止请求");
    const html = result.slice(0, split);
    if (!html.includes("ノーツデザイナー名")) throw new Error("页面内容不符合预期，停止请求");
    fs.writeFileSync(file, html);
    console.log("已缓存汇总页 " + page + "：" + Buffer.byteLength(html) + " 字节");
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
