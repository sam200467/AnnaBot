// /单曲：一首歌各难度的成绩。数据形状见 ../examples/preview-data.json（原创曲，带对应角色）、../examples/ultima.json（五个难度、有没打过的谱面）
// 和 ../examples/characters.json（六个对应角色，有的借了同一个人别的卡的头像、有的只有名字）。
// 撕边、封印的边这些「随机」的东西用固定种子的伪随机数生成：同一份数据每次出图都一样。
// 背景（油画、立绘、压烟、暗幕）都是固定的，写在 theme.html / theme.css 里；这里只排正文。
(function () {
  "use strict";
  const data = ThemeKit.data();
  const $ = (id) => document.getElementById(id);

  const LEVELS = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "ULTIMA", "WORLD'S END"];
  const RANK_TEXT = { sssp: "SSS+", sss: "SSS", ssp: "SS+", ss: "SS", sp: "S+", s: "S", aaa: "AAA", aa: "AA", a: "A", bbb: "BBB", bb: "BB", b: "B", c: "C", d: "D" };
  // 这几档是金、银、铜的封印，其余（AAA 往下）一律是发黑的铁
  const SEALED = new Set(["sssp", "sss", "ssp", "ss", "sp", "s"]);
  // 标记的文字、配色 class 由 ThemeKit 统一给（长的通关标记缩写成 CATA / ABS / CHAIN）
  const MARKS = ThemeKit.MARKS;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  // 一枚通关标记：extra 是这个主题自己的 class（song 是 tag-cut），配色 class 在 ThemeKit.MARKS 里
  const markOf = (value, extra) => {
    const item = MARKS[value];
    return item ? el("span", "mark" + (extra ? " " + extra : "") + " " + item.kind, item.text) : null;
  };

  // ── 下面这几段照搬 ../../best/renderer/theme.js（固定种子的伪随机数、撕边、封印的边、影子、拼画框），说明见那边 ──
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
    return points;
  }

  // 撕边的顶点换成 clip-path；画影子（castShadow）用的也是同一组点
  const polygon = (points) => "polygon(" + points.map(([x, y]) => x.toFixed(1) + "px " + y.toFixed(1) + "px").join(",") + ")";

  // 影子：以前是 CSS 的 drop-shadow，要先把整块内容画到离屏图上再模糊，没有显卡、全靠 CPU 出图的服务器上很慢。
  // 影子只跟形状有关，所以画进 canvas 模糊一次，转成图片垫在下面。不直接把 <canvas> 放进页面：大图截出来会一块块缺着。
  // res 是 canvas 相对 CSS 像素的分辨率
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

  // 跟 CSS 的 drop-shadow(x y blur color) 一样：blur 是模糊半径，相当于标准差 blur / 2。canvas 的 filter 按 canvas 的像素算
  function castShadow(ctx, shapes, { blur, color }) {
    const res = ctx.res;
    ctx.save();
    ctx.filter = "blur(" + (blur / 2 * res).toFixed(2) + "px)";
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const { points, x = 0, y = 0 } of shapes) {
      points.forEach(([px, py], i) => ctx[i ? "lineTo" : "moveTo"]((px + x) * res, (py + y) * res));
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  // 噪声纹理（theme.css 的 --grain --mottle --soot --brushed）没有照 best 先画成位图：这张图上它们只有羊皮纸那一圈、
  // 整张的烟和几块铁板，1 核实测四张都先画成 PNG，截图只快 0.1 秒左右，转 PNG 却要多花将近 1 秒，反而慢了
  // （B50 有五十张带纹理的纸片才划算）。量的数见 ../README.md 的「出图要快」

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

  // 画框素材跟 /b50 共用一张（themes/best/assets/frame.png），坐标是在那张图上量的。
  // 整张图的大框按 0.54 缩；曲绘外面的小框是同一套拼法缩到 JACKET_FRAME，像挂在画里的另一幅小画
  const FRAME = {
    src: "../../best/assets/frame.png",
    size: [1271, 1920],
    scale: 0.54,
    margin: 30,
    plain: { left: 220, top: 386, right: 1079, bottom: 1542 },
    opening: { left: 374, top: 541, right: 929, bottom: 1391 },
    section: { left: [199, 650, 175, 120], right: [929, 650, 172, 120] },
    corners: { tl: [196, 355, 240, 300], tr: [860, 355, 241, 300], bl: [196, 1300, 240, 276], br: [860, 1300, 241, 276] },
    middles: { left: [196, 815, 178, 310], right: [929, 815, 172, 310], top: [445, 355, 410, 186], bottom: [445, 1391, 410, 184] },
  };
  const JACKET_FRAME = 0.15;

  // 框四边留多宽：到内口为止，再往里 2 像素让框压住里面的东西，不留缝
  function framePadding(s) {
    const { margin: m, plain: p, opening: o } = FRAME;
    const inset = { top: (o.top - p.top + m) * s, right: (p.right + m - o.right) * s, bottom: (p.bottom + m - o.bottom) * s, left: (o.left - p.left + m) * s };
    return Object.fromEntries(Object.entries(inset).map(([side, value]) => [side, Math.floor(value) - 2]));
  }

  // 在 holder 里拼一圈框，holder 跟 box 一样大（box 的 padding 就是给框留的位置）。
  // stretch：直边的线脚不一段段交替着铺，整条拉长。曲绘的小框缩到 0.15 时一段只有 18 像素，
  // 缩得这么狠，每段边上会采到原图里线脚外面的暗色，接缝透出一道道黑线，像尺子的刻度（2026-10-16 试看图）
  function drawFrame(box, holder, s, { stretch = false } = {}) {
    const W = box.offsetWidth;
    const H = box.offsetHeight;
    const { margin: m, plain: p, opening: o, section, corners: c, middles } = FRAME;
    const left = (sx) => (sx - p.left + m) * s;
    const right = (sx) => W - (p.right + m - sx) * s;
    const top = (sy) => (sy - p.top + m) * s;
    const bottom = (sy) => H - (p.bottom + m - sy) * s;
    const put = (rect, x, y, w, h, className) => {
      const img = cutout(FRAME.src, FRAME.size, rect, "gilt " + (className || ""));
      Object.assign(img.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      holder.append(img);
    };
    const span = (rect) => [rect[2] * s, rect[3] * s];
    const half = (v) => Math.round(v * 2) / 2;
    const run = (rect, x, y, length, rotate) => {
      const thickness = rect[2] * s;
      const piece = half(rect[3] * s);
      const strip = el("div", "gilt-run");
      Object.assign(strip.style, { left: x + "px", top: y + "px", width: thickness + "px", height: length + "px", transform: rotate || "" });
      if (stretch) {
        const img = cutout(FRAME.src, FRAME.size, rect, "gilt");
        Object.assign(img.style, { left: "0px", top: "0px", width: thickness + "px", height: length + "px" });
        strip.append(img);
        holder.append(strip);
        return;
      }
      for (let i = 0; i * piece < length; i++) {
        const img = cutout(FRAME.src, FRAME.size, rect, "gilt" + (i % 2 ? " flip" : ""));
        Object.assign(img.style, { left: "0px", top: i * piece + "px", width: thickness + "px", height: piece + 1.5 + "px" });
        strip.append(img);
      }
      holder.append(strip);
    };
    const y0 = half(top(c.tl[1]) + c.tl[3] * s * 0.55);
    const y1 = half(bottom(c.bl[1]) + c.bl[3] * s * 0.45);
    const x0 = half(left(c.tl[0]) + c.tl[2] * s * 0.55);
    const x1 = half(right(c.tr[0]) + c.tr[2] * s * 0.45);
    run(section.left, left(section.left[0]), y0, y1 - y0);
    run(section.right, right(section.right[0]), y0, y1 - y0);
    run(section.left, 0, 0, x1 - x0, `translate(${x1}px, ${top(p.top) - (p.left - section.left[0]) * s}px) rotate(90deg)`);
    run(section.right, 0, 0, x1 - x0, `translate(${x1}px, ${bottom(o.bottom)}px) rotate(90deg)`);

    const [tw, th] = span(middles.top);
    const [bw, bh] = span(middles.bottom);
    put(middles.top, (W - tw) / 2, top(middles.top[1]), tw, th, "fade-x");
    put(middles.bottom, (W - bw) / 2, bottom(middles.bottom[1]), bw, bh, "fade-x");
    const [lw, lh] = span(middles.left);
    const [rw, rh] = span(middles.right);
    const cy = (top(c.tl[1] + c.tl[3]) + bottom(c.bl[1])) / 2;
    put(middles.left, left(middles.left[0]), cy - lh / 2, lw, lh, "fade-y");
    put(middles.right, right(middles.right[0]), cy - rh / 2, rw, rh, "fade-y");

    put(c.tl, left(c.tl[0]), top(c.tl[1]), ...span(c.tl), "fade-tl");
    put(c.tr, right(c.tr[0]), top(c.tr[1]), ...span(c.tr), "fade-tr");
    put(c.bl, left(c.bl[0]), bottom(c.bl[1]), ...span(c.bl), "fade-bl");
    put(c.br, right(c.br[0]), bottom(c.br[1]), ...span(c.br), "fade-br");
  }

  // ── 上半：曲绘、曲名、曲师、四个小格、对应角色 ──
  function fact(label, value, extra) {
    const box = el("div", "fact plate" + (extra ? " " + extra : ""));
    box.append(el("dt", null, label), el("dd", null, value));
    return box;
  }

  function renderSong() {
    const song = data.song || {};
    const jacket = $("jacket");
    const img = $("jacket-img");
    if (song.jacket) img.src = song.jacket;
    else jacket.classList.add("missing");
    img.addEventListener("error", () => jacket.classList.add("missing"), { once: true });

    const title = $("title");
    title.textContent = song.title || "";
    title.lang = /[぀-ヿ]/.test(song.title || "") ? "ja" : "zh-CN";
    $("artist").textContent = song.artist || "";

    const facts = $("facts");
    facts.append(fact("版本", song.version || "—", "wide"), fact("分类", song.genre || "—"), fact("BPM", song.bpm || "—"), fact("ID", song.id ?? "—"));

    // 对应角色：落雪的头像只有 128 见方，做成小圆章；好几个角色时圆章叠着放（前面的压在上面），名字用「、」连着写。
    // 没有头像的（国服没这个人）只写名字，不画圆章（没有 src 的 img 不会触发 error，会留下一个空的黑圈）
    const kin = $("kin");
    const characters = (song.characters || []).filter((chara) => chara && chara.name);
    if (characters.length) {
      const faces = el("div", "faces");
      characters.filter((chara) => chara.icon).forEach((chara, i, all) => {
        const face = el("div", "face");
        face.style.zIndex = String(all.length - i);
        const icon = el("img");
        icon.alt = "";
        icon.src = chara.icon;
        icon.addEventListener("error", () => face.remove(), { once: true });
        face.append(icon);
        faces.append(face);
      });
      if (faces.children.length >= 4) faces.classList.add("many");
      if (faces.children.length) kin.append(faces);
      const who = el("div", "who");
      const names = el("span", "names", characters.map((chara) => chara.name).join("、"));
      names.lang = "ja";
      // 名字连起来放不下时一级级写短（fitText 里换）：去掉卡名的副标题只写人名（「小仏 凪／途惑いのクリスマス編」→「小仏 凪」），
      // 再不行写「第一个人 等 6 人」
      if (characters.length > 1) {
        const person = (chara) => chara.name.split("／")[0].trim();
        names.dataset.shorter = JSON.stringify([
          [...new Set(characters.map(person))].join("、"),
          person(characters[0]) + " 等 " + characters.length + " 人",
        ]);
      }
      who.append(el("small", null, "对应角色"), names);
      kin.append(who);
    }
    if (song.releaseJP) {
      const date = el("div", "date");
      date.append(el("small", null, "日服上线"), el("b", null, song.releaseJP));
      kin.append(date);
    }

    // 曲库有资料时才出现，未提供的字段不留空栏。
    const details = $("details");
    const detail = (label, value, kind) => {
      if (!value) return;
      details.append(el("dt", kind, label), el("dd", kind, value));
      details.hidden = false;
    };
    detail("所属地图", song.map);
    detail("解锁要求", song.unlock, "unlock");
    if (song.copyright) {
      $("copyright").textContent = song.copyright;
      $("copyright").hidden = false;
    }
    if (data.previewNote) {
      $("preview-note").textContent = data.previewNote;
      $("preview-note").hidden = false;
    }
  }

  // ── 下半：一行一个难度 ──
  function chartRow(chart, index) {
    const rnd = random(7919 + index * 977);
    const row = el("li", "chart plate d" + chart.levelIndex);
    const played = chart.score !== null && chart.score !== undefined;
    if (!played) row.classList.add("unplayed");

    const tag = el("div", "tag");
    tag.append(el("span", null, LEVELS[chart.levelIndex] || ""));
    if (chart.levelIndex === 5) {
      // WORLD'S END 没有定数：写谱面属性的汉字和星级
      tag.append(el("em", null, (chart.kanji || "") + " " + "★".repeat(chart.star || 0)));
    } else {
      tag.append(el("b", null, chart.constant ? ThemeKit.format.constant(chart.constant) : chart.level || ""));
    }

    const main = el("div", "main");
    main.append(el("div", "score", played ? ThemeKit.format.score(chart.score) : "—"));
    // 物量在前、谱师在后：谱师有很长的（「譜面ボーイズからの挑戦状」），放不下时只截谱师，物量总看得见
    const meta = el("div", "meta");
    meta.lang = "ja";
    if (chart.notes) meta.append("物量 ", el("b", null, Number(chart.notes).toLocaleString("en-US")));
    if (chart.designer) meta.append(chart.notes ? "　谱师 " : "谱师 ", el("b", null, chart.designer));
    main.append(meta);

    const seal = el("div", "seal");
    if (played && chart.rank) {
      seal.classList.add(SEALED.has(chart.rank) ? chart.rank : "low");
      const wax = el("div", "wax");
      wax.style.clipPath = waxEdge(rnd);
      seal.append(wax, el("span", null, RANK_TEXT[chart.rank] || String(chart.rank).toUpperCase()));
    }

    const marks = el("div", "marks");
    if (played) {
      const combo = markOf(chart.fullCombo);
      const clear = markOf(chart.clear, "tag-cut");
      const chain = markOf(chart.fullChain);
      if (combo) marks.append(combo);
      if (clear) marks.append(clear);
      if (chain) marks.append(chain);
    }

    const rating = el("div", "rating", played ? ThemeKit.format.rating(chart.rating) : "—");
    row.append(tag, main, seal, marks, rating);
    if (chart.levelIndex === 4 && chart.addedVersion) row.append(el("small", "chart-version", "日服追加 " + chart.addedVersion));
    return row;
  }

  function renderCharts() {
    const list = $("charts");
    (data.charts || []).forEach((chart, i) => list.append(chartRow(chart, i)));
  }

  // ── 排版收尾：字体到了才量得准 ──
  function shrinkToFit(node, { min, step = 1, fits }) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (!fits() && size > min) {
      size -= step;
      node.style.fontSize = size + "px";
    }
  }

  function fitText() {
    const fitsWidth = (node) => () => node.scrollWidth <= node.clientWidth + 1;
    // 曲名只写一行：放不下先缩，缩到 38px 还放不下就让 CSS 的省略号截断（作者宁可少显示几个字，也要字大）
    shrinkToFit($("title"), { min: 38, fits: fitsWidth($("title")) });
    shrinkToFit($("artist"), { min: 24, fits: fitsWidth($("artist")) });
    // 谱师名字长的（几个人合写的）先缩字，缩到 22px 还放不下再用省略号
    for (const meta of document.querySelectorAll(".meta")) shrinkToFit(meta, { min: 22, fits: fitsWidth(meta) });
    for (const version of document.querySelectorAll(".chart-version")) shrinkToFit(version, { min: 16, fits: fitsWidth(version) });
    // 对应角色好几个、名字连起来太长：每一级先缩字（最小 24px），还放不下就换短一级的写法，最后一级还不行用省略号。
    // 不能一路缩下去：六个人的名字缩到放得下，字小得看不清（2026-10-16 试的相思創愛）
    for (const names of document.querySelectorAll(".kin .names")) {
      const fits = fitsWidth(names);
      const shorter = JSON.parse(names.dataset.shorter || "[]");
      shrinkToFit(names, { min: 24, fits });
      for (const text of shorter) {
        if (fits()) break;
        names.textContent = text;
        names.style.fontSize = "";
        shrinkToFit(names, { min: 24, fits });
      }
    }
    for (const marks of document.querySelectorAll(".marks")) {
      while (marks.children.length > 1 && marks.scrollHeight > marks.clientHeight + 1) marks.lastChild.remove();
    }
  }

  // 撕开的洞投在羊皮纸上的焦边（以前是 .rim 上两层 drop-shadow：2px 的深褐、10px 的焦糖色，等于把整张图模糊两遍）。
  // 图比洞大一圈，影子才伸得出去；按 CSS 像素画，贴着撕边的那道深色细边不会糊
  const RIM_SPREAD = 24;

  function drawRimShadow(edge, width, height) {
    const node = $("rim-shadow");
    Object.assign(node.style, { left: -RIM_SPREAD + "px", top: -RIM_SPREAD + "px" });
    const shape = [{ points: edge, x: RIM_SPREAD, y: RIM_SPREAD }];
    return shadowImage(node, width + RIM_SPREAD * 2, height + RIM_SPREAD * 2, 1, (ctx) => {
      castShadow(ctx, shape, { blur: 10, color: "rgba(96, 46, 12, 0.75)" });
      castShadow(ctx, shape, { blur: 2, color: "rgba(38, 17, 4, 0.95)" });
    });
  }

  async function main() {
    const page = $("page");
    const pad = framePadding(FRAME.scale);
    page.style.padding = `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;
    const jacket = $("jacket");
    const inner = framePadding(JACKET_FRAME);
    jacket.style.padding = `${inner.top}px ${inner.right}px ${inner.bottom}px ${inner.left}px`;
    jacket.style.setProperty("--jacket-inset", inner.top + "px");

    renderSong();
    renderCharts();
    // 页脚不写玩家名（作者 2026-10-16 让去掉的）
    $("credit").textContent = ["Generated by Anna Bot", "数据来自落雪查分器", data.time].filter(Boolean).join(" · ");

    void document.body.offsetHeight;
    await Promise.all(["16px \"Anna Hand\"", "700 16px \"Anna Hand Bold\"", "700 16px \"Anna Script\""]
      .map((font) => document.fonts.load(font).catch(() => null)));
    await document.fonts.ready;
    fitText();

    const canvas = $("canvas");
    // 新资料增加多少高度就补多少画布，五难度的成绩行和原来的字号保持不变。
    let extraHeight = 0;
    if (!$("details").hidden) extraHeight += $("details").offsetHeight + 20;
    if (!$("copyright").hidden) extraHeight += $("copyright").offsetHeight + 10;
    if (extraHeight) canvas.style.height = (1140 + extraHeight) + "px";
    const edge = tornEdge(canvas.offsetWidth, canvas.offsetHeight, random(9001), { step: 9, depth: 7, wave: 9, bite: 0.04 });
    canvas.style.clipPath = polygon(edge);
    const shadow = drawRimShadow(edge, canvas.offsetWidth, canvas.offsetHeight);
    drawFrame(page, $("gilt"), FRAME.scale);
    drawFrame(jacket, jacket.querySelector(".gilt-box"), JACKET_FRAME, { stretch: true });
    await shadow;
    ThemeKit.done({ element: page });
  }

  main().catch(ThemeKit.fail);
})();
