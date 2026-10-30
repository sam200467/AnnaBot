"use strict";
// QQ Markdown 的两样小工具：转义和指令链接。/搜索歌曲 的结果、多页图后面补的翻页消息（pager.cjs）共用。
//
// 一行写成一个数组：字符串原样（会转义）；{ text, command } 是指令链接；{ hint } 是只在 Markdown 里出现的提示（不转义）。
// 指令链接的写法：<qqbot-cmd-input text="…" show="…" reference="false" />，点了只填输入框、不直接发出；
// 群里会自动带上 @Anna（MiaBot 2026-10-10 实测）。show 里的 & 和半角双引号要写成 &amp; &quot;。
// 只转 * 和 _：2026-10-11 实测 QQ 认 \* \_，但 \[ \] 会把反斜杠原样显示出来。
// 写法和转义照 MiaBot 的 song-search.cjs（2026-10-11 用 probe-layout 实测过）。

const escapeMarkdown = (text) => String(text).replace(/[*_]/g, (ch) => "\\" + ch);
const showText = (text) => String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const linkable = (text, command) => !/["<>&]/.test(String(command)) && !/[<>]/.test(String(text));

function markdownLine(line) {
  return line.map((part) => {
    if (typeof part === "string") return escapeMarkdown(part);
    if (part.hint) return part.hint;
    if (!linkable(part.text, part.command)) return escapeMarkdown(part.text);
    return '<qqbot-cmd-input text="' + part.command + '" show="' + showText(part.text) + '" reference="false" />';
  }).join("");
}

// 纯文本那份（Markdown 被拒时补发的）：指令链接只留字，提示不要
const plainLine = (line) => line.map((part) => (typeof part === "string" ? part : part.text ?? "")).join("");

module.exports = { escapeMarkdown, showText, linkable, markdownLine, plainLine };
