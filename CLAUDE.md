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
npm run song-extras              重新生成 src/data/song-extras.json（日服上线日期、对应角色、世界观厂牌 labels）；新版本出曲后跑，wikiwiki 限频要慢慢来
npm run song-origins             重新生成 src/data/song-origins.json（音击 / 舞萌拆分，OTOGE DB）；新版本出曲后跑
npm run song-bms                 重新生成 src/data/song-bms.json（BMS / BOF 整理表，萌百备注）；新版本出曲后跑
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
| `src/song-extras.cjs` | 落雪没有的曲目信息：日服上线日期、原创 / 彩绿 / 音击舞萌曲的对应角色、世界观厂牌 labels。数据是 `src/data/song-extras.json`，由 `tools/build-song-extras.cjs` 生成后提交 |
| `src/song-tags.cjs` | 曲目分类标签：官方分类、世界观厂牌、音击 / 舞萌、BMS；别名和 `has(song, tag)`。数据是 `src/data/song-origins.json`（`tools/build-song-origins.cjs`）和 `src/data/song-bms.json`（`tools/build-song-bms.cjs`），`/分数列表 精灵记` 用 |
| `src/chart-designers.cjs` | 谱师原始署名和别名索引；别名在 `src/data/chart-designer-aliases.json`，由作者补。用 `node tools/list-chart-designers.cjs` 导出署名和谱面数量清单 |
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

- `/b50` `/b30` 以及下面的 `/aj30`、`/aj50`、`/拟合定数b30` 2026-10-20 起全部统一为横版（`themes/felix/`，设计说明见它的 README），
  旧竖版 best 已停用，保留其他主题仍引用的素材。照 /同步记录 的横版：画框里一幅油画（科尔《建筑师之梦》），框是荷兰国立博物馆的彩绘锡釉陶镜框（等比缩小变细，
  不能压扁花纹），右边那一栏半透明地站着小时候的朱娜（ジュナ・フェリクス），上下左右居中、不压右下角的落款；
  左边柱状图 + 名牌版，下面旧曲 B30（三列）、新曲 N20（两列）两张平行的表，/b30 一张五列的表。卡片是白釉陶砖，
  表是她披风里子的蔚蓝，柱状图和 Rating 三格是她制服的白（作者嫌漆底暗，要照角色的衣服配色）。画面照油画原图的比例，
  朱娜那一栏夹在 1100～1500（/b50 左右、/b30 上下裁一点油画）。按 1.5 倍出：B50 约 5900×4000、3.5 MB
- `/aj30` / `/aj50` 是辅助分表：只挑 AJ（含 AJC）的谱面；30 不分新旧（一栏 30 首），50 分新旧（旧曲 30 + 新曲 20）。
  数据整理在 `best.cjs` 的 `buildData`（`mode: "aj30"` / `"aj50"`，章节 key 分别是 `aj` / `old`+`new`），
  功能在 `src/features/aj30.cjs`、`aj50.cjs`。主题统一用 felix，`panel: false` 不进指令面板。
- `/拟合定数b30` 跟横版的 `/b30` 同一套版式：把官方定数换成 EazyChu 拟合定数（`src/data/fit-diffs.json`），
  用 `score-math.rating(拟合定数, 分数)` 重算单曲 Rating，再不分新旧取前 30。数据整理是 `buildData` 的
  `mode: "fit30"`、章节 key `fit`，功能在 `src/features/fit30.cjs`。要全部成绩，`binding: "oauth"`。
  卡片上定数写 `≈15.47`，页眉三格是「拟合 B30 / Top / 原 B30」；主题统一用 felix，`npm run fit-diffs` 更新拟合表。
- 正文只用一种手写字体：霞鹜文楷 Medium（`themes/shared/fonts.css` 的 `Anna Hand`，写成 `"Anna Hand", "Segoe UI Symbol", serif`）。
  它一个字体就有简体、繁体、日文汉字、假名、西文，曲名混排时大小、笔迹才对得齐 —— 之前几种字体叠着用（Segoe Script、
  辰宇落雁體、华文楷体补假名），作者嫌大小不统一。别再往同一段字里叠别的字体
