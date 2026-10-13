"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openVault, loadMasterKey, dpapi } = require("../src/vault.cjs");

const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-vault-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("写进去、重新打开读出来；文件里看不到明文", async (t) => {
  const dir = tempDir(t);
  const key = crypto.randomBytes(32);
  const file = path.join(dir, "bindings.enc");
  const vault = await openVault({ file, key });
  await vault.set("U1", { friendCode: "101", oauth: { refreshToken: "secret-refresh-token" } });
  assert.ok(!fs.readFileSync(file).includes("secret-refresh-token"));
  const again = await openVault({ file, key });
  assert.equal(again.get("U1").oauth.refreshToken, "secret-refresh-token");
  assert.equal(again.size, 1);
});

test("拿到的是副本，改它不会改到库里", async (t) => {
  const vault = await openVault({ file: path.join(tempDir(t), "b.enc"), key: crypto.randomBytes(32) });
  await vault.set("U1", { friendCode: "101" });
  vault.get("U1").friendCode = "999";
  assert.equal(vault.get("U1").friendCode, "101");
});

test("update：返回 undefined 不改，返回 null 删掉", async (t) => {
  const vault = await openVault({ file: path.join(tempDir(t), "b.enc"), key: crypto.randomBytes(32) });
  await vault.set("U1", { n: 1 });
  await vault.update("U1", () => undefined);
  assert.equal(vault.get("U1").n, 1);
  await vault.update("U1", (entry) => ({ ...entry, n: 2 }));
  assert.equal(vault.get("U1").n, 2);
  await vault.update("U1", () => null);
  assert.equal(vault.get("U1"), null);
});

test("主密钥不对时拒绝打开，而且不动原文件", async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, "bindings.enc");
  const vault = await openVault({ file, key: crypto.randomBytes(32) });
  await vault.set("U1", { friendCode: "101" });
  const before = fs.readFileSync(file);
  await assert.rejects(openVault({ file, key: crypto.randomBytes(32) }), /解不开/);
  assert.ok(fs.readFileSync(file).equals(before));
});

test("写盘失败时内存里的改动还在，下一次写盘把它一起补上", async (t) => {
  const dir = tempDir(t);
  const key = crypto.randomBytes(32);
  const file = path.join(dir, "sub", "bindings.enc");
  const logs = [];
  const vault = await openVault({ file, key, log: (line) => logs.push(line) });
  fs.writeFileSync(path.join(dir, "sub"), "挡路的文件");   // 目录的位置被一个文件占了，写盘必然失败
  await assert.rejects(vault.set("U1", { token: "first" }));
  assert.equal(vault.get("U1").token, "first");
  assert.ok(logs.some((line) => line.includes("写盘失败")));
  fs.rmSync(path.join(dir, "sub"));
  await vault.set("U2", { token: "second" });
  const again = await openVault({ file, key });
  assert.equal(again.get("U1").token, "first");
  assert.equal(again.get("U2").token, "second");
});

test("主密钥：ANNA_VAULT_KEY 优先，长度不对报错", async () => {
  const key = crypto.randomBytes(32);
  const loaded = await loadMasterKey({ envKey: key.toString("base64"), keyFile: "unused" });
  assert.equal(loaded.source, "env");
  assert.ok(loaded.key.equals(key));
  await assert.rejects(loadMasterKey({ envKey: Buffer.alloc(16).toString("base64"), keyFile: "unused" }), /32 字节/);
});

test("主密钥：非 Windows 又没设 ANNA_VAULT_KEY 时拒绝", async () => {
  await assert.rejects(loadMasterKey({ envKey: "", keyFile: "unused", platform: "linux" }), /ANNA_VAULT_KEY/);
});

test("主密钥：绑定库在、vault.key 却没了时报错，不新生成", async (t) => {
  const dir = tempDir(t);
  const vaultFile = path.join(dir, "bindings.enc");
  fs.writeFileSync(vaultFile, "x");
  const fake = { protect: async (b) => b, unprotect: async (b) => b };
  await assert.rejects(loadMasterKey({ keyFile: path.join(dir, "vault.key"), vaultFile, platform: "win32", protector: fake }), /不见了/);
  assert.ok(!fs.existsSync(path.join(dir, "vault.key")));
});

test("主密钥：第一次生成并保存，第二次读回同一把", async (t) => {
  const dir = tempDir(t);
  const keyFile = path.join(dir, "vault.key");
  const fake = { protect: async (b) => Buffer.concat([Buffer.from("P"), b]), unprotect: async (b) => b.subarray(1) };
  const first = await loadMasterKey({ keyFile, vaultFile: path.join(dir, "bindings.enc"), platform: "win32", protector: fake });
  assert.equal(first.source, "dpapi-new");
  const second = await loadMasterKey({ keyFile, platform: "win32", protector: fake });
  assert.equal(second.source, "dpapi");
  assert.ok(second.key.equals(first.key));
});

test("DPAPI 真机往返（只在 Windows 上跑）", { skip: process.platform !== "win32" }, async () => {
  const key = crypto.randomBytes(32);
  const sealed = await dpapi.protect(key);
  assert.ok(!sealed.equals(key));
  assert.ok((await dpapi.unprotect(sealed)).equals(key));
  await assert.rejects(dpapi.unprotect(Buffer.from("garbage")), /PowerShell 退出码/);
});
