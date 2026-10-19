# Anna Bot

中二节奏（CHUNITHM）查分 QQ 机器人，数据来自落雪查分器（maimai.lxns.net）。照着作者的另一个机器人
MiaBot（音击查分，github.com/sam200467/MiaBot，作者本机在 `F:\vibe coding实验\音击分表制作测试`）做：
同样是 QQ 官方机器人，传输层直接移植自它。

作者 sam2004，用中文交流：回复、代码注释、文档都用中文。代码风格跟着现有文件走：Node 22、CommonJS（`.cjs`）、
`"use strict"`、双引号、运行时没有第三方依赖（只有 `ws`；`opencc-js` 只是离线生成搜索数据用的开发依赖，打包不带）。
注释写「为什么」，尤其是实测踩出来的坑。

开发是「一个功能一个窗口」：底座（这份文档描述的东西）已经搭好，每个新窗口只做一个功能，通常还要配上作者提供的背景图等素材。

## 常用命令

```
npm test                         全部测试（假 QQ + 假落雪，不联网；出图测试要本机有 Chrome/Edge）
npm run try -- "#信息" "#示例图"   用真落雪数据、真出图流程跑指令，QQ 换成本地假的；图片存到 data/try/
npm run theme -- <主题名>         主题实时预览（浏览器打开，改 CSS 刷新就能看到）
npm run preview -- <主题名>       用正式出图流程渲染主题的示例数据
npm start                        正式启动（要 .env 和 config.local.json 都填好）
npm stop                         停掉在跑的 Anna（无窗口启动的、npm start 开的都算）
npm run launchers                生成无窗口启动器「启动Anna.vbs」「停止Anna.vbs」（作者双击用）
npm run package                  打服务器完整安装包（带密钥和绑定，dist/ 下的 zip）；本机的 Anna 要先停
npm run package:folder           同上，只出解开的文件夹（不打 zip）
npm run package:update           打服务器更新包（只有程序）
npm run probe                    QQ 连接探针：拿 group_openid / openid（--formal / --sandbox 选环境）
npm run panel                    指令面板（QQ 输入框打 / 弹出的清单）：看本地和平台上的样子；-- --sync 不重启马上同步
npm run check:lxns               落雪接口连通性检查
npm run song-extras              重新生成 src/data/song-extras.json（日服上线日期、对应角色）；新版本出曲后跑，wikiwiki 限频要慢慢来
npm run song-search              重新生成 src/data/song-search.json（简繁日异体字表、官方假名读音）；新版本出曲后跑，要先 npm install
npm run fit-diffs                重新生成 src/data/fit-diffs.json（EazyChu 拟合定数，/拟合定数b30 用）；新版本出曲后跑
npm run character-icons          从 wikiwiki 立绘截落雪没有的角色头像（截哪块见 tools/character-icons.json）；-- --sheet 文件 出总览图
```

`npm run try` 在 Git Bash 里写 `/` 开头的指令会被改成路径（工具里已经改回来了），写 `#信息` 最稳。

