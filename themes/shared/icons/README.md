# 共用图标

几个主题都会用到的图标放这里（B30 图、单曲图、等级成绩图……）。图由作者自己准备，**不进仓库**（只有这份说明进仓库）。

文件名直接用落雪接口里的取值，主题里就能按数据拼路径，不用再做一层对照：

| 目录 | 文件名（落雪的取值） | 数据里对应的字段 |
| --- | --- | --- |
| `difficulty/` | `0.png` BASIC、`1.png` ADVANCED、`2.png` EXPERT、`3.png` MASTER、`4.png` ULTIMA、`5.png` WORLD'S END | `level_index` |
| `rank/` | `sssp` `sss` `ssp` `ss` `sp` `s` `aaa` `aa` `a` `bbb` `bb` `b` `c` `d` | `rank` |
| `full_combo/` | `alljusticecritical` `alljustice` `fullcombo` | `full_combo`（没有时是 null） |
| `clear/` | `catastrophy` `absolute` `brave` `hard` `clear` `failed` | `clear` |
| `full_chain/` | `fullchain`（铂）`fullchain2`（金） | `full_chain`（没有时是 null） |

主题里这样用：`"../../shared/icons/rank/" + score.rank + ".png"`。

缺图时主题应该照样能出图（隐藏那个图标或者退回文字），不要让一个图标缺失导致整张图出不来。
