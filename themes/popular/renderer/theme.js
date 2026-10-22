(function () {
  "use strict";
  const data = ThemeKit.data(), fmt = ThemeKit.format, MARKS = ThemeKit.MARKS;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = String(text); return n; };

  // 排版的几个尺寸（CSS 像素），跟 theme.css 的 --frame-w、--content-w 一致
  const SIZE = {
    height: 1780,
    frame: 84,
    contentLeft: 132,
    contentWidth: 1680,
    // 画框里的画面照油画原图的比例（作者 2026-10-20 定的规矩）；太窄的画右边站不下萨拉基亚，这时加宽、油画上下裁掉一点
    minWidth: 2800,
    art: [760, 1135],   // 立绘原图的大小
    artGap: 40,         // 立绘那一栏离榜单多远
    artMargin: 70,      // 上下居中，头顶、裙摆离画框至少留多少
    artMaxScale: 1.45,  // 最多放大到原图的几倍（再大就糊了；半透明了糊一点看不太出来）
  };
  // 油画：透纳《狄多建设迦太基》，原始亮度（作者 2026-10-22 在中等、偏暗、原始三档里选的）；
  // 比例照原图 6288×4226。这么宽的画站不下萨拉基亚，画布按 minWidth 加宽，油画上下裁掉一点
  const PAINTING = { src: "../assets/painting.jpg", ratio: 6288 / 4226 };
  const ART = "../assets/salacia-fullbody.png";

  // 画框：荷兰国立博物馆 BK-1971-122，乌木镜框配银丝花（拱顶的镜子）。照它的做法拼成横框：
  //   左右是银丝花的乌木立柱（羽毛状的一节花样上下接，隔一节翻一下，接缝就是对称的）
  //   上下是乌木银珠的扭绳纹横档（原件底边中间扭向反过来，这里也从中间往两边对称地接）
  //   四个角是原件脚上那块带椭圆银泡的方墩，连着上面带铆钉的银箍；拱顶是弧的，用不上
  // 三块素材是博物馆 IIIF（iiif.micr.io/jiVVs）按下面的坐标原样裁的，坐标是原图（6049×7478）上的像素；
  // scale 把原图像素换成 CSS 像素（立柱 255 → 84）
  // 横档只取左边方墩和第一个银箍之间那段（x 900–2230）：带上银箍的话镜像接起来是两个银箍挨着；
  // 上沿从 y 6818 起，再往上是原件镜子的斜边，会带进一条彩虹反光；下沿到 7004，再往下是地面
  const FRAME = {
    scale: 0.33,
    side: { x: 645, y: 2950, w: 255, h: 1000 },
    rail: { x: 900, y: 6818, w: 1330, h: 186 },
    corner: { x: 627, y: 6585, w: 256, h: 483 },
  };
  const framePiece = (name) => "../assets/frame-" + name + ".jpg";
  const FRAME_SIZE = {
    side: Math.round(FRAME.side.w * FRAME.scale),     // 左右框的宽
    rail: Math.round(FRAME.rail.h * FRAME.scale),     // 上下框的高
    corner: Math.round(FRAME.corner.h * FRAME.scale), // 角上方墩的高（宽跟立柱一样）
  };

  const DIFF = ["BAS", "ADV", "EXP", "MAS", "ULT", "WE"];
  const RANK_TEXT = { sssp: "SSS+", sss: "SSS", ssp: "SS+", ss: "SS", sp: "S+", s: "S", aaa: "AAA", aa: "AA", a: "A", bbb: "BBB", bb: "BB", b: "B", c: "C", d: "D" };
  const SEALED = new Set(["sssp", "sss", "ssp", "ss", "sp", "s"]);
  const markOf = (value, extra) => {
    const item = MARKS[value];
    return item ? el("span", "mark" + (extra ? " " + extra : "") + " " + item.kind, item.text) : null;
  };

  // 画框拼起来：每条边一个裁切的盒子，里面一节一节放 <img>（CSS 背景图等不到加载完，见 themes/README.md）
  function buildFrame(width, height) {
    const root = $("frame");
    root.classList.add("built");
    const { side, rail, corner } = FRAME_SIZE;
    const box = (style) => { const node = el("div", "frame-run"); Object.assign(node.style, style); root.append(node); return node; };
    const tile = (parent, name, w, h, style, transform) => {
      const img = el("img");
      img.alt = "";
      img.src = framePiece(name);
      Object.assign(img.style, { width: w + "px", height: h + "px", ...style });
      if (transform) img.style.transform = transform;
      parent.append(img);
    };
    // 左右立柱：从方墩下面接到对面的方墩，隔一节上下翻一下；右边整条左右翻，花样的外沿朝外
    const sideTile = Math.round(FRAME.side.h * FRAME.scale);
    for (const right of [false, true]) {
      const run = box({ left: (right ? width - side : 0) + "px", top: corner + "px", width: side + "px", height: (height - 2 * corner) + "px" });
      for (let y = 0, i = 0; y < height - 2 * corner; y += sideTile, i++) {
        tile(run, "side", side, sideTile, { top: y + "px" }, [right ? "scaleX(-1)" : "", i % 2 ? "scaleY(-1)" : ""].join(" ").trim());
      }
    }
    // 上下横档：从中间往两边接，左边第一节原样、右边第一节左右翻，中间正好对称（原件底边就是这样）；上面一条上下翻
    const railTile = Math.round(FRAME.rail.w * FRAME.scale);
    const runWidth = width - 2 * side;
    for (const top of [true, false]) {
      const run = box({ left: side + "px", top: (top ? 0 : height - rail) + "px", width: runWidth + "px", height: rail + "px" });
      const center = runWidth / 2;
      for (let k = 0; center - k * railTile > -railTile; k++) {
        tile(run, "rail", railTile, rail, { left: Math.round(center - (k + 1) * railTile) + "px" }, [k % 2 ? "scaleX(-1)" : "", top ? "scaleY(-1)" : ""].join(" ").trim());
        tile(run, "rail", railTile, rail, { left: Math.round(center + k * railTile) + "px" }, [k % 2 ? "" : "scaleX(-1)", top ? "scaleY(-1)" : ""].join(" ").trim());
      }
    }
    // 四个角：原件左下角的方墩，别的角照着翻
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const run = box({ left: (x ? width - side : 0) + "px", top: (y ? height - corner : 0) + "px", width: side + "px", height: corner + "px" });
      tile(run, "corner", side, corner, {}, [x ? "scaleX(-1)" : "", y ? "" : "scaleY(-1)"].join(" ").trim());
    }
  }

  function layout() {
    const page = $("page");
    const { side, rail } = FRAME_SIZE;
    const width = Math.max(SIZE.minWidth, Math.round(2 * side + (SIZE.height - 2 * rail) * PAINTING.ratio));
    page.style.width = width + "px";
    page.style.height = SIZE.height + "px";
    // 油画垫到框下 4px，免得框的内口露缝
    Object.assign(document.querySelector(".scene").style, { left: (side - 4) + "px", right: (side - 4) + "px", top: (rail - 4) + "px", bottom: (rail - 4) + "px" });
    buildFrame(width, SIZE.height);
    const painting = $("painting");
    painting.src = PAINTING.src;
    // 萨拉基亚：右边那一栏，上下左右都居中
    const left = SIZE.contentLeft + SIZE.contentWidth + SIZE.artGap;
    const columnWidth = width - side - SIZE.artGap - left;
    const columnHeight = SIZE.height - 2 * rail - 2 * SIZE.artMargin;
    const scale = Math.min(columnWidth / SIZE.art[0], columnHeight / SIZE.art[1], SIZE.artMaxScale);
    const artWidth = Math.round(SIZE.art[0] * scale), artHeight = Math.round(SIZE.art[1] * scale);
    const art = $("salacia");
    art.src = ART;
    Object.assign(art.style, {
      width: artWidth + "px", height: artHeight + "px",
      left: Math.round(left + (columnWidth - artWidth) / 2) + "px",
      top: Math.round((SIZE.height - artHeight) / 2) + "px",
    });
  }

  function header() {
    $("subtitle").textContent = data.updatedAt ? "落雪 " + data.updatedAt + " 更新" : "";
  }

  function rankCell(row) {
    const cell = el("div", "rank");
    cell.append(row.rank <= 3 ? el("span", "medal m" + row.rank, row.rank) : el("span", "no", row.rank));
    const change = row.change || { kind: "new" };
    const text = { up: "▲" + change.value, down: "▼" + change.value, same: "—", new: "NEW" }[change.kind] || "";
    cell.append(el("span", "change " + change.kind, text));
    return cell;
  }

  function mine(score) {
    if (!score) return el("div", "mine none", "未游玩");
    const box = el("div", "mine");
    box.append(el("div", "score", fmt.score(score.score)));
    const badges = el("div", "badges");
    const seal = el("div", "seal " + (SEALED.has(score.rank) ? score.rank : "low"));
    seal.append(el("div", "wax"), el("span", null, RANK_TEXT[score.rank] || String(score.rank || "").toUpperCase()));
    badges.append(seal);
    for (const mark of [markOf(score.fullCombo), markOf(score.clear, "tag"), markOf(score.fullChain)]) if (mark) badges.append(mark);
    box.append(badges);
    return box;
  }

  function rowOf(row) {
    const li = el("li", "row d" + row.levelIndex);
    const jacket = el("figure", "jacket");
    const img = el("img");
    img.alt = "";
    if (row.jacket) img.src = row.jacket;
    else jacket.classList.add("missing");
    img.addEventListener("error", () => jacket.classList.add("missing"), { once: true });
    jacket.append(img);

    const main = el("div", "main");
    const title = el("div", "title-line", row.title);
    title.lang = /[぀-ヿ]/.test(row.title) ? "ja" : "zh-CN";
    // 希腊字母曲名按两倍字号排、zoom 缩回（霞鹜文楷的 Ω 细腿在小字号会被吃掉，见 /b50）
    if (/[Ͱ-Ͽἀ-῿]/.test(row.title)) title.classList.add("greek");
    const facts = el("div", "facts");
    facts.append(el("span", "diff", DIFF[row.levelIndex] || ""));
    // WORLD'S END 没有定数：写难度字和星数
    const constText = row.levelIndex === 5 ? (row.kanji || "") + (row.star ? " ★" + row.star : "")
      : row.constant ? fmt.constant(row.constant) : row.level || "";
    const constant = el("span", "const", constText);
    facts.append(constant);
    if (row.score && row.score.rating !== null && row.score.rating !== undefined) {
      constant.append(el("i", null, "›"));
      facts.append(el("span", "rating", fmt.rating(row.score.rating)));
    }
    main.append(title, facts, el("div", "artist", row.artist || ""));

    li.append(rankCell(row), jacket, main);
    if (data.scored) li.append(mine(row.score));
    return li;
  }

  function boards() {
    const root = $("boards");
    for (const range of data.ranges) {
      const board = el("section", "board" + (data.scored ? " scored" : ""));
      const head = el("h2", null, range.label);
      if (range.start && range.end) head.append(el("span", "period", range.start + " – " + range.end));
      if (data.scored && range.rows.length) {
        const played = el("span", "played", "打过");
        played.append(el("b", null, range.played), " / " + range.rows.length);
        head.append(played);
      }
      const list = el("ol", "rows");
      for (const row of range.rows) list.append(rowOf(row));
      if (!range.rows.length) list.append(el("li", "row empty", "落雪这段时间的榜是空的"));
      board.append(head, list);
      root.append(board);
    }
  }

  function footer() {
    $("credit").textContent = "Generated by Anna Bot · 数据来自落雪查分器，只统计同步到落雪的成绩 · " + data.time;
  }

  // ── 名片板：照 /年度总结 ──
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
    const overall = $("rating");
    overall.textContent = fmt.rating(player.rating);
    overall.classList.add("tier-" + ThemeKit.ratingTier(player.rating));
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

  function shrinkToFit(node, { min, step = 0.5, fits }) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (!fits() && size > min) {
      size -= step;
      node.style.fontSize = size + "px";
    }
  }

  function fitText() {
    const fitsWidth = (node) => () => node.scrollWidth <= node.clientWidth + 1;
    // 曲名放不下先缩到 23px，再放不下用省略号（照 /b50）
    for (const title of document.querySelectorAll(".title-line")) {
      shrinkToFit(title, { min: title.classList.contains("greek") ? 46 : 23, fits: fitsWidth(title) });
    }
    for (const score of document.querySelectorAll(".mine .score")) shrinkToFit(score, { min: 30, fits: fitsWidth(score) });
    // 通关标记一行放不下：先缩到 15px，再去掉最后一个
    for (const badges of document.querySelectorAll(".badges")) {
      const marks = [...badges.querySelectorAll(".mark")];
      for (let size = 18; !fitsWidth(badges)() && size > 15; size -= 0.5) for (const mark of marks) mark.style.fontSize = size + "px";
      while (!fitsWidth(badges)() && badges.querySelectorAll(".mark").length) badges.lastChild.remove();
    }
    const trophy = document.querySelector(".trophy span");
    if (trophy) {
      const ratio = (trophy.parentElement.clientWidth - 24) / trophy.scrollWidth;
      if (ratio < 1) trophy.style.transform = "scale(" + ratio.toFixed(3) + ")";
    }
    const who = document.querySelector(".plate-name .who");
    if (who) {
      const room = who.parentElement.clientWidth - 6;
      if (room > 0 && who.scrollWidth > room) who.style.transform = "scale(" + Math.max(0.3, room / who.scrollWidth).toFixed(3) + ")";
    }
  }

  async function main() {
    layout(); header(); boards(); footer(); renderIdentity();
    await document.fonts.ready;
    fitText();
    await ThemeKit.done({ element: $("page") });
  }
  main().catch(ThemeKit.fail);
})();
