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
  // ── 右上角的名片板：名牌版、称号、★转生 Lv.等级 + 名字、角色头像和段位（跟 /分数列表 一样） ──
  function renderIdentity() {
    const player = data.player || {};
    // 没有玩家资料（老示例数据、或者接口没给）就不画这块，天空里空着也不影响图表
    if (!player.name) { $("identity").remove(); return false; }
    const plate = $("plate");
    if (player.plate) {
      const img = $("plate-img");
      img.src = player.plate;
      img.addEventListener("error", () => { img.remove(); plate.classList.add("empty"); }, { once: true });
    } else {
      plate.classList.add("empty");
    }
    const trophy = $("trophy");
    if (player.trophy && player.trophy.name) {
      trophy.classList.add(player.trophy.color || "normal");
      trophy.append(el("span", null, player.trophy.name));
    } else {
      trophy.remove();
    }
    // 「★1 Lv.51」跟名字一行，星数和等级一样大（照 /b50）
    const level = $("level");
    if (player.reborn) level.append(el("span", "star", "★" + player.reborn));
    if (player.level !== null && player.level !== undefined) level.append(el("span", "lv", "Lv."), el("span", null, player.level));
    $("name").textContent = player.name || "";
    // 名字下面的总 Rating（p2 格式）：标签和数值差不多大，数值按游戏色档上色
    const overall = $("rating");
    overall.textContent = ThemeKit.format.rating(player.rating);
    overall.classList.add("tier-" + ThemeKit.ratingTier(player.rating));

    const medallion = document.querySelector(".medallion");
    if (player.character) {
      const chara = $("chara");
      chara.src = player.character;
      chara.addEventListener("error", () => { chara.remove(); medallion.classList.add("empty"); }, { once: true });
    } else {
      medallion.classList.add("empty");
    }
    // 段位（CLASS 勋章）挂在头像下面：缎带在下、勋章压在上面（照 /分数列表）
    const emblem = $("emblem");
    const { base = 0, medal = 0 } = player.classEmblem || {};
    const badge = (kind, n) => {
      const img = el("img", kind);
      img.alt = "";
      img.src = "../../shared/icons/class_emblem/" + kind + "/" + n + ".webp";
      img.addEventListener("error", () => img.remove(), { once: true });
      return img;
    };
    if (base) emblem.append(badge("base", base));
    if (medal) emblem.append(badge("medal", medal));
    if (!base && !medal) emblem.remove();
    return true;
  }

  // 牌子上放不下的字往小缩（称号、名字；照 /分数列表 的 fitPlate）
  function fitPlate() {
    const trophy = document.querySelector(".trophy span");
    if (trophy) {
      // 称号条左右各 12px 内边距，减掉以后才是字真正能占的宽度
      const ratio = (trophy.parentElement.clientWidth - 24) / trophy.scrollWidth;
      if (ratio < 1) trophy.style.transform = "scale(" + ratio.toFixed(3) + ")";
    }
    const who = document.querySelector(".plate-name .who");
    if (!who) return;
    // 整行（等级 + 名字）一起缩，缩放原点在中间，缩完还是居中的；留 6px 余量，最后一个字不压在裁切线上
    const room = who.parentElement.clientWidth - 6;
    if (room > 0 && who.scrollWidth > room) who.style.transform = "scale(" + Math.max(0.3, room / who.scrollWidth).toFixed(3) + ")";
  }

  async function main() {
    $("period").textContent = data.period;
    $("range").textContent = data.rangeText;
    $("updates").append(data.period + "内 B50 共 ", el("strong", "", String(data.updatedCharts)), " 个谱面成绩更新");
    $("credit").textContent = "Anna Bot · 落雪查分器" + (data.example ? " · 示例数据" : "");
    renderIdentity();
    const meve = $("meve");
    await meve.decode();
    // 面板底纹取衣料原画，保留这位角色的绘画笔触。
    const cloth = document.createElement("canvas"); cloth.width = 100; cloth.height = 150;
    cloth.getContext("2d").drawImage(meve, 448, 409, 45, 68, 0, 0, 100, 150);
    document.documentElement.style.setProperty("--cloth", `url("${cloth.toDataURL()}")`);
    data.series.forEach((series, i) => $("charts").append(chart(series, i)));
    await window.drawTrendFrame($("frame"));
    await document.fonts.ready;
    fitPlate();
    await ThemeKit.done({ element:$("page") });
  }
  main().catch(ThemeKit.fail);
})();
