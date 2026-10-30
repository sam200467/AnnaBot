#!/usr/bin/env node
"use strict";
// 不连 QQ 试指令：用真的落雪数据、真的出图流程跑指令，QQ 换成本地假的。回复打印在终端，图片存到 data/try/。
// 新功能写好后先用它试，不用每次都部署到 QQ 上。
//
// 用法：npm run try -- "/信息" "/示例图"
//       npm run try -- --group "/帮助"          当成群里 @ 机器人发的（默认是私聊）
//       npm run try -- --user U2 "/信息"        换个人发（默认 TRY_USER）
//
// 绑定库用 data/try/ 下单独的一份，不碰正式的绑定。TRY_USER 还没绑定、而 .env 里有 LXNS_FRIEND_CODE
// 或 LXNS_USER_TOKEN 时，自动用好友码把你自己绑上；想试授权流程就发 /授权，按提示操作后再发 "/授权 授权码"。

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../src/config.cjs");
const { createLog } = require("../src/log.cjs");
const { createServices } = require("../src/services.cjs");
const { createAnnaBot } = require("../src/bot.cjs");
const { parseOwnedData } = require("../src/pager.cjs");
const { createMockOfficial } = require("../test/mock-official.cjs");

// Git Bash 会把以 / 开头的参数当成路径改写（"/信息" → "C:/Program Files/Git/信息"），这里改回来。
// 用 # 开头写指令（"#信息"）在哪个终端里都不会被改。
function undoMsysPath(args) {
  if (!process.env.MSYSTEM) return args;
  let root = "";
  try { root = require("node:child_process").execFileSync("cygpath", ["-m", "/"], { encoding: "utf8" }).trim(); } catch { return args; }
  return root ? args.map((arg) => (arg.startsWith(root) ? "/" + arg.slice(root.length).replace(/^\/+/, "") : arg)) : args;
}

function parseArgs() {
  const list = undoMsysPath(process.argv.slice(2));
  let user = "TRY_USER";
  let group = false;
  const commands = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "--user") user = list[++i];
    else if (list[i] === "--group") group = true;
    else commands.push(list[i]);
  }
  return { user, group, commands };
}

async function ownFriendCode(lxns) {
  if (process.env.LXNS_FRIEND_CODE?.trim()) return process.env.LXNS_FRIEND_CODE.trim();
  const token = process.env.LXNS_USER_TOKEN?.trim();
  return token ? String((await lxns.user({ userToken: token }).player()).friend_code) : "";
}

async function main() {
  const { user, group, commands } = parseArgs();
  if (!commands.length) throw new Error("用法：npm run try -- \"/信息\" \"/状态\"");
  const config = loadConfig({ requireQQ: false, requireGroups: false, requireFile: false });
  const tryDir = path.join(config.workDir, "try");
  fs.mkdirSync(tryDir, { recursive: true });
  const log = createLog({ secrets: config.secrets, out: { log: (line) => console.log("  · " + line) } });
  const services = await createServices(config, { log, vaultDir: tryDir });
  await services.catalog.ready();

  if (!services.bindings.get(user)) {
    const code = await ownFriendCode(services.lxns).catch(() => "");
    if (code) {
      const { player } = await services.bindings.bindFriendCode(user, code);
      console.log("（自动用好友码绑上了 " + player.name + "）");
    }
  }

  const qq = createMockOfficial();
  await qq.start();
  const bot = createAnnaBot({
    ...config,
    allowedGroupIds: ["TRY_GROUP"],
    allowPrivateChat: true,
    admins: [...config.admins, user],   // 本机试用，管理员指令（/示例图、/刷新曲库）也能试
    qq: { appId: "try", clientSecret: "try", tokenUrl: qq.tokenUrl, apiBase: qq.apiBase, sandboxApiBase: qq.apiBase,
      minSendIntervalMs: 0, jitterMs: 0, perTargetIntervalMs: 0, perTargetPerHour: 10000 },
  }, { ...services, log });

  let n = 0;
  let images = 0;
  for (const command of commands) {
    const before = qq.state.sent.length;
    const uploadsBefore = qq.state.uploads.length;
    console.log("\n> " + command);
    const id = "try-" + Date.now() + "-" + (++n);
    if (group) await bot.handleEvent("GROUP_AT_MESSAGE_CREATE", { id, group_openid: "TRY_GROUP", author: { member_openid: user }, content: " " + command });
    else await bot.handleEvent("C2C_MESSAGE_CREATE", { id, author: { user_openid: user }, content: command });
    for (const { body } of qq.state.sent.slice(before)) {
      if (body.msg_type === 7) {
        if (String(body.content || "").trim()) console.log("  [图注] " + body.content);
        continue;
      }
      console.log(String(body.markdown?.content ?? body.content).replace(/^/gm, "  "));
      // 翻页按钮一排一行：回调按钮写点了执行什么（绑了发起人的标出来），页码按钮写填进输入框的那截
      for (const row of body.keyboard?.content?.rows || []) {
        console.log("  [按钮] " + row.buttons.map((button) => {
          const { owner, data } = parseOwnedData(button.action.data);
          return button.render_data.label + (button.action.type === 2 ? "（填入「" + data + "」）" : " → " + data + (owner ? "（只有发起人能点）" : ""));
        }).join("　"));
      }
    }
    for (const upload of qq.state.uploads.slice(uploadsBefore)) {
      const buffer = Buffer.from(upload.body.file_data, "base64");
      // 成绩图这类纹理多的图出的是 JPEG，扩展名跟着内容走
      const file = path.join(tryDir, "image-" + (++images) + (buffer[0] === 0xff && buffer[1] === 0xd8 ? ".jpg" : ".png"));
      fs.writeFileSync(file, buffer);
      console.log("  [图片] " + file);
    }
  }
  bot.stop();
  await services.vault.flush();
  await qq.stop();
}

main().catch((error) => {
  console.error("失败：" + (error?.stack || error));
  process.exit(1);
});
