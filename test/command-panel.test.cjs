"use strict";
// 指令面板（src/command-panel.cjs）：清单怎么从功能表来、长度怎么算，以及跟假平台（mock-official）对面板的整个过程。
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockOfficial } = require("./mock-official.cjs");
const { createOfficial } = require("../src/official-transport.cjs");
const { createCommands } = require("../src/commands.cjs");
const panel = require("../src/command-panel.cjs");
const features = require("../src/features/index.cjs");

async function setup(t) {
  const qq = createMockOfficial();
  await qq.start();
  const transport = createOfficial({ appId: "1", clientSecret: "x", tokenUrl: qq.tokenUrl, apiBase: qq.apiBase, sandboxApiBase: qq.apiBase });
  t.after(async () => {
    transport.stop();
    await qq.stop();
  });
  const sync = (options = {}) => panel.syncPanels({ rest: transport.rest, features, groups: ["G1"], privateChat: true, ...options });
  const byScope = (scope) => [...qq.state.panels.values()].filter((p) => p.scope === scope);
  const writes = (from = 0) => qq.state.panelCalls.slice(from).filter((call) => call.method !== "GET");
  return { qq, transport, sync, byScope, writes };
}

const extra = { name: "extra", words: ["测试"], usage: "/测试", summary: "测试用", run() {} };

test("清单来自功能表：管理员和隐藏指令不进，顺序跟帮助一样，点出来的字能当指令用", () => {
  const items = panel.panelItems(features);
  const visible = features.filter((feature) => !feature.hidden && !feature.adminOnly && feature.panel !== false);
  assert.deepEqual(items.map((item) => item.name), visible.map((feature) => "/" + feature.words[0]));
  assert.ok(!items.some((item) => item.name === "/示例图" || item.name === "/刷新曲库"));
  // 点一下就是把 name 填进输入框，所以它必须是认得出来的指令
  const commands = createCommands({ features, send: { text() {}, image() {} } });
  for (const [i, item] of items.entries()) assert.equal(commands.parse(item.name)?.feature, visible[i], item.name);
});

test("每条都在平台的长度上限以内（加了新功能、summary 太长时这里会报：给它写个短的 panel）", () => {
  assert.doesNotThrow(() => panel.validateItems(panel.panelItems(features)));
  for (const item of panel.panelItems(features)) {
    assert.equal(item.type, "command");
    assert.ok(item.desc, item.name + " 没有说明");
  }
});

test("字符按平台的算法数：中文和全角标点算 2 个", () => {
  assert.equal(panel.width("/b50"), 4);
  assert.equal(panel.width("用好友码绑定落雪账号"), 20);
  // MiaBot 被拒的那句是 32；改成半角括号正好 30，平台收了
  const item = (desc) => [{ type: "command", name: "/绑定", desc }];
  assert.throws(() => panel.validateItems(item("把你的大饼账号交给美亚（要私聊）")), /有 32 个字符，最多 30/);
  assert.doesNotThrow(() => panel.validateItems(item("把你的大饼账号交给美亚(要私聊)")));
  assert.throws(() => panel.validateItems([{ type: "command", name: "/八个汉字的指令名", desc: "" }]), /太长/);
  assert.throws(() => panel.validateItems(Array.from({ length: 21 }, (_, i) => ({ type: "command", name: "/n" + i, desc: "" }))), /最多 20 条/);
  assert.throws(() => panel.validateItems([]), /一条指令都没有/);
});

test("第一次同步：群聊面板只挂白名单里的群，私聊面板对所有人", async (t) => {
  const s = await setup(t);
  assert.equal(await s.sync({ groups: ["G1", "G2"] }), "群聊新建了（2 个群），私聊新建了");
  const [group] = s.byScope("group");
  assert.equal(group.target_type, "specific");
  assert.deepEqual([...group.targets], ["G1", "G2"]);
  // 平台存的时候去掉了斜杠
  assert.deepEqual(group.panel.items.map((item) => item.name), panel.panelItems(features).map((item) => item.name.slice(1)));
  assert.equal(group.panel.remark, panel.REMARK);
  const [c2c] = s.byScope("c2c");
  assert.equal(c2c.target_type, "all");
  assert.equal(c2c.targets.size, 0);
});

