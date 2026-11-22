/** Общая проверка конфигурации для виджета, подсказок и запуска. Конструкторы остаются вторым проходом. */

import { Arithmetic } from "./arithmetic.js";
import { compareText } from "./compare.js";
import { Constant } from "./constant.js";
import { parseConfiguration } from "./config-grammar.js";
import { Decider } from "./decider.js";
import { Lamp } from "./lamp.js";
import { Station, Train } from "./train.js";
import { Storage } from "./storage.js";
import { ConfigError } from "./errors.js";
import { EventCombinator } from "./event.js";
import { isInt32 } from "./int32.js";
import { parseNetworkName } from "./network-document.js";
import { Selector } from "./selector.js";
import { openProfile, Quality } from "./signal-profile.js";
import {
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "./signal-token.js";

const KIND_CLASS = {
  arithmetic: "Arithmetic",
  decider: "Decider",
  constant: "Constant",
  selector: "Selector",
  event: "EventCombinator",
  lamp: "Lamp",
  storage: "Storage",
  station: "Station",
  train: "Train",
};

const PORTS = {
  red_input: "red",
  green_input: "green",
  red_output: "red",
  green_output: "green",
};

const OPERATION_TABLES = {
  Arithmetic: { Operation: () => Arithmetic.Operation },
  Decider: { Operation: () => Decider.Operation, Logic: () => Decider.Logic },
  Selector: {
    Operation: () => Selector.Operation,
    Sort: () => Selector.Sort,
    Compare: () => Selector.Compare,
  },
  Lamp: { Operation: () => Lamp.Operation },
};

const CLASSES = {
  Arithmetic,
  Decider,
  Constant,
  Selector,
  EventCombinator,
  Lamp,
  Station,
  Train,
  Storage,
};

export function listSignalPaths(profile) {
  const found = [];
  const seen = new Set();
  function walk(node) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (isSignalToken(node) || isMetaToken(node) || isQualitySelectorToken(node)) {
      found.push({
        path: node.metadata.publicPath,
        kind: node.kind,
        meta: isMetaToken(node) ? node.name : null,
      });
    }
    for (const key of Object.keys(node)) walk(node[key]);
  }
  walk(profile.tree);
  return found.filter((entry) => entry.path);
}

export function operationCatalog() {
  const items = [];
  for (const [owner, groups] of Object.entries(OPERATION_TABLES)) {
    for (const [group, read] of Object.entries(groups)) {
      for (const name of Object.keys(read())) {
        items.push({ owner, group, name, path: `${owner}.${group}.${name}` });
      }
    }
  }
  return items;
}

export function qualityCatalog(profile) {
  const sample = profile.tree.Logistic?.wooden_chest;
  const items = [];
  if (!sample) return items;
  for (const [name, token] of Object.entries(Quality)) {
    try {
      sample.withQuality(token);
      items.push({ name, path: `Quality.${name}` });
    } catch (error) {
      if (!(error instanceof ConfigError) || error.code !== "unavailable-quality") throw error;
    }
  }
  return items;
}

export function signalAllowed(entry, role, context = {}) {
  if (!entry || entry.kind === "quality-selector") return false;
  if (entry.kind === "meta") {
    if (role === "arithmetic-operand") return entry.meta === "each";
    if (role === "arithmetic-return") return entry.meta === "each" && context.eachOperands === 1;
    if (role === "decider-left" || role === "decider-output") return true;
    return false;
  }
  return role !== "meta-only";
}

let spanIndex = null;
let spanTextLength = 0;

function noteSpan(field, range) {
  if (!spanIndex || typeof field !== "string" || !range) return;
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end <= range.start) return;
  if (!spanIndex.has(field)) spanIndex.set(field, { start: range.start, end: range.end });
}

function nearestSpan(field) {
  if (!spanIndex || typeof field !== "string") return null;
  let cursor = field;
  while (cursor) {
    const found = spanIndex.get(cursor);
    if (found) return { start: found.start, end: found.end };
    const dot = cursor.lastIndexOf(".");
    if (dot < 0) return null;
    cursor = cursor.slice(0, dot);
  }
  return null;
}

