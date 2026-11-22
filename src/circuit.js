/** Circuit: описание схемы. Прогон тиков живёт в runtime и не делит состояние с описанием. */

import { Arithmetic } from "./arithmetic.js";
import { compareText } from "./compare.js";
import { Constant } from "./constant.js";
import { Decider } from "./decider.js";
import { ConfigError } from "./errors.js";
import { EventCombinator } from "./event.js";
import { Lamp } from "./lamp.js";
import { Storage } from "./storage.js";
import { Station, Train, initialTrainState } from "./train.js";
import { isInt32 } from "./int32.js";
import { cloneConfigJson } from "./json-value.js";
import { assertSimulationOptions, createRuntime } from "./runtime.js";
import { Selector } from "./selector.js";
import { createScenarioExecutor } from "./scenario.js";
import { openProfile } from "./signal-profile.js";
import { readSignalCount } from "./signal-count.js";
import {
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "./signal-token.js";

const owners = new WeakMap();
const PORTS = [
  ["red_input", "red"],
  ["green_input", "green"],
  ["red_output", "red"],
  ["green_output", "green"],
];
const UNSUPPORTED = ["sections", "group", "multiplier"];

function readOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new ConfigError("invalid-circuit-options", "Circuit принимает объект настроек");
  }
  for (const key of Object.keys(options)) {
    if (key !== "profile" && key !== "seed" && key !== "world") {
      throw new ConfigError("invalid-circuit-options", `Неизвестный параметр ${key}`);
    }
  }
  const profileName = Object.hasOwn(options, "profile") ? options.profile : "base";
  if (profileName !== "base" && profileName !== "space-age") {
    throw new ConfigError("invalid-profile", "Профиль должен быть base или space-age");
  }
  const seed = Object.hasOwn(options, "seed") ? options.seed : 1;
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    throw new ConfigError("invalid-seed", "seed должен быть целым uint32");
  }
  return { profileName, seed, world: readWorld(options.world, Object.hasOwn(options, "world")) };
}

function readWorld(value, present) {
  if (!present || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("invalid-world", "Контекст мира должен быть объектом");
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !Object.hasOwn(value, "origin") || !Object.hasOwn(value, "dayLength")) {
    throw new ConfigError("invalid-world", "Контекст мира содержит origin и dayLength");
  }
  if (!isInt32(value.origin) || value.origin < 0) {
    throw new ConfigError("invalid-world", "origin должен быть целым int32 от 0");
  }
  if (!isInt32(value.dayLength) || value.dayLength < 1) {
    throw new ConfigError("invalid-world", "dayLength должен быть целым int32 от 1");
  }
  return { origin: value.origin, dayLength: value.dayLength };
}

function parseName(name) {
  if (typeof name !== "string") {
    throw new ConfigError("invalid-name", "Имя сети должно быть строкой");
  }
  if (name === "red_new" || name === "green_new") {
    throw new ConfigError("reserved-name", `Имя ${name} зарезервировано для редактора`);
  }
  const match = /^(red|green)_([A-Za-z0-9_]+)$/.exec(name);
  if (!match) {
    throw new ConfigError("invalid-name", "Имя сети должно иметь вид red_* или green_*");
  }
  return { color: match[1] };
}

function readPort(device, field, color, circuit) {
  if (!Object.hasOwn(device, field)) return null;
  const value = device[field];
  if (value === null) return null;
  if (typeof value === "string") {
    throw new ConfigError("invalid-port", "Требуется ссылка на сеть или null, получена строка");
  }
  if (isOperationToken(value)) {
    throw new ConfigError("invalid-port", "Операция не является сетью");
  }
  if (isSignalToken(value) || isMetaToken(value) || isQualityToken(value) || isQualitySelectorToken(value)) {
    throw new ConfigError("invalid-port", "Сигнал не является сетью");
  }
  if (!(value instanceof Network)) {
    throw new ConfigError("invalid-port", "Требуется ссылка на сеть или null");
  }
  if (value.circuit === null) {
    throw new ConfigError("missing-network", "Сеть уже исключена из схемы");
  }
  if (value.circuit !== circuit) {
    throw new ConfigError("foreign-network", "Сеть принадлежит другой схеме");
  }
  if (value.color !== color) {
    throw new ConfigError("wrong-color", "Цвет сети не соответствует порту");
  }
  return value;
}

