"use strict";
// 指令面板：QQ 输入框里打「/」弹出来的指令清单，群聊、私聊各一个。照 MiaBot 的 qq-official/mia-command-panel.cjs 改写。
//
// 面板只是个入口：元素是 type=command，官方文档说点了就把 name 填进输入框 —— 用户点一下得到的是「/b50」这几个字，
// 跟手打一样，之后照常走 @ 判定、白名单、绑定检查、出图队列。面板错了最多是难看，不会让谁绕过校验。
//
// 跟 MiaBot 不同：那边是手动跑脚本注册、只有群面板，改了指令、换了群都要记着重新注册。
// Anna 每次启动自己对一遍（bot.cjs 的 start），重启以后面板就跟着功能表和白名单变：
//   群聊：只挂 allowedGroupIds 里的群（target_type=specific）—— 白名单外的群 Anna 不理，弹出清单反而误导
//   私聊：对所有人（target_type=all）；allowPrivateChat=false 时删掉
// 清单来自功能表（src/features/index.cjs），顺序跟 /帮助 一样；管理员指令、隐藏指令和写了 panel: false 的不进面板。
// 说明用功能模块的 panel，没写就用 summary（太长时测试会报，补一个短的 panel 就行）。
//
// 平台规则（官方文档「自定义菜单与指令面板」，2026-08-13 版，2026-10-15 读）：
//   · 一个机器人最多 20 个面板（各场景加起来），一个面板最多 20 个元素
//   · name 最多 14 个字符、desc 最多 30 个字符，文档括号里写「约 7 / 15 个中文汉字」，也就是中文按 2 个算。
//     MiaBot 2026-09 被 40030013（超出数量限制）拒掉的「把你的大饼账号交给美亚（要私聊）」按这个算正好 32，
//     改成半角括号（30）、去掉括号（28）就过了 —— 那边当时以为是文案被拦，其实就是超长
//   · 平台存的时候会去掉 name 开头的斜杠，读回来的键序也跟发上去的不一样（MiaBot 实测），比内容前要先归一化
//   · 修改面板（PUT /v2/panels/{id}）只换内容，不动关联的群；群的增删走 PUT /v2/panels/{id}/target，一次最多 20 个
//   · 列表接口不返回关联的群（只有详情接口有），也没有别的东西能区分面板是谁建的，所以认自己的面板靠 remark。
//     REMARK 别改：改了就认不出旧的，会另建一个
//   · 40030009：同一个面板上还有操作没做完，等一下重试；40030020：内容没过安全审核
//   · 创建、修改、删除每分钟 10 次，查询 30 次，改关联对象 60 次。启动时对一遍只查两三次，内容和群都没变就不写

const REMARK = "anna-command-panel｜由 src/command-panel.cjs 按功能表生成，别手改";
const ITEM_MAX = 20;
const NAME_MAX = 14;
const DESC_MAX = 30;
const TARGET_BATCH = 20;
const SCOPE_NAMES = { group: "群聊", c2c: "私聊" };

// 平台说的「字符」：中文（连同全角标点）按 2 个算
const width = (text) => [...String(text)].reduce((total, ch) => total + (ch.codePointAt(0) > 0x7f ? 2 : 1), 0);

function panelItems(features) {
  return features
    .filter((feature) => !feature.hidden && !feature.adminOnly && feature.panel !== false)
    .map((feature) => ({ type: "command", name: "/" + feature.words[0], desc: feature.panel || feature.summary || "" }));
}

// 发之前在本地拦下来：平台超长报的是 40030013「超出数量限制」，看不出是哪一条、超了多少
function validateItems(items) {
  if (!items.length) throw new Error("指令面板一条指令都没有");
  if (items.length > ITEM_MAX) throw new Error("指令面板有 " + items.length + " 条指令，平台最多 " + ITEM_MAX + " 条：不常用的功能写上 panel: false");
  for (const item of items) {
    if (width(item.name) > NAME_MAX) throw new Error("指令名「" + item.name + "」太长：面板里最多 " + NAME_MAX + " 个字符（中文算 2 个）");
    if (width(item.desc) > DESC_MAX) {
      throw new Error(item.name + " 的面板说明「" + item.desc + "」有 " + width(item.desc) + " 个字符，最多 " + DESC_MAX +
        "（中文算 2 个）：在功能模块里写一个短的 panel");
    }
  }
  return items;
}

