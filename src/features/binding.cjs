"use strict";
// 账号绑定：/绑定 好友码、/授权（OAuth）、/解绑。绑定本身的规则在 src/bindings.cjs。

const UNBIND_CONFIRM_MS = 5 * 60 * 1000;
// 「无回调地址」模式下落雪页面显示的授权码，形如 ABCD-EFGH-IJKL
const OOB_CODE = /^[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){2}$/;

const bind = {
  name: "bind",
  words: ["绑定", "bind", "綁定"],
  usage: "/绑定 好友码",
  summary: "用好友码绑定落雪账号",
  group: "账号",
  async run(ctx) {
    if (!ctx.args) return ctx.reply(ctx.voice.bindUsage);
    const { player, previous } = await ctx.services.bindings.bindFriendCode(ctx.userId, ctx.args);
    await ctx.reply(ctx.voice.bindDone(player, previous));
  },
};

const authorize = {
  name: "authorize",
  words: ["授权", "授權", "authorize", "oauth"],
  usage: "/授权",
  summary: "用落雪账号授权，能读全部成绩的具体分数",
  panel: "用落雪账号授权，能读全部成绩",
  group: "账号",
  // 私聊里有进行中的授权时，直接发授权码也认
  matchDirect(text, ctx) {
    return OOB_CODE.test(text) && ctx.services.oauth?.hasPending(ctx.userId) ? text : null;
  },
  async run(ctx) {
    const { bindings, oauth } = ctx.services;
    if (!bindings.oauthEnabled) return ctx.reply(ctx.voice.authorizeDisabled);
    if (!ctx.args) {
      const { url } = bindings.startOAuth(ctx.userId);
      return ctx.reply(ctx.voice.authorizeIntro(url, Math.round(oauth.pendingTtlMs / 60000)));
    }
    const { player } = await bindings.finishOAuth(ctx.userId, ctx.args);
    await ctx.reply(ctx.voice.authorizeDone(player));
  },
};

// QQ 里没有确认弹窗，用「再发一次」代替二次确认（MiaBot 也是这么做的）。
const unbind = {
  name: "unbind",
  words: ["解绑", "解綁", "unbind"],
  usage: "/解绑",
  summary: "解除绑定",
  group: "账号",
  async run(ctx) {
    const entry = ctx.services.bindings.get(ctx.userId);
    if (!entry) return ctx.reply(ctx.voice.unbindNotBound);
    if (!ctx.confirm("unbind", UNBIND_CONFIRM_MS)) return ctx.reply(ctx.voice.unbindConfirm(UNBIND_CONFIRM_MS / 60000));
    await ctx.services.bindings.unbind(ctx.userId);
    await ctx.reply(ctx.voice.unbindDone(entry.method));
  },
};

module.exports = [bind, authorize, unbind];
