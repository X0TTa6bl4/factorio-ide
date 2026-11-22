/** EventCombinator: синхронный сценарий поверх транзакции тика. */

import { ConfigError, RuntimeError } from "./errors.js";
import { cloneConfigJson, cloneRuntimeJson } from "./json-value.js";
import { xorshift32 } from "./rng.js";
import { readSignalCount } from "./signal-count.js";
import {
  addToTable,
  combineMasked,
  createTable,
  presentTable,
  readTable,
} from "./signal-table.js";

const PORTS = ["red_input", "green_input", "red_output", "green_output"];
const ALLOWED = new Set([...PORTS, "state", "run"]);
const OUTPUT_KEYS = ["green", "red", "signals"];
const CLEAR_KEYS = ["green", "red"];
const MESSAGE_KEYS = ["data", "type"];
const sessions = new WeakMap();

function fail(code, message) {
  throw new RuntimeError(code, message);
}

function plain(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, message);
}

function exactKeys(value, allowed, code, message) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || allowed.some((key) => !Object.hasOwn(value, key))) {
    fail(code, message);
  }
}

function readPort(config, key) {
  if (!Object.hasOwn(config, key) || config[key] === null) return null;
  const value = config[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("invalid-port", "Требуется ссылка на сеть или null");
  }
  return value;
}

function readRun(config) {
  if (!Object.hasOwn(config, "run")) return { every_tick: true, input_changed: false };
  const run = config.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new ConfigError("invalid-run", "run должен быть объектом {every_tick, input_changed}");
  }
  const keys = Object.keys(run);
  if (keys.length !== 2 || !Object.hasOwn(run, "every_tick") || !Object.hasOwn(run, "input_changed")) {
    throw new ConfigError("invalid-run", "run содержит только every_tick и input_changed");
  }
  if (typeof run.every_tick !== "boolean" || typeof run.input_changed !== "boolean") {
    throw new ConfigError("invalid-run", "every_tick и input_changed должны быть boolean");
  }
  return { every_tick: run.every_tick, input_changed: run.input_changed };
}

function sessionOf(device) {
  const session = sessions.get(device);
  if (!session) fail("inactive-script", "Метод сценария доступен только во время init и main");
  return session;
}

function countsFrom(signals, profile) {
  if (!Array.isArray(signals)) fail("invalid-output", "signals должен быть массивом");
  const table = createTable();
  for (const entry of signals) {
    const count = readSignalCount(entry, profile);
    addToTable(table, count.signal, count.constant);
  }
  return table;
}

function readOutput(action) {
  plain(action, "invalid-output", "Действие выхода должно быть объектом");
  exactKeys(action, OUTPUT_KEYS, "invalid-output", "Действие выхода содержит red, green и signals");
  if (typeof action.red !== "boolean" || typeof action.green !== "boolean") {
    fail("invalid-output", "Цвета выхода должны быть boolean");
  }
  return { red: action.red, green: action.green, signals: action.signals };
}

function readClear(action) {
  plain(action, "invalid-output", "clearOutput принимает объект цветов");
  exactKeys(action, CLEAR_KEYS, "invalid-output", "clearOutput содержит только red и green");
  if (typeof action.red !== "boolean" || typeof action.green !== "boolean") {
    fail("invalid-output", "Цвета clearOutput должны быть boolean");
  }
  return { red: action.red, green: action.green };
}

function readDuration(duration) {
  if (!Number.isSafeInteger(duration) || duration < 1) {
    fail("invalid-pulse", "Длительность импульса должна быть целым числом от 1");
  }
  return duration;
}

function readWake(tick) {
  if (!Number.isSafeInteger(tick)) fail("invalid-wake", "Граница пробуждения должна быть целым числом");
  return tick;
}

function readPayload(message) {
  plain(message, "invalid-message", "Сообщение должно быть объектом {type, data}");
  exactKeys(message, MESSAGE_KEYS, "invalid-message", "Сообщение содержит только type и data");
  if (typeof message.type !== "string" || message.type.length === 0) {
    fail("invalid-message", "Тип сообщения должен быть непустой строкой");
  }
  return { type: message.type, data: cloneRuntimeJson(message.data) };
}

function freezeJson(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  const items = Array.isArray(value) ? value : Object.values(value);
  for (const item of items) freezeJson(item);
  return value;
}

