#!/usr/bin/env node
"use strict";
// QQ 连接探针：验证 .env 里的 QQ_APP_ID / QQ_APP_SECRET，连上网关，把收到的消息事件打出来。只读，不发消息。
// 照 MiaBot 的 qq-official/probe-official.cjs 简化而来。
//
// 主要用途：拿 config.local.json 里 allowedGroupIds 要填的 group_openid、admins 要填的 openid。
// 把机器人拉进群，在群里 @ 它一次（从成员列表里选中它，不是手打「@Anna」文字），这里就会打出群和你的 openid。
// 换 AppID 后 openid 会变，要重新探。
//
// 一次只听一个环境：沙箱和正式不能同时连 —— 先连上的那个在，后连的会被判会话失效（op 9）、再以 4903 关掉
// （2026-10-15 实测）。同一个环境连两次倒是都能连上，所以 Anna 开着的时候也能跑探针（两边都会收到事件）。
//
// 用法：npm run probe                      按 config.local.json 的 sandbox 选环境，默认听 300 秒
//       npm run probe -- --formal          听正式环境（--sandbox 听沙箱）
//       npm run probe -- --seconds 600

const { loadConfig } = require("../src/config.cjs");
const { createOfficial } = require("../src/official-transport.cjs");

const argv = process.argv.slice(2);
const at = argv.indexOf("--seconds");
const seconds = at >= 0 ? Number(argv[at + 1]) || 300 : 300;
const redact = (error) => String(error?.message || error).replace(/QQBot [\w.-]+/g, "QQBot ***");

async function main() {
  const config = loadConfig({ requireGroups: false, requireLxns: false, requireFile: false });
  const sandbox = argv.includes("--formal") ? false : argv.includes("--sandbox") ? true : config.qq.sandbox;
  console.log("听" + (sandbox ? "沙箱" : "正式") + "环境 " + seconds + " 秒。把机器人拉进群后在群里 @ 它一次，再私聊它一句。");

  let count = 0;
  const senders = { group: new Set(), c2c: new Set() };   // 发消息的人的 openid，按群聊/私聊分开记
  const transport = createOfficial({ ...config.qq, sandbox, log: (line) => console.log("[传输层] " + line) });
  await transport.start((name, d) => {
    count += 1;
    const event = transport.normalize(name, d);
    console.log("\n收到事件 " + name);
    if (!event) {
      console.log("  （不是消息事件）" + JSON.stringify(d).slice(0, 800));
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
    senders[event.type]?.add(event.userId);
  });

  setTimeout(() => {
    transport.stop();
    console.log("\n时间到，收到 " + count + " 个事件。");
    if (!count) {
      console.log("一个事件都没有。常见原因：自己的 QQ 不在开放平台的「开发体验号码」名单里；机器人没进群；" +
        "群里没真 @ 到它（要从成员列表里选，手打文字不算）；群主没在群里给机器人设置能收哪些消息。");
    }
    // 绑定按 openid 存：私聊里绑的号要在群里查得到，靠的是同一个人在两边的 openid 一样（MiaBot 2026-09-19 实测是一样的）
    if (senders.group.size && senders.c2c.size) {
      const same = [...senders.c2c].some((id) => senders.group.has(id));
      console.log(same ? "私聊和群里是同一个 openid：私聊绑定的号在群里也认。"
        : "⚠ 私聊和群里的 openid 对不上（也可能是不同的人发的）。是同一个人的话，私聊绑定的号在群里会查不到。");
    }
    process.exit(0);
  }, seconds * 1000);
}

main().catch((error) => {
  console.error("探针失败：" + redact(error));
  process.exit(1);
});
