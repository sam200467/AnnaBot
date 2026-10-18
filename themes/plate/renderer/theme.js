// 牌子进度：数据形状见 ../examples/preview-data.json（SUN PLUS，81 首）、../examples/new.json（NEW，曲目最多的 102 首）、
// ../examples/xverse.json（X-VERSE，还没有称号）。
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
  // 卡片脚下的小牌子：三种牌子的档写成 AJ / SSS / S，S 以下写评级（褪色），没打过写「—」
  const TIER_TEXT = { aj: "AJ", sss: "SSS", s: "S" };
  const DIFFICULTIES = ["BASIC", "ADVANCED", "EXPERT", "MASTER"];

  // 版面：十列，右边两列只在前两行卡片处是涅菲谢；跟 theme.css 的 .grid / .card 一致
  const COLUMNS = 10;
  const STAND_COLUMNS = 2;
  // 立绘占右边两列；从抬头一直占到前两行卡片（第 1～4 行），挡住 dense 把卡片塞到表格右边
  const STAND_SPAN = 4;
  // 第 1 行抬头、第 2 行空着（半张卡的高度），第 3 行才是第一行卡片
  const FIRST_ROW = 3;
  // 涅菲谢的立绘（assets/nefeshe-fullbody.png，900×1136）画多高：两列宽 816，按比例 1030
  const SIBYL = { size: [900, 1136], height: 1030 };
  // 油画（assets/painting.jpg，科尔《人生的旅程·青年》）的原图比例：按宽铺满，不裁左右
  const PAINTING = { size: [5117, 3501] };
  // A 的绿珐琅实物框收窄到 100；分块等比裁切见 materials.js。
  const FRAME = 100;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  // 卡片上的白蝶、紫罗兰：<symbol> 在 theme.html 里只放一份，这里用 <use> 引
  const SVG_NS = "http://www.w3.org/2000/svg";
  function motif(id, className, viewBox) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#" + id);
    svg.append(use);
    return svg;
  }

  // ── 下面两段照搬 ../../list/renderer/theme.js（伪随机数、封印的边），说明见那边和 ../../best/renderer/theme.js ──
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

  // ── 抬头 ──
  function renderHeading() {
    const title = data.title || {};
    $("main").textContent = title.main || "";
    $("sub").textContent = title.sub || "";
  }

  // 左上角的名片板：名牌版、称号、★转生 Lv.等级 + 名字、角色头像和段位、总 Rating（照 ../../list/renderer/theme.js）
  function renderIdentity() {
    const player = data.player || {};
    if (!player.name) { $("identity").remove(); return; }
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
  }

  function fitPlate() {
    const trophy = document.querySelector(".trophy span");
    if (trophy) {
      const ratio = trophy.parentElement.clientWidth / trophy.scrollWidth;
      if (ratio < 1) trophy.style.transform = "scale(" + ratio.toFixed(3) + ")";
    }
    const name = $("name");
    if (!name || !$("level")) return;
    const room = name.parentElement.clientWidth - $("level").offsetWidth - 10;
    if (room > 0 && name.scrollWidth > room) name.style.transform = "scale(" + (room / name.scrollWidth).toFixed(3) + ")";
  }

  // 统计表：三行（S / SSS / AJ），四列难度；称号名不写在表里（作者 2026-10-18 要去掉），S/SSS/AJ 放大居中
  function renderTable() {
    const table = $("table");
    const info = data.table || { total: 0, rows: [] };
    const head = el("tr");
    head.append(el("th", "corner", "共 " + info.total + " 首"));
    DIFFICULTIES.forEach((name, i) => head.append(el("th", "d" + i, name)));
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const row of info.rows || []) {
      const tr = el("tr", "row-" + row.key);
      tr.append(el("th", null, row.label));
      (row.counts || []).forEach((count) => tr.append(el("td", count === info.total && info.total > 0 ? "full" : null, count)));
      tbody.append(tr);
    }
    table.append(thead, tbody);
  }

  // ── 一张卡片：MASTER 的成绩，脚下三颗小牌子是 BASIC / ADVANCED / EXPERT ──
  function card(chart, i) {
    const rnd = random(7919 + (chart.index || i) * 977);
    const played = chart.score !== null && chart.score !== undefined;
    const item = el("li", "card d" + chart.levelIndex + (played ? "" : " unplayed"));
    item.append(el("div", "pearl"));

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
    if (/[Ͱ-Ͽἀ-῿]/.test(chart.title)) title.classList.add("greek");
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
    const tiers = el("span", "tiers");
    (chart.tiers || []).forEach((tier, d) => {
      const known = TIER_TEXT[tier];
      tiers.append(el("span", "tier d" + d + (known ? " " + tier : tier ? " low" : " none"), known || (tier ? RANK_TEXT[tier] || tier.toUpperCase() : "—")));
    });
    foot.append(tiers);
    body.append(foot);
    item.append(body);
    return item;
  }

  // ── 左下角的版本总览 ──
  function renderOverview() {
    const overview = data.overview || {};
    const box = $("overview");
    const facts = el("div", "facts");
    facts.append(el("h2", null, (data.version && data.version.title) || ""));
    const counts = el("table", "counts");
    const names = el("tr");
    const values = el("tr");
    const cells = [["曲数", overview.songs], ["谱面数", overview.charts]].concat((overview.levels || []).map((item) => [item.level, item.count]));
    for (const [name, value] of cells) {
      names.append(el("th", null, name));
      values.append(el("td", null, value));
    }
    counts.append(names, values);
    facts.append(counts);
    const hard = el("div", "hard");
    for (const row of overview.hard || []) {
      hard.append(el("div", "lv", row.level));
      const line = el("div", "row");
      for (const item of row.jackets || []) {
        const img = el("img");
        img.alt = "";
        if (item.jacket) img.src = item.jacket;
        img.addEventListener("error", () => { img.removeAttribute("src"); }, { once: true });
        line.append(img);
      }
      if (row.count > (row.jackets || []).length) line.append(el("span", "more", "+" + (row.count - row.jackets.length)));
      hard.append(line);
    }
    facts.append(hard);
    box.append(facts);

    // 三个称号：拿到了的亮着写「已达成」，没拿到的灰着写还差几张谱面（四个难度加起来）；还没有称号的版本写一句
    const trophies = overview.trophies || [];
    const honors = el("div", "honors");
    box.append(honors);
    if (!trophies.length) {
      honors.append(el("p", "none", ((data.version && data.version.name) || "这个版本") + " 还没有 Spirit / Tribute / Legend 称号"));
      return;
    }
    const total = (data.table || {}).total || 0;
    for (const trophy of trophies) {
      const row = ((data.table || {}).rows || []).find((item) => item.key === trophy.key);
      const missing = row ? row.counts.reduce((sum, count) => sum + (total - count), 0) : 0;
      const line = el("div", "honor row-" + trophy.key + (trophy.done ? "" : " todo"));
      const img = el("img");
      img.alt = "";
      if (trophy.image) img.src = trophy.image;
      img.addEventListener("error", () => img.remove(), { once: true });
      line.append(el("b", null, trophy.label), img, el("span", null, trophy.done ? "已达成" : "还差 " + missing + " 张谱面"));
      honors.append(line);
    }
  }

  // ── 排版收尾：字体到了才量得准 ──
  function shrinkToFit(node, min) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (node.scrollWidth > node.clientWidth + 0.5 && size > min) {
      size -= 1;
      node.style.fontSize = size + "px";
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

  // 版本名太长（PARADISE LOST、LUMINOUS PLUS）挤到统计表：大字往小缩，最小 84px
  function fitHeading() {
    const head = document.querySelector(".head");
    const main = $("main");
    let size = parseFloat(getComputedStyle(main).fontSize);
    while (head.scrollWidth > head.clientWidth + 0.5 && size > 84) {
      size -= 4;
      main.style.fontSize = size + "px";
    }
  }

  // 摆格子：涅菲谢只在前两行卡片处占两列（第 3、4 行），卡片从第 3 行开始；
  // 版本总览固定在画布左下角，不占网格位置；收尾时根据最后一行卡片加高画布，给总览留出空间。
  // 从少到多试总行数，卡片放得下的最少行数就是答案，卡片按 dense 自动填进剩下的格子
  function placeGrid() {
    const cards = (data.cards || []).length;
    const beside = COLUMNS - STAND_COLUMNS;
    const upperEnd = FIRST_ROW + 1;
    let rows = Math.max(STAND_SPAN, FIRST_ROW + 1);
    for (;;) {
      let free = 0;
      for (let r = FIRST_ROW; r <= rows; r++) free += r <= upperEnd ? beside : COLUMNS;
      if (free >= cards) break;
      rows++;
    }
    $("stand").style.gridRow = "1 / span " + STAND_SPAN;
  }

  // 涅菲谢贴在右边两列的最右侧（作者要她再往右），从画布顶上开始
  function placeSibyl(canvas) {
    const base = canvas.getBoundingClientRect();
    const box = $("stand").getBoundingClientRect();
    const height = Math.max(240, Math.min(SIBYL.height, box.bottom - base.top - 12));
    const width = height * SIBYL.size[0] / SIBYL.size[1];
    Object.assign($("sibyl").style, {
      height: height + "px",
      width: width + "px",
      left: (box.left - base.left + box.width - width) + "px",
      top: "8px",
    });
  }

  // 画按原比例铺满宽度；画布比画高时下沿渐隐，比画矮时裁掉画的下面（左右一点不裁）
  function placePainting(canvas) {
    const img = $("painting");
    const w = canvas.offsetWidth;
    const h = w * PAINTING.size[1] / PAINTING.size[0];
    Object.assign(img.style, { width: w + "px", height: h + "px" });
    // 只比画高几个像素（凑整高）时不要把画的下沿渐隐掉，否则整幅画会被吃掉一截
    img.classList.toggle("fade", canvas.offsetHeight > h + 120);
  }

  async function main() {
    renderHeading();
    renderIdentity();
    renderTable();
    const grid = $("grid");
    (data.cards || []).forEach((chart, i) => grid.append(card(chart, i)));
    renderOverview();
    $("credit").textContent = data.credit || "";

    const page = $("page");
    page.style.padding = FRAME + "px";
    page.style.setProperty("--frame", FRAME + "px");

    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    fitPlate();
    fitHeading();
    document.querySelectorAll(".title-line").forEach((node) => shrinkToFit(node, node.classList.contains("greek") ? 42 : 21));
    document.querySelectorAll(".card:not(.unplayed) .score").forEach((node) => shrinkToFit(node, 28));
    document.querySelectorAll(".marks").forEach(fitMarks);

    placeGrid();
    const canvas = $("canvas");
    placeSibyl(canvas);
    // 画布至少留到整幅画的高度：曲子少的版本（X-VERSE 只有几十张卡）下面也露出整幅画，不把画裁掉；
    // 这张图按 1.5 或 1.4 倍出（见 src/features/plate.cjs）：高凑成 10 的整数倍，乘出来才是整像素，底边不会多出半行（宽本来就是）
    canvas.style.minHeight = (canvas.offsetWidth * PAINTING.size[1] / PAINTING.size[0]) + "px";
    // 总览钉在画布左下角；卡片多到最后一行的底边压到它时，把画布加高一点，让它落到卡片下面
    const overview = $("overview");
    const lastCard = document.querySelector(".card:last-child");
    if (lastCard) {
      const overlap = lastCard.getBoundingClientRect().bottom - overview.getBoundingClientRect().top;
      if (overlap > 0) canvas.style.minHeight = (canvas.offsetHeight + overlap + 16) + "px";
    }
    const height = page.getBoundingClientRect().height;
    const extra = Math.ceil(height / 10 - 1e-6) * 10 - height;
    if (extra > 0.01) canvas.style.minHeight = canvas.getBoundingClientRect().height + extra + "px";
    placePainting(canvas);
    renderPlateFrame(page, FRAME);
    await ThemeKit.done({ element: page });
  }

  main().catch(ThemeKit.fail);
})();
