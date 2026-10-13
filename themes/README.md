# 出图主题

每个出图功能一个主题目录，共用的东西放 `shared/`：

```text
themes/
├─ shared/
│  ├─ theme-kit.js      所有主题都要引入的小工具（拿数据、等加载完、告诉渲染器可以截图）
│  ├─ fonts/            几个主题共用的字体（自己准备，不进仓库）
│  └─ icons/            几个主题共用的图标：难度、评级、FC/AJ、CLEAR（自己准备，不进仓库）
├─ _example/            演示用的主题，新主题从它复制
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

## 素材

- **落雪的图**（曲绘、角色、名牌版、称号、地图头像）：功能代码用 `assets.fileUrls(...)` 换成本地 `file://` 地址放进数据，
  主题里直接当 `src` 用。不要在主题里写落雪的网址 —— 落雪的素材服务器很慢，一张图能卡住整张图。
- **主题自己的素材**：放 `assets/`，在 CSS / HTML 里用相对路径（`../assets/background.png`）。
- **共用的素材**：`../../shared/icons/...`、`../../shared/fonts/...`，命名约定见那两个目录的 README。

## 开发流程

1. 复制 `_example/` 成新目录，改 `examples/preview-data.json` 成这个功能真正要用的数据形状
   （素材写成 `"lxns:jacket/407"`、`"lxns:character/20100"` 这种引用，预览工具会自动换成本地缓存的图）。
2. `npm run theme -- <主题名>`，浏览器打开它给的地址；改 CSS / JS / 示例数据后刷新就能看到。右下角会显示「画好了 / 出错了」。
3. `npm run preview -- <主题名>` 用正式出图流程渲染一张，看最终效果和尺寸。
4. 在功能代码里组装真数据，`npm run try -- "#指令"` 用真数据出图。
