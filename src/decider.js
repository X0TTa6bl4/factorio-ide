/** Сравнивающий комбинатор: условия AND/OR, ветки и метасигналы. Спорные ветви диагностируются. */

import { ConfigError, RuntimeError } from "./errors.js";
import { addInt32, isInt32 } from "./int32.js";
import {
  OperationToken,
  assertChannel,
  channelKey,
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "./signal-token.js";

const PORTS = ["red_input", "green_input", "red_output", "green_output"];
const ALLOWED = new Set([...PORTS, "conditions", "when_true", "when_false"]);
const COMPARISONS = new Map([
  ["GT", (left, right) => left > right],
  ["LT", (left, right) => left < right],
  ["EQ", (left, right) => left === right],
  ["GTE", (left, right) => left >= right],
  ["LTE", (left, right) => left <= right],
  ["NEQ", (left, right) => left !== right],
]);

function fail(code, message) {
  throw new ConfigError(code, message);
}

function unsupported(message) {
  throw new RuntimeError("unsupported-case", message);
}

function maskOf(value) {
  return { red: value.red, green: value.green };
}

function readWire(value, present) {
  if (!present || value === null) return null;
  if (typeof value === "string") {
    fail("invalid-port", "Требуется ссылка на сеть или null, получена строка");
  }
  if (isOperationToken(value)) fail("invalid-port", "Операция не является сетью");
  if (isSignalToken(value) || isMetaToken(value) || isQualityToken(value) || isQualitySelectorToken(value)) {
    fail("invalid-port", "Сигнал не является сетью");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-port", "Требуется ссылка на сеть или null");
  }
  return value;
}

function readSide(value, label, side) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-operand", `${label} должен быть объектом операнда или null`);
  }
  const keys = Object.keys(value);
  const hasConstant = Object.hasOwn(value, "constant");
  const hasSignalField = Object.hasOwn(value, "signal") || Object.hasOwn(value, "red") || Object.hasOwn(value, "green");
  if (hasConstant && hasSignalField) {
    fail("mixed-operand", `${label} не смешивает constant с полями сигнала`);
  }
  if (hasConstant) {
    if (keys.length !== 1) fail("invalid-operand", `${label} с constant не содержит других полей`);
    if (!isInt32(value.constant)) fail("invalid-constant", "Количество должно быть целым int32");
    if (side === "left") fail("invalid-operand", "Левый операнд сравнивающего — сигнал или null");
    return { kind: "constant", constant: value.constant };
  }
  if (keys.length !== 3 || !Object.hasOwn(value, "red") || !Object.hasOwn(value, "green") || !Object.hasOwn(value, "signal")) {
    fail("invalid-operand", `${label} содержит red, green и signal`);
  }
  if (typeof value.red !== "boolean" || typeof value.green !== "boolean") {
    fail("invalid-mask", "red и green операнда должны быть boolean");
  }
  if (isMetaToken(value.signal)) {
    if (side === "right") fail("invalid-operand", "Метасигнал допустим только в левом операнде");
    return { kind: "meta", red: value.red, green: value.green, signal: value.signal };
  }
  return { kind: "signal", red: value.red, green: value.green, signal: assertChannel(value.signal) };
}

function readOperation(value) {
  if (!isOperationToken(value)) fail("invalid-operation", "Нужна константа Decider.Operation");
  if (value.owner !== "decider") fail("foreign-operation", "Операция принадлежит другому комбинатору");
  if (!COMPARISONS.has(value.name)) {
    fail("unsupported-operation", `Сравнение ${value.name} не поддержано`);
  }
  return value.name;
}

function readLogic(value) {
  if (!isOperationToken(value)) fail("invalid-logic", "Нужна константа Decider.Logic");
  if (value.owner !== "decider") fail("foreign-operation", "Связка принадлежит другому комбинатору");
  if (value.name !== "AND" && value.name !== "OR") {
    fail("invalid-logic", "Связка должна быть AND или OR");
  }
  return value.name;
}

