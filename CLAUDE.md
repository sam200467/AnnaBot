# Anna Bot

中二节奏（CHUNITHM）查分 QQ 机器人，数据来自落雪查分器（maimai.lxns.net）。照着作者的另一个机器人
MiaBot（音击查分，github.com/sam200467/MiaBot，作者本机在 `F:\vibe coding实验\音击分表制作测试`）做：
同样是 QQ 官方机器人，传输层直接移植自它。

作者 sam2004，用中文交流：回复、代码注释、文档都用中文。代码风格跟着现有文件走：Node 22、CommonJS（`.cjs`）、
`"use strict"`、双引号、没有第三方依赖（只有 `ws`）。注释写「为什么」，尤其是实测踩出来的坑。

开发是「一个功能一个窗口」：底座（这份文档描述的东西）已经搭好，每个新窗口只做一个功能，通常还要配上作者提供的背景图等素材。

## 常用命令

```
npm test                         全部测试（假 QQ + 假落雪，不联网；出图测试要本机有 Chrome/Edge）
npm run try -- "#信息" "#示例图"   用真落雪数据、真出图流程跑指令，QQ 换成本地假的；图片存到 data/try/
npm run theme -- <主题名>         主题实时预览（浏览器打开，改 CSS 刷新就能看到）
npm run preview -- <主题名>       用正式出图流程渲染主题的示例数据
npm start                        正式启动（要 .env 和 config.local.json 都填好）
npm run probe                    QQ 连接探针：拿 group_openid / openid（--formal / --sandbox 选环境）
npm run check:lxns               落雪接口连通性检查
```

`npm run try` 在 Git Bash 里写 `/` 开头的指令会被改成路径（工具里已经改回来了），写 `#信息` 最稳。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/official-transport.cjs` | QQ 官方机器人传输层，移植自 MiaBot（改之前看文件头） |
| `src/bot.cjs` | 消息处理顺序：白名单 → @ 判定 → 去重 → 认指令 → 执行 |
| `src/commands.cjs` | 指令解析、功能表、绑定检查、出图队列/冷却、二次确认；**功能模块的写法在文件开头** |
| `src/features/` | 一个功能一个文件，在 `index.cjs` 里登记 |
| `src/voice.cjs` | 所有回给玩家的话，包括落雪错误的翻译（`errorText`） |
| `src/lxns.cjs` | 落雪接口：公共 / 开发者 / 玩家三种 |
| `src/lxns-oauth.cjs` | OAuth（无回调地址 + PKCE） |
| `src/bindings.cjs` | 绑定和统一查分入口 `player(openid)` |
| `src/vault.cjs` | 加密绑定库（AES-256-GCM，主密钥由 DPAPI 保护） |
| `src/catalog.cjs` | 曲库和别名：缓存、搜索（`search` / `resolve`） |
| `src/assets.cjs` | 落雪图片素材本地缓存 |
| `src/renderer.cjs` | 无头 Chrome/Edge 出图 |
| `src/services.cjs` | 按配置把上面这些装起来（`main.cjs` 和 `tools/` 共用） |
| `themes/` | 出图主题，约定见 `themes/README.md` |
| `tools/` | 上面那些命令 |
| `test/` | 测试，`mock-official.cjs`（假 QQ）和 `mock-lxns.cjs`（假落雪）可以复用 |

## 加一个新功能

1. `src/features/<名字>.cjs`：照 `commands.cjs` 开头的格式写一个模块，在 `src/features/index.cjs` 里加一行。
   - `binding: "any"`：好友码或授权绑定都行，`ctx.player` 就是查分入口（方法见 `bindings.cjs` 的 `createPlayerApi`）
   - `binding: "oauth"`：要全部成绩的**具体分数**时用（等级成绩、分表）。好友码绑定的人会被提示去 `/授权`
   - `allowOthers: true`：`@某人 /指令` 查别人。查别人一律走开发者接口（受对方在落雪的第三方开关管），只能查自己的功能别开
2. 出图：照 `src/features/example-image.cjs` 写，交给 `ctx.image({ kind, label, render })`。排队、冷却、占位消息、
   被动回复过期都由它管。落雪素材在 `render` 里用 `assets.fileUrls` 换成 `file://` 地址（慢，必须在队列里做）。