function classifyDevice(device) {
  if (device instanceof Storage) return "constant";
  if (device instanceof Station) return "station";
  if (device instanceof Train) return "train";
  const isConstant = device instanceof Constant;
  const hasSignals = Object.hasOwn(device, "signals");
  const hasParticipate = "participate" in device;
  const hasCompute = "compute" in device;
  const hasObserve = typeof device.observe === "function";
  if (hasParticipate && device.participate !== true) {
    throw new ConfigError("invalid-participant", "participate должен быть true");
  }
  if (hasCompute && typeof device.compute !== "function") {
    throw new ConfigError("invalid-compute", "compute должен быть функцией");
  }
  const source = isConstant || hasSignals;
  const roles = [source, hasParticipate, hasCompute, hasObserve].filter(Boolean).length;
  if (roles > 1) {
    throw new ConfigError("mixed-device", "У устройства должен быть один способ исполнения");
  }
  if (source) return "constant";
  if (hasParticipate) return "participant";
  if (hasCompute) return "computed";
  if (hasObserve) return "observer";
  return "inert";
}

function readInitialState(device) {
  if (!Object.hasOwn(device, "state") && device.state === undefined) return {};
  return cloneConfigJson(device.state);
}

function inspectDevice(device, profileName, circuit) {
  if (!device || typeof device !== "object" || Array.isArray(device)) {
    throw new ConfigError("invalid-device", "Устройство должно быть объектом");
  }
  if (!(device instanceof Constant)) {
    for (const key of UNSUPPORTED) {
      if (Object.hasOwn(device, key)) {
        throw new ConfigError("unsupported-setting", `Настройка ${key} в этом контуре не поддерживается`);
      }
    }
  }
  const ports = {};
  for (const [field, color] of PORTS) ports[field] = readPort(device, field, color, circuit);
  const kind = classifyDevice(device);
  if (device instanceof Arithmetic) device.validateProfile(profileName);
  if (device instanceof Decider) device.validateProfile(profileName);
  if (device instanceof Selector) {
    device.validateProfile(profileName);
    device.validateWorld(circuit.world);
  }
  if (device instanceof Lamp) device.validateProfile(profileName);
  if (device instanceof Station) device.validateProfile(profileName);
  if (kind === "station") {
    return { ports, entries: [], kind, state: null, depart: device.depart };
  }
  if (kind === "train") {
    return {
      ports,
      entries: [],
      kind,
      state: null,
      routeDevices: device.route,
      transit: device.transit,
      at: device.at,
    };
  }
  if (kind !== "constant") {
    return {
      ports,
      entries: [],
      kind,
      state: kind === "participant" ? readInitialState(device) : null,
    };
  }
  if (ports.red_input || ports.green_input) {
    throw new ConfigError("forbidden-input", "Источник signals не имеет входов");
  }
  if (device instanceof Constant || device instanceof Storage) {
    return { ports, entries: device.contribution(profileName), kind, state: null };
  }
  if (typeof device.enabled !== "boolean") {
    throw new ConfigError("invalid-enabled", "enabled должен быть boolean");
  }
  if (!Array.isArray(device.signals)) {
    throw new ConfigError("invalid-signals", "signals должен быть массивом");
  }
  const entries = device.signals.map((entry) => readSignalCount(entry, profileName));
  return { ports, entries: device.enabled ? entries : [], kind, state: null };
}

class Network {
  #circuit;
  #id;
  #color;
  #name;

  constructor(circuit, id, color, name) {
    this.#circuit = circuit;
    this.#id = id;
    this.#color = color;
    this.#name = name;
    Object.freeze(this);
  }

  get id() {
    return this.#id;
  }

  get color() {
    return this.#color;
  }

  get name() {
    return this.#name;
  }

  get circuit() {
    return this.#circuit;
  }

  rename(name) {
    this.#name = name;
  }

  attach(circuit) {
    this.#circuit = circuit;
  }