function readCondition(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-condition", "Условие должно быть объектом");
  }
  if (index === 0 && Object.hasOwn(value, "logic")) {
    fail("invalid-logic", "Связка задаётся со второго условия");
  }
  if (index > 0 && !Object.hasOwn(value, "logic")) {
    fail("missing-logic", "Со второго условия нужна связка Decider.Logic");
  }
  const expected = index === 0
    ? ["left_operand", "right_operand", "operation"]
    : ["left_operand", "right_operand", "operation", "logic"];
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) fail("invalid-condition", `Неизвестное поле условия ${key}`);
  }
  if (!Object.hasOwn(value, "left_operand") || !Object.hasOwn(value, "right_operand")) {
    fail("missing-operand", "У условия нужны left_operand и right_operand");
  }
  if (!Object.hasOwn(value, "operation")) {
    fail("missing-operation", "Сравнение обязательно и не выбирается по умолчанию");
  }
  return {
    left: readSide(value.left_operand, "left_operand", "left"),
    right: readSide(value.right_operand, "right_operand", "right"),
    operation: readOperation(value.operation),
    logic: index === 0 ? null : readLogic(value.logic),
  };
}

function readConditions(value) {
  if (!Array.isArray(value)) fail("invalid-conditions", "conditions должен быть массивом");
  if (value.length === 0) fail("invalid-conditions", "Нужно хотя бы одно условие");
  const conditions = [];
  for (let index = 0; index < value.length; index += 1) {
    conditions.push(readCondition(value[index], index));
  }
  return conditions;
}

function readOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-output", "Настройка выхода должна быть объектом");
  }
  const keys = Object.keys(value);
  const hasConstant = Object.hasOwn(value, "constant");
  const hasRed = Object.hasOwn(value, "red");
  const hasGreen = Object.hasOwn(value, "green");
  if (!Object.hasOwn(value, "signal")) fail("invalid-output", "У выхода нужен signal");
  if (hasConstant && (hasRed || hasGreen) && !isMetaToken(value.signal)) {
    fail("mixed-output", "Обычный выход не смешивает constant с маской цветов");
  }
  if (hasConstant && (hasRed || hasGreen)) {
    if (!hasRed || !hasGreen || keys.length !== 4) {
      fail("invalid-output", "Фиксированный метасигнал содержит signal, constant, red и green");
    }
    if (typeof value.red !== "boolean" || typeof value.green !== "boolean") {
      fail("invalid-mask", "red и green выхода должны быть boolean");
    }
    if (!isInt32(value.constant)) fail("invalid-constant", "Количество должно быть целым int32");
    return {
      kind: "fixed-meta",
      meta: value.signal.name,
      signal: value.signal,
      constant: value.constant,
      red: value.red,
      green: value.green,
    };
  }
  if (hasConstant) {
    if (keys.length !== 2) fail("invalid-output", "Фиксированный выход содержит signal и constant");
    if (!isInt32(value.constant)) fail("invalid-constant", "Количество должно быть целым int32");
    if (isMetaToken(value.signal)) {
      if (value.signal.name !== "each") {
        fail("invalid-output", "Фиксированный метасигнал задаётся вместе с red и green");
      }
      return { kind: "each-fixed", signal: value.signal, constant: value.constant };
    }
    return { kind: "fixed-channel", signal: assertChannel(value.signal), constant: value.constant };
  }
  if (hasRed || hasGreen) {
    if (!hasRed || !hasGreen || keys.length !== 3) {
      fail("invalid-output", "Копирование содержит signal, red и green");
    }
    if (typeof value.red !== "boolean" || typeof value.green !== "boolean") {
      fail("invalid-mask", "red и green выхода должны быть boolean");
    }
    if (isMetaToken(value.signal)) {
      if (value.signal.name === "each") {
        return { kind: "each-copy", signal: value.signal, red: value.red, green: value.green };
      }
      if (value.signal.name === "everything") {
        return { kind: "everything-copy", signal: value.signal, red: value.red, green: value.green };
      }
      return { kind: "anything-copy", signal: value.signal, red: value.red, green: value.green };
    }
    return { kind: "copy-channel", signal: assertChannel(value.signal), red: value.red, green: value.green };
  }
  fail("invalid-output", "Выход задаёт constant либо red и green");
}

