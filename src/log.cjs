"use strict";
// 日志：打到控制台，同时按天写进 dir/anna-YYYY-MM-DD.log，keepDays 天前的文件启动时删掉。
// 密钥（.env 里那几个值）和 QQBot / Bearer 令牌一律抹成 ***，免得贴日志排障时把密钥贴出去。

const fs = require("node:fs");
const path = require("node:path");
const { inspect } = require("node:util");

function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return {
    day: date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate()),
    time: p(date.getHours()) + ":" + p(date.getMinutes()) + ":" + p(date.getSeconds()),
  };
}

function createLog({ dir = "", secrets = [], keepDays = 14, out = console, now = () => new Date() } = {}) {
  const masks = secrets.filter((value) => value && value.length >= 6);
  const redact = (text) => {
    let result = String(text);
    for (const value of masks) result = result.split(value).join("***");
    return result.replace(/QQBot [\w.-]+/g, "QQBot ***").replace(/Bearer [\w.~+/=-]+/g, "Bearer ***");
  };

  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    const cutoff = now().getTime() - keepDays * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      const match = name.match(/^anna-(\d{4}-\d{2}-\d{2})\.log$/);
      if (match && new Date(match[1] + "T00:00:00").getTime() < cutoff) {
        try { fs.rmSync(path.join(dir, name)); } catch { /* 删不掉下次再说 */ }
      }
    }
  }

  const log = (...parts) => {
    const { day, time } = stamp(now());
    const line = "[" + time + "] " + redact(parts.map((part) => (typeof part === "string" ? part : inspect(part))).join(" "));
    out.log(line);
    if (dir) {
      try { fs.appendFileSync(path.join(dir, "anna-" + day + ".log"), line + "\n"); }
      catch { /* 日志写不进去不该让机器人挂掉 */ }
    }
  };
  log.redact = redact;
  return log;
}

module.exports = { createLog };
