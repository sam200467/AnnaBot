#!/usr/bin/env node
"use strict";
// 从本地曲库导出原始署名和紫/黑谱数量，供作者填写中文别名。不把马甲猜成同一个人。
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const cache = JSON.parse(fs.readFileSync(path.join(root, "data/cache/songs.json"), "utf8"));
const aliases = require("../src/data/chart-designer-aliases.json");
const identities = require("../src/data/chart-designer-identities.json");
const { normalize } = require("../src/chart-designers.cjs");
const counts = new Map();
for (const song of cache.data.songs) {
  if (song.disabled || song.difficulties?.some((chart) => chart.difficulty === 5)) continue;
  for (const chart of song.difficulties || []) {
    if (chart.difficulty !== 3 && chart.difficulty !== 4) continue;
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
    master: sum.master + row.master, ultima: sum.ultima + row.ultima, total: sum.total + row.total, credits: sum.credits + 1,
  }), { master: 0, ultima: 0, total: 0, credits: 0 });
};
const groups = Object.entries(identities).map(([name, group]) => ({ name, group, ...totals(group.credits) }))
  .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));
const owners = new Map(groups.flatMap(({ name, group }) => group.credits.map((credit) => [normalize(credit), name])));
const cell = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\|/g, "&#124;").replace(/\*/g, "&#42;").replace(/_/g, "&#95;").replace(/`/g, "&#96;").replace(/[\r\n]+/g, " ");
const lines = ["# 谱师署名与别名填写清单", "",
  "数据来源：本地落雪曲库缓存；缓存时间：" + new Date(cache.fetchedAt).toISOString() + "。",
  "范围：未删除的 MASTER／ULTIMA，不含 WORLD'S END。共 " + rows.length + " 种原始署名、" + rows.reduce((sum, row) => sum + row.total, 0) + " 张谱面。",
  "", "署名包含马甲和合作署名，不等于独立谱师人数；仅合并下表有来源的马甲关系，未确认的保留原始署名，合作谱不自动拆分。原始清单按谱面总数从多到少排列。",
  "", "命令直接写名字或别名，例如 `/分数列表 Techno Kitchen`，翻页写 `/分数列表 Techno Kitchen 2`。名字有空格也不用引号。只接受名字和数字页码。",
  "", "可以填写表格最后一栏，或在聊天里按“原始署名 = 别名1、别名2”发给我。实际生效的别名维护在 `src/data/chart-designer-aliases.json`，格式为：",
  "", "```json", '{', '  "原始署名": ["中文别名1", "中文别名2"]', '}', "```",
  "", "重新导出清单：`node tools/list-chart-designers.cjs`。重新导出会覆盖此表格，先把手填别名保存到别名 JSON。修改 JSON 后重启机器人生效。",
  "", "## 谱师名义归并表（优先在这里添加中文别名）", "",
  "2026-10-21 已读取并缓存 wiki 的五张谱师汇总页，核对单人栏目、明确的别名跳转和合作/未知栏目。",
  "共整理 " + groups.length + " 组名义，覆盖 " + rows.filter((row) => owners.has(normalize(row.name))).length + " 种本地原始署名。这不是独立人数统计，真身仅为推测的 Violetta、Ragnarok 等仍单独保留。",
  "合作署名、归属不明以及无法与本地署名严格对应的条目不强行合并。组内完整马甲和来源见 [马甲明细](chart-designer-credits.md)。",
  "作者确认：Violetta、Ragnarok、START \"A I R \"、Fahrenheit 212、透明絵具各自独立，不按推测归入其他谱师；Toaster 不添加。START \"A I R \" 当前本地曲库没有相应谱面，有实际署名数据时按原名识别。",
  "马甲关系维护在 `src/data/chart-designer-identities.json`；中文简称写在别名表本名或马甲名下均可。同组名字查询同一批谱面。",
  "", "| 谱师名义 | 原始署名数 | 紫谱 | 黑谱 | 合计 | 中文别名（可填写） | 来源 |", "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  ...groups.map(({ name, group, master, ultima, total, credits }) => `| ${cell(name)} | ${credits} | ${master} | ${ultima} | ${total} | ${cell((aliases[name] || []).join("、"))} | [wiki](${group.source}) |`),
  "", "## 全部原始署名", "",
  "未确认归属的留空；填写中文别名时，已归并的优先填在上面的谱师表中。",
  "", "| 序号 | 原始署名 | 已确认归属 | 紫谱 | 黑谱 | 合计 | 别名（可填写） |", "| ---: | --- | --- | ---: | ---: | ---: | --- |",
  ...rows.map((row, i) => `| ${i + 1} | ${cell(row.name)} | ${cell(owners.get(normalize(row.name)) || "")} | ${row.master} | ${row.ultima} | ${row.total} | ${cell((aliases[row.name] || []).join("、"))} |`), ""];
const target = path.join(root, "docs/chart-designers.md");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, lines.join("\n"));
const details = ["# 谱师名义与完整马甲明细", "", "来源：wikiwiki.jp 的谱师汇总页 1～5。只归并单人栏目中的明确署名和别名，不把推测身份当成事实。",
  "同一组中可能出现带 vs 的“一人合作”署名；真实合作栏的署名不拆给个人。来源位置、对应曲目和难度保存在归属 JSON 的 evidenceByCredit 中。",
  "零张的名字是 wiki 明确指向该人的别名，当前国服曲库里没有以此名字署名的紫谱或黑谱。", "", "返回 [别名填写清单](chart-designers.md)。", ""];
for (const { name, group, total } of groups) {
  details.push("## " + cell(name), "", "合计 " + total + " 张谱面。来源：" + (group.sources || [group.source]).map((url, i) => `[wiki ${i + 1}](${url})`).join("、") + "。", "",
    "| 署名 / 已确认马甲 | 紫谱 | 黑谱 | 合计 |", "| --- | ---: | ---: | ---: |");
  for (const credit of group.credits) {
    const count = totals([credit]);
    details.push(`| ${cell(credit)} | ${count.master} | ${count.ultima} | ${count.total} |`);
  }
  details.push("");
}
fs.writeFileSync(path.join(root, "docs/chart-designer-credits.md"), details.join("\n"));
console.log("已导出 " + rows.length + " 种署名：" + target);
