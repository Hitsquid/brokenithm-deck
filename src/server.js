#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { BrokenithmClient, DEFAULT_CONFIG, mergeConfig } = require("./client");

const APP_HOST = process.env.HOST || "127.0.0.1";
const APP_PORT = Number(process.env.PORT || 39868);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_ROOT = path.join(ROOT, "public");
const CONFIG_PATH = path.join(ROOT, "config.json");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function readConfig() {
  try {
    return mergeConfig(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  } catch {
    return { ...DEFAULT_CONFIG, virtualCard: { ...DEFAULT_CONFIG.virtualCard } };
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

let config = readConfig();
const controller = new BrokenithmClient(config);
const sockets = new Set();

function sendJson(peer, message) {
  if (!peer.writable) return;
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  peer.write(Buffer.concat([header, payload]));
}

function broadcast(message) {
  for (const peer of sockets) sendJson(peer, message);
}

function currentStatus() {
  return {
    ...controller.status,
    connected: controller.status.connected,
    mode: config.mode
  };
}

controller.on("status", (status) => {
  broadcast({ type: "status", status });
});

function jsonResponse(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length
  });
  response.end(payload);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

async function handleHttp(request, response) {
  if (request.method === "GET" && request.url === "/api/config") {
    jsonResponse(response, 200, { config, status: currentStatus() });
    return;
  }

  if (request.method === "POST" && request.url === "/api/config") {
    const body = JSON.parse(await readRequestBody(request));
    config = mergeConfig(config, body.config || body);
    controller.setConfig(config);
    writeConfig(config);
    jsonResponse(response, 200, { config, status: currentStatus() });
    broadcast({ type: "config", config, status: currentStatus() });
    return;
  }

  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const cleanPath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(PUBLIC_ROOT, cleanPath));

  if (!filePath.startsWith(PUBLIC_ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(data);
  });
}

async function handleMessage(peer, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    sendJson(peer, { type: "error", message: "Invalid JSON message." });
    return;
  }

  try {
    if (message.type === "connect") {
      config = mergeConfig(config, message.config || {});
      writeConfig(config);
      await controller.connect(config);
      broadcast({ type: "config", config, status: currentStatus() });
      return;
    }

    if (message.type === "disconnect") {
      controller.disconnect();
      return;
    }

    if (message.type === "state") {
      controller.updateState(message.state || {});
      return;
    }

    if (message.type === "function") {
      controller.sendFunction(message.name);
      return;
    }

    if (message.type === "config") {
      config = mergeConfig(config, message.config || {});
      controller.setConfig(config);
      writeConfig(config);
      broadcast({ type: "config", config, status: currentStatus() });
    }
  } catch (error) {
    controller.status.error = error.message;
    controller.status.connected = false;
    controller.emitStatus();
    sendJson(peer, { type: "error", message: error.message });
  }
}

function parseFrames(peer, chunk) {
  peer.buffer = Buffer.concat([peer.buffer, chunk]);

  while (peer.buffer.length >= 2) {
    const first = peer.buffer[0];
    const second = peer.buffer[1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (peer.buffer.length < offset + 2) return;
      length = peer.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (peer.buffer.length < offset + 8) return;
      length = Number(peer.buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    if (!masked) {
      peer.end();
      return;
    }
    if (peer.buffer.length < offset + 4 + length) return;

    const mask = peer.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(peer.buffer.subarray(offset, offset + length));
    peer.buffer = peer.buffer.subarray(offset + length);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];

    if (opcode === 0x8) {
      peer.end();
      return;
    }
    if (opcode === 0x9) {
      peer.write(Buffer.from([0x8a, 0x00]));
      continue;
    }
    if (opcode === 0x1) {
      handleMessage(peer, payload.toString("utf8"));
    }
  }
}

const server = http.createServer((request, response) => {
  handleHttp(request, response).catch((error) => {
    jsonResponse(response, 500, { error: error.message });
  });
});

server.on("upgrade", (request, socket) => {
  if (new URL(request.url, `http://${request.headers.host}`).pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));

  socket.buffer = Buffer.alloc(0);
  sockets.add(socket);
  socket.on("data", (chunk) => parseFrames(socket, chunk));
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
  sendJson(socket, { type: "config", config, status: currentStatus() });
});

server.listen(APP_PORT, APP_HOST, () => {
  const url = `http://${APP_HOST}:${APP_PORT}`;
  console.log(`Brokenithm Deck listening at ${url}`);
});

process.on("SIGINT", () => {
  controller.disconnect();
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  controller.disconnect();
  server.close(() => process.exit(0));
});
