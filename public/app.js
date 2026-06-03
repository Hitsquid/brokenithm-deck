"use strict";

const refs = {
  address: document.getElementById("address"),
  form: document.getElementById("connection-form"),
  connectButton: document.getElementById("connect-button"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  connectionLine: document.getElementById("connection-line"),
  coinButton: document.getElementById("coin-button"),
  cardButton: document.getElementById("card-button"),
  holdButtons: [...document.querySelectorAll("[data-hold]")],
  enableAir: document.getElementById("enable-air"),
  simpleAir: document.getElementById("simple-air"),
  showDelay: document.getElementById("show-delay"),
  latency: document.getElementById("latency"),
  playSurface: document.getElementById("play-surface"),
  airStack: document.getElementById("air-stack"),
  sliderVisual: document.getElementById("slider-visual"),
  traceCanvas: document.getElementById("trace-canvas"),
  localPort: document.getElementById("local-port"),
  advertiseAddress: document.getElementById("advertise-address"),
  udpServerFeedback: document.getElementById("udp-server-feedback"),
  sendHz: document.getElementById("send-hz"),
  sendHzValue: document.getElementById("send-hz-value"),
  virtualCardEnabled: document.getElementById("virtual-card-enabled"),
  virtualCardPresent: document.getElementById("virtual-card-present"),
  cardId: document.getElementById("card-id")
};

const state = {
  config: {
    address: "",
    mode: "udp",
    enableAir: true,
    simpleAir: false,
    showDelay: false,
    sendHz: 500,
    localPort: 52468,
    advertiseAddress: "",
    udpServerFeedback: false,
    virtualCard: {
      enabled: false,
      present: false,
      type: 0,
      id: ""
    }
  },
  connected: false,
  ws: null,
  wakeLock: null,
  pointers: new Map(),
  keys: new Set(),
  airHeight: 6,
  testButton: false,
  serviceButton: false,
  keyboardKeys: new Set(),
  gamepadButtons: [],
  pendingState: false,
  held: {
    testButton: false,
    serviceButton: false
  }
};

const SENSOR_COUNT = 32;
const LANE_PALETTE = [
  [244, 75, 95],
  [245, 120, 52],
  [246, 180, 57],
  [224, 220, 72],
  [156, 224, 90],
  [74, 210, 125],
  [52, 206, 188],
  [63, 180, 238],
  [89, 143, 245],
  [132, 112, 244],
  [179, 100, 232],
  [222, 93, 190],
  [241, 97, 139],
  [244, 132, 88],
  [218, 179, 66],
  [170, 212, 86]
];

function createSurface() {
  for (let i = 0; i < 6; i += 1) {
    const band = document.createElement("div");
    band.className = "air-band";
    band.dataset.label = `AIR ${i + 1}`;
    refs.airStack.appendChild(band);
  }

  for (let i = 0; i < 32; i += 1) {
    const key = document.createElement("div");
    key.className = "key";
    key.dataset.key = String(i);
    const laneColor = LANE_PALETTE[Math.floor(i / 2) % LANE_PALETTE.length];
    key.style.setProperty("--lane-rgb", laneColor.join(", "));
    refs.sliderVisual.appendChild(key);
  }
}

function connectWebSocket() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  state.ws = new WebSocket(url);
  state.ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "config") {
      applyConfig(message.config);
      if (message.status) applyStatus(message.status);
    }
    if (message.type === "status") applyStatus(message.status);
    if (message.type === "error") refs.connectionLine.textContent = message.message;
  });
  state.ws.addEventListener("close", () => {
    refs.connectionLine.textContent = "App server disconnected";
    setTimeout(connectWebSocket, 1000);
  });
}

function send(message) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify(message));
}

async function requestAppFullscreen() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
  }

  try {
    if (navigator.wakeLock && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
    }
  } catch {
  }
}

function blockInterruptingGesture(event) {
  event.preventDefault();
}