- 作者另外指定了几处纯数字、纯西文用 Segoe Script（`Anna Script`），跟正文区分开：单曲分数、定数、单曲 Rating（定数和 Rating 差不多大）、页脚格言。
  成绩卡片（/b50 一族、/分数列表、/牌子进度）上的分数要是整张卡最显眼的字（作者 2026-10-20）：换成再描粗一层的 `Anna Script Heavy`
  （还是 Segoe Script Bold，`fonts.css` 里声明成 400、写 700 让浏览器描粗）、43～46px、墨色。只换颜色（深酒红）、色带反白都试过，没选
- 玩家总 Rating 的颜色按游戏 VERSE 以后的色档：0 绿、4 橙、7 赤、10 紫、12 铜、13.25 银、14.5 金、15.25 铂、16 虹、17 虹极。
  阈值只在 `themes/shared/theme-kit.js` 的 `ratingTier`，颜色只在 `themes/shared/rating-tiers.css`，所有主题共用
  （作者 2026-10-21 要统一；`test/theme-kit.test.cjs` 查主题里没有另配 `.tier-*`）：暗底一套亮色（照 /推分记录「当前均值」，
  作者说那样最清楚），浅底一套同色相的中间调。四块名牌版的「总 Rating」那一行照游戏里的名片板，垫一块磨砂圆角地板
  （`.rating-floor`：半透明白 + backdrop-filter 模糊，跟称号条一样宽；作者拿游戏截图要的，先试过的深蓝珐琅小牌没选），
  felix 的白格子用 `.rating-light`。backdrop-filter 在没显卡的服务器上也能用（本机加 `--disable-gpu` 出过图，放大看跟有显卡的没有差别）。
  踩过的坑：background-clip: text 的渐变字，text-shadow 会画在渐变上面 —— 名牌版那一行给标签做浮雕的米色 text-shadow 被数值继承，
  17.01 罩上一层 35% 的米色发淡（加白描边更淡），/牌子进度 那份横向深色虹极罩完成了土黄色。渐变档一律 `text-shadow: none`。
  游戏里 15.25 以后的星不画，字体也不跟着换（作者 2026-10-18：只改颜色，不动字体）
- 字要够大：作者两次嫌字小（名牌版、Rating 那几格的大小是他认可的参照），`/单曲` 又放大过一轮（小标签 22px 起，
  见 `themes/song/README.md`）；标签、说明能省就省（第一版的大标题和说明文字被删了）。图上不写玩家名（`/单曲` 页脚的被删了）
- 名牌版上的称号栏 2026-10-19 也按作者要求放大：best 23px、list 20px、plate 30px（原来 19 / 16 / 26px），
  写不下时照旧整行等比缩小（`fitText` / `fitPlate`），不会溢出彩色条。
- 2026-10-20 作者要求把名牌版上的「★转生 Lv.等级 + 名字」从靠左改成**称号条正下方、水平居中**；felix、list、plate、trend
  四个有姓名板的主题都改了。整行（等级 + 名字）一起等比缩小、缩放原点在中间（`.who`），长名字缩完仍然居中，不会偏左。
- 同一轮又按 p2 / p3 统一了这四块名片板：名字下面补一行「总 Rating」（标签和数值字号差不多，约 26～38px），
  头像和段位按 `/牌子进度` 的比例放大到约名牌版高度的八成（felix 160、list 150、plate 248、trend 168）。
  作者随后要求头像顶边和名牌版顶边平齐：list、plate、trend 三块（头像在牌子左边）的 `.identity` 都改成
  `align-items: flex-start`，list 上提 18px、trend 上提 23px，plate 本来就跟牌子同高、视觉不变；felix 的头像在牌子下面，不适用。
  felix 原来那块跟总 Rating 重复的「Rating」统计格撤掉（b50 / b30 / aj30 只剩两格），aj50 的 AJ 50、fit30 的拟合 B30
  是各自的算法均值、不是账号总 Rating，保留。名牌版「总 Rating」那一行垫磨砂圆角地板（见上面的 Rating 色档）。
