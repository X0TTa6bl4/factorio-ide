/** Версия 1 определения схемы: ID вместо циклических ссылок, без снимка runtime. */

import { Arithmetic } from "./arithmetic.js";
import { Circuit } from "./circuit.js";
import { Constant } from "./constant.js";
import { Decider } from "./decider.js";
import { Lamp } from "./lamp.js";
import { Station, Train } from "./train.js";
import { Storage } from "./storage.js";
import { ConfigError } from "./errors.js";
import { EventCombinator } from "./event.js";
import { isInt32 } from "./int32.js";
import { Selector } from "./selector.js";
import { openProfile, Quality } from "./signal-profile.js";
import {
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "./signal-token.js";

export const PROJECT_FORMAT = "f-logic-project";
export const PROJECT_VERSION = 1;

const ROOT_KEYS = ["devices", "format", "gameVersion", "groups", "name", "networks", "profile", "scenarioState", "seed", "version", "world"];
const NETWORK_KEYS = ["color", "id", "name"];
const GROUP_KEYS = ["filters", "id", "name"];
const FILTER_KEYS = ["max", "min", "signal"];
const DEVICE_KEYS = ["config", "id", "kind", "name", "ports", "receiver", "source"];
const PORTS = ["green_input", "green_output", "red_input", "red_output"];
const PORT_COLOR = {
  red_input: "red",
  red_output: "red",
  green_input: "green",
  green_output: "green",
};
const SIGNAL_KEYS = ["kind", "name", "quality", "type"];
const NAMED_TOKEN_KEYS = ["kind", "name"];
const OPERATION_KEYS = ["kind", "name", "owner"];
const GROUP_REF_KEYS = ["id", "kind"];
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const NETWORK_NAME = /^(red|green)_([A-Za-z0-9_]+)$/;
const DEVICE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CLASSES = {
  arithmetic: Arithmetic,
  constant: Constant,
  decider: Decider,
  event: EventCombinator,
  lamp: Lamp,
  selector: Selector,
  station: Station,
  storage: Storage,
  train: Train,
};
const OPERATION_TABLES = [
  ["arithmetic", () => Arithmetic.Operation],
  ["decider", () => Decider.Operation],
  ["decider", () => Decider.Logic],
  ["selector", () => Selector.Operation],
  ["selector", () => Selector.Sort],
  ["selector", () => Selector.Compare],
  ["lamp", () => Lamp.Operation],
];
const QUALITY_BY_NAME = new Map(Object.values(Quality).map((token) => [token.name, token]));
const specials = new WeakMap();

const SOURCE_MARK = "globalThis.__fLogicImportRan";

function fail(code, message) {
  throw new ConfigError(code, message);
}

function plain(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-project", `${path} должен быть объектом`);
  }
}

function exactKeys(value, keys, path) {
  plain(value, path);
  const present = Object.keys(value);
  if (present.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid-project", `${path} содержит неверный набор полей`);
  }
  for (const key of present) rejectKey(key, path);
}

function rejectKey(key, path) {
  if (RESERVED_KEYS.has(key)) fail("invalid-project", `${path}.${key} не допускается`);
}

function readId(value, prefix, path) {
  if (typeof value !== "string" || !new RegExp(`^${prefix}[1-9][0-9]*$`).test(value)) {
    fail("invalid-id", `${path}: ID должен иметь вид ${prefix}N`);
  }
  const number = Number(value.slice(prefix.length));
  if (!Number.isSafeInteger(number) || `${prefix}${number}` !== value) {
    fail("invalid-id", `${path}: ID ${value} слишком велик`);
  }
  return value;
}

function claim(seen, id, path) {
  if (seen.has(id)) fail("duplicate-id", `ID ${id} повторяется`);
  seen.add(id);
}

function clonePlain(value, path, stack = new WeakSet()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid-project", `${path}: число должно быть конечным`);
    return value;
  }
  if (typeof value !== "object") fail("invalid-project", `${path}: неподдерживаемое значение`);
  if (stack.has(value)) fail("invalid-project", `${path}: цикл в документе не допускается`);
  stack.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => clonePlain(item, `${path}.${index}`, stack));
    const copy = {};
    for (const key of Object.keys(value)) {
      rejectKey(key, path);
      copy[key] = clonePlain(value[key], `${path}.${key}`, stack);
    }
    return copy;
  } finally {
    stack.delete(value);
  }
}

