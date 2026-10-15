#!/usr/bin/env node
"use strict";
// 指令面板（QQ 输入框打 / 弹出来的清单）：看本地会挂什么、平台上现在是什么样，或者不重启 Anna 马上同步一次。
// Anna 每次启动都会自己同步（src/command-panel.cjs），平时用不着它；面板被平台拒了、要排查时用。
// 只走 REST、不连网关，Anna 开着的时候也能跑。
//
// 用法：npm run panel              本地的清单 + 平台上现有的面板（只读）
//       npm run panel -- --sync    马上同步

const { loadConfig } = require("../src/config.cjs");
const { createOfficial } = require("../src/official-transport.cjs");
const panel = require("../src/command-panel.cjs");
const features = require("../src/features/index.cjs");

async function main() {
  const config = loadConfig({ requireGroups: false, requireLxns: false });
  const items = panel.panelItems(features);
  console.log("本地的清单（" + items.length + " 条；括号里是平台算的字符数，说明最多 " + panel.DESC_MAX + "，中文算 2 个）：");
  for (const item of items) console.log("  " + item.name + " ".repeat(Math.max(2, 10 - panel.width(item.name))) + item.desc + "（" + panel.width(item.desc) + "）");
  console.log("群聊面板挂在 " + config.allowedGroupIds.length + " 个群上；私聊面板" + (config.allowPrivateChat === false ? "不挂（allowPrivateChat=false）" : "对所有人"));
  panel.validateItems(items);

  const transport = createOfficial({ ...config.qq, log: () => {} });
  try {
    if (process.argv.includes("--sync")) {
      const result = await panel.syncPanels({ rest: transport.rest, features, groups: config.allowedGroupIds, privateChat: config.allowPrivateChat !== false });
      console.log("\n同步好了：" + result);
    }
    console.log("\n平台上现在的面板：");
    for (const scope of ["group", "c2c"]) {
      const { records = [] } = await transport.rest("GET", "/v2/panels?scope=" + scope + "&limit=50") || {};
      if (!records.length) console.log("  " + panel.SCOPE_NAMES[scope] + "：没有");
      for (const record of records) {
        const ours = record.panel?.remark === panel.REMARK;
        let range = record.target_type === "all" ? "对所有人" : "指定对象";
        if (record.target_type === "specific") {
          const detail = await transport.rest("GET", "/v2/panels/" + encodeURIComponent(record.panel_id));
          const linked = (scope === "group" ? detail?.group_openids : detail?.user_openids) || [];
          range = scope === "group" ? "挂在 " + linked.length + " 个群上" : "对 " + linked.length + " 个人";
        }
        console.log("  " + panel.SCOPE_NAMES[scope] + " " + record.panel_id + "（" + (ours ? "Anna 的" : "不是 Anna 建的：" + (record.panel?.remark || "没有备注")) + "，" + range + "）");
        console.log("    " + (record.panel?.items || []).map((item) => item.name).join("  "));
      }
    }
  } finally {
    transport.stop();
  }
}

main().catch((error) => {
  console.error("失败：" + String(error?.message || error).replace(/QQBot [\w.-]+/g, "QQBot ***"));
  // 平台的错误码和原文都打出来：40030013 是超长或超数量，40030020 是内容没过安全审核
  if (error?.code) console.error("错误码 " + error.code + (error.payload ? "：" + JSON.stringify(error.payload) : ""));
  process.exit(1);
});
