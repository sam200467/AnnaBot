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
| `/帮助` `/状态` | 指令清单、运行状态 |

`/b50`、`/b30` 都可以 `@某人` 看别人的。单曲成绩、等级成绩、定数表等功能在逐个开发中。指令前缀 `/`、`#`、`＃` 都可以；群里要 @ 机器人再发指令，私聊不用前缀也行。

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
- 先用沙箱（`"sandbox": true`）验证，没问题再改成正式环境。换环境后 openid 会变，要重新 `npm run probe`。

## 数据和迁移

运行数据都在 `data/`：绑定库 `bindings.enc`（加密）、主密钥 `vault.key`、曲库和素材缓存 `cache/`、日志 `logs/`。

绑定库的主密钥在 Windows 上由 DPAPI 保护，**只有当初启动机器人的那个 Windows 用户在那台机器上解得开**——光拷走 `data/` 是读不出绑定的。
迁移到别的机器时：

1. 在旧机器上运行 `npm run vault-key -- --export`，得到 `ANNA_VAULT_KEY=...`（这个值能解开所有绑定，别外传）
2. 把整个 `data/` 拷到新机器，并在新机器的 `.env` 里填上 `ANNA_VAULT_KEY`

非 Windows 系统一律用 `ANNA_VAULT_KEY`。

## 开发

```powershell
npm test                          # 全部测试：假 QQ + 假落雪，不联网，不需要真实凭据
npm run try -- "#信息" "#示例图"    # 不连 QQ，用真落雪数据跑指令，图片存到 data/try/
npm run theme -- _example         # 主题实时预览
npm run preview -- _example       # 用正式出图流程渲染主题
```

加新功能的步骤、目录结构和落雪接口的实测要点见 [`CLAUDE.md`](CLAUDE.md)，出图主题的写法见 [`themes/README.md`](themes/README.md)。

## 素材和版权

仓库不包含背景图、图标、字体等美术素材，`themes/**/assets/`、`themes/shared/fonts/`、`themes/shared/icons/` 由部署者自己准备，
只能放自己有权使用的文件。曲绘等游戏图片来自落雪查分器，只在本机缓存，不进仓库。

落雪查分器的服务条款禁止将其数据用于商业用途。

## 许可

Copyright © sam200467（sam2004）. All rights reserved.