function covers(range) {
  return Boolean(range) && Number.isInteger(range.start) && Number.isInteger(range.end) && range.end > range.start;
}

function point(range) {
  return Boolean(range) && Number.isInteger(range.start) && Number.isInteger(range.end) && range.end === range.start;
}

function placeRange(field, range) {
  if (covers(range)) return { start: range.start, end: range.end };
  if (point(range) && range.start > 0) return { start: range.start, end: range.end };
  const found = nearestSpan(field);
  if (found) return found;
  if (point(range)) return { start: range.start, end: range.end };
  if (spanIndex) return { start: spanTextLength, end: spanTextLength };
  return { start: 0, end: 0 };
}

function diagnostic(code, message, field, expected, range, extra = {}) {
  return {
    code,
    message,
    field,
    expected,
    received: extra.received ?? null,
    related: extra.related ?? [],
    range: placeRange(field, range),
  };
}

function fieldPath(base, name) {
  return base ? `${base}.${name}` : name;
}

export function diagnoseOperand(value, { field = "operand", device = "arithmetic", side = "left" } = {}) {
  const found = [];
  if (value === null) return found;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    found.push(diagnostic(
      "invalid-operand",
      `${field} должен быть Operand, OperandConst или null`,
      field,
      "Operand | OperandConst | null",
      null,
      { received: value === undefined ? "undefined" : typeof value },
    ));
    return found;
  }
  const keys = Object.keys(value);
  const hasConstant = Object.hasOwn(value, "constant");
  const hasSignal = Object.hasOwn(value, "signal") || Object.hasOwn(value, "red") || Object.hasOwn(value, "green");
  if (hasConstant && hasSignal) {
    found.push(diagnostic(
      "mixed-operand",
      `${field} не смешивает constant с полями сигнала`,
      field,
      "Operand | OperandConst",
      null,
      { related: [fieldPath(field, "constant"), fieldPath(field, "signal")] },
    ));
    return found;
  }
  if (hasConstant) {
    if (keys.length !== 1) {
      found.push(diagnostic(
        "invalid-operand",
        `${field} с constant не содержит других полей`,
        field,
        "OperandConst",
        null,
      ));
    }
    found.push(...diagnoseInt(value.constant, fieldPath(field, "constant"), null));
    if (device === "decider" && side === "left") {
      found.push(diagnostic(
        "invalid-operand",
        "Левый операнд сравнивающего — сигнал или null",
        field,
        "Operand | null",
        null,
      ));
    }
    return found;
  }
  for (const name of ["red", "green", "signal"]) {
    if (!Object.hasOwn(value, name)) {
      found.push(diagnostic(
        "invalid-operand",
        `${field} содержит red, green и signal`,
        fieldPath(field, name),
        name === "signal" ? "сигнал" : "boolean",
        null,
        { received: "отсутствует" },
      ));
    }
  }
  if (keys.some((key) => key !== "red" && key !== "green" && key !== "signal")) {
    found.push(diagnostic("invalid-operand", `${field} содержит только red, green и signal`, field, "Operand", null));
  }
  if (Object.hasOwn(value, "red") && typeof value.red !== "boolean") {
    found.push(diagnostic("invalid-mask", "red операнда должен быть boolean", fieldPath(field, "red"), "boolean", null, {
      received: typeof value.red,
    }));
  }
  if (Object.hasOwn(value, "green") && typeof value.green !== "boolean") {
    found.push(diagnostic("invalid-mask", "green операнда должен быть boolean", fieldPath(field, "green"), "boolean", null, {
      received: typeof value.green,
    }));
  }
  if (Object.hasOwn(value, "signal") && value.signal !== undefined) diagnoseSignalUse(value.signal, fieldPath(field, "signal"), device, side, found);
  return found;
}

function diagnoseInt(value, field, range) {
  if (value && typeof value === "object" && value.__mark === "fractional") {
    return [diagnostic("invalid-constant", "Количество должно быть целым int32", field, "int32", range ?? value.range, {
      received: "дробное число",
    })];
  }
  if (typeof value === "string") {
    return [diagnostic(
      "invalid-constant",
      "Количество должно быть целым int32; строка не преобразуется в число",
      field,
      "int32",
      range,
      { received: "string" },
    )];
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    return [diagnostic("invalid-constant", "Количество должно быть целым int32", field, "int32", range, {
      received: "дробное число",
    })];
  }
  if (!isInt32(value)) {
    return [diagnostic("invalid-constant", "Количество должно быть целым int32", field, "int32", range, {
      received: typeof value === "number" ? "вне int32" : typeof value,
    })];
  }
  return [];
}

