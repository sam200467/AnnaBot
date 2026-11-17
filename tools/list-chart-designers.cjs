#!/usr/bin/env node
"use strict";
// 从本地曲库导出原始署名和紫/黑谱数量，供作者填写中文别名。合作署名归入每位参与谱师；未确认归属的保持独立。
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const cache = JSON.parse(fs.readFileSync(path.join(root, "data/cache/songs.json"), "utf8"));
const aliases = require("../src/data/chart-designer-aliases.json");
const identities = require("../src/data/chart-designer-identities.json");
const { normalize } = require("../src/chart-designers.cjs");

const counts = new Map();
const masterTitles = new Set();
for (const song of cache.data.songs) {
  if (song.disabled || song.difficulties?.some((chart) => chart.difficulty === 5)) continue;
  for (const chart of song.difficulties || []) {
    if (chart.difficulty !== 3 && chart.difficulty !== 4) continue;
    if (chart.difficulty === 3 && song.title) masterTitles.add(normalize(song.title));
    const name = String(chart.note_designer || "").trim();
    if (!name) continue;
    if (!counts.has(name)) counts.set(name, { name, master: 0, ultima: 0, total: 0 });
    const row = counts.get(name);
    row[chart.difficulty === 3 ? "master" : "ultima"]++;
    row.total++;
  }
}
const rows = [...counts.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));
const totals = (credits) => {
  const keys = new Set(credits.map(normalize));
  return rows.filter((row) => keys.has(normalize(row.name))).reduce((sum, row) => ({
    master: sum.master + row.master,
    ultima: sum.ultima + row.ultima,
    total: sum.total + row.total,
    credits: sum.credits + 1,
  }), { master: 0, ultima: 0, total: 0, credits: 0 });
};
const groups = Object.entries(identities).map(([name, group]) => {
  const allCredits = [...new Set([...(group.credits || []), ...(group.jointCredits || [])])];
  const base = totals(allCredits);
  const jointSongsCount = (group.jointSongs || []).filter((title) => masterTitles.has(normalize(title))).length;
  return { name, group, master: base.master + jointSongsCount, ultima: base.ultima, total: base.total + jointSongsCount, credits: base.credits, jointSongsCount };
}).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));

const owners = new Map();
for (const { name, group } of groups) {
  for (const credit of [...(group.credits || []), ...(group.jointCredits || [])]) {
    const k = normalize(credit);
    if (!owners.has(k)) owners.set(k, []);
    if (!owners.get(k).includes(name)) owners.get(k).push(name);
  }
}

