(function () {
  "use strict";
  const data = ThemeKit.data();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svgEl = (tag, attrs, text) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // 涨幅不是 Rating，照旧四舍五入；Rating 的显示值单独截断到四位：16.99996 不能显示成
  // 17.0000、颜色却还停在 16 段。跟 ThemeKit.format.rating 一样加一点容差，避免浮点误差截掉一位。
  const number = (value) => Number(value).toFixed(4);
  const ratingNumber = (value) => (Math.floor((Number(value) || 0) * 10000 + 1e-8) / 10000).toFixed(4);
  const signed = (value) => (value < -.00005 ? "−" : "+") + number(Math.abs(value));
  const rating = (tag, value) => el(tag, "rating tier-" + ThemeKit.ratingTier(value), ratingNumber(value));
  function chart(series, index) {
    const large = index === 0, root = el("section", "panel" + (large ? " large" : ""));
    root.style.setProperty("--line", ["#b4e4cd", "#d6d8f0", "#dfc58e"][index]);
    const title = el("h2");
    title.append(el("span", "latin", series.title), el("span", "subtitle", series.subtitle));
    const summary = el("div", "summary"), current = el("div", "current");
    current.append(el("label", "", "当前均值"), rating("strong", series.end));
    const gain = el("div", "gain" + (series.gain < -.00005 ? " negative" : ""));
    gain.append(el("label", "", data.period + "变化"), el("strong", "", signed(series.gain)));
    summary.append(current, gain);
    const W = large ? 958 : 631, H = large ? 710 : 278;
    const svg = svgEl("svg", { class:"plot", viewBox:`0 0 ${W} ${H}`, role:"img", "aria-label":series.title + data.period + "变化曲线" });
    const pad = { left:102, right:25, top:26, bottom:45 };
    const values = series.points.map(p => p.value);
    let min = Infinity, max = -Infinity;
    for (const v of values) { min = Math.min(min, v); max = Math.max(max, v); }
    const span = Math.max(max - min, .002);
    // 纵轴随数据变化但保留上下空间；相同数值仍有有限范围，不能除以零。
    const rough = span / 4, power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].find(n => n * power >= rough) * power;
    const lo = Math.max(0, Math.floor((min - span * .12) / step) * step);
    const hi = Math.ceil((max + span * .12) / step) * step;
    const precision = Math.max(3, Math.min(6, -Math.floor(Math.log10(step))));
    const x = ms => pad.left + (ms - data.from) / Math.max(1, data.to - data.from) * (W - pad.left - pad.right);
    const y = v => H - pad.bottom - (v - lo) / (hi - lo) * (H - pad.top - pad.bottom);
    for (let v = lo; v <= hi + step / 100; v += step) {
      svg.append(svgEl("line", { class:"gridline", x1:pad.left, x2:W-pad.right, y1:y(v), y2:y(v) }));
      svg.append(svgEl("text", { class:"axis-text", x:pad.left-15, y:y(v)+7, "text-anchor":"end" }, v.toFixed(precision)));
    }
    // 小图最多三个横轴标签；不减少任何曲线数据点。
    const ticks = large ? data.ticks : data.ticks.filter((_, i, list) => i === 0 || i === Math.floor(list.length/2) || i === list.length-1);
    ticks.forEach((tick, i) => {
      svg.append(svgEl("line", { class:"gridline", x1:x(tick.ms), x2:x(tick.ms), y1:pad.top, y2:H-pad.bottom }));
      svg.append(svgEl("text", { class:"axis-text", x:x(tick.ms), y:H-8, "text-anchor":i === 0 ? "start" : i === ticks.length-1 ? "end" : "middle" }, tick.label));
    });
    // 按用户要求用直线连接上传批次的采样点，保留所有采样，不做曲线平滑。
    let line = `M ${x(series.points[0].ms)} ${y(series.points[0].value)}`;
    for (const p of series.points.slice(1)) line += ` L ${x(p.ms)} ${y(p.value)}`;
    svg.append(svgEl("path", { class:"plot-line", d:line }));
    const last = series.points.at(-1);
    svg.append(svgEl("circle", { class:"dot", cx:x(last.ms), cy:y(last.value), r:large ? 7 : 5 }));
    const baseline = el("div", "baseline"), before = el("span", "", "原均值");
    before.append(rating("b", series.start));
    baseline.append(before, el("span", "", Math.abs(series.gain) < 1e-9 ? "区间均值持平" : "每次上传后重算"));
    root.append(title, summary, svg, baseline);
    return root;
  }
  async function main() {
    $("period").textContent = data.period;
    $("range").textContent = data.rangeText;
    $("updates").append(data.period + "内 B50 共 ", el("strong", "", String(data.updatedCharts)), " 个谱面成绩更新");
    $("credit").textContent = "Anna Bot · 落雪查分器" + (data.example ? " · 示例数据" : "");
    const meve = $("meve");
    await meve.decode();
    // 面板底纹取衣料原画，保留这位角色的绘画笔触。
    const cloth = document.createElement("canvas"); cloth.width = 100; cloth.height = 150;
    cloth.getContext("2d").drawImage(meve, 448, 409, 45, 68, 0, 0, 100, 150);
    document.documentElement.style.setProperty("--cloth", `url("${cloth.toDataURL()}")`);
    data.series.forEach((series, i) => $("charts").append(chart(series, i)));
    await window.drawTrendFrame($("frame"));
    await document.fonts.ready;
    await ThemeKit.done({ element:$("page") });
  }
  main().catch(ThemeKit.fail);
})();
