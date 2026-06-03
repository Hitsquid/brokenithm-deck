"use strict";

const dgram = require("node:dgram");
const net = require("node:net");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const {
  DEFAULT_PORT,
  buildCardPacket,
  buildConnectPacket,
  buildDisconnectPacket,
  buildFunctionPacket,
  buildInputPacket,
  buildPingPacket,
  decodeServerPacket,
  parseEndpoint
} = require("./protocol");

const FUNCTION_COIN = 1;
const FUNCTION_CARD = 2;

const DEFAULT_CONFIG = {
  address: "",
  mode: "udp",
  enableAir: true,
  simpleAir: false,
  showDelay: false,
  sendHz: 500,
  localPort: DEFAULT_PORT,
  advertiseAddress: "",
  virtualCard: {
    enabled: false,
    present: false,
    type: 0,
    id: ""
  }
};

function mergeConfig(base, incoming = {}) {
  return {
    ...base,
    ...incoming,
    mode: incoming.mode === "tcp" ? "tcp" : incoming.mode === "udp" ? "udp" : base.mode,
    virtualCard: {
      ...base.virtualCard,
      ...(incoming.virtualCard || {})
    }
  };
}

function firstLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

class BrokenithmClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = mergeConfig(DEFAULT_CONFIG, config);
    this.state = {
      keys: new Set(),
      airHeight: 6,
      testButton: false,
      serviceButton: false
    };
    this.status = {
      connected: false,
      mode: this.config.mode,
      endpoint: null,
      localPort: this.config.localPort,
      advertisedAddress: "",
      latencyMs: null,
      error: "",
      led: Array.from({ length: 32 }, () => ({ r: 0, g: 0, b: 0 }))
    };
    this.packetId = 1;
    this.lastPingAt = 0;
    this.udp = null;
    this.tcp = null;
    this.tcpRemains = Buffer.alloc(0);
    this.loopTimer = null;
    this.connectRepeater = null;
  }

  setConfig(config) {
    this.config = mergeConfig(this.config, config);
    this.status.mode = this.config.mode;
    this.emitStatus();
  }

  updateState(state = {}) {
    if (Array.isArray(state.keys)) {
      this.state.keys = new Set(state.keys.map((key) => Number(key)));
    }
    if (Number.isFinite(Number(state.airHeight))) {
      this.state.airHeight = Math.max(0, Math.min(6, Math.trunc(Number(state.airHeight))));
    }
    if (typeof state.testButton === "boolean") this.state.testButton = state.testButton;
    if (typeof state.serviceButton === "boolean") this.state.serviceButton = state.serviceButton;
  }

  async connect(config = {}) {
    this.disconnect(false);
    this.setConfig(config);

    const endpoint = parseEndpoint(this.config.address || config.address);
    this.endpoint = endpoint;
    this.packetId = 1;
    this.lastPingAt = 0;
    this.status.error = "";
    this.status.endpoint = `${endpoint.host}:${endpoint.port}`;
    this.status.mode = this.config.mode;

    if (this.config.mode === "tcp") {
      await this.connectTcp(endpoint);
    } else {
      await this.connectUdp(endpoint);
    }

    this.status.connected = true;
    this.startLoop();
    this.emitStatus();
  }

  async connectUdp(endpoint) {
    const localPort = Number(this.config.localPort) || DEFAULT_PORT;
    const advertisedAddress = this.config.advertiseAddress || firstLocalIPv4();
    this.status.advertisedAddress = advertisedAddress;

    this.udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.udp.on("message", (message, rinfo) => {
      if (rinfo.port !== endpoint.port) return;
      this.handleServerPacket(message);
    });
    this.udp.on("error", (error) => {
      this.status.error = error.message;
      this.emitStatus();
    });

    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.udp.off("listening", onListening);
        this.udp.off("error", onError);
      };
      const onListening = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      this.udp.once("listening", onListening);
      this.udp.once("error", onError);
      this.udp.bind(localPort);
    });

    this.status.localPort = this.udp.address().port;
    const connectPacket = buildConnectPacket({
      address: advertisedAddress,
      port: this.status.localPort
    });
    this.sendRaw(connectPacket);

    let sendsLeft = 5;
    this.connectRepeater = setInterval(() => {
      sendsLeft -= 1;
      if (sendsLeft <= 0) {
        clearInterval(this.connectRepeater);
        this.connectRepeater = null;
        return;
      }
      this.sendRaw(connectPacket);
    }, 200);
  }

  async connectTcp(endpoint) {
    this.tcpRemains = Buffer.alloc(0);
    this.tcp = new net.Socket();
    this.tcp.setNoDelay(true);
    this.tcp.on("data", (chunk) => this.handleTcpData(chunk));
    this.tcp.on("close", () => {
      if (this.status.connected) {
        this.status.connected = false;
        this.status.error = "TCP connection closed.";
        this.stopLoop();
        this.emitStatus();
      }
    });
    this.tcp.on("error", (error) => {
      this.status.error = error.message;
      this.emitStatus();
    });

    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.tcp.off("connect", onConnect);
        this.tcp.off("error", onError);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      this.tcp.once("connect", onConnect);
      this.tcp.once("error", onError);
      this.tcp.connect(endpoint.port, endpoint.host);
    });
  }

  disconnect(sendPacket = true) {
    if (sendPacket && (this.udp || this.tcp)) {
      this.sendRaw(buildDisconnectPacket());
    }

    this.stopLoop();
    if (this.connectRepeater) {
      clearInterval(this.connectRepeater);
      this.connectRepeater = null;
    }

    if (this.udp) {
      this.udp.close();
      this.udp = null;
    }
    if (this.tcp) {
      this.tcp.destroy();
      this.tcp = null;
    }

    this.status.connected = false;
    this.emitStatus();
  }

  sendFunction(name) {
    const functionId = name === "card" ? FUNCTION_CARD : FUNCTION_COIN;
    this.sendRaw(buildFunctionPacket(functionId));
  }

  startLoop() {
    this.stopLoop();
    const sendHz = Math.max(30, Math.min(1000, Number(this.config.sendHz) || 500));
    const intervalMs = Math.max(1, Math.round(1000 / sendHz));
    this.loopTimer = setInterval(() => this.tick(), intervalMs);
  }

  stopLoop() {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  tick() {
    if (!this.udp && !this.tcp) return;
    if (this.config.showDelay) {
      const now = Date.now();
      if (now - this.lastPingAt >= 100) {
        this.lastPingAt = now;
        this.sendRaw(buildPingPacket(process.hrtime.bigint()));
      }
    }

    const inputPacket = buildInputPacket({
      packetId: this.packetId,
      keys: this.state.keys,
      airHeight: this.config.simpleAir && this.state.airHeight < 6 ? 0 : this.state.airHeight,
      enableAir: this.config.enableAir,
      testButton: this.state.testButton,
      serviceButton: this.state.serviceButton
    });
    this.packetId = (this.packetId + 1) >>> 0;
    if (this.packetId === 0) this.packetId = 1;
    this.sendRaw(inputPacket);

    if (this.config.virtualCard.enabled) {
      this.sendRaw(buildCardPacket(this.config.virtualCard));
    }
  }

  sendRaw(packet) {
    if (!packet) return;
    if (this.tcp && !this.tcp.destroyed) {
      this.tcp.write(packet);
      return;
    }
    if (this.udp && this.endpoint) {
      this.udp.send(packet, this.endpoint.port, this.endpoint.host);
    }
  }

  handleTcpData(chunk) {
    this.tcpRemains = Buffer.concat([this.tcpRemains, chunk]);
    while (this.tcpRemains.length >= 1) {
      const packetLength = this.tcpRemains[0] + 1;
      if (this.tcpRemains.length < packetLength) break;
      const packet = this.tcpRemains.subarray(0, packetLength);
      this.tcpRemains = this.tcpRemains.subarray(packetLength);
      this.handleServerPacket(packet);
    }
  }

  handleServerPacket(packet) {
    const decoded = decodeServerPacket(packet);
    if (!decoded) return;
    if (decoded.type === "led") {
      this.status.led = decoded.colors;
      this.emitStatus();
    } else if (decoded.type === "pong") {
      this.status.latencyMs = decoded.latencyMs;
      this.emitStatus();
    }
  }

  emitStatus() {
    this.emit("status", { ...this.status });
  }
}

module.exports = {
  BrokenithmClient,
  DEFAULT_CONFIG,
  FUNCTION_CARD,
  FUNCTION_COIN,
  firstLocalIPv4,
  mergeConfig
};