function readBranch(config, key) {
  if (!Object.hasOwn(config, key) || config[key] === null) return [];
  if (!Array.isArray(config[key])) fail("invalid-output", `${key} должен быть массивом или null`);
  const branch = [];
  for (let index = 0; index < config[key].length; index += 1) {
    branch.push(readOutput(config[key][index]));
  }
  return branch;
}

function outputKey(item) {
  if (item.kind === "fixed-channel" || item.kind === "copy-channel") return channelKey(item.signal);
  if (item.kind === "each-fixed" || item.kind === "each-copy") return "meta:each";
  if (item.kind === "everything-copy") return "meta:everything";
  return "meta:anything";
}

function assertBranch(branch, eachMask) {
  const seen = new Set();
  for (const item of branch) {
    const eachOutput = item.kind === "each-copy"
      || item.kind === "each-fixed"
      || (item.kind === "fixed-meta" && item.meta === "each");
    const everythingOutput = item.kind === "everything-copy"
      || (item.kind === "fixed-meta" && item.meta === "everything");
    if (eachOutput && !eachMask) fail("invalid-each", "Выход Each требует Each в условиях");
    if (everythingOutput && eachMask) fail("invalid-each", "Выход Everything несовместим с Each в условиях");
    if (item.kind === "fixed-meta") {
      fail("unsupported-case", "Фиксированный метасигнальный выход не подтверждён игровым эталоном");
    }
    if (item.kind === "copy-channel" && eachMask) {
      fail("unsupported-case", "Копирование конкретного сигнала при Each не подтверждено игровым эталоном");
    }
    if (item.kind === "each-copy" && (item.red !== eachMask.red || item.green !== eachMask.green)) {
      fail("unsupported-case", "Разные маски условия и копирования Each не подтверждены игровым эталоном");
    }
    const key = outputKey(item);
    if (seen.has(key)) {
      fail("unsupported-case", "Повторный выход одного канала не подтверждён игровым эталоном");
    }
    seen.add(key);
  }
}

function assertExpression(conditions) {
  const names = new Set();
  let eachMask = null;
  for (const condition of conditions) {
    if (condition.left?.kind !== "meta") continue;
    names.add(condition.left.signal.name);
    if (condition.left.signal.name !== "each") continue;
    if (eachMask && (eachMask.red !== condition.left.red || eachMask.green !== condition.left.green)) {
      fail("unsupported-case", "Разные маски условий Each не подтверждены игровым эталоном");
    }
    eachMask = condition.left;
  }
  if (names.size > 1) {
    fail("unsupported-case", "Смешанные метасигналы в условиях не подтверждены игровым эталоном");
  }
  if (eachMask && conditions.some((condition, index) => index > 0 && condition.logic === "OR")) {
    fail("unsupported-case", "Each с OR не подтверждён игровым эталоном");
  }
  return eachMask;
}

function remember(list, signal) {
  if (signal) list.push(signal);
}

function signalsOf(conditions, whenTrue, whenFalse) {
  const list = [];
  for (const condition of conditions) {
    remember(list, condition.left?.signal);
    if (condition.right?.kind === "signal") remember(list, condition.right.signal);
  }
  for (const item of [...whenTrue, ...whenFalse]) remember(list, item.signal);
  return list;
}

function readCount(operand, view) {
  if (operand.kind === "constant") return operand.constant;
  return view.read(operand.signal, maskOf(operand));
}

function passes(condition, view, eachValue) {
  if (condition.left === null || condition.right === null) return false;
  const right = readCount(condition.right, view);
  const compare = COMPARISONS.get(condition.operation);
  if (condition.left.kind === "signal") return compare(readCount(condition.left, view), right);
  if (condition.left.signal.name === "each") return compare(eachValue, right);
  const present = view.present(maskOf(condition.left));
  const candidates = condition.right.kind === "signal"
    ? present.filter((entry) => channelKey(entry.signal) !== channelKey(condition.right.signal))
    : present;
  if (condition.left.signal.name === "everything") {
    return candidates.every((entry) => compare(entry.constant, right));
  }
  return candidates.some((entry) => compare(entry.constant, right));
}