3. 主题：复制 `themes/_example/` 成 `themes/<名字>/`，按 `themes/README.md` 写。作者给的背景图等放 `themes/<名字>/assets/`，
   几个主题共用的图标和字体放 `themes/shared/`。示例数据里用 `"lxns:jacket/407"` 引用落雪素材。
4. 文案写进 `src/voice.cjs`，功能代码里不直接写句子。
5. 测试：在 `test/` 加用例（端到端的写法看 `test/bot.test.cjs`），`npm test` 全过；再用 `npm run try` 拿真数据跑一遍、看图。

## 出图的视觉风格

第一个出图功能 `/b50` `/b30`（`src/features/best.cjs` + `themes/best/`）定下了 Anna 出图的样子：中二节奏「西比拉精灵记」
那种阴沉的暗色幻想风 —— 最外面一个洛可可金色画框、框里烧焦撕边的羊皮纸、上面五位巫女下面火烧的战场、旧纸片卡片、
封蜡评级、缎带章节名、手写的字。设计说明在 `themes/best/README.md`，新的出图主题沿用同一套：

- 正文只用一种手写字体：霞鹜文楷 Medium（`themes/shared/fonts.css` 的 `Anna Hand`，写成 `"Anna Hand", "Segoe UI Symbol", serif`）。
  它一个字体就有简体、繁体、日文汉字、假名、西文，曲名混排时大小、笔迹才对得齐 —— 之前几种字体叠着用（Segoe Script、
  辰宇落雁體、华文楷体补假名），作者嫌大小不统一。别再往同一段字里叠别的字体
- 作者另外指定了几处纯数字、纯西文用 Segoe Script（`Anna Script`），跟正文区分开：单曲分数、定数、单曲 Rating（定数和 Rating 差不多大）、页脚格言
- 字要够大：作者两次嫌字小（名牌版、Rating 那几格的大小是他认可的参照）；标签、说明能省就省（第一版的大标题和说明文字被删了）
- 难度用颜料色（铜绿、赭黄、朱红、紫、黑红），不用游戏里的亮色；画框、撕边、封蜡、缎带、装饰线、柱状图可以直接从
  `themes/best/renderer/theme.js` 拿（画框素材 `themes/best/assets/frame.png`，拼法见 `FRAME`）
- 纹理多的图出 JPEG（`renderer.render(主题, 数据, { format: "jpeg", quality: 76 })`）：B50 出 PNG 要 18 MB，
  超过 QQ 的 8 MB 上限；JPEG 质量 76 约 4 MB（82 就有 4.7 MB 了）。作者要求单张图在 5 MB 以内

## 落雪接口要点（2026-10-13 用真实密钥实测）

- 基址 `https://maimai.lxns.net/api/v0/`，路径里游戏写 `chunithm`。公共接口直接返回数据；开发者/玩家接口包一层 `{ success, code, message, data }`，`lxns.cjs` 已解包。
- 三种鉴权：开发者 `Authorization: <密钥>`（按好友码查任何人）；个人密钥 `X-User-Token`（只能查自己，Anna 只在检查脚本里用）；OAuth `Authorization: Bearer <令牌>`。
- **开发者接口的 `/scores` 没有分数**（只有评级、CLEAR、FC 标记）。B30（`/bests`）、单曲（`/bests?song_id=`）、最近 50（`/recents`）有完整分数。全部分数只能走 OAuth。
- 玩家在落雪有「允许第三方读取」开关：玩家信息、谱面成绩默认开，**历史成绩（trend 等）默认关**，关着时开发者接口 403。
- `/best?song_id&level_index` 没玩过返回 200 + `null`；好友码不存在 404；不是数字 400。
- 玩家 Rating = （旧版本 Best 30 + 新曲 Best 20）共 50 首单曲 Rating 的平均值，截到两位小数（`bests` 返回 `bests` / `new_bests` / `selections`）。
- 难度 `level_index`：0 BASIC … 3 MASTER、4 ULTIMA、5 WORLD'S END。WE 是单独的曲目（ID 8000 起），只有难度 5，曲绘用原曲 ID（`catalog.jacketId`）。
- 当前国服版本 24000 = CHUNITHM X-VERSE（版本表里可能先列出还没有曲目的下一个版本，`catalog.currentVersion()` 已处理）。
- 素材服务器 `https://assets2.lxns.net/chunithm/{jacket,character,trophy,plate,icon}/{id}.png` 很慢（一张 0.3～16 秒）且限频，一律走 `assets.cjs` 的缓存。
- 文档只列了几个玩家接口，完整列表看落雪前端源码 github.com/Lxns-Network/maimai-prober-frontend（`user/{game}/player/...`）。
- OAuth：访问令牌 15 分钟，刷新令牌 30 天、**每次刷新都换新的、旧的立刻作废**。刷新的串行和写回在 `bindings.cjs`，别绕过它直接调 `oauth.refresh`。

