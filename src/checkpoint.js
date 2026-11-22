/** Снимок опубликованной границы: сети, вклады, RNG, сообщения и расписание. */

import { RuntimeError } from "./errors.js";
import { readLampState } from "./lamp.js";
import { readStationState, readTrainState } from "./train.js";
import { isInt32 } from "./int32.js";
import { cloneRuntimeJson } from "./json-value.js";
import { canonicalSignal } from "./signal-codec.js";

const ROOT_KEYS = ["devices", "gameVersion", "networks", "profile", "tick"];
const NETWORK_KEYS = ["id", "signals"];
const DEVICE_KEYS = [
  "held",
  "id",
  "messages",
  "output",
  "pulses",
  "rng",
  "seenInputs",
  "state",
  "wakes",
];
const COUNT_KEYS = ["constant", "signal"];
const IDENTITY_KEYS = ["name", "quality", "type"];
const SIDE_KEYS = ["green", "red"];
const PULSE_KEYS = ["color", "end", "signals", "start"];
const MESSAGE_KEYS = ["data", "deliveryTick", "from", "sentTick", "sequence", "to", "type"];

function invalid(message) {
  throw new RuntimeError("invalid-snapshot", message);
}

function plain(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(message);
}

function exactKeys(value, allowed, message) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || allowed.some((key) => !Object.hasOwn(value, key))) {
    invalid(message);
  }
}

function isUint32(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4294967295;
}