function parseJson(text) {
  if (typeof text !== "string") fail("invalid-json", "Документ не является JSON");
  try {
    return JSON.parse(text);
  } catch {
    fail("invalid-json", "Документ не является JSON");
  }
}

function specialIndex(profile) {
  const cached = specials.get(profile);
  if (cached) return cached;
  const meta = new Map();
  const selectors = new Map();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (isMetaToken(node)) {
      meta.set(node.name, node);
      return;
    }
    if (isQualitySelectorToken(node)) {
      selectors.set(node.name, node);
      return;
    }
    if (isSignalToken(node) || isQualityToken(node) || isOperationToken(node)) return;
    for (const key of Object.keys(node)) walk(node[key]);
  };
  walk(profile.tree);
  const index = { meta, selectors };
  specials.set(profile, index);
  return index;
}

function readSignal(value, profile, path) {
  exactKeys(value, SIGNAL_KEYS, path);
  if (value.kind !== "signal") fail("invalid-project", `${path}: ожидается токен сигнала`);
  try {
    return profile.importSignal({ type: value.type, name: value.name, quality: value.quality });
  } catch (error) {
    if (error instanceof ConfigError) fail(error.code, `${error.message} (${path})`);
    throw error;
  }
}

function readQuality(value, profile, path) {
  exactKeys(value, NAMED_TOKEN_KEYS, path);
  const token = QUALITY_BY_NAME.get(value.name);
  if (!token) fail("unknown-quality", `${path}: качество ${value.name} неизвестно`);
  try {
    profile.importSignal({ type: "virtual", name: "signal-A", quality: value.name });
  } catch (error) {
    if (error instanceof ConfigError && error.code === "unavailable-quality") {
      fail("unavailable-quality", `${error.message} (${path})`);
    }
    if (error instanceof ConfigError && error.code !== "unknown-signal") throw error;
  }
  return token;
}

function readOperation(value, path) {
  exactKeys(value, OPERATION_KEYS, path);
  for (const [owner, table] of OPERATION_TABLES) {
    if (owner !== value.owner) continue;
    for (const token of Object.values(table())) {
      if (token.name === value.name) return token;
    }
  }
  fail("unknown-operation", `${path}: операция ${value.owner}.${value.name} неизвестна`);
}

function readToken(value, profile, groups, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "kind")) {
    fail("invalid-project", `${path}: ожидается токен`);
  }
  if (value.kind === "signal") return readSignal(value, profile, path);
  if (value.kind === "meta") {
    exactKeys(value, NAMED_TOKEN_KEYS, path);
    const token = specialIndex(profile).meta.get(value.name);
    if (!token) fail("unknown-meta", `${path}: метасигнал ${value.name} неизвестен`);
    return token;
  }
  if (value.kind === "quality") return readQuality(value, profile, path);
  if (value.kind === "quality-selector") {
    exactKeys(value, NAMED_TOKEN_KEYS, path);
    const token = specialIndex(profile).selectors.get(value.name);
    if (!token) fail("unknown-quality-selector", `${path}: селектор качества ${value.name} неизвестен`);
    return token;
  }
  if (value.kind === "operation") return readOperation(value, path);
  if (value.kind === "group") {
    exactKeys(value, GROUP_REF_KEYS, path);
    const group = groups.get(value.id);
    if (!group) fail("missing-group", `Группа ${value.id} не найдена в ссылке ${path}`);
    return group;
  }
  fail("invalid-project", `${path}: неизвестный токен ${value.kind}`);
}

function readDeviceRef(value, path) {
  exactKeys(value, ["id", "kind"], path);
  return { __deviceId: readId(value.id, "d", path) };
}

function decodeValue(value, profile, groups, path) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((item, index) => decodeValue(item, profile, groups, `${path}.${index}`));
  plain(value, path);
  if (Object.hasOwn(value, "kind") && value.kind === "device") return readDeviceRef(value, path);
  if (Object.hasOwn(value, "kind")) return readToken(value, profile, groups, path);
  const copy = {};
  for (const key of Object.keys(value)) {
    if (PORTS.includes(key)) fail("invalid-project", `${path}.${key}: порт задаётся в ports`);
    copy[key] = decodeValue(value[key], profile, groups, `${path}.${key}`);
  }
  return copy;
}