Anna 平时可能正用「启动Anna.vbs」在后台跑（没有窗口，状态看 `data/logs/`）。改了代码要重启：`npm stop`，再让作者双击启动，
或者 `npm start` 开在终端里看日志。别在它开着的时候再 `npm start`：同一个 QQ 环境连两次，每句话会回两遍。
后台跑的 Anna 没有控制台，代码里起子进程一律带 `windowsHide: true`，不然会弹黑框。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/official-transport.cjs` | QQ 官方机器人传输层，移植自 MiaBot（改之前看文件头） |
| `src/bot.cjs` | 消息处理顺序：白名单 → @ 判定 → 去重 → 认指令 → 执行 |
| `src/commands.cjs` | 指令解析、功能表、绑定检查、出图队列/冷却、二次确认；**功能模块的写法在文件开头** |
| `src/command-panel.cjs` | 指令面板：按功能表生成，`bot.start()` 时同步到 QQ（平台规则在文件头） |
| `src/features/` | 一个功能一个文件，在 `index.cjs` 里登记 |
| `src/voice.cjs` | 所有回给玩家的话，包括落雪错误的翻译（`errorText`） |
| `src/lxns.cjs` | 落雪接口：公共 / 开发者 / 玩家三种 |
| `src/lxns-oauth.cjs` | OAuth（无回调地址 + PKCE） |
| `src/bindings.cjs` | 绑定和统一查分入口 `player(openid)` |
| `src/vault.cjs` | 加密绑定库（AES-256-GCM，主密钥由 DPAPI 保护） |
| `src/catalog.cjs` | 曲库和别名：缓存（带物量）、搜索（`search` / `resolve`，规则在 `song-search.cjs`）、版本名 |
| `src/song-search.cjs` | 认歌：简繁日汉字互通、假名和罗马音、拼错了给相近的候选（排名表在文件头）。数据是 `src/data/song-search.json`，由 `tools/build-song-search.cjs` 生成后提交 |
| `src/score-math.cjs` | 单曲 Rating、OVER POWER、分数线和容错的算法（公式照落雪前端，拿真成绩核过），`/谱面分析` 用 |
| `src/fit-diffs.cjs` | 拟合定数快照（EazyChu），`/拟合定数b30` 用；数据是 `src/data/fit-diffs.json`，由 `tools/build-fit-diffs.cjs` 生成后提交 |
| `src/song-extras.cjs` | 落雪没有的曲目信息：日服上线日期，原创、彩绿、音击舞萌曲的对应角色。数据是 `src/data/song-extras.json`，由 `tools/build-song-extras.cjs` 生成后提交 |
| `src/assets.cjs` | 落雪图片素材本地缓存 |
| `src/renderer.cjs` | 无头 Chrome/Edge 出图（每张图一个临时浏览器目录，出完删；删不掉的定时清扫） |
| `src/services.cjs` | 按配置把上面这些装起来（`main.cjs` 和 `tools/` 共用） |
| `themes/` | 出图主题，约定见 `themes/README.md` |
| `tools/` | 上面那些命令；`build-package.cjs` 打部署包、`install.cjs` 是服务器上的安装程序（改之前看文件头） |
| `test/` | 测试，`mock-official.cjs`（假 QQ）和 `mock-lxns.cjs`（假落雪）可以复用 |

## 加一个新功能

1. `src/features/<名字>.cjs`：照 `commands.cjs` 开头的格式写一个模块，在 `src/features/index.cjs` 里加一行。
   - `binding: "any"`：好友码或授权绑定都行，`ctx.player` 就是查分入口（方法见 `bindings.cjs` 的 `createPlayerApi`）
   - `binding: "oauth"`：要全部成绩的**具体分数**时用（等级成绩、分表）。好友码绑定的人会被提示去 `/授权`
   - `allowOthers: true`：`@某人 /指令` 查别人。查别人一律走开发者接口（受对方在落雪的第三方开关管），只能查自己的功能别开
   - 指令面板（QQ 输入框打 `/` 弹出的清单）跟着功能表走、启动时自动同步，不用另外注册。说明默认用 `summary`，
     超过 15 个汉字（平台算 30 个字符，中文算 2 个）时写一个短的 `panel`，测试会提醒
2. 出图：照 `src/features/example-image.cjs` 写，交给 `ctx.image({ kind, label, render })`。排队、冷却、占位消息、
   被动回复过期都由它管。落雪素材在 `render` 里用 `assets.fileUrls` 换成 `file://` 地址（慢，必须在队列里做）。
3. 主题：复制 `themes/_example/` 成 `themes/<名字>/`，按 `themes/README.md` 写。作者给的背景图等放 `themes/<名字>/assets/`，
   几个主题共用的图标和字体放 `themes/shared/`。示例数据里用 `"lxns:jacket/407"` 引用落雪素材。
4. 文案写进 `src/voice.cjs`，功能代码里不直接写句子。
5. 测试：在 `test/` 加用例（端到端的写法看 `test/bot.test.cjs`），`npm test` 全过；再用 `npm run try` 拿真数据跑一遍、看图。
   真出图的测试给 `createRenderer` 传 `tmpDir`（测试自己的临时目录），结束前 `await renderer.idle()`（照 `test/renderer.test.cjs`）：
   不碰系统临时目录，也顺便验了浏览器临时目录删干净没有。

## 出图的视觉风格

