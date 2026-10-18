// 主题小工具：每个主题的 theme.html 都先引入它（<script src="../../shared/theme-kit.js"></script>）。
//
//   const data = ThemeKit.data();          // 渲染器注入的数据（window.__THEME_DATA__）
//   ... 把页面画出来 ...
//   ThemeKit.done({ element: root });      // 等字体和 <img> 都加载完，按 root 的大小截图
//
// 出错时调 ThemeKit.fail(error)，或者直接抛异常 —— 未捕获的异常也会被记成 __THEME_ERROR__，
// 渲染器会立刻报错，而不是干等到超时。CSS 背景图等不到加载完成，要等的图用 <img> 或 ThemeKit.preload(urls)。
(function () {
  "use strict";

  function fail(error) {
    window.__THEME_ERROR__ = String((error && (error.stack || error.message)) || error || "未知错误");
  }

  function data() {
    if (window.__THEME_DATA__ === undefined || window.__THEME_DATA__ === null) throw new Error("没有拿到 __THEME_DATA__");
    return window.__THEME_DATA__;
  }

  function waitImages(root) {
    const images = Array.from((root || document).querySelectorAll("img"));
    return Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });   // 一张图坏了不该让整张图出不来
    }))));
  }

  function preload(urls) {
    return Promise.all((urls || []).filter(Boolean).map((url) => new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = url;
    })));
  }

  // options.element：按这个元素的大小截图；options.size：直接给 { width, height }（CSS 像素）。都不给就按整页。
  async function done(options) {
    const opts = options || {};
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await waitImages(document);
      if (opts.size) {
        window.__THEME_SIZE__ = opts.size;
      } else if (opts.element) {
        const rect = opts.element.getBoundingClientRect();
        window.__THEME_SIZE__ = { width: Math.ceil(rect.right), height: Math.ceil(rect.bottom) };
      }
      window.__THEME_READY__ = true;
    } catch (error) {
      fail(error);
    }
  }

  // 定数、分数这些格式化小函数各主题都要用，放这里免得每个主题写一遍。
  const format = {
    // 15.5 → "15.5"，14 → "14.0"
    constant: (value) => (Number(value) || 0).toFixed(1),
    // 1007725 → "1,007,725"
    score: (value) => Number(value || 0).toLocaleString("en-US"),
    // 单曲 Rating 截到两位小数：17.5225 → "17.52"。加一点容差：几十首相加再平均的浮点误差会把 16.85 算成 16.8499999…，
    // 直接截断就成了 16.84（落雪前端的 truncateChunithmValue 也是这么处理的）
    rating: (value) => (Math.floor((Number(value) || 0) * 100 + 1e-8) / 100).toFixed(2),
  };

  // 玩家 Rating 的颜色档（VERSE 以后，照 chunithm.org 的 Rating 表和 wikiwiki「レーティングの色分け」）：
  // 0 绿、4 橙、7 赤、10 紫、12 铜、13.25 银、14.5 金、15.25 铂、16 虹；17 起是更浓的「虹极」（上暖下冷）。
  // 15.25 以后游戏里还会按 0.25 加星、17 以后分 ★1～3，这里只管颜色（作者 2026-10-18 要求只改颜色，不动星和字体）。
  // 各主题拿 class 名自己配色：暗底（best）用亮一档的金属色，象牙纸上（list）用深一档的宝石色。
  const RATING_TIERS = [
    [17, "rainbow-deep"],
    [16, "rainbow"],
    [15.25, "platina"],
    [14.5, "gold"],
    [13.25, "silver"],
    [12, "bronze"],
    [10, "purple"],
    [7, "red"],
    [4, "orange"],
    [0, "green"],
  ];
  function ratingTier(value) {
    const rating = Number(value) || 0;
    for (const [minimum, name] of RATING_TIERS) {
      if (rating >= minimum) return name;
    }
    return "green";
  }

  window.addEventListener("error", (event) => fail(event.error || event.message));
  window.addEventListener("unhandledrejection", (event) => fail(event.reason));
  window.ThemeKit = { data, done, fail, preload, waitImages, format, ratingTier };
})();