function readName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 120 || /[\u0000-\u001f]/.test(value)) {
    fail("invalid-name", "Имя схемы — строка от 1 до 120 символов без управляющих знаков");
  }
  return value;
}

function readWorld(value) {
  if (value === null) return null;
  exactKeys(value, ["dayLength", "origin"], "world");
  if (!isInt32(value.origin) || value.origin < 0) fail("invalid-world", "origin должен быть целым int32 от 0");
  if (!isInt32(value.dayLength) || value.dayLength < 1) fail("invalid-world", "dayLength должен быть целым int32 от 1");
  return { origin: value.origin, dayLength: value.dayLength };
}

function readNetwork(value, index, ids, names) {
  const path = `networks.${index}`;
  exactKeys(value, NETWORK_KEYS, path);
  const id = readId(value.id, "n", path);
  claim(ids, id, path);
  if (typeof value.name !== "string" || value.name === "red_new" || value.name === "green_new" || !NETWORK_NAME.test(value.name)) {
    fail("invalid-name", `${path}: имя сети должно иметь вид red_* или green_*`);
  }
  if (names.has(value.name)) fail("occupied-name", `Имя ${value.name} занято`);
  names.add(value.name);
  const color = NETWORK_NAME.exec(value.name)[1];
  if (value.color !== color) fail("wrong-color", `${path}: цвет не соответствует имени`);
  return { id, name: value.name, color };
}

function readFilter(value, path) {
  exactKeys(value, FILTER_KEYS, path);
  if (!isInt32(value.min) || (value.max !== null && !isInt32(value.max))) {
    fail("invalid-constant", `${path}: min и max должны быть целым int32, max может быть null`);
  }
  exactKeys(value.signal, SIGNAL_KEYS, `${path}.signal`);
  if (value.signal.kind !== "signal") fail("invalid-signal", `${path}.signal: фильтр хранит обычный сигнал`);
  return {
    signal: {
      kind: "signal",
      type: value.signal.type,
      name: value.signal.name,
      quality: value.signal.quality,
    },
    min: value.min,
    max: value.max,
  };
}

function readGroup(value, index, ids) {
  const path = `groups.${index}`;
  exactKeys(value, GROUP_KEYS, path);
  const id = readId(value.id, "g", path);
  claim(ids, id, path);
  if (typeof value.name !== "string" || value.name.length === 0) {
    fail("invalid-group-name", `${path}: имя группы должно быть непустой строкой`);
  }
  if (!Array.isArray(value.filters)) fail("invalid-filters", `${path}.filters должен быть массивом`);
  return {
    id,
    name: value.name,
    filters: value.filters.map((filter, filterIndex) => readFilter(filter, `${path}.filters.${filterIndex}`)),
  };
}

function readPorts(value, path, networks) {
  exactKeys(value, PORTS, path);
  const ports = {};
  for (const key of PORTS) {
    const ref = value[key];
    if (ref === null) {
      ports[key] = null;
      continue;
    }
    if (typeof ref !== "string") fail("invalid-port", `${path}.${key}: ссылка на сеть задаётся ID`);
    const network = networks.get(ref);
    if (!network) fail("missing-network", `Сеть ${ref} не найдена в ссылке ${path}.${key}`);
    if (network.color !== PORT_COLOR[key]) fail("wrong-color", `${path}.${key}: цвет сети не соответствует порту`);
    ports[key] = ref;
  }
  return ports;
}

function readDevice(value, index, ids, names, networks) {
  const path = `devices.${index}`;
  exactKeys(value, DEVICE_KEYS, path);
  const id = readId(value.id, "d", path);
  claim(ids, id, path);
  if (typeof value.name !== "string" || !DEVICE_NAME.test(value.name)) {
    fail("invalid-name", `${path}: имя устройства должно быть идентификатором`);
  }
  if (names.has(value.name)) fail("occupied-name", `Имя ${value.name} занято`);
  names.add(value.name);
  if (!Object.hasOwn(CLASSES, value.kind)) fail("invalid-device", `${path}: неизвестный вид ${value.kind}`);
  const ports = readPorts(value.ports, `devices.${value.name}.ports`, networks);
  if (!value.config || typeof value.config !== "object" || Array.isArray(value.config)) {
    fail("invalid-project", `devices.${value.name}.config должен быть объектом`);
  }
  for (const key of Object.keys(value.config)) {
    if (PORTS.includes(key)) fail("invalid-project", `devices.${value.name}.config.${key}: порт задаётся в ports`);
  }
  if (value.kind === "event") {
    if (value.source !== null && typeof value.source !== "string") {
      fail("invalid-source", `devices.${value.name}.source должен быть строкой или null`);
    }
  } else if (value.source !== null) {
    fail("invalid-source", `Исходник допустим только у события (${value.name})`);
  }
  if (value.receiver !== null && typeof value.receiver !== "string") {
    fail("invalid-peers", `devices.${value.name}.receiver задаётся ID события или null`);
  }
  return {
    id,
    name: value.name,
    kind: value.kind,
    ports,
    config: clonePlain(value.config, `devices.${value.name}.config`),
    source: value.source,
    receiver: value.receiver,
  };
}

