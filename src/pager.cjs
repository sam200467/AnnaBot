"use strict";
// 翻页按钮和翻页消息，照 MiaBot 的 qq-official/pager-buttons.cjs（按钮）和 mia-commands.cjs 的 pagingOf（/等级 的翻页消息）。
// /搜索歌曲 是文字结果，按钮直接挂在结果那条 Markdown 下面；/分数列表 是图，图片消息挂不了按钮（按钮只能跟 Markdown），
// 所以发完图另补一条翻页消息（pagerMessage，由 commands.cjs 的出图队列发）。
//
// 排法：上一页、页码、下一页一行，首页、末页一行。分两行是因为一行五个会被挤成「⏮…」——
// 点按钮发出的那页不带引用，QQ 给的气泡窄（MiaBot 2026-10-10 线上截图）。
// 翻页是回调按钮（type 1）：点了平台推 INTERACTION_CREATE，按钮里存的指令当这个人发的话执行，群里不多一条消息。
// 页码是指令按钮（type 2，enter=false）：只把 input 填进输入框，页数让用户自己补；不给 input 就不放页码按钮。
// 到头的方向不放按钮，免得点了只得到一句「没有这一页」。
// 字段出处：bot.q.qq.com/wiki 的「消息按钮」。permission.type=2 是所有人可点。
//
// owner：翻的是发起人自己的成绩时（/分数列表），回调按钮的 data 写成「anna:<openid>:<指令>」，
// bot.cjs 收到回调时比对点击人，别人点了应答 4「没有权限」、不执行 —— 不然别人一点，翻出来的是点的人自己的成绩，
// 还占着发起人那条消息的回复次数。页码按钮不绑：它只把指令填进点的人自己的输入框，谁发出去查的就是谁（MiaBot 同样）。
// /搜索歌曲 查的是公开曲库，谁点都行，不绑。

const { V } = require("./voice.cjs");
const { escapeMarkdown, markdownLine, plainLine } = require("./markdown.cjs");

// openid 只有字母数字（MiaBot 的「mia:」也是这么分的），冒号分得开；不像 openid 的就不绑，免得解析不回来
const OWNER_ID = /^[A-Za-z0-9_-]+$/;
const OWNED = /^anna:([A-Za-z0-9_-]+):([\s\S]+)$/;
const ownedData = (owner, data) => (owner && OWNER_ID.test(String(owner)) ? "anna:" + owner + ":" + data : data);
function parseOwnedData(data) {
  const match = String(data ?? "").match(OWNED);
  return match ? { owner: match[1], data: match[2] } : { owner: null, data: String(data ?? "") };
}

// jump(page)：翻到那一页要执行的指令；input：页码按钮填进输入框的前缀，用户在后面补数字就是那一页
function pagerKeyboard({ page, pages, jump, input = null, owner = null, labels = V.pagerLabels }) {
  const button = (id, label, style, action) => ({
    id, render_data: { label, visited_label: label, style },
    action: { permission: { type: 2 }, unsupport_tips: labels.unsupported, ...action },
  });
  const go = (id, label, target) => button(id, label, 1, { type: 1, data: ownedData(owner, jump(target)) });
  const pageButton = input ? [button("page", labels.page(page, pages), 0, { type: 2, data: input, enter: false })] : [];
  const rows = [
    [...(page > 1 ? [go("prev", labels.prev, page - 1)] : []), ...pageButton, ...(page < pages ? [go("next", labels.next, page + 1)] : [])],
    [...(page > 1 ? [go("first", labels.first, 1)] : []), ...(page < pages ? [go("last", labels.last, pages)] : [])],
  ];
  return { rows: rows.filter((buttons) => buttons.length).map((buttons) => ({ buttons })) };
}

// 没有按钮时正文里的那行：「第 1/3 页；下一页：<可点的指令>」，最后一页是「第 3/3 页；已到最后一页」（markdown.cjs 的写法）
function pageLine(page, pages, next, voice = V) {
  return [voice.pageOf(page, pages) + "；", ...(next ? [voice.pageNext, { text: next, command: next }] : [voice.pageLast])];
}

// 多页的图发完以后补的那条翻页消息。返回 sendMarkdown 要的三样：
//   markdown  带按钮时的正文，只写「第 1/3 页，点下面的按钮翻页；点页码可以自己填页数」
//   text      Markdown 被拒时补发的纯文本：「第 1/3 页；下一页：/分数列表 14+ 2」
//   options   按钮，和按钮被拒（或配置关了按钮）时改发的正文 —— 下一页写回可点的指令（见 official-transport.cjs 的 sendMarkdown）
function pagerMessage({ page, pages, jump, input = null, owner = null, voice = V }) {
  const line = pageLine(page, pages, page < pages ? jump(page + 1) : null, voice);
  return {
    markdown: escapeMarkdown(voice.pageButtons(page, pages)),
    text: plainLine(line),
    options: {
      keyboard: pagerKeyboard({ page, pages, jump, input, owner, labels: voice.pagerLabels }),
      markdownWithoutKeyboard: markdownLine(line),
    },
  };
}

module.exports = { pagerKeyboard, pagerMessage, pageLine, ownedData, parseOwnedData };
