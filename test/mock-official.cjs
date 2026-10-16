"use strict";
// 假的 QQ 官方开放平台，供测试用：同时冒充 token 接口、REST API 和 WebSocket 网关。
// 移植自 MiaBot 的 qq-official/mock-official.cjs。没有真实凭据也能把整条链路跑通。
//
// 用法：
//   const mock = createMockOfficial();
//   await mock.start();
//   const t = createOfficial({ appId:"1", clientSecret:"x", tokenUrl: mock.tokenUrl,
//                              apiBase: mock.apiBase, sandboxApiBase: mock.apiBase });
//   await t.start((name, d) => {...});
//   mock.push("C2C_MESSAGE_CREATE", {...});

const http = require("node:http");
const { WebSocketServer } = require("ws");

function createMockOfficial(options = {}) {
  const log = typeof options.log === "function" ? options.log : () => {};
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: "/gateway" });

  const state = {
    sent: [],           // 发出去的消息 { path, body }
    rejected: [],       // 被拒收的消息 { path, body }（rejectBareMedia 时）
    rejectBareMedia: false,   // true：不带 content 的图片消息（msg_type 7）一律拒收，测补空格重发用
    uploads: [],        // 富媒体上传 { path, body }
    acks: [],           // 按钮回调的应答 { id, body }
    identified: [],     // 收到的 Identify / Resume 帧
    heartbeats: 0,
    sockets: new Set(),
    nextError: null,    // { status, err_code, message } —— 让下一次 REST 调用失败
    tokenCalls: 0,
    panels: new Map(),  // 指令面板 panel_id -> { panel_id, scope, target_type, panel, targets: Set }
    panelCalls: [],     // 指令面板接口的调用 { method, path, body }
  };

  let port = 0;
  let panelSeq = 0;

  // 指令面板接口（POST/GET /v2/panels、GET/PUT/DELETE /v2/panels/{id}、PUT /v2/panels/{id}/target）。
  // 跟真平台一样：存的时候去掉 name 开头的斜杠、读回来的键序是 name/desc/type（MiaBot 实测），测试才测得到归一化。
  function panelRoute(req, res, url, body) {
    state.panelCalls.push({ method: req.method, path: url, body });
    const stored = (panel) => ({
      items: (panel?.items || []).map((item) => ({ name: String(item.name || "").replace(/^\/+/, ""), desc: item.desc || "", type: item.type || "command" })),
      remark: panel?.remark || "",
    });
    const fieldOf = (scope) => (scope === "group" ? "group_openids" : "user_openids");
    const [, id, sub] = url.match(/^\/v2\/panels(?:\/([^/]+))?(\/target)?$/) || [];
    if (!id && req.method === "GET") {
      const scope = new URL(req.url, "http://mock").searchParams.get("scope");
      // 按设置时间倒序
      const records = [...state.panels.values()].filter((p) => p.scope === scope).reverse()
        .map((p) => ({ panel_id: p.panel_id, scope: p.scope, target_type: p.target_type, panel: p.panel }));
      return json(res, 200, { records, next_cursor: "", is_end: true });
    }
    if (!id && req.method === "POST") {
      if (state.panels.size >= 20) return json(res, 400, { message: "超出数量限制", err_code: 40030013 });
      const panel_id = "p_" + (++panelSeq);
      state.panels.set(panel_id, {
        panel_id, scope: body.scope, target_type: body.target_type || "all", panel: stored(body.panel), targets: new Set(body[fieldOf(body.scope)] || []),
      });
      return json(res, 200, { panel_id });
    }
    const record = state.panels.get(decodeURIComponent(id || ""));
    if (!record) return json(res, 400, { message: "指令面板不存在", err_code: 40030006 });
    if (sub && req.method === "PUT") {
      if (record.target_type === "all") return json(res, 400, { message: "全局面板不支持添加指定关联对象", err_code: 40030021 });
      for (const target of body[fieldOf(record.scope)] || []) {
        if (body.op === "del") record.targets.delete(target); else record.targets.add(target);
      }
      return json(res, 200, {});
    }
    if (req.method === "GET") {
      return json(res, 200, { panel_id: record.panel_id, scope: record.scope, target_type: record.target_type, panel: record.panel,
        [fieldOf(record.scope)]: [...record.targets] });
    }
    if (req.method === "PUT") {
      record.panel = stored(body.panel);
      return json(res, 200, { version: 1 });
    }
    if (req.method === "DELETE") {
      state.panels.delete(record.panel_id);
      return json(res, 200, {});
    }
    return json(res, 404, { message: "not found: " + url });
  }

  function json(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  }

  server.on("request", (req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* 忽略非 JSON */ }
      const url = req.url.split("?")[0];

      if (url === "/app/getAppAccessToken") {
        state.tokenCalls += 1;
        if (!body?.appId || !body?.clientSecret) return json(res, 400, { message: "missing credentials" });
        return json(res, 200, { access_token: "mock-token-" + state.tokenCalls, expires_in: 7200 });
      }

      if (req.headers.authorization !== "Authorization-Bypass" && !String(req.headers.authorization || "").startsWith("QQBot ")) {
        return json(res, 401, { message: "unauthorized", err_code: 11244 });
      }

      if (state.nextError) {
        // times：连着失败几次（缺省一次）
        const e = state.nextError;
        if (e.times > 1) e.times -= 1; else state.nextError = null;
        return json(res, e.status || 400, { message: e.message || "mock error", err_code: e.err_code });
      }

      if (url === "/gateway" && req.method === "GET") {
        return json(res, 200, { url: "ws://127.0.0.1:" + port + "/gateway" });
      }
      if (/^\/v2\/(groups|users)\/[^/]+\/files$/.test(url)) {
        state.uploads.push({ path: url, body });
        return json(res, 200, { file_uuid: "uuid-" + state.uploads.length, file_info: "fileinfo-" + state.uploads.length, ttl: 3600 });
      }
      const ack = url.match(/^\/interactions\/([^/]+)$/);
      if (ack && req.method === "PUT") {
        state.acks.push({ id: decodeURIComponent(ack[1]), body });
        return json(res, 200, {});
      }
      if (/^\/v2\/(groups|users)\/[^/]+\/messages$/.test(url) && req.method === "POST") {
        if (state.rejectBareMedia && body?.msg_type === 7 && !body.content) {
          state.rejected.push({ path: url, body });
          return json(res, 400, { message: "content 不能为空（模拟）", err_code: 40000001 });
        }
        state.sent.push({ path: url, body });
        return json(res, 200, { id: "sent-" + state.sent.length, timestamp: new Date().toISOString() });
      }
      if (/^\/v2\/panels(\/|$)/.test(url)) return panelRoute(req, res, url, body);
      return json(res, 404, { message: "not found: " + url });
    });
  });

  wss.on("connection", (ws) => {
    state.sockets.add(ws);
    // 真实网关的顺序：连上先发 Hello，客户端据此发 Identify，网关再回 READY。
    // 顺序反了客户端会发两次 Identify（收到 Hello 时又发一次）。
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: options.heartbeatIntervalMs || 30000 } }));
    ws.on("close", () => state.sockets.delete(ws));
    ws.on("message", (data) => {
      let frame = null;
      try { frame = JSON.parse(data.toString()); } catch { return; }
      if (frame.op === 2 || frame.op === 6) {
        state.identified.push(frame);
        ws.send(JSON.stringify({ op: 0, s: 1, t: "READY", d: { session_id: "mock-session", user: { id: "bot" } } }));
        return;
      }
      if (frame.op === 1) { state.heartbeats += 1; ws.send(JSON.stringify({ op: 11 })); return; }
    });
  });

  return {
    get tokenUrl() { return "http://127.0.0.1:" + port + "/app/getAppAccessToken"; },
    get apiBase() { return "http://127.0.0.1:" + port; },
    get port() { return port; },
    state,
    start() {
      return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(options.port || 0, "127.0.0.1", () => { port = server.address().port; resolve(port); });
      });
    },
    stop() {
      for (const ws of state.sockets) { try { ws.terminate(); } catch {} }
      state.sockets.clear();
      return new Promise((resolve) => { wss.close(() => server.close(() => resolve())); });
    },
    // 推一条事件给已连接的客户端。真网关的帧最外层还有一个事件 id（形如 INTERACTION_CREATE:xxxx），
    // 按钮回调的被动回复要用它当 event_id；不给就按这个格式造一个。
    push(eventName, d, frameId = eventName + ":" + (d?.id || "x") + "-frame") {
      const frame = JSON.stringify({ op: 0, s: (state.sent.length + 100), t: eventName, id: frameId, d });
      let n = 0;
      for (const ws of state.sockets) { if (ws.readyState === 1) { ws.send(frame); n++; } }
      if (!n) log("mock.push 时没有活动连接");
      return n;
    },
    // 让下一次 REST 调用返回指定错误
    failNext(status, err_code, message) { state.nextError = { status, err_code, message }; },
    // 模拟客户端掉线
    dropClients() { for (const ws of state.sockets) { try { ws.terminate(); } catch {} } state.sockets.clear(); },
    // 等某个条件成立（测试里等异步链路跑完用）
    async waitFor(fn, timeoutMs = 3000) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); }
      return false;
    },
  };
}

module.exports = { createMockOfficial };