function visitRefs(value, path, visit) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitRefs(item, `${path}.${index}`, visit));
    return;
  }
  if (value.kind === "device") {
    visit(value, path);
    return;
  }
  if (Object.hasOwn(value, "kind")) return;
  for (const key of Object.keys(value)) visitRefs(value[key], `${path}.${key}`, visit);
}

function linkTrainStops(devices) {
  const byId = new Map(devices.map((device) => [device.id, device]));
  for (const device of devices) {
    visitRefs(device.config, `devices.${device.name}.config`, (ref, path) => {
      if (device.kind !== "train") {
        fail("invalid-project", `${path}: ссылка на устройство допустима в маршруте поезда`);
      }
      const target = byId.get(ref.id);
      if (!target) fail("missing-station", `Станция ${ref.id} не найдена (${path})`);
      if (target.kind !== "station") fail("unknown-station", `Устройство ${ref.id} не станция (${path})`);
    });
  }
}

function resolveStations(value, stations, path) {
  if (Array.isArray(value)) return value.map((item, index) => resolveStations(item, stations, `${path}.${index}`));
  if (!value || typeof value !== "object") return value;
  if (Object.hasOwn(value, "__deviceId")) return stations.get(value.__deviceId);
  if (isSignalToken(value) || isMetaToken(value) || isOperationToken(value) || isQualityToken(value) || isQualitySelectorToken(value)) {
    return value;
  }
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = resolveStations(value[key], stations, `${path}.${key}`);
  return copy;
}

function linkReceivers(devices) {
  const byId = new Map(devices.map((device) => [device.id, device]));
  for (const device of devices) {
    if (device.receiver === null) continue;
    if (device.kind !== "event") fail("invalid-peers", `Получатель допустим только у события (${device.name})`);
    const target = byId.get(device.receiver);
    if (!target) fail("missing-device", `Устройство ${device.receiver} не найдено в ссылке devices.${device.name}.receiver`);
    if (target.kind !== "event") fail("invalid-peers", `devices.${device.name}.receiver указывает не на событие`);
  }
}

function checkTokens(value, profile, groups, path) {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkTokens(item, profile, groups, `${path}.${index}`));
    return;
  }
  if (Object.hasOwn(value, "kind")) {
    if (value.kind === "device") {
      exactKeys(value, ["id", "kind"], path);
      readId(value.id, "d", path);
      return;
    }
    if (value.kind === "group") {
      exactKeys(value, GROUP_REF_KEYS, path);
      if (!groups.has(value.id)) fail("missing-group", `Группа ${value.id} не найдена в ссылке ${path}`);
      return;
    }
    readToken(value, profile, new Map(), path);
    return;
  }
  for (const key of Object.keys(value)) checkTokens(value[key], profile, groups, `${path}.${key}`);
}

