# 素材来源

都不进仓库（第三方素材），部署时由 `npm run package` 跟着 `themes/*/assets/` 一起带上。源文件放 `../design/`（也不进仓库）。

- `painting.jpg`：Thomas Cole《The Garden of Eden》（伊甸园），1828，阿蒙·卡特美国艺术博物馆，公有领域。
  作者 2026-10-22 从 12 张候选里选的 08 号（候选在 `data/bg-candidates/telseuras/`）。
  [Commons 原图](https://commons.wikimedia.org/wiki/File:Thomas_Cole_-_The_Garden_of_Eden_-_1828.jpg) 9000×6396，
  存在 `design/painting-original.jpg`，`design/prepare-materials.py` 缩到 4000 宽（按 1.5 倍出图正好够），不调色。
- `telseuras-fullbody.png`：原初の巫女テルスウラス 的官方透明立绘（475×1080，插画 ヒトこもる），游戏角色插画，非公有领域。
  [文件页](https://chunithmstory.miraheze.org/wiki/File:Telseuras,_Original_Sibyl_Fullbody.png)（Miraheze 打不开时文件在 static.wikitide.net）。
  原图完整使用，只由 CSS 等比缩放、降低不透明度融进背景。
- `frame-corner.jpg`、`frame-top.jpg`、`frame-side.jpg`：荷兰国立博物馆 BK-1962-51，约 1690 年的胡桃木镜框，
  木片和骨片镶嵌花卉（Spiegellijst versierd met marqueterie），公有领域。作者 2026-10-22 从画框候选 F1～F4 里选的 F1。
  原图从博物馆的 IIIF 服务下载（`iiif.micr.io/GaTqz`，5612×7160），存在 `design/frame-original.jpg`；
  `design/prepare-materials.py` 裁左上角、上边一段、左边一段，按「框宽 80 CSS 像素 × 2」缩小，拼法见 `../renderer/theme.js` 的 `FRAME`。

本主题没有使用 AI 生成素材。