function walkNumbers(value, field, diagnostics, seen = new Set()) {
  if (!value || typeof value !== "object" || isToken(value) || seen.has(value)) return;
  if (value.__mark) return;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (key === "range") continue;
    const next = fieldPath(field, key);
    if (key === "signal" && isMetaToken(item) && String(field).includes("signals")) {
      diagnostics.push(diagnostic(
        "invalid-signal",
        "Метасигнал не записывается как количество канала",
        next,
        "обычный сигнал",
        null,
      ));
    }
    if (["constant", "min", "max", "interval", "multiplier"].includes(key) && item !== null && item !== undefined) {
      diagnostics.push(...diagnoseInt(item, next, item?.range ?? null));
    } else {
      walkNumbers(item, next, diagnostics, seen);
    }
  }
}

function diagnoseSignalUse(signal, field, device, side, found) {
  if (isMetaToken(signal)) {
    if (device === "arithmetic" && signal.name !== "each") {
      found.push(diagnostic("unsupported-mode", `${field} не принимает Anything и Everything`, field, "обычный сигнал или Each", null));
    }
    if (device === "decider" && side === "right") {
      found.push(diagnostic("invalid-operand", "Метасигнал допустим только в левом операнде", field, "обычный сигнал", null));
    }
    if (device === "constant" || device === "channel") {
      found.push(diagnostic("invalid-signal", "Метасигнал не записывается как количество канала", field, "обычный сигнал", null));
    }
    return;
  }
  if (!isSignalToken(signal)) {
    found.push(diagnostic("invalid-signal", "Ожидается сигнал каталога", field, "сигнал", null, {
      received: signal === null ? "null" : typeof signal,
    }));
  }
}

function summarize(node) {
  if (!node || node.type === "invalid") return undefined;
  if (node.type === "literal") return node.value;
  if (node.type === "number") return node.integer ? node.value : node.raw;
  if (node.type === "string") return node.value;
  if (node.type === "ref") return { ref: node.name };
  if (node.type === "path") {
    const path = node.parts.join(".");
    return node.quality ? `${path}.withQuality(Quality.${node.quality.name})` : path;
  }
  if (node.type === "array") return node.items.map((item) => summarize(item));
  if (node.type === "object") {
    const object = {};
    for (const field of node.fields) object[field.name] = summarize(field.value);
    return object;
  }
  return undefined;
}

function otherProfile(name) {
  return name === "base" ? "space-age" : "base";
}

function lookupSignal(parts, profile) {
  let node = profile.tree;
  for (const part of parts.slice(1)) {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, part)) return null;
    node = node[part];
  }
  if (isSignalToken(node) || isMetaToken(node) || isQualitySelectorToken(node)) return node;
  return null;
}