function canonicalDocument(raw) {
  plain(raw, "document");
  if (!Object.hasOwn(raw, "format") || raw.format !== PROJECT_FORMAT) {
    fail("foreign-format", "Файл не является схемой f logic");
  }
  if (Object.hasOwn(raw, "version") && raw.version !== PROJECT_VERSION) {
    fail("unsupported-version", `Версия формата ${String(raw.version)} не поддерживается`);
  }
  exactKeys(raw, ROOT_KEYS, "document");
  if (raw.scenarioState !== null) {
    fail("unsupported-scenario-state", "Состояние сценария версии 1 должно быть null и не применяется");
  }
  if (raw.profile !== "base" && raw.profile !== "space-age") {
    fail("unsupported-profile", `Профиль ${String(raw.profile)} не поддерживается`);
  }
  const profile = openProfile(raw.profile);
  if (typeof raw.gameVersion !== "string" || raw.gameVersion !== profile.gameVersion) {
    fail("unsupported-game", `Версия игры ${String(raw.gameVersion)} не совпадает с профилем ${raw.profile} (${profile.gameVersion})`);
  }
  if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > 4294967295) {
    fail("invalid-seed", "seed должен быть целым uint32");
  }
  const world = readWorld(raw.world);
  if (!Array.isArray(raw.networks) || !Array.isArray(raw.groups) || !Array.isArray(raw.devices)) {
    fail("invalid-project", "networks, groups и devices должны быть массивами");
  }
  const networkIds = new Set();
  const networkNames = new Set();
  const networks = raw.networks.map((network, index) => readNetwork(network, index, networkIds, networkNames));
  const networkById = new Map(networks.map((network) => [network.id, network]));
  const groupIds = new Set();
  const groups = raw.groups.map((group, index) => readGroup(group, index, groupIds));
  const groupIdSet = new Set(groups.map((group) => group.id));
  const deviceIds = new Set();
  const deviceNames = new Set();
  const devices = raw.devices.map((device, index) => readDevice(device, index, deviceIds, deviceNames, networkById));
  linkReceivers(devices);
  for (const group of groups) {
    group.filters.forEach((filter, index) => {
      readSignal(filter.signal, profile, `groups.${group.id}.filters.${index}.signal`);
    });
  }
  for (const device of devices) checkTokens(device.config, profile, groupIdSet, `devices.${device.name}.config`);
  linkTrainStops(devices);
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: readName(raw.name),
    profile: raw.profile,
    gameVersion: profile.gameVersion,
    seed: raw.seed,
    world,
    networks,
    groups,
    devices,
    scenarioState: null,
  };
}

function buildCircuit(document) {
  const profile = openProfile(document.profile);
  const circuit = new Circuit({
    profile: document.profile,
    seed: document.seed,
    world: document.world,
  });
  const groups = new Map();
  for (const spec of document.groups) {
    groups.set(spec.id, new Constant.Group({
      name: spec.name,
      filters: spec.filters.map((filter) => ({
        signal: readSignal(filter.signal, profile, `groups.${spec.id}`),
        min: filter.min,
        max: filter.max,
      })),
    }));
  }
  const networks = new Map();
  for (const spec of document.networks) {
    networks.set(spec.id, circuit.defineNetwork(spec.name, spec.id));
  }
  const devices = new Map();
  const instantiate = (spec, stations) => {
    const config = decodeValue(spec.config, profile, groups, `devices.${spec.name}.config`);
    for (const key of PORTS) {
      const ref = spec.ports[key];
      if (spec.kind === "train") {
        if (ref !== null) fail("forbidden-port", `Поезд не подключается к сетям (${spec.name})`);
        continue;
      }
      if (spec.kind === "constant" && (key === "red_input" || key === "green_input")) {
        if (ref !== null) fail("forbidden-input", `Источник Constant не имеет входов (${spec.name})`);
        continue;
      }
      if (spec.kind === "storage" && (key === "red_input" || key === "green_input")) {
        if (ref !== null) fail("forbidden-input", `Хранилище не имеет входов (${spec.name})`);
        continue;
      }
      if (spec.kind === "lamp" && (key === "red_output" || key === "green_output")) {
        if (ref !== null) fail("forbidden-output", `Лампа не пишет в сети (${spec.name})`);
        continue;
      }
      config[key] = ref === null ? null : networks.get(ref);
    }
    const ready = spec.kind === "train"
      ? resolveStations(config, stations, `devices.${spec.name}.config`)
      : config;
    try {
      return new CLASSES[spec.kind](ready);
    } catch (error) {
      if (error instanceof ConfigError) fail(error.code, `${error.message} (${spec.name})`);
      throw error;
    }
  };
  const instances = document.devices.map((spec) => ({
    spec,
    device: spec.kind === "train" ? null : instantiate(spec, null),
  }));
  const byId = new Map(instances.filter((item) => item.device).map((item) => [item.spec.id, item.device]));
  for (const item of instances) {
    if (item.device) continue;
    item.device = instantiate(item.spec, byId);
  }
  for (const item of instances) {
    circuit.add(item.device, item.spec.id);
    devices.set(item.spec.id, item.device);
  }
  for (const spec of document.devices) {
    if (spec.receiver === null) continue;
    circuit.setPeers(devices.get(spec.id), { receiver: devices.get(spec.receiver) });
  }
  return circuit;
}