function applyConfig(config) {
  state.config = {
    ...state.config,
    ...config,
    virtualCard: {
      ...state.config.virtualCard,
      ...(config.virtualCard || {})
    }
  };

  refs.address.value = state.config.address || "";
  refs.enableAir.checked = state.config.enableAir !== false;
  refs.simpleAir.checked = Boolean(state.config.simpleAir);
  refs.showDelay.checked = Boolean(state.config.showDelay);
  refs.localPort.value = state.config.localPort || 52468;
  refs.advertiseAddress.value = state.config.advertiseAddress || "";
  refs.udpServerFeedback.checked = Boolean(state.config.udpServerFeedback);
  refs.sendHz.value = state.config.sendHz || 500;
  refs.sendHzValue.textContent = `${refs.sendHz.value} Hz`;
  refs.virtualCardEnabled.checked = Boolean(state.config.virtualCard.enabled);
  refs.virtualCardPresent.checked = Boolean(state.config.virtualCard.present);
  refs.cardId.value = state.config.virtualCard.id || "";
  setMode(state.config.mode || "udp");
}

function applyStatus(status) {
  state.connected = Boolean(status.connected);
  refs.connectButton.textContent = state.connected ? "Stop" : "Start";
  refs.connectButton.classList.toggle("stop", state.connected);
  refs.connectionLine.textContent = status.error
    ? status.error
    : state.connected
      ? `${status.mode.toUpperCase()} ${status.endpoint || ""}`
      : "Offline";
  refs.latency.textContent = Number.isFinite(status.latencyMs) ? `${status.latencyMs.toFixed(2)} ms` : "-- ms";
  if (Array.isArray(status.led)) renderLed(status.led);
}

function setMode(mode) {
  state.config.mode = mode === "tcp" ? "tcp" : "udp";
  for (const button of refs.modeButtons) {
    button.classList.toggle("active", button.dataset.mode === state.config.mode);
  }
}

function collectConfig() {
  return {
    ...state.config,
    address: refs.address.value.trim(),
    mode: state.config.mode,
    enableAir: refs.enableAir.checked,
    simpleAir: refs.simpleAir.checked,
    showDelay: refs.showDelay.checked,
    localPort: Number(refs.localPort.value) || 52468,
    advertiseAddress: refs.advertiseAddress.value.trim(),
    udpServerFeedback: refs.udpServerFeedback.checked,
    sendHz: Number(refs.sendHz.value) || 500,
    virtualCard: {
      ...state.config.virtualCard,
      enabled: refs.virtualCardEnabled.checked,
      present: refs.virtualCardPresent.checked,
      id: refs.cardId.value.trim()
    }
  };
}

function saveConfig() {
  state.config = collectConfig();
  send({ type: "config", config: state.config });
}

function renderLed(colors) {
  const keys = [...refs.sliderVisual.children];
  for (let i = 0; i < keys.length; i += 1) {
    const color = colors[31 - i] || { r: 0, g: 0, b: 0 };
    const lit = color.r + color.g + color.b > 16;
    keys[i].classList.toggle("led-lit", lit);
    keys[i].style.setProperty("--led-color", `rgb(${color.r}, ${color.g}, ${color.b})`);
    keys[i].style.setProperty("--led-rgb", `${color.r}, ${color.g}, ${color.b}`);
  }
}

function sendStateSoon() {
  if (state.pendingState) return;
  state.pendingState = true;
  requestAnimationFrame(() => {
    state.pendingState = false;
    sendState();
  });
}

function sendState() {
  send({
    type: "state",
    state: {
      keys: [...state.keys],
      airHeight: state.airHeight,
      testButton: state.testButton || state.held.testButton,
      serviceButton: state.serviceButton || state.held.serviceButton
    }
  });
  renderActiveInput();
}

function renderActiveInput() {
  for (const key of refs.sliderVisual.children) {
    key.classList.toggle("active", state.keys.has(Number(key.dataset.key)));
  }
  const bands = [...refs.airStack.children];
  for (let i = 0; i < bands.length; i += 1) {
    bands[i].classList.toggle("active", state.config.enableAir && state.airHeight <= i);
  }
  drawTrace();
}

function addSliderSensor(target, key) {
  target.add(Math.max(0, Math.min(SENSOR_COUNT - 1, key)));
}

