"use strict";
// 功能清单。加新功能：在 src/features/ 加一个文件，再在这里加一行。顺序就是 /帮助 里的顺序。
// 功能模块的写法见 src/commands.cjs 开头和 CLAUDE.md「加一个新功能」。

module.exports = [
  ...require("./binding.cjs"),
  require("./info.cjs"),
  ...require("./best.cjs"),
  require("./aj30.cjs"),
  require("./aj50.cjs"),
  require("./fit30.cjs"),
  require("./song.cjs"),
  require("./search.cjs"),
  require("./chart.cjs"),
  require("./popular.cjs"),
  require("./level.cjs"),
  require("./plate.cjs"),
  require("./history.cjs"),
  require("./trend.cjs"),
  require("./year-review.cjs"),
  require("./help.cjs"),
  ...require("./status.cjs"),
  require("./example-image.cjs"),
];