function resolvePath(node, profile, field) {
  const head = node.parts[0];
  if (head === "Signal") {
    const token = lookupSignal(node.parts, profile);
    if (!token) {
      const alternate = lookupSignal(node.parts, openProfile(otherProfile(profile.name)));
      return {
        error: diagnostic(
          alternate ? "unavailable-signal" : "unknown-signal",
          alternate
            ? `Сигнал ${node.parts.join(".")} недоступен в профиле ${profile.name}`
            : `Неизвестный сигнал ${node.parts.join(".")}`,
          field,
          "сигнал профиля",
          node.range,
        ),
      };
    }
    if (!node.quality) return { value: token, use: `signal:${node.parts.join(".")}` };
    const quality = Quality[node.quality.name];
    if (!isQualityToken(quality)) {
      return {
        error: diagnostic("unknown-quality", `Неизвестное качество ${node.quality.name}`, field, "Quality", node.quality.range),
      };
    }
    try {
      const derived = token.withQuality(quality);
      return { value: derived, use: `signal:${node.parts.join(".")}#${quality.name}` };
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      return {
        error: diagnostic(error.code, error.message, field, "качество профиля", node.range),
      };
    }
  }
  if (head === "Quality") {
    const token = Quality[node.parts[1]];
    if (!isQualityToken(token)) {
      return { error: diagnostic("unknown-quality", `Неизвестное качество ${node.parts[1] ?? ""}`, field, "Quality", node.range) };
    }
    const allowed = qualityCatalog(profile).some((item) => item.name === node.parts[1]);
    if (!allowed) {
      return {
        error: diagnostic(
          "unavailable-quality",
          `Качество ${node.parts[1]} недоступно в профиле ${profile.name}`,
          field,
          "качество профиля",
          node.range,
        ),
      };
    }
    return { value: token, use: `quality:${node.parts[1]}` };
  }
  if (!Object.hasOwn(OPERATION_TABLES, head)) {
    return {
      error: diagnostic(
        "unknown-path",
        `Неизвестный путь ${node.parts.join(".")}`,
        field,
        "Signal, Quality или константа операции",
        node.range,
      ),
    };
  }
  const group = OPERATION_TABLES[head];
  const table = group?.[node.parts[1]]?.();
  const token = table?.[node.parts[2]];
  if (!isOperationToken(token)) {
    return {
      error: diagnostic(
        "invalid-operation",
        `Неизвестная операция ${node.parts.join(".")}`,
        field,
        "константа операции",
        node.range,
      ),
    };
  }
  return { value: token, use: `operation:${node.parts.join(".")}` };
}

function plainFrom(node, profile, field, device, diagnostics, uses) {
  if (node?.range) noteSpan(field, node.range);
  if (!node || node.type === "invalid") return undefined;
  if (node.type === "literal") return node.value;
  if (node.type === "number") {
    if (!node.integer) return { __mark: "fractional", raw: node.raw, range: node.range };
    return node.value;
  }
  if (node.type === "string") return node.value;
  if (node.type === "ref") return { __mark: "ref", name: node.name, range: node.range };
  if (node.type === "path") {
    const resolved = resolvePath(node, profile, field);
    if (resolved.error) {
      diagnostics.push(resolved.error);
      return undefined;
    }
    if (resolved.use) uses.push(resolved.use);
    return resolved.value;
  }
  if (node.type === "array") {
    return node.items.map((item, index) => plainFrom(item, profile, `${field}.${index}`, device, diagnostics, uses));
  }
  const object = {};
  const seen = new Set();
  for (const entry of node.fields) {
    const next = fieldPath(field, entry.name);
    if (seen.has(entry.name)) {
      diagnostics.push(diagnostic("duplicate-field", `Поле ${entry.name} повторяется`, next, "уникальное поле", entry.range));
      continue;
    }
    seen.add(entry.name);
    object[entry.name] = plainFrom(entry.value, profile, next, device, diagnostics, uses);
  }
  return object;
}

function operandRole(device, field, side) {
  if (device === "arithmetic" && field === "return") return "arithmetic-return";
  if (device === "arithmetic") return "arithmetic-operand";
  if (device === "decider" && side === "left") return "decider-left";
  if (device === "decider") return "decider-right";
  return "channel";
}

function eachCount(config) {
  const marks = ["left_operand", "right_operand"].filter((name) => {
    const value = config[name];
    return value && isMetaToken(value.signal) && value.signal.name === "each";
  });
  return marks.length;
}

function checkOperandField(config, name, device, side, fieldBase, diagnostics) {
  if (!Object.hasOwn(config, name)) return;
  const value = config[name];
  if (value === undefined) return;
  const field = fieldPath(fieldBase, name);
  if (value && typeof value === "object" && value.__mark === "ref") {
    diagnostics.push(diagnostic("invalid-operand", "Операнд не может быть ссылкой на имя", field, "Operand | OperandConst | null", null));
    return;
  }
  const copy = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : value;
  diagnostics.push(...diagnoseOperand(copy, { field, device, side }));
}