第一个出图功能 `/b50` `/b30`（`src/features/best.cjs` + `themes/best/`）定下了 Anna 出图的样子：中二节奏「西比拉精灵记」
那种阴沉的暗色幻想风 —— 最外面一个洛可可金色画框、框里烧焦撕边的羊皮纸、上面五位巫女下面火烧的战场、旧纸片卡片、
封蜡评级、缎带章节名、手写的字。设计说明在 `themes/best/README.md`，新的出图主题沿用同一套：

- `/aj30` / `/aj50` 是辅助分表：只挑 AJ（含 AJC）的谱面；30 不分新旧（一栏 30 首），50 分新旧（旧曲 30 + 新曲 20）。
  数据整理在 `best.cjs` 的 `buildData`（`mode: "aj30"` / `"aj50"`，章节 key 分别是 `aj` / `old`+`new`），
  功能在 `src/features/aj30.cjs`、`aj50.cjs`。主题沿用 best，`panel: false` 不进指令面板。
- `/拟合定数b30` 跟 `/b30` 同一套版式：把官方定数换成 EazyChu 拟合定数（`src/data/fit-diffs.json`），
  用 `score-math.rating(拟合定数, 分数)` 重算单曲 Rating，再不分新旧取前 30。数据整理是 `buildData` 的
  `mode: "fit30"`、章节 key `fit`，功能在 `src/features/fit30.cjs`。要全部成绩，`binding: "oauth"`。
  卡片上定数写 `≈15.47`，页眉三格是「拟合 B30 / Top / 原 B30」；主题沿用 best，`npm run fit-diffs` 更新拟合表。
- 正文只用一种手写字体：霞鹜文楷 Medium（`themes/shared/fonts.css` 的 `Anna Hand`，写成 `"Anna Hand", "Segoe UI Symbol", serif`）。
  它一个字体就有简体、繁体、日文汉字、假名、西文，曲名混排时大小、笔迹才对得齐 —— 之前几种字体叠着用（Segoe Script、
  辰宇落雁體、华文楷体补假名），作者嫌大小不统一。别再往同一段字里叠别的字体
- 作者另外指定了几处纯数字、纯西文用 Segoe Script（`Anna Script`），跟正文区分开：单曲分数、定数、单曲 Rating（定数和 Rating 差不多大）、页脚格言
- 玩家总 Rating 的颜色按游戏 VERSE 以后的色档：0 绿、4 橙、7 赤、10 紫、12 铜、13.25 银、14.5 金、15.25 铂、16 虹、17 虹极。
  阈值只在 `themes/shared/theme-kit.js` 的 `ratingTier`，各主题按自己的底（暗色 / 象牙纸）配色；游戏里 15.25 以后的星不画，
  字体也不跟着换（作者 2026-10-18：只改颜色，不动字体）
- 字要够大：作者两次嫌字小（名牌版、Rating 那几格的大小是他认可的参照），`/单曲` 又放大过一轮（小标签 22px 起，
  见 `themes/song/README.md`）；标签、说明能省就省（第一版的大标题和说明文字被删了）。图上不写玩家名（`/单曲` 页脚的被删了）
- 难度用颜料色（铜绿、赭黄、朱红、紫、黑红），不用游戏里的亮色；画框、撕边、封蜡、缎带、装饰线、柱状图可以直接从
  `themes/best/renderer/theme.js` 拿（画框素材 `themes/best/assets/frame.png`，拼法见 `FRAME`）
- 纹理多的图出 JPEG（`renderer.render(主题, 数据, { format: "jpeg", quality: 76 })`）：B50 出 PNG 要 18 MB，
  超过 QQ 的 8 MB 上限；JPEG 质量 76 约 4 MB（82 就有 4.7 MB 了）。作者要求单张图在 5 MB 以内
- 第二个出图功能 `/单曲`（`themes/song/`）在同一套框子里换了画面：背景是一幅公有领域的油画，右边半透明地叠着跟它主题相配的
  巫女立绘，正文全放左边、底板是拉丝黑铁加金边（不是羊皮纸卡片）。作者喜欢每个功能有自己的画面，但框子、字、颜料色、封蜡不变。
  设计说明在 `themes/song/README.md`