## QQ 官方平台的硬约束

MiaBot 实测：

- 不能主动发消息，所有回复都是被动回复、回在原地。群里一条消息 5 分钟内最多回 5 次，私聊 60 分钟 4～5 次。
- 拿不到 QQ 号，只有 openid（换 AppID 就变）。所以落雪的「按 QQ 号查」用不上，绑定只能好友码或 OAuth。
- 群里判断「是不是在叫 Anna」用平台给的 `mentions[].is_you`，不能用「有没有 @ 人」——别的机器人被 @ 的指令也会推过来。

Anna 2026-10-15 真 QQ 联调实测（机器人还没公开）：

- 不用沙箱：没公开的机器人直接连正式环境（`sandbox: false`），只有管理员能用。沙箱也连得上，但**两个环境不能同时连**：
  后连的会被判会话失效（op 9）再以 4903 关掉。同一个环境开两个连接可以，都会收到事件。
- openid 跟环境无关：沙箱、正式里同一个人、同一个群的 openid 一样；同一个人私聊和群里的 openid 也一样，私聊绑定、群里查分走得通。
- 群里 @ 了没反应、私聊正常：群主要在群里点机器人头像，设置它能收哪些群消息（官方 FAQ 也这么说）。
- 纯文本消息里能带外部链接：`/授权` 的落雪链接发得出去，授权走通了。约 3.8 MB 的 JPEG 在群里、私聊都发得出去。
- 取网关地址会被限频（40023001），断线重连失败要接着退避（`official-transport.cjs` 的 `scheduleReconnect`）。
- 还没验证：Markdown 和按钮权限（还没有功能用到）；公开以后别人用起来怎样。

## 底座层面还没做的

- 公开上线：现在只有管理员能用。让群友用，要在开放平台做开发者认证、把服务范围设成公开（官方 FAQ：个人认证后最多进 500 个群），
  上线后在别人的群里再验一遍。
- 日常运行：现在只能开着一个窗口 `npm start`。MiaBot 有无窗口的启动/停止脚本（`qq-official/make-launchers.cjs` 生成 VBS），可以照着做。
- 曲绘预下载：B50 这类图第一次出时要现下 50 张曲绘，会慢（2026-10-14 实测：50 张都没缓存时要等 40 秒左右）。
  落雪素材限频，预下载要低并发、慢慢来。
- 角色聊天：`bot.cjs` 留了 `deps.chat` 钩子（@ 了 Anna 但不是指令时调用），人设定了以后再接。

## 提交

分支 `main`，远程 `origin` = github.com/sam200467/AnnaBot（**公开仓库**）。作者身份是仓库级配置
（sam2004 + GitHub noreply 邮箱，跟 MiaBot 一样），别改。
一个功能做完、`npm test` 全过再提交一次；作者要求提交、推送时才做。提交前确认 `git status` 里没有 `.env`、`data/`、素材文件。

仓库是公开的，所以代码、测试、文档里都不能出现作者的个人信息：真实好友码、游戏昵称、授权码、openid 一律用假的
（测试里用 `123456789012345`、「测试玩家」这类）。用 `npm run try` 跑出来的真数据只留在本机的 `data/` 里。

## 不能做的事

- 不提交密钥和运行数据：`.env`、`config.local.json`、`data/` 都在 `.gitignore` 里。日志里不记指令参数（可能是授权码）。
- 不提交第三方素材：`themes/**/assets/`、`themes/shared/fonts|icons/` 里的图和字体由作者自己准备，不进仓库。
- 不改 `src/vault.cjs` 里的 `DPAPI_ENTROPY` 和文件格式：改了已有的绑定全部解不开。
- 落雪服务条款禁止把数据用于商业用途。
