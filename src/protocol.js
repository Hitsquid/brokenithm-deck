"use strict";

const net = require("node:net");

const DEFAULT_PORT = 52468;
const AIR_INDEX = [4, 5, 2, 3, 0, 1];

function byteClamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function parseEndpoint(value, defaultPort = DEFAULT_PORT) {
  const source = String(value || "").trim();
  if (!source) {
    throw new Error("Server address is required.");
  }

  if (source.startsWith("[")) {
    const close = source.indexOf("]");
    if (close === -1) throw new Error("Invalid bracketed IPv6 address.");
    const host = source.slice(1, close);
    const rest = source.slice(close + 1);
    const port = rest.startsWith(":") ? Number(rest.slice(1)) : defaultPort;
    return validateEndpoint(host, port);
  }

  const colonCount = [...source].filter((char) => char === ":").length;
  if (colonCount === 1) {
    const [host, rawPort] = source.split(":");
    return validateEndpoint(host, Number(rawPort));
  }

  return validateEndpoint(source, defaultPort);
}

function validateEndpoint(host, port) {
  const cleanHost = String(host || "").trim();
  const cleanPort = Number(port);
  if (!cleanHost) throw new Error("Server host is required.");
  if (!Number.isInteger(cleanPort) || cleanPort < 1 || cleanPort > 65535) {
    throw new Error("Server port must be between 1 and 65535.");
  }
  return { host: cleanHost, port: cleanPort };
}

function ipv4ToBytes(address) {
  if (net.isIP(address) !== 4) {
    throw new Error(`Only IPv4 advertise addresses are supported by the current server: ${address}`);
  }
  return Buffer.from(address.split(".").map((part) => byteClamp(part, 0, 255)));
}

function writeName(buffer, name) {
  buffer.write(name, 1, 3, "ascii");
}

function buildConnectPacket({ address, port = DEFAULT_PORT }) {
  const addressBytes = ipv4ToBytes(address);
  const packet = Buffer.alloc(23);
  packet[0] = 22;
  writeName(packet, "CON");
  packet[4] = 1;
  packet.writeUInt16BE(byteClamp(port, 1, 65535), 5);
  addressBytes.copy(packet, 7);
  return packet;
}

function buildDisconnectPacket() {
  return Buffer.from([3, 0x44, 0x49, 0x53]);
}

function buildFunctionPacket(functionId) {
  const packet = Buffer.alloc(5);
  packet[0] = 4;
  writeName(packet, "FNC");
  packet[4] = byteClamp(functionId, 0, 255);
  return packet;
}

function buildPingPacket(timeNs) {
  const packet = Buffer.alloc(12);
  packet[0] = 11;
  writeName(packet, "PIN");
  packet.writeBigUInt64BE(BigInt(timeNs), 4);
  return packet;
}

function normalizeKeys(keys) {
  if (!keys) return new Set();
  if (keys instanceof Set) return keys;
  if (Array.isArray(keys)) return new Set(keys.map((key) => Number(key)));
  return new Set();
}

function buildInputPacket({
  packetId = 1,
  keys,
  airHeight = 6,
  enableAir = true,
  testButton = false,
  serviceButton = false
} = {}) {
  const activeKeys = normalizeKeys(keys);
  const packet = Buffer.alloc(enableAir ? 48 : 42);
  packet[0] = enableAir ? 47 : 41;
  writeName(packet, enableAir ? "INP" : "IPT");
  packet.writeUInt32BE(packetId >>> 0, 4);

  const sliderOffset = enableAir ? 14 : 8;
  for (let i = 0; i < 32; i += 1) {
    packet[sliderOffset + 31 - i] = activeKeys.has(i) ? 0x80 : 0x00;
  }

  if (enableAir) {
    const height = byteClamp(airHeight, 0, 6);
    if (height !== 6) {
      for (let i = height; i < 6; i += 1) {
        packet[8 + AIR_INDEX[i]] = 1;
      }
    }
    packet[46] = testButton ? 1 : 0;
    packet[47] = serviceButton ? 1 : 0;
  } else {
    packet[40] = testButton ? 1 : 0;
    packet[41] = serviceButton ? 1 : 0;
  }

  return packet;
}

function buildCardPacket({ present = false, type = 0, id = "" } = {}) {
  const packet = Buffer.alloc(16);
  packet[0] = 15;
  writeName(packet, "CRD");
  packet[4] = present ? 1 : 0;
  packet[5] = byteClamp(type, 0, 255);

  const clean = String(id || "").replace(/[^0-9a-f]/gi, "").slice(0, 20);
  for (let i = 0; i < clean.length; i += 2) {
    packet[6 + i / 2] = Number.parseInt(clean.slice(i, i + 2).padEnd(2, "0"), 16);
  }

  return packet;
}

function decodeServerPacket(data, nowNs = process.hrtime.bigint()) {
  const packet = Buffer.from(data);
  if (packet.length < 4) return null;

  const name = packet.toString("ascii", 1, 4);
  if (name === "LED" && packet.length >= 100) {
    const colors = [];
    for (let i = 0; i < 32; i += 1) {
      const offset = 4 + i * 3;
      colors.push({
        r: packet[offset + 1],
        g: packet[offset + 2],
        b: packet[offset]
      });
    }
    return { type: "led", colors };
  }

  if (name === "PON" && packet.length >= 12) {
    const thenNs = packet.readBigUInt64BE(4);
    return {
      type: "pong",
      latencyMs: Number(nowNs - thenNs) / 2000000
    };
  }

  return { type: "unknown", name, packet };
}

module.exports = {
  AIR_INDEX,
  DEFAULT_PORT,
  buildCardPacket,
  buildConnectPacket,
  buildDisconnectPacket,
  buildFunctionPacket,
  buildInputPacket,
  buildPingPacket,
  decodeServerPacket,
  parseEndpoint
};
