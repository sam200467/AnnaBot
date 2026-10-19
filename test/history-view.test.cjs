"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildImageData, DETAIL_LIMIT, CHANGE_LIMIT } = require("../src/history-view.cjs");
const row = (id, extra={}) => ({ key:id+":3", title:"曲"+id, score:1008000, rating:17, deltaRating:.1, inB50:false, ...extra });
const batch = (events, extra={}) => ({ timeText:"10/19 11:00", before:16, after:16.1, impact:.1, events, entered:[], left:[], ...extra });
const report = (batches) => ({ to:new Date(), rating:{ now:16.1 }, batches });

test("横版只取最新批次，之前的事件与构成变化不混进来", () => {
  const data = buildImageData(report([batch([row(1)],{ entered:[row(1)] }),batch([row(2)],{ after:16.2,impact:.2 })]));
  assert.deepEqual(data.events.map((r) => r.key),["2:3"]);
  assert.equal(data.changes.length,0);
  assert.equal(data.counts.total,1);
  assert.equal(data.rating.gain,.2);
  assert.equal(data.events[0].impact,undefined);
});
test("大量更新只展示单曲 Rating 最高的成绩，B50 与 FC 不优先；整批统计不变", () => {
  const rows = Array.from({length:43},(_,i) => row(i,{rating:15+i/100}));
  rows[40].inB50=true;
  rows[40].rating=14;
  rows[41].fc="alljustice";
  rows[42].inB50=true;
  const data=buildImageData(report([batch(rows,{entered:[rows[40]],left:Array.from({length:12},(_,i)=>row(100+i))})]));
  assert.equal(data.events.length,DETAIL_LIMIT);
  assert.equal(data.changes.length,CHANGE_LIMIT);
  assert.equal(data.omitted,43-DETAIL_LIMIT);
  assert.equal(data.changesOmitted,14-CHANGE_LIMIT);
  assert.equal(data.counts.total,43);
  assert.equal(data.counts.left,12);
  assert.equal(data.counts.marks,1);
  assert.equal(data.rating.gain,.1);
  assert.deepEqual(data.events.slice(0,3).map((r)=>r.key),["42:3","41:3","39:3"]);
});
test("全是 B50 外提升或仅 FC 变化也展示；数据不被原地排序", () => {
  const rows=[row(2),row(1,{fc:"fullcombo",prevFc:null,deltaRating:0})];
  const data=buildImageData(report([batch(rows,{impact:0})]));
  assert.equal(data.counts.outside,2);
  assert.equal(data.changes.length,0);
  assert.equal(data.events[0].key,"1:3");
  assert.equal(data.rating.gain,0);
  assert.equal(rows[0].key,"2:3");
});


test("构成超量先放新进再放移出，各组 Rating 降序，席位内提升排最后", () => {
  const entered=[row(1,{rating:16}),row(2,{rating:17}),row(3,{rating:16.5})];
  const left=[row(11,{rating:15}),row(12,{rating:15.4}),row(13,{rating:15.1}),row(14,{rating:15.3}),row(15,{rating:15.2})];
  const events=[...entered.map(r=>({...r,inB50:true})),row(20,{rating:18,inB50:true})];
  const data=buildImageData(report([batch(events,{entered,left})]));
  assert.deepEqual(data.changes.map(r=>r.key),["2:3","3:3","1:3","12:3","14:3","15:3","13:3"]);
  assert.equal(data.changesOmitted,2);
  assert.equal(data.counts.improved,1);
  const many=Array.from({length:9},(_,i)=>row(i,{rating:15+i/10}));
  const allEntrants=buildImageData(report([batch(many.map(r=>({...r,inB50:true})),{entered:many,left})]));
  assert.deepEqual(allEntrants.changes.map(r=>r.key),["8:3","7:3","6:3","5:3","4:3","3:3","2:3"]);
  assert.ok(allEntrants.changes.every(r=>r.change==="enter"));
});
