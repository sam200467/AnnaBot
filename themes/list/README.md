# list：成绩列表（/等级）

`/等级` 用的主题（功能代码在 `src/features/level.cjs`）：一个等级（或定数）的全部谱面，一页 80 张卡片，
没打过的灰着排在最后。角色是西比拉精灵记的圣女安娜（聖女 アンナ・マルグレーテ）——这是安娜专属的框子，
跟 /b50 的通用金框不一样：

- **画框是一本中世纪福音书的封皮**：荷兰国立博物馆 BK-C-2003-1（利摩日一带，约 1200–1250 年，铜胎鎏金、凹刻珐琅）。
  外圈四条长铜板，钴蓝底上心形卷草和天使一格一格交替，格子之间一道细金条、外沿錾齿纹边；里圈一道压出来的玫瑰花环金边。
  作者在 F1 / F2 两种候选里选的 F2（2026-10-17，对比图在 `previews/画框对比.jpg`，候选原图在 `design/`）。
- **框里上半截是布莱兴的《哥特教堂废墟》**（`assets/painting.jpg`）：原图比例不够竖，只取右边一截（有尖拱窗和壁龛的那半），
  宽度拉满画布、不拉伸，往下渐隐进暗处；左上角写字的地方再压暗一层（`.veil`）。作者挑的画。
- **安娜站在右边**（`assets/anna-fullbody.png`，作者在三种构图里挑的「侧立」）：不占透明、不镜像，脚下渐隐。
  她占的那块是一个空格子（`.stand`，第 4～5 列，行数按立绘高度算），前几行卡片排在她左边，过了她再铺满五列。
- **卡片骨架跟 /b50 一样**（曲绘左、字右，封印压在曲绘角上），材质照安娜的衣服：象牙白的纸、金线，钴蓝点缀（她的披风）——
  序号牌是钴蓝。没打过的谱面整张灰下去（曲绘去色、纸发灰），只留曲名和定数；难度色褪一半留着，还看得出是 MASTER 还是 ULTIMA。
- **抬头**：大标题（等级、定数或版本名）、筛选条件和页码、一排七个统计格。统计格分三类用颜色分开（作者要的，跟 MiaBot 一样）——
  谱面数钴蓝、通关（AJC / AJ / FC）琥珀、评级（SSS+ / SSS）茜红；每格顶上一道色条跟卡片上的东西对得上
  （AJC 珠光、AJ 金、FC 铜是通关标记的颜色，SSS+ 珠光金、SSS 金是封印的颜色）。统计数字是包含关系（FC 里含 AJ、AJ 里含 AJC，
  SSS 里含 SSS+），统计的是筛完的全部谱面，不只这一页。
- **字**：正文只用霞鹜文楷（`Anna Hand`）；分数、定数、单曲 Rating 用 Segoe Script（`Anna Script`），跟其他主题一样。
  大标题的「Lv.」前缀是 Segoe Script 64px，大字是 `Anna Hand Bold` 150px（文楷描粗）。
  2026-10-17 做过一轮更艺术的标题字体对比（Cinzel、IM Fell Great Primer、Playfair Display Black、Cormorant 粗斜体、
  Great Vibes 花体，见 `previews/标题字体对比-本机.jpg`），作者最后决定沿用现状不换。大标题一行写不下时往小缩，最小 80px。

封印的边这类「随机」的东西用固定种子的伪随机数现画，同一份数据每次出图都一样。伪随机数、封蜡边、从一张图上切一块
这几段照搬 `../../song/renderer/theme.js`。

## 画框是怎么拼的

`assets/enamel.webp` 是从封皮照片上切下来的格子排在一张图上（1342×1091，按 2 倍分辨率缩好）。素材的做法见
`assets/README.md`；坐标在 `theme.js` 的 `ENAMEL.pieces`，由 `design/make-enamel.html` 打出来，重做素材要跟着换。

`drawFrame` 拼框：外圈四条珐琅带，上下两条横贯全宽、左右两条夹在中间。每条边两头是连着端头齿纹边的格子，
中间两种格子交替、同一块格子轮流正着镜像着用（看着不那么重复）；挑格子数让总长最接近这条边，再整体拉伸几个百分点铺满，
每格起止对齐到半像素（2 倍图上的整像素），相邻两格才不会漏缝。里圈金边是一段竖着的玫瑰花环一正一倒接着铺，
四条边在四个角上按 45° 斜接（`clip-path`）。

## 出图尺寸和大小

宽 2060 CSS 像素（五列卡片加画框），高跟着卡片数走，凑成 5 的整数倍（乘 1.8 才是整像素，底边不会多出半行）。
渲染视口只要不比它窄（`level.cjs` 用 2100×1500）。

这张图按 **1.8 倍**出（`level.cjs` 的 `RENDER_SCALE`，其他主题是 2 倍）：2 倍时 80 张卡片约 5.5 MB，超过作者定的
5 MB 上限；曲绘、珐琅框都是细纹理，JPEG 压不下去，降倍率比降质量划算，1.8 倍约 4.7 MB。JPEG 质量 76 同其他图。

## 素材

`assets/` 里的图不进仓库，清单和做法见 `assets/README.md`。缺了也能出图，只是少一层画或装饰。字体见 `../shared/fonts/README.md`。

## 数据

`src/features/level.cjs` 的 `buildData` 给出，形状看 `examples/`：`preview-data.json`（/等级 14+ 第 1 页，满页）、
`page-2.json`（第 2 页，后面是没打过的）、`version.json`（/等级 PARADISE LOST 紫 SSS以下：大标题是版本名，
下面一行写着别的条件）。示例数据由 `design/make-example.cjs` 生成：谱面是曲库里真的（读本机缓存 `data/cache/songs.json`），
成绩是固定种子的伪随机数，跟真出图走同一套 `parseQuery` / `resolveCharts` / `buildData`。

## 预览

```
npm run theme -- list                                                    实时预览
npm run preview -- list --out themes/list/previews/page1.jpg             正式出图流程渲染第 1 页示例
npm run preview -- list themes/list/examples/page-2.json --out themes/list/previews/page2.jpg
npm run preview -- list themes/list/examples/version.json --out themes/list/previews/version.jpg
```
