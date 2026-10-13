#!/usr/bin/env node
"use strict";
// QQ 连接探针：验证 .env 里的 QQ_APP_ID / QQ_APP_SECRET，连上网关，把收到的消息事件打出来。只读，不发消息。
// 照 MiaBot 的 qq-official/probe-official.cjs 简化而来。
//
// 主要用途：拿 config.local.json 里 allowedGroupIds 要填的 group_openid、admins 要填的 openid。
// 把机器人拉进群，在群里 @ 它一次（从成员列表里选中它，不是手打「@Anna」文字），这里就会打出群和你的 openid。
// 换 AppID、换沙箱/正式环境，openid 都会变，要重新探。
//
// 用法：npm run probe              默认听 300 秒
//       npm run probe -- --seconds 600

const { loadConfig } = require("../src/config.cjs");
const { createOfficial } = require("../src/official-transport.cjs");

const argv = process.argv.slice(2);
const at = argv.indexOf("--seconds");
const seconds = at >= 0 ? Number(argv[at + 1]) || 300 : 300;

async function main() {
  const config = loadConfig({ requireGroups: false, requireLxns: false, requireFile: false });
  console.log("环境：" + (config.qq.sandbox ? "沙箱" : "正式") + "，听 " + seconds + " 秒。把机器人拉进群后在群里 @ 它一次。");
  const transport = createOfficial({ ...config.qq, log: (line) => console.log("[传输层] " + line) });
  await transport.start((name, d) => {
    const event = transport.normalize(name, d);
    console.log("\n收到事件 " + name);
    if (!event) {
      console.log("  （不是消息事件）" + JSON.stringify(d).slice(0, 200));
      return;
    }
    if (event.type === "group") {
      const listed = config.allowedGroupIds.includes(event.openid);
      console.log("  群 group_openid：" + event.openid + (listed ? "（已在白名单）" : "（不在白名单，要加进 allowedGroupIds）"));
    } else {
      console.log("  私聊");
    }
    console.log("  发消息的人 openid：" + event.userId + (config.admins.includes(event.userId) ? "（管理员）" : ""));
    console.log("  @ 到机器人：" + (event.mentionsSelf || event.mentioned ? "是" : "否"));
    console.log("  内容：" + String(event.content).slice(0, 80));
  });
  setTimeout(() => {
    transport.stop();
    console.log("\n时间到，探针退出。");
    process.exit(0);
  }, seconds * 1000);
}

main().catch((error) => {
  console.error("探针失败：" + String(error?.message || error).replace(/QQBot [\w.-]+/g, "QQBot ***"));
  process.exit(1);
});
