"use strict";
// 指令层：认指令、建上下文、查绑定、跑功能，外加出图队列、冷却和二次确认。
// 平台的事（收发、@ 判定、白名单）在 bot.cjs；具体功能在 src/features/，一个功能一个文件。
//
// 规则照搬 MiaBot 的 mia-commands.cjs（那边线上跑出来的）：
//   - 指令前缀 / # ＃ 都认，先做 NFKC（全角斜杠、全角字母也认）
//   - 出图走一个队列：同一个人的同一种图在排队时不再接；同一个人同一种图之间有冷却；队列有上限，满了直接说
//   - 官方平台没有「编辑消息」，出图慢时先回一句占位，图好了再另发一条
//   - 图发出时被动回复窗口已过（40034128）只记日志，不补发文字 —— 补发同样会失败
// 跟 MiaBot 不同的一处：占位那句不是每次都发。图在 receiptDelayMs 内就出来的话直接发图，
//   少占一次被动回复（群里一条消息 5 分钟内只能回 5 次）。
//
// ── 功能模块长这样（src/features/*.cjs）──────────────────────────────
//   {
//     name: "info",                      内部名，唯一
//     words: ["信息", "info"],            指令词（不带前缀），第一个是正式名，帮助里显示它
//     usage: "/信息", summary: "……",       帮助里的用法和一句话说明
//     panel: "……",                        可选：指令面板（QQ 输入框打 / 弹出的清单）里的说明，最多 15 个汉字；
//                                         不写就用 summary，false 是不进面板（见 command-panel.cjs）
//     group: "查询",                      帮助里的分组
//     binding: "none" | "any" | "oauth",  需要什么绑定。any：好友码或授权都行；oauth：要全部成绩的具体分数
//     allowOthers: false,                 true：@ 了别人就查别人（只认这条消息真 @ 到的人）
//     adminOnly: false, hidden: false,    管理员指令 / 不在帮助里列出
//     matchDirect(text, ctx),             可选：私聊里不带指令词的话也想接时，返回参数串，不接返回 null
//     async run(ctx) { ... },
//   }
// ctx 里有什么见下面 context()。

const { V, errorText } = require("./voice.cjs");

