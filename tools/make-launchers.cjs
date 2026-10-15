#!/usr/bin/env node
"use strict";
// 生成两个无窗口启动器（照 MiaBot 的 qq-official/make-launchers.cjs），放在项目根目录：
//   启动Anna.vbs  Anna 在后台跑，没有窗口。已经有 Anna 在跑就不再开 —— 同一个 QQ 环境连两次，每句话会回两遍
//   停止Anna.vbs  停掉在跑的 Anna，别的 node 程序不动
// .vbs 只是壳：真正干活的是 tools/background.cjs，.vbs 把它藏起来跑完，再按退出码弹窗说结果。
// 生成的 .vbs 不进仓库（.gitignore）。里面只有相对路径，挪了项目目录也不用重新生成。
//
// VBScript 只认 ANSI 或 **UTF-16LE**：UTF-8 带 BOM 会被报「无效字符」，所以这里必须写 utf16le + BOM，不能直接写文本文件。
// 引号转义也是 VBScript 的「双写」，不是 JSON 的 \"。
//
// 用法：npm run launchers

const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("../src/config.cjs");

const BOM = "\uFEFF";
const vbsQuote = (value) => '"' + String(value).replace(/"/g, '""') + '"';

// 弹窗：成功的 5 秒后自己关；出了问题的（退出码 1 失败、2 要人看一眼）一直留着等人点。
// 4096 是「系统模态」，弹窗盖在别的窗口上面：启动要等几秒，这期间点了别处的话，普通弹窗会被压在底下。
function launcher(comment, action) {
  return [
    ...comment.map((line) => "' " + line),
    "' 这个文件是 tools/make-launchers.cjs 生成的（npm run launchers），改了会被覆盖。",
    "Option Explicit",
    "Dim shell, fso, result, code, text",
    'Set shell = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    "' 用脚本自己所在的目录，双击时不受「起始位置」影响",
    "shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)",
    "result = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName())",
    "On Error Resume Next",
    "code = shell.Run(" + vbsQuote("node tools\\background.cjs " + action + ' --result "') + " & result & " + vbsQuote('"') + ", 0, True)",
    // 找不到 node 时 Err.Description 是空的（实测），不拼进去
    "If Err.Number <> 0 Then",
    '  shell.Popup "运行不了 node，先装 Node.js 22 或更新的版本。", 0, "Anna", 16 + 4096',
    "  WScript.Quit 1",
    "End If",
    "On Error GoTo 0",
    'text = "没拿到结果（退出码 " & code & "）。"',
    "If fso.FileExists(result) Then",
    "  ' 结果是 UTF-16LE（-1），空文件 ReadAll 会报错",
    "  If fso.GetFile(result).Size > 2 Then",
    "    With fso.OpenTextFile(result, 1, False, -1)",
    "      text = .ReadAll",
    "      .Close",
    "    End With",
    "  End If",
    "  fso.DeleteFile result",
    "End If",
    "If code = 0 Then",
    '  shell.Popup text, 5, "Anna", 64 + 4096',
    "ElseIf code = 2 Then",
    '  shell.Popup text, 0, "Anna", 48 + 4096',
    "Else",
    '  shell.Popup text, 0, "Anna", 16 + 4096',
    "End If",
  ].join("\r\n") + "\r\n";
}

function buildLaunchers() {
  return {
    "启动Anna.vbs": launcher([
      "无窗口启动 Anna。已经有 Anna 在跑就不再开第二个；连上 QQ 了、没起来，都会弹窗说一声。",
      "日志在 data\\logs\\anna-日期.log。停止：双击「停止Anna.vbs」。",
    ], "start"),
    "停止Anna.vbs": launcher([
      "停止 Anna：结束命令行里带 src\\main.cjs 的 node 进程（启动器开的、npm start 开的都算），别的 node 程序不动。",
    ], "stop"),
  };
}

const encode = (text) => Buffer.from(BOM + text, "utf16le");

function writeLaunchers(dir = ROOT) {
  return Object.entries(buildLaunchers()).map(([name, text]) => {
    fs.writeFileSync(path.join(dir, name), encode(text));
    return name;
  });
}

if (require.main === module) {
  for (const name of writeLaunchers()) console.log("写出 " + name);
  console.log("双击「启动Anna.vbs」在后台启动 Anna，「停止Anna.vbs」停掉它。挪了项目目录也不用重新生成。");
}

module.exports = { buildLaunchers, writeLaunchers, encode };
