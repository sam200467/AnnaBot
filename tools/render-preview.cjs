#!/usr/bin/env node
"use strict";
// 用正式的出图流程把主题渲染成图片，看看成品长什么样。
//
// 用法：npm run preview -- <主题名> [数据文件] [--out 输出路径] [--scale 2]
//   数据文件默认 themes/<主题>/examples/preview-data.json
//   输出默认   themes/<主题>/previews/preview.png（previews/ 不进仓库，里面有落雪的曲绘）
// 数据里的 "lxns:jacket/407" 这类引用会换成本地缓存的落雪素材，没缓存就先下载。
// 改 CSS 时一遍遍出图太慢，用 npm run theme -- <主题名> 开实时预览，刷新浏览器就能看到。

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../src/config.cjs");
const { createAssets } = require("../src/assets.cjs");
const { createRenderer } = require("../src/renderer.cjs");
const { readExampleData, resolveAssetRefs } = require("./theme-data.cjs");

function args() {
  const list = process.argv.slice(2);
  const option = (name) => {
    const i = list.indexOf(name);
    if (i < 0) return undefined;
    const [, value] = list.splice(i, 2);
    return value;
  };
  const out = option("--out");
  const scale = option("--scale");
  return { theme: list[0], dataFile: list[1], out, scale: scale ? Number(scale) : undefined };
}

async function main() {
  const { theme, dataFile, out, scale } = args();
  if (!theme) throw new Error("用法：npm run preview -- <主题名> [数据文件] [--out 输出路径]");
  const config = loadConfig({ requireQQ: false, requireGroups: false, requireLxns: false, requireFile: false });
  const themesDir = path.join(config.root, "themes");
  const assets = createAssets({ cacheDir: path.join(config.workDir, "cache", "assets"), log: console.log });
  const data = await resolveAssetRefs(readExampleData(themesDir, theme, dataFile), (kind, id) => assets.fileUrl(kind, id));
  const renderer = createRenderer({ themesDir, browserPath: config.browserPath, scale: config.renderScale, log: console.log });
  const image = await renderer.render(theme, data, { ...(scale ? { scale } : {}) });
  const target = path.resolve(out || path.join(themesDir, theme, "previews", "preview." + (image.format === "jpeg" ? "jpg" : "png")));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, image.buffer);
  console.log("已保存：" + target);
}

main().catch((error) => {
  console.error("出图失败：" + (error?.message || error));
  process.exit(1);
});
