"use strict";
// 翻页按钮和翻页消息（pager.cjs）：按钮的排法、绑发起人的标记，按钮被拒 / Markdown 被拒时的正文。
// 端到端（发完图补翻页消息、点按钮、别人点了没有权限）在 level.test.cjs，/搜索歌曲 的在 search.test.cjs。
const test = require("node:test");
const assert = require("node:assert/strict");
const { V } = require("../src/voice.cjs");
const { pagerKeyboard, pagerMessage, ownedData, parseOwnedData } = require("../src/pager.cjs");

const ids = (keyboard) => keyboard.rows.map((row) => row.buttons.map((button) => button.id));
const byId = (keyboard) => Object.fromEntries(keyboard.rows.flatMap((row) => row.buttons).map((button) => [button.id, button]));
const jump = (page) => "/分数列表 14+ " + page;

test("排法：上一页、页码、下一页一行，首页、末页一行；到头的方向不放按钮；不给 input 没有页码按钮", () => {
  const input = "/分数列表 14+ ";
  assert.deepEqual(ids(pagerKeyboard({ page: 1, pages: 3, jump, input })), [["page", "next"], ["last"]]);
  assert.deepEqual(ids(pagerKeyboard({ page: 2, pages: 3, jump, input })), [["prev", "page", "next"], ["first", "last"]]);
  assert.deepEqual(ids(pagerKeyboard({ page: 3, pages: 3, jump, input })), [["prev", "page"], ["first"]]);
  assert.deepEqual(ids(pagerKeyboard({ page: 2, pages: 3, jump })), [["prev", "next"], ["first", "last"]]);

  const buttons = byId(pagerKeyboard({ page: 2, pages: 3, jump, input }));
  assert.deepEqual(["prev", "next", "first", "last"].map((id) => buttons[id].action.data),
    ["/分数列表 14+ 1", "/分数列表 14+ 3", "/分数列表 14+ 1", "/分数列表 14+ 3"]);
  assert.deepEqual(["prev", "next", "first", "last"].map((id) => buttons[id].action.type), [1, 1, 1, 1], "翻页是回调按钮");
  assert.deepEqual([buttons.page.action.type, buttons.page.action.data, buttons.page.action.enter], [2, input, false],
    "页码按钮只填输入框，页数自己补");
  assert.deepEqual([buttons.page.render_data.label, buttons.prev.render_data.label, buttons.last.render_data.label],
    [V.pagerLabels.page(2, 3), V.pagerLabels.prev, V.pagerLabels.last]);
  assert.ok(Object.values(buttons).every((button) => button.action.permission.type === 2 && button.action.unsupport_tips === V.pagerLabels.unsupported));
});

test("绑发起人：回调按钮的 data 带「anna:openid:」，页码按钮不带；解析回来分得开", () => {
  const buttons = byId(pagerKeyboard({ page: 2, pages: 3, jump, input: "/分数列表 14+ ", owner: "U1abc" }));
  assert.equal(buttons.next.action.data, "anna:U1abc:/分数列表 14+ 3");
  assert.equal(buttons.first.action.data, "anna:U1abc:/分数列表 14+ 1");
  assert.equal(buttons.page.action.data, "/分数列表 14+ ", "填进点的人自己的输入框，谁发出去查谁");

  assert.deepEqual(parseOwnedData("anna:U1abc:/分数列表 14+ 2"), { owner: "U1abc", data: "/分数列表 14+ 2" });
  assert.deepEqual(parseOwnedData("anna:U1:/分数列表 MASTER 第2页:还有冒号"), { owner: "U1", data: "/分数列表 MASTER 第2页:还有冒号" });
  assert.deepEqual(parseOwnedData("/搜索歌曲 a --page 2"), { owner: null, data: "/搜索歌曲 a --page 2" }, "没绑人的照旧");
  assert.equal(ownedData(null, "/x"), "/x");
  assert.equal(ownedData("U 1", "/x"), "/x", "不像 openid 的不绑，免得解析不回来");
});

test("翻页消息：带按钮时只写页码和提示；按钮被拒时写回可点的下一页；纯文本写指令；最后一页写已到最后一页", () => {
  const first = pagerMessage({ page: 1, pages: 2, jump, input: "/分数列表 14+ ", owner: "U1" });
  assert.equal(first.markdown, V.pageButtons(1, 2));
  assert.equal(first.text, "第 1/2 页；下一页：/分数列表 14+ 2");
  assert.equal(first.options.markdownWithoutKeyboard,
    '第 1/2 页；下一页：<qqbot-cmd-input text="/分数列表 14+ 2" show="/分数列表 14+ 2" reference="false" />');
  assert.equal(byId(first.options.keyboard).next.action.data, "anna:U1:/分数列表 14+ 2");

  const last = pagerMessage({ page: 2, pages: 2, jump, input: "/分数列表 14+ ", owner: "U1" });
  assert.equal(last.markdown, V.pageButtons(2, 2));
  assert.equal(last.text, "第 2/2 页；已到最后一页");
  assert.equal(last.options.markdownWithoutKeyboard, "第 2/2 页；已到最后一页");

  // 谱师名里有 Markdown 符号：链接照常可点，纯文本原样
  const star = pagerMessage({ page: 1, pages: 2, jump: (page) => "/分数列表 wonder* " + page });
  assert.equal(star.text, "第 1/2 页；下一页：/分数列表 wonder* 2");
  assert.ok(star.options.markdownWithoutKeyboard.includes('text="/分数列表 wonder* 2"'));
  // 指令里有链接写不了的字符（半角双引号）：退成转义过的字
  const quoted = pagerMessage({ page: 1, pages: 2, jump: (page) => '/分数列表 "a_b" ' + page });
  assert.equal(quoted.options.markdownWithoutKeyboard, '第 1/2 页；下一页：/分数列表 "a\\_b" 2');
  assert.equal(quoted.text, '第 1/2 页；下一页：/分数列表 "a_b" 2');
});
