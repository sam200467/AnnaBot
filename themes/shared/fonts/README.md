# 共用字体

几个主题共用的字体文件放这里，由作者自己准备，**不进仓库**（只有这份说明进仓库）。注意字体的授权是否允许这样使用。

主题不直接写 `@font-face`，而是引入 `../../shared/fonts.css`，用里面定好的几个别名。每个别名先找本机装好的字体，
没有再读这里的文件，两边都没有就退回 `font-family` 里写在后面的字体（图照样出得来，只是不好看）。

| 别名 | 用途 | 本机字体（local） | 这里的文件 | 授权 |
| --- | --- | --- | --- | --- |
| `Anna Hand` | 手写楷书，Anna 出图的正文 | 霞鹜文楷 Medium（一般没装，读这里的文件） | `LXGWWenKai-Medium.ttf` | OFL |
| `Anna Script` | 手写西文，只用在纯数字、纯西文的地方（best 主题的分数、定数、单曲 Rating、格言） | Segoe Script、Segoe Script Bold（Windows 自带） | —（微软的字体，不能拷出来用；别的系统上退回文楷） | Windows 附带 |
| `Anna Caps` | 罗马碑刻体大写 | Cinzel | `Cinzel-Regular.ttf` | OFL |
| `Anna Serif` | 西文衬线、意大利体 | Cormorant Infant | `CormorantInfant-Medium.ttf`、`CormorantInfant-MediumItalic.ttf`、`CormorantInfant-BoldItalic.ttf` | OFL |
| `Anna Mincho` | 日文明朝 | 游明朝（Windows 自带） | `NotoSerifJP-Regular.otf`（没有游明朝时用） | OFL |
| `Anna Song` | 中文宋体（可变字重 200～900） | Noto Serif SC | `NotoSerifSC-VF.ttf` | OFL |

`LXGWWenKai-Medium.ttf` 从 github.com/lxgw/LxgwWenKai 的 Releases 下载（2026-10-15 用的是 v1.522，24 MB）。

## 为什么正文只用霞鹜文楷

曲名里中文、日文、西文混着来。几种字体叠着用的时候（试过 Segoe Script 写西文、辰宇落雁體写中文、华文楷体补假名），
每种字体同样字号下的实际大小、笔迹都不一样，曲名里一眼就看得出大小不齐，调 `size-adjust` 也只能调到差不多。

霞鹜文楷一个字体就有简体、繁体、日文写法的汉字、假名、西文、希腊字母和常见符号，几种字的比例是设计好的
（100px 字号时汉字墨迹高 89、假名 76、西文大写 74、小写 52）。2026-10-15 拿落雪曲库的 1458 个曲名（1012 个不同的字）
逐字查过字符表，**只缺 ✪**（D✪N’T ST✪P R✪CKIN’ 那首），所以写成：

```
font-family: "Anna Hand", "Segoe UI Symbol", serif;
```

以后曲库加了新的怪字，照这个办法再查一遍（读字体文件的 cmap 表，看每个字在不在）。
别的候选当时也查过：华文行楷只有国标简体，缺 222 个繁体、日文写法的字；华文楷体字全，但西文是衬线体；
あんずもじ有些字符（é、希腊字母、·）是空白字形，浏览器不会去别的字体补，直接显示成空白。

另外 `best` 主题还直接用了 Segoe UI Historic（法阵上的卢恩字母）、Segoe UI Symbol（✪，以及没有角色图时的 ✦）。

`ThemeKit.done()` 会等 `document.fonts.ready`，字体加载完才截图。
