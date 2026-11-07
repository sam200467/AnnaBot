"use strict";
// 临时图片网址（image-host.cjs）：给出外网地址、按地址取得到；猜不到、过期、超量的作废；没起来、没填地址时给不出地址。
// 合成一条的端到端在 level.test.cjs。
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createImageHost, imageInfo } = require("../src/image-host.cjs");

const PUBLIC = "http://203.0.113.5:47832";

// 只有 IHDR 的最小 PNG
function png(width, height) {
  const data = Buffer.alloc(24);
  data.writeUInt32BE(0x89504e47, 0); data.writeUInt32BE(0x0d0a1a0a, 4); data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20);
  return data;
}
// 最小的 JPG 头：SOI、一个 APP0 段、SOF0（高在前、宽在后）
function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof[4] = 8;
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

test("临时图片：照 publicBaseUrl 给出外网地址，按地址取得到；猜不到、过期、超量的作废；别的地址都是 404", async (t) => {
  let clock = 1000;
  const logs = [];
  const host = createImageHost({ port: 0, publicBaseUrl: PUBLIC + "/", max: 2, ttlMs: 60000, now: () => clock, log: (line) => logs.push(line) });
  t.after(() => host.stop());
  assert.equal(host.publish(png(1, 1)), null, "服务还没起来不给地址");
  assert.equal(await host.start(), true);
  assert.match(logs.at(-1), /合成一条：开.*203\.0\.113\.5:47832\/shared\//, "启动时说清楚图放哪儿");
  const local = (url) => url.replace(PUBLIC, "http://127.0.0.1:" + host.port());
  const get = (url, init) => fetch(local(url), init);

  const pngData = png(1200, 3400);
  const first = host.publish(pngData);
  assert.match(first.url, /^http:\/\/203\.0\.113\.5:47832\/shared\/[0-9a-f]{32}\.png$/, "末尾的斜杠去掉再拼");
  assert.deepEqual([first.width, first.height], [1200, 3400]);
  const ok = await get(first.url);
  assert.deepEqual([ok.status, ok.headers.get("content-type")], [200, "image/png"]);
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), pngData);
  assert.equal((await get(first.url + "?from=qq")).status, 200, "带查询串也认");
  const head = await get(first.url, { method: "HEAD" });
  assert.deepEqual([head.status, head.headers.get("content-length")], [200, String(pngData.length)]);
  assert.equal((await get(first.url, { method: "POST" })).status, 404, "只认 GET / HEAD");

  const jpg = host.publish(jpeg(1440, 2981));
  assert.match(jpg.url, /\.jpg$/, "JPG 照 JPG 给（/分数列表 出的是 JPG）");
  assert.equal((await get(jpg.url)).headers.get("content-type"), "image/jpeg");
  assert.equal(host.publish(Buffer.from("不是图片，不是图片，不是图片")), null, "认不出的不给地址");
  for (const pathname of ["/", "/shared/", "/shared/" + "0".repeat(32) + ".png", "/shared/../package.json", "/favicon.ico"]) {
    assert.equal((await fetch("http://127.0.0.1:" + host.port() + pathname)).status, 404, pathname);
  }

  const third = host.publish(png(1, 1)).url;
  assert.equal((await get(first.url)).status, 404, "超过上限先丢最旧的");
  clock += 60001;
  assert.equal((await get(third)).status, 404, "过期作废");

  await host.stop();
  assert.equal(host.listening, false);
  assert.equal(host.publish(png(1, 1)), null, "停了就不给地址");
});

test("发出去以后盯着：一直没人来取图记一句警告（多半是端口没放行）；来取了记一句、不再警告；没调 sent() 的不报", async (t) => {
  const logs = [];
  const host = createImageHost({ port: 0, publicBaseUrl: PUBLIC, checkMs: 80, log: (line) => logs.push(line) });
  t.after(() => host.stop());
  await host.start();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const lonely = host.publish(png(1, 1));
  lonely.sent();
  const fetched = host.publish(png(2, 2));
  fetched.sent();
  host.publish(png(3, 3));   // 消息没发出去（退回两条了），不该报
  await fetch(fetched.url.replace(PUBLIC, "http://127.0.0.1:" + host.port()));
  await wait(200);
  const token = (published) => published.url.match(/([0-9a-f]{8})[0-9a-f]{24}/)[1];
  assert.equal(logs.filter((line) => line.includes("还没人来取")).length, 1, logs.join("\n"));
  assert.ok(logs.some((line) => line.includes("还没人来取") && line.includes(token(lonely))));
  assert.ok(logs.some((line) => line.includes("有人来取了") && line.includes(token(fetched))));
  assert.ok(!logs.filter((line) => line.includes("有人来取了")).some((line) => /\d+\.\d+\.\d+\.\d+/.test(line)), "不记来取图的 IP");

  const late = host.publish(png(1, 1));
  late.sent();
  await host.stop();
  await wait(150);
  assert.equal(logs.filter((line) => line.includes("还没人来取")).length, 1, "停了就不再报");
});

test("没填 publicBaseUrl、端口被占：不拦着启动，给不出地址，日志里说一句", async (t) => {
  const logs = [];
  const log = (line) => logs.push(line);
  const noBase = createImageHost({ port: 0, log });
  assert.equal(await noBase.start(), false);
  assert.match(logs.at(-1), /publicBaseUrl 没填/);
  assert.equal(noBase.publish(png(1, 1)), null);

  const busy = http.createServer();
  await new Promise((resolve) => busy.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => busy.close(resolve)));
  const taken = createImageHost({ host: "127.0.0.1", port: busy.address().port, publicBaseUrl: PUBLIC, log });
  assert.equal(await taken.start(), false);
  assert.match(logs.at(-1), /没起来.*EADDRINUSE/);
  assert.equal(taken.publish(png(1, 1)), null, "照旧发图片 + 翻页消息");
  await taken.stop();
});

test("图片尺寸：PNG 读 IHDR，JPG 跳过前面的段找到 SOF", () => {
  assert.deepEqual(imageInfo(png(1200, 3400)), { type: "png", mime: "image/png", width: 1200, height: 3400 });
  assert.deepEqual(imageInfo(jpeg(1440, 2981)), { type: "jpg", mime: "image/jpeg", width: 1440, height: 2981 });
  assert.equal(imageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0, ...new Array(30).fill(0)])), null, "没有 SOF 的 JPG");
  assert.equal(imageInfo(null), null);
});
