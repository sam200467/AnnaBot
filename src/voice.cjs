"use strict";
// Anna 说的话。所有回给玩家的文案都放在这里，指令和功能代码里不直接写句子 ——
// 口吻照中二节奏「西比拉精灵记」的圣女安娜：平时懒散、履职时认真。要换口吻只改这一个文件。
//
// 函数形式的条目带参数；数组形式的条目随机挑一句（见 commands.cjs 的 pick）。

const { LxnsError } = require("./lxns.cjs");
const { OAuthError } = require("./lxns-oauth.cjs");

// 截到两位小数，容差的道理见 themes/shared/theme-kit.js 的 format.rating
const formatRating = (value) => (Math.floor((Number(value) || 0) * 100 + 1e-8) / 100).toFixed(2);
// 玩家资料可能还没同步这些字段；缺失不能显示成 0，进度本身已经是百分数。
const formatPlayerStat = (value, digits, unit = "") => Number.isFinite(value) && value >= 0 ? value.toFixed(digits) + unit : "未知";
const V = {
  unknownCommand: "这个我不会哦。发「/帮助」，我把会做的都写在上面了。",
  notACommand: "要帮忙的话，发「/帮助」。……我会尽力的。",
  internalError: "……这次没办成。等一会儿再试一次吧。",

  // ── /帮助 ──
  // 抬头、分组名、结尾都在这儿。分组名按功能模块的 group 字段映射，模块里不用跟着改；
  // 没映射到的分组（以后新加的）原样显示。
  helpIntro: "我能替你做的事，都在这儿了（指令前面的 / 也可以换成 #）：",
  helpGroups: { "账号": "先让我记住你", "查询": "替你查", "其他": "杂事", "管理": "侍从的事" },
  helpOutro: "在群里，要先 @我一声哦。人太多了，不叫我名字，我听不见。\n" +
    "……成绩不理想也别太难过。只要不放弃，分数总会上去的。",

  // ── 绑定 ──
  needBinding: "你还没把名字交给我呢。发「/绑定 好友码」，或者用「/授权」让我看看你的落雪账号。",
  otherNotBound: "TA 还没把名字交给我，查不了。",
  needOAuth: (label) => "「/" + label + "」要看每一分的成绩，光有好友码不够。" +
    "发「/授权」，让我看看你的落雪账号吧。",
  oauthExpired: "你的授权失效了——可能是过期，也可能是在落雪那边撤销了。再发一次「/授权」吧，我重新记一遍。",
  bindUsage: "用法：/绑定 好友码\n" +
    "好友码是一串数字，在落雪查分器的个人页面能看到。\n" +
    "想让我看到每一分的成绩，就再发「/授权」，把落雪账号交给我。",
  bindDone: (player, previous) => "记住了：" + player.name + "（Rating " + formatRating(player.rating) + "）。" +
    (previous?.method === "oauth" ? "\n之前是用授权绑的，现在换成好友码了——要具体分数的功能，得重新「/授权」一次。" : ""),
  authorizeIntro: (url, minutes) => "用落雪账号授权。跟着做就好：\n" +
    "1. 打开下面的链接，登录落雪，同意授权\n" + url + "\n" +
    "2. 页面会给你一串授权码（形如 ABCD-EFGH-IJKL）\n" +
    "3. " + minutes + " 分钟内，把「/授权 授权码」发给我\n" +
    "这个链接只对你有效。别人拿到你的授权码，也绑不上我。",
  authorizeDone: (player) => "好了：" + player.name + "（Rating " + formatRating(player.rating) + "）。" +
    "现在每一分的成绩，我都能替你看了。",
  authorizeNoPending: "先发「/授权」拿链接，去落雪点完同意，再把授权码发给我。",
  authorizeBadCode: "这个授权码换不到授权……可能是输错了，也可能已经用过，或者不是用我给你的那个链接授权的。" +
    "再看一眼，不行就重新「/授权」。",
  authorizeDisabled: "授权这条路还没开。先用「/绑定 好友码」吧。",
  unbindConfirm: (minutes) => "确定要我把你忘掉吗？" + minutes + " 分钟内再发一次「/解绑」，我就照做。",
  unbindDone: (method) => "好，解绑了。" +
    (method === "oauth" ? "\n授权记录也可以去落雪「账号详情 → 第三方应用」里撤销。" : ""),
  unbindNotBound: "你还没把名字交给我，没什么可解的。",

  // ── 出图队列 ──
  jobAccepted: ["好，我这就画。……稍等。", "收到。画好了叫你。"],
  jobQueued: (ahead) => "收到。前面还有 " + ahead + " 张，画完你的我就叫你。",
  jobCooldown: (seconds) => "才刚画完一张呢。" + seconds + " 秒后再来吧。",
  jobSameKindPending: "上一张还没画完呢，等它出来再说。",
  jobQueueFull: "排队的人太多了……过一会儿再来吧。",
  jobFailed: (reason) => "这张图没画成：" + reason,
  imageTooLate: "图画好了，可是已经过了 QQ 能回复的时间，发不出去了……再发一次吧，我尽量快一点。",

  // ── /b30 ──
  // 好友码绑定只看得到新曲前 20：新曲挤进前 30 的超过 20 首时，第 21 首往后的可能没算进来
  bestMaybeIncomplete: (canAuthorize) => "新曲挤进前 30 的不止 20 首，落雪只给了新曲前 20——这张图可能漏了几首。" +
    (canAuthorize ? "发「/授权」以后按全部成绩算，就不会漏了。" : ""),

  // ── /aj30、/aj50（辅助分表）──
  aj30Empty: "还没有 AJ（含 AJC）的谱面。打出 AJ 再来找我吧。",
  // AJ 谱面不到 30 首时，B30 的空位按 0 算（跟 Rating 的算法一致）
  aj30Few: (count) => "AJ（含 AJC）的谱面只有 " + count + " 首，B30 里空着的位置按 0 算。",
  aj50Empty: "还没有 AJ（含 AJC）的谱面。打出 AJ 再来找我吧。",
  // /aj50 分新旧两栏：旧曲 30 个位置、新曲 20 个位置，空位都按 0 算
  aj50Few: (old, fresh) => "AJ（含 AJC）的谱面没排满：旧曲 " + old + "/30 首、新曲 " + fresh + "/20 首，空着的位置按 0 算。",

  // ── /拟合定数b30 ──
  fit30NoData: "拟合定数数据没有加载，先让管理员更新一下。",
  fit30Empty: "还没有能算拟合定数的成绩。先打几首再来吧。",
  // 不到 30 首时空位按 0 算；有谱面不在拟合表里（新曲、国服还没上）就退回官方定数
  fit30Note: (count, missing) => {
    const parts = [];
    if (count < 30) parts.push("只有 " + count + " 首有成绩，B30 的空位按 0 算。");
    if (missing) parts.push("其中 " + missing + " 张没有拟合定数，按官方定数算。");
    return parts.join("");
  },

  // ── /同步记录 ──
  historyUsage: "直接发「/同步记录」，查看最新一次更新的成绩。需要授权；不再提供日期选项或翻页。",
  trendUsage: "用法：/推分记录 本周 / 本月 / 半年 / 今年。需要授权；本周从周一、本月从一号、今年从一月一号开始；半年从六个月前同日零点开始，月末超出则取该月最后一天。均按北京时间。",
  historyNoScores: "你还没有成绩。先打几首再来吧。",
  historyNoRecords: "还没有同步记录。等下一次同步再来吧。",

  // ── /出勤记录 ──
  attendanceUsage: "直接发「/出勤记录」就好，后面不用写别的。看最近一次出勤打了哪些谱面、打了多久，下面是近一年的同步日历。要授权。",
  attendanceNoPlays: "落雪上还没有你最近的游玩记录。打完歌去落雪同步一次，再来找我吧。",

  // ── /年度总结 ──
  yearReviewUsage: "用法：/年度总结（看去年的），或者「/年度总结 2024」写年份。要授权，只能看自己的。",
  yearReviewTooEarly: (year) => year + " 年还没过完呢。年度总结要等到第二年才能看。",
  yearReviewTooOld: (first) => "落雪的年度总结是从 " + first + " 年开始的，再早的没有。",
  // 落雪规定 Y 年的数据只能在 Y+1 年里生成
  yearReviewClosed: (year) => year + " 年的年度总结只能在 " + (year + 1) + " 年里生成。那时候没有生成过，落雪那边已经没有了……",
  yearReviewGenerating: (year) => "第一次看 " + year + " 年的，要先请落雪统计一下。……稍等，可能要一会儿。",
  yearReviewEmpty: (year) => year + " 年你没有在落雪上传过成绩，没什么可总结的。",

  // ── /热门谱面 ──
  popularUsage: "用法：/热门谱面，后面不用写别的。近 7 天和近 30 天两张榜画在一张图上；绑定了的话，你在这些谱面上的成绩也会画上去。",
  popularEmpty: "落雪的热门榜现在是空的……过一会儿再来看吧。",

  // ── /单曲 ──
  songUsage: "用法：/单曲 曲名\n曲名记不全也没关系：写一部分、别名或者曲目 ID（id850）都行，简体繁体、假名罗马音我也认。@ 别人可以看 TA 的成绩。",
  songNotFound: (query) => "没找到「" + query + "」……再给我一点线索？曲名的一部分、别名，或者曲目 ID（id850）都行。",
  songAmbiguous: (query, lines, more) => "「" + query + "」对上了好几首，我不敢猜。用 ID 再发一次吧：\n" + lines.join("\n") +
    (more > 0 ? "\n……还有 " + more + " 首，写得再完整一点能少一些" : ""),
  // 曲名没对上，猜了几首相近的（拼错了、抄曲名时连作者一起抄进来了），只有一首也要玩家自己确认
  songMaybe: (query, lines, more) => "没找到「" + query + "」。是不是" + (lines.length > 1 ? "这几首里的" : "这首") + "？是的话，用 ID 再告诉我一次：\n" +
    lines.join("\n") + (more > 0 ? "\n……还有 " + more + " 首" : ""),
  // 候选列表的一行：id850　《混乱》 ～ Muspell（Norn）；WE 版在后面标出来
  songCandidate: (song, worldsEnd) => "id" + song.id + "　" + song.title + (worldsEnd ? "【WORLD'S END】" : "") + (song.artist ? "（" + song.artist + "）" : ""),

  // ── /搜索歌曲 ──
  searchUsage: "用法：/搜索歌曲 曲名线索\n写曲名的一部分、别名或者曲目 ID（id850）都行，简体繁体、假名罗马音也认。结果多时加「--page 2」翻页。",
  searchNotFound: (query) => "没找到「" + query + "」相关的歌……换一小段曲名、别名或者 ID 试试？",
  searchNoPage: (pages) => "这一页什么都没有。一共只有 " + pages + " 页。",
  // total 是全部结果数，不是这一页的；只有一页时不写页码，少占一行
  searchFound: (total, page, pages) => "查到 " + total + " 首" + (pages > 1 ? "（第 " + page + "/" + pages + " 页）" : "") + "：",
  searchNoCharts: "落雪那边还没有这首歌的谱面数据。",
  searchFuzzy: "上面是曲名比较接近的几首。……你看看有没有对的。",
  searchPage: (page, pages) => "第 " + page + "/" + pages + " 页",
  searchPageButtons: (page, pages) => "第 " + page + "/" + pages + " 页，" +
    (page < pages ? "点下面的按钮翻页" : "点下面的按钮回到前面的页") + "；点页码可以自己填页数",
  // 只在 Markdown 里出现：纯文本没有可点的曲名，写这句反而让人以为点不了
  searchHint: "（点曲名会填入 /谱面分析 和曲目 ID，再补一个难度字：绿/黄/红/紫/黑；WE 的整条已经填好）",
  searchPagerLabels: {
    prev: "◀ 上一页", next: "下一页 ▶", first: "⏮ 首页", last: "末页 ⏭",
    page: (page, pages) => "第" + page + "/" + pages + "页",
    unsupported: "这个版本的 QQ 不支持按钮，请手动发送翻页指令",
  },

  // ── /谱面分析 ──
  chartUsage: "用法：/谱面分析 曲名 难度\n难度写在最后，不写就是 MASTER：绿 黄 红 紫 黑、bas adv exp mas ult、WE 都认。" +
    "曲名写一部分、别名或者曲目 ID（id850）都行。\n不绑定也能看分数线和容错；绑定了，我还能看到你的成绩和游玩记录。@ 别人也看。",
  // 这首歌没有要的难度：levels 是它有的那几个难度名
  chartNoLevel: (title, level, levels) => "「" + title + "」没有 " + level + " 谱面哦" + (levels.length ? "，有的是：" + levels.join("、") + "。" : "。"),
  // 要 WE，这首歌有好几个 WORLD'S END 版
  chartPickWorldsEnd: (title, lines) => "「" + title + "」有好几个 WORLD'S END 版，我分不清。用 ID 再发一次吧：\n" + lines.join("\n"),
  chartNoNotes: (title) => "落雪还没有「" + title + "」的物量，分数线和容错就算不出来了。",
  // 下面几句写在图上「游玩记录」那块，代替曲线
  chartHistoryPrivate: (isSelf) => isSelf
    ? "你在落雪没开「允许第三方读取历史成绩」。打开以后，这里就能画出你的游玩记录了（用 /授权 绑定的不受这个开关管）。"
    : "TA 没开「允许第三方读取历史成绩」，我看不到游玩记录。",
  chartHistoryFailed: "这次的游玩记录没拿到……过一会儿再试试。",
  // plays：落雪里一共几条；shown：90 万分以上能画的几条（不到两条画不出线）
  chartHistoryShort: (plays, shown) => (plays === 0 ? "这张谱面还没有游玩记录。打一次再来吧。"
    : plays === 1 ? "只有一次记录，画不出曲线。"
      : "一共记了 " + plays + " 次，但 90 万分以上的" + (shown ? "只有一次" : "一次都没有") + "——画不出曲线。"),

  // ── /分数列表（原名 /等级）──
  levelUsage: "用法：/分数列表 14+（或者定数：/分数列表 14.5、分类：/分数列表 精灵记），后面还能加：\n" +
    "· 页码：/分数列表 14+ 2；分类后面直接写数字就是页码：/分数列表 精灵记 2\n" +
    "· 难度：绿 黄 红 紫 黑（或 bas adv exp mas ult）\n" +
    "· 版本：X-VERSE、LUMINOUS PLUS 这样的版本名\n" +
    "· 评级：SSS以下（还没到 SSS 的，没打过的也算）、SSS以上，只写 SSS 是正好 SSS 这一档\n" +
    "· 分类：精灵记、音击、舞萌、BMS、东方、彩绿、原创……（一次一个；默认只列紫谱/黑谱，分类后只能再加紫/黑和页码）\n" +
    "· 谱师：/分数列表 Techno Kitchen；翻页：/分数列表 Techno Kitchen 2（只列紫谱/黑谱，只接受名字和数字页码）\n" +
    "想让我按每一分的成绩来列，得先「/授权」。",
  levelUnknown: (words) => "「" + words.join(" ") + "」……我看不懂。\n" + V.levelUsage,
  levelNoWorldsEnd: "WORLD'S END 没有等级和定数，列不出来。",
  levelTagOnly: "分类后面只能加紫/黑和页码；等级、定数、版本、评级、第二个分类都不能一起写。比如「/分数列表 精灵记 紫 2」。",
  levelTagDifficulty: "分类默认只统计紫谱（MASTER）和黑谱（ULTIMA），红黄绿不放进来。",
  levelDesignerUsage: "用法：/分数列表 名字；翻页在名字后面空格加数字，比如「/分数列表 Techno Kitchen 2」。默认只列紫谱、黑谱。",
  levelDesignerOnly: "按谱师查只写名字和页码，不叠加其他条件。比如「/分数列表 Techno Kitchen 2」。",
  levelNeedMain: "只按评级筛，没打过的几千张谱面都算进来，没法看。加上等级、定数、难度、版本或者分类吧，比如「/分数列表 14+ SSS以下」。",
  // label：条件写成的一行字（Lv.14+ · MASTER · 未达 SSS）
  levelEmpty: (label) => "没有符合条件的谱面（" + label + "）。",
  levelNoPage: (pages) => "只有 " + pages + " 页。",
  // 图注：next 是下一页的指令，最后一页是 null
  levelPage: (page, pages, next) => "第 " + page + "/" + pages + " 页" + (next ? "，下一页发「" + next + "」" : "（最后一页）"),

  // ── /牌子进度 ──
  plateUsage: "用法：/牌子进度 版本名，比如「/牌子进度 SUN PLUS」「/牌子进度 lmn+」，不写就是当前版本。\n" +
    "看这个版本 BASIC～MASTER 全部谱面离 Spirit（全 S）、Tribute（全 SSS）、Legend（全 AJ）三个称号还差多少。\n" +
    "想让我按每一分的成绩来算，得先「/授权」。",
  plateUnknown: (words) => "「" + words.join(" ") + "」……这里只写版本名就行。\n" + V.plateUsage,
  // 版本表里已经有、但还没出曲目的版本
  plateNoSongs: (label) => label + " 还没有曲目。",

  // ── /信息 ──
  info: (player, api) => [
    player.name + "（Rating " + formatRating(player.rating) + "）",
    "好友码：" + player.friend_code,
    "绑定方式：" + (api.method === "oauth" ? (api.oauthExpired ? "授权（已失效，发「/授权」重新授权）" : "授权") : "好友码"),
    "总游玩次数：" + formatPlayerStat(player.total_play_count, 0, " 次"),
    "总 OP：" + formatPlayerStat(player.over_power, 2),
    "OP 进度：" + formatPlayerStat(player.over_power_progress, 2, "%"),
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
    return "落雪那边暂时连不上……等一会儿再试吧。";
  }
  if (!(error instanceof LxnsError)) return null;
  switch (error.code) {
    case "player_not_found": return "落雪上找不到这个玩家……好友码对吗？刚注册的话，要先去落雪同步一次中二数据。";
    case "invalid_friend_code": return "好友码是一串数字哦。";
    case "privacy_player": return "TA 在落雪关了「允许读取玩家信息」，我查不到。";
    case "privacy_scores": return "TA 在落雪关了「允许读取谱面成绩」，我查不到成绩。";
    case "privacy_history": return "TA 在落雪关了「允许读取历史成绩」，这部分我看不到。";
    case "need_oauth": return "这个要看每一分的成绩，得先发「/授权」，把落雪账号交给我。";
    case "oauth_expired": return V.oauthExpired;
    case "rate_limited": return "落雪那边说我问得太勤了……等一会儿再来吧。";
    case "unauthorized":
    case "no_dev_token": return "机器人这边的落雪密钥出问题了，请联系管理员。";
    default: return "落雪那边暂时连不上……等一会儿再试吧。";
  }
}

module.exports = { V, errorText, formatRating };
