"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCardPacket,
  buildConnectPacket,
  buildFunctionPacket,
  buildInputPacket,
  buildPingPacket,
  decodeServerPacket,
  parseEndpoint
} = require("../src/protocol");

test("parses Android-style endpoints with the default port", () => {
  assert.deepEqual(parseEndpoint("192.168.1.2"), { host: "192.168.1.2", port: 52468 });
  assert.deepEqual(parseEndpoint("pc.local:50000"), { host: "pc.local", port: 50000 });
});

test("builds a full UDP CON packet for the current Windows server", () => {
  const packet = buildConnectPacket({ address: "192.168.1.44", port: 52468 });
  assert.equal(packet.length, 23);
  assert.equal(packet[0], 22);
  assert.equal(packet.toString("ascii", 1, 4), "CON");
  assert.equal(packet[4], 1);
  assert.equal(packet.readUInt16BE(5), 52468);
  assert.deepEqual([...packet.subarray(7, 11)], [192, 168, 1, 44]);
});

test("builds INP slider, air, and service/test fields", () => {
  const packet = buildInputPacket({
    packetId: 7,
    keys: [0, 3, 31],
    airHeight: 2,
    enableAir: true,
    testButton: true,
    serviceButton: true
  });
  assert.equal(packet.length, 48);
  assert.equal(packet[0], 47);
  assert.equal(packet.toString("ascii", 1, 4), "INP");
  assert.equal(packet.readUInt32BE(4), 7);
  assert.equal(packet[45], 0x80);
  assert.equal(packet[42], 0x80);
  assert.equal(packet[14], 0x80);
  assert.deepEqual([...packet.subarray(8, 14)], [1, 1, 1, 1, 0, 0]);
  assert.equal(packet[46], 1);
  assert.equal(packet[47], 1);
});

test("builds IPT packets when air is disabled", () => {
  const packet = buildInputPacket({ packetId: 3, keys: [1], enableAir: false });
  assert.equal(packet.length, 42);
  assert.equal(packet[0], 41);
  assert.equal(packet.toString("ascii", 1, 4), "IPT");
  assert.equal(packet.readUInt32BE(4), 3);
  assert.equal(packet[38], 0x80);
});

test("builds function, ping, and card packets", () => {
  assert.deepEqual([...buildFunctionPacket(1)], [4, 70, 78, 67, 1]);
  const ping = buildPingPacket(123n);
  assert.equal(ping.toString("ascii", 1, 4), "PIN");
  assert.equal(ping.readBigUInt64BE(4), 123n);
  const card = buildCardPacket({ present: true, type: 1, id: "0123456789abcdef0001" });
  assert.equal(card.toString("ascii", 1, 4), "CRD");
  assert.equal(card[4], 1);
  assert.equal(card[5], 1);
  assert.deepEqual([...card.subarray(6, 16)], [1, 35, 69, 103, 137, 171, 205, 239, 0, 1]);
});

test("decodes LED color order and PON latency", () => {
  const led = Buffer.alloc(100);
  led[0] = 99;
  led.write("LED", 1, "ascii");
  led[4] = 10;
  led[5] = 20;
  led[6] = 30;
  assert.deepEqual(decodeServerPacket(led).colors[0], { r: 20, g: 30, b: 10 });

  const pong = Buffer.alloc(12);
  pong[0] = 11;
  pong.write("PON", 1, "ascii");
  pong.writeBigUInt64BE(1000n, 4);
  assert.equal(decodeServerPacket(pong, 3001000n).latencyMs, 1.5);
});
