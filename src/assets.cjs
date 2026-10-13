"use strict";
// 落雪的图片素材（曲绘、角色、名牌版、称号、地图头像）本地缓存：cacheDir/<种类>/<ID>.png。
//
// 落雪的素材服务器很慢（2026-10-13 实测一张曲绘 0.3～16 秒不等），文档还写着有频率限制，所以：
//   - 有缓存就一直用缓存（这些图不会变）
//   - 同一张图同时只下载一次，别的请求等着同一个结果
//   - 404 在内存里记一小时，不反复去撞
// 出图时把 fileUrl() 给的 file:// 地址放进主题数据（渲染器开了 --allow-file-access-from-files），
// 主题里不要直接写落雪的网址：浏览器去拉一张慢图，整张图就跟着卡住。
//
// 种类和落雪的路径一一对应（https://assets2.lxns.net/chunithm/<种类>/<ID>.png）：
//   jacket 曲绘（WE 用原曲 ID，见 catalog.jacketId）、character 角色、trophy 称号（只有图片称号有）、
//   plate 名牌版、icon 地图头像

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const KINDS = new Set(["jacket", "character", "trophy", "plate", "icon"]);
const DEFAULT_BASE = "https://assets2.lxns.net/chunithm";

function looksLikeImage(buffer) {
  if (buffer.length < 12) return false;
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return true;              // PNG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;                      // JPEG
  return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

function createAssets({ cacheDir, baseUrl = DEFAULT_BASE, fetchImpl = fetch, timeoutMs = 45000,
  missTtlMs = 60 * 60 * 1000, now = Date.now, log = () => {} } = {}) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const inflight = new Map();   // "kind/id" -> Promise<路径 | null>
  const misses = new Map();     // "kind/id" -> 到期时间

  function fileOf(kind, id) {
    if (!KINDS.has(kind)) throw new Error("不认识的素材种类：" + kind);
    const name = String(id);
    if (!/^\d{1,8}$/.test(name)) throw new Error("素材 ID 只能是数字：" + name);
    return path.join(cacheDir, kind, name + ".png");
  }

  async function download(kind, id, file) {
    let res;
    try {
      res = await fetchImpl(base + "/" + kind + "/" + id + ".png", { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new Error("下载素材 " + kind + "/" + id + " 失败：" + (error?.name === "TimeoutError" ? "超时" : error?.cause?.code || error?.message));
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("下载素材 " + kind + "/" + id + " 失败：HTTP " + res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!looksLikeImage(buffer)) throw new Error("素材 " + kind + "/" + id + " 不是图片");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + "." + process.pid + ".tmp";
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, file);
    return file;
  }

  // 本地文件路径；落雪上没有这张图时是 null，下载出错时抛错。
  function file(kind, id) {
    const target = fileOf(kind, id);
    if (fs.existsSync(target)) return Promise.resolve(target);
    const cacheKey = kind + "/" + id;
    if ((misses.get(cacheKey) || 0) > now()) return Promise.resolve(null);
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const job = download(kind, id, target)
      .then((result) => {
        if (!result) misses.set(cacheKey, now() + missTtlMs);
        return result;
      })
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, job);
    return job;
  }

  async function fileUrl(kind, id) {
    const target = await file(kind, id);
    return target ? pathToFileURL(target).href : null;
  }

  // 一次要很多张（比如 B30 的 50 张曲绘）：限并发，单张失败不影响别的，失败的那张给 null。
  async function fileUrls(items, { concurrency = 4 } = {}) {
    const results = new Array(items.length).fill(null);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        const [kind, id] = items[i];
        try { results[i] = await fileUrl(kind, id); }
        catch (error) { log("素材下载失败：" + error.message); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
  }

  return { file, fileUrl, fileUrls, KINDS: [...KINDS] };
}

module.exports = { createAssets, looksLikeImage };