function mapSlider(point, width, target) {
  const sensorWidth = width / SENSOR_COUNT;
  const clampedX = Math.max(0, Math.min(width - 1, point.x));
  const position = Math.max(0, Math.min(SENSOR_COUNT - 0.001, clampedX / sensorWidth));
  const center = Math.floor(position);
  const contactWidth = Math.max(0, Number(point.width) || 0);
  const contactSpan = Math.max(0, Math.min(2.5, contactWidth / sensorWidth));

  if (contactSpan > 0.7) {
    const left = Math.floor(position - contactSpan / 2);
    const right = Math.floor(position + contactSpan / 2);
    for (let key = left; key <= right; key += 1) addSliderSensor(target, key);
    return;
  }

  addSliderSensor(target, center);
  const fraction = position - center;
  if (fraction < 0.1 && center > 0) addSliderSensor(target, center - 1);
  if (fraction > 0.9 && center < SENSOR_COUNT - 1) addSliderSensor(target, center + 1);
}

function recomputeTouchState() {
  const rect = refs.playSurface.getBoundingClientRect();
  const airHeightPx = rect.height * 0.42;
  const keys = new Set(state.keyboardKeys);
  let airHeight = 6;

  for (const point of state.pointers.values()) {
    const x = point.clientX - rect.left;
    const y = point.clientY - rect.top;
    if (state.config.enableAir && y >= 0 && y < airHeightPx) {
      airHeight = state.config.simpleAir ? 0 : Math.min(5, Math.floor((y / airHeightPx) * 6));
    } else if (y >= airHeightPx && y <= rect.height) {
      mapSlider({ ...point, x }, rect.width, keys);
    }
  }

  state.keys = keys;
  state.airHeight = state.config.enableAir ? airHeight : 6;
  sendStateSoon();
}

function pointerUpdate(event) {
  state.pointers.set(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY,
    width: event.pointerType === "touch" ? event.width : 0
  });
  recomputeTouchState();
}

function pointerRemove(event) {
  state.pointers.delete(event.pointerId);
  recomputeTouchState();
}

function clearTouchPointers() {
  if (state.pointers.size === 0) return;
  state.pointers.clear();
  recomputeTouchState();
}

function syncTouchPointers(event) {
  if (event.cancelable) event.preventDefault();

  state.pointers.clear();
  for (const touch of Array.from(event.touches)) {
    state.pointers.set(`touch-${touch.identifier}`, {
      clientX: touch.clientX,
      clientY: touch.clientY,
      width: Math.max(0, Number(touch.radiusX) || 0) * 2
    });
  }

  recomputeTouchState();
}

function touchRelease(event) {
  if (event.cancelable) event.preventDefault();
  if (event.touches.length === 0) {
    clearTouchPointers();
    return;
  }
  syncTouchPointers(event);
}

