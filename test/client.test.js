"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_CONFIG, mergeConfig } = require("../src/client");

test("keeps UDP server feedback disabled by default", () => {
  assert.equal(DEFAULT_CONFIG.udpServerFeedback, false);
  assert.equal(mergeConfig(DEFAULT_CONFIG, { mode: "udp" }).udpServerFeedback, false);
});

test("preserves explicit UDP server feedback setting", () => {
  assert.equal(mergeConfig(DEFAULT_CONFIG, { udpServerFeedback: true }).udpServerFeedback, true);
});
