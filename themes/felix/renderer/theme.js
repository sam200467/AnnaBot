// B50 / B30 / AJ30 / AJ50 / 拟合 B30 共用横版成绩图（朱娜·菲利克斯），设计说明见 ../README.md。
// 数据由 src/features/best.cjs 的 buildData 给出，五种模式的示例见 ../examples/。
// 最初从旧版 best 移植卡片、名牌版、Rating 三格和柱状图；旧 UI 已停用，分表 UI 在这里维护。
// 封印的边用固定种子的伪随机数生成：同一份数据每次出图都一模一样。
(function () {
  "use strict";
  const data = ThemeKit.data();
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";

  const CHAPTERS = {
    old: { en: "Best 30", side: "旧版本曲目" },
    new: { en: "New 20", side: "当前版本新曲" },
    all: { en: "Best 30", side: "不分新旧" },
    fit: { en: "Fit 30", side: "按拟合定数重算" },
    aj: { en: "AJ 30", side: "全曲 AJ / AJC" },
    ajold: { en: "AJ 30", side: "旧版本曲目 AJ" },
    ajnew: { en: "AJ 20", side: "当前版本新曲 AJ" },
  };
  const LEVELS = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "ULTIMA", "WORLD'S END"];
  const RANK_TEXT = { sssp: "SSS+", sss: "SSS", ssp: "SS+", ss: "SS", sp: "S+", s: "S", aaa: "AAA", aa: "AA", a: "A", bbb: "BBB", bb: "BB", b: "B", c: "C", d: "D" };
  const SEALED = new Set(["sssp", "sss", "ssp", "ss", "sp", "s"]);
  const MARKS = ThemeKit.MARKS;
  const rating = ThemeKit.format.rating;

  // 排版的几个尺寸（CSS 像素）。两张表：旧曲三列、新曲两列，都是十行；/b30 一张表五列六行、宽度跟两张表加起来一样
  const SIZE = {
    card: 400, gapX: 16, panelPad: 22, panelBorder: 2, tableGap: 28,   // card 跟 theme.css 的 --card-w 一致
    ratio: 7615 / 4679,   // 油画原图的宽高比：作者要画框里的画面照原图比例（2026-10-20）
    minColumn: 1100,      // 表右边留给朱娜的最少宽度：/b30 正文矮，照油画比例右边就太窄了，这时画面加宽、油画上下裁掉一点
    maxColumn: 1500,      // 最多留多宽：/b50 照原图比例右边有 1800，朱娜两边空得多，作者让左右裁掉一点油画（2026-10-20）
    sibyl: [900, 1136],   // 立绘原图的大小（找不到更清楚的全身图，见 ../assets/README.md）
    sibylCenter: 0.44,    // 立绘的视觉中线在原图宽度的哪儿：头和腿在 0.47，披风往左飘，连披风一起看在 0.44 左右（量过不透明像素）
    sibylMaxScale: 1.75,  // 最多放大到原图的几倍（再大就糊了；半透明了糊一点看不太出来）
    sibylMargin: 110,     // 上下居中，头顶、鞋底离画框至少留多少：底下要让开右下角的落款
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const svgEl = (tag, attrs, parent) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.append(node);
    return node;
  };
  const markOf = (value, extra) => {
    const item = MARKS[value];
    return item ? el("span", "mark" + (extra ? " " + extra : "") + " " + item.kind, item.text) : null;
  };

  // ── 固定种子的伪随机数（mulberry32）──
  function random(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 影子画进 canvas、转成 <img> 垫在下面（照 best：没有显卡的服务器上 drop-shadow 太慢；canvas 元素直接放进页面会缺块）
  async function shadowImage(img, width, height, res, draw) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * res);
    canvas.height = Math.ceil(height * res);
    const ctx = canvas.getContext("2d");
    ctx.res = res;
    draw(ctx);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    Object.assign(img.style, { width: width + "px", height: height + "px" });
    img.src = URL.createObjectURL(blob);
    await img.decode();
  }

  // 陶砖是圆角矩形，影子也画圆角矩形
  function castShadow(ctx, boxes, { blur, color, radius }) {
    const res = ctx.res;
    ctx.save();
    ctx.filter = "blur(" + (blur / 2 * res).toFixed(2) + "px)";
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const { x, y, width, height } of boxes) ctx.roundRect(x * res, y * res, width * res, height * res, radius * res);
    ctx.fill();
    ctx.restore();
  }

  // 釉面底下的细颗粒（--grain）先画成位图再当背景（照 best 的 bakeTextures）
  async function bakeGrain() {
    const root = document.documentElement;
    const svg = (getComputedStyle(root).getPropertyValue("--grain").match(/url\((["']?)(data:image\/svg\+xml.*)\1\)/) || [])[2];
    if (!svg) return;
    const img = new Image();
    img.src = svg;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.round(220 * (window.devicePixelRatio || 1));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const url = URL.createObjectURL(blob);
    root.style.setProperty("--grain", "url(\"" + url + "\")");
    await ThemeKit.preload([url]);
  }

  function waxEdge(rnd) {
    const points = [];
    const n = 30;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const r = 46 + rnd() * 4 + (rnd() < 0.18 ? 2.5 : 0);
      points.push((50 + Math.cos(angle) * r).toFixed(1) + "% " + (50 + Math.sin(angle) * r).toFixed(1) + "%");
    }
    return "polygon(" + points.join(",") + ")";
  }

  function cutout(src, [width, height], [sx, sy, sw, sh], className) {
    const img = el("img", className);
    img.alt = "";
    img.src = src;
    img.style.setProperty("object-view-box", `inset(${sy}px ${width - sx - sw}px ${height - sy - sh}px ${sx}px)`);
    img.addEventListener("error", () => img.remove(), { once: true });
    return img;
  }

  // ── 画框（assets/frame.webp：荷兰国立博物馆 BK-1959-55 彩绘锡釉陶镜框，抠掉背景、拉成了正矩形，做法见 ../assets/README.md）──
  // 跟 chart 主题的代尔夫特陶框是同一类东西，拼法照搬（那边改了这边也看看）：
  // - 四条边各自铺满整条，在角上按 45° 斜切；角上盖一片茛苕叶，盖住斜接缝。
  // - 上下两条边：拿它自己那一段，从正中往两头一正一反（左右镜像）排开，接缝两边是同一列像素，对得上。
  // - 左右两条边不能上下镜像（鸟会倒过来）：左边框的一段接右边框左右翻过来的一段，轮流排，接缝处淡入淡出。
  // - 角叶跟 chart 的不一样：这个框的叶子又大又亮，照 chart 那样按斜线留一条带子，叶子两边会透出底下铺的花，像重影。
  //   所以叶子单独抠成了 frame-leaves.webp（跟 frame.webp 一样大、坐标通用，别处全透明），整片盖上去。
  // 作者 2026-10-20 嫌原样的框太粗：整个框等比缩小（scale），框条细了、花纹不变形；外沿一圈釉面磕掉的浅色碎口裁掉。
  // 坐标是在 frame.webp（1546×1695）上量的像素。
  const FRAME = {
    src: "../assets/frame.webp",
    leaves: "../assets/frame-leaves.webp",
    size: [1546, 1695],
    scale: 0.38,                                                      // 框宽 270 → 100 左右
    outer: { left: 44, top: 44, right: 1502, bottom: 1650 },          // 外沿：比量出来的（31、1515、31、1663）往里收了 12 像素
    opening: { left: 315, top: 312, right: 1236, bottom: 1381 },      // 内口
    // 边上取画面的范围：上下两边离角上的叶子远一点（枕条两头挨着叶子的地方淌着蓝釉，镜像以后成了一对对蓝斑）；左右两边下头那段山石不要
    split: { left: 430, top: 380, right: 1150, bottom: 1280 },
    reach: 70,                                                        // 角叶抠到内口角再往里多少（同 design/leaf-masks.html 的 REACH）
    fade: 30,                                                         // 左右两条边段与段之间淡入淡出多长（CSS 像素）
  };

  const { scale: fk, outer: fo, opening: fop, split: fsp } = FRAME;
  // 每条边只取到内口往里 2 像素
  const frameRect = {
    top: [fsp.left, fo.top, fsp.right - fsp.left, fop.top + 2 - fo.top],
    bottom: [fsp.left, fop.bottom - 2, fsp.right - fsp.left, fo.bottom - fop.bottom + 2],
    left: [fo.left, fsp.top, fop.left + 2 - fo.left, fsp.bottom - fsp.top],
    right: [fop.right - 2, fsp.top, fo.right - fop.right + 2, fsp.bottom - fsp.top],
  };
  const frameBand = { top: frameRect.top[3] * fk, bottom: frameRect.bottom[3] * fk, left: frameRect.left[2] * fk, right: frameRect.right[2] * fk };
  const frameInner = { left: (fop.left - fo.left) * fk, right: (fo.right - fop.right) * fk, top: (fop.top - fo.top) * fk, bottom: (fo.bottom - fop.bottom) * fk };
  const half = (v) => Math.round(v * 2) / 2;
  const px = (v) => v + "px";

  // 页面四边留给画框的宽度：画面往框底下多塞 4 像素
  function framePadding() {
    return Object.fromEntries(Object.entries(frameInner).map(([side, value]) => [side, Math.floor(value) - 4]));
  }

  function drawFrame(W, H) {
    const box = $("frame");
    const holder = (x, y, w, h, clip) => {
      const node = el("div", "frame-run");
      Object.assign(node.style, { left: px(x), top: px(y), width: px(w), height: px(h), clipPath: `polygon(${clip})` });
      box.append(node);
      return node;
    };

    // 上下两条边：从正中往两头一正一反排，铺满整条（两头在角上被斜切）
    const mirrorRun = (node, source, length, thickness) => {
      const piece = half(source[2] * fk);
      const start = (length - piece) / 2;
      const count = Math.ceil(start / piece) + 1;
      for (let k = -count; k <= count; k++) {
        const offset = half(start + k * piece);
        if (offset >= length || offset + piece <= 0) continue;
        const img = cutout(FRAME.src, FRAME.size, source);
        // 每段往后多盖 1 像素，段边落在像素中间时不透出细缝
        Object.assign(img.style, { left: px(offset), top: "0px", width: px(piece + 1), height: px(thickness), transform: k % 2 ? "scaleX(-1)" : "" });
        node.append(img);
      }
    };

    // 左右两条边：本边的一段、对边左右翻过来的一段轮流往下排，后一段的上端淡入，盖住接缝
    const blendRun = (node, own, other, length, thickness) => {
      const piece = own[3] * fk;
      const fade = FRAME.fade;
      const step = piece - fade;
      const count = Math.ceil((length + fade) / step) + 1;
      const start = (length - (count * step + fade)) / 2;
      for (let k = 0; k < count; k++) {
        const img = cutout(FRAME.src, FRAME.size, k % 2 ? other : own);
        Object.assign(img.style, { left: "0px", top: px(half(start + k * step)), width: px(thickness), height: px(piece), transform: k % 2 ? "scaleX(-1)" : "" });
        if (k > 0) img.style.maskImage = `linear-gradient(to bottom, transparent 0, #000 ${fade}px)`;
        node.append(img);
      }
    };

    const b = frameBand;
    mirrorRun(holder(0, 0, W, b.top, `0 0, ${W}px 0, ${W - b.right}px 100%, ${b.left}px 100%`), frameRect.top, W, b.top);
    mirrorRun(holder(0, H - b.bottom, W, b.bottom, `${b.left}px 0, ${W - b.right}px 0, ${W}px 100%, 0 100%`), frameRect.bottom, W, b.bottom);
    blendRun(holder(0, 0, b.left, H, `0 0, 100% ${b.top}px, 100% ${H - b.bottom}px, 0 ${H}px`), frameRect.left, frameRect.right, H, b.left);
    blendRun(holder(W - b.right, 0, b.right, H, `0 ${b.top}px, 100% 0, 100% ${H}px, 0 ${H - b.bottom}px`), frameRect.right, frameRect.left, H, b.right);

    // 四个角：抠好的叶子（连着角上一截线脚）整片盖上去，从外沿一直到内口角往里 reach 像素
    const corner = (source, x, y) => {
      const img = cutout(FRAME.leaves, FRAME.size, source);
      Object.assign(img.style, { left: px(x), top: px(y), width: px(source[2] * fk), height: px(source[3] * fk) });
      box.append(img);
    };
    const reach = FRAME.reach;
    const cw = { left: fop.left + reach - fo.left, right: fo.right - (fop.right - reach) };
    const ch = { top: fop.top + reach - fo.top, bottom: fo.bottom - (fop.bottom - reach) };
    corner([fo.left, fo.top, cw.left, ch.top], 0, 0);
    corner([fop.right - reach, fo.top, cw.right, ch.top], W - cw.right * fk, 0);
    corner([fo.left, fop.bottom - reach, cw.left, ch.bottom], 0, H - ch.bottom * fk);
    corner([fop.right - reach, fop.bottom - reach, cw.right, ch.bottom], W - cw.right * fk, H - ch.bottom * fk);
  }

  // ── 页眉右边：名牌版、角色、Rating（照 best）──
  function stat(label, value, extra) {
    const box = el("div", "stat" + (extra ? " " + extra : ""));
    box.append(el("dt", null, label), el("dd", null, value));
    return box;
  }

  function renderHead(mode) {
    const player = data.player || {};
    if (player.plate) $("plate-img").src = player.plate;
    else $("plate").classList.add("empty");
    if (player.trophy && player.trophy.name) {
      const trophy = $("trophy");
      trophy.classList.add(player.trophy.color || "normal");
      trophy.append(el("span", null, player.trophy.name));
    } else {
      $("trophy").remove();
    }
    const level = $("level");
    if (player.reborn) level.append(el("span", "star", "★" + player.reborn));
    if (player.level !== null && player.level !== undefined) level.append(el("span", "lv", "Lv."), el("span", null, player.level));
    $("name").textContent = player.name || "";
    if (player.character) $("chara").src = player.character;
    else document.querySelector(".medallion").classList.add("empty");

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

    const stats = $("stats");
    const chapters = data.chapters || [];
    if (mode === "fit30") {
      const list = chapters[0]?.scores || [];
      stats.append(stat("拟合 B30", rating(data.rating), "main tier-" + ThemeKit.ratingTier(data.rating)));
      stats.append(stat("Top", list.length ? rating(list[0].rating) : "—"));
      stats.append(stat("原 B30", rating(data.fit?.officialAverage)));
      return;
    }
    const main = mode === "aj50"
      ? stat("AJ 50", rating(data.rating), "main tier-" + ThemeKit.ratingTier(data.rating))
      : stat("Rating", rating(player.rating), "main tier-" + ThemeKit.ratingTier(player.rating));
    stats.append(main);
    if (mode === "b50" || mode === "aj50") {
      for (const chapter of chapters) {
        const fresh = chapter.key === "new";
        const label = mode === "aj50" ? (fresh ? "AJ 20" : "AJ 30") : (fresh ? "New 20" : "Best 30");
        stats.append(stat(label, rating(chapter.average)));
      }
    } else if (chapters[0]) {
      const list = chapters[0].scores;
      stats.append(stat(mode === "aj30" ? "AJ 30" : "Best 30", rating(chapters[0].average)));
      stats.append(stat("Top", list.length ? rating(list[0].rating) : "—"));
    }
  }

  // ── 页眉左边：柱状图（照 best：每一栏自己的纵轴，旧曲刻度在左、新曲在右；旧曲金色、新曲换成她的蓝）──
  function niceAxis(low, high) {
    if (!(high > low)) { low -= 0.1; high += 0.1; }
    const step = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find((s) => (high - low) / s <= 5) || 5;
    const bottom = Math.floor((low - step * 0.5) / step) * step;
    const top = Math.ceil(high / step - 1e-9) * step;
    const ticks = [];
    for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
    const decimals = Number.isInteger(step) ? 0 : Number.isInteger(Math.round(step * 1000) / 100) ? 1 : 2;
    return { bottom, top, ticks, decimals };
  }

  function drawChart(svg, mode) {
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    // 底是白的（她制服的白），柱子顶上的浅色比 best 压深一点，不然跟底混在一起
    svg.innerHTML = `<defs>
      <linearGradient id="bar-old" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f3d68a"/><stop offset="0.3" stop-color="#d4a34b"/><stop offset="1" stop-color="#875a1c"/>
      </linearGradient>
      <linearGradient id="bar-new" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#bcdcfa"/><stop offset="0.3" stop-color="#5797de"/><stop offset="1" stop-color="#1f4796"/>
      </linearGradient>
    </defs>`;
    const groups = (data.chapters || []).map((chapter) => ({
      slots: chapter.slots || (chapter.scores || []).length,
      average: Number(chapter.average) || 0,
      bars: (chapter.scores || []).map((score) => ({
        value: Number(score.rating) || 0,
        fresh: chapter.key === "new" || ((mode === "b30" || mode === "aj30") && Boolean(score.isNew)),
      })),
    }));
    const values = groups.flatMap((group) => group.bars.map((bar) => bar.value));
    if (!values.length) {
      svgEl("text", { x: width / 2, y: height / 2, class: "empty" }, svg).textContent = "还没有成绩";
      return;
    }
    const pad = { left: 74, right: groups.length > 1 ? 74 : 14, top: 36, bottom: 36 };
    const base = height - pad.bottom;
    const gap = groups.length > 1 ? 2 : 0;
    const total = groups.reduce((n, group) => n + group.slots, 0) + gap * (groups.length - 1);
    const slot = (width - pad.left - pad.right) / total;
    const barWidth = Math.max(3, slot * 0.62);
    const grid = svgEl("g", { class: "grid-lines" }, svg);
    const bars = svgEl("g", { class: "bars" }, svg);
    const notes = svgEl("g", { class: "notes" }, svg);
    let start = pad.left;
    for (const [index, group] of groups.entries()) {
      const end = start + group.slots * slot;
      if (group.bars.length) {
        const own = group.bars.map((bar) => bar.value);
        const axis = niceAxis(Math.min(...own), Math.max(...own));
        const yOf = (v) => base - (v - axis.bottom) / (axis.top - axis.bottom) * (base - pad.top);
        const onRight = index > 0;
        for (const tick of axis.ticks) {
          const y = yOf(tick).toFixed(1);
          svgEl("line", { x1: start.toFixed(1), x2: end.toFixed(1), y1: y, y2: y }, grid);
          svgEl("text", { x: (onRight ? end + 10 : start - 10).toFixed(1), y, class: "tick" + (onRight ? " right" : "") }, grid).textContent = tick.toFixed(axis.decimals);
        }
        group.bars.forEach((bar, i) => {
          const x = start + i * slot + (slot - barWidth) / 2;
          const y = Math.min(yOf(bar.value), base - 2);
          svgEl("rect", { x: x.toFixed(1), y: y.toFixed(1), width: barWidth.toFixed(1), height: (base - y).toFixed(1), fill: bar.fresh ? "url(#bar-new)" : "url(#bar-old)" }, bars);
        });
        const y = Math.max(pad.top, Math.min(base, yOf(group.average)));
        svgEl("line", { x1: start.toFixed(1), x2: end.toFixed(1), y1: y.toFixed(1), y2: y.toFixed(1), class: "average" }, notes);
        svgEl("text", { x: (end - 2).toFixed(1), y: (y - 7).toFixed(1), class: "average-label" }, notes).textContent = "均值 " + rating(group.average);
      }
      for (let i = 0; i < group.slots; i++) {
        if (i === 0 || (i + 1) % 5 === 0) {
          svgEl("text", { x: (start + (i + 0.5) * slot).toFixed(1), y: base + 27, class: "rank" }, notes).textContent = String(i + 1);
        }
      }
      svgEl("line", { x1: start.toFixed(1), x2: end.toFixed(1), y1: base, y2: base, class: "baseline" }, notes);
      start = end + gap * slot;
    }
  }

  function renderChart(mode) {
    const name = mode === "b50" ? "Best 50" : mode === "aj50" ? "AJ 50" : mode === "aj30" ? "AJ 30" : mode === "fit30" ? "Fit 30" : "Best 30";
    $("chart-title").append(el("b", null, name), el("span", null, mode === "fit30" ? "按拟合定数重算" : "单曲 Rating"));
    const chapters = data.chapters || [];
    const hasNew = chapters.some((chapter) => chapter.key === "new" ? chapter.scores.length : chapter.scores.some((score) => score.isNew));
    const legend = $("chart-legend");
    if (mode === "fit30") {
      legend.append(el("i", "swatch old"), "全曲");
      return;
    }
    legend.append(el("i", "swatch old"), "旧曲");
    if (hasNew) legend.append(el("i", "swatch new"), "新曲");
  }

  // ── 卡片（内容、位置照 best；纸换成一块白釉陶砖）──
  function card(score, index, chapterKey, mode) {
    const rnd = random((chapterKey.charCodeAt(0) << 8) + index * 977 + 13);
    const item = el("li", "card d" + score.levelIndex);
    item.style.setProperty("--gx", -Math.round(rnd() * 200) + "px");
    item.style.setProperty("--gy", -Math.round(rnd() * 200) + "px");
    item.append(el("div", "tile"));

    const jacket = el("figure", "jacket");
    const img = el("img");
    img.alt = "";
    if (score.jacket) img.src = score.jacket;
    else jacket.classList.add("missing");
    img.addEventListener("error", () => jacket.classList.add("missing"), { once: true });
    jacket.append(img, el("div", "band", LEVELS[score.levelIndex] || ""));
    item.append(jacket, el("span", "idx", index + 1));
    if ((mode === "b30" || mode === "aj30") && score.isNew) item.append(el("span", "new-tag", "New"));

    const seal = el("div", "seal " + (SEALED.has(score.rank) ? score.rank : "low"));
    const wax = el("div", "wax");
    wax.style.clipPath = waxEdge(rnd);
    seal.append(wax, el("span", null, RANK_TEXT[score.rank] || String(score.rank || "").toUpperCase()));
    item.append(seal);

    const body = el("div", "body");
    const title = el("div", "title-line", score.title);
    title.lang = /[぀-ヿ]/.test(score.title) ? "ja" : "zh-CN";
    if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(score.title)) title.classList.add("greek");
    const marks = el("div", "marks");
    for (const mark of [markOf(score.fullCombo), markOf(score.clear, "tag"), markOf(score.fullChain)]) if (mark) marks.append(mark);
    const constant = el("span", "const" + (score.constantText ? " fit" : ""),
      score.constantText || (score.constant ? ThemeKit.format.constant(score.constant) : score.level || ""));
    constant.append(el("i", null, "›"));
    const foot = el("div", "foot");
    foot.append(constant, el("span", "rating", rating(score.rating)));
    body.append(title, el("div", "score", ThemeKit.format.score(score.score)), foot, marks);
    item.append(body);
    return item;
  }

  function emptyCard(index) {
    const item = el("li", "card empty");
    item.append(el("div", "tile"), el("div", "void", "— " + (index + 1) + " —"));
    return item;
  }

  function drawCardShadows(canvas) {
    const origin = canvas.getBoundingClientRect();
    const boxes = [];
    for (const node of document.querySelectorAll(".card:not(.empty) .tile")) {
      const box = node.getBoundingClientRect();
      boxes.push({ x: box.left - origin.left, y: box.top - origin.top + 5, width: box.width, height: box.height });
    }
    return shadowImage($("card-shadows"), canvas.offsetWidth, canvas.offsetHeight, 0.5,
      (ctx) => castShadow(ctx, boxes, { blur: 8, color: "rgba(6, 16, 52, 0.55)", radius: 6 }));
  }

  // ── 两张表（/b30 一张）──
  function renderTables(mode) {
    const box = $("tables");
    const chapters = data.chapters || [];
    const wide = chapters.length === 1;
    const panelWidth = (cols) => cols * SIZE.card + (cols - 1) * SIZE.gapX + SIZE.panelPad * 2 + SIZE.panelBorder * 2;
    for (const chapter of chapters) {
      const key = mode === "aj50" ? (chapter.key === "new" ? "ajnew" : "ajold") : chapter.key;
      const words = CHAPTERS[key] || CHAPTERS.all;
      const cols = wide ? 5 : chapter.key === "new" ? 2 : 3;
      const panel = el("section", "panel" + (wide ? " wide" : ""));
      panel.style.setProperty("--cols", cols);
      // 一张表时撑满两张表的宽度（三列 + 两列 + 中间的空）
      panel.style.width = (wide ? panelWidth(3) + SIZE.tableGap + panelWidth(2) : panelWidth(cols)) + "px";
      const head = el("header", "panel-head");
      const count = el("span", "count");
      count.append(el("b", null, (chapter.scores || []).length + " / " + chapter.slots), "首");
      head.append(el("span", "en", words.en), el("span", "zh", words.side), count);
      const grid = el("ol", "grid");
      const scores = chapter.scores || [];
      for (let i = 0; i < chapter.slots; i++) grid.append(scores[i] ? card(scores[i], i, chapter.key, mode) : emptyCard(i));
      panel.append(head, grid);
      box.append(panel);
    }
  }

  // ── 排版收尾（照 best 的 fitText）──
  function shrinkToFit(node, { min, step = 0.5, fits }) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (!fits() && size > min) {
      size -= step;
      node.style.fontSize = size + "px";
    }
  }

  function fitText() {
    const fitsWidth = (node) => () => node.scrollWidth <= node.clientWidth + 1;
    for (const title of document.querySelectorAll(".title-line")) {
      shrinkToFit(title, { min: title.classList.contains("greek") ? 46 : 23, fits: fitsWidth(title) });
    }
    for (const score of document.querySelectorAll(".score")) shrinkToFit(score, { min: 18, fits: fitsWidth(score) });
    for (const foot of document.querySelectorAll(".foot")) {
      const parts = [foot.querySelector(".const"), foot.querySelector(".rating")].map((node) => [node, parseFloat(getComputedStyle(node).fontSize)]);
      for (let ratio = 0.97; foot.scrollWidth > foot.clientWidth + 1 && ratio > 0.7; ratio -= 0.03) {
        for (const [node, size] of parts) node.style.fontSize = (size * ratio).toFixed(2) + "px";
      }
    }
    for (const marks of document.querySelectorAll(".marks")) {
      for (;;) {
        marks.style.fontSize = "";
        shrinkToFit(marks, { min: 16, fits: fitsWidth(marks) });
        if (marks.children.length <= 1 || fitsWidth(marks)()) break;
        marks.lastChild.remove();
      }
    }
    const scale = (inner, outer) => {
      const ratio = outer.clientWidth / inner.scrollWidth;
      if (ratio < 1) inner.style.transform = "scale(" + ratio.toFixed(3) + ")";
    };
    const trophy = document.querySelector(".trophy span");
    if (trophy) scale(trophy, trophy.parentElement);
    const name = $("name");
    const room = name.parentElement.clientWidth - $("level").offsetWidth - 12;
    if (name.scrollWidth > room) name.style.transform = "scale(" + (room / name.scrollWidth).toFixed(3) + ")";
  }

  // 画布（画框里的画面）的大小：高度跟着正文（页眉 + 表）走，宽度先照油画原图的比例（作者 2026-10-20 要的），
  // 再让表右边留给朱娜的宽度落在 SIZE.minColumn～maxColumn 之间：/b30 正文矮，画面加宽，油画按 cover 上下裁掉一点；
  // /b50 照比例太宽，画面收窄，油画左右裁掉一点（裁多少由 theme.css 里 .painting 的 object-position 分到两边）。
  // 朱娜在表右边那一块里上下左右都居中，按画面高度放大（不超过原图的 SIZE.sibylMaxScale 倍），上下至少留 SIZE.sibylMargin。
  // 整张图的宽高取偶数：按 1.5 倍出图时，奇数的 CSS 像素会变成半个像素
  function placeCanvas(pad) {
    const canvas = $("canvas");
    const layout = $("layout");
    const even = (value, extra) => { const n = Math.ceil(value); return (n + extra) % 2 ? n + 1 : n; };
    const height = even(layout.offsetHeight, pad.top + pad.bottom);
    const column = Math.min(Math.max(height * SIZE.ratio - layout.offsetWidth, SIZE.minColumn), SIZE.maxColumn);
    const width = even(layout.offsetWidth + column, pad.left + pad.right);
    Object.assign(canvas.style, { width: width + "px", height: height + "px" });

    const [w0, h0] = SIZE.sibyl;
    const sibylHeight = Math.min(height - SIZE.sibylMargin * 2, h0 * SIZE.sibylMaxScale);
    const sibylWidth = sibylHeight * w0 / h0;
    const center = (layout.offsetWidth + width) / 2;
    Object.assign($("sibyl").style, {
      height: sibylHeight.toFixed(1) + "px",
      width: sibylWidth.toFixed(1) + "px",
      left: (center - sibylWidth * SIZE.sibylCenter).toFixed(1) + "px",
      top: ((height - sibylHeight) / 2).toFixed(1) + "px",
    });
  }

  async function main() {
    const mode = ["b50", "aj30", "aj50", "fit30"].includes(data.mode) ? data.mode : "b30";
    document.body.classList.add("mode-" + mode);
    // 背景、立绘是自己准备的素材（不进仓库），缺了也照样出图
    for (const img of [$("painting"), $("sibyl")]) img.addEventListener("error", () => { img.style.visibility = "hidden"; }, { once: true });

    const grain = bakeGrain().catch(() => {});
    const page = $("page");
    const pad = framePadding();
    page.style.padding = `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
    renderHead(mode);
    renderChart(mode);
    renderTables(mode);
    $("credit").textContent = ["Generated by Anna Bot", "数据来自落雪查分器", data.time].filter(Boolean).join(" · ");

    void document.body.offsetHeight;
    await Promise.all(["16px \"Anna Hand\"", "700 16px \"Anna Hand Bold\"", "700 16px \"Anna Script\"", "700 16px \"Anna Script Heavy\""]
      .map((font) => document.fonts.load(font).catch(() => null)));
    await document.fonts.ready;
    fitText();
    drawChart($("chart"), mode);
    placeCanvas(pad);
    const shadows = drawCardShadows($("canvas"));
    drawFrame(page.offsetWidth, page.offsetHeight);
    await Promise.all([grain, shadows]);
    ThemeKit.done({ element: page });
  }

  main().catch(ThemeKit.fail);
})();