function drawTrace() {
  const canvas = refs.traceCanvas;
  const rect = refs.playSurface.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ratio, ratio);
  for (const point of state.pointers.values()) {
    const x = point.clientX - rect.left;
    const y = point.clientY - rect.top;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(57, 216, 200, 0.18)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(243, 183, 68, 0.7)";
    ctx.stroke();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function keyboardToKey(code) {
  const map = {
    KeyA: 0,
    KeyS: 4,
    KeyD: 8,
    KeyF: 12,
    KeyJ: 19,
    KeyK: 23,
    KeyL: 27,
    Semicolon: 31
  };
  return map[code];
}

function handleGamepad() {
  const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
  if (pad) {
    const buttons = pad.buttons.map((button) => button.pressed);
    if (buttons[8] && !state.gamepadButtons[8]) send({ type: "function", name: "coin" });
    if (buttons[9] && !state.gamepadButtons[9]) send({ type: "function", name: "card" });
    state.testButton = Boolean(buttons[4]);
    state.serviceButton = Boolean(buttons[5]);

    if (state.config.enableAir) {
      if (buttons[12] || (pad.buttons[6] && pad.buttons[6].value > 0.5)) state.airHeight = 0;
      if (buttons[13] || (pad.buttons[7] && pad.buttons[7].value > 0.5)) state.airHeight = 6;
    }
    state.gamepadButtons = buttons;
    sendStateSoon();
  }
  requestAnimationFrame(handleGamepad);
}

function bindEvents() {
  refs.form.addEventListener("submit", (event) => {
    event.preventDefault();
    requestAppFullscreen();
    state.config = collectConfig();
    if (state.connected) {
      send({ type: "disconnect" });
      return;
    }
    if (!state.config.address) {
      refs.address.focus();
      refs.connectionLine.textContent = "Server address is required";
      return;
    }
    send({ type: "connect", config: state.config });
  });

  refs.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode);
      saveConfig();
    });
  });

  refs.coinButton.addEventListener("click", () => send({ type: "function", name: "coin" }));
  refs.cardButton.addEventListener("click", () => send({ type: "function", name: "card" }));

  refs.holdButtons.forEach((button) => {
    const field = button.dataset.hold;
    const setHeld = (value) => {
      state.held[field] = value;
      button.classList.toggle("active", value);
      sendStateSoon();
    };
    button.addEventListener("pointerdown", (event) => {
      button.setPointerCapture(event.pointerId);
      setHeld(true);
    });
    button.addEventListener("pointerup", () => setHeld(false));
    button.addEventListener("pointercancel", () => setHeld(false));
    button.addEventListener("pointerleave", () => setHeld(false));
  });

  [
    refs.enableAir,
    refs.simpleAir,
    refs.showDelay,
    refs.localPort,
    refs.advertiseAddress,
    refs.udpServerFeedback,
    refs.sendHz,
    refs.virtualCardEnabled,
    refs.virtualCardPresent,
    refs.cardId
  ].forEach((input) => {
    input.addEventListener("input", () => {
      refs.sendHzValue.textContent = `${refs.sendHz.value} Hz`;
      saveConfig();
      recomputeTouchState();
    });
  });

  refs.playSurface.addEventListener("pointerdown", (event) => {
    requestAppFullscreen();
    refs.playSurface.setPointerCapture(event.pointerId);
    pointerUpdate(event);
  });
  refs.playSurface.addEventListener("pointermove", pointerUpdate);
  refs.playSurface.addEventListener("pointerup", pointerRemove);
  refs.playSurface.addEventListener("pointercancel", pointerRemove);
  refs.playSurface.addEventListener("lostpointercapture", pointerRemove);
  window.addEventListener("pointerup", pointerRemove);
  window.addEventListener("pointercancel", pointerRemove);
  window.addEventListener("blur", clearTouchPointers);
  refs.playSurface.addEventListener("touchstart", (event) => {
    requestAppFullscreen();
    syncTouchPointers(event);
  }, { passive: false });
  refs.playSurface.addEventListener("touchmove", syncTouchPointers, { passive: false });
  refs.playSurface.addEventListener("touchend", touchRelease, { passive: false });
  refs.playSurface.addEventListener("touchcancel", touchRelease, { passive: false });

  window.addEventListener("keydown", (event) => {
    requestAppFullscreen();
    if (event.repeat) return;
    if (event.code === "Digit1") send({ type: "function", name: "coin" });
    if (event.code === "Digit2") send({ type: "function", name: "card" });
    if (event.code === "KeyT") state.held.testButton = true;
    if (event.code === "KeyY") state.held.serviceButton = true;
    const key = keyboardToKey(event.code);
    if (key !== undefined) state.keyboardKeys.add(key);
    recomputeTouchState();
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "KeyT") state.held.testButton = false;
    if (event.code === "KeyY") state.held.serviceButton = false;
    const key = keyboardToKey(event.code);
    if (key !== undefined) state.keyboardKeys.delete(key);
    recomputeTouchState();
  });

  window.addEventListener("contextmenu", blockInterruptingGesture);
  window.addEventListener("dragstart", blockInterruptingGesture);
  window.addEventListener("selectstart", blockInterruptingGesture);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestAppFullscreen();
  });
}

createSurface();
bindEvents();
connectWebSocket();
handleGamepad();