function freezeMessages(messages) {
  const frozen = messages.map((message) => Object.freeze({
    from: message.from,
    to: message.to,
    sentTick: message.sentTick,
    deliveryTick: message.deliveryTick,
    sequence: message.sequence,
    type: message.type,
    data: freezeJson(cloneRuntimeJson(message.data)),
  }));
  return Object.freeze(frozen);
}

function inputsOf(view, profile) {
  return {
    red: countsFrom(view.inputs.red, profile),
    green: countsFrom(view.inputs.green, profile),
  };
}

function peersOf(receiverId, byId) {
  const peers = {};
  if (receiverId) {
    const peer = byId.get(receiverId);
    if (peer) peers.receiver = peer;
  }
  return Object.freeze(peers);
}

function touch(session, color, table) {
  session.held[color] = table;
  session.touched[color] = true;
}

function applyColors(session, flags, signals) {
  const table = countsFrom(signals, session.profile);
  if (!flags.red && !flags.green) return null;
  return { table, red: flags.red, green: flags.green };
}

function isThenable(value) {
  return Boolean(value)
    && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function annotate(error, id, tick) {
  if (error instanceof ConfigError || error instanceof RuntimeError) {
    if (!Object.hasOwn(error, "deviceId")) error.deviceId = id;
    if (!Object.hasOwn(error, "tick")) error.tick = tick;
    return error;
  }
  const text = error instanceof Error ? error.message : String(error);
  const wrapped = new RuntimeError("script-error", `Сценарий ${id} на тике ${tick}: ${text}`);
  wrapped.deviceId = id;
  wrapped.tick = tick;
  wrapped.cause = error;
  return wrapped;
}

function finish(session, id) {
  const patch = {
    id,
    state: cloneRuntimeJson(session.state),
    rng: session.rng,
  };
  const clear = {};
  if (session.clear.red) clear.red = true;
  if (session.clear.green) clear.green = true;
  if (clear.red || clear.green) patch.clear = clear;
  const held = {};
  if (session.touched.red) held.red = presentTable(session.held.red);
  if (session.touched.green) held.green = presentTable(session.held.green);
  if (held.red || held.green) patch.held = held;
  if (session.pulses.length > 0) {
    patch.pulses = session.pulses.map((pulse) => ({
      red: pulse.red,
      green: pulse.green,
      signals: pulse.signals,
      duration: pulse.duration,
    }));
  }
  const wake = [];
  const cancelWake = [];
  for (const tick of session.wakes) {
    if (!session.publishedWakes.has(tick)) wake.push(tick);
  }
  for (const tick of session.publishedWakes) {
    if (!session.wakes.has(tick)) cancelWake.push(tick);
  }
  wake.sort((left, right) => left - right);
  cancelWake.sort((left, right) => left - right);
  if (wake.length > 0) patch.wake = wake;
  if (cancelWake.length > 0) patch.cancelWake = cancelWake;
  if (session.sends.length > 0) patch.send = session.sends;
  return patch;
}

export class EventCombinator {
  #state;
  #run;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new ConfigError("invalid-event-config", "EventCombinator принимает объект настроек");
    }
    for (const key of Object.keys(config)) {
      if (!ALLOWED.has(key)) {
        throw new ConfigError("invalid-event-config", `Неизвестный параметр ${key}`);
      }
    }
    for (const key of PORTS) this[key] = readPort(config, key);
    this.participate = true;
    this.#run = readRun(config);
    this.#state = Object.hasOwn(config, "state") ? cloneConfigJson(config.state) : {};
  }

  get runMode() {
    return { every_tick: this.#run.every_tick, input_changed: this.#run.input_changed };
  }

  get state() {
    const session = sessions.get(this);
    return session ? session.state : this.#state;
  }

  set state(value) {
    const session = sessions.get(this);
    if (session) {
      session.state = cloneRuntimeJson(value);
      return;
    }
    this.#state = cloneConfigJson(value);
  }

  get tick() {
    return sessionOf(this).tick;
  }

  set tick(value) {
    void value;
    fail("readonly", "tick доступен только для чтения");
  }

  get nextTick() {
    return sessionOf(this).nextTick;
  }

  set nextTick(value) {
    void value;
    fail("readonly", "nextTick доступен только для чтения");
  }

  get messages() {
    return sessionOf(this).messages;
  }

  set messages(value) {
    void value;
    fail("readonly", "messages доступны только для чтения");
  }

  get peers() {
    return sessionOf(this).peers;
  }

  set peers(value) {
    void value;
    fail("readonly", "peers доступны только для чтения");
  }

  init() {}

  main() {}

  readSignal(signal, mask) {
    const session = sessionOf(this);
    if (session.phase === "init") fail("forbidden-read", "init не читает входные сети");
    return readTable(combineMasked(session.inputs.red, session.inputs.green, mask), signal);
  }

  readSignals(mask) {
    const session = sessionOf(this);
    if (session.phase === "init") fail("forbidden-read", "init не читает входные сети");
    const rows = presentTable(combineMasked(session.inputs.red, session.inputs.green, mask))
      .map((entry) => Object.freeze({ signal: entry.signal, constant: entry.constant }));
    return Object.freeze(rows);
  }

  setOutput(action) {
    const session = sessionOf(this);
    const output = readOutput(action);
    const applied = applyColors(session, output, output.signals);
    if (!applied) return;
    if (applied.red) touch(session, "red", applied.table);
    if (applied.green) touch(session, "green", applied.red ? cloneTable(applied.table) : applied.table);
  }

  clearOutput(action) {
    const session = sessionOf(this);
    const colors = readClear(action);
    for (const color of ["red", "green"]) {
      if (!colors[color]) continue;
      touch(session, color, createTable());
      session.clear[color] = true;
      session.pulses = session.pulses.filter((pulse) => !pulse[color]);
    }
  }

  pulse(action, duration = 1) {
    const session = sessionOf(this);
    const length = readDuration(duration);
    const output = readOutput(action);
    const applied = applyColors(session, output, output.signals);
    if (!applied) return;
    const signals = presentTable(applied.table);
    if (applied.red) session.pulses.push({ red: true, green: false, signals, duration: length });
    if (applied.green) {
      session.pulses.push({
        red: false,
        green: true,
        signals: applied.red ? signals.map((entry) => ({ ...entry })) : signals,
        duration: length,
      });
    }
  }

  wakeAt(tick) {
    const session = sessionOf(this);
    const value = readWake(tick);
    const earliest = session.phase === "init" ? 0 : session.tick + 1;
    if (value < earliest) fail("invalid-wake", "Пробуждение назначено не на будущую границу");
    session.wakes.add(value);
  }

  cancelWake(tick) {
    const session = sessionOf(this);
    const value = readWake(tick);
    if (!session.wakes.has(value)) fail("unknown-wake", "Нельзя снять отсутствующее пробуждение");
    session.wakes.delete(value);
  }

  send(target, message) {
    const session = sessionOf(this);
    if (session.phase === "init") fail("forbidden-send", "init не отправляет сообщения");
    const id = session.ids.get(target);
    if (typeof id !== "string") {
      fail("invalid-message", "Получатель сообщения должен быть событийным блоком этой схемы");
    }
    const payload = readPayload(message);
    session.sends.push({ to: id, type: payload.type, data: payload.data });
  }

  random() {
    const session = sessionOf(this);
    if (typeof session.rng !== "number") fail("invalid-rng", "У сценария нет состояния RNG");
    session.rng = xorshift32(session.rng);
    return session.rng / 4294967296;
  }
}

