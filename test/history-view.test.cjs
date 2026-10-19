"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildImageData, parseImageArgs, DETAIL_ROWS } = require("../src/history-view.cjs");
const { buildReport } = require("../src/history.cjs");

test("图片窗口只画本区间，保留起始值；一批多首只给一笔整批涨幅", () => {
  const report = { from:new Date(1000), to:new Date(3000), window:{ kind:"today", label:"今天" },
    points:[{ ms:0, rating:10 }], rating:{ start:16, end:16.1, gain:.1, now:16.1 }, counts:{ batches:1 },
    batches:[{ ms:2000, timeText:"10/19 10:00", before:16, after:16.1, impact:.1,
      events:[{ key:"1:3", rating:17 }, { key:"2:4", rating:17.1 }] }] };
  const data = buildImageData(report);
  assert.equal(data.points.length, 2);
  assert.equal(data.points[0].rating, 16);
  assert.equal(data.points[1].ms, 2000);
  assert.equal(data.batches[0].impact, .1);
  assert.equal(data.batches[0].events[0].impact, undefined);
  assert.equal(data.batches[0].events[1].levelIndex, 4);
});

test("大批次分页不丢成绩、不重复，续页保留整批涨幅；构成变化也能翻完", () => {
  const rows = Array.from({ length:43 }, (_, i) => ({ key:i + ":3", rating:16, score:1000000 }));
  const report = { from:new Date(1000), to:new Date(3000), window:{ kind:"latest", label:"最近一次" },
    rating:{ start:15, end:16, now:16 }, counts:{ batches:1 }, composition:{ entered:rows, improved:[], left:[] },
    batches:[{ ms:2000, impact:1, events:rows, timeText:"10/19 12:00" }] };
  const first = buildImageData(report);
  const pages = Array.from({ length:first.pages }, (_, i) => buildImageData(report, { page:i + 1 }));
  assert.deepEqual(pages.flatMap((p) => p.batches.flatMap((b) => b.events.map((r) => r.key))), rows.map((r) => r.key));
  assert.deepEqual(pages.flatMap((p) => p.composition.gains.map((r) => r.key)), rows.map((r) => r.key));
  assert.ok(pages.every((p) => p.batches.reduce((n, b) => n + b.events.length + 1, 0) <= DETAIL_ROWS));
  assert.equal(pages[1].batches[0].continued, true);
  assert.equal(pages[1].batches[0].impact, 1);
  assert.deepEqual(parseImageArgs("今天 第２页"), { windowArg:"今天", page:2 });
});

test("区间构成：暂时退出又回榜不算净移出，只有期间新进又离开不算净新进", () => {
  const at = new Date("2026-10-19T00:00:00+08:00");
  const baseline = Object.fromEntries(Array.from({ length:30 }, (_, i) => [i + ":3", { score:1005000, fc:null }]));
  const catalog = { getSong:(id) => ({ id, title:"曲" + id, version:23000 }), chart:() => ({ level:"15", level_value:15 }) };
  const event = (id, score, seconds) => ({ id, lv:3, score, prev:1005000, fc:null, t:new Date(+at + seconds * 1000).toISOString() });
  const events = [event(30, 1006000, 60), ...Array.from({ length:30 }, (_, id) => event(id, 1009000, 120))];
  const report = buildReport({ state:{ at:at.toISOString(), baseline, events }, window:{ from:at, label:"今天", kind:"today" }, to:new Date(+at + 180000), catalog, floor:24000 });
  assert.equal(report.counts.entered, 2);
  assert.equal(report.composition.entered.length, 0);
  assert.equal(report.composition.left.length, 0);
  assert.equal(report.composition.improved.length, 30);
});
