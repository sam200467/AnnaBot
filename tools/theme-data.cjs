"use strict";
// 预览工具共用：读主题的示例数据，把里面形如 "lxns:jacket/407" 的字符串换成真正的图片地址。
// 示例数据里这样写素材，就不用把落雪的图（和本机路径）写死在仓库里。

const fs = require("node:fs");
const path = require("node:path");

const REF = /^lxns:(jacket|character|trophy|plate|icon)\/(\d+)$/;

function readExampleData(themesDir, theme, file) {
  const target = file ? path.resolve(file) : path.join(themesDir, theme, "examples", "preview-data.json");
  if (!fs.existsSync(target)) throw new Error("找不到示例数据：" + target);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

// resolver(kind, id) 返回地址（可以是 Promise）；数据里所有素材引用并发解析。
async function resolveAssetRefs(data, resolver) {
  const jobs = [];
  const walk = (value, assign) => {
    if (typeof value === "string") {
      const match = value.match(REF);
      if (match) jobs.push(Promise.resolve(resolver(match[1], match[2])).then((url) => assign(url || "")));
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, (next) => { value[i] = next; }));
    } else if (value && typeof value === "object") {
      for (const key of Object.keys(value)) walk(value[key], (next) => { value[key] = next; });
    }
  };
  walk(data, () => {});
  await Promise.all(jobs);
  return data;
}

module.exports = { readExampleData, resolveAssetRefs };
