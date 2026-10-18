// 成绩列表：数据形状见 ../examples/preview-data.json（Lv.14+ 第 1 页，满页）和 ../examples/page-2.json（最后十张没打过）。
// 封印的边这类「随机」的东西用固定种子的伪随机数：同一份数据每次出图都一样。
(function () {
  "use strict";
  const data = ThemeKit.data();
  const $ = (id) => document.getElementById(id);

  const RANK_TEXT = { sssp: "SSS+", sss: "SSS", ssp: "SS+", ss: "SS", sp: "S+", s: "S", aaa: "AAA", aa: "AA", a: "A", bbb: "BBB", bb: "BB", b: "B", c: "C", d: "D" };
  // 这几档是金、银、铜的封印，其余（AAA 往下）一律是发黑的铁
  const SEALED = new Set(["sssp", "sss", "ssp", "ss", "sp", "s"]);
  const FULL_COMBO = { fullcombo: ["FC", "fc"], alljustice: ["AJ", "aj"], alljusticecritical: ["AJC", "ajc"] };
  const CLEARS = { hard: "HARD", brave: "BRAVE", absolute: "ABSOLUTE", catastrophy: "CATASTROPHY" };

  // 卡片的尺寸跟 theme.css 的 .grid / .card 一致
  const CARD_H = 172;
  const ROW_GAP = 18;
  // 安娜的立绘（assets/anna-fullbody.png，688×1151）画多高
  const ANNA = { size: [688, 1151], height: 1480 };
  // 油画（assets/painting.jpg，布莱兴《哥特教堂废墟》2608×3089）取哪一块：比例不够竖，所以只取右边一截（有尖拱窗和壁龛的那半），
  // 宽度拉满画布，不拉伸。[x, y, 宽, 高] 是原图像素；扫描件右边有一道 16 像素、顶上有几像素的白纸边，裁掉
  const PAINTING = { size: [2608, 3089], crop: [560, 6, 2030, 3083] };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  // ── 下面三段照搬 ../../song/renderer/theme.js（伪随机数、封印的边、从一张图上切一块），说明见那边和 ../../best/renderer/theme.js ──
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

  function cutout(src, [width, height], [sx, sy, sw, sh], className) {
    const img = el("img", className);
    img.alt = "";
    img.src = src;
    img.style.setProperty("object-view-box", `inset(${sy}px ${width - sx - sw}px ${height - sy - sh}px ${sx}px)`);
    img.addEventListener("error", () => img.remove(), { once: true });
    return img;
  }

  // 安娜的画框：荷兰国立博物馆一本福音书的背面封皮（BK-C-2003-1，利摩日一带，约 1200–1250 年，铜胎鎏金、凹刻珐琅）。
  // 外圈是四条长铜板，钴蓝底上心形卷草和天使一格一格交替，格子之间一道细金条、外沿錾齿纹边；里圈一道压出来的玫瑰花环金边。
  // ../assets/enamel.webp 是从封皮照片上切下来的格子（在分隔金条的正中切开，拼起来金条正好还原），按 2 倍分辨率缩好排在一张图上，
  // 怎么拉正、怎么切见 ../assets/README.md。pieces 是那张图上的像素 [x, y, 宽, 高]，由 ../design/make-enamel.html 打出来，重做素材要跟着换
  const ENAMEL = {
    src: "../assets/enamel.webp",
    size: [1342, 1091],
    res: 2,
    band: 72,       // 外圈珐琅那一圈的宽（CSS 像素）
    liner: 32,      // 里圈金边的宽
    pieces: {
      // 横的（上下两边用）：A1 连着左端的齿纹边、BA1 / BA3 是下边的左右两端；H 是心形卷草，A 是张开翅膀的天使
      A1: [0, 0, 174, 144], H1: [178, 0, 283, 144], A2: [465, 0, 164, 144], BH1: [633, 0, 295, 144], BA1: [932, 0, 177, 144], BA3: [1113, 0, 161, 144],
      // 竖的（左右两边用）：L1 连着上端的齿纹边、R5 连着下端；L2 / R2 是翅膀交叉在头顶的天使，L3 / R3 是长条的心形卷草
      L1: [0, 148, 144, 360], L2: [148, 148, 144, 189], L3: [296, 148, 144, 347], R2: [444, 148, 144, 193], R3: [592, 148, 144, 355], R5: [740, 148, 144, 361],
      // 里圈金边：竖着的一长段，玫瑰花环上下对称，所以一正一倒接着铺看不出接缝
      ROS: [1278, 0, 64, 1091],
    },
    // 每条边：两头是连着端头齿纹边的格子，中间两种格子交替，同一块格子轮流正着、镜像着用（"~" 表示左右镜像），看着不那么重复。
    // 封皮上破损多的格子（上下两边中间的几格、左右两边连着端头的另一块）没切
    sides: {
      top: { ends: ["A1", "A1~"], odd: ["H1", "BH1", "H1~", "BH1~"], even: ["A2", "A2~"] },
      bottom: { ends: ["BA1", "BA3"], odd: ["BH1", "H1", "BH1~", "H1~"], even: ["A2~", "A2"] },
      left: { ends: ["L1", "R5~"], odd: ["L2", "R2~", "L2~", "R2"], even: ["L3", "R3~", "L3~", "R3"] },
      right: { ends: ["L1~", "R5"], odd: ["R2", "L2~", "R2~", "L2"], even: ["R3", "L3~", "R3~", "L3"] },
    },
  };

  function framePadding() {
    return ENAMEL.band + ENAMEL.liner;
  }

  // 画框：外圈四条珐琅带（上下两条横贯全宽，左右两条夹在中间），里圈四段金边在角上斜接
  function drawFrame(box, holder) {
    const W = box.offsetWidth;
    const H = box.offsetHeight;
    const { band, liner, res, pieces, sides } = ENAMEL;
    const half = (v) => Math.round(v * 2) / 2;
    const piece = (name, className) => {
      const key = name.replace("~", "");
      const img = cutout(ENAMEL.src, ENAMEL.size, pieces[key], "enamel" + (name.endsWith("~") ? " mirror" : "") + (className ? " " + className : ""));
      return img;
    };
    // 沿一条边排格子：两头各一格，中间 odd、even 交替、以 odd 开头和结尾；挑格子数让总长最接近这条边，再整体拉伸（几个百分点）铺满。
    // 每格的起止对齐到半像素（2 倍图上的整像素），相邻两格之间才不会漏出一道细缝
    const lay = (side, length, across) => {
      const { ends, odd, even } = sides[side];
      const natural = (name) => { const r = pieces[name.replace("~", "")]; return (across ? r[2] : r[3]) / res; };
      const build = (n) => {
        const list = [ends[0]];
        for (let i = 0; i < n; i++) {
          list.push(odd[i % odd.length]);
          if (i < n - 1) list.push(even[i % even.length]);
        }
        list.push(ends[1]);
        return list;
      };
      let best = null;
      for (let n = 1; n < 80; n++) {
        const list = build(n);
        const total = list.reduce((sum, name) => sum + natural(name), 0);
        const misfit = Math.abs(Math.log(length / total));
        if (!best || misfit < best.misfit) best = { list, total, misfit };
        if (total > length * 1.2) break;
      }
      const k = length / best.total;
      let at = 0;
      return best.list.map((name) => {
        const from = half(at);
        at += natural(name) * k;
        return { name, from, size: half(at) - from };
      });
    };
    for (const cell of lay("top", W, true)) {
      const img = piece(cell.name);
      Object.assign(img.style, { left: cell.from + "px", top: "0px", width: cell.size + "px", height: band + "px" });
      holder.append(img);
    }
    for (const cell of lay("bottom", W, true)) {
      const img = piece(cell.name);
      Object.assign(img.style, { left: cell.from + "px", top: H - band + "px", width: cell.size + "px", height: band + "px" });
      holder.append(img);
    }
    for (const [side, x] of [["left", 0], ["right", W - band]]) {
      for (const cell of lay(side, H - 2 * band, false)) {
        const img = piece(cell.name);
        Object.assign(img.style, { left: x + "px", top: band + cell.from + "px", width: band + "px", height: cell.size + "px" });
        holder.append(img);
      }
    }

    // 里圈金边：一条竖着的金边（外侧在左），上下两段转 ±90°、右边那段左右镜像；两头按 45° 斜着切，四个角正好对上
    const tile = pieces.ROS[3] / res;
    const run = (length, transform) => {
      const strip = el("div", "enamel-run");
      Object.assign(strip.style, { width: liner + "px", height: length + "px", transform });
      strip.style.clipPath = `polygon(0 0, 0 100%, 100% calc(100% - ${liner}px), 100% ${liner}px)`;
      for (let i = 0; i * tile < length; i++) {
        const img = piece("ROS", i % 2 ? "flip" : "");
        Object.assign(img.style, { left: "0px", top: i * tile + "px", width: liner + "px", height: tile + 1 + "px" });
        strip.append(img);
      }
      holder.append(strip);
    };
    run(W - 2 * band, `translate(${W - band}px, ${band}px) rotate(90deg)`);
    run(W - 2 * band, `translate(${band}px, ${H - band}px) rotate(-90deg)`);
    run(H - 2 * band, `translate(${band}px, ${band}px)`);
    run(H - 2 * band, `translate(${W - band}px, ${band}px) scaleX(-1)`);
  }

  // ── 抬头 ──
  function renderHead() {
    const title = data.title || {};
    $("prefix").textContent = title.prefix || "";
    $("main").textContent = title.main || "";
    $("sub").textContent = title.sub || "";
    if (data.pages > 1) $("pageno").textContent = "第 " + data.page + " / " + data.pages + " 页";
    const stats = data.stats || {};
    const items = [["total", "谱面"], ["played", "已游玩"], ["ajc", "AJC"], ["aj", "AJ"], ["fc", "FC"], ["sssp", "SSS+"], ["sss", "SSS"]];
    const list = $("stats");
    for (const [key, label] of items) {
      if (stats[key] === undefined || stats[key] === null) continue;
      const box = el("div", "stat " + key);
      box.append(el("dt", null, label), el("dd", null, stats[key]));
      list.append(box);
    }
  }

  // ── 右上角的名片板：名牌版、称号、★转生 Lv.等级 + 名字、角色头像和段位、总 Rating ──
  function renderIdentity() {
    const player = data.player || {};
    // 没有玩家资料（老示例数据、或者接口没给）就不画这块，安娜照旧从顶上开始
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
    // 「★1 Lv.72」跟名字一行，星数和等级一样大（照 /b50）
    const level = $("level");
    if (player.reborn) level.append(el("span", "star", "★" + player.reborn));
    if (player.level !== null && player.level !== undefined) level.append(el("span", "lv", "Lv."), el("span", null, player.level));
    $("name").textContent = player.name || "";
    const rating = $("rating");
    rating.textContent = ThemeKit.format.rating(player.rating);
    rating.classList.add("tier-" + ThemeKit.ratingTier(player.rating));

    const medallion = document.querySelector(".medallion");
    if (player.character) {
      const chara = $("chara");
      chara.src = player.character;
      chara.addEventListener("error", () => { chara.remove(); medallion.classList.add("empty"); }, { once: true });
    } else {
      medallion.classList.add("empty");
    }
    // 段位（CLASS 勋章）挂在头像下面：缎带在下、勋章压在上面（照 /b50）
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

  // 名片板上的字放不下就往小缩（称号、名字；照 /b50 的 fitText）
  function fitPlate() {
    const trophy = document.querySelector(".trophy span");
    if (trophy) {
      const ratio = trophy.parentElement.clientWidth / trophy.scrollWidth;
      if (ratio < 1) trophy.style.transform = "scale(" + ratio.toFixed(3) + ")";
    }
    const name = $("name");
    if (!name) return;
    const room = name.parentElement.clientWidth - $("level").offsetWidth - 10;
    if (room > 0 && name.scrollWidth > room) name.style.transform = "scale(" + (room / name.scrollWidth).toFixed(3) + ")";
  }

  // ── 一张卡片 ──
  function card(chart, i) {
    const rnd = random(7919 + (chart.index || i) * 977);
    const played = chart.score !== null && chart.score !== undefined;
    const item = el("li", "card d" + chart.levelIndex + (played ? "" : " unplayed"));
    item.append(el("div", "vellum"));

    const jacket = el("div", "jacket");
    const img = el("img");
    img.alt = "";
    if (chart.jacket) img.src = chart.jacket;
    jacket.append(img);
    item.append(jacket);
    if (chart.index) item.append(el("div", "idx", chart.index));

    if (played && chart.rank) {
      const seal = el("div", "seal " + (SEALED.has(chart.rank) ? chart.rank : "low"));
      const wax = el("div", "wax");
      wax.style.clipPath = waxEdge(rnd);
      seal.append(wax, el("span", null, RANK_TEXT[chart.rank] || String(chart.rank).toUpperCase()));
      item.append(seal);
    }

    const body = el("div", "body");
    const title = el("div", "title-line", chart.title);
    title.lang = "ja";
    // 带希腊字母的曲名按两倍字号排、再 zoom 缩回来（见 theme.css 的 .title-line.greek）：
    // 25px 时霞鹜文楷的 Ω 右边那条细腿会被栅格化吃掉，放大一倍再缩回去才完整
    if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(chart.title)) title.classList.add("greek");
    body.append(title);
    body.append(el("div", "score", played ? ThemeKit.format.score(chart.score) : "未游玩"));
    const marks = el("div", "marks");
    if (played) {
      if (FULL_COMBO[chart.fullCombo]) marks.append(el("span", "mark " + FULL_COMBO[chart.fullCombo][1], FULL_COMBO[chart.fullCombo][0]));
      if (CLEARS[chart.clear]) marks.append(el("span", "mark tag " + chart.clear, CLEARS[chart.clear]));
      if (chart.fullChain) marks.append(el("span", "mark chain" + (chart.fullChain === "fullchain2" ? " gold" : ""), "FULL CHAIN"));
    }
    body.append(marks);
    const foot = el("div", "foot");
    foot.append(el("span", "const", chart.constant ? ThemeKit.format.constant(chart.constant) : chart.level || ""));
    if (played) foot.append(el("span", "arrow", "›"), el("span", "rating", ThemeKit.format.rating(chart.rating)));
    body.append(foot);
    item.append(body);
    return item;
  }

  function renderCards() {
    const grid = $("grid");
    (data.charts || []).forEach((chart, i) => grid.append(card(chart, i)));
  }

  // ── 排版收尾：字体到了才量得准 ──
  function shrinkToFit(node, min) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (node.scrollWidth > node.clientWidth + 0.5 && size > min) {
      size -= 1;
      node.style.fontSize = size + "px";
    }
  }

  // 大标题一行写不下（版本名「PARADISE LOST」「LUMINOUS PLUS」这种）：大字往小缩，最小 80px
  function fitHeading() {
    const heading = document.querySelector(".heading");
    const main = $("main");
    let size = parseFloat(getComputedStyle(main).fontSize);
    while (heading.scrollWidth > heading.clientWidth + 0.5 && size > 80) {
      size -= 4;
      main.style.fontSize = size + "px";
    }
  }

  // 一行通关标记放不下：整行先缩（最小 15px），还放不下从后往前去掉
  function fitMarks(row) {
    let size = parseFloat(getComputedStyle(row).fontSize);
    while (row.scrollWidth > row.clientWidth + 0.5 && size > 15) {
      size -= 1;
      row.style.fontSize = size + "px";
    }
    while (row.scrollWidth > row.clientWidth + 0.5 && row.lastChild) row.lastChild.remove();
  }

  // 安娜那块占几行：抬头一行，再加几行卡片，加起来跟立绘差不多高
  function placeAnna(canvas) {
    const head = document.querySelector(".head");
    const stand = $("stand");
    const headH = head.getBoundingClientRect().height;
    const rows = Math.max(1, Math.round((ANNA.height - headH) / (CARD_H + ROW_GAP)));
    stand.style.gridRow = "1 / span " + (rows + 1);
    const base = canvas.getBoundingClientRect();
    const box = stand.getBoundingClientRect();
    // 右上角有名片板时，安娜从板子下面开始，立绘按剩下的高度等比缩小（不裁切，也不压到卡片上）
    const identity = document.querySelector(".identity");
    const top = identity ? identity.getBoundingClientRect().bottom - base.top + 8 : 18;
    const height = Math.max(240, Math.min(ANNA.height, box.bottom - base.top - top - 4));
    const width = height * ANNA.size[0] / ANNA.size[1];
    const anna = $("anna");
    // 立绘里人站在偏右（头发往左边飘），让身子落在那两列的中间
    Object.assign(anna.style, {
      height: height + "px",
      width: width + "px",
      left: (box.left - base.left + box.width * 0.5 - width * 0.56) + "px",
      top: top + "px",
    });
    // 卡片很少的时候画布也要高过名片板和立绘
    canvas.style.minHeight = top + height + 70 + "px";
  }

  function placePainting(canvas) {
    const [sx, sy, sw, sh] = PAINTING.crop;
    const [width, height] = PAINTING.size;
    const img = $("painting");
    const w = canvas.offsetWidth;
    Object.assign(img.style, { width: w + "px", height: (w * sh / sw) + "px" });
    img.style.setProperty("object-view-box", `inset(${sy}px ${width - sx - sw}px ${height - sy - sh}px ${sx}px)`);
  }

  async function main() {
    renderHead();
    renderIdentity();
    renderCards();
    $("credit").textContent = data.credit || "";

    const page = $("page");
    page.style.padding = framePadding() + "px";

    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    fitHeading();
    fitPlate();
    document.querySelectorAll(".title-line").forEach((node) => shrinkToFit(node, node.classList.contains("greek") ? 42 : 21));
    document.querySelectorAll(".card:not(.unplayed) .score").forEach((node) => shrinkToFit(node, 28));
    document.querySelectorAll(".marks").forEach(fitMarks);

    const canvas = $("canvas");
    placeAnna(canvas);
    // 这张图按 1.8 倍出（2 倍超过 5 MB，见 ../README.md）：高凑成 5 的整数倍，乘出来才是整像素，底边不会多出半行（宽 2060 本来就是）
    const height = page.getBoundingClientRect().height;
    const extra = Math.ceil(height / 5 - 1e-6) * 5 - height;
    if (extra > 0.01) canvas.style.minHeight = canvas.getBoundingClientRect().height + extra + "px";
    placePainting(canvas);
    drawFrame(page, $("frame"));
    await ThemeKit.done({ element: page });
  }

  main().catch(ThemeKit.fail);
})();