- 第三个出图功能 `/谱面分析`（`themes/chart/`）连框子也换了（作者要的）：画框是荷兰代尔夫特陶镜框、背景油画染成月光蓝、
  右边叠水之巫女朱娜的立绘，底板照她重新设计（深水焦散光、四芒星、菱格缎带），字、颜料色、金属封印照旧。图宽 2240、高跟着内容走。
  谱面信息里有版本名（曲库版本表）和拟合定数（`src/fit-diffs.cjs`，紧挨着难度那格写 `≈13.50` 这样），
  拟合表里没有的谱面、WORLD'S END 不画拟合定数。设计说明在 `themes/chart/README.md`
- 第四个出图功能 `/分数列表`（原名 `/等级`，`themes/list/`）：一批谱面的成绩列表，一页 78 张卡片、五列
  （安娜占掉前 7 行，前 6 行卡片只能排 3 列，18 + 12×5 正好填满最后一行；最后一页最多 80 张）。画框是安娜专属的（不用通用金框）：
  一本中世纪福音书封皮的钴蓝珐琅框，框里上半截是布莱兴的《哥特教堂废墟》，右边是安娜的全身立绘（半透明、不镜像，
  前几行卡片排在她左边）。右上角是玩家的名片板（名牌版、称号、★转生 Lv.等级 + 名字、角色和段位），总 Rating 写在板子里面
  （/b50 是写在名牌版外面的）；安娜从名片板下面开始、按剩下的高度等比缩小约一成。卡片骨架同 /b50，材质照安娜的衣服
  （象牙白的纸、金线、钴蓝点缀）。抬头一排统计格按类别分色（谱面钴蓝、通关琥珀、评级茜红），统计是包含关系
  （FC 含 AJ、AJ 含 AJC，SSS 含 SSS+）。这张图按 1.8 倍出（2 倍约 5.4 MB，超过 5 MB 上限）。设计说明在 `themes/list/README.md`

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
  角色图（character）只是 128 见方的头像，不是立绘。
- 曲目列表 `song/list?notes=true` 带每张谱面的物量（总数和 TAP/HOLD/SLIDE/AIR/FLICK）；`/song/{id}` 默认就带。成绩（Score）里还有 `over_power`。
  角色列表 `/chunithm/character/list`（1429 个，日文名；变身后的形态也单独有 ID，比如 機神 トール 110、覚醒機神 トール 111），
  里面没有「原创曲 → 角色」的对应关系，这个在 wikiwiki 的「キャラクター世界観」汇总页（见 `tools/build-song-extras.cjs`）。
- 文档只列了几个玩家接口，完整列表看落雪前端源码 github.com/Lxns-Network/maimai-prober-frontend（`user/{game}/player/...`）。
- 单张谱面的成绩历史 `.../score/history?song_id&level_index`（2026-10-17 实测）：每次上传一条 Score，按上传时间倒序，没过的、
  被技能强制结束的（分数很低、clear 是 failed）也在里面。OAuth 的 `read_player` 权限包括历史成绩；开发者接口要对方开着
  「允许读取历史成绩」（默认关）。排名 `user/chunithm/player/score/ranking?song_id&level_index` 只有玩家接口有：前 10 名加自己那一条，
  同分同名次。落雪没有中二的谱面文件（素材服务器的 `chunithm/chart/` 是 404），密度、变速这些分析不了。
- HARD / BRAVE / ABSOLUTE / CATASTROPHY 是通关标记，不是分数档：VERSE 起看通关时带的「危险技能」，各自在固定的判定次数强制结束
  （CATASTROPHY 是「天地創造」：JUSTICE 以下 10 次），见 wikiwiki「スキル比較(VERSE～)」。
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
- 指令面板（`/v2/panels`）没公开的机器人也能建：群聊面板（挂白名单里的群）、私聊面板（对所有人）都建上了。
  平台读回来的指令名去掉了开头的斜杠（跟 MiaBot 记的一样），归一化以后再同步一次不会再写。
