# 素材来源

都不进仓库（第三方素材），部署时由 `npm run package` 跟着 `themes/*/assets/` 一起带上。源文件放 `../design/`（也不进仓库）。

- `painting.jpg`：Joseph Wright of Derby《A Grotto by the Seaside in the Kingdom of Naples with Banditti, Sunset》（那不勒斯海边的岩洞（日落）），
  1778，波士顿美术馆 1990.95，公有领域。作者从 13 张候选里选的 13 号。
  [Commons 原图](https://commons.wikimedia.org/wiki/File:Joseph_Wright_of_Derby_-_Grotto_by_the_Seaside_in_the_Kingdom_of_Naples_with_Banditti,_Sunset_-_Google_Art_Project.jpg)
  5701×4102，存在 `design/painting-original.jpg`，`design/prepare-materials.py` 缩到 3600 宽。
- `frame.webp`：荷兰国立博物馆 BK-15994，17 世纪的镜框：乌木波纹线脚之间贴玳瑁，玳瑁底下垫红色，公有领域。作者从画框候选里选的 A4。
  原图从博物馆的 IIIF 服务下载（`iiif.micr.io/SSgUH`，5284×6318；Commons 上那份裁得不一样、也小），存在 `design/frame-original.jpg`。
  `design/prepare-materials.py` 按 2700×1780 的画布拼成 2 倍图（5400×3560），中间透明：四角 + 边条同一个缩放比、边条平铺、
  每隔一段翻一次，坐标在原图上量（外沿取最靠里的、内口取最靠外的，不带进背景和镜面）。
- `avenius-fullbody.png`：原初の巫女アヴェニアス 的官方透明立绘（755×1134，插画 ミモザ），游戏角色插画，非公有领域。
  [文件页](https://chunithmstory.miraheze.org/wiki/File:Avenius,_Original_Sibyl_Fullbody.png)（Miraheze 打不开时文件在 static.wikitide.net）。
  原图完整使用，只由 CSS 等比缩放、降低不透明度融进背景；表格底和标题条的衣料也是从它裁的（`renderer/theme.js` 的 `textures`）。

本主题没有使用 AI 生成素材。
