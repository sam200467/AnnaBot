# 出图主题

每个出图功能一个主题目录，共用的东西放 `shared/`：

```text
themes/
├─ shared/
│  ├─ theme-kit.js      所有主题都要引入的小工具（拿数据、等加载完、告诉渲染器可以截图）
│  ├─ fonts.css         共用字体的别名（Anna Hand / Anna Script / Anna Caps / Anna Serif / Anna Mincho / Anna Song），主题引入它就能用
│  ├─ fonts/            上面那些字体的文件（自己准备，不进仓库）
│  └─ icons/            几个主题共用的图标：难度、评级、FC/AJ、CLEAR（自己准备，不进仓库）
├─ _example/            演示用的主题，新主题从它复制
├─ best/                /aj30、/aj50、/拟合定数b30 成绩图（竖版，原来的 /b50 /b30；西比拉精灵记风格，设计说明见它的 README）
├─ felix/               /b50、/b30 成绩图（横版，小时候的朱娜、《建筑师之梦》、彩绘陶框，跟 best 吃同一种数据）
├─ history/             /推分记录（伊迪亚、万魔殿，横版平行表格、完整立绘，只看最近一次更新）
└─ <主题名>/
   ├─ renderer/         theme.html / theme.css / theme.js —— 正式出图用的就是这三个
   ├─ assets/           这个主题自己的背景图、装饰（自己准备，不进仓库）
   ├─ design/           PSD 等设计源文件（不进仓库）
   ├─ examples/         preview-data.json：示例数据，预览用
   └─ previews/         预览图（不进仓库，里面有落雪的曲绘）
```

## 主题怎么跟渲染器配合

渲染器（`src/renderer.cjs`）起一个无头 Chrome/Edge，在页面脚本运行**之前**把数据放进 `window.__THEME_DATA__`，
然后打开 `renderer/theme.html`，等主题说「画好了」再截图。主题这边：

```html
<link rel="stylesheet" href="theme.css">
<script src="../../shared/theme-kit.js"></script>
...
<script src="theme.js"></script>
```

```js
const data = ThemeKit.data();                     // 功能代码传进来的数据
// ……把页面画出来……
ThemeKit.done({ element: document.getElementById("card") });   // 等字体和 <img> 加载完，按这个元素的大小截图
```

- 截图尺寸：`done({ element })` 按元素大小；`done({ size: { width, height } })` 直接指定（CSS 像素）；都不给就按整页。
  输出图片的像素 = CSS 像素 × 倍率（`config.local.json` 的 `renderScale`，默认 2）。
- 出错：脚本里抛异常或调 `ThemeKit.fail(error)`，渲染器会马上带着原因报错，不会干等超时。
- 图片要等加载完的用 `<img>`（或 `ThemeKit.preload(urls)`）；CSS 背景图等不到，只适合放本地的背景素材。
- `ThemeKit.format` 里有定数、分数、单曲 Rating 的格式化函数。
- `ThemeKit.MARKS` 是通关标记的文字和配色 class：`ThemeKit.MARKS.alljustice` 就是 `{ text: "AJ", kind: "aj" }`。
  `CATASTROPHY` / `ABSOLUTE` / `FULL CHAIN` 太长，统一缩写成 `CATA` / `ABS` / `CHAIN`（`FULL CHAIN 2` 是 `CHAIN+`，
  kind 里多个 `gold`），卡片一行才放得下大一点的徽标。
- `ThemeKit.ratingTier(rating)` 返回玩家总 Rating 在游戏里的颜色档（`green` / `orange` / `red` / `purple` / `bronze` /
  `silver` / `gold` / `platina` / `rainbow` / `rainbow-deep`），主题自己用 `tier-<名字>` 的 class 配色。
  分档照 VERSE 以后：0 绿、4 橙、7 赤、10 紫、12 铜、13.25 银、14.5 金、15.25 铂、16 虹、17 虹极；
  游戏里 15.25 以后按 0.25 加星、17 以后分 ★1～3，这里只给颜色。

## 素材

- **落雪的图**（曲绘、角色、名牌版、称号、地图头像）：功能代码用 `assets.fileUrls(...)` 换成本地 `file://` 地址放进数据，
  主题里直接当 `src` 用。不要在主题里写落雪的网址 —— 落雪的素材服务器很慢，一张图能卡住整张图。
- **主题自己的素材**：放 `assets/`，在 CSS / HTML 里用相对路径（`../assets/background.png`）。
- **共用的素材**：`../../shared/icons/...`，命名约定见那个目录的 README。字体不直接引文件，引入 `../../shared/fonts.css` 用里面的别名，
  清单见 `shared/fonts/README.md`。

## 开发流程

1. 复制 `_example/` 成新目录，改 `examples/preview-data.json` 成这个功能真正要用的数据形状
   （素材写成 `"lxns:jacket/407"`、`"lxns:character/20100"` 这种引用，预览工具会自动换成本地缓存的图）。
2. `npm run theme -- <主题名>`，浏览器打开它给的地址；改 CSS / JS / 示例数据后刷新就能看到。右下角会显示「画好了 / 出错了」。
3. `npm run preview -- <主题名>` 用正式出图流程渲染一张，看最终效果和尺寸。
4. 在功能代码里组装真数据，`npm run try -- "#指令"` 用真数据出图。

## 出图要快

服务器没有显卡，出图全靠 CPU，比本机慢三四倍（2026-10-16：服务器出 B30 要 32 秒，B50 截图超过 30 秒失败过）。
渲染器的日志会分段记时间（「起浏览器 x、排版 y、截图 z」），截图那段慢就是效果太费。最费的两种：

- 大面积的 `filter`（`drop-shadow`、`blur`）：要先把整块内容画到离屏图上再模糊，盖住整张图的那种最要命
- SVG 滤镜（`feTurbulence` 噪声）做的 CSS 背景：每画一块都重算一遍

`best` 主题的 `bakeTextures`（纹理先画成位图）、`shadowImage`（影子画进 canvas 再转成 `<img>`）可以照搬，做法和量出来的数在
`best/README.md` 的「出图要快」。在本机模拟服务器：把出图进程限制在 1 个核，浏览器加 `--disable-gpu`（`createRenderer` 的 `browserArgs`）。

2026-10-19：服务器的牌子进度遇到 `Runtime.evaluate` 30 秒超时，页面执行现在单独给 60 秒，
等待页面导航和主题就绪各给 90 秒，截图仍是 180 秒。失败日志会写明测量尺寸、等待布局稳定等具体阶段；
浏览器命令超时且首次尝试总用时不足 90 秒时，先清理旧浏览器，再重开一次；主题脚本错误不重试。

JPEG 超限时可以给 `render` 传 `maxBytes` 和 `fallbackQualities`（如 `[68, 60, 52]`）：
只在当前页面重新截图编码，不重复起浏览器、加载字体和排版。牌子进度已使用这个方式，分辨率和原有质量档位不变。
