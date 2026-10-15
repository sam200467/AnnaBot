"use strict";
// 机器人主体：QQ 事件 → 指令。平台细节关在 official-transport.cjs，指令和功能在 commands.cjs / features/。
//
// 一条消息要过的闸，顺序照 MiaBot 的 mia-entry.cjs（那边线上踩出来的）：
//   1. 按钮回调先应答 —— 不应答客户端会一直转圈；按钮里存的那句当成这个人发的指令
//   2. 白名单：群不在 allowedGroupIds 里整条忽略；私聊看 allowPrivateChat；QQ 频道不接
//   3. @全体成员 不是在叫 Anna，忽略
//   4. 幂等：同一条消息可能以 GROUP_MESSAGE_CREATE 和 GROUP_AT_MESSAGE_CREATE 各推一次，只处理一次
//   5. 认指令。群里必须真 @ 到 Anna（平台给的 mentions[].is_you）—— 群主开了「接收全部消息」后，
//      别的机器人被 @ 的 /help 也会推过来，光有前缀就执行等于抢答别人的指令。私聊里不带前缀的指令词也认
//   6. 私聊里各功能的 matchDirect（比如有进行中的 /授权 时直接发授权码）
//   7. @ 了 Anna 但不是指令：交给 deps.chat（以后的角色聊天），没有就提示发 /帮助
// 平台的三条硬约束（MiaBot 实测）：不能主动发消息，所有回复都回在原地；群里一条消息 5 分钟内最多回 5 次、
// 私聊 60 分钟 4～5 次；没有按 id 拉消息的接口。

const { createOfficial } = require("./official-transport.cjs");
const { createCommands } = require("./commands.cjs");
const { syncPanels } = require("./command-panel.cjs");
const { V } = require("./voice.cjs");

function makeTarget(event) {
  return { kind: event.type === "group" ? "group" : event.type === "channel" ? "channel" : "c2c", openid: event.openid };
}

