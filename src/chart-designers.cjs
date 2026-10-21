"use strict";
// 马甲只按有来源的对应表归并；合作署名不自动拆。中文简称由作者补充。
const ALIASES = require("./data/chart-designer-aliases.json");
const IDENTITIES = require("./data/chart-designer-identities.json");
const normalize = (text) => String(text ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");

function createDesignerIndex(songs, aliases = ALIASES, identities = IDENTITIES) {
  const entries = new Map();
  for (const song of songs) {
    if (song.disabled || song.difficulties?.some((chart) => chart.difficulty === 5)) continue;
    for (const chart of song.difficulties || []) {
      if (chart.difficulty !== 3 && chart.difficulty !== 4) continue;
      const name = String(chart.note_designer || "").trim();
      const key = normalize(name);
      if (key && !entries.has(key)) entries.set(key, { key, name, credits: [key] });
    }
  }
  const lookup = new Map(entries);
  for (const [name, group] of Object.entries(identities)) {
    const credits = [...new Set([name, ...group.credits].map(normalize))];
    if (!credits.some((key) => entries.has(key))) continue;
    const entry = { key: normalize(name), name, credits };
    for (const key of credits) {
      const old = lookup.get(key);
      if (old && old.credits.length > 1 && old.key !== entry.key) throw new Error("谱师马甲归属重复：" + key);
      lookup.set(key, entry);
    }
  }
  for (const [name, words] of Object.entries(aliases)) {
    const entry = lookup.get(normalize(name));
    if (!entry) continue;
    for (const word of words) {
      const key = normalize(word);
      if (!key) continue;
      // 重复别名不能悄悄选中另一个谱师，直接报错便于维护。
      if (lookup.has(key) && lookup.get(key) !== entry) throw new Error("谱师别名重复：" + word);
      lookup.set(key, entry);
    }
  }
  return { resolve: (text) => lookup.get(normalize(text)) || null };
}

function parseDesignerQuery(args, index) {
  if (!index) return null;
  const text = String(args || "").normalize("NFKC").trim();
  const unquote = (name) => name.replace(/^["“](.*)["”]$/, "$1");
  // 先试完整署名，避免把署名本身末尾的数字吃成页码。
  let designer = index.resolve(unquote(text));
  if (designer) return { designer, designerInput: unquote(text), page: null };
  const pageMatch = text.match(/^(.*?)\s+(\d+)$/);
  if (pageMatch) {
    designer = index.resolve(unquote(pageMatch[1]));
    if (designer) {
      const page = Number(pageMatch[2]);
      return { designer, designerInput: unquote(pageMatch[1]), page, designerError: Number.isSafeInteger(page) && page > 0 ? null : "usage" };
    }
  }
  // 已认出谱师后再带紫、等级等条件，明确提示这里只接受名字和数字页码。
  const tokens = text.split(/\s+/);
  for (let end = tokens.length - 1; end > 0; end--) {
    if (index.resolve(unquote(tokens.slice(0, end).join(" ")))) return { designerError: "only" };
  }
  return null;
}

module.exports = { createDesignerIndex, parseDesignerQuery, normalize };
