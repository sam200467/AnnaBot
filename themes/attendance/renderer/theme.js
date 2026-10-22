(function () {
  "use strict";
  const data = ThemeKit.data(), fmt = ThemeKit.format;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const LEVELS = ["BAS", "ADV", "EXP", "MAS", "ULT", "WE"];
  const PITCH = 31;   // 日历一格 26 + 间距 5
  // 列表这块最高多少：两栏 12 行（24 张）时正好排满 1780 高的图。张数少时行高放大把它填满，不在列表和日历中间留空；
  // 一行最高 ROW_MAX（再高就成海报了），还填不满（6 张以下）就让整张图变矮
  const ROWS_AREA = 742;
  const ROW_MAX = 118;
  const ROW_MIN = 56;
  const WIDE_LIMIT = 12;      // 12 张以内排一栏
  const MAX_TRIES = 6;        // 一栏时每一次的分数最多写几个
  const TITLE_ROOM = 12;      // 一栏时曲名至少留几个字宽（em），每一次的分数写不下就少写几个
  const MARGIN_BOTTOM = 106;  // 页脚下面到图片底边：画框 80 + 留白
  const WIDTH = 2700;

  // 画框：荷兰国立博物馆 BK-1962-51，约 1690 年的胡桃木镜框，四角和边上嵌着木片、骨片拼的花（作者 2026-10-22 从 F1～F4 里选的 F1）。
  // 原件左右上下对称，素材只裁了左上角、上边一段、左边一段（design/prepare-materials.py，按 2 倍存），别的角和边翻过来用。
  // 四角和边条同一个缩放比（框宽 80，不拉伸花纹）；图的高度会变（1156～1780），边条整段整段地排：
  //   上下：段数取偶数，隔一段左右翻一下，接缝两边对称，椭圆花格不会被切成半个
  //   左右：花瓶要正着，不翻，一段接一段
  //   多出来的长度从每段两头的素胡桃木上平均裁掉（两头各有 400 多原图像素的余量，最矮的图也裁不到花格）
  const FRAME = { band: 80, corner: 184, top: 127, side: 269.5 };

  function header() {
    const v = data.visit;
    const p = $("visit-time");
    p.append(v.date + " " + v.weekday + "　", el("span", "clock", v.start));
    if (v.end !== v.start) p.append(" ～ ", el("span", "clock", v.end));
  }

  function stats() {
    const v = data.visit;
    const cell = (cls, label, value, unit, prefix) => {
      const root = el("div", "stat " + cls), line = el("div", "value");
      root.append(el("label", "", label));
      if (prefix) line.append(prefix);
      line.append(el("b", "", String(value)), unit);
      root.append(line);
      $("stats").append(root);
    };
    cell("minutes", "时长", v.minutes, "分钟", "约");
    cell("plays", "游玩", v.plays, "次");
    cell("charts", "谱面", v.charts, "张");
    cell("record", "新纪录", v.newRecords, "张");
    cell("failed", "强制结束", v.failed, "次");
  }

  // 打了几次写成「(3pc)」，只打一次的不写。写「×3」像是同一个分数打了三次（作者 2026-10-23）
  const playCount = (row) => (row.count > 1 ? "(" + row.count + "pc)" : "");

  // 一栏时写这张谱面每一次的分数，被强制结束的写 ✕。只打一次的也写那一次（作者 2026-10-22：跟打了几次的行一个样子，
  // 不然有的行分数左边有小字、有的没有）。最多写 keep 个，后面的写成「… 共 N 次」；
  // 一个都写不下就退回打了几次（playCount），只打一次的就空着（见 main 里让曲名那段）
  function fillTries(box, row, keep) {
    box.replaceChildren();
    box.dataset.keep = keep;
    if (keep <= 0) { box.textContent = playCount(row); return; }
    const shown = row.attempts.slice(0, keep);
    shown.forEach((value, i) => {
      if (i) box.append(el("span", "", "·"));
      box.append(value == null ? el("span", "failed", "✕") : el("span", "", fmt.score(value)));
    });
    if (shown.length < row.attempts.length) box.append(el("span", "more", "… 共 " + row.attempts.length + " 次"));
  }
  function tries(row) {
    const box = el("span", "tries");
    box.row = row;
    fillTries(box, row, row.attempts.length > MAX_TRIES ? MAX_TRIES - 1 : row.attempts.length);
    return box;
  }

  function rows() {
    const list = data.rows;
    const wide = list.length <= WIDE_LIMIT;
    const columns = wide ? 1 : 2;
    const perColumn = Math.max(1, Math.ceil(list.length / columns));
    const notes = [];
    if (data.omitted) notes.push("另有 " + data.omitted + " 张谱面没画");
    if (data.visit.truncated) notes.push("这场打得多，最近 50 次游玩里只看得到这些");
    const area = ROWS_AREA - (notes.length ? 44 : 0);
    const rowHeight = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(area / perColumn)));
    const box = $("rows");
    box.className = wide ? "wide" : "";
    box.style.setProperty("--row-h", rowHeight + "px");
    // 一栏时字跟着行高放大；两栏时曲名本来就挤，只拉开行距、字不放大
    box.style.setProperty("--s", wide ? Math.min(1.3, Math.max(1, rowHeight / 64)).toFixed(3) : "1");
    box.style.gridTemplateColumns = "repeat(" + columns + ", minmax(0, 1fr))";
    box.style.gridTemplateRows = "repeat(" + perColumn + ", var(--row-h))";
    const anyRecord = list.some((row) => row.newRecord);
    for (const row of list) {
      const root = el("div", "row");
      root.append(el("span", "difficulty d" + row.levelIndex, LEVELS[row.levelIndex] || "—"));
      if (wide) root.append(el("span", "constant", row.constant ? fmt.constant(row.constant) : ""));
      root.append(el("span", "title", row.title));
      // 两栏时只写打了几次；只打一次的空着，格子留着，分数照样对齐
      root.append(wide ? tries(row) : el("span", "count", playCount(row)));
      root.append(el("span", "score", fmt.score(row.score)), el("span", "rank", row.rank));
      const marks = el("span", "marks");
      for (const key of [row.fc, row.clear, row.chain]) {
        const mark = key && ThemeKit.MARKS[key];
        if (mark) marks.append(el("span", "mark " + mark.kind, mark.text));
      }
      root.append(marks);
      // 有一张出了新纪录，别的行也空出这一格，分数、评级才上下对齐
      if (anyRecord) root.append(el("span", row.newRecord ? "new" : "new blank", "新纪录"));
      box.append(root);
    }
    $("visit-note").textContent = wide ? "每一次的分数 · ✕ 是被强制结束的那次" : "pc 是打的次数 · 分数取这场最高";
    if (notes.length) { $("visit-omission").textContent = notes.join(" · "); $("visit-omission").hidden = false; }
  }

  function buildFrame(width, height) {
    const root = $("frame");
    const { band, corner } = FRAME;
    const img = (name, style) => { const n = el("img"); n.alt = ""; n.src = "../assets/frame-" + name + ".jpg"; Object.assign(n.style, style); return n; };
    const px = (value) => value + "px";
    // 一条边：len 长，用 seg 长的一段素材整段整段地排；alternate 时段数取偶数、单数段翻过来。
    // 相邻两段多盖 1px，免得 1.5 倍出图时接缝露出底色
    const run = (horizontal, x, y, len, seg, name, alternate, flip) => {
      let n = Math.max(1, Math.ceil(len / seg - 1e-6));   // 每段只能裁短、不能比素材长（长了两头露底色）
      if (alternate && n % 2) n += 1;
      const box = el("div", "frame-run");
      Object.assign(box.style, { left: px(x), top: px(y), width: px(horizontal ? len : band), height: px(horizontal ? band : len) });
      for (let i = 0; i < n; i++) {
        const a = Math.round(i * len / n), b = Math.round((i + 1) * len / n);
        const size = b - a + (i < n - 1 ? 1 : 0);
        const offset = px(-(seg - (b - a)) / 2);   // 两头平均裁
        const piece = el("div", "frame-run");
        Object.assign(piece.style, horizontal ? { left: px(a), top: 0, width: px(size), height: px(band) } : { left: 0, top: px(a), width: px(band), height: px(size) });
        const turn = alternate && i % 2 ? (horizontal ? "scaleX(-1)" : "scaleY(-1)") : "";
        piece.append(img(name, {
          ...(horizontal ? { left: offset, top: 0, width: px(seg), height: px(band) } : { left: 0, top: offset, width: px(band), height: px(seg) }),
          transform: [turn, flip].join(" ").trim(),
        }));
        box.append(piece);
      }
      root.append(box);
    };
    run(true, corner - 1, 0, width - 2 * corner + 2, FRAME.top, "top", true, "");
    run(true, corner - 1, height - band, width - 2 * corner + 2, FRAME.top, "top", true, "scaleY(-1)");
    run(false, 0, corner - 1, height - 2 * corner + 2, FRAME.side, "side", false, "");
    run(false, width - band, corner - 1, height - 2 * corner + 2, FRAME.side, "side", false, "scaleX(-1)");
    // 四角：左上角那块是 L 形（里面那一角是原件镜子的玻璃，裁掉），别的角翻过来；盖在边条上面
    const shape = "polygon(0 0, 100% 0, 100% " + px(band) + ", " + px(band) + " " + px(band) + ", " + px(band) + " 100%, 0 100%)";
    for (const [right, bottom] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      root.append(img("corner", {
        left: px(right ? width - corner : 0), top: px(bottom ? height - corner : 0), width: px(corner), height: px(corner), clipPath: shape,
        transform: [right ? "scaleX(-1)" : "", bottom ? "scaleY(-1)" : ""].join(" ").trim(),
      }));
    }
  }

  function calendar() {
    const cal = data.calendar;
    for (const week of cal.weeks) {
      for (const day of week) {
        const cell = el("div", "cell l" + day.level + (day.future ? " future" : "") + (day.today ? " today" : ""));
        $("grid").append(cell);
      }
    }
    for (const month of cal.months) {
      const label = el("span", "", month.text);
      label.style.left = month.week * PITCH + "px";
      $("months").append(label);
    }
    $("calendar-note").textContent = "按同步那天 · " + cal.activeDays + " 天有同步";
  }

  async function main() {
    header(); stats(); rows(); calendar();
    $("credit").textContent = "Generated by Anna Bot · 数据来自落雪查分器 · 北京时间 · " + (data.example ? "示例数据" : data.time);
    await Promise.all([document.fonts.load('27px "Anna Hand"'), document.fonts.load('700 29px "Anna Script"')]);
    await document.fonts.ready;
    // 通关标记那一格按最宽的一行留，每行一样宽：分数、评级上下对齐
    const marks = [...document.querySelectorAll("#rows .marks")];
    const marksWidth = Math.max(0, ...marks.map((n) => n.offsetWidth));
    marks.forEach((n) => { n.style.minWidth = marksWidth + "px"; });
    // 一栏时每一次的分数让着曲名：曲名至少留 TITLE_ROOM 个字宽（曲名本来更短就按它缩到八成五的长度），
    // 不够就从后往前少写几次，最后退回打了几次。写得下的优先级：分数、评级、标记、新纪录 > 曲名 > 每一次的分数
    document.querySelectorAll("#rows.wide .tries").forEach((box) => {
      const title = box.parentElement.querySelector(".title");
      const room = Math.min(title.scrollWidth * 0.85, TITLE_ROOM * parseFloat(getComputedStyle(title).fontSize));
      for (let keep = Number(box.dataset.keep); title.clientWidth < room && keep > 0; ) fillTries(box, box.row, --keep);
    });
    // 长曲名先缩小到八成五，再单行省略
    document.querySelectorAll(".row .title").forEach((n) => {
      let size = parseFloat(getComputedStyle(n).fontSize);
      const min = size * 0.85;
      while (n.scrollWidth > n.clientWidth && size > min) n.style.fontSize = (size -= 1) + "px";
    });
    // 图的高度按内容算：谱面少时整张图变矮，不留空
    const content = $("content");
    // 取双数：按 1.5 倍出图时整张图是整像素，最底下一行不会只盖住半个像素、露出一条暗线
    const height = Math.ceil((content.offsetTop + content.offsetHeight + MARGIN_BOTTOM) / 2) * 2;
    $("page").style.height = height + "px";
    buildFrame(WIDTH, height);
    await ThemeKit.done({ element: $("page") });
  }
  main().catch(ThemeKit.fail);
})();