  detach() {
    this.#circuit = null;
  }
}

export class Circuit {
  #profile;
  #seed;
  #world;
  #byName = new Map();
  #byDevice = new Map();
  #order = [];
  #peers = new Map();
  #born = new WeakSet();
  #nextNetwork = 0;
  #nextDevice = 0;
  #networkIds = new Set();
  #deviceIds = new Set();
  #retiredDevices = new Set();

  constructor(options = {}) {
    const selected = readOptions(options);
    this.#profile = openProfile(selected.profileName);
    this.#seed = selected.seed;
    this.#world = selected.world;
  }

  get seed() {
    return this.#seed;
  }

  get world() {
    return this.#world;
  }

  get profile() {
    return this.#profile.name;
  }

  get gameVersion() {
    return this.#profile.gameVersion;
  }

  get devices() {
    return this.#order.slice();
  }

  get networks() {
    return [...this.#byName.values()];
  }

  network(name) {
    return this.defineNetwork(name);
  }

  defineNetwork(name, id) {
    const parsed = parseName(name);
    const existing = this.#byName.get(name);
    if (existing) {
      if (id !== undefined && existing.id !== id) {
        throw new ConfigError("duplicate-id", `Сеть ${name} уже имеет ID ${existing.id}`);
      }
      return existing;
    }
    const assigned = this.#claimId("n", id);
    const network = new Network(this, assigned, parsed.color, name);
    this.#born.add(network);
    this.#byName.set(name, network);
    return network;
  }

  detachNetwork(network) {
    this.#assertOwn(network);
    this.#byName.delete(network.name);
    network.detach();
    return network;
  }

  restoreNetwork(network, name) {
    if (!(network instanceof Network) || !this.#born.has(network)) {
      throw new ConfigError("foreign-network", "Сеть принадлежит другой схеме");
    }
    const nextName = name === undefined ? network.name : name;
    const parsed = parseName(nextName);
    if (parsed.color !== network.color) {
      throw new ConfigError("wrong-color", "Переименование не меняет цвет сети");
    }
    if (network.circuit !== null && network.circuit !== this) {
      throw new ConfigError("foreign-network", "Сеть принадлежит другой схеме");
    }
    if (network.circuit === this) return this.renameNetwork(network, nextName);
    if (this.#byName.has(nextName)) {
      throw new ConfigError("occupied-name", `Имя ${nextName} занято`);
    }
    network.rename(nextName);
    network.attach(this);
    this.#byName.set(nextName, network);
    return network;
  }

  deviceId(device) {
    const record = this.#byDevice.get(device);
    if (!record) throw new ConfigError("not-registered", "Устройство не зарегистрировано");
    return record.id;
  }

  add(device, id) {
    inspectDevice(device, this.#profile.name, this);
    const owner = owners.get(device);
    if (owner && owner !== this) {
      throw new ConfigError("foreign-device", "Устройство уже принадлежит другой схеме");
    }
    if (this.#byDevice.has(device)) return device;
    const assigned = this.#claimId("d", id);
    this.#byDevice.set(device, { id: assigned });
    this.#order.push(device);
    owners.set(device, this);
    return device;
  }

  reserveDeviceId() {
    return this.#claimId("d");
  }

  releaseDeviceId(id) {
    if (typeof id !== "string" || !this.#deviceIds.has(id)) return;
    if (this.#deviceIdLive(id)) throw new ConfigError("duplicate-id", `ID ${id} уже занят`);
    this.#retiredDevices.add(id);
  }

  replaceDevice(previous, next) {
    if (previous === next) return next;
    inspectDevice(next, this.#profile.name, this);
    const record = this.#byDevice.get(previous);
    if (!record) throw new ConfigError("not-registered", "Устройство не зарегистрировано");
    const owner = owners.get(next);
    if (owner && owner !== this) {
      throw new ConfigError("foreign-device", "Устройство уже принадлежит другой схеме");
    }
    if (this.#byDevice.has(next)) throw new ConfigError("duplicate-id", "Устройство уже зарегистрировано");
    this.#byDevice.delete(previous);
    owners.delete(previous);
    this.#dropPeers(previous);
    const index = this.#order.indexOf(previous);
    this.#order[index] = next;
    this.#byDevice.set(next, record);
    owners.set(next, this);
    return next;
  }

  orderDevices(devices) {
    if (!Array.isArray(devices) || devices.length !== this.#order.length) {
      throw new ConfigError("invalid-order", "Порядок устройств не совпадает с описанием");
    }
    const seen = new Set();
    for (const device of devices) {
      if (!this.#byDevice.has(device) || seen.has(device)) {
        throw new ConfigError("invalid-order", "Порядок устройств не совпадает с описанием");
      }
      seen.add(device);
    }
    this.#order = devices.slice();
  }

  remove(device) {
    const record = this.#byDevice.get(device);
    if (!record) {
      throw new ConfigError("not-registered", "Устройство не зарегистрировано");
    }
    this.#retiredDevices.add(record.id);
    this.#byDevice.delete(device);
    this.#order = this.#order.filter((item) => item !== device);
    owners.delete(device);
    this.#dropPeers(device);
  }

  renameNetwork(network, name) {
    this.#assertOwn(network);
    const parsed = parseName(name);
    if (parsed.color !== network.color) {
      throw new ConfigError("wrong-color", "Переименование не меняет цвет сети");
    }
    const existing = this.#byName.get(name);
    if (existing && existing !== network) {
      throw new ConfigError("occupied-name", `Имя ${name} занято`);
    }
    if (existing === network) return network;
    this.#byName.delete(network.name);
    this.#byName.set(name, network);
    network.rename(name);
    return network;
  }

  setPeers(event, peers) {
    if (!this.#byDevice.has(event)) {
      throw new ConfigError("not-registered", "Устройство не зарегистрировано");
    }
    if (!peers || typeof peers !== "object" || Array.isArray(peers)) {
      throw new ConfigError("invalid-peers", "Связи сценария задаются объектом {receiver}");
    }
    const keys = Object.keys(peers);
    if (keys.length !== 1 || !Object.hasOwn(peers, "receiver")) {
      throw new ConfigError("invalid-peers", "Связи сценария содержат только receiver");
    }
    if (!this.#byDevice.has(peers.receiver)) {
      throw new ConfigError("not-registered", "Получатель не зарегистрирован");
    }
    this.#peers.set(event, peers.receiver);
    return event;
  }

  receiverOf(event) {
    if (!this.#byDevice.has(event)) {
      throw new ConfigError("not-registered", "Устройство не зарегистрировано");
    }
    return this.#peers.get(event) ?? null;
  }

  async createSimulation(options) {
    const explicit = assertSimulationOptions(options);
    const captured = this.#capture();
    const executor = explicit ?? (captured.records.some((record) => record.event)
      ? createScenarioExecutor(captured.records, captured.profile)
      : null);
    const runtimeOptions = {};
    if (executor) runtimeOptions.executor = executor;
    if (options && Object.hasOwn(options, "historyLimit")) runtimeOptions.historyLimit = options.historyLimit;
    if (options && Object.hasOwn(options, "scheduler")) runtimeOptions.scheduler = options.scheduler;
    const simulation = await createRuntime(
      captured,
      Object.keys(runtimeOptions).length > 0 ? runtimeOptions : undefined,
    );
    for (const network of captured.unused) {
      this.#byName.delete(network.name);
      network.detach();
    }
    return simulation;
  }

  #claimId(prefix, id) {
    const issued = prefix === "n" ? this.#networkIds : this.#deviceIds;
    if (id === undefined) {
      const number = (prefix === "n" ? this.#nextNetwork : this.#nextDevice) + 1;
      const assigned = `${prefix}${number}`;
      if (prefix === "n") this.#nextNetwork = number;
      else this.#nextDevice = number;
      issued.add(assigned);
      return assigned;
    }
    if (typeof id !== "string" || !new RegExp(`^${prefix}[1-9][0-9]*$`).test(id)) {
      throw new ConfigError("invalid-id", `ID должен иметь вид ${prefix}N`);
    }
    const number = Number(id.slice(prefix.length));
    if (!Number.isSafeInteger(number) || `${prefix}${number}` !== id) {
      throw new ConfigError("invalid-id", `ID ${id} слишком велик`);
    }
    if (prefix === "d" && this.#retiredDevices.has(id)) {
      throw new ConfigError("duplicate-id", `ID ${id} уже занят`);
    }
    if (issued.has(id)) {
      if (prefix === "d" && !this.#deviceIdLive(id)) return id;
      throw new ConfigError("duplicate-id", `ID ${id} уже занят`);
    }
    if (prefix === "n") this.#nextNetwork = Math.max(this.#nextNetwork, number);
    else this.#nextDevice = Math.max(this.#nextDevice, number);
    issued.add(id);
    return id;
  }

  #deviceIdLive(id) {
    for (const record of this.#byDevice.values()) {
      if (record.id === id) return true;
    }
    return false;
  }

  #receiverId(device) {
    const receiver = this.#peers.get(device);
    if (!receiver) return null;
    return this.#byDevice.get(receiver).id;
  }

  #assertOwn(network) {
    if (!(network instanceof Network)) {
      throw new ConfigError("invalid-port", "Требуется сеть этой схемы");
    }
    if (network.circuit === null) {
      throw new ConfigError("missing-network", "Сеть уже исключена из схемы");
    }
    if (network.circuit !== this) {
      throw new ConfigError("foreign-network", "Сеть принадлежит другой схеме");
    }
  }

  #dropPeers(device) {
    this.#peers.delete(device);
    for (const [event, receiver] of this.#peers) {
      if (receiver === device) this.#peers.delete(event);
    }
  }

  #capture() {
    const seen = new Set();
    const records = [];
    let presence = null;
    const presenceSignal = () => {
      if (!presence) {
        presence = this.#profile.importSignal({ type: "virtual", name: "signal-T", quality: "normal" });
      }
      return presence;
    };
    for (const device of this.#order) {
      const inspected = inspectDevice(device, this.#profile.name, this);
      for (const port of Object.values(inspected.ports)) {
        if (port) seen.add(port);
      }
      let route = null;
      let state = inspected.state;
      if (inspected.kind === "train") {
        route = inspected.routeDevices.map((station) => {
          const known = this.#byDevice.get(station);
          if (!known) throw new ConfigError("missing-station", "Станция маршрута не входит в эту схему");
          return known.id;
        });
        state = initialTrainState(route, inspected.at, inspected.transit);
      }
      const event = device instanceof EventCombinator;
      records.push({
        device,
        id: this.#byDevice.get(device).id,
        kind: inspected.kind,
        ports: inspected.ports,
        entries: inspected.entries.map((entry) => ({ signal: entry.signal, constant: entry.constant })),
        state,
        route,
        transit: inspected.kind === "train" ? inspected.transit : null,
        depart: inspected.kind === "station" ? inspected.depart : null,
        presence: inspected.kind === "station" ? presenceSignal() : null,
        compute: inspected.kind === "computed" ? device.compute : null,
        observe: inspected.kind === "observer" ? device.observe : null,
        event,
        awake: device instanceof Selector && (device.usesRandom() || device.usesClock()),
        random: device instanceof Selector && device.usesRandom(),
        run: event ? device.runMode : null,
        receiverId: this.#receiverId(device),
      });
    }
    const occupied = new Map();
    for (const record of records) {
      if (record.kind !== "train") continue;
      const stationId = record.state.stationId;
      if (occupied.has(stationId)) {
        const names = [occupied.get(stationId), record.id].sort(compareText);
        throw new ConfigError("station-occupied", `Станция ${stationId} уже занята поездами ${names.join(", ")}`);
      }
      occupied.set(stationId, record.id);
    }
    const unused = [];
    for (const network of this.#byName.values()) {
      if (!seen.has(network)) unused.push(network);
    }
    return {
      seed: this.#seed,
      world: this.#world,
      profile: this.#profile.name,
      gameVersion: this.#profile.gameVersion,
      records,
      networks: [...seen],
      unused,
      isNetwork: (value) => value instanceof Network,
    };
  }
}
