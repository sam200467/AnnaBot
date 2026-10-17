"use strict";
// Anna 说的话。所有回给玩家的文案都放在这里，指令和功能代码里不直接写句子 ——
// 以后定了 Anna 的人设、要换口吻时只改这一个文件。现在是中性、友好的语气。
//
// 函数形式的条目带参数；数组形式的条目随机挑一句（见 commands.cjs 的 pick）。

const { LxnsError } = require("./lxns.cjs");
const { OAuthError } = require("./lxns-oauth.cjs");

// 截到两位小数，容差的道理见 themes/shared/theme-kit.js 的 format.rating
const formatRating = (value) => (Math.floor((Number(value) || 0) * 100 + 1e-8) / 100).toFixed(2);

const V = {
  unknownCommand: "没有这个指令哦，发「/帮助」看看我能做什么。",
  notACommand: "需要我帮忙的话，发「/帮助」看看指令～",
  internalError: "出了点问题，这次没办成。等一会儿再试试吧。",

  // ── 绑定 ──
  needBinding: "你还没有绑定落雪账号哦。发「/绑定 好友码」绑定，或者发「/授权」用落雪账号授权。",
  otherNotBound: "TA 还没有绑定落雪账号。",
  needOAuth: (label) => "「/" + label + "」要读全部成绩的具体分数，好友码绑定查不到。" +
    "发「/授权」用落雪账号授权一下就能用了。",
  oauthExpired: "你的落雪授权失效了（过期了，或者在落雪那边撤销了）。发「/授权」重新授权一次吧。",
  bindUsage: "用法：/绑定 好友码\n" +
    "好友码是一串数字，在落雪查分器的个人页面能看到。\n" +
    "想用等级成绩、分表这些要具体分数的功能，发「/授权」用落雪账号授权。",
  bindDone: (player, previous) => "绑定好了：" + player.name + "（Rating " + formatRating(player.rating) + "）。" +
    (previous?.method === "oauth" ? "\n之前的授权绑定已经换成好友码绑定了，要具体分数的功能需要重新「/授权」。" : ""),
  authorizeIntro: (url, minutes) => "用落雪账号授权：\n" +
    "1. 打开下面的链接，登录落雪并同意授权\n" + url + "\n" +
    "2. 页面会显示一串授权码（形如 ABCD-EFGH-IJKL）\n" +
    "3. " + minutes + " 分钟内把「/授权 授权码」发给我\n" +
    "这个链接只对你有效，别人拿到你的授权码也绑不上。",
  authorizeDone: (player) => "授权成功：" + player.name + "（Rating " + formatRating(player.rating) + "）。" +
    "现在要具体分数的功能也能用了。",
  authorizeNoPending: "先发「/授权」拿授权链接，授权后再把授权码发过来。",
  authorizeBadCode: "这个授权码换不到授权：可能输错了、已经用过了，或者不是用我刚才给你的那个链接授权的。" +
    "检查一下再发一次，不行就重新「/授权」。",
  authorizeDisabled: "授权绑定还没开放，先用「/绑定 好友码」吧。",
  unbindConfirm: (minutes) => "确定要解绑吗？" + minutes + " 分钟内再发一次「/解绑」确认。",
  unbindDone: (method) => "已解绑。" +
    (method === "oauth" ? "\n授权记录也可以去落雪「账号详情 → 第三方应用」里撤销。" : ""),
  unbindNotBound: "你还没有绑定，不用解绑。",

  // ── 出图队列 ──
  jobAccepted: ["收到，正在生成……", "好，马上画～"],
  jobQueued: (ahead) => "收到，前面还有 " + ahead + " 张图在生成，稍等一下～",
  jobCooldown: (seconds) => "刚生成过，" + seconds + " 秒后再试吧。",
  jobSameKindPending: "上一张还在生成，等它出来吧。",
  jobQueueFull: "现在排队的人太多了，过一会儿再来吧。",
  jobFailed: (reason) => "这张图没生成出来：" + reason,
  imageTooLate: "图生成好了，但已经超过 QQ 允许回复的时间，发不出去了。再发一次指令吧。",

  // ── /b30 ──
  // 好友码绑定只看得到新曲前 20：新曲挤进前 30 的超过 20 首时，第 21 首往后的可能没算进来
  bestMaybeIncomplete: (canAuthorize) => "新曲进了前 30 的不止 20 首，落雪只给了新曲前 20，这张图可能漏了几首。" +
    (canAuthorize ? "发「/授权」后按全部成绩算，就不会漏了。" : ""),

  // ── /单曲 ──
  songUsage: "用法：/单曲 曲名\n写曲名的一部分、别名或者曲目 ID（id850）都行，简体繁体、假名罗马音也认。@ 别人可以看 TA 的成绩。",
  songNotFound: (query) => "没找到「" + query + "」这首歌。换个写法试试：曲名的一部分、别名，或者曲目 ID（id850）。",
  songAmbiguous: (query, lines, more) => "「" + query + "」对上了好几首，用 ID 再发一次吧：\n" + lines.join("\n") +
    (more > 0 ? "\n……还有 " + more + " 首，写得再完整一点能少一些" : ""),
  // 曲名没对上，猜了几首相近的（拼错了、抄曲名时连作者一起抄进来了），只有一首也要玩家自己确认
  songMaybe: (query, lines, more) => "没找到「" + query + "」，是不是" + (lines.length > 1 ? "这几首里的" : "这首") + "？是的话用 ID 再发一次吧：\n" +
    lines.join("\n") + (more > 0 ? "\n……还有 " + more + " 首" : ""),
  // 候选列表的一行：id850　《混乱》 ～ Muspell（Norn）；WE 版在后面标出来
  songCandidate: (song, worldsEnd) => "id" + song.id + "　" + song.title + (worldsEnd ? "【WORLD'S END】" : "") + (song.artist ? "（" + song.artist + "）" : ""),

  // ── /谱面分析 ──
  chartUsage: "用法：/谱面分析 曲名 难度\n难度写在最后，不写就是 MASTER：绿 黄 红 紫 黑、bas adv exp mas ult、WE 都认。" +
    "曲名写一部分、别名或者曲目 ID（id850）都行。\n不绑定也能看分数线和容错；绑定了还有你的成绩和游玩记录，@ 别人看 TA 的。",
  // 这首歌没有要的难度：levels 是它有的那几个难度名
  chartNoLevel: (title, level, levels) => "「" + title + "」没有 " + level + " 谱面" + (levels.length ? "，有的是：" + levels.join("、") + "。" : "。"),
  // 要 WE，这首歌有好几个 WORLD'S END 版
  chartPickWorldsEnd: (title, lines) => "「" + title + "」有好几个 WORLD'S END 版，用 ID 再发一次吧：\n" + lines.join("\n"),
  chartNoNotes: (title) => "落雪还没有「" + title + "」这张谱面的物量，算不了分数线和容错。",
  // 下面几句写在图上「游玩记录」那块，代替曲线
  chartHistoryPrivate: (isSelf) => isSelf
    ? "你在落雪没开「允许第三方读取历史成绩」，打开以后这里会画出游玩记录（用 /授权 绑定的不受这个开关管）。"
    : "TA 在落雪没开「允许第三方读取历史成绩」，看不到游玩记录。",
  chartHistoryFailed: "落雪的游玩记录这次没拿到，过一会儿再试试。",
  // plays：落雪里一共几条；shown：90 万分以上能画的几条（不到两条画不出线）
  chartHistoryShort: (plays, shown) => (plays === 0 ? "落雪里还没有这张谱面的游玩记录。"
    : plays === 1 ? "落雪里这张谱面只有一次记录，画不出曲线。"
      : "落雪记了" + plays + "次，90 万分以上的" + (shown ? "只有一次" : "一次都没有") + "，画不出曲线。"),

  // ── /信息 ──
  info: (player, api) => [
    player.name + "（Rating " + formatRating(player.rating) + "）",
    "好友码：" + player.friend_code,
    "绑定方式：" + (api.method === "oauth" ? (api.oauthExpired ? "授权（已失效，发「/授权」重新授权）" : "授权") : "好友码"),
    "落雪上次同步：" + (player.upload_time ? new Date(player.upload_time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未知"),
  ].join("\n"),
};

// 落雪和 OAuth 的错误换成玩家能看懂的话。不认识的错误返回 null，由调用方按内部错误处理。
function errorText(error) {
  if (error instanceof OAuthError) {
    if (error.code === "invalid_grant") return V.authorizeBadCode;
    if (error.code === "no_pending") return V.authorizeNoPending;
    if (error.code === "disabled") return V.authorizeDisabled;
    if (error.code === "invalid_client") return "机器人这边的落雪 OAuth 应用配置有问题，请联系管理员。";
    return "落雪查分器暂时连不上，等一会儿再试吧。";
  }
  if (!(error instanceof LxnsError)) return null;
  switch (error.code) {
    case "player_not_found": return "落雪上找不到这个玩家。好友码对吗？刚注册的话，要先在落雪同步一次中二数据。";
    case "invalid_friend_code": return "好友码应该是一串数字。";
    case "privacy_player": return "这位玩家在落雪关闭了「允许读取玩家信息」，查不到。";
    case "privacy_scores": return "这位玩家在落雪关闭了「允许读取谱面成绩」，查不到成绩。";
    case "privacy_history": return "这位玩家在落雪关闭了「允许读取历史成绩」，看不到这部分数据。";
    case "need_oauth": return "这个要读全部成绩的具体分数，需要先发「/授权」用落雪账号授权。";
    case "oauth_expired": return V.oauthExpired;
    case "rate_limited": return "落雪查分器说请求太频繁了，等一会儿再试吧。";
    case "unauthorized":
    case "no_dev_token": return "机器人这边的落雪密钥出问题了，请联系管理员。";
    default: return "落雪查分器暂时连不上，等一会儿再试吧。";
  }
}

module.exports = { V, errorText, formatRating };
