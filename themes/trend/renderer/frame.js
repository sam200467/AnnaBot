(function () {
  "use strict";
  // 坐标以馆藏缩略图的 545px 宽为标尺。所有片段共用一个缩放比，禁止单独拉宽边条。
  // 四角缩小后保留，边条按原比例平铺，尾段只裁掉多出的长度，不把花纹压扁。
  window.drawTrendFrame = async function (canvas) {
    const image = new Image();
    image.src = "../assets/frame-original.jpg";
    await image.decode();
    const source = document.createElement("canvas");
    source.width = 1090; source.height = Math.round(image.naturalHeight * 1090 / image.naturalWidth);
    const sc = source.getContext("2d", { willReadFrequently:true });
    sc.drawImage(image, 0, 0, source.width, source.height);
    // 只清除照片的白色背景和开口，金色雕花保留原色；不做透视或非等比矫正。
    const pixels = sc.getImageData(0, 0, source.width, source.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const p = pixels.data;
      if (p[i] > 235 && p[i + 1] > 235 && p[i + 2] > 230) p[i + 3] = 0;
    }
    sc.putImageData(pixels, 0, 0);
    const W = canvas.parentElement.clientWidth, H = canvas.parentElement.clientHeight, ratio = 2, scale = .62, corner = 130;
    canvas.width = W * ratio; canvas.height = H * ratio;
    const g = canvas.getContext("2d");
    g.scale(ratio, ratio); g.imageSmoothingQuality = "high";
    const x = 9, y = 10, w = 526, h = 603, c = corner * scale;
    const part = (sx, sy, sw, sh, dx, dy) =>
      g.drawImage(source, sx * 2, sy * 2, sw * 2, sh * 2, dx, dy, sw * scale, sh * scale);
    part(x, y, corner, corner, 0, 0);
    part(x + w - corner, y, corner, corner, W - c, 0);
    part(x, y + h - corner, corner, corner, 0, H - c);
    part(x + w - corner, y + h - corner, corner, corner, W - c, H - c);
    const horizontal = (sy, dy, sh) => {
      for (let dx = c; dx < W - c; ) {
        const sw = Math.min(w - 2 * corner, (W - c - dx) / scale);
        part(x + corner, sy, sw, sh, dx, dy); dx += sw * scale;
      }
    };
    const vertical = (sx, dx, sw) => {
      for (let dy = c; dy < H - c; ) {
        const sh = Math.min(h - 2 * corner, (H - c - dy) / scale);
        part(sx, y + corner, sw, sh, dx, dy); dy += sh * scale;
      }
    };
    horizontal(y, 0, 94); horizontal(y + h - 88, H - 88 * scale, 88);
    vertical(x, 0, 74); vertical(x + w - 73, W - 73 * scale, 73);
  };
})();
