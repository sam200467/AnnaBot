# 素材来源

都不进仓库（第三方素材），部署时由 `npm run package` 跟着 `themes/*/assets/` 一起带上。源文件放 `../design/`（也不进仓库）。

- `painting.jpg`：J. M. W. Turner《Dido building Carthage; or the Rise of the Carthaginian Empire》（狄多建设迦太基），
  1815，伦敦国家美术馆，公有领域。作者从 14 张候选里选的 03 号，亮度用原图的（中等、偏暗两档压暗都试过，没选）。
  [Commons 原图](https://commons.wikimedia.org/wiki/File:Turner_-_Dido.jpg) 6288×4226，存在 `design/painting-original.jpg`，
  `design/prepare-materials.py` 缩到 4000 宽（按 1.5 倍出图正好够），不调色。
- `frame-side.jpg`、`frame-rail.jpg`、`frame-corner.jpg`：荷兰国立博物馆 BK-1971-122，乌木镜框配银丝花（Carel Adolph Lion Cachet 设计、
  阿姆斯特丹 E.J. van Wisselingh 制作，约 1906–1909），公有领域。是一面拱顶的镜子，这里只取三块拼成横框（拼法见 `../renderer/theme.js` 的 `FRAME`）。
  从博物馆的 IIIF 服务按原图（6049×7478）坐标原样裁，没再处理：
  - 立柱 `https://iiif.micr.io/jiVVs/645,2950,255,1000/max/0/default.jpg`
  - 横档 `https://iiif.micr.io/jiVVs/900,6818,1330,186/max/0/default.jpg`（只取两个银箍之间那段；再往上是镜子斜边的彩虹反光）
  - 方墩 `https://iiif.micr.io/jiVVs/627,6585,256,483/max/0/default.jpg`

  [Commons 文件页](https://commons.wikimedia.org/wiki/File:Spiegel_met_ebbenhouten_omlijsting_waarop_beslag_van_zilverfiligrein,_BK-1971-122.jpg)（那份只有 1011×1250，所以用 IIIF）。
- `salacia-fullbody.png`：原初の巫女サラキア 的官方透明立绘（760×1135，插画 旧都なぎ），游戏角色插画，非公有领域。
  [文件页](https://chunithmstory.miraheze.org/wiki/File:Salacia,_Original_Sibyl_Fullbody.png)（Miraheze 打不开时文件在 static.wikitide.net）。
  原图完整使用，只由 CSS 等比缩放、降低不透明度融进背景。

本主题没有使用 AI 生成素材。