- 通关徽标：FC / AJ / AJC 这类小牌子 2026-10-19 统一放大到 22～23px，FC/AJ/AJC 再加一道暖色细边；CATASTROPHY / ABSOLUTE /
  FULL CHAIN 太长，在 `themes/shared/theme-kit.js` 的 `MARKS` 里统一缩写成 CATA / ABS / CHAIN（`CHAIN+` 是 fullchain2，kind `chain plus`）。
  2026-10-20 分数放大以后，成绩卡片上的牌子缩回 18～19px、挪到卡片最底下一行跟评级封印挨着，定数 › Rating 挪到分数下面
  （/单曲、/谱面分析 还是 23px）；卡片一行放不下时先缩到 15～16px，再去掉最后的标记。/分数列表、/牌子进度 的定数也不再垫难度色小牌子，
  跟 /b50 一样是难度色的字。配色 2026-10-20 换过（五个主题一样）：FC 金（原来 AJ 的）、AJ 淡彩（原来 AJC 的）、AJC 鲜彩虹白字、CHAIN+ 青碧。
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
  （FC 含 AJ、AJ 含 AJC，SSS 含 SSS+）。这张图按 1.8 倍出（2 倍约 5.4 MB，超过 5 MB 上限）。设计说明在 `themes/list/README.md`。
  还能按分类筛：`/分数列表 精灵记`、`/分数列表 音击 紫 2`、`/分数列表 BMS`。分类只保留顶层（精霊編/地上編这种章名
  落到父分类，不单独统计），词表和别称在 `src/song-tags.cjs`；数据来自 `song-extras.json` 的 `labels`、`song-origins.json`、
  `song-bms.json`；分类默认只列紫谱/黑谱，一次一个分类，后面只能再加紫/黑和页码（数字就是页码）
  2026-10-21 加入谱师筛选：直接 `/分数列表 Techno Kitchen`、`/分数列表 Techno Kitchen 2`，命令不加「谱师」前缀。
  只接受原始署名/别名和数字页码，不叠加紫、评级、等级等条件；只列 MASTER／ULTIMA。按每张谱面的 `note_designer` 匹配，
  马甲只按 `src/data/chart-designer-identities.json` 的有来源关系归并；合作谱不自动拆分。翻页保留用户输入的别名。
  完整署名清单在 `docs/chart-designers.md`，优先给归并后的谱师填写中文别名；完整马甲见 `docs/chart-designer-credits.md`。
  `tools/fetch-designer-wiki.cjs` 只取五张汇总页，缓存优先、串行至少隔 45 秒，403/429 立即停；默认冷却一小时，
  作者明确要求继续时 `--resume` 可在至少五分钟冷却后新开一轮。2026-10-21 命令行被 Cloudflare 403 拒绝，网页阅读工具可读取源码快照，
  五页均已缓存为 `data/wiki-pages/designers/{1..5}.wiki.txt`。离线运行 `node tools/build-chart-designers.cjs` 生成候选表和 audit.json，
  人工核查后再替换归属 JSON。目前 42 组覆盖 589 种原始署名；全局排除合作/未确认栏目，Violetta/Ragnarok 的推测身份不合并。
  作者进一步确认：Violetta、Ragnarok、START "A I R "、Fahrenheit 212、透明絵具按各自独立名义保留，不按推测归入其他谱师；Toaster 不添加。
  START "A I R " 暂不在当前落雪曲库，不能凭 wiki 的曲目表造本地谱面。

## /同步记录（伊迪亚主题）

