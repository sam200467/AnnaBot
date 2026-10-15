// B30 / B50 成绩图。数据由 src/features/best.cjs 的 buildData 给出，形状见 ../examples/preview-data.json。
// 撕边、封蜡、余烬这些「随机」的东西都用固定种子的伪随机数生成：同一份数据每次出图都一模一样。
(function () {
  "use strict";
  const data = ThemeKit.data();
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";

  const CHAPTERS = {
    old: { zh: "旧曲", en: "Best 30", side: "旧版本曲目" },
    new: { zh: "新曲", en: "New 20", side: "当前版本新曲" },
    all: { zh: "全曲", en: "Best 30", side: "不分新旧" },
  };
  const LEVELS = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "ULTIMA", "WORLD'S END"];
  const RANK_TEXT = { sssp: "SSS+", sss: "SSS", ssp: "SS+", ss: "SS", sp: "S+", s: "S", aaa: "AAA", aa: "AA", a: "A", bbb: "BBB", bb: "BB", b: "B", c: "C", d: "D" };
  // 这几档有自己的蜡色，其余（AAA 往下）一律灰褐
  const SEALED = new Set(["sssp", "sss", "ssp", "ss", "sp", "s"]);
  const FULL_COMBO = { fullcombo: ["FC", "fc"], alljustice: ["AJ", "aj"], alljusticecritical: ["AJC", "ajc"] };
  const CLEARS = { hard: "HARD", brave: "BRAVE", absolute: "ABSOLUTE", catastrophy: "CATASTROPHY" };

  const rating = ThemeKit.format.rating;
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

  // 撕开的纸边：沿四条边走一圈，每一步往里咬一点。低频起伏 + 高频锯齿 + 偶尔一个缺口。
  function tornEdge(width, height, rnd, { step = 7, depth = 3, wave = 0, bite = 0 } = {}) {
    const points = [];
    const smooth = () => {
      const knots = Array.from({ length: 12 }, () => rnd());
      return (t) => {
        const x = t * (knots.length - 1);
        const i = Math.min(knots.length - 2, Math.floor(x));
        const f = x - i;
        const s = f * f * (3 - 2 * f);
        return knots[i] * (1 - s) + knots[i + 1] * s;
      };
    };
    const edge = (length, put) => {
      const low = smooth();
      for (let d = 0; d < length; d += step * (0.55 + rnd() * 0.9)) {
        let inward = rnd() * depth + low(d / length) * wave;
        if (bite && rnd() < bite) inward += depth * (1.5 + rnd() * 2);
        put(d, inward);
      }
    };
    edge(width, (d, k) => points.push([d, k]));
    edge(height, (d, k) => points.push([width - k, d]));
    edge(width, (d, k) => points.push([width - d, height - k]));
    edge(height, (d, k) => points.push([k, height - d]));
    return "polygon(" + points.map(([x, y]) => x.toFixed(1) + "px " + y.toFixed(1) + "px").join(",") + ")";
  }

  // 封蜡：圆周上的点半径忽大忽小，像蜡滴下来压扁的边
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

  // ── 装饰线（SVG）：章节名、格言两边，一条线收进一个卷 ──
  const ORNAMENTS = {
    tail: `<svg viewBox="0 0 300 26" fill="none" stroke="currentColor" stroke-linecap="round">
      <defs><linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset="0.25" stop-color="currentColor"/></linearGradient></defs>
      <path d="M0 13 H232" stroke="url(#fade)" stroke-width="1.3"/>
      <path d="M40 17.5 H222" stroke="url(#fade)" stroke-width="0.6" opacity="0.7"/>
      <path d="M232 13 C246 13 250 4 260 4 C269 4 271 12 265 14.5 C260 16.5 256 11 260 9" stroke-width="1.3"/>
      <path d="M260 4 C267 0 276 3 278 9" stroke-width="0.9"/>
      <path d="M284 13 L290 7 L296 13 L290 19 Z" fill="currentColor" stroke="none"/>
    </svg>`,
  };

  // 同一个 SVG 片段在页面里放好几份时，里面的 id（渐变、<use>、textPath 引用的）要改成各不相同
  let idCount = 0;
  function uniqueIds(svg) {
    const suffix = "-" + (++idCount);
    for (const target of svg.querySelectorAll("[id]")) {
      const id = target.id;
      target.id = id + suffix;
      for (const ref of svg.querySelectorAll("*")) {
        for (const attr of ["href", "fill", "stroke"]) {
          const value = ref.getAttribute(attr);
          if (value === "#" + id) ref.setAttribute(attr, "#" + id + suffix);
          else if (value === "url(#" + id + ")") ref.setAttribute(attr, "url(#" + id + suffix + ")");
        }
      }
    }
    return svg;
  }

  function ornament(node, name) {
    node.innerHTML = ORNAMENTS[name];
    uniqueIds(node.querySelector("svg"));
  }

  // 缎带横幅（借了 Lanota 章节封面的缎带）：中间一条微微拱起的带子，两头折到后面、剪成燕尾。文字沿弧线走。
  function ribbon(text, className) {
    const holder = el("div", className);
    holder.innerHTML = `<svg viewBox="0 0 420 80" aria-hidden="true">
      <defs>
        <linearGradient id="rb-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e6d3ab"/><stop offset="0.55" stop-color="#cbb083"/><stop offset="1" stop-color="#a98a5c"/>
        </linearGradient>
        <linearGradient id="rb-tail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#b09066"/><stop offset="1" stop-color="#76593a"/>
        </linearGradient>
      </defs>
      <g stroke="#2e1a0c" stroke-width="1.6" stroke-linejoin="round">
        <path d="M4 26 H70 V70 H4 L22 48 Z" fill="url(#rb-tail)"/>
        <path d="M416 26 H350 V70 H416 L398 48 Z" fill="url(#rb-tail)"/>
        <path d="M52 60 L70 70 V60 Z" fill="#4a2e18"/>
        <path d="M368 60 L350 70 V60 Z" fill="#4a2e18"/>
        <path d="M52 14 Q210 0 368 14 V60 Q210 46 52 60 Z" fill="url(#rb-face)"/>
      </g>
      <g fill="none" stroke="#7d5f3b" stroke-width="0.8" opacity="0.75">
        <path d="M60 19.5 Q210 6 360 19.5"/>
        <path d="M60 54.5 Q210 41 360 54.5"/>
      </g>
      <path id="rb-text" d="M70 47 Q210 33 350 47" fill="none"/>
      <text><textPath href="#rb-text" startOffset="50%" text-anchor="middle"></textPath></text>
    </svg>`;
    holder.querySelector("textPath").textContent = text;
    uniqueIds(holder.querySelector("svg"));
    return holder;
  }

  // 从一张大图上取一块（原图像素 [x, y, 宽, 高]）显示成 <img>：object-view-box 裁，object-fit: fill 拉到元素的大小。
  // 用 <img> 而不是 CSS 背景或 SVG：ThemeKit.done 只等 <img> 加载完。图缺了这块就不画
  function cutout(src, [width, height], [sx, sy, sw, sh], className) {
    const img = el("img", className);
    img.alt = "";
    img.src = src;
    img.style.setProperty("object-view-box", `inset(${sy}px ${width - sx - sw}px ${height - sy - sh}px ${sx}px)`);
    img.addEventListener("error", () => img.remove(), { once: true });
    return img;
  }

  // ── 画框（assets/frame.png：作者给的洛可可金框照片，白底抠成了透明）──
  // 原图框的比例跟成绩图差太远，没法整张缩放：四个角、每条边中间的雕花原样缩小贴上去，
  // 边上平直的线脚取原图里一段没有雕花的（120 像素长），一正一反交替铺满 —— 只拿一行像素拉长的话，
  // 剩下的全是规整的条纹，看着像电脑画的；交替翻转让每段接缝两边的明暗对得上。
  // 上下两条边原图里全是雕花、没有平直段，就拿左右两边的线脚转 90°。雕花两头渐隐，叠在线脚上看不出接缝。
  // 下面的坐标都是在原图（1271×1920）上量的像素。
  const FRAME = {
    src: "../assets/frame.png",
    size: [1271, 1920],
    scale: 0.54,      // 原图的线脚 155 像素宽，缩到 84 左右（作者嫌原图的边太宽）
    margin: 30,       // 角花、雕花伸出线脚外沿最多 29 像素：页面四周留这么宽，伸出去的部分不被裁掉
    plain: { left: 220, top: 386, right: 1079, bottom: 1542 },      // 平直线脚的外沿
    opening: { left: 374, top: 541, right: 929, bottom: 1391 },     // 内口
    section: { left: [199, 650, 175, 120], right: [929, 650, 172, 120] },
    corners: { tl: [196, 355, 240, 300], tr: [860, 355, 241, 300], bl: [196, 1300, 240, 276], br: [860, 1300, 241, 276] },
    middles: { left: [196, 815, 178, 310], right: [929, 815, 172, 310], top: [445, 355, 410, 186], bottom: [445, 1391, 410, 184] },
  };

  // 页面四边留多宽给画框：到内口为止，再往里 2 像素让框压住羊皮纸的边，不留缝
  function framePadding() {
    const { scale: s, margin: m, plain: p, opening: o } = FRAME;
    const inset = { top: (o.top - p.top + m) * s, right: (p.right + m - o.right) * s, bottom: (p.bottom + m - o.bottom) * s, left: (o.left - p.left + m) * s };
    return Object.fromEntries(Object.entries(inset).map(([side, value]) => [side, Math.floor(value) - 2]));
  }

  function drawFrame(page) {
    const box = $("gilt");
    const W = page.offsetWidth;
    const H = page.offsetHeight;
    const { scale: s, margin: m, plain: p, opening: o, section, corners: c, middles } = FRAME;
    // 原图坐标 → 页面坐标，四条边各按自己那一侧的线脚外沿对齐
    const left = (sx) => (sx - p.left + m) * s;
    const right = (sx) => W - (p.right + m - sx) * s;
    const top = (sy) => (sy - p.top + m) * s;
    const bottom = (sy) => H - (p.bottom + m - sy) * s;
    const put = (rect, x, y, w, h, className) => {
      const img = cutout(FRAME.src, FRAME.size, rect, "gilt " + (className || ""));
      Object.assign(img.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      box.append(img);
    };
    const span = (rect) => [rect[2] * s, rect[3] * s];

    // 平直线脚：竖着的一条，长 length，一段一段交替翻转着铺。rotate 给了就整条转过去当横边用。
    // 每段的长度和位置都取到半像素（两倍出图时正好是整像素），后一段再往前多盖 1.5 像素：
    // 段边落在像素中间时两边各画半透明的一行，叠起来透出一条细黑线（2026-10-14 出图时看到的）
    const half = (v) => Math.round(v * 2) / 2;
    const run = (rect, x, y, length, rotate) => {
      const thickness = rect[2] * s;
      const piece = half(rect[3] * s);
      const holder = el("div", "gilt-run");
      Object.assign(holder.style, { left: x + "px", top: y + "px", width: thickness + "px", height: length + "px", transform: rotate || "" });
      for (let i = 0; i * piece < length; i++) {
        const img = cutout(FRAME.src, FRAME.size, rect, "gilt" + (i % 2 ? " flip" : ""));
        Object.assign(img.style, { left: "0px", top: i * piece + "px", width: thickness + "px", height: piece + 1.5 + "px" });
        holder.append(img);
      }
      box.append(holder);
    };
    // 线脚两头都收在角花底下（角花一半的位置），不从角花外面露出来
    const y0 = half(top(c.tl[1]) + c.tl[3] * s * 0.55);
    const y1 = half(bottom(c.bl[1]) + c.bl[3] * s * 0.45);
    const x0 = half(left(c.tl[0]) + c.tl[2] * s * 0.55);
    const x1 = half(right(c.tr[0]) + c.tr[2] * s * 0.45);
    run(section.left, left(section.left[0]), y0, y1 - y0);
    run(section.right, right(section.right[0]), y0, y1 - y0);
    // 上边用左边的线脚、下边用右边的，都顺时针转 90°：竖条的左边转到上面（上边外沿朝上，下边内口朝上）
    run(section.left, 0, 0, x1 - x0, `translate(${x1}px, ${top(p.top) - (p.left - section.left[0]) * s}px) rotate(90deg)`);
    run(section.right, 0, 0, x1 - x0, `translate(${x1}px, ${bottom(o.bottom)}px) rotate(90deg)`);

    // 边中间的雕花：上下各一处；左右在 B50 这种长图上放三处，不然中间的平直段太长
    const [tw, th] = span(middles.top);
    const [bw, bh] = span(middles.bottom);
    put(middles.top, (W - tw) / 2, top(middles.top[1]), tw, th, "fade-x");
    put(middles.bottom, (W - bw) / 2, bottom(middles.bottom[1]), bw, bh, "fade-x");
    const from = top(c.tl[1] + c.tl[3]);
    const to = bottom(c.bl[1]);
    const count = to - from > 2000 ? 3 : 1;
    const [lw, lh] = span(middles.left);
    const [rw, rh] = span(middles.right);
    for (let i = 0; i < count; i++) {
      const cy = from + (to - from) * (i + 0.5) / count;
      put(middles.left, left(middles.left[0]), cy - lh / 2, lw, lh, "fade-y");
      put(middles.right, right(middles.right[0]), cy - rh / 2, rw, rh, "fade-y");
    }

    // 四个角压在最上面，往两条边的方向渐隐
    put(c.tl, left(c.tl[0]), top(c.tl[1]), ...span(c.tl), "fade-tl");
    put(c.tr, right(c.tr[0]), top(c.tr[1]), ...span(c.tr), "fade-tr");
    put(c.bl, left(c.bl[0]), bottom(c.bl[1]), ...span(c.bl), "fade-bl");
    put(c.br, right(c.br[0]), bottom(c.br[1]), ...span(c.br), "fade-br");
  }

  // ── 新旧曲交界的一排花饰（assets/ornament.png）──
  // 作者找的金色花饰原本是「花 + 卷草 + 花」，做成了一张「花 | 卷草」并排的图（做法见 assets/README.md），
  // 这里一朵花、一段卷草交替着横铺一整排。卷草两头不对称（离右边那朵花近），一正一反地放，整排才左右对称。
  // 只拿形状当遮罩，颜色是主题自己的金色渐变，跟画框、装饰线一个色。坐标都是这张图上的像素：
  const FRIEZE = {
    src: "../assets/ornament.png",
    size: [1549, 578],
    flower: [0, 0, 568, 578],        // 花在图上的范围 [x, y, 宽, 高]
    scroll: [608, 0, 941, 578],      // 卷草
    flowerCenter: 283.5,             // 花的中心离花左边缘多远
    period: 1438,                    // 原图里两朵花中心的距离
    scrollFrom: 275.5,               // 卷草左边缘在左边那朵花中心的右边多远（反过来放时就是右边缘离右边那朵花）
  };

  function drawFrieze(box) {
    const width = box.clientWidth;
    const { size, flower, scroll, flowerCenter, period, scrollFrom } = FRIEZE;
    // 花的朵数取奇数（卷草成对，一正一反），挑铺满整行时高度最接近 120 的
    let best = null;
    for (let n = 3; n <= 11; n += 2) {
      const scale = width / ((n - 1) * period + flower[2]);
      if (!best || Math.abs(size[1] * scale - 120) < Math.abs(size[1] * best.scale - 120)) best = { n, scale };
    }
    const { n, scale } = best;
    const height = size[1] * scale;
    box.style.height = height.toFixed(1) + "px";
    const piece = (rect, left, flip) => {
      const node = el("div", "frieze-piece" + (flip ? " flip" : ""));
      Object.assign(node.style, { left: left.toFixed(1) + "px", width: (rect[2] * scale).toFixed(1) + "px", height: height.toFixed(1) + "px" });
      const maskSize = (size[0] * scale).toFixed(1) + "px " + height.toFixed(1) + "px";
      const maskPosition = (-rect[0] * scale).toFixed(1) + "px 0px";
      for (const prefix of ["", "-webkit-"]) {
        node.style.setProperty(prefix + "mask-size", maskSize);
        node.style.setProperty(prefix + "mask-position", maskPosition);
      }
      box.append(node);
    };
    for (let k = 0; k < n; k++) {
      const center = (flowerCenter + k * period) * scale;
      piece(flower, center - flowerCenter * scale, false);
      if (k === n - 1) break;
      const flip = k % 2 === 1;
      piece(scroll, flip ? center + (period - scrollFrom - scroll[2]) * scale : center + scrollFrom * scale, flip);
    }
  }

  // ── 法阵：四精灵的符号、八芒星，外圈一行卢恩字母 ──
  // 卢恩文转写的是「SIBYLLA · SPES ANIMAM TENET · ANNA MARGARETE」（希望将灵魂系于肉身 —— 西比拉世界的规矩）
  function drawSigil(svg) {
    const g = svgEl("g", { fill: "none", stroke: "currentColor" }, svg);
    const ring = (r, w) => svgEl("circle", { r, "stroke-width": w }, g);
    ring(292, 2.2); ring(284, 1); ring(248, 1.8); ring(242, 0.9); ring(176, 1.4); ring(120, 1.2); ring(98, 0.9); ring(36, 1.2);

    const at = (r, deg) => [Math.cos((deg - 90) * Math.PI / 180) * r, Math.sin((deg - 90) * Math.PI / 180) * r];
    const poly = (r, degs, w) => svgEl("polygon", { points: degs.map((d) => at(r, d).join(",")).join(" "), "stroke-width": w }, g);
    poly(242, [0, 90, 180, 270], 1.3);
    poly(242, [45, 135, 225, 315], 1.3);
    poly(176, [0, 120, 240], 1);
    poly(176, [60, 180, 300], 1);
    for (let d = 0; d < 360; d += 7.5) {
      const [x1, y1] = at(120, d);
      const [x2, y2] = at(d % 45 === 0 ? 106 : 113, d);
      svgEl("line", { x1, y1, x2, y2, "stroke-width": d % 45 === 0 ? 1.4 : 0.8 }, g);
    }
    for (let d = 0; d < 360; d += 45) {
      const [x1, y1] = at(40, d);
      const [x2, y2] = at(96, d);
      svgEl("line", { x1, y1, x2, y2, "stroke-width": 0.9 }, g);
    }
    // 火 ▲（上）、风 ▲加横（右）、水 ▼（下）、土 ▼加横（左）
    const element = (deg, down, bar) => {
      const [cx, cy] = at(210, deg);
      const s = 17;
      const tip = down ? s : -s;
      svgEl("polygon", { points: `${cx},${cy + tip} ${cx - s * 0.9},${cy - tip * 0.6} ${cx + s * 0.9},${cy - tip * 0.6}`, "stroke-width": 1.6 }, g);
      if (bar) svgEl("line", { x1: cx - s * 0.75, y1: cy + tip * 0.1, x2: cx + s * 0.75, y2: cy + tip * 0.1, "stroke-width": 1.6 }, g);
    };
    element(0, false, false);
    element(90, false, true);
    element(180, true, false);
    element(270, true, true);

    const id = "sigil-ring";
    svgEl("path", { id, d: "M 0 -265 A 265 265 0 1 1 -0.01 -265", fill: "none", stroke: "none" }, svg);
    const words = "ᛋᛁᛒᛁᛚᛚᚨ ᛭ ᛋᛈᛖᛋ ᚨᚾᛁᛗᚨᛗ ᛏᛖᚾᛖᛏ ᛭ ᚨᚾᚾᚨ ᛗᚨᚱᚷᚨᚱᛖᛏᛖ ᛭ ";
    const text = svgEl("text", {}, svg);
    const path = svgEl("textPath", { href: "#" + id, textLength: String(Math.floor(2 * Math.PI * 265) - 8), lengthAdjust: "spacing" }, text);
    path.textContent = words.repeat(3).trim();
  }

  // ── 余烬：页眉撒一层，页脚的火场上再撒一层（往上飘，越往下越密）──
  function scatterEmbers(box, seed, count, rise) {
    const rnd = random(seed);
    for (let i = 0; i < count; i++) {
      const dot = el("i");
      const size = 1.5 + Math.pow(rnd(), 3) * 7;
      const x = rise ? rnd() * 100 : Math.pow(rnd(), 0.6) * 100;
      const y = rise ? 100 - Math.pow(rnd(), 0.7) * 100 : 10 + Math.pow(rnd(), 0.5) * 80;
      Object.assign(dot.style, {
        left: x + "%", top: y + "%", width: size + "px", height: size + "px",
        opacity: (0.25 + rnd() * 0.65).toFixed(2), filter: size > 5 ? "blur(1.2px)" : "none",
      });
      box.append(dot);
    }
  }

  // ── 页眉右边：名牌版、角色、Rating ──
  function ratingTier(value) {
    if (value >= 16) return "tier-rainbow";
    if (value >= 15.25) return "tier-platina";
    if (value >= 14.5) return "tier-gold";
    if (value >= 13.25) return "tier-silver";
    if (value >= 12) return "tier-bronze";
    return "tier-low";
  }

  function stat(label, sub, value, extra) {
    const box = el("div", "stat" + (extra ? " " + extra : ""));
    const dt = el("dt", null, label);
    if (sub) dt.append(el("small", null, sub));
    box.append(dt, el("dd", null, value));
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
    // 照游戏里名牌版的排法：「Lv.」小字，等级数字跟名字差不多大
    const level = $("level");
    if (player.reborn) level.append(el("span", "star", "★" + player.reborn));
    if (player.level !== null && player.level !== undefined) level.append(el("small", null, "Lv."), el("b", null, player.level));
    $("name").textContent = player.name || "";
    if (player.character) $("chara").src = player.character;
    else document.querySelector(".medallion").classList.add("empty");

    // 段位（CLASS 勋章）挂在头像下面：缎带在下、勋章压在上面，跟落雪网页一样叠
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
    stats.append(stat("Rating", null, rating(player.rating), "main " + ratingTier(player.rating)));
    if (mode === "b50") {
      for (const chapter of chapters) stats.append(stat(chapter.key === "new" ? "New 20" : "Best 30", chapter.key === "new" ? "新曲均值" : "旧曲均值", rating(chapter.average)));
    } else if (chapters[0]) {
      const list = chapters[0].scores;
      stats.append(stat("Best 30", "均值", rating(chapters[0].average)));
      stats.append(stat("Top", "第一位", list.length ? rating(list[0].rating) : "—"));
    }
  }

  // ── 页眉左边：柱状图。一根柱子一首歌（单曲 Rating），新曲用火色；虚线是这一栏的均值 ──
  // 纵轴不从 0 开始，而且每一栏用自己的纵轴、按这一栏的分数段收紧：一栏几十首的 Rating 常常只差零点几分，
  // B50 的旧曲和新曲却能差一两分，共用一根轴时旧曲的柱子全一样高（2026-10-15 作者的号：旧曲 17.2～17.5、
  // 新曲 15.7～17.3，共用的轴拉成 15～18）。旧曲的刻度写在左边，新曲的写在右边。
  function niceAxis(low, high) {
    if (!(high > low)) { low -= 0.1; high += 0.1; }
    const step = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find((s) => (high - low) / s <= 5) || 5;
    // 底下多留半格，最矮的柱子也看得见
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
    svg.innerHTML = `<defs>
      <linearGradient id="bar-old" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f7e6b4"/><stop offset="0.3" stop-color="#d9ab57"/><stop offset="1" stop-color="#6e4518"/>
      </linearGradient>
      <linearGradient id="bar-new" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffc794"/><stop offset="0.3" stop-color="#d75a33"/><stop offset="1" stop-color="#5e140d"/>
      </linearGradient>
    </defs>`;
    uniqueIds(svg);
    const fill = (fresh) => "url(#" + svg.querySelector(fresh ? "[id^=bar-new]" : "[id^=bar-old]").id + ")";

    const groups = (data.chapters || []).map((chapter) => ({
      slots: chapter.slots || (chapter.scores || []).length,
      average: Number(chapter.average) || 0,
      bars: (chapter.scores || []).map((score) => ({
        value: Number(score.rating) || 0,
        fresh: chapter.key === "new" || (mode === "b30" && Boolean(score.isNew)),
      })),
    }));
    const values = groups.flatMap((group) => group.bars.map((bar) => bar.value));
    if (!values.length) {
      svgEl("text", { x: width / 2, y: height / 2, class: "empty" }, svg).textContent = "还没有成绩";
      return;
    }

    // 两栏（B50）时右边也要留出写刻度的地方
    const pad = { left: 62, right: groups.length > 1 ? 62 : 14, top: 30, bottom: 30 };
    const base = height - pad.bottom;

    // 两栏之间空两格，各自的网格和刻度不挤在一起
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
        // 网格只横跨这一栏；刻度第一栏写在左边，后面一栏写在右边
        const onRight = index > 0;
        for (const tick of axis.ticks) {
          const y = yOf(tick).toFixed(1);
          svgEl("line", { x1: start.toFixed(1), x2: end.toFixed(1), y1: y, y2: y }, grid);
          svgEl("text", { x: (onRight ? end + 10 : start - 10).toFixed(1), y, class: "tick" + (onRight ? " right" : "") }, grid).textContent = tick.toFixed(axis.decimals);
        }
        group.bars.forEach((bar, i) => {
          const x = start + i * slot + (slot - barWidth) / 2;
          const y = Math.min(yOf(bar.value), base - 2);
          svgEl("rect", { x: x.toFixed(1), y: y.toFixed(1), width: barWidth.toFixed(1), height: (base - y).toFixed(1), fill: fill(bar.fresh) }, bars);
        });
        // 均值线：没打满时均值会比最矮的柱子还低，线压在底边上，数字照写
        const y = Math.max(pad.top, Math.min(base, yOf(group.average)));
        svgEl("line", { x1: start.toFixed(1), x2: end.toFixed(1), y1: y.toFixed(1), y2: y.toFixed(1), class: "average" }, notes);
        const label = svgEl("text", { x: (end - 2).toFixed(1), y: (y - 7).toFixed(1), class: "average-label" }, notes);
        label.textContent = "均值 " + rating(group.average);
      }
      for (let i = 0; i < group.slots; i++) {
        if (i === 0 || (i + 1) % 5 === 0) {
          svgEl("text", { x: (start + (i + 0.5) * slot).toFixed(1), y: base + 21, class: "rank" }, notes).textContent = String(i + 1);
        }
      }
      svgEl("line", { x1: start.toFixed(1), x2: end.toFixed(1), y1: base, y2: base, class: "baseline" }, notes);
      start = end + gap * slot;
    }
  }

  function renderChart(mode) {
    const title = $("chart-title");
    title.append(el("b", null, mode === "b30" ? "Best 30" : "Best 50"), el("span", null, "单曲 Rating"));
    const chapters = data.chapters || [];
    const hasNew = chapters.some((chapter) => chapter.key === "new" ? chapter.scores.length : chapter.scores.some((score) => score.isNew));
    const legend = $("chart-legend");
    legend.append(el("i", "swatch old"), "旧曲");
    if (hasNew) legend.append(el("i", "swatch new"), "新曲");
  }

  // ── 卡片 ──
  function card(score, index, chapterKey, mode) {
    const rnd = random((chapterKey.charCodeAt(0) << 8) + index * 977 + 13);
    const item = el("li", "card d" + score.levelIndex);
    item.style.setProperty("--sx", Math.round(rnd() * 100) + "%");
    item.style.setProperty("--sy", Math.round(rnd() * 100) + "%");
    item.style.setProperty("--mx", -Math.round(rnd() * 600) + "px");
    item.style.setProperty("--my", -Math.round(rnd() * 600) + "px");
    item.style.setProperty("--gx", -Math.round(rnd() * 200) + "px");
    item.style.setProperty("--gy", -Math.round(rnd() * 200) + "px");

    item.append(paper(rnd));

    const jacket = el("figure", "jacket");
    const img = el("img");
    img.alt = "";
    if (score.jacket) img.src = score.jacket;
    else jacket.classList.add("missing");
    // 文件读不出来（缓存被删了之类）也一样处理，不显示破图标
    img.addEventListener("error", () => jacket.classList.add("missing"), { once: true });
    jacket.append(img, el("div", "band", LEVELS[score.levelIndex] || ""));
    item.append(jacket, el("span", "idx", index + 1));
    if (mode === "b30" && score.isNew) item.append(el("span", "new-tag", "New"));

    const seal = el("div", "seal " + (SEALED.has(score.rank) ? score.rank : "low"));
    const wax = el("div", "wax");
    wax.style.clipPath = waxEdge(rnd);
    seal.append(wax, el("span", null, RANK_TEXT[score.rank] || String(score.rank || "").toUpperCase()));
    item.append(seal);

    const body = el("div", "body");
    const title = el("div", "title-line", score.title);
    title.lang = /[぀-ヿ]/.test(score.title) ? "ja" : "zh-CN";
    // 通关标记：实心的颜料色小牌子，在纸上一眼看得见。FC/AJ 在前，最要紧
    const marks = el("div", "marks");
    if (FULL_COMBO[score.fullCombo]) marks.append(el("span", "mark " + FULL_COMBO[score.fullCombo][1], FULL_COMBO[score.fullCombo][0]));
    if (CLEARS[score.clear]) marks.append(el("span", "mark tag " + score.clear, CLEARS[score.clear]));
    if (score.fullChain) marks.append(el("span", "mark chain" + (score.fullChain === "fullchain2" ? " gold" : ""), "FULL CHAIN"));
    // 定数 › 单曲 Rating（落雪曲库里没有定数时退回等级「15+」）
    const constant = el("span", "const", score.constant ? ThemeKit.format.constant(score.constant) : score.level || "");
    constant.append(el("i", null, "›"));
    const foot = el("div", "foot");
    foot.append(constant, el("span", "rating", rating(score.rating)));
    body.append(title, el("div", "score", ThemeKit.format.score(score.score)), marks, foot);
    item.append(body);
    return item;
  }

  // 纸片的撕边要等排好版、知道实际大小以后再剪（见 tearPapers）
  function paper(rnd) {
    const node = el("div", "paper");
    node.dataset.seed = String(Math.floor(rnd() * 1e9));
    return node;
  }

  function tearPapers() {
    for (const node of document.querySelectorAll(".paper")) {
      node.style.clipPath = tornEdge(node.offsetWidth, node.offsetHeight, random(Number(node.dataset.seed)), { step: 6, depth: 2.4, wave: 2.2, bite: 0.025 });
    }
  }

  function emptyCard(index, chapterKey) {
    const rnd = random((chapterKey.charCodeAt(0) << 8) + index * 977 + 13);
    const item = el("li", "card empty");
    item.append(paper(rnd), el("div", "void", "— " + (index + 1) + " —"));
    return item;
  }

  function renderChapters(mode) {
    const box = $("chapters");
    for (const [index, chapter] of (data.chapters || []).entries()) {
      const words = CHAPTERS[chapter.key] || CHAPTERS.all;
      const section = el("section", "chapter");
      const head = el("header", "chapter-head");
      // 第二栏（B50 的新曲）跟上一栏的交界：章节名上面一整排花饰（排版好以后 drawFrieze 再按宽度排）
      if (index > 0) {
        section.classList.add("joined");
        section.append(el("div", "frieze"));
      }
      const left = el("div", "orn");
      const right = el("div", "orn mirror");
      ornament(left, "tail");
      ornament(right, "tail");
      const name = el("div", "chapter-name");
      name.append(el("span", "zh", words.zh), ribbon(words.en, "chapter-ribbon"));
      const side = el("div", "chapter-side left", words.side);
      side.append(el("br"), el("b", null, (chapter.scores || []).length + " / " + chapter.slots), " 首");
      const numbers = el("div", "chapter-side right");
      numbers.append("均值", el("b", null, rating(chapter.average)), el("br"), "地板", el("b", null, chapter.floor ? rating(chapter.floor) : "—"));
      head.append(side, left, name, right, numbers);

      const grid = el("ol", "grid");
      const scores = chapter.scores || [];
      for (let i = 0; i < chapter.slots; i++) grid.append(scores[i] ? card(scores[i], i, chapter.key, mode) : emptyCard(i, chapter.key));
      section.append(head, grid);
      box.append(section);
    }
  }

  // ── 排版收尾：字体到了才量得准 ──
  function shrinkToFit(node, { min, step = 0.5, fits }) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (!fits() && size > min) {
      size -= step;
      node.style.fontSize = size + "px";
    }
  }

  function fitText() {
    const fitsWidth = (node) => () => node.scrollWidth <= node.clientWidth + 1;
    // 曲名只写一行：放不下先稍微缩一点，缩到 23px 还放不下就让 CSS 的省略号截断（作者宁可少显示几个字，也要字大）
    for (const title of document.querySelectorAll(".title-line")) shrinkToFit(title, { min: 23, fits: fitsWidth(title) });
    for (const score of document.querySelectorAll(".score")) shrinkToFit(score, { min: 18, fits: fitsWidth(score) });
    // 定数和单曲 Rating 一起缩，两个始终差不多大（Segoe Script 的数字宽，定数 15.4、Rating 18.05 这种最宽）
    for (const foot of document.querySelectorAll(".foot")) {
      const parts = [foot.querySelector(".const"), foot.querySelector(".rating")].map((node) => [node, parseFloat(getComputedStyle(node).fontSize)]);
      for (let ratio = 0.97; foot.scrollWidth > foot.clientWidth + 1 && ratio > 0.7; ratio -= 0.03) {
        for (const [node, size] of parts) node.style.fontSize = (size * ratio).toFixed(2) + "px";
      }
    }
    // 标记放不下就从后往前去掉（FC/AJ 最要紧）
    for (const marks of document.querySelectorAll(".marks")) {
      while (marks.children.length > 1 && marks.scrollWidth > marks.clientWidth + 1) marks.lastChild.remove();
    }
    const scale = (inner, outer) => {
      const ratio = outer.clientWidth / inner.scrollWidth;
      if (ratio < 1) inner.style.transform = "scale(" + ratio.toFixed(3) + ")";
    };
    const trophy = document.querySelector(".trophy span");
    if (trophy) scale(trophy, trophy.parentElement);
    const name = $("name");
    const nameBox = name.parentElement;
    const room = nameBox.clientWidth - $("level").offsetWidth - 12;
    if (name.scrollWidth > room) name.style.transform = "scale(" + (room / name.scrollWidth).toFixed(3) + ")";
  }

  async function main() {
    const mode = data.mode === "b30" ? "b30" : "b50";
    document.body.classList.add("mode-" + mode);
    const page = $("page");
    const pad = framePadding();
    page.style.padding = `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
    for (const node of document.querySelectorAll("[data-ornament=tail]")) ornament(node, "tail");
    drawSigil($("sigil"));
    scatterEmbers($("embers"), 1414, 60, false);
    scatterEmbers($("sparks"), 2718, 55, true);
    renderHead(mode);
    renderChart(mode);
    renderChapters(mode);
    $("credit").textContent = ["Generated by Anna Bot", "数据来自落雪查分器", data.time].filter(Boolean).join(" · ");

    void document.body.offsetHeight;
    await Promise.all(["16px \"Anna Hand\"", "700 16px \"Anna Script\""]
      .map((font) => document.fonts.load(font).catch(() => null)));
    await document.fonts.ready;
    fitText();
    tearPapers();
    for (const frieze of document.querySelectorAll(".frieze")) drawFrieze(frieze);
    drawChart($("chart"), mode);

    // 「撕开的洞」和画框都要等内容排好、知道整张图多高以后再画
    const canvas = $("canvas");
    canvas.style.clipPath = tornEdge(canvas.offsetWidth, canvas.offsetHeight, random(9001), { step: 9, depth: 7, wave: 9, bite: 0.04 });
    drawFrame(page);
    // 花饰是 CSS 遮罩，ThemeKit 只等 <img>，这张自己等
    await ThemeKit.preload([FRIEZE.src]);
    ThemeKit.done({ element: page });
  }

  main().catch(ThemeKit.fail);
})();
