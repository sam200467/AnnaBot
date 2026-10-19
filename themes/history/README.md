# history：推分记录图

伊迪亚主题，背景使用作者选定的 John Martin《万魔殿》。沿用霞鹜文楷、Segoe Script、难度颜料色及总 Rating 色档。

## 版式

三块完整面板，内部为连续表格行，不给每首歌画独立卡片：

1. Rating 轨迹：抬头列当前 Rating、区间涨幅、推分批次；曲线按批次等距排列，右侧小幅伊迪亚肖像。
2. B50 构成变化：比较区间首尾，左侧新进和席位内提升，右侧净移出；不把中途出榜又回榜重复算新进。
3. 推分明细：倒序展示批次，每批表头写整批 B50 均值变化，下面逐曲列分数、单曲 Rating、FC/AJ。保留 B50 外提升。

画框为自绘旧金线脚、黑绿内衬、叶卷角饰与淡绿菱形饰物。底板为半透明黑绿织纹、双边框、浅灰绿章节缎带。
只在上部放油画，向下渐隐到暗色，不把原画拉长。肖像源图仅 400×400，放在小拱框中，暂不做整幅高大立绘。

## 数据与分页

- `src/history.cjs` 负责重放及区间首尾 B50，`src/history-view.cjs` 负责展示数据及分页。
- 当前 Rating 沿用两位截断；曲线及批次重算值标为「B50 均值」，展示三位小数。
- 图中时间用北京时间、按上传时间归批（相邻间隔不超过 15 秒），不是逐次游玩记录或落雪原生批次 ID。
- 每页明细最多 16 行预算（每个组头也占一行），构成变化每列最多 8 首；大批次可续页，注明整批、本页及下页续。
- `/推分记录 今天 第2页`；其他窗口同样可翻页。曲线和总览每页重复，构成变化及明细按页分配，不丢行。
- `points` 仅含区间基点和本区间批次结果；图片不读取缓存全历史点。
- 旧的 `voice.historyText` 保留供其他工具使用，指令有记录时走 `ctx.image`，无记录仍回文字。

## 预览

```powershell
node tools/render-preview.cjs history --out themes/history/previews/preview.jpg --scale 1.5
node tools/render-preview.cjs history themes/history/examples/latest.json --out themes/history/previews/latest.jpg --scale 1.5
```

示例为虚构成绩；`design/make-example.cjs` 用正式 report 整理流程生成。`design/render-real.cjs` 可使用本机个人密钥只读核验，输出 `data/try/history-real*.jpg`，不发送 QQ 消息。

主题宽 1900 CSS 像素、高度随内容变化，JPEG 76、1.5 倍输出。初版实测最新示例约 0.6 MB、今日示例约 1.1 MB、7 天真实记录第一页约 1 MB。
不使用整页模糊或 SVG 噪声滤镜。字体、图像加载完成后调用 `ThemeKit.done`。