function cloneTable(table) {
  const copy = createTable();
  for (const [key, entry] of table) copy.set(key, { token: entry.token, value: entry.value });
  return copy;
}

export function runScript(device, spec) {
  const view = spec.view;
  const session = {
    phase: spec.phase,
    tick: spec.tick,
    nextTick: spec.nextTick,
    profile: spec.profile,
    state: cloneRuntimeJson(view.state),
    rng: view.rng,
    messages: freezeMessages(view.messages),
    peers: peersOf(view.receiverId, spec.byId),
    ids: spec.ids,
    inputs: spec.phase === "step" ? inputsOf(view, spec.profile) : null,
    held: { red: null, green: null },
    touched: { red: false, green: false },
    clear: { red: false, green: false },
    pulses: [],
    wakes: new Set(view.wakes),
    publishedWakes: new Set(view.wakes),
    sends: [],
  };
  sessions.set(device, session);
  let outcome;
  try {
    const result = spec.phase === "init" ? device.init() : device.main();
    if (isThenable(result)) fail("async-main", "init и main должны завершаться синхронно");
    outcome = { ok: true, value: finish(session, spec.id) };
  } catch (error) {
    outcome = { ok: false, error: annotate(error, spec.id, spec.tick) };
  }
  sessions.delete(device);
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