const PREFIX = /^[#＃/]\s*([^\s]+)\s*([\s\S]*)$/;
const RAW_PREFIX = /^[#＃/／]\s*[^\s]+\s*([\s\S]*)$/;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_MAX = 500;

function createCommands({ features, services, config = {}, send, now = Date.now, random = Math.random, log = () => {}, extras = {} } = {}) {
  if (!send || typeof send.text !== "function" || typeof send.image !== "function") throw new Error("commands 需要 send.text / send.image");
  const receiptDelayMs = config.receiptDelayMs ?? 1500;
  const cooldownMs = config.generateCooldownMs ?? 3000;
  const maxQueue = config.maxQueue ?? 10;
  const admins = new Set((config.admins || []).map(String));
  const pick = (value) => (Array.isArray(value) ? value[Math.floor(random() * value.length)] : value);

  // ── 功能表 ──
  const byName = new Map();
  const lookup = new Map();
  for (const feature of features) {
    if (!feature?.name || typeof feature.run !== "function" || !feature.words?.length) {
      throw new Error("功能模块缺 name / words / run：" + (feature?.name || "?"));
    }
    if (byName.has(feature.name)) throw new Error("功能重名：" + feature.name);
    byName.set(feature.name, feature);
    for (const word of feature.words) {
      const k = word.normalize("NFKC").toLowerCase();
      if (lookup.has(k)) throw new Error("指令词「" + word + "」被 " + lookup.get(k).name + " 和 " + feature.name + " 同时占用");
      lookup.set(k, feature);
    }
  }

  // 群里必须带前缀；私聊里不带前缀的指令词也认（direct=true）。
  function parse(text, { direct = false } = {}) {
    const original = String(text || "").trim();
    const raw = original.normalize("NFKC");
    const prefixed = raw.match(PREFIX);
    const match = prefixed || (direct ? raw.match(/^([^\s]+)\s*([\s\S]*)$/) : null);
    if (!match) return null;
    const feature = lookup.get(match[1].toLowerCase()) || null;
    if (!feature && !prefixed) return null;
    // rawArgs 是没做 NFKC 的原文：要一字不差的功能（比如加别名）用它
    const rawArgs = prefixed ? (original.match(RAW_PREFIX)?.[1] ?? match[2]).trim() : original.replace(/^[^\s]+\s*/, "").trim();
    return { feature, word: match[1], args: match[2].trim(), rawArgs };
  }

  // 私聊里不带指令词的话，问问各功能要不要接（比如有进行中的 /授权 时直接发授权码）。
  function matchDirect(text, event) {
    const ctx = { userId: String(event.userId), event, services };
    for (const feature of features) {
      if (typeof feature.matchDirect !== "function") continue;
      const args = feature.matchDirect(String(text).normalize("NFKC").trim(), ctx);
      if (args !== null && args !== undefined) return { feature, word: feature.words[0], args: String(args), rawArgs: String(args) };
    }
    return null;
  }

  // ── 幂等闸：同一条消息只处理一次（键是被动回复凭据 msgId）──
  const seen = new Map();
  function claimEvent(event) {
    const key = String(event.msgId || "");
    if (!key) return true;   // 没有 id 就没法判重，宁可重复也不整条吞掉
    const current = now();
    if ((seen.get(key) || 0) > current) return false;
    if (seen.size >= IDEMPOTENCY_MAX) for (const [k, until] of seen) if (until <= current) seen.delete(k);
    seen.set(key, current + IDEMPOTENCY_TTL_MS);
    return true;
  }

  // ── 二次确认（/解绑 这类）：第一次记下返回 false，有效期内同一个人在同一个地方再来一次返回 true ──
  const confirmations = new Map();
  function confirm(event, key, ttlMs) {
    const id = [event.type, event.openid, event.userId, key].join(":");
    const current = now();
    for (const [k, until] of confirmations) if (until <= current) confirmations.delete(k);
    if (confirmations.has(id)) {
      confirmations.delete(id);
      return true;
    }
    confirmations.set(id, current + ttlMs);
    return false;
  }

  // ── 出图队列 ──
  const queue = [];
  const queued = new Set();
  const lastGenerated = new Map();
  let busy = null;   // 正在出的那张图的 label

  async function pump() {
    if (busy || !queue.length) return;
    const task = queue.shift();
    busy = task.label;
    try {
      const produced = await task.render();
      const image = Buffer.isBuffer(produced) ? { buffer: produced } : produced;
      if (!Buffer.isBuffer(image?.buffer)) throw new Error("出图结果里没有图片数据");
      task.resolve({ ok: true, image });
    } catch (error) {
      const friendly = errorText(error);
      log((friendly ? "出图没成（" : "⚠ 出图失败（") + task.label + "）：" + (friendly ? error.message : error?.stack || error));
      task.resolve({ ok: false, reason: friendly || "出图出了点问题，已经记下来了。" });
    } finally {
      queued.delete(task.userKey);
      busy = null;
      void pump();
    }
  }

  // job: { kind: "b30", label?: "B30 成绩图", render: async () => Buffer | { buffer, caption } }
  async function image(ctx, job) {
    const userKey = job.kind + ":" + ctx.userId;
    if (queued.has(userKey)) return ctx.reply(pick(V.jobSameKindPending));
    const remaining = cooldownMs - (now() - (lastGenerated.get(userKey) || 0));
    if (remaining > 0) return ctx.reply(V.jobCooldown(Math.ceil(remaining / 1000)));
    if (queue.length >= maxQueue) return ctx.reply(pick(V.jobQueueFull));

    const ahead = queue.length + (busy ? 1 : 0);
    queued.add(userKey);
    lastGenerated.set(userKey, now());
    const outcome = new Promise((resolve) => queue.push({ userKey, label: job.label || job.kind, render: job.render, resolve }));
    void pump();

    // 前面有人就马上说要等；没人排队时先等一会儿，图还没出来再说「正在生成」。
    const receipt = () => ctx.reply(ahead ? V.jobQueued(ahead) : pick(V.jobAccepted))
      .catch((error) => log("占位消息发送失败：" + error.message));
    let timer = null;
    if (ahead > 0) await receipt();
    else timer = setTimeout(receipt, receiptDelayMs);
    const result = await outcome;
    clearTimeout(timer);
    if (!result.ok) return ctx.reply(V.jobFailed(result.reason));
    try {
      return await ctx.replyImage(result.image.buffer, result.image.caption || job.caption || "");
    } catch (error) {
      if (error?.code === 40034128) { log("图生成好了但被动回复窗口已过，没发出去（" + job.kind + "）"); return null; }
      throw error;
    }
  }

  // ── 帮助 ──
  function helpText({ admin = false } = {}) {
    const groups = new Map();
    for (const feature of features) {
      if (feature.hidden || (feature.adminOnly && !admin)) continue;
      const group = feature.group || "其他";
      groups.set(group, [...(groups.get(group) || []), feature]);
    }
    const lines = ["我能做这些（指令前面的 / 也可以换成 #）："];
    for (const [group, list] of groups) {
      lines.push("", "【" + group + "】");
      for (const feature of list) lines.push((feature.usage || "/" + feature.words[0]) + "　" + (feature.summary || ""));
    }
    lines.push("", "在群里要 @我 再发指令。");
    return lines.join("\n");
  }

  // ── 上下文 ──
  function context(event, parsed) {
    const feature = parsed.feature;
    const userId = String(event.userId);
    const mentioned = (event.mentionedOpenids || []).map(String).filter((id) => id && id !== userId);
    const subject = feature.allowOthers && mentioned.length
      ? { openid: mentioned[0], isSelf: false } : { openid: userId, isSelf: true };
    const ctx = {
      event,
      feature,
      args: parsed.args,
      rawArgs: parsed.rawArgs,
      userId,
      isGroup: event.type === "group",
      isDirect: event.type === "c2c",
      isAdmin: admins.has(userId),
      subject,
      player: null,
      services,
      config,
      log,
      voice: V,
      ...extras,
      reply: (text) => send.text(event, String(text)),
      // markdown 发不出去时传输层会用 text 补发，见 official-transport.cjs 的 sendMarkdown
      replyMarkdown: (markdown, text, options) => send.markdown(event, markdown, text, options),
      replyImage: (buffer, caption) => send.image(event, buffer, caption),
      image: (job) => image(ctx, job),
      confirm: (key, ttlMs) => confirm(event, key, ttlMs),
      helpText: () => helpText({ admin: admins.has(userId) }),
    };
    return ctx;
  }

  async function run(event, parsed) {
    const feature = parsed.feature;
    const ctx = context(event, parsed);
    if (feature.adminOnly && !ctx.isAdmin) return ctx.reply(V.unknownCommand);
    if (feature.binding && feature.binding !== "none") {
      // 查别人一律走开发者接口：受对方在落雪的「允许第三方读取」开关管。拿对方的授权令牌替别人查是越权。
      if (!ctx.subject.isSelf && feature.binding === "oauth") return ctx.reply("这个只能查自己哦。");
      const api = services.bindings.player(ctx.subject.openid, { thirdParty: !ctx.subject.isSelf });
      if (!api) return ctx.reply(ctx.subject.isSelf ? V.needBinding : V.otherNotBound);
      if (feature.binding === "oauth" && !api.hasFullScores) return ctx.reply(api.oauthExpired ? V.oauthExpired : V.needOAuth(feature.words[0]));
      ctx.player = api;
    }
    try {
      await feature.run(ctx);
    } catch (error) {
      const friendly = errorText(error);
      if (friendly) log("指令 /" + feature.words[0] + " 没办成：" + error.message);
      else log("⚠ 指令 /" + feature.words[0] + " 出错：" + (error?.stack || error));
      await ctx.reply(friendly || V.internalError).catch((e) => log("错误提示也发不出去：" + e.message));
    }
  }

  return {
    parse,
    matchDirect,
    claimEvent,
    run,
    helpText,
    features,
    find: (name) => byName.get(name) || null,
    state: () => ({ queue: queue.length, busy }),
  };
}

module.exports = { createCommands };
