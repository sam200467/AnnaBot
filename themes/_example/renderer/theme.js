// 示例主题：读数据 → 填页面 → ThemeKit.done()。
(function () {
  "use strict";
  const data = ThemeKit.data();
  const $ = (id) => document.getElementById(id);

  $("name").textContent = data.player.name;
  $("rating").textContent = "Rating " + ThemeKit.format.rating(data.player.rating);
  if (data.jacket) $("jacket").src = data.jacket;
  for (const song of data.songs || []) {
    const item = document.createElement("li");
    const level = document.createElement("span");
    level.className = "level";
    level.textContent = song.level;
    item.append(level, song.title + "　" + ThemeKit.format.score(song.score));
    $("songs").append(item);
  }

  ThemeKit.done({ element: $("card") });
})();