function resolvePorts(config, fieldBase, declared, diagnostics, uses) {
  const resolved = { ...config };
  for (const [name, color] of Object.entries(PORTS)) {
    if (!Object.hasOwn(config, name) || config[name] === null || config[name] === undefined) continue;
    const value = config[name];
    const field = fieldPath(fieldBase, name);
    if (isOperationToken(value) || isSignalToken(value) || isMetaToken(value) || isQualityToken(value)) {
      diagnostics.push(diagnostic(
        "invalid-port",
        isOperationToken(value) ? "Операция не является сетью" : "Сигнал не является сетью",
        field,
        "сеть или null",
        null,
      ));
      continue;
    }
    if (typeof value === "string") {
      diagnostics.push(diagnostic("invalid-port", "Требуется ссылка на сеть или null, получена строка", field, "сеть или null", null, {
        received: "string",
      }));
      continue;
    }
    if (!value || typeof value !== "object" || value.__mark !== "ref") {
      diagnostics.push(diagnostic("invalid-port", "Требуется ссылка на сеть или null", field, "сеть или null", null));
      continue;
    }
    const parsed = parseNetworkName(value.name);
    if (!parsed) {
      diagnostics.push(diagnostic("invalid-name", `Имя ${value.name} не является сетью`, field, "red_* или green_*", value.range));
      continue;
    }
    if (parsed.color !== color) {
      diagnostics.push(diagnostic("wrong-color", "Цвет сети не соответствует порту", field, color, value.range, {
        related: [field],
      }));
      continue;
    }
    resolved[name] = { __mark: "network", name: value.name };
    uses.push(`network:${value.name}`);
  }
  return resolved;
}

function linkTrain(config, field, kinds, diagnostics) {
  if (!Array.isArray(config.route)) return config;
  const copy = { ...config };
  copy.route = config.route.map((item, index) => {
    const path = `${field}.route.${index}`;
    if (!item || item.__mark !== "ref") {
      diagnostics.push(diagnostic(
        "unknown-station",
        "Элемент маршрута должен быть ссылкой на станцию",
        path,
        "Station",
        item?.range ?? null,
      ));
      return item;
    }
    if (kinds.get(item.name) !== "station") {
      diagnostics.push(diagnostic(
        "unknown-station",
        `Станция ${item.name} не объявлена`,
        path,
        "Station",
        item.range,
      ));
      return item;
    }
    return { __mark: "device", name: item.name, range: item.range };
  });
  return copy;
}

function deviceFields(statements) {
  const counts = new Map();
  const fields = new Map();
  for (const statement of statements) {
    if (statement.type !== "device") continue;
    if (statement.name) {
      fields.set(statement, statement.name);
      continue;
    }
    const count = (counts.get(statement.kind) ?? 0) + 1;
    counts.set(statement.kind, count);
    fields.set(statement, `${statement.kind}#${count}`);
  }
  return fields;
}

function networkStubs(names) {
  return new Map([...names].map((name) => [name, { name, color: parseNetworkName(name).color }]));
}

function referencedNames(declared, uses) {
  const names = new Set(declared);
  for (const use of uses) {
    if (use.startsWith("network:")) names.add(use.slice(8));
  }
  return names;
}

function materialize(kind, config, networks, groups, devices = new Map()) {
  return new CLASSES[KIND_CLASS[kind]](swap(config, networks, groups, devices));
}

function swap(value, networks, groups, devices = new Map()) {
  if (Array.isArray(value)) return value.map((item) => swap(item, networks, groups, devices));
  if (!value || typeof value !== "object") return value;
  if (value.__mark === "network") return networks.get(value.name) ?? null;
  if (value.__mark === "group") return groups.get(value.name) ?? null;
  if (value.__mark === "device") {
    const found = devices.get(value.name);
    return found === undefined ? null : found;
  }
  if (value.__mark === "ref") return value.name;
  if (value.__mark === "fractional") return value;
  if (isToken(value)) return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "range") continue;
    copy[key] = swap(item, networks, groups, devices);
  }
  return copy;
}

