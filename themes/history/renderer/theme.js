(function () {
  "use strict";
  const data = ThemeKit.data();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const fmt = ThemeKit.format;
  const rt = (v) => Number(v || 0).toFixed(3);
  const sr = (v) => Number(v || 0).toFixed(4).replace(/0$/, "");
  const signed = (v, digits = 3) => (v > -0.5 * 10 ** -digits ? "+" : "−") + Math.abs(v).toFixed(digits);
  const num = (v, cls = "") => el("span", "num " + cls, v);
  const badge = (row) => el("span", "difficulty d" + row.levelIndex, ["BAS", "ADV", "EXP", "MAS", "ULT"][row.levelIndex] || "—");
  const ns = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, text) { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; return n; }

  function frame() {
    // 自绘的叶卷与尖拱只做装饰，不使用整页 SVG 滤镜，避免无显卡服务器截图慢。
    for (const pos of ["tl", "tr", "bl", "br"]) {
      const s = svg("svg", { viewBox: "0 0 150 150", class: "corner " + pos });
      s.append(svg("path", { d: "M9 141V9H141 M22 125V22H125 M34 111V34H111", fill: "none", stroke: "#bcaa7b", "stroke-width": 2 }));
      s.append(svg("path", { d: "M19 112C43 106 15 82 36 71S79 63 71 36S106 43 112 19 M31 98C61 100 40 64 66 65S99 62 98 31 M43 92Q92 92 92 43 M50 50Q34 20 23 23Q20 34 50 50Q20 61 24 76Q42 78 50 50Q61 20 76 24Q78 42 50 50", fill: "none", stroke: "#9b8f66", "stroke-width": 3 }));
      s.append(svg("path", { d: "M50 36L63 50L50 64L37 50Z", fill: "#b3c8ae", stroke: "#d5c58e", "stroke-width": 3 }));
      $("frame").append(s);
    }
    $("frame").append(el("div", "crest", "❖"));
  }
  function header() {
    $("range").textContent = data.windowLabel + " · " + data.range;
    for (const [label, value, cls] of [["当前 Rating", fmt.rating(data.rating.now), "main tier-" + ThemeKit.ratingTier(data.rating.now)], ["区间提升", signed(data.rating.gain), "gain"], ["推分批次", String(data.counts.batches), "gold"]]) {
      const s = el("div", "stat " + cls); s.append(el("label", "", label), el("strong", "", value)); $("stats").append(s);
    }
    $("curve-note").textContent = "B50 均值  " + rt(data.rating.start) + " → " + rt(data.rating.end);
    $("chart-foot").append(el("span", "", "— 每批同步后的 B50 均值"), el("span", "", "按批次等距排列"));
    $("composition-note").textContent = "区间首尾比较 · 旧曲 B30 ＋ 新曲 B20";
    $("gains-count").textContent = "新进 " + data.composition.entered + " · 提升 " + data.composition.improved;
    $("loss-count").textContent = data.composition.removed + " 首";
    $("detail-note").textContent = "按同步时间倒序 · 保留 B50 外提升与 FC / AJ 变化";
    $("page-no").textContent = "第 " + data.page + " / " + data.pages + " 页";
    $("sample").textContent = data.example ? " · 示例成绩" : " · " + data.time;
  }
  function chart() {
    const box = $("chart"), points = data.points;
    const left = 86, right = 1118, top = 32, bottom = 340;
    let lo = Math.min(...points.map((p) => p.rating)), hi = Math.max(...points.map((p) => p.rating));
    const pad = Math.max((hi - lo) * .16, .002); lo -= pad; hi += pad;
    const x = (i) => left + i / Math.max(1, points.length - 1) * (right - left);
    const y = (r) => bottom - (r - lo) / (hi - lo) * (bottom - top);
    for (let i = 0; i < 5; i++) {
      const value = lo + (hi - lo) * i / 4, py = y(value);
      box.append(svg("line", { x1:left, x2:right, y1:py, y2:py, stroke:"#b8b993", "stroke-opacity":.19 }), svg("text", { x:left - 17, y:py + 8, "text-anchor":"end" }, rt(value)));
    }
    const coords = points.map((p, i) => x(i) + "," + y(p.rating));
    box.append(svg("polygon", { points:left + "," + bottom + " " + coords.join(" ") + " " + x(points.length - 1) + "," + bottom, fill:"#b2b98a", opacity:.065 }));
    box.append(svg("polyline", { points:coords.join(" "), fill:"none", stroke:"#dac289", "stroke-width":3.7, "stroke-linejoin":"round" }));
    const stride = Math.max(1, Math.ceil((points.length - 1) / 5));
    points.forEach((p, i) => {
      if (points.length <= 45 || i === points.length - 1) box.append(svg("circle", { cx:x(i), cy:y(p.rating), r:i === points.length - 1 ? 7 : 4.5, fill:i === points.length - 1 ? "#e8d5a2" : "#bfc4a0", stroke:"#172117", "stroke-width":2 }));
      if (i === 0 || i === points.length - 1 || (i % stride === 0 && i < points.length - 1 - stride / 2)) {
        const n = svg("text", { x:x(i), y:bottom + 42, "text-anchor":i === 0 ? "start" : i === points.length - 1 ? "end" : "middle" }, p.label); box.append(n);
      }
    });
  }
  function summaryRow(row, removed) {
    const root = el("div", "summary-row"), title = el("div", "summary-top");
    title.append(badge(row), el("span", "song-name", row.title));
    title.append(num(!removed && row.change === "up" ? sr(row.prevRating) + " → " + sr(row.rating) : sr(row.rating), removed ? "loss" : "gain"));
    const bottom = el("div", "summary-bottom");
    const label = removed ? "移出" : row.change === "enter" ? "新进" : "提升";
    bottom.append(el("span", removed ? "loss" : "gain", (row.isNew ? "新曲 B20 · " : "旧曲 B30 · ") + label));
    if (!removed) bottom.append(el("span", "", (row.prevScore == null ? fmt.score(row.score) + "（首次记录）" : fmt.score(row.prevScore) + " → " + fmt.score(row.score)) + (row.updates > 1 ? " · " + row.updates + " 批" : "")));
    root.append(title, bottom);
    return root;
  }
  function composition() {
    for (const [id, rows, removed] of [["gains", data.composition.gains, false], ["losses", data.composition.left, true]]) {
      if (!rows.length) $(id).append(el("div", "empty", data.page > 1 ? "本页无更多构成变化" : removed ? "本区间没有谱面移出 B50" : "本区间没有新进或席位内提升"));
      else rows.forEach((row) => $(id).append(summaryRow(row, removed)));
    }
  }
  function detailRow(row) {
    const root = el("div", "detail-row");
    const text = el("div"), title = el("div", "song-name", row.title);
    const action = !row.inB50 ? "B50 外" : row.action === "enter" || row.action === "first" ? "进入 B50" : row.action === "fc" ? "通关标记提升" : "B50 内提升";
    const meta = el("div", "event-meta", (row.isNew ? "新曲 B20" : "旧曲 B30") + " · " + action);
    if (row.fc && row.fc !== row.prevFc) meta.append(el("span", "mark", ThemeKit.MARKS[row.fc]?.text || row.fc));
    text.append(title, meta);
    const numbers = el("div", "score-cell"), score = el("div", "score");
    score.append(num(row.prevScore == null ? fmt.score(row.score) + "（首次）" : fmt.score(row.prevScore) + " → " + fmt.score(row.score)));
    const sub = el("div", "sub", "单曲 Rating  ");
    sub.append(num(row.prevRating == null ? sr(row.rating) : sr(row.prevRating) + " → " + sr(row.rating)));
    if (row.deltaRating != null && Math.abs(row.deltaRating) > .00001) sub.append(num("  " + signed(row.deltaRating), "gain"));
    numbers.append(score, sub); root.append(badge(row), text, numbers); return root;
  }
  function batches() {
    if (!data.batches.length) $("batches").append(el("div", "empty", "推分明细已在前页列出"));
    for (const batch of data.batches) {
      const root = el("div", "batch"), head = el("div", "batch-head");
      const title = el("div", "", batch.timeText + (batch.continued ? "（续）" : ""));
      title.append(el("small", "", "整批 " + batch.total + " 张谱面" + (batch.total > batch.events.length ? " · 本页 " + batch.events.length + " 张" : "") + (batch.hasMore ? " · 下页续" : "")));
      const change = el("div", "", "B50 均值 " + rt(batch.before) + " → " + rt(batch.after));
      change.append(num(signed(batch.impact), batch.impact < 0 ? "loss" : "gain"));
      head.append(title, change); root.append(head);
      batch.events.forEach((row) => root.append(detailRow(row))); $("batches").append(root);
    }
  }
  async function main() {
    frame(); header(); chart(); composition(); batches();
    await Promise.all([document.fonts.load('26px "Anna Hand"'), document.fonts.load('700 28px "Anna Script"')]);
    await ThemeKit.done({ element:$("page") });
  }
  main().catch(ThemeKit.fail);
})();