function createAnnaBot(config, deps = {}) {
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const features = deps.features || require("./features/index.cjs");
  const transport = deps.transport || (deps.createTransport || createOfficial)({ ...config.qq, log });
  const allowGroups = new Set((config.allowedGroupIds || []).map(String));
  const allowPrivate = config.allowPrivateChat !== false;
  const services = {
    lxns: deps.lxns, oauth: deps.oauth, bindings: deps.bindings,
    catalog: deps.catalog, assets: deps.assets, renderer: deps.renderer,
  };
  const startedAt = now();

  // 回答跟着消息走：群里问的回群里，私聊问的回私聊；一律带 msgId 走被动回复。
  const send = {
    text: (event, text) => transport.sendText(makeTarget(event), text, event.msgId, event.refId),
    markdown: (event, markdown, text, options) => transport.sendMarkdown(makeTarget(event), markdown, text, event.msgId, event.refId, options),
    image: (event, buffer, caption) => {
      if (!Buffer.isBuffer(buffer)) throw new Error("要发的图片不是 Buffer");
      log("发送图片（" + Math.round(buffer.length / 1024) + " KiB）");
      return transport.sendImage(makeTarget(event), buffer, event.msgId, caption ? String(caption) : "", event.refId);
    },
  };

  function statusText() {
    const state = commands.state();
    const minutes = Math.floor((now() - startedAt) / 60000);
    const catalog = services.catalog;
    const counts = services.bindings?.stats?.();
    return [
      "在线：" + (transport.state?.connected ? "是" : "否（正在重连）"),
      "已运行：" + (minutes >= 60 ? Math.floor(minutes / 60) + " 小时 " : "") + (minutes % 60) + " 分钟",
      "出图队列：" + (state.busy ? "正在生成「" + state.busy + "」，" : "") + "排队 " + state.queue + " 张",
      catalog?.loaded ? "曲库：" + catalog.size + " 首（" + catalog.currentVersion().title + "），" +
        new Date(catalog.fetchedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + " 更新" : "曲库：没加载",
      counts ? "绑定：" + counts.total + " 人（授权 " + counts.oauth + "，好友码 " + counts.friendCode + "）" : "",
      "授权绑定：" + (services.bindings?.oauthEnabled ? "开" : "关"),
    ].filter(Boolean).join("\n");
  }

  const commands = createCommands({
    features, services, config, send, log, now,
    ...(deps.random ? { random: deps.random } : {}),
    extras: { statusText },
  });

  // 「这条消息是在叫 Anna 吗」。平台在 mentions 里直接标了 is_you（official-transport.cjs 里有实测记录）；
  // 没开全量消息的群里只推 @ 事件、没有 mentions 字段，那时靠事件类型判。
  function mentionsSelf(event) {
    if (event.mentionsEveryone === true) return false;
    if (event.mentionsSelf === true) return true;
    return event.mentioned === true;
  }

  async function handleEvent(eventName, d) {
    const event = transport.normalize(eventName, d);
    if (!event) return;
    if (event.interactionId) await transport.ackInteraction?.(event.interactionId, 0);

    if (event.type === "group" && !allowGroups.has(String(event.openid))) return;
    if (event.type === "c2c" && !allowPrivate) return;
    if (event.type === "channel") return;
    if (event.type === "group" && event.mentionsEveryone) return;
    if (!commands.claimEvent(event)) {
      log("忽略重复投递（" + eventName + "）");
      return;
    }

    const text = String(event.content || "").trim();
    if (!text) return;
    const direct = event.type === "c2c";
    const calling = direct || Boolean(event.interactionId) || mentionsSelf(event) || config.acceptBareGroupCommands === true;
    if (!calling) return;

    const parsed = commands.parse(text, { direct }) || (direct ? commands.matchDirect(text, event) : null);
    if (parsed?.feature) {
      // 只记指令名，不记参数：参数里可能是授权码、好友码
      log("收到指令 /" + parsed.feature.words[0] + "（" + event.type + " " + String(event.userId).slice(0, 8) + "…）");
      await commands.run(event, parsed);
      return;
    }
    if (parsed) {
      await send.text(event, V.unknownCommand);
      return;
    }
    if (deps.chat) await deps.chat(event, { send, services, log });
    else if (!event.interactionId) await send.text(event, V.notACommand);
  }

  let gatewayTimer = null;
  let gatewayUp = false;
  function watchGateway() {
    gatewayTimer = setInterval(() => {
      const up = Boolean(transport.state?.connected && transport.healthy?.());
      if (up === gatewayUp) return;
      gatewayUp = up;
      log(up ? "QQ 网关已连上" : "⚠ QQ 网关断开，正在重连");
    }, 2000);
    gatewayTimer.unref?.();
  }

  return {
    transport,
    commands,
    handleEvent,
    mentionsSelf,
    statusText,
    async start() {
      log("Anna 启动｜环境 " + (config.qq?.sandbox ? "沙箱" : "正式") +
        "｜允许群 " + allowGroups.size + " 个｜私聊 " + (allowPrivate ? "开" : "关") +
        "｜功能 " + features.length + " 个｜授权绑定 " + (services.bindings?.oauthEnabled ? "开" : "关"));
      await transport.start((name, d) => {
        void handleEvent(name, d).catch((error) => log("⚠ 处理消息出错：" + (error?.stack || error)));
      });
      watchGateway();
      // QQ 输入框打 / 弹出的指令清单跟着功能表和白名单走，每次启动对一遍。在后台做，没对上只记日志：面板只是个入口，不影响收发
      if (config.commandPanel !== false && typeof transport.rest === "function") {
        void syncPanels({ rest: transport.rest, features, groups: [...allowGroups], privateChat: allowPrivate })
          .then((result) => log("指令面板：" + result))
          .catch((error) => log("⚠ 指令面板没同步上：" + error.message + (error.code ? "（错误码 " + error.code + "）" : "")));
      }
    },
    stop() {
      if (gatewayTimer) clearInterval(gatewayTimer);
      gatewayTimer = null;
      transport.stop();
    },
  };
}

module.exports = { createAnnaBot, makeTarget };
