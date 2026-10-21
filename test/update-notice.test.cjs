"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUpdateNotice } = require("../src/update-notice.cjs");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anna-notice-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { root, workDir: path.join(root, "data") };
  const release = (extra = {}) => fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({
    version: "v2", installedAt: "2026-10-21T00:00:00Z", notifyUpdate: true, notes: ["增加新功能"], ...extra,
  }));
  release();
  return { config, release };
}
const group = (openid = "G1") => ({ type: "group", openid, msgId: "message-1" });

test("上线主动通知每群一次，被拒的群可改为被动回复，重启不重复通知成功的群", async (t) => {
  const { config } = setup(t);
  const notice = createUpdateNotice(config);
  const sent = [];
  await notice.broadcast(["G1", "G2", "G1"], async (target, text) => {
    if (target.openid === "G2") throw Object.assign(new Error("无权限"), { code: 40034105 });
    sent.push({ target, text });
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].target, { kind: "group", openid: "G1" });
  await notice.send(group(), async () => assert.fail("主动发过的群不再被动发"));
  await notice.send(group("G2"), async () => sent.push("fallback"));
  assert.equal(sent.length, 2);
  await createUpdateNotice(config).broadcast(["G1", "G2"], async () => assert.fail("重启不重复发"));
});

test("每群每次更新发送一次，重启保留记录，下次安装重新发送", async (t) => {
  const { config, release } = setup(t);
  const sent = [];
  const send = async (event, text) => sent.push({ event, text });
  const notice = createUpdateNotice(config);
  await Promise.all([notice.send(group(), send), notice.send(group(), send)]);
  await notice.send(group(), send);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /【Anna 更新日志】[\s\S]*v2[\s\S]*增加新功能/);
  await createUpdateNotice(config).send(group(), send);
  assert.equal(sent.length, 1);
  await notice.send(group("G2"), send);
  assert.equal(sent.length, 2);
  release({ installedAt: "2026-10-22T00:00:00Z" });
  await createUpdateNotice(config).send(group(), send);
  assert.equal(sent.length, 3);
});

test("发送失败后重试；私聊、无凭据消息、首次安装和源码启动不发", async (t) => {
  const { config, release } = setup(t);
  const notice = createUpdateNotice(config);
  let count = 0;
  const send = async () => { count++; };
  await notice.send({ ...group(), type: "c2c" }, send);
  await notice.send({ ...group(), msgId: "" }, send);
  await notice.send(group(), async () => { throw new Error("网络中断"); });
  await notice.send(group(), send);
  assert.equal(count, 1);
  release({ notifyUpdate: false });
  await createUpdateNotice(config).send(group(), send);
  fs.unlinkSync(path.join(config.root, "version.json"));
  await createUpdateNotice(config).send(group(), send);
  assert.equal(count, 1);
});
