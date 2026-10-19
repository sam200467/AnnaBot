"use strict";
// tools/build-song-bms.cjs：从萌百 wikitext 里挑 BMS / BOF 行，再按曲名对上曲库（不联网）
const test = require("node:test");
const assert = require("node:assert/strict");
const { bmsRows, songMatcher, plain } = require("../tools/build-song-bms.cjs");

const wiki = `
| 标题 || 作者 || BPM || 1 || 2 || 3 || 4 || 备注
| [[L9]] || paraoka || 252 || 4 || 6 || 9+ || 13+ || 出自2001年BMS活动
| [[B.B.K.K.B.K.K.]] || nora2r || 170 || 3 || 5 || 10 || 12+ || BOF2013个人战冠军
| {{lj|普通曲}} || x || 1 || 2 || 3 || 4 || 5 || 不是
| [[もぺもぺ|{{lj|もぺもぺ}}]] || LeaF || 100 || 2 || 5 || 12+ || 14 || BOFU2017个人战第3名
`;

test("BMS 行：只挑备注里带 BMS / BOF 的行，wiki 标记和链接目标去掉", () => {
  assert.deepEqual(bmsRows(wiki), [
    { title: "L9", note: "出自2001年BMS活动" },
    { title: "B.B.K.K.B.K.K.", note: "BOF2013个人战冠军" },
    { title: "もぺもぺ", note: "BOFU2017个人战第3名" },
  ]);
  assert.equal(plain("{{lj|もぺもぺ}}"), "もぺもぺ");
});

test("按曲名对上落雪：原样、不分大小写、宽松；撞名不算", () => {
  const find = songMatcher([
    { id: 45, title: "L9" },
    { id: 3, title: "B.B.K.K.B.K.K." },
    { id: 1, title: "Flower" },
    { id: 2, title: "FLOWER" },
  ]);
  assert.equal(find("L9")?.id, 45);
  assert.equal(find("b.b.k.k.b.k.k.")?.id, 3);
  assert.equal(find("Flower")?.id, 1);
  assert.equal(find("FLOWER")?.id, 2);
  assert.equal(find("不存在的曲子"), null);
  assert.equal(find("flower"), null, "宽松一级会撞上两首，宁缺毋滥");
});
