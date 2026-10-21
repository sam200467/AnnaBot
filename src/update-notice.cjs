"use strict";

const fs = require("node:fs");
const path = require("node:path");

// 安装程序留下更新标记；上线先主动发送，权限不足时等群消息触发被动回复。
function createUpdateNotice(config, { log = () => {} } = {}) {
  const noop = { send: async () => {}, broadcast: async () => {} };
  if (!config.root || !config.workDir) return noop;
  let release;
  try {
    release = JSON.parse(fs.readFileSync(path.join(config.root, "version.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") log("⚠ 读取更新信息失败：" + error.message);
    return noop;
  }
  if (!release.notifyUpdate || !release.installedAt) return noop;
  const id = release.installedAt + ":" + release.version;
  const file = path.join(config.workDir, "update-notices.json");
  let sent = new Set();
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved.id === id) sent = new Set(saved.groups);
  } catch (error) {
    if (error.code !== "ENOENT") log("⚠ 读取更新通知记录失败：" + error.message);
  }
  const busy = new Set();
  const text = ["【Anna 更新日志】", "更新完成，Anna 已重新上线♪", "",
    "版本：" + release.version, "",
    ...(Array.isArray(release.notes) && release.notes.length ? release.notes.map((note) => "· " + note) : ["· 程序已更新至最新安装包。"]),
  ].join("\n");
  const markdown = text.replace("【Anna 更新日志】", "### **Anna 更新日志**");
  async function deliver(group, sendText) {
      if (sent.has(group) || busy.has(group)) return;
      busy.add(group);
      try {
        await sendText(text, markdown);
        sent.add(group);
        // 成功后才记账；普通重启、网关重连不重复发。临时文件避免写到一半被中断。
        fs.mkdirSync(config.workDir, { recursive: true });
        fs.writeFileSync(file + ".tmp", JSON.stringify({ id, groups: [...sent] }) + "\n");
        fs.renameSync(file + ".tmp", file);
        log("更新日志已发送（群 " + group.slice(0, 8) + "…）");
      } catch (error) {
        log("⚠ 更新日志发送或保存失败：" + error.message + (error.code ? "（错误码 " + error.code + "）" : "") +
          "；尚未发送成功的群等待下条可回复消息重试。主动发送需开启群内「机器人主动在群聊内发言」并具备平台权限。");
      } finally {
        busy.delete(group);
      }
  }
  return {
    async send(event, sendText) {
      if (event.type !== "group" || !event.msgId) return;
      await deliver(String(event.openid), (text, markdown) => sendText(event, text, markdown));
    },
    async broadcast(groups, sendText) {
      for (const group of new Set(groups.map(String))) {
        await deliver(group, (text, markdown) => sendText({ kind: "group", openid: group }, text, markdown));
      }
    },
  };
}

module.exports = { createUpdateNotice };