const cell = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\|/g, "&#124;").replace(/\*/g, "&#42;").replace(/_/g, "&#95;").replace(/`/g, "&#96;").replace(/[\r\n]+/g, " ");
const lines = ["# 谱师署名与别名填写清单", "",
  "数据来源：本地落雪曲库缓存；缓存时间：" + new Date(cache.fetchedAt).toISOString() + "。",
  "范围：未删除的 MASTER／ULTIMA，不含 WORLD'S END。共 " + rows.length + " 种原始署名、" + rows.reduce((sum, row) => sum + row.total, 0) + " 张谱面。",
  "", "署名包含马甲和合作署名，不等于独立谱师人数；合作署名按 wiki 栏目与署名规则分别归入每位参与谱师。原始清单按谱面总数从多到少排列。",
  "", "命令直接写名字或别名，例如 `/分数列表 Techno Kitchen`，翻页写 `/分数列表 Techno Kitchen 2`。名字有空格也不用引号。只接受名字和数字页码。",
  "", "可以填写表格最后一栏，或在聊天里按“原始署名 = 别名1、别名2”发给我。实际生效的别名维护在 `src/data/chart-designer-aliases.json`，格式为：",
  "", "```json", '{', '  "原始署名": ["中文别名1", "中文别名2"]', '}', "```",
  "", "重新导出清单：`node tools/list-chart-designers.cjs`。重新导出会覆盖此表格，先把手填别名保存到别名 JSON。修改 JSON 后重启机器人生效。",
  "", "## 谱师名义归并表（优先在这里添加中文别名）", "",
  "已读取并缓存 wiki 的五张谱师汇总页，核对单人栏目、明确的别名跳转以及合作栏目（含 wikiwiki.jp 查实的合作团队内译名）。",
  "共整理 " + groups.length + " 组名义，覆盖 " + rows.filter((row) => owners.has(normalize(row.name))).length + " 种本地原始署名。真身仅为推测的 Violetta、Ragnarok 等仍单独保留。",
  "组内完整马甲、合作署名和来源见 [马甲明细](chart-designer-credits.md)。",
  "作者确认：Violetta、Ragnarok、START \"A I R \"、Fahrenheit 212、透明絵具各自独立，不按推测归入其他谱师；Toaster 不添加；翠楼屋归入サファ太，緑化委員長归入はっぴー。START \"A I R \" 当前本地曲库没有相应谱面，有实际署名数据时按原名识别。",
  "马甲关系维护在 `src/data/chart-designer-identities.json`；中文简称写在别名表本名或单人马甲名下均可。同组名字查询同一批谱面。",
  "", "| 谱师名义 | 原始署名数 | 紫谱 | 黑谱 | 合计 | 中文别名（可填写） | 来源 |", "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  ...groups.map(({ name, group, master, ultima, total, credits }) => `| ${cell(name)} | ${credits} | ${master} | ${ultima} | ${total} | ${cell((aliases[name] || []).join("、"))} | [wiki](${group.source}) |`),
  "", "## 全部原始署名", "",
  "未确认归属的留空；填写中文别名时，已归并的优先填在上面的谱师表中。",
  "", "| 序号 | 原始署名 | 已确认归属 | 紫谱 | 黑谱 | 合计 | 别名（可填写） |", "| ---: | --- | --- | ---: | ---: | ---: | --- |",
  ...rows.map((row, i) => `| ${i + 1} | ${cell(row.name)} | ${cell((owners.get(normalize(row.name)) || []).join("、"))} | ${row.master} | ${row.ultima} | ${row.total} | ${cell((aliases[row.name] || []).join("、"))} |`), ""];
const target = path.join(root, "docs/chart-designers.md");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, lines.join("\n"));
const details = ["# 谱师名义与完整马甲明细", "", "来源：wikiwiki.jp 的谱师汇总页 1～5 与对应曲目页。单人署名、合作署名与团队合作曲分别列出，合作谱计入每位参与谱师。",
  "零张的名字是 wiki 明确指向该人的别名，当前国服曲库里没有以此名字署名的紫谱或黑谱。", "", "返回 [别名填写清单](chart-designers.md)。", ""];
for (const { name, group, total } of groups) {
  details.push("## " + cell(name), "", "合计 " + total + " 张谱面。来源：" + (group.sources || [group.source]).map((url, i) => `[wiki ${i + 1}](${url})`).join("、") + "。", "",
    "| 署名 / 已确认马甲 | 类型 | 紫谱 | 黑谱 | 合计 |", "| --- | --- | ---: | ---: | ---: |");
  for (const credit of group.credits || []) {
    const count = totals([credit]);
    details.push(`| ${cell(credit)} | 单人 | ${count.master} | ${count.ultima} | ${count.total} |`);
  }
  for (const credit of group.jointCredits || []) {
    const count = totals([credit]);
    details.push(`| ${cell(credit)} | 合作 | ${count.master} | ${count.ultima} | ${count.total} |`);
  }
  for (const title of group.jointSongs || []) {
    const has = masterTitles.has(normalize(title)) ? 1 : 0;
    details.push(`| ${cell(title)} (MASTER) | 合作曲 | ${has} | 0 | ${has} |`);
  }
  details.push("");
}
fs.writeFileSync(path.join(root, "docs/chart-designer-credits.md"), details.join("\n"));
console.log("已导出 " + rows.length + " 种署名：" + target);