test("内容和群都没变：一个写请求都不发（平台读回来的样子跟发的不一样，比之前要归一化）", async (t) => {
  const s = await setup(t);
  await s.sync();
  const from = s.qq.state.panelCalls.length;
  assert.equal(await s.sync(), "群聊没变（1 个群），私聊没变");
  assert.deepEqual(s.writes(from), []);
});

test("功能表变了改内容、白名单变了增删群，都不重建", async (t) => {
  const s = await setup(t);
  await s.sync({ groups: ["G1", "G2"] });
  const ids = [...s.qq.state.panels.keys()];
  const from = s.qq.state.panelCalls.length;
  assert.equal(await s.sync({ features: [...features, extra], groups: ["G2", "G3"] }), "群聊更新了内容和群（2 个群），私聊更新了内容");
  assert.deepEqual([...s.qq.state.panels.keys()], ids);
  assert.ok(!s.writes(from).some((call) => call.method === "POST" || call.method === "DELETE"));
  assert.deepEqual([...s.byScope("group")[0].targets].sort(), ["G2", "G3"]);
  for (const scope of ["group", "c2c"]) assert.equal(s.byScope(scope)[0].panel.items.at(-1).name, "测试");
});

test("关了私聊就撤掉私聊面板；别人建的面板不碰", async (t) => {
  const s = await setup(t);
  await s.transport.rest("POST", "/v2/panels", { scope: "c2c", target_type: "all", panel: { items: [{ type: "command", name: "/别的", desc: "别人的" }], remark: "别人的面板" } });
  await s.sync();
  assert.equal(s.byScope("c2c").length, 2);
  assert.equal(await s.sync({ privateChat: false }), "群聊没变（1 个群），私聊撤了");
  assert.deepEqual(s.byScope("c2c").map((p) => p.panel.remark), ["别人的面板"]);
  assert.equal(await s.sync({ privateChat: false }), "群聊没变（1 个群），私聊不挂");
});

test("自己的面板多出来的（两个 Anna 同时启动各建一个之类）删掉，只留最新的", async (t) => {
  const s = await setup(t);
  const body = { scope: "group", target_type: "specific", group_openids: ["G1"], panel: { items: panel.panelItems(features), remark: panel.REMARK } };
  await s.transport.rest("POST", "/v2/panels", body);
  const { panel_id: latest } = await s.transport.rest("POST", "/v2/panels", body);
  await s.sync();
  assert.deepEqual(s.byScope("group").map((p) => p.panel_id), [latest]);
});

test("群超过 20 个：建的时候带前 20 个，剩下的再加上", async (t) => {
  const s = await setup(t);
  const groups = Array.from({ length: 25 }, (_, i) => "G" + i);
  await s.sync({ groups });
  assert.deepEqual([...s.byScope("group")[0].targets], groups);
  const create = s.qq.state.panelCalls.find((call) => call.method === "POST" && call.body.scope === "group");
  assert.equal(create.body.group_openids.length, 20);
  const added = s.qq.state.panelCalls.filter((call) => call.path.endsWith("/target"));
  assert.deepEqual(added.map((call) => call.body.group_openids.length), [5]);
});

test("40030009（面板上还有操作没做完）等一下重试", async (t) => {
  const s = await setup(t);
  const waits = [];
  s.qq.failNext(400, 40030009, "指令面板操作进行中，请稍后重试");
  assert.equal(await s.sync({ sleep: async (ms) => { waits.push(ms); } }), "群聊新建了（1 个群），私聊新建了");
  assert.deepEqual(waits, [2000]);
  // 别的错误不重试，原样报出去（带着平台的错误码）
  s.qq.failNext(400, 40030020, "内容存在安全风险，请修改后重试");
  await assert.rejects(s.sync({ sleep: async () => assert.fail("不该重试") }), (error) => error.code === 40030020);
});

test("说明超长时在本地拦下，一个请求都不发", async (t) => {
  const s = await setup(t);
  const long = { ...extra, summary: "这句说明写得太长了，超过了指令面板的十五个汉字" };
  await assert.rejects(s.sync({ features: [...features, long] }), /\/测试 的面板说明/);
  assert.equal(s.qq.state.panelCalls.length, 0);
});