export function readProject(input) {
  const raw = typeof input === "string" ? parseJson(input) : clonePlain(input, "document");
  const document = canonicalDocument(raw);
  return { document, circuit: buildCircuit(document) };
}

export function createProjectSession(input) {
  let current = readProject(input);
  return {
    get document() {
      return current.document;
    },
    get circuit() {
      return current.circuit;
    },
    replace(next) {
      const loaded = readProject(next);
      current = loaded;
      return loaded;
    },
  };
}

export function draftProject(document, change) {
  const next = clonePlain(document, "document");
  change(next);
  return next;
}

export function exampleProject() {
  const profile = openProfile("space-age");
  const chest = { kind: "signal", type: "item", name: "wooden-chest", quality: "uncommon" };
  const each = { kind: "signal", type: "virtual", name: "signal-A", quality: "normal" };
  const group = { kind: "group", id: "g1" };
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: "Петля",
    profile: "space-age",
    gameVersion: profile.gameVersion,
    seed: 9,
    world: { origin: 4, dayLength: 25000 },
    networks: [
      { id: "n1", name: "red_loop", color: "red" },
      { id: "n4", name: "green_out", color: "green" },
    ],
    groups: [
      {
        id: "g1",
        name: "plates",
        filters: [{ signal: each, min: 2, max: null }],
      },
    ],
    devices: [
      {
        id: "d1",
        name: "source",
        kind: "constant",
        ports: { red_input: null, green_input: null, red_output: "n1", green_output: null },
        config: {
          enabled: true,
          sections: [
            { active: true, multiplier: 1, group },
            { active: true, multiplier: 1, group },
          ],
        },
        source: null,
        receiver: null,
      },
      {
        id: "d2",
        name: "copy",
        kind: "constant",
        ports: { red_input: null, green_input: null, red_output: "n1", green_output: null },
        config: {
          enabled: true,
          sections: [{ active: true, multiplier: 1, group }],
        },
        source: null,
        receiver: null,
      },
      {
        id: "d3",
        name: "adder",
        kind: "arithmetic",
        ports: { red_input: "n1", green_input: null, red_output: "n1", green_output: "n4" },
        config: {
          left_operand: { red: true, green: false, signal: chest },
          right_operand: { constant: 1 },
          operation: { kind: "operation", owner: "arithmetic", name: "SUM" },
          return: chest,
        },
        source: null,
        receiver: null,
      },
      {
        id: "d4",
        name: "gate",
        kind: "decider",
        ports: { red_input: "n1", green_input: null, red_output: null, green_output: "n4" },
        config: {
          conditions: [{
            left_operand: { red: true, green: false, signal: chest },
            right_operand: { constant: 0 },
            operation: { kind: "operation", owner: "decider", name: "GT" },
          }],
          when_true: [{ signal: chest, constant: 1 }],
        },
        source: null,
        receiver: null,
      },
      {
        id: "d6",
        name: "grade",
        kind: "selector",
        ports: { red_input: "n1", green_input: null, red_output: null, green_output: "n4" },
        config: {
          operation: { kind: "operation", owner: "selector", name: "quality-filter" },
          quality: { kind: "quality", name: "uncommon" },
          compare: { kind: "operation", owner: "selector", name: "EQ" },
        },
        source: null,
        receiver: null,
      },
      {
        id: "d7",
        name: "clock",
        kind: "event",
        ports: { red_input: null, green_input: null, red_output: null, green_output: null },
        config: {
          run: { every_tick: true, input_changed: false },
          state: { started: false },
        },
        source: `${SOURCE_MARK} = (${SOURCE_MARK} ?? 0) + 1;\n`,
        receiver: "d8",
      },
      {
        id: "d8",
        name: "reply",
        kind: "event",
        ports: { red_input: null, green_input: null, red_output: null, green_output: null },
        config: {
          run: { every_tick: false, input_changed: true },
          state: {},
        },
        source: null,
        receiver: "d7",
      },
    ],
    scenarioState: null,
  };
}