function catchConstruct(kind, config, networks, groups, field, devices = new Map()) {
  try {
    return { device: materialize(kind, config, networks, groups, devices) };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    const related = error.code === "invalid-each"
      ? kind === "arithmetic"
        ? [fieldPath(field, "left_operand.signal"), fieldPath(field, "right_operand.signal"), fieldPath(field, "return")]
        : [fieldPath(field, "conditions"), fieldPath(field, "when_true"), fieldPath(field, "when_false")]
      : [];
    return {
      error: diagnostic(error.code, error.message, field, "допустимая конфигурация", null, { related }),
    };
  }
}

function isToken(value) {
  return isSignalToken(value) || isMetaToken(value) || isOperationToken(value) || isQualityToken(value) || isQualitySelectorToken(value);
}

function linkGroups(config, groups, field, diagnostics) {
  if (!config || typeof config !== "object" || isToken(config)) return config;
  if (Array.isArray(config)) return config.map((item, index) => linkGroups(item, groups, `${field}.${index}`, diagnostics));
  if (config.__mark) return config;
  const copy = { ...config };
  if (Object.hasOwn(copy, "group")) {
    const value = copy.group;
    if (typeof value === "string") {
      diagnostics.push(diagnostic(
        "unsupported-case",
        "Идентичность группы — объект Constant.Group",
        fieldPath(field, "group"),
        "Constant.Group | null",
        null,
        { received: "string" },
      ));
    } else if (value && value.__mark === "ref") {
      if (!groups.has(value.name)) {
        diagnostics.push(diagnostic("unknown-group", `Группа ${value.name} не объявлена`, fieldPath(field, "group"), "Constant.Group", value.range));
      } else {
        copy.group = { __mark: "group", name: value.name };
      }
    }
  }
  for (const [key, item] of Object.entries(copy)) {
    if (item && typeof item === "object" && !isToken(item)) {
      copy[key] = linkGroups(item, groups, fieldPath(field, key), diagnostics);
    }
  }
  return copy;
}

export function checkConfiguration(text, profileName = "base") {
  const previousIndex = spanIndex;
  const previousLength = spanTextLength;
  spanIndex = new Map();
  spanTextLength = typeof text === "string" ? text.length : 0;
  try {
    return checkConfigurationNow(text, profileName);
  } finally {
    spanIndex = previousIndex;
    spanTextLength = previousLength;
  }
}