- 只有无参数 `/同步记录`，展示最近一次更新；日期选项、`最新` 参数、翻页已移除。
- 最近一批按相邻 `upload_time` 相差 ≤15 秒归批，基线是这一批之前。落雪没有给机器人原生同步结果：
  `/user/crawl/status` 是网站登录令牌的接口，OAuth 读不到。`src/history.cjs` 用单谱 `/score/history` 补旧值；
  每人一份基线 + 事件，存在 `data/history/<openid 的 sha256 前 24 位>.json`，从基线重放 B50。
- 账号 Rating = 旧曲前 30 + 新曲前 20 的 Rating 和 ÷50；一次同步的影响 = 前后前 50 总和差 ÷50，
  不是单曲 Rating 差 ÷50。单曲 Rating 用当前定数现算（`score-math.rating`）。
- 只认授权绑定（`binding: "oauth"`）。首次查询需补历史，之后只补新上传；没有主动轮询，靠下次查询补。
- `themes/history/` 固定横版 2700×1780：第 2 张 John Martin《万魔殿》背景，右侧伊迪亚完整立绘，
  左侧抬头和整批概览，下方 B50 构成变化 / 本次成绩更新两张平行表格，不做单曲小卡片。
- 画框是明尼阿波利斯美术馆 84.43 的琥珀玳瑁乌木波纹框（2026-10-21 作者换的，原来是 Met 1975.1.2292 黑木嵌彩石框），只取一段线脚四边斜接；
  表格底和标题带取立绘衣料裁片；不使用 AI 生成素材。
- `src/history-view.cjs` 只取最新批次，构成变化最多 7 项（先新进、再移出、最后席位内提升，各组按单曲 Rating 降序），明细最多 8 张（按更新后的单曲 Rating 降序，
  B50 外成绩同样参与排序）。溢出明确注明省略数量，整批统计不受省略影响；固定画布不向下增长。
- 右侧立绘等比例放大、完整展示，不透明度 0.60；不展示 Rating 折线图。构成表曲名保持普通文字色，仅状态与数值使用绿 / 红。
- 当前 Rating 与本次前后均值沿用共享色阶（`shared/rating-tiers.css`：17 起的虹极是上暖下冷的饱和竖渐变，16 段虹保持浅色横向）；整批提升用冰蓝白渐变；两张表里的小 Rating 不套色阶；长曲名都单行省略。
- 当前 Rating 两位截断，本次重算前后标为「B50 均值」三位小数；时间按北京时间。JPEG 76、1.5 倍输出。
  无记录仍回文字。跨版本时新曲按当前 `bests.new_bests` 重放，历史分组可能跟当时不同。

## /推分记录（梅薇主题）