function evaluate(conditions, view, eachValue) {
  const groups = [];
  let current = [];
  conditions.forEach((condition, index) => {
    if (index > 0 && condition.logic === "OR") {
      groups.push(current);
      current = [];
    }
    current.push(condition);
  });
  groups.push(current);
  return groups.some((group) => group.every((condition) => passes(condition, view, eachValue)));
}

function repeatedCount(constant, selection) {
  if (selection === null) return constant;
  let sum = 0;
  for (let index = 0; index < selection.length; index += 1) sum = addInt32(sum, constant);
  return sum;
}

function produce(item, view, selection) {
  if (item.kind === "fixed-channel") {
    const constant = repeatedCount(item.constant, selection);
    return constant === 0 ? [] : [{ signal: item.signal, constant }];
  }
  if (item.kind === "copy-channel") {
    const constant = view.read(item.signal, maskOf(item));
    return constant === 0 ? [] : [{ signal: item.signal, constant }];
  }
  if (item.kind === "each-fixed") {
    if (item.constant === 0) return [];
    return selection.map((entry) => ({ signal: entry.signal, constant: item.constant }));
  }
  if (item.kind === "each-copy") {
    return selection.map((entry) => ({ signal: entry.signal, constant: view.read(entry.signal, maskOf(item)) }));
  }
  if (item.kind === "everything-copy") return view.present(maskOf(item));
  const candidates = selection === null ? view.present(maskOf(item)) : selection;
  if (candidates.length > 0) {
    unsupported("Выбор выходного Anything не подтверждён игровым эталоном");
  }
  return [];
}

function collectInto(signals, seen, items, view, selection) {
  for (const item of items) {
    for (const produced of produce(item, view, selection)) {
      const key = channelKey(produced.signal);
      if (seen.has(key)) unsupported("Повтор одного канала в выходе не подтверждён игровым эталоном");
      seen.add(key);
      signals.push(produced);
    }
  }
}

export class Decider {
  static Operation = Object.freeze(Object.fromEntries(
    [...COMPARISONS.keys()].map((name) => [name, new OperationToken("decider", name)]),
  ));

  static Logic = Object.freeze(Object.fromEntries(
    ["AND", "OR"].map((name) => [name, new OperationToken("decider", name)]),
  ));

  #signals;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-decider-config", "Decider принимает объект настроек");
    }
    for (const key of Object.keys(config)) {
      if (key === "sections" || key === "group" || key === "multiplier") {
        fail("unsupported-setting", `Настройка ${key} в этом контуре не поддерживается`);
      }
      if (!ALLOWED.has(key)) fail("invalid-decider-config", `Неизвестный параметр ${key}`);
    }
    if (!Object.hasOwn(config, "conditions")) fail("missing-conditions", "Нужен массив conditions");
    const conditions = readConditions(config.conditions);
    const eachMask = assertExpression(conditions);
    const whenTrue = readBranch(config, "when_true");
    const whenFalse = readBranch(config, "when_false");
    assertBranch(whenTrue, eachMask);
    assertBranch(whenFalse, eachMask);
    for (const key of PORTS) this[key] = readWire(config[key], Object.hasOwn(config, key));
    this.#signals = signalsOf(conditions, whenTrue, whenFalse);
    this.compute = (view) => {
      if (eachMask === null) {
        const truth = evaluate(conditions, view, null);
        return { signals: collect(truth ? whenTrue : whenFalse, view, null) };
      }
      const passed = [];
      const failed = [];
      for (const entry of view.present(maskOf(eachMask))) {
        (evaluate(conditions, view, entry.constant) ? passed : failed).push(entry);
      }
      const signals = [];
      const seen = new Set();
      collectInto(signals, seen, whenTrue, view, passed);
      collectInto(signals, seen, whenFalse, view, failed);
      return { signals };
    };
  }

  validateProfile(profileName) {
    for (const signal of this.#signals) {
      if (signal.profile !== profileName) {
        fail(
          "wrong-profile",
          `Сигнал профиля ${signal.profile} нельзя использовать в профиле ${profileName}`,
        );
      }
    }
  }
}

function collect(items, view, selection) {
  const signals = [];
  collectInto(signals, new Set(), items, view, selection);
  return signals;
}
