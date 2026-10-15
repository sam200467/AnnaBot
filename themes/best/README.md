# best：B30 / B50 成绩图

`/b50`、`/b30` 用的主题（功能代码在 `src/features/best.cjs`）。风格照中二节奏的「西比拉精灵记」（シビュラ精霊記）：

- **整张图是一幅镶在金框里的画**：最外面是洛可可金色画框（`assets/frame.png`），框里一圈羊皮纸，画面是撕开、烧焦的边，
  跟这个系列的曲绘一样。画里上半截是五位巫女（`assets/sibyls.webp`），往下沉进黑暗；最底下是着火的战场（`assets/battlefield.webp`）。
- **画框是拼出来的**：原图框的比例跟成绩图差太远，四个角、每条边中间的雕花原样缩小贴上去，平直的线脚取原图里一段，
  一正一反交替铺满（上下两条边用左右的线脚转 90°）。框比原图窄很多（作者嫌原图的边太宽）。坐标在 `theme.js` 的 `FRAME`。
- **页眉左边是柱状图**：一根柱子一首歌的单曲 Rating，旧曲金色、新曲火色，虚线是这一栏的均值。
  纵轴不从 0 开始，而且每一栏用自己的纵轴、按这一栏的分数段收紧（B50 的旧曲刻度在左、新曲在右）：
  一栏几十首常常只差零点几分，旧曲新曲之间又能差一两分，共用一根轴时柱子全一样高。背后是一个法阵（四精灵的符号、八芒星，
  外圈的卢恩字母转写的是 SIBYLLA · SPES ANIMAM TENET · ANNA MARGARETE），从图表板子的上边和右边露出来。
- **页眉右边**：玩家的名牌版（落雪的图，「★转生 Lv.等级 名字」和称号照游戏里的位置叠上去）、角色头像、
  挂在头像下面的段位勋章（`../shared/icons/class_emblem/`）、Rating 和两栏的均值。
- **每首歌是一张旧纸片**：左边曲绘，右边一栏依次是曲名（只写一行，字大，放不下就用省略号）、分数、通关标记、「定数 › 单曲 Rating」。曲绘框和底下的条用难度的颜料色（铜绿、赭黄、朱红、紫、黑红），评级是一枚封蜡，单曲 Rating 用干掉的血色。
  通关标记是实心的小牌子：FC / AJ / AJC 是铜、金、珠光的金属牌，HARD / BRAVE / ABSOLUTE / CATASTROPHY 是朱、紫、群青、黑底金字的缎带签。
- **章节名**写在缎带横幅上（借了 Lanota 支线第二章章节封面的缎带），两边是均值和地板（这一栏最后一首的 Rating）。
  B50 两栏的交界横着铺一整排金色花饰：花和卷草交替，卷草一正一反，整排左右对称（`assets/ornament.png` 当遮罩，填主题的金色；
  朵数按宽度挑，见 `theme.js` 的 `drawFrieze`）。
- **页脚**只有格言（Segoe Script，写得大，填满底下的战场）和落款。*Spes animam tenet* 是拉丁文「希望系住灵魂」—— 西比拉世界的规矩：希望把灵魂留在身体里，绝望让灵魂离开。
- **字是手写的**：正文只用霞鹜文楷 Medium（`fonts.css` 的 `Anna Hand`）。它一个字体就有简体、繁体、日文汉字、假名和西文，
  曲名里几种文字混排时大小、笔迹都对得齐；只缺 ✪，由 Segoe UI Symbol 补。选它的经过见 `../shared/fonts/README.md`。
  单曲分数、定数、单曲 Rating 和格言用 Segoe Script（`Anna Script`），作者要这几处数字跟正文区分开。

撕边、封蜡、余烬、法阵都是 `theme.js` 用固定种子的伪随机数现画的，纹理是 SVG 噪声，同一份数据每次出图都一样。

## 素材

`assets/` 里的图不进仓库，清单见 `assets/README.md`。缺了也能出图，只是少一层背景或装饰。字体见 `../shared/fonts/README.md`，
段位图标见 `../shared/icons/README.md`。

## 数据

`src/features/best.cjs` 的 `buildData` 给出，形状看 `examples/preview-data.json`（B50）和 `examples/b30.json`（B30）。
示例数据的曲目是真的、分数是编的。柱状图直接用各栏的 `scores[].rating` 和 `average` 画，不另要数据。

## 预览

```
npm run theme -- best                                                  实时预览（B50 的示例数据）
npm run preview -- best --out themes/best/previews/b50.jpg               正式出图流程渲染 B50 示例
npm run preview -- best themes/best/examples/b30.json --out themes/best/previews/b30.jpg
```

出图是 2040 CSS 像素宽（内容 1824 + 羊皮纸 + 画框）、两倍输出，JPEG 质量 76。
B50 大约 4080×6410、4 MB，B30 大约 4080×4390、2.7 MB（作者要求单张在 5 MB 以内）。
预览的输出路径写 `.png` 就出 PNG，但这个主题纹理多，PNG 有十几 MB。
