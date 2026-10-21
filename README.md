# Anna Bot

中二节奏查分 QQ 机器人。基于 QQ 开放平台的官方机器人，数据来自[落雪查分器](https://maimai.lxns.net)。

作者：**sam2004**。

## 现在能做什么

| 指令 | 说明 |
| --- | --- |
| `/绑定 好友码` | 用好友码绑定落雪账号（走落雪开发者接口） |
| `/授权` | 用落雪账号授权（OAuth），能读全部成绩的具体分数 |
| `/解绑` | 解除绑定（要再发一次确认） |
| `/信息` | 绑定的账号和 Rating；`@某人 /信息` 看别人的 |
| `/b50` | 成绩图：旧曲 Best 30 + 新曲 Best 20，也就是现在 Rating 的构成 |
| `/b30` | 成绩图：不分新旧，单曲 Rating 最高的 30 首 |
| `/搜索歌曲 线索` | 模糊找歌：曲名、别名或 ID 都行，列出各难度定数和 ID（不用绑定，结果可翻页） |
| `/分数列表 名字或别名` | 按谱师原始署名或已配置的别名列紫谱、黑谱成绩；翻页在名字后空格加数字，例如 `/分数列表 Techno Kitchen 2`；只接受名字和页码，要授权 |
| `/拟合定数b30` | 成绩图：把定数换成拟合定数，重算单曲 Rating 后取最高的 30 首（不分新旧，要授权） |
| `/aj30` | 辅助分表：只挑 AJ（含 AJC）的谱面，不分新旧排成 B30（要授权，不进指令面板） |
| `/aj50` | 辅助分表：分新旧，只挑 AJ（含 AJC）的谱面，旧曲 30 + 新曲 20（要授权，不进指令面板） |
| `/帮助` `/状态` | 指令清单、运行状态 |

`/b50`、`/b30` 都可以 `@某人` 看别人的。单曲成绩、等级成绩、定数表等功能在逐个开发中。指令前缀 `/`、`#`、`＃` 都可以；群里要 @ 机器人再发指令，私聊不用前缀也行。

在 QQ 输入框里打 `/` 会弹出常用指令的清单（指令面板，`/信息`、`/状态`、辅助表 `/aj30`、`/aj50` 不在里面），点一下就填好指令。清单由 Anna 启动时按功能表同步：
群聊的只出现在白名单里的群，私聊的对所有人。

### 两种绑定的区别

| | 好友码绑定 | 授权绑定 |
| --- | --- | --- |
| B50、B30、单曲成绩、最近游玩 | ✔️ | ✔️（`/b30` 按全部成绩挑，一定准） |
| 全部成绩的具体分数（等级成绩、分表） | ❌ | ✔️ |
| 受玩家在落雪的「允许第三方读取」开关管 | 是 | 查自己时不受；被别人 @ 查时受 |

好友码绑定的 `/b30` 只能从「旧曲前 30 + 新曲前 20」里挑：新曲挤进前 30 的超过 20 首时可能漏几首，图注里会说明。

授权绑定用的是 PKCE：授权链接只对发出 `/授权` 的那个人有效，授权码被别人看到也绑不上。落雪的授权令牌 30 天不用会过期，
机器人会替很久没查分的人提前续期。

## 准备

- Node.js 22 或更新
- 本机装有 Chrome 或 Edge（出图用）
- QQ 开放平台机器人的 AppID / AppSecret（q.qq.com）
- 落雪查分器开发者 API 密钥；要用授权绑定的话再创建一个 OAuth 应用（勾选「无回调地址」，权限只要「读取玩家数据」）

## 配置和启动

```powershell
npm install
Copy-Item .env.example .env                       # 填密钥
Copy-Item config.example.json config.local.json   # 填群白名单等设置
npm run check:lxns                                # 确认落雪接口通了
npm run probe                                     # 在群里 @ 机器人一次，拿 group_openid
npm start
```

- `.env` 里是密钥（QQ AppSecret、落雪开发者密钥、OAuth 应用密钥），每一项的来源写在 `.env.example` 里。
- `config.local.json` 里是设置，每一项的说明写在 `config.example.json` 里。`allowedGroupIds` 填的是 `group_openid`
  （不是群号），留空时拒绝启动。

### QQ 那边要做的

2026-10-15 联调实测；标「FAQ」的是 QQ 机器人官方常见问题里的说法。

- 新版开放平台不用沙箱：机器人还没公开时直接连正式环境（`"sandbox": false`），这时只有管理员自己能用
  （FAQ：别人要私聊它，得在开放平台「开发设置」里加成开发体验用户）。
- 机器人加进**自己当群主**的群（FAQ：开发者没认证时只能这样）：手机 QQ 打开机器人资料卡 →「添加到群聊」。
- 加进群以后，**群主要在群里点机器人头像，设置它能收哪些群消息**（只收 @ 它的就够）。没设的话私聊正常，群里 @ 它没反应。
- 沙箱和正式两个环境不能同时连：后连的会被踢掉，所以探针要跟 Anna 连同一个环境。同一个环境开两个连接倒是可以，
  但别同时开两个 Anna，每句话会回两遍。

## 日常运行

`npm start` 得一直开着一个终端窗口。平时挂着用无窗口启动器：

```powershell
npm run launchers    # 在项目目录生成「启动Anna.vbs」「停止Anna.vbs」
```

- 双击「启动Anna.vbs」：Anna 在后台跑，没有窗口。连上 QQ 后弹窗说一声（5 秒后自己关），没起来就弹出报错。
  已经有 Anna 在跑（包括终端里 `npm start` 开的）时不会再开第二个 —— 同时开两个，每句话会回两遍。
- 双击「停止Anna.vbs」或者 `npm stop`：结束命令行里带 `src/main.cjs` 的 node 进程，别的 node 程序不受影响。
- 日志照常在 `data/logs/anna-日期.log`；后台启动时起不来、崩溃的报错另外记在 `data/logs/stderr.log`。
- 两个 `.vbs` 是生成的，不进仓库。里面只有相对路径，挪了项目目录也照样能用。

## 部署到服务器

照 MiaBot 的做法打一个安装包，装到一台一直开着的 Windows 服务器上。服务器的要求跟 MiaBot 一样：Windows（Server 要选带桌面体验的）、
Node.js 22+、Chrome 或 Edge；跟 MiaBot 放同一台也行。

```powershell
npm stop                  # 先停掉本机的 Anna（打完整包以后也别再开）
npm run package           # 完整包：dist/AnnaBot-install-日期-提交.zip，第一次部署用
npm run package:folder    # 完整包，只留解开的文件夹，不打 zip
npm run package:update    # 更新包：只有程序，服务器上已经装过时用
```

把 zip 解压到服务器（只出文件夹时整个文件夹直接拷过去），双击「安装Anna.cmd」：默认装到 `C:\AnnaBot`，设好开机自启（计划任务 `AnnaBot`），启动并等它连上 QQ。
更新也是双击这个文件：先停掉 Anna、换程序、再启动，`.env`、`config.local.json`、`data/` 都不动。详细步骤和排查见包里的「部署说明.txt」。

每次打包前，在 `src/data/update-notes.json` 的数组里写本次更新说明（每条一段，总计不超过 1500 字）。安装更新后，Anna 连上 QQ 就会向各白名单群主动发送一条「Anna 更新日志」。群内需开启「机器人主动在群聊内发言」，且机器人须具备平台权限。主动发送失败时，等该群下一条可回复消息触发补发（开启接收全部消息的群有人说话即可，否则需 @Anna）。每群每次更新成功后不重复发送，首次安装不发。记录保存在服务器的 `data/update-notices.json`，不要随意删除。

包里带什么由打包脚本挑，不用手动拷：

| 带 | 不带 |
| --- | --- |
| `src/` `tools/` `themes/`，连同 git 外的背景图、字体、图标（字体只带主题用到的） | `test/`、`.git/` |
| `node_modules/ws`（服务器上不用 `npm install`） | `data/vault.key`：DPAPI 封的，换一台机器解不开 |
| `.env`（主密钥写进 `ANNA_VAULT_KEY`，去掉 `LXNS_USER_TOKEN`）、`config.local.json` | `data/logs/`、`data/try/` |
| `data/bindings.enc`、`data/cache/`（曲库和曲绘，省得服务器上现下） | `*.vbs`（服务器上重新生成） |

完整包里有密钥和所有人的绑定：`dist/` 不进仓库，包别放网盘、别发群里。

### 绑定库的主密钥

运行数据都在 `data/`：绑定库 `bindings.enc`（加密）、主密钥 `vault.key`、曲库和素材缓存 `cache/`、日志 `logs/`。

主密钥在 Windows 上由 DPAPI 保护，**只有当初启动机器人的那个 Windows 用户在那台机器上解得开**——光拷走 `data/` 是读不出绑定的。
打完整包时会把它解开，写进包里 `.env` 的 `ANNA_VAULT_KEY`。服务器上用的就是这个值，不再用 DPAPI：开机自启的计划任务里用不了 DPAPI，
云服务器在控制台重置密码也会让 DPAPI 封过的东西再也解不开。

不用安装包、手动迁移的话：在旧机器上运行 `npm run vault-key -- --export`，把导出的值填进新机器的 `.env`，再把 `data/` 拷过去。
非 Windows 系统一律用 `ANNA_VAULT_KEY`。

## 开发

```powershell
npm test                          # 全部测试：假 QQ + 假落雪，不联网，不需要真实凭据
npm run try -- "#信息" "#示例图"    # 不连 QQ，用真落雪数据跑指令，图片存到 data/try/
npm run theme -- _example         # 主题实时预览
npm run preview -- _example       # 用正式出图流程渲染主题
npm run panel                     # 指令面板：本地清单和平台上现有的面板；-- --sync 不重启马上同步
```

加新功能的步骤、目录结构和落雪接口的实测要点见 [`CLAUDE.md`](CLAUDE.md)，出图主题的写法见 [`themes/README.md`](themes/README.md)。

## 素材和版权

仓库不包含背景图、图标、字体等美术素材，`themes/**/assets/`、`themes/shared/fonts/`、`themes/shared/icons/` 由部署者自己准备，
只能放自己有权使用的文件。曲绘等游戏图片来自落雪查分器，只在本机缓存，不进仓库。

落雪查分器的服务条款禁止将其数据用于商业用途。

## 许可

Copyright © sam200467（sam2004）. All rights reserved.