- 独立功能 `src/features/trend.cjs` + `src/trend.cjs` + `themes/trend/`；支持 `/推分记录 本周`、`/推分记录 本月`、`/推分记录 半年`、`/推分记录 今年`。已有 `/同步记录` 的代码、排版保持不变。
- 读取共享历史库并消费 `history.replay`，三条线分别是 B50 / 旧曲 B30 / 新曲 N20 均值。北京时间自然周、自然月、最近六个日历月（同日零点，月末超出取该月末日）、今年（一月一日零点起），区间无更新也画持平线；保留每次上传批次，不分页或删点。
- 作者确认：背景候选 07 库尔贝《阵风》，画框 N1（Met 1975.1.2102），完整梅薇立绘。固定横版 2700×1620，大 B50 左置，B30 / N20 右侧上下排列，最右侧是角色。
- 第二版：普通折线；移除角色落款、顶部副标题与玩家名，放大日期和更新统计；当前均值、原均值按 Rating 色阶上色，涨幅用翡翠绿。统计比较区间首尾 B50 的更新谱面数，同谱去重，新进计一，移出不另计，不显示上传批次数。
- 2026-10-20 作者要加游戏里的名片板和头像（p1 名牌版 + 称号、★1 Lv.51；p2 角色头像 + 段位勋章）：放右上角、梅薇头顶上方的天空里（她的立绘从 y≈387 才开始），名片板占 `right:76px; top:72px`，头像 168 + 名牌版 540×214，不压图表、不动版面。称号、`★转生 Lv.等级 + 名字`、下面一行「总 Rating」、头像和段位照 `/分数列表` 的做法。玩家资料由 `ctx.player.player()` 经 `playerView` 下发，名牌版和角色图在出图队列里由 `attachAssets` 换成本地地址；缺图有象牙纸牌子 / 一颗星的退路。细节见 `themes/trend/README.md`。
- 17.00 起的虹极是上暖下冷的饱和竖渐变（共享的 `shared/rating-tiers.css` 就是照这里定的）；16 段虹保持浅色横向。Rating 显示四位截断、不四舍五入，避免显示成 17.0000 却按 16 段上色。颜色回归示例：`themes/trend/examples/rating-tiers.json`（B30 17.23 / N20 16.99）。
- 画框必须细且不扭曲纹样：四角与边条同倍率等比缩小，边条重复拼接、末段裁余；不能把整张框直接拉成横版。实现及比例见 `themes/trend/renderer/frame.js`。
- JPEG 76、1.5 倍输出。角色衣料靛蓝、袖口米白、旧金和翡翠绿用于图表配色；不改其他角色主题。

## /年度总结（艾薇妮娅斯主题）

- `src/features/year-review.cjs` + `src/year-review.cjs` + `themes/year/`。数据是落雪的年度总结 `user/chunithm/player/year-in-review/{年}`
  （落雪文档没列，前端年度总结页在用）：只有玩家接口有，开发者接口没有这条路由，所以只能看自己（`binding: "oauth"`）。
  不截落雪网页的图（一长页、要登录网站），按 JSON 自己画。
- 不写年份看北京时间的去年；`/年度总结 2024` 写年份；2024 以前没有。落雪规定 Y 年的数据只能在 Y+1 年里生成：
  先不带 agree 读，没生成过（400 `agree is required`）且正好是去年就替玩家带 `agree=true` 生成（网页上的「生成数据」，慢，先回一句；
  请求单独给 3 分钟、不重试），更早的年份没生成过就是过了期限（落雪对更早的年份也回 agree is required，不是 invalid year，期限按年份自己判断）。
- 落雪的数都是**上传记录**的条数（同一首歌上传几次算几次，各种分布加起来等于上传总数），图上写「上传」不写「游玩」。
  评级、全连按包含关系数；Rating 成长在 2025 年的快照里没有新曲 N20，照落雪网页按旧算法 (B30 + 最高一首 × 10) ÷ 40 并注明。
- 作者选的：背景 13 号赖特《那不勒斯海边的岩洞（日落）》、画框 A4 荷兰国立 BK-15994 红玳瑁乌木波纹镜框、原初的巫女艾薇妮娅斯立绘。
  固定横版 2700×1780，JPEG 76、1.5 倍。名片板放左栏抬头右边（TA 举着剑，右上角被占了）。版式、配色、踩的坑见 `themes/year/README.md`。
- 公开分享的年度总结 `chunithm/year-in-review/{年}/share/{token}` 不用鉴权（`lxns.yearInReviewShare`），指令还没接。
- 别去落雪「第三方应用」里撤销测试授权：那里按应用撤销，会连服务器上 Anna 的授权一起撤掉。

## /热门谱面（萨拉基亚主题）

- `src/features/popular.cjs` + `themes/popular/`。数据是落雪的 `chunithm/song/popular?range=week|month`（文档没列，落雪首页「热门曲目」就是它）：
  全站近 7 天、近 30 天上传最多的前 10 张谱面，按谱面排（EXP、ULT、WE 也会上榜）。**公共接口却包了一层 `{ success, data }`**；
  时段是北京时间的整天（`period_end` 是北京时间零点、不含），`updated_at` 每小时 05 分变；`previous_rank` 为 null 是新上榜。
