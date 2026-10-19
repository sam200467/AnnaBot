"use strict";

// /谱面分析：一张谱面的分数线、容错，和玩家在这张谱上的成绩、游玩记录曲线。数据形状见 ../examples/preview-data.json
// （由 ../design/make-example.cjs 生成：853 MASTER，成绩、游玩记录、排名是编的）。分数线、容错、Rating、OP 都由功能代码用
// src/score-math.cjs 算好传进来，这里只排版。
// 画面：Grimshaw《夏洛特女郎》染成月光蓝，右边淡淡地叠着水之巫女朱娜的立绘，外面是荷兰代尔夫特陶镜框（F7）。
// 正文一栏在左边，照 MiaBot 的谱面分析排：谱面信息 → 分数线容错表 →（白金分那块换成）玩家的成绩和曲线。
// 图的高度跟着正文走：先排好正文、量出高度，再按这个高度铺画、放立绘、拼框。
(() => {
  const data = ThemeKit.data() || {};
  const $ = (id) => document.getElementById(id);

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const num = (value) => Number(value).toLocaleString("en-US");

  const LEVELS = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "ULTIMA", "WORLD'S END"];
  const RANK_TEXT = { sssp: "SSS+", sss: "SSS", ssp: "SS+", ss: "SS", sp: "S+", s: "S", aaa: "AAA", aa: "AA", a: "A", bbb: "BBB", bb: "BB", b: "B", c: "C", d: "D" };
  const SEALED = new Set(["sssp", "sss", "ssp", "ss", "sp", "s"]);
  // 标记的文字、配色 class 由 ThemeKit 统一给（长的通关标记缩写成 CATA / ABS / CHAIN）
  const MARKS = ThemeKit.MARKS;
  // 一枚通关标记：extra 是这个主题自己的 class（chart 是 tag-cut），配色 class 在 ThemeKit.MARKS 里
  const markOf = (value, extra) => {
    const item = MARKS[value];
    return item ? el("span", "mark" + (extra ? " " + extra : "") + " " + item.kind, item.text) : null;
  };
  const NOTE_TYPES = [["tap", "TAP"], ["hold", "HOLD"], ["slide", "SLIDE"], ["air", "AIR"], ["flick", "FLICK"]];
  // 曲线上画的几条分数线（比 S 低的几档也画，玩家分数低的时候用得上）
  const CURVE_LINES = [["SSS+", 1009000], ["SSS", 1007500], ["SS+", 1005000], ["SS", 1000000], ["S+", 990000], ["S", 975000], ["AAA", 950000], ["AA", 925000], ["A", 900000]];

  // ── 固定种子的伪随机数、封印的边：照搬 ../../song/renderer/theme.js ──
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

  function seal(rank, { small = false, seed = 1 } = {}) {
    const node = el("div", "seal" + (small ? " small" : ""));
    if (!rank) return node;
    node.classList.add(SEALED.has(rank) ? rank : "low");
    const wax = el("div", "wax");
    wax.style.clipPath = waxEdge(random(seed));
    node.append(wax, el("span", null, RANK_TEXT[rank] || String(rank).toUpperCase()));
    return node;
  }

  // ── 上：曲绘、曲名、四个小格、物量构成 ──
  function fact(label, value, extra) {
    const box = el("div", "fact " + (extra || "plate"));
    box.append(el("dt", null, label), el("dd", null, value));
    return box;
  }

  function renderSong() {
    const song = data.song || {};
    const chart = data.chart || {};
    const jacket = $("jacket");
    const img = $("jacket-img");
    if (song.jacket) img.src = song.jacket;
    else jacket.classList.add("missing");
    img.addEventListener("error", () => jacket.classList.add("missing"), { once: true });

    const title = $("title");
    title.textContent = song.title || "";
    title.lang = /[぀-ヿ]/.test(song.title || "") ? "ja" : "zh-CN";
    $("artist").textContent = song.artist || "";
    renderKin(song.characters || []);

    // WORLD'S END 没有定数：写谱面属性的汉字和星级
    const level = chart.levelIndex === 5 ? (chart.kanji || "") + " " + "★".repeat(chart.star || 0)
      : chart.constant ? ThemeKit.format.constant(chart.constant) : chart.level || "";
    const facts = $("facts");
    facts.append(fact(LEVELS[chart.levelIndex] || "", level, "level d" + chart.levelIndex));
    // 拟合定数（EazyChu 的体感定数，不是官方定数）紧挨着难度那格：跟官方定数并排，一眼能对上。
    // 拟合表里没有这张谱面（新曲、WORLD'S END）就不写。数据来自 src/fit-diffs.cjs
    if (chart.fitConstant) facts.append(fact("拟合定数", "≈" + Number(chart.fitConstant).toFixed(2), "fit plate"));
    const notes = chart.notes || {};
    if (notes.total) facts.append(fact("物量", num(notes.total)));
    if (song.bpm) facts.append(fact("BPM", song.bpm));
    // 版本：这首歌第一次上线的版本（跟 /单曲 一样写短）
    if (song.version) facts.append(fact("版本", song.version, "version plate"));
    if (chart.designer) {
      const box = fact("谱师", chart.designer, "plate wide");
      box.querySelector("dd").lang = "ja";
      facts.append(box);
    }

    // 物量构成：一根分段的横条 + 一排数（原来比同等级谱面多 / 少的还挂个「多」「少」，作者 2026-10-17 说不用）
    if (!notes.total) return;
    const bar = el("div", "note-bar");
    const legend = el("div", "note-legend");
    for (const [key, name] of NOTE_TYPES) {
      const count = notes[key] || 0;
      if (count) {
        const part = el("i", "n-" + key);
        part.style.width = (count / notes.total) * 100 + "%";
        bar.append(part);
      }
      const item = el("span", "n-" + key);
      item.append(el("small", null, name), el("b", null, num(count)));
      legend.append(item);
    }
    $("notes").append(bar, legend);
  }

  // 对应角色：小圆章（好几个叠着）+「对应角色」+ 名字，跟曲师挤在一行。名字放不下时 fitText 里一级级写短（同 /单曲）
  function renderKin(characters) {
    const list = characters.filter((chara) => chara && chara.name);
    if (!list.length) return;
    const kin = $("kin");
    const faces = el("div", "faces");
    list.filter((chara) => chara.icon).forEach((chara, i, all) => {
      const face = el("div", "face");
      face.style.zIndex = String(all.length - i);
      const icon = el("img");
      icon.alt = "";
      icon.src = chara.icon;
      icon.addEventListener("error", () => face.remove(), { once: true });
      face.append(icon);
      faces.append(face);
    });
    if (faces.children.length) kin.append(faces);
    const names = el("span", "names", list.map((chara) => chara.name).join("、"));
    names.lang = "ja";
    if (list.length > 1) {
      const person = (chara) => chara.name.split("／")[0].trim();
      names.dataset.shorter = JSON.stringify([[...new Set(list.map(person))].join("、"), person(list[0]) + " 等 " + list.length + " 人"]);
    }
    kin.append(el("small", null, "对应角色"), names);
  }

  // ── 中：分数线表 ──
  function renderLines() {
    const lines = data.lines || [];
    const table = $("line-table");
    const unit = data.unit;
    if (unit) {
      const aside = $("unit");
      aside.append("每个 JUSTICE ", el("b", null, "−" + unit.justice), "　ATTACK ", el("b", null, "−" + unit.attack), "　MISS ", el("b", null, "−" + unit.miss));
    }
    const withRating = lines.some((line) => line.rating !== null && line.rating !== undefined);
    const withPlayer = lines.some((line) => "gap" in line);
    if (!withRating) table.classList.add("no-rating");
    if (!withPlayer) table.classList.add("no-player");

    const heads = ["评级", "分数线"];
    if (withRating) heads.push("单曲 Rating");
    heads.push("最多 JUSTICE", "最多 ATTACK", "最多 MISS");
    if (withPlayer) heads.push("你还差");
    for (const head of heads) table.append(el("div", "th", head));

    lines.forEach((line, i) => {
      const cells = [];
      const cell = (className, ...children) => {
        const node = el("div", "td " + (className || ""));
        node.append(...children);
        cells.push(node);
        return node;
      };
      cell("seal-cell", seal(line.rank, { small: true, seed: 4099 + i * 131 }));
      cell("", el("span", "score", num(line.score)));
      if (withRating) cell("", el("span", "rating", line.rating === null ? "—" : ThemeKit.format.rating(line.rating)));
      // SS 那档的 JUSTICE 正好等于物量：照写（作者 2026-10-17 不要「不限」）
      cell("", el("span", "count", num(line.justice)));
      cell("", el("span", "count", num(line.attack)));
      cell("", el("span", "count", num(line.miss)));
      if (withPlayer) {
        if (line.gap) {
          cell("gap", el("b", null, "差 " + num(line.gap) + " 分"), el("small", null, "≈ " + num(line.gapJustice) + " 个 JUSTICE"));
        } else {
          cell("gap done", "✓ 已达成");
        }
      }
      for (const node of cells) {
        if (i === lines.length - 1) node.classList.add("last");
        if (withPlayer && !line.gap) node.classList.add("reached");
        table.append(node);
      }
    });
  }

  // ── 下：你的成绩 ──
  function renderMine() {
    const player = data.player;
    if (!player || !Number.isFinite(player.score)) {
      $("mine").remove();
      return;
    }
    // 左边一列：封印 + 最好成绩，下面一排通关标记，再往下单曲 Rating、OP、落雪排名各一行
    const summary = $("summary");
    const head = el("div", "head");
    head.append(seal(player.rank, { seed: 7001 }), el("div", "best", num(player.score)));
    const marks = el("div", "marks");
    const combo = markOf(player.fullCombo);
    const clear = markOf(player.clear, "tag-cut");
    const chain = markOf(player.fullChain);
    if (combo) marks.append(combo);
    if (clear) marks.append(clear);
    if (chain) marks.append(chain);
    summary.append(head, marks);

    const stat = (label, ...value) => {
      const box = el("div", "stat");
      const b = el("b");
      b.append(...value);
      box.append(el("small", null, label), b);
      summary.append(box);
    };
    if (player.rating !== null && player.rating !== undefined) stat("单曲 Rating", ThemeKit.format.rating(player.rating));
    if (player.op !== null && player.op !== undefined) stat("OVER POWER", ThemeKit.format.rating(player.op), el("span", null, " / " + ThemeKit.format.rating(player.opMax)));
    if (player.ranking) stat("落雪排名", el("i", null, "第 "), num(player.ranking), el("i", null, " 名"));

    // 「落雪记了27次，实际绘制23次（忽略＜90万分的成绩）」：作者 2026-10-17 定的说法，数字不加空格
    const plays = $("plays");
    if (player.plays) {
      plays.append("落雪记了", el("b", null, num(player.plays)), "次");
      if (player.hidden) plays.append("，实际绘制", el("b", null, num(player.plays - player.hidden)), "次（忽略＜90万分的成绩）");
    }
  }

  // 游玩记录曲线：一次一个点，按时间从左到右等距排（不按真实的日期间隔：一天打十次、隔两个月再打，按日期排会挤成一团）。
  // 纵轴按「离理论值还差多少分」取对数：SSS+ / SSS / SS+ / SS 几条线差不多等距。
  // 按分数直接画的话，100 万往上那点进步几乎是一条平线（落雪的图就是这样），可那正是打这张谱的人最在意的一段。
  // 线只画到 SS（作者 2026-10-17：S、S+ 不要）。比 SS 低的那几次压进 SS 线下面一窄条，只看得出「在 SS 下面」；
  // 一次 SS 都没到过的，才往下画 S+、S 这些线
  function drawHistory(node, history, width, height) {
    const pad = { left: 74, right: 18, top: 16, bottom: 42 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const lost = (score) => Math.log10(1010000 - Math.min(score, 1010000) + 1000);
    const lowest = Math.min(...history.map((h) => h.score));
    const highest = Math.max(...history.map((h) => h.score));
    // 往上画到 SSS+，打过 SSS+ 以上的才画到理论值（一律画到理论值的话，SSS+ 上面空着一大条，曲线挤在下面）
    const ceiling = highest > 1009000 ? 1010000 : 1009000;
    const floor = highest >= 1000000 ? 1000000 : (CURVE_LINES.find(([, line]) => line <= lowest) || CURVE_LINES[CURVE_LINES.length - 1])[1];
    const under = lowest < floor;
    // 有比 SS 低的：SS 线放在 80% 高的地方，下面那条给它们；没有的话底下留 6%
    const mainH = under ? plotH * 0.8 : plotH / 1.06;
    const y = (score) => {
      if (score >= floor || !under) return pad.top + ((lost(score) - lost(ceiling)) / (lost(floor) - lost(ceiling))) * mainH;
      return pad.top + mainH + ((lost(score) - lost(floor)) / (lost(lowest) - lost(floor))) * (plotH - mainH) * 0.92;
    };
    const n = history.length;
    const x = (i) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);

    const root = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}` });
    // 画到理论值时，顶上一条实线是 1,010,000
    if (ceiling === 1010000) root.append(svg("line", { class: "grid top", x1: pad.left, x2: width - pad.right, y1: y(1010000), y2: y(1010000) }));
    for (const [name, line] of CURVE_LINES) {
      if (line < floor || line > ceiling) continue;
      const yy = y(line);
      root.append(svg("line", { class: "grid", x1: pad.left, x2: width - pad.right, y1: yy, y2: yy }));
      root.append(svg("text", { class: "axis", x: pad.left - 14, y: yy + 7, "text-anchor": "end" }, name));
    }

    const points = history.map((h, i) => [x(i), y(h.score)]);
    root.append(svg("path", { class: "line", d: monotonePath(points) }));
    // 点太多（六十次以上）就只画线
    const best = history.reduce((a, b, i) => (b.score > history[a].score ? i : a), 0);
    if (n <= 60) {
      points.forEach(([px, py], i) => {
        if (i !== best) root.append(svg("circle", { class: "dot", cx: px, cy: py, r: 5 }));
      });
    }
    root.append(svg("circle", { class: "dot top", cx: points[best][0], cy: points[best][1], r: 8.5 }));

    node.append(root);
    drawDates(root, history, ticksOf(n), x, height);
  }

  // 日期最多写六个（头尾两个一定有），均匀挑
  const ticksOf = (n) => (n <= 6 ? [...Array(n).keys()] : [...new Set([0, 1, 2, 3, 4, 5].map((k) => Math.round((k * (n - 1)) / 5)))]);

  // 写日期：头一个和换了年的带年份（年份加粗）。带年份的那个字宽，跟旁边的会叠在一起（2026-10-17 试的图：
  // 「2025/11/8」压着「12/29」），所以写上以后量一下，跟前一个挨得太近的就不写；最后一个（最近一次）一定留，
  // 挤的话让它前面那个让位。去掉几个以后，谁带年份要重新定，重排一遍
  function drawDates(root, history, ticks, x, height) {
    const n = history.length;
    const write = (kept) => {
      root.querySelectorAll(".date").forEach((node) => node.remove());
      let year = null;
      return kept.map((i) => {
        // day 是功能代码按北京时间写好的「2026-06-08」，这里不碰时区
        const [yyyy, mm, dd] = String(history[i].day || "").split("-").map(Number);
        const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
        const label = svg("text", { class: "date", x: x(i) + (i === 0 ? -6 : i === n - 1 ? 6 : 0), y: height - 8, "text-anchor": anchor });
        if (yyyy !== year) label.append(svg("tspan", { class: "year" }, yyyy + "/"));
        label.append(document.createTextNode(mm + "/" + dd));
        year = yyyy;
        root.append(label);
        return label.getBBox();
      });
    };
    let kept = ticks.slice();
    for (let round = 0; round < ticks.length; round++) {
      const boxes = write(kept);
      const clash = boxes.findIndex((box, k) => k > 0 && box.x < boxes[k - 1].x + boxes[k - 1].width + 18);
      if (clash < 0) return;
      // 撞上的是最后一个：去掉它前面那个（前面那个是头一个的话就只能不写最后一个了）
      const drop = clash === kept.length - 1 && clash - 1 > 0 ? clash - 1 : clash;
      kept = kept.filter((_, k) => k !== drop);
    }
  }

  // 单调的三次曲线（Fritsch–Carlson，跟 d3 的 curveMonotoneX 一样）：比折线好看，又不会冲过实际的点、画出没打过的高分
  function monotonePath(points) {
    const n = points.length;
    if (n < 3) return "M" + points.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L");
    const dx = [];
    const slope = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = points[i + 1][0] - points[i][0];
      slope[i] = (points[i + 1][1] - points[i][1]) / dx[i];
    }
    const t = [slope[0]];
    for (let i = 1; i < n - 1; i++) {
      if (slope[i - 1] * slope[i] <= 0) t[i] = 0;
      else {
        const w1 = 2 * dx[i] + dx[i - 1];
        const w2 = dx[i] + 2 * dx[i - 1];
        t[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
      }
    }
    t[n - 1] = slope[n - 2];
    const f = (v) => v.toFixed(1);
    let d = "M" + f(points[0][0]) + "," + f(points[0][1]);
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += "C" + f(points[i][0] + h) + "," + f(points[i][1] + h * t[i]) + " " + f(points[i + 1][0] - h) + "," + f(points[i + 1][1] - h * t[i + 1])
        + " " + f(points[i + 1][0]) + "," + f(points[i + 1][1]);
    }
    return d;
  }

  const CURVE_HEIGHT = 280;

  function renderHistory() {
    const player = data.player;
    const node = $("history");
    if (!player || !node) return;
    const history = (player.history || []).filter((h) => Number.isFinite(h.score));
    if (history.length >= 2) {
      drawHistory(node, history, node.clientWidth, CURVE_HEIGHT);
    } else {
      // 画不出线的原因（只有一条、对方没开放历史成绩、没拿到）由功能代码写好放在 note
      if (player.note) node.append(el("p", "note", player.note));
    }
  }

  // ── 文字放不下时缩字（字体到了才量得准）──
  function shrinkToFit(node, { min, step = 1 }) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (node.scrollWidth > node.clientWidth + 1 && size > min) {
      size -= step;
      node.style.fontSize = size + "px";
    }
  }

  function fitText() {
    // 曲名只写一行：放不下先缩，缩到 38px 还放不下就让 CSS 的省略号截断（同 /单曲）
    shrinkToFit($("title"), { min: 38 });
    shrinkToFit($("artist"), { min: 24 });
    // 最好成绩那个大数字：Segoe Script 各个数字宽窄不一，宽的会顶到右边曲线的刻度上
    const best = document.querySelector(".summary .best");
    if (best) shrinkToFit(best, { min: 44 });
    const designer = document.querySelector(".fact.wide dd");
    if (designer) shrinkToFit(designer, { min: 22 });
    // 对应角色好几个、名字连起来太长：先缩字（最小 22px），还放不下换短一级的写法（同 /单曲）
    const names = document.querySelector(".kin .names");
    if (names) {
      shrinkToFit(names, { min: 22 });
      for (const text of JSON.parse(names.dataset.shorter || "[]")) {
        if (names.scrollWidth <= names.clientWidth + 1) break;
        names.textContent = text;
        names.style.fontSize = "";
        shrinkToFit(names, { min: 22 });
      }
    }
  }

  // ── 画框（assets/frame.webp：荷兰国立博物馆 BK-1960-10 代尔夫特陶镜框，抠掉背景、去掉顶上的贝壳、拉成了正矩形）──
  // 四条边画的花鸟各不相同，没有能反复铺的平直线脚，拼法跟 best 的金框不一样：
  // - 四条边各自铺满整条，在角上按 45° 斜切（跟真画框的拼角一样），角上只贴那片茛苕叶，叶子两侧淡出，盖住斜接缝。
  //   角块要是整块方的贴上去，方块边上那一小段原画面跟铺开的花纹接不上，看得出一道直缝。
  // - 上下两条边：拿它自己那一段，从正中往两头一正一反（左右镜像）排开，接缝两边是同一列像素，对得上。
  // - 左右两条边不能上下镜像（鸟和山石会倒过来）：左边框的一段接右边框左右翻过来的一段，轮流排，接缝处淡入淡出。
  // - 每条边都只取到内口为止：上边内口正中原来有个挂钩留下的小凸块，铺几遍就会出现几个小黑点。
  // 坐标是在 frame.webp（1976×1660）上量的像素。
  const FRAME = {
    src: "../assets/frame.webp",
    size: [1976, 1660],
    scale: 0.4,                                                       // 框宽 250 → 100 左右
    outer: { left: 12, top: 13, right: 1963, bottom: 1647 },          // 外沿
    opening: { left: 253, top: 261, right: 1721, bottom: 1407 },      // 内口
    split: { left: 300, top: 300, right: 1675, bottom: 1370 },        // 边上取画面的范围：离角 50 像素，叶尖不会被镜像成一对小盾牌
    leaf: [18, 30, 70, 82],                                           // 角叶沿斜接线留多宽：透明→不透明→不透明→透明（%）
    feather: 18,                                                      // 角块挨着两条边的那两侧淡出多少（%）
    fade: 30,                                                         // 左右两条边段与段之间淡入淡出多长（CSS 像素）
  };

  // 从一张大图上取一块（原图像素 [x, y, 宽, 高]）显示成 <img>，同 best 主题
  function cutout(src, [width, height], [sx, sy, sw, sh]) {
    const img = el("img");
    img.alt = "";
    img.src = src;
    img.style.setProperty("object-view-box", `inset(${sy}px ${width - sx - sw}px ${height - sy - sh}px ${sx}px)`);
    img.addEventListener("error", () => img.remove(), { once: true });
    return img;
  }

  const { scale: s, outer: o, opening: op, split: sp } = FRAME;
  // 每条边只取到内口往里 2 像素
  const rect = {
    top: [sp.left, o.top, sp.right - sp.left, op.top + 2 - o.top],
    bottom: [sp.left, op.bottom - 2, sp.right - sp.left, o.bottom - op.bottom + 2],
    left: [o.left, sp.top, op.left + 2 - o.left, sp.bottom - sp.top],
    right: [op.right - 2, sp.top, o.right - op.right + 2, sp.bottom - sp.top],
  };
  const band = { top: rect.top[3] * s, bottom: rect.bottom[3] * s, left: rect.left[2] * s, right: rect.right[2] * s };
  const inner = { left: (op.left - o.left) * s, right: (o.right - op.right) * s, top: (op.top - o.top) * s, bottom: (o.bottom - op.bottom) * s };
  const half = (v) => Math.round(v * 2) / 2;
  const px = (v) => v + "px";

  function buildFrame(W, H) {
    const box = $("frame");
    const holder = (x, y, w, h, polygon) => {
      const node = el("div", "frame-run");
      Object.assign(node.style, { left: px(x), top: px(y), width: px(w), height: px(h), clipPath: `polygon(${polygon})` });
      box.append(node);
      return node;
    };

    // 上下两条边：从正中往两头一正一反排，铺满整条（两头在角上被斜切）
    const mirrorRun = (node, source, length, thickness) => {
      const piece = half(source[2] * s);
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
      const piece = own[3] * s;
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

    mirrorRun(holder(0, 0, W, band.top, `0 0, ${W}px 0, ${W - band.right}px 100%, ${band.left}px 100%`), rect.top, W, band.top);
    mirrorRun(holder(0, H - band.bottom, W, band.bottom, `${band.left}px 0, ${W - band.right}px 0, ${W}px 100%, 0 100%`), rect.bottom, W, band.bottom);
    blendRun(holder(0, 0, band.left, H, `0 0, 100% ${band.top}px, 100% ${H - band.bottom}px, 0 ${H}px`), rect.left, rect.right, H, band.left);
    blendRun(holder(W - band.right, 0, band.right, H, `0 ${band.top}px, 100% 0, 100% ${H}px, 0 ${H - band.bottom}px`), rect.right, rect.left, H, band.right);

    // 四个角：只留斜接线上那片茛苕叶（沿斜线一条带子），再跟「挨着两条边的那两侧淡出」取交集，角块就没有直边了
    const [a, b, c, d] = FRAME.leaf;
    const f = FRAME.feather;
    const leafMask = (deg, sides) => [`linear-gradient(${deg}deg, transparent ${a}%, #000 ${b}%, #000 ${c}%, transparent ${d}%)`]
      .concat(sides.map((side) => `linear-gradient(to ${side}, transparent 0%, #000 ${f}%)`)).join(", ");
    const corner = (source, x, y, deg, sides) => {
      const img = cutout(FRAME.src, FRAME.size, source);
      Object.assign(img.style, { left: px(x), top: px(y), width: px(source[2] * s), height: px(source[3] * s), maskImage: leafMask(deg, sides), maskComposite: "intersect" });
      box.append(img);
    };
    corner([o.left, o.top, rect.left[2], rect.top[3]], 0, 0, 45, ["left", "top"]);
    corner([rect.right[0], o.top, rect.right[2], rect.top[3]], W - band.right, 0, 135, ["right", "top"]);
    corner([o.left, rect.bottom[1], rect.left[2], rect.bottom[3]], 0, H - band.bottom, 135, ["left", "bottom"]);
    corner([rect.right[0], rect.bottom[1], rect.right[2], rect.bottom[3]], W - band.right, H - band.bottom, 45, ["right", "bottom"]);
  }

  // ── 整张图 ──
  // 宽 2240：原来 2040 时图快成方的了（2040×1575），作者 2026-10-17 要横一点。油画原图是 3 : 2
  const WIDTH = 2240;
  const PAD = { x: 46, y: 36 };   // 正文离画框内口多远
  const MAX_RATIO = 1.75;         // 正文短（没打过、没有曲线）时图也不扁过这个比例，正文在中间

  async function main() {
    const page = $("page");
    const content = $("content");
    Object.assign(content.style, { left: px(inner.left + PAD.x), top: px(inner.top + PAD.y) });

    renderSong();
    renderLines();
    renderMine();
    for (const panel of document.querySelectorAll(".panel")) {
      for (const corner of ["tl", "tr", "bl", "br"]) panel.append(el("i", "star " + corner));
    }
    // 页脚不写玩家名（同 /单曲）
    $("credit").textContent = ["Generated by Anna Bot", "数据来自落雪查分器", data.time].filter(Boolean).join(" · ");

    void document.body.offsetHeight;
    await Promise.all(["16px \"Anna Hand\"", "700 16px \"Anna Hand Bold\"", "700 16px \"Anna Script\""]
      .map((font) => document.fonts.load(font).catch(() => null)));
    await document.fonts.ready;
    fitText();
    renderHistory();

    const W = WIDTH;
    const H = Math.max(Math.round(W / MAX_RATIO), Math.ceil(inner.top + PAD.y + content.offsetHeight + PAD.y + inner.bottom));
    Object.assign(page.style, { width: px(W), height: px(H) });
    content.style.top = px(inner.top + Math.max(PAD.y, (H - inner.top - inner.bottom - content.offsetHeight) / 2));

    // 画放在内口里，四边各往框底下多塞 6 像素；影子贴着内口
    const area = { left: inner.left, top: inner.top, width: W - inner.left - inner.right, height: H - inner.top - inner.bottom };
    const place = (node, extra) => Object.assign(node.style, {
      left: px(area.left - extra), top: px(area.top - extra), width: px(area.width + 2 * extra), height: px(area.height + 2 * extra),
    });
    place($("painting"), 6);
    place($("veil"), 6);
    place($("painting-shade"), 0);

    // 立绘（867×1136，左右镜像过）：比内口高 6%，脚下伸到框底下 40、右边 120，身子落在正文右边空出来的那一块
    const tall = area.height * 1.06;
    const wide = tall * (867 / 1136);
    Object.assign($("sibyl").style, { height: px(tall), width: px(wide), left: px(area.left + area.width + 120 - wide), top: px(area.top + area.height + 40 - tall) });

    buildFrame(W, H);
    ThemeKit.done({ element: page });
  }

  main().catch(ThemeKit.fail);
})();
