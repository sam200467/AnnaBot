# 素材来源

- `painting.jpg`：John Martin，《Pandemonium》（万魔殿），1841，3224×2127。作者从 15 张候选中选择的第 2 张。
  原文件复制自 `data/bg-candidates/idea-20261019/pandemonium.jpg`。保留横幅比例，排版用轻度暗色遮罩。
  [Commons 来源](https://commons.wikimedia.org/wiki/File:John_Martin_Le_Pandemonium_Louvre.JPG)，[卢浮宫馆藏](https://collections.louvre.fr/ark:/53355/cl010067390)。Commons 标记 Public domain。
- `idea-fullbody.png`：創造神 イデア完整透明立绘，767×1080。游戏角色插画，非公有领域素材，插画作者夜汽車。
  [完整立绘文件页](https://chunithmstory.miraheze.org/wiki/File:Idea,_the_Demiurge_Fullbody.png)，[角色页](https://wikiwiki.jp/chunithmwiki/%E5%89%B5%E9%80%A0%E7%A5%9E%20%E3%82%A4%E3%83%87%E3%82%A2)。
  原图完整使用，只由 CSS 等比例缩放、降低饱和度和透明度融入背景。旧 `idea.png` 400×400 肖像不再用于模板。
- `frame-tortoiseshell.webp`：明尼阿波利斯美术馆 84.43，17 世纪荷兰的琥珀玳瑁乌木波纹框（馆藏描述：red tortoise shell and
  black ripple wood frame，原本配 Paul Bril 的风景画），公有领域。作者 2026-10-21 从年度总结的画框候选（A5）里挑给伊迪亚。
  [Commons 原照片](https://commons.wikimedia.org/wiki/File:Tortoise_Shell_Frame_-_84.43_-_Minneapolis_Institute_of_Arts.jpg)（5521×3744），
  保存于 `design/frame-a5-original.jpg`。照片只拍了左上角、左边那条打光偏青，所以只取上边一段线脚，转到四条边上平铺、四角 45° 斜接；
  四边同一个缩放比，边条每隔一段翻一次，不拉伸纹样。按 2700×1780 的画布拼成 2 倍图、中间透明，脚本 `design/prepare-frame.py`。
- 换下来的旧框 `design/frame-cassetta.webp`：大都会博物馆 Cassetta frame，藏品号 1975.1.2292（黑木、暗红嵌石、蓝色角石），
  [博物馆馆藏](https://www.metmuseum.org/art/collection/search/461189)，原照片 `design/frame-original.jpg`，裁切坐标在 `design/prepare-materials.py`。
- `robe-texture.webp`、`ivory-texture.webp`：来自同一张伊迪亚完整立绘的黑袍花叶纹理、象牙色内衬局部，镜像拼接，用于表格底板与标题带；权利归属同角色图。

裁切脚本：`design/prepare-materials.py`。本主题没有使用 AI 生成素材；边线和排版由 CSS 绘制。正文、数字字体由 `themes/shared/fonts.css` 提供。