function isWhole(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function readIdentity(value) {
  plain(value, "Ключ сигнала в снимке должен быть объектом");
  exactKeys(value, IDENTITY_KEYS, "Ключ сигнала в снимке содержит type, name и quality");
  if (typeof value.type !== "string" || value.type === ""
    || typeof value.name !== "string" || value.name === ""
    || typeof value.quality !== "string" || value.quality === "") {
    invalid("type, name и quality сигнала должны быть непустыми строками");
  }
  return value;
}

function readCounts(value, profile, label) {
  if (!Array.isArray(value)) invalid(`${label} должен быть массивом сигналов`);
  return value.map((entry) => {
    plain(entry, "SignalCount в снимке должен быть объектом");
    exactKeys(entry, COUNT_KEYS, "SignalCount в снимке содержит signal и constant");
    if (!isInt32(entry.constant)) invalid("Количество в снимке должно быть целым int32");
    return { signal: canonicalSignal(profile, readIdentity(entry.signal)), constant: entry.constant };
  });
}

function readSides(value, profile, label) {
  plain(value, `${label} должен быть объектом цветов`);
  exactKeys(value, SIDE_KEYS, `${label} содержит только red и green`);
  return {
    red: readCounts(value.red, profile, `${label}.red`),
    green: readCounts(value.green, profile, `${label}.green`),
  };
}

function readMessage(value) {
  plain(value, "Сообщение в снимке должно быть объектом");
  exactKeys(value, MESSAGE_KEYS, "Сообщение в снимке содержит поля конверта");
  if (typeof value.from !== "string" || typeof value.to !== "string") {
    invalid("from и to сообщения должны быть строками");
  }
  if (!isWhole(value.sentTick) || !isWhole(value.deliveryTick) || !isWhole(value.sequence)) {
    invalid("Тики и sequence сообщения должны быть целыми числами от 0");
  }
  if (typeof value.type !== "string" || value.type === "") {
    invalid("Тип сообщения в снимке должен быть непустой строкой");
  }
  return {
    from: value.from,
    to: value.to,
    sentTick: value.sentTick,
    deliveryTick: value.deliveryTick,
    sequence: value.sequence,
    type: value.type,
    data: cloneRuntimeJson(value.data),
  };
}

function readPulse(value, profile) {
  plain(value, "Импульс в снимке должен быть объектом");
  exactKeys(value, PULSE_KEYS, "Импульс в снимке содержит color, start, end и signals");
  if (value.color !== "red" && value.color !== "green") invalid("Цвет импульса должен быть red или green");
  if (!isWhole(value.start) || !isWhole(value.end) || value.end < value.start) {
    invalid("Границы импульса должны быть целыми, end не меньше start");
  }
  return {
    color: value.color,
    start: value.start,
    end: value.end,
    signals: readCounts(value.signals, profile, "Импульс"),
  };
}

export function readSelectorMemory(value, profile, code) {
  const fail = (message) => {
    throw new RuntimeError(code, message);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Состояние random должно быть объектом");
  }
  const keys = Object.keys(value);
  if (keys.length !== 3 || !Object.hasOwn(value, "elapsed") || !Object.hasOwn(value, "held") || !Object.hasOwn(value, "rng")) {
    fail("Состояние random содержит rng, held и elapsed");
  }
  if (!isUint32(value.rng) || !isUint32(value.elapsed)) {
    fail("rng и elapsed состояния random должны быть целыми uint32");
  }
  if (value.held === null) return { rng: value.rng, held: null, elapsed: value.elapsed };
  if (typeof value.held !== "object" || Array.isArray(value.held)) {
    fail("Канал состояния random должен быть объектом");
  }
  const heldKeys = Object.keys(value.held);
  if (heldKeys.length !== 3
    || !Object.hasOwn(value.held, "type")
    || !Object.hasOwn(value.held, "name")
    || !Object.hasOwn(value.held, "quality")) {
    fail("Канал состояния random содержит type, name и quality");
  }
  try {
    const token = canonicalSignal(profile, value.held);
    return {
      rng: value.rng,
      elapsed: value.elapsed,
      held: { type: token.type, name: token.name, quality: token.quality },
    };
  } catch {
    fail("Канал состояния random не входит в профиль");
  }
}

function readDevice(value, profile, expected) {
  plain(value, "Устройство в снимке должно быть объектом");
  exactKeys(value, DEVICE_KEYS, "Устройство в снимке содержит неверный набор полей");
  if (typeof value.id !== "string" || !expected.devices.has(value.id)) {
    invalid("Неизвестное устройство в снимке");
  }
  const info = expected.devices.get(value.id);
  let state = null;
  if (info.participant) state = cloneRuntimeJson(value.state);
  else if (info.random) state = readSelectorMemory(value.state, profile, "invalid-snapshot");
  else if (info.observer) state = readLampState(value.state, "invalid-snapshot");
  else if (info.train) state = readTrainState(value.state, { route: info.route, transit: info.transit }, "invalid-snapshot");
  else if (info.station) state = readStationState(value.state, "invalid-snapshot");
  else if (value.state !== null) invalid("У устройства без сценария state должен быть null");
  if (info.event) {
    if (!isUint32(value.rng)) invalid("RNG сценария в снимке должен быть целым uint32");
  } else if (value.rng !== null) invalid("RNG есть только у событийного блока");
  if (value.seenInputs !== null && typeof value.seenInputs !== "string") {
    invalid("seenInputs должен быть строкой или null");
  }
  if (!Array.isArray(value.wakes) || value.wakes.some((tick) => !isWhole(tick))) {
    invalid("wakes должен быть массивом целых границ от 0");
  }
  if (!Array.isArray(value.messages)) invalid("messages должен быть массивом");
  if (!Array.isArray(value.pulses)) invalid("pulses должен быть массивом");
  return {
    id: value.id,
    state,
    rng: value.rng,
    seenInputs: value.seenInputs,
    wakes: value.wakes.slice(),
    messages: value.messages.map(readMessage),
    output: readSides(value.output, profile, "output"),
    held: readSides(value.held, profile, "held"),
    pulses: value.pulses.map((pulse) => readPulse(pulse, profile)),
  };
}

export function readSnapshot(snapshot, expected) {
  plain(snapshot, "Снимок должен быть объектом");
  exactKeys(snapshot, ROOT_KEYS, "Снимок содержит неверный набор полей");
  if (snapshot.profile !== expected.profile) invalid("Снимок относится к другому профилю");
  if (snapshot.gameVersion !== expected.gameVersion) invalid("Снимок относится к другой версии игры");
  if (!isWhole(snapshot.tick)) invalid("Тик снимка должен быть целым числом от 0");
  if (!Array.isArray(snapshot.networks) || !Array.isArray(snapshot.devices)) {
    invalid("Сети и устройства снимка должны быть массивами");
  }
  const networks = [];
  const seenNetworks = new Set();
  for (const entry of snapshot.networks) {
    plain(entry, "Сеть в снимке должна быть объектом");
    exactKeys(entry, NETWORK_KEYS, "Сеть в снимке содержит id и signals");
    if (typeof entry.id !== "string" || !expected.networkIds.has(entry.id)) invalid("Неизвестная сеть в снимке");
    if (seenNetworks.has(entry.id)) invalid("Сеть повторяется в снимке");
    seenNetworks.add(entry.id);
    networks.push({ id: entry.id, signals: readCounts(entry.signals, expected.profile, "Сеть") });
  }
  if (seenNetworks.size !== expected.networkIds.size) invalid("В снимке не все сети прогона");
  const devices = [];
  const seenDevices = new Set();
  for (const entry of snapshot.devices) {
    const device = readDevice(entry, expected.profile, expected);
    if (seenDevices.has(device.id)) invalid("Устройство повторяется в снимке");
    seenDevices.add(device.id);
    devices.push(device);
  }
  if (seenDevices.size !== expected.devices.size) invalid("В снимке не все устройства прогона");
  assertTrainBoundary(devices, expected);
  return { tick: snapshot.tick, networks, devices };
}

function presenceCounts(counts, present) {
  if (!present) return counts.length === 0;
  return counts.length === 1
    && counts[0].constant === 1
    && counts[0].signal.name === "signal-T"
    && counts[0].signal.quality === "normal";
}

function assertStationOutput(counts, connected, present) {
  if (!connected) {
    if (counts.length !== 0) invalid("Отключённый выход станции должен быть пуст");
    return;
  }
  if (!presenceCounts(counts, present)) invalid("Выход станции не совпадает с присутствием");
}

function assertTrainBoundary(devices, expected) {
  const occupants = new Map();
  for (const device of devices) {
    const info = expected.devices.get(device.id);
    if (!info.train || device.state.phase !== "at") continue;
    const list = occupants.get(device.state.stationId) ?? [];
    list.push(device.id);
    occupants.set(device.state.stationId, list);
  }
  for (const device of devices) {
    const info = expected.devices.get(device.id);
    if (!info.station) continue;
    const list = occupants.get(device.id) ?? [];
    if (list.length > 1) invalid("На одной станции несколько поездов");
    const trainId = list[0] ?? null;
    if (device.state.present !== (trainId !== null) || device.state.trainId !== trainId) {
      invalid("Присутствие станции не совпадает с поездами");
    }
    assertStationOutput(device.output.red, info.outputs.red, device.state.present);
    assertStationOutput(device.output.green, info.outputs.green, device.state.present);
  }
}
