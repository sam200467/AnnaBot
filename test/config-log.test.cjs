"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("../src/config.cjs");
const { createLog } = require("../src/log.cjs");

function root(t, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-cfg-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (config) fs.writeFileSync(path.join(dir, "config.local.json"), JSON.stringify(config));
  return dir;
}

const ENV = { QQ_APP_ID: "1", QQ_APP_SECRET: "qq-secret-value", LXNS_DEV_TOKEN: "dev-token-value" };

test("配置：没有 config.local.json、白名单为空、缺密钥都拒绝启动", (t) => {
  assert.throws(() => loadConfig({ root: root(t), env: ENV }), /找不到 config.local.json/);
  assert.throws(() => loadConfig({ root: root(t, { allowedGroupIds: [] }), env: ENV }), /allowedGroupIds 是空的[\s\S]*npm run probe/);
  assert.throws(() => loadConfig({ root: root(t, { allowedGroupIds: ["G1"] }), env: { ...ENV, QQ_APP_SECRET: "" } }), /QQ_APP_SECRET/);
  assert.throws(() => loadConfig({ root: root(t, { allowedGroupIds: ["G1"] }), env: { ...ENV, LXNS_DEV_TOKEN: "" } }), /LXNS_DEV_TOKEN/);
  assert.throws(() => loadConfig({ root: root(t, { allowedGroupIds: "G1" }), env: ENV }), /要写成数组/);
});

test("配置：默认值、_说明 键忽略、路径按项目根目录解析、传输层设置传给 qq", (t) => {
  const dir = root(t, { _说明: "x", allowedGroupIds: ["G1", 2], sandbox: false, workDir: "./runtime", dailyCap: 10 });
  const config = loadConfig({ root: dir, env: ENV });
  assert.equal(config._说明, undefined);
  assert.deepEqual(config.allowedGroupIds, ["G1", "2"]);
  assert.equal(config.workDir, path.join(dir, "runtime"));
  assert.equal(config.generateCooldownMs, 3000);
  assert.deepEqual({ sandbox: config.qq.sandbox, dailyCap: config.qq.dailyCap, appId: config.qq.appId }, { sandbox: false, dailyCap: 10, appId: "1" });
  assert.ok(config.secrets.includes("qq-secret-value") && config.secrets.includes("dev-token-value"));
});

test("配置：工具脚本可以不要 config.local.json，退回 config.example.json", (t) => {
  const dir = root(t);
  fs.writeFileSync(path.join(dir, "config.example.json"), JSON.stringify({ renderScale: 3 }));
  const config = loadConfig({ root: dir, env: {}, requireQQ: false, requireGroups: false, requireLxns: false, requireFile: false });
  assert.equal(config.renderScale, 3);
});

test("日志：密钥和令牌抹掉；按天写文件；过期的旧日志删掉", (t) => {
  const dir = root(t);
  fs.writeFileSync(path.join(dir, "anna-2020-01-01.log"), "old");
  const lines = [];
  const log = createLog({ dir, secrets: ["dev-token-value", "abc"], keepDays: 14, out: { log: (line) => lines.push(line) },
    now: () => new Date(2026, 9, 13, 20, 5, 9) });
  log("密钥 dev-token-value 和 QQBot abc.def-1 和 Bearer eyJ.x_y=", { n: 1 });
  assert.equal(lines[0], "[20:05:09] 密钥 *** 和 QQBot *** 和 Bearer *** { n: 1 }");
  assert.ok(!fs.existsSync(path.join(dir, "anna-2020-01-01.log")));
  assert.equal(fs.readFileSync(path.join(dir, "anna-2026-10-13.log"), "utf8"), lines[0] + "\n");
});
