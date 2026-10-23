(function () {
  "use strict";
  const data = ThemeKit.data(), fmt = ThemeKit.format;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  // OP 带两位小数、千分位：39,254.18
  const op = (value) => (Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (value) => (Number(value) || 0).toFixed(2) + "%";
  // OP 百分比的颜色跟底色的门槛一致（作者 2026-10-23）：默认蓝，97.50% 起金、99.00% 起铂、99.50% 起虹；
  // 金、铂、虹用共用色阶的 class（shared/rating-tiers.css），蓝是主题里的 .op-blue
  const opTier = (value) => (value >= 99.5 ? "tier-rainbow" : value >= 99 ? "tier-platina" : value >= 97.5 ? "tier-gold" : "op-blue");
  const DIFFICULTY = ["BAS", "ADV", "EXP", "MAS", "ULT"];

  function header() {
    const t = data.total;
    const root = $("total");
    const opText = el("span", "op", op(t.op));
    opText.append(el("small", null, "/ " + op(t.max)));
    const songs = el("span", "songs", "拿到 OP 的歌");
    songs.append(el("b", null, String(t.played)), document.createTextNode(" / " + t.count + " 首"));
    root.append(el("span", "pct " + opTier(t.percent), pct(t.percent)), opText, songs);
  }

  // 一行进度条。count：右边写「打过 / 全部」
  function row(label, group, { count = true } = {}) {
    const r = el("div", "row");
    const track = el("span", "track");
    const fill = el("i");
    fill.style.width = Math.min(100, Math.max(0, group.percent)).toFixed(2) + "%";
    track.append(fill);
    r.append(el("span", "label", label), track, el("span", "pct " + opTier(group.percent), pct(group.percent)));
    if (count) r.append(el("span", "count", group.played + "/" + group.count));
    return r;
  }

  function bars() {
    for (const g of data.genres) $("genres").append(row(g.name, g));
    for (const v of data.versions) $("versions").append(row(v.name, v));
    for (const l of data.levels) $("levels").append(row(l.level, l));
  }

  function possession() {
    const p = data.possession;
    $("possession-now").textContent = "现在：" + p.currentName;
    const root = $("possession");
    // 自己的 Rating：够 16.00 标绿、不够标红（作者 2026-10-23：不写「够了」），颜色用共用色阶的绿、赤
    const need = el("p", "need-rating", "四档都要 Rating ");
    need.append(el("b", null, p.ratingNeeded.toFixed(2)), document.createTextNode("以上（你的是"));
    need.append(el("b", p.rating >= p.ratingNeeded ? "tier-green" : "tier-red", fmt.rating(p.rating)), document.createTextNode("）"));
    root.append(need);
    for (const tier of p.tiers) {
      const t = el("div", "tier" + (tier.key === p.next ? " next" : ""));
      const cond = el("div", "cond", "紫谱、黑谱全部 " + tier.rank + " 以上");
      cond.append(el("small", null, tier.percent === null ? "不看 OP" : "全曲 OP " + tier.percent.toFixed(2) + "% 以上"));
      const gap = el("div", "gap");
      if (tier.done) {
        gap.append(el("span", "done", "✓ 已达成"));
      } else {
        const charts = el("div");
        if (tier.below > 0) { charts.append(document.createTextNode("还差")); charts.append(el("b", null, String(tier.below))); charts.append(document.createTextNode("张")); }
        else charts.append(el("span", "done", "✓ 评级已达成"));
        gap.append(charts);
        if (tier.percent !== null) {
          const lack = Math.max(0, Math.round((tier.percent - p.percent) * 100) / 100);
          gap.append(el("div", null, lack > 0 ? "OP 差 " + lack.toFixed(2) + "%" : "OP 已达成"));
        }
      }
      t.append(el("span", "chip " + tier.key, tier.name), cond, gap);
      root.append(t);
    }
    root.append(el("p", "possession-note", "条件是玩家总结的（VERSE～X-VERSE-X），官方没公布"));
  }

  function song(s, mode) {
    const box = el("div", "hr-song");
    const jacket = el("div", "jacket");
    const img = el("img"); img.alt = "";
    if (s.jacket) img.src = s.jacket;
    jacket.append(img, el("span", "diff d" + s.levelIndex, Number(s.constant).toFixed(1)));
    box.append(jacket, el("span", "plus", "+" + op(s.gap)));
    // 打过的：再写这张谱面现在的分数（被强制结束的那种低分也照写）
    if (mode === "played") box.append(el("span", "score", fmt.score(s.score)));
    return box;
  }

  function headroom() {
    const h = data.headroom;
    const root = $("headroom");
    const block = (title, lines, songs, mode) => {
      const r = el("div", "hr-row");
      const head = el("div", "hr-head");
      head.append(el("b", null, title));
      const sub = el("span");
      lines.forEach((part) => sub.append(part));
      head.append(sub);
      const list = el("div", "hr-songs");
      for (const s of songs) list.append(song(s, mode));
      r.append(head, list);
      root.append(r);
    };
    const em = (text) => el("em", null, text);
    const br = () => el("br");
    block("没打过", [document.createTextNode("还有 "), em(String(h.unplayed.count)), document.createTextNode(" 首"), br(), document.createTextNode("满 OP 最高的")], h.unplayed.songs, "unplayed");
    block("打过的", [document.createTextNode("离满 OP"), br(), document.createTextNode("还差最多的")], h.played.songs, "played");
  }

  function footer() {
    $("footer").textContent = data.note + " · " + data.credit + (data.example ? " · 示例数据" : "");
  }

  // ── 名片板：照 /推分记录 ──
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

  function fitPlate() {
    const trophy = document.querySelector(".trophy span");
    if (trophy) {
      const ratio = (trophy.parentElement.clientWidth - 24) / trophy.scrollWidth;
      if (ratio < 1) trophy.style.transform = "scale(" + ratio.toFixed(3) + ")";
    }
    const who = document.querySelector(".plate-name .who");
    if (!who) return;
    const room = who.parentElement.clientWidth - 6;
    if (room > 0 && who.scrollWidth > room) who.style.transform = "scale(" + Math.max(0.3, room / who.scrollWidth).toFixed(3) + ")";
  }

  async function main() {
    header(); bars(); possession(); headroom(); footer(); renderIdentity();
    await document.fonts.ready;
    fitPlate();
    await ThemeKit.done({ element: $("page") });
  }
  main().catch(ThemeKit.fail);
})();