function checkConfigurationNow(text, profileName = "base") {
  const profile = openProfile(profileName);
  const parsed = parseConfiguration(text);
  const diagnostics = parsed.diagnostics.map((item) => ({ ...item, related: [...(item.related ?? [])] }));
  const declared = new Set();
  const names = new Set();
  const uses = [];
  const summaries = [];
  const wires = [];
  const prepared = [];
  const deferredTrains = [];
  let deviceSeq = 0;
  const groups = new Map();
  const peers = [];

  for (const statement of parsed.statements) {
    if (statement.type === "wire") {
      if (names.has(statement.name)) {
        diagnostics.push(diagnostic("duplicate-device", `Имя ${statement.name} повторяется`, statement.name, "уникальное имя", statement.range));
      }
      names.add(statement.name);
      const parsedName = parseNetworkName(statement.name);
      if (!parsedName) {
        diagnostics.push(diagnostic("invalid-name", "Имя сети должно иметь вид red_* или green_*", statement.name, "red_* или green_*", statement.nameRange));
      } else {
        declared.add(statement.name);
      }
      for (const field of statement.fields) {
        if (field.name !== "label") {
          diagnostics.push(diagnostic("invalid-wire", `У сети нет поля ${field.name}`, `${statement.name}.${field.name}`, "label", field.range));
        } else if (field.value.type !== "string") {
          diagnostics.push(diagnostic("invalid-wire", "label сети — строка", `${statement.name}.label`, "string", field.value.range));
        }
      }
      wires.push({ name: statement.name, range: statement.range });
      continue;
    }
    if ((statement.type === "group" || statement.type === "device") && statement.name) {
      if (names.has(statement.name)) {
        diagnostics.push(diagnostic("duplicate-device", `Имя ${statement.name} повторяется`, statement.name, "уникальное имя", statement.range));
      }
      names.add(statement.name);
    }
  }

  for (const statement of parsed.statements) {
    if (statement.type !== "group") continue;
    const local = [];
    const config = plainFrom(statement.object, profile, statement.name, "constant", local, uses);
    walkNumbers(config, statement.name, local);
    diagnostics.push(...local);
    if (local.length === 0 && config) {
      try {
        groups.set(statement.name, new Constant.Group(swap(config, new Map(), groups)));
        uses.push(`group:${statement.name}`);
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        diagnostics.push(diagnostic(error.code, error.message, statement.name, "Constant.Group", statement.range));
      }
    }
  }

  const declaredKinds = new Map();
  for (const statement of parsed.statements) {
    if (statement.type === "device" && statement.name && !declaredKinds.has(statement.name)) {
      declaredKinds.set(statement.name, statement.kind);
    }
  }
  const fields = deviceFields(parsed.statements);

  for (const statement of parsed.statements) {
    if (statement.type !== "device") continue;
    const field = fields.get(statement);
    const expected = KIND_CLASS[statement.kind];
    if (statement.className !== expected) {
      diagnostics.push(diagnostic(
        "invalid-class",
        `${statement.kind} создаётся как new ${expected}`,
        field,
        expected,
        statement.range,
        { received: statement.className },
      ));
    }
    const local = [];
    let config = plainFrom(statement.object, profile, field, statement.kind, local, uses);
    if (config && typeof config === "object") {
      for (const name of ["left_operand", "right_operand"]) {
        const side = name === "left_operand" ? "left" : "right";
        checkOperandField(config, name, statement.kind, side, field, local);
      }
      if (statement.kind === "decider" && Array.isArray(config.conditions)) {
        config.conditions.forEach((condition, index) => {
          if (!condition || typeof condition !== "object") return;
          const base = `${field}.conditions.${index}`;
          checkOperandField(condition, "left_operand", "decider", "left", base, local);
          checkOperandField(condition, "right_operand", "decider", "right", base, local);
        });
      }
      if (statement.kind === "arithmetic" && isMetaToken(config.return) && config.return.name !== "each") {
        local.push(diagnostic(
          "unsupported-mode",
          "return не принимает Anything и Everything",
          `${field}.return`,
          "обычный сигнал или Each",
          null,
        ));
      }
      if (statement.kind === "arithmetic" && config.left_operand !== undefined && config.right_operand !== undefined) {
        if (eachCount(config) === 2) {
          local.push(diagnostic(
            "invalid-each",
            "Each допускается только в одном операнде",
            fieldPath(field, "left_operand.signal"),
            "Each только в одном операнде",
            null,
            {
              related: [
                fieldPath(field, "left_operand.signal"),
                fieldPath(field, "right_operand.signal"),
              ],
            },
          ));
        }
        if (isMetaToken(config.return) && config.return.name === "each" && eachCount(config) !== 1) {
          local.push(diagnostic(
            "invalid-each",
            "Выход Each требует Each в одном операнде",
            fieldPath(field, "return"),
            "Each в одном операнде",
            null,
            {
              related: [
                fieldPath(field, "return"),
                fieldPath(field, "left_operand.signal"),
                fieldPath(field, "right_operand.signal"),
              ],
            },
          ));
        }
      }
      config = resolvePorts(config, field, declared, local, uses);
      config = linkGroups(config, groups, field, local);
      walkNumbers(config, field, local);
      if (isOperationToken(config.operation) && statement.kind === "arithmetic" && config.operation.owner !== "arithmetic") {
        local.push(diagnostic("foreign-operation", "Операция принадлежит другому комбинатору", `${field}.operation`, "Arithmetic.Operation", null));
      }
      if (isOperationToken(config.operation) && statement.kind === "decider" && config.operation.owner !== "decider") {
        local.push(diagnostic("foreign-operation", "Операция принадлежит другому комбинатору", `${field}.operation`, "Decider.Operation", null));
      }
      if (isOperationToken(config.operation) && statement.kind === "selector" && config.operation.owner !== "selector") {
        local.push(diagnostic("foreign-operation", "Операция принадлежит другому комбинатору", `${field}.operation`, "Selector.Operation", null));
      }
      if (statement.kind === "train") config = linkTrain(config, field, declaredKinds, local);
    }
    diagnostics.push(...local);
    summaries.push({
      name: statement.name,
      kind: statement.kind,
      config: summarize(statement.object),
    });
    if (local.length === 0 && config && statement.className === expected) {
      const seq = deviceSeq;
      deviceSeq += 1;
      const key = statement.name ? `name:${statement.name}` : `anon:${field}`;
      if (statement.kind === "train") {
        deferredTrains.push({ name: statement.name, key, kind: statement.kind, config, seq });
      } else {
        const stubs = networkStubs(referencedNames(declared, uses));
        const built = catchConstruct(statement.kind, config, stubs, groups, field);
        if (built.error) diagnostics.push(built.error);
        else prepared.push({ name: statement.name, key, kind: statement.kind, config, device: built.device, seq });
      }
    }
  }

  if (deferredTrains.length > 0) {
    const byName = new Map(prepared.filter((item) => item.name).map((item) => [item.name, item.device]));
    const stubs = networkStubs(referencedNames(declared, uses));
    for (const item of deferredTrains) {
      const built = catchConstruct(item.kind, item.config, stubs, groups, item.name, byName);
      if (built.error) diagnostics.push(built.error);
      else prepared.push({ name: item.name, kind: item.kind, config: item.config, device: built.device, seq: item.seq });
    }
    prepared.sort((left, right) => left.seq - right.seq);
  }

  for (const statement of parsed.statements) {
    if (statement.type !== "peers") continue;
    const receiver = statement.fields.find((field) => field.name === "receiver");
    const extra = statement.fields.filter((field) => field.name !== "receiver");
    for (const field of extra) {
      diagnostics.push(diagnostic("invalid-peers", "Связи сценария содержат только receiver", `${statement.name}.${field.name}`, "receiver", field.range));
    }
    if (!receiver || receiver.value.type !== "ref") {
      diagnostics.push(diagnostic("invalid-peers", "receiver — ссылка на событийный блок", `${statement.name}.receiver`, "событие", receiver?.range));
      continue;
    }
    const target = prepared.find((item) => item.name === receiver.value.name && item.kind === "event");
    const source = prepared.find((item) => item.name === statement.name && item.kind === "event");
    if (!source || !target) {
      diagnostics.push(diagnostic("invalid-peers", "Получатель должен быть событийным блоком этой схемы", `${statement.name}.receiver`, "событие", receiver.value.range));
      continue;
    }
    peers.push({ source: statement.name, receiver: receiver.value.name });
    uses.push(`peer:${receiver.value.name}`);
  }

  const folded = [];
  const seenDiag = new Set();
  for (const item of diagnostics) {
    const key = `${item.code}|${item.field}|${item.message}`;
    if (seenDiag.has(key)) continue;
    seenDiag.add(key);
    folded.push(item);
  }
  diagnostics.length = 0;
  diagnostics.push(...folded);

  const referenced = new Set(uses.filter((item) => item.startsWith("network:")).map((item) => item.slice(8)));
  const model = diagnostics.length === 0 ? { devices: summaries, wires: [...declared], peers } : null;
  return {
    diagnostics,
    statements: parsed.statements,
    model,
    referenced,
    wires,
    uses,
    prepared: diagnostics.length === 0 ? prepared : [],
    peers: diagnostics.length === 0 ? peers : [],
    groups,
    profile,
  };
}

export function buildPrepared(prepared, peers, networks, groups) {
  const byName = new Map();
  const built = new Map();
  for (const item of prepared) {
    if (item.kind === "train") continue;
    const device = materialize(item.kind, item.config, networks, groups, byName);
    built.set(item.key, { name: item.name, kind: item.kind, device });
    if (item.name) byName.set(item.name, device);
  }
  for (const item of prepared) {
    if (item.kind !== "train") continue;
    const device = materialize(item.kind, item.config, networks, groups, byName);
    built.set(item.key, { name: item.name, kind: item.kind, device });
    if (item.name) byName.set(item.name, device);
  }
  const devices = prepared.map((item) => built.get(item.key));
  const links = [];
  for (const peer of peers) {
    links.push({ event: byName.get(peer.source), receiver: byName.get(peer.receiver) });
  }
  return { devices, links };
}

export function compareCatalog(left, right) {
  return compareText(left, right);
}