- `binding: "none"`：没绑定也能看榜；绑定了把自己在这些谱面上的成绩画上去（授权读一次 `/scores`，好友码按曲目读 `/bests?song_id=`，3 个一批）；
  `@某人` 看对方的成绩。两张榜先在队列外取好，都空就直接回文字。
- 作者选的：背景 03 号透纳《狄多建设迦太基》（原始亮度，压暗的两档试过没选）、画框荷兰国立 BK-1971-122 乌木银丝花镜框
  （拱顶的镜子，取立柱、扭绳纹横档、脚上方墩三块在页面里拼成横框）、原初的巫女萨拉基亚立绘（剧情后半在「Water Elemental」）。
  横版 2800×1780，JPEG 76、1.5 倍。版式、配色见 `themes/popular/README.md`。

## /出勤记录（テルスウラス主题）

- `src/features/attendance.cjs` + `src/attendance.cjs` + `themes/attendance/`（别名 `/出勤`）。最近一次出勤打了哪些谱面、几点到几点，
  下面一条近一年的同步日历。跟 `/同步记录` 不一样：没涨分的、被技能强制结束的游玩都算。`/同步记录` 不动（作者 2026-10-22 定的：另开一个，不替换）。
- 数据：Recent 50（开发者接口 `/recents`，授权绑定也走它，用存着的好友码）切场 —— 相邻两次隔 2 小时以上算两场，取最近一场；
  同一张谱面合成一行（这场最高分、几次里最好的通关标记）：12 张以内排一栏，多写定数和每一次的分数（✕ 是被强制结束的），
  行高按张数把位置填满、字跟着放大；13 张以上分两栏只写 ×次数，最多 24 张；Recent 50 全是这一场时注明前面可能还有。
  **列表和日历中间不留空**（作者嫌第一版空一大段）：6 张以下填不满就让整张图变矮，7 张以上都是 1780 左右。
  日历是 heatmap（`user/chunithm/player/heatmap`，只走授权：开发者接口要对方开着历史成绩），按同步那天记，照实画、不拿 Recent 50 改。
  新纪录对 `/scores`：最好成绩分数等于这场最高、`upload_time` 跟那次游玩同一次同步（≤15 秒）。所以 `binding: "oauth"`、只看自己。
- 作者选了原初的巫女テルスウラス（《紀律》～ As One，曲目 2091；涅菲谢的侍女，立绘手里拿着怀表）；立绘 475×1080 很窄，右栏只要 650 宽，
  左边内容区放宽到 1740。横版 2700 宽、最高 1780，JPEG 76、1.5 倍。**背景油画和画框还没选**（候选在 `data/bg-candidates/telseuras/`），
  现在是候选 11 占位和 CSS 画的木框。细节见 `themes/attendance/README.md`。
- 本机 try 绑定库的授权 2026-10-22 已失效：`npm run try -- "#出勤记录"` 只会回「授权失效」，要作者重新授权一次 try 绑定才能整条走通；
  草图用 `node themes/attendance/design/render-real.cjs`（个人密钥）。

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
- Recent 50 和 heatmap（2026-10-22 拿作者的真数据对过）：`/recents` 每条有 `play_time`（UTC、精确到分钟）和 `upload_time`（哪次同步传的），
  按游玩时间倒序；heatmap `{ "YYYY-MM-DD": 条数 }` 一天的数就是那天同步上去的游玩条数，**按同步那天记、不是打歌那天**
  （10/16 打的 3 + 17 首第二天才同步，记在 10/17：20 条）。落雪网页「账号详情」那张近一年的热力图就是它；Recent 50 网页上没有展示。
  `/scores` 里最好成绩的 `play_time` 是**最后一次打这张谱的时间**，不是打出这个分数的时间；`upload_time` 只在成绩变好时才变。
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