- 取网关地址会被限频（40023001），断线重连失败要接着退避（`official-transport.cjs` 的 `scheduleReconnect`）。
- Markdown 和按钮权限：`/搜索歌曲` 已经在用（曲名指令链接、翻页按钮），还没在真 QQ 上实测；平台拒收时传输层会自动退回纯文本 / 不带按钮的 Markdown。
- 公开以后别人用起来怎样。

## 底座层面还没做的

- 公开上线：现在只有管理员能用。让群友用，要在开放平台做开发者认证、把服务范围设成公开（官方 FAQ：个人认证后最多进 500 个群），
  上线后在别人的群里再验一遍。
- 曲绘预下载：B50 这类图第一次出时要现下 50 张曲绘，会慢（2026-10-14 实测：50 张都没缓存时要等 40 秒左右）。
  落雪素材限频，预下载要低并发、慢慢来。
- 角色聊天：`bot.cjs` 留了 `deps.chat` 钩子（@ 了 Anna 但不是指令时调用），人设定了以后再接。

## 部署到服务器

`npm run package` 打完整包（只出解开的文件夹用 `npm run package:folder`），拷到服务器、双击「安装Anna.cmd」；以后有新功能用 `npm run package:update` 打更新包，同样双击安装。
细节在 `tools/build-package.cjs`、`tools/install.cjs` 的文件头，给作者看的说明是打包时生成的「部署说明.txt」。要点：

- 服务器跟 MiaBot 一样是 Windows。默认装到 `C:\AnnaBot`，开机自启是计划任务 `AnnaBot`（S4U：不存密码，没人登录也跑）。
  设了这个任务以后，「启动Anna.vbs」交给计划任务去启动，Anna 不挂在远程桌面会话上（直接起子进程的话，注销远程桌面会把它一起关掉）
- 服务器上的绑定库主密钥写在 `.env` 的 `ANNA_VAULT_KEY`，不用 DPAPI：S4U 任务里解不开，云控制台重置密码也会让 DPAPI 封的东西永远解不开
- 打完整包时本机的 Anna 必须停着，之后也别再开：刷新令牌是滚动的，两边各刷一次就有一边失效
- git 外的素材不用改打包脚本：`themes/*/assets/`、`themes/shared/fonts|icons/` 自动带上，字体只带主题里用到了名字的。
  新功能要是在 `src/` `tools/` `themes/` 之外加了运行时要读的目录，要加进 `build-package.cjs` 的 `PROGRAM_DIRS`
- `安装Anna.cmd` 只能是纯 ASCII、不能调 PowerShell：带 `powershell -EncodedCommand` 的 .cmd 一运行就被火绒 / 腾讯电脑管家
  当病毒删掉（2026-10-15 本机实测）。中文提示都由 `install.cjs` 打印
- S4U 计划任务里无头浏览器能出图（2026-10-16 服务器上出过 B30）。服务器没有显卡，出图比本机慢三四倍：当时 B30 要 32 秒，
  B50 截图超过了 30 秒的时限、出图失败；截图现在单独给 3 分钟（`renderer.cjs`），主题也提了速（`themes/README.md` 的「出图要快」）

## 提交

分支 `main`，远程 `origin` = github.com/sam200467/AnnaBot（**公开仓库**）。作者身份是仓库级配置
（sam2004 + GitHub noreply 邮箱，跟 MiaBot 一样），别改。
一个功能做完、`npm test` 全过再提交一次；作者要求提交、推送时才做。提交前确认 `git status` 里没有 `.env`、`data/`、`dist/`、素材文件。

仓库是公开的，所以代码、测试、文档里都不能出现作者的个人信息：真实好友码、游戏昵称、授权码、openid 一律用假的
（测试里用 `123456789012345`、「测试玩家」这类）。用 `npm run try` 跑出来的真数据只留在本机的 `data/` 里。

## 不能做的事

- 不提交密钥和运行数据：`.env`、`config.local.json`、`data/` 都在 `.gitignore` 里。日志里不记指令参数（可能是授权码）。
- 不提交第三方素材：`themes/**/assets/`、`themes/shared/fonts|icons/` 里的图和字体由作者自己准备，不进仓库。
- 不改 `src/vault.cjs` 里的 `DPAPI_ENTROPY` 和文件格式：改了已有的绑定全部解不开。
- 落雪服务条款禁止把数据用于商业用途。
