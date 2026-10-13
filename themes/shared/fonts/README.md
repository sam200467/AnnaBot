# 共用字体

几个主题共用的字体文件放这里，由作者自己准备，**不进仓库**（只有这份说明进仓库）。注意字体的授权是否允许这样使用。

主题的 CSS 里用 `@font-face` 引用：

```css
@font-face {
  font-family: "AnnaTitle";
  src: url("../../shared/fonts/某字体.woff2") format("woff2");
}
```

`ThemeKit.done()` 会等 `document.fonts.ready`，字体加载完才截图。字体文件缺失时浏览器会退回 CSS 里写的下一个字体，
所以 `font-family` 后面记得带上系统字体（`"Microsoft YaHei", "PingFang SC", sans-serif`）。