const normalize = (items) => JSON.stringify((items || []).map((item) =>
  [String(item?.name || "").replace(/^\/+/, ""), String(item?.desc || ""), String(item?.type || "command")]));

// 把平台上的面板对成该有的样子，返回一句给日志看的结果。
// rest 是 official-transport.cjs 的 rest：只走 REST、不连网关，Anna 开着的时候也能单独跑（npm run panel）。
// groups：群白名单（group_openid）；privateChat：私聊开不开。
async function syncPanels({ rest, features, groups = [], privateChat = true, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const panel = { items: validateItems(panelItems(features)), remark: REMARK };
  const targets = [...new Set(groups.map(String))];
  const wanted = {
    group: targets.length ? { type: "specific", field: "group_openids", targets } : null,
    c2c: privateChat ? { type: "all" } : null,
  };

  async function call(method, path, body) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await rest(method, path, body);
      } catch (error) {
        if (error?.code !== 40030009 || attempt >= 3) throw error;
        await sleep(2000 * attempt);
      }
    }
  }

  async function retarget(id, field, op, list) {
    for (let i = 0; i < list.length; i += TARGET_BATCH) {
      await call("PUT", "/v2/panels/" + encodeURIComponent(id) + "/target", { op, [field]: list.slice(i, i + TARGET_BATCH) });
    }
  }

  async function syncScope(scope, want) {
    const listed = await call("GET", "/v2/panels?scope=" + scope + "&limit=50");
    const ours = (listed?.records || []).filter((record) => record?.panel?.remark === REMARK);
    // 列表按设置时间倒序，留最新的那个；多出来的（两个 Anna 同时启动各建了一个之类）、作用范围不对的删掉
    const keep = want ? ours.find((record) => record.target_type === want.type) || null : null;
    const extra = ours.filter((record) => record !== keep);
    for (const record of extra) await call("DELETE", "/v2/panels/" + encodeURIComponent(record.panel_id));
    if (!want) return extra.length ? "撤了" : "不挂";

    const count = want.targets ? "（" + want.targets.length + " 个群）" : "";
    if (!keep) {
      const body = { scope, target_type: want.type, panel };
      if (want.targets) body[want.field] = want.targets.slice(0, TARGET_BATCH);
      const created = await call("POST", "/v2/panels", body);
      if (want.targets?.length > TARGET_BATCH) await retarget(created.panel_id, want.field, "add", want.targets.slice(TARGET_BATCH));
      return "新建了" + count;
    }

    const changed = [];
    if (normalize(keep.panel?.items) !== normalize(panel.items)) {
      await call("PUT", "/v2/panels/" + encodeURIComponent(keep.panel_id), { panel });
      changed.push("内容");
    }
    if (want.targets) {
      const detail = await call("GET", "/v2/panels/" + encodeURIComponent(keep.panel_id));
      const linked = (detail?.[want.field] || []).map(String);
      const add = want.targets.filter((id) => !linked.includes(id));
      const del = linked.filter((id) => !want.targets.includes(id));
      if (add.length) await retarget(keep.panel_id, want.field, "add", add);
      if (del.length) await retarget(keep.panel_id, want.field, "del", del);
      if (add.length || del.length) changed.push("群");
    }
    return (changed.length ? "更新了" + changed.join("和") : "没变") + count;
  }

  const results = [];
  for (const scope of ["group", "c2c"]) results.push(SCOPE_NAMES[scope] + await syncScope(scope, wanted[scope]));
  return results.join("，");
}

module.exports = { REMARK, ITEM_MAX, NAME_MAX, DESC_MAX, SCOPE_NAMES, width, panelItems, validateItems, normalize, syncPanels };
