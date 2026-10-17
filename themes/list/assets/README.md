# list 主题的素材

这里的图由作者自己准备，**不进仓库**（只有这份说明进仓库）。缺了也能出图，只是少一层画或装饰。

| 文件 | 用在哪 | 说明 |
| --- | --- | --- |
| `painting.jpg` | 框里上半截的背景 | 卡尔·布莱兴（Carl Blechen）的哥特教堂废墟油画，**公有领域**。2608×3089，就是原图本身、没改过（同一份在 `../design/blechen-gothic-church-ruin-original.jpg`）。主题里只取右边一截（尖拱窗和壁龛那半，扫描件右边的白纸边裁掉），裁剪坐标在 `../renderer/theme.js` 的 `PAINTING` |
| `anna-fullbody.png` | 右边的立绘 | 圣女安娜（聖女 アンナ・マルグレーテ）的普通版全身立绘（688×1151，透明底），SEGA 的官方图（**不是公有领域**，跟 /单曲、/谱面分析 的立绘一样只在本机和服务器上用），取自 CHUNITHM Story Wiki（chunithmstory.miraheze.org）。没改过，位置、大小、脚下渐隐都在 `theme.js` / `theme.css` 里。作者在几个版本里挑的这一版，候选在 `../design/`（半身、`Vicissitudes of Fate` 版等） |
| `enamel.webp` | 画框 | 荷兰国立博物馆 BK-C-2003-1，一本福音书的背面封皮（利摩日一带，约 1200–1250 年，铜胎鎏金、凹刻珐琅），**公有领域**。从封皮照片上切下一格格珐琅片、按画框尺寸缩好排在一张图上（1342×1091，2 倍分辨率）。做法见下面。作者在 F1 / F2 两种封皮里选的 F2（2026-10-17，候选原图 `../design/f1-cover.jpg`、`f2-cover.jpg`） |

## enamel.webp 是怎么做的

用无头浏览器的 canvas 处理（页面和脚本在 `../design/`，不进仓库，都拿 `cdp-run.cjs` 跑）：

1. **拉正**（`rectify.html`）：封皮的木板翘了、镜头也有畸变，四条外沿都是弯的，直接按矩形裁会把金边裁斜。
   按饱和度分出物件和背景、量出四条外沿的曲线（滑动中位数去掉齿边和破口的噪点），再用 Coons 曲面把四条曲线围成的区域
   映射成矩形，逐像素反向取样：
   `node cdp-run.cjs <Anna 目录> rectify.html src/f2-rectified.jpg 300 "src=src/f2-original.jpg"`（在 `design/` 里跑）。
2. **切片拼图**（`make-enamel.html`）：封皮四条边各是一整块长铜板，上面一格一格嵌珐琅（格子之间一道细金条），
   四边外沿和两头是錾了齿纹的金边。在分隔金条的正中切开，拼起来金条正好还原；连着端头齿纹边的格子只能放在一条边的两端。
   先 `?mode=sheet` 把所有候选片排成总览挑哪几块用，再 `?mode=atlas&band=72&liner=32&res=2` 按画框尺寸（CSS 像素）× 分辨率
   缩好、排进一张图导出，坐标打在 `window.__INFO__` 上 —— 坐标抄进 `../renderer/theme.js` 的 `ENAMEL.pieces`，
   **重做素材要跟着换**。封皮上破损多的格子没切。

画框的拼法（每条边怎么排格子、里圈金边怎么斜接）见 `../README.md`。
