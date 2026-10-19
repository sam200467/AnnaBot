"use strict";
// 生成 src/data/fit-diffs.json：EazyChu 的拟合定数快照，/拟合定数b30 用。
//
// EazyChu 是小程序，接口没有公开文档；这个地址是从小程序包里的 app-service.js 找到的（2026-10-19 实测）：
//   GET https://easychu.godserver.cn/user/chu/chart-stats/all
// 一次返回全部曲目，charts 以曲目 ID 为键、按难度顺序给出 fit_diff。这里只留 fit_diff，
// 不带玩家成绩、样本数这些；文件几万字节，随程序发布，运行时不用联网。
//
// 新版本出曲后重新跑一次：npm run fit-diffs
// 表里没有的谱面（新曲、WORLD'S END）运行时退回官方定数，并在图注里说明有几张。

const fs = require("node:fs");
const path = require("node:path");

const API = "https://easychu.godserver.cn/user/chu/chart-stats/all";
const OUT = path.join(__dirname, "..", "src", "data", "fit-diffs.json");

async function main() {
  const response = await fetch(API, {
    headers: { "User-Agent": "AnnaBot/fit-diffs" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("EazyChu 接口返回 HTTP " + response.status);
  const payload = await response.json();
  if (!payload || typeof payload.charts !== "object") throw new Error("EazyChu 返回的数据里没有 charts");

  const charts = {};
  for (const [songId, list] of Object.entries(payload.charts)) {
    if (!Array.isArray(list)) continue;
    const values = list.map((entry) => {
      const value = Number(entry?.fit_diff);
      return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : null;
    });
    // 末尾的空位（比如没有 ULTIMA 的曲子）不用写；中间缺的保留 null，难度下标才对得上
    while (values.length && values[values.length - 1] === null) values.pop();
    if (values.some((value) => value !== null)) charts[String(Number(songId))] = values;
  }

  const sorted = {};
  for (const key of Object.keys(charts).sort((a, b) => Number(a) - Number(b))) sorted[key] = charts[key];
  const capturedAt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const data = { source: "EazyChu /user/chu/chart-stats/all", capturedAt, charts: sorted };
  fs.writeFileSync(OUT, JSON.stringify(data) + "\n");
  const values = Object.values(sorted).reduce((total, list) => total + list.filter((value) => value !== null).length, 0);
  console.log("写入 " + OUT + "： " + Object.keys(sorted).length + " 首， " + values + " 张谱面，抓取日期 " + capturedAt);
}

main().catch((error) => {
  console.error("生成拟合定数失败：" + error.message);
  process.exitCode = 1;
});
