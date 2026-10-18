// 实物框分块裁切：每块照片只等比缩放，边长变化靠重复和末端裁切。
(function () {
  "use strict";
  window.renderPlateFrame = function (page, thickness) {
    const frame = document.getElementById("frame");
    frame.replaceChildren();
    const scale = thickness / 130;
    const width = page.offsetWidth;
    const height = page.offsetHeight;
    function crop(parent, x, y, w, h, left, top, rotation = 0, mirror = false) {
      const piece = document.createElement("span");
      piece.className = "frame-piece";
      Object.assign(piece.style, {
        // 多露出 1px 原图覆盖小数像素接缝；照片本身的缩放比例不变。
        left: left + "px", top: top + "px", width: w * scale + 1 + "px", height: h * scale + 1 + "px",
        transform: "rotate(" + rotation + "deg)",
      });
      const photo = document.createElement("img");
      photo.src = "../assets/frame-green-enamel-front.jpg";
      photo.alt = "";
      Object.assign(photo.style, {
        width: 1075 * scale + "px", height: 1075 * scale + "px",
        left: -x * scale + "px", top: -y * scale + "px",
        transformOrigin: "0 0",
        transform: mirror ? "translateX(" + (2 * x + w) * scale + "px) scaleX(-1)" : "none",
      });
      piece.append(photo);
      parent.append(piece);
    }
    // 共用正面顶部的绿珐琅花带，转 90° 用于竖边。相同的缩放率保持花纹形状。
    const length = 440 * scale;
    function rail(left, top, available, rotation) {
      const rail = document.createElement("div");
      rail.className = "frame-strip";
      Object.assign(rail.style, {
        left: left + "px", top: top + "px", width: available + "px", height: thickness + "px",
        transform: "rotate(" + rotation + "deg)",
      });
      // 相邻段镜像衔接，同一截面接同一截面，避免原照片两端高度不同形成断层。
      for (let offset = 0, index = 0; offset < available; offset += length, index++) {
        crop(rail, 315, 132, 440, 130, offset, 0, 0, index % 2 === 1);
      }
      frame.append(rail);
    }
    rail(thickness, 0, width - 2 * thickness, 0);
    rail(width - thickness, height, width - 2 * thickness, 180);
    rail(0, height - thickness, height - 2 * thickness, -90);
    rail(width, thickness, height - 2 * thickness, 90);
    crop(frame, 156, 132, 130, 130, 0, 0);
    crop(frame, 156, 132, 130, 130, width, 0, 90);
    crop(frame, 156, 132, 130, 130, width, height, 180);
    crop(frame, 156, 132, 130, 130, 0, height, -90);
  };
})();
