/** Лампа: условие и цвет на опубликованной границе, без вклада в сети. */

import { ConfigError, RuntimeError } from "./errors.js";
import { isInt32 } from "./int32.js";
import {
  OperationToken,
  assertChannel,
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "./signal-token.js";

const INPUTS = ["red_input", "green_input"];
const ALLOWED = new Set([...INPUTS, "condition", "use_colors", "color_mode"]);
const UNSUPPORTED = new Set([
  "logistic_condition",
  "connect_to_logistic_network",
  "red_signal",
  "green_signal",
  "blue_signal",
  "rgb_signal",
  "circuit_enabled",
]);
const COMPARISONS = new Map([
  ["GT", (left, right) => left > right],
  ["LT", (left, right) => left < right],
  ["EQ", (left, right) => left === right],
  ["GTE", (left, right) => left >= right],
  ["LTE", (left, right) => left <= right],
  ["NEQ", (left, right) => left !== right],
]);
const COLOR_MODES = new Set(["mapping", "components", "packed"]);
const COLOR_ORDER = [
  "signal-red",
  "signal-green",
  "signal-blue",
  "signal-yellow",
  "signal-pink",
  "signal-cyan",
  "signal-white",
  "signal-grey",
  "signal-black",
];
const COLOR_NAMES = new Set(COLOR_ORDER);
const BOTH = Object.freeze({ red: true, green: true });

function fail(code, message) {
  throw new ConfigError(code, message);
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

function readSignalOperand(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-operand", `${label} должен быть объектом сигнала`);
  }
  const keys = Object.keys(value);
  if (Object.hasOwn(value, "constant")) fail("invalid-operand", `${label} не задаётся числом`);
  if (keys.length !== 3 || !Object.hasOwn(value, "red") || !Object.hasOwn(value, "green") || !Object.hasOwn(value, "signal")) {
    fail("invalid-operand", `${label} содержит red, green и signal`);
  }
  if (typeof value.red !== "boolean" || typeof value.green !== "boolean") {
    fail("invalid-mask", "red и green операнда должны быть boolean");
  }
  return { signal: assertChannel(value.signal), mask: { red: value.red, green: value.green } };
}

function readRight(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-operand", "Правый операнд лампы должен быть сигналом или constant");
  }
  const hasConstant = Object.hasOwn(value, "constant");
  const hasSignal = Object.hasOwn(value, "signal") || Object.hasOwn(value, "red") || Object.hasOwn(value, "green");
  if (hasConstant && hasSignal) fail("mixed-operand", "Правый операнд не смешивает constant с полями сигнала");
  if (hasConstant) {
    if (Object.keys(value).length !== 1) fail("invalid-operand", "constant не содержит других полей");
    if (!isInt32(value.constant)) fail("invalid-constant", "Количество должно быть целым int32");
    return { kind: "constant", constant: value.constant };
  }
  const signal = readSignalOperand(value, "Правый операнд");
  return { kind: "signal", signal: signal.signal, mask: signal.mask };
}

function readCondition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-condition", "Условие лампы должно быть объектом");
  }
  const keys = Object.keys(value);
  if (keys.length !== 3 || !Object.hasOwn(value, "left_operand") || !Object.hasOwn(value, "operation") || !Object.hasOwn(value, "right_operand")) {
    fail("invalid-condition", "Условие лампы содержит left_operand, operation и right_operand");
  }
  const operation = value.operation;
  if (!isOperationToken(operation)) fail("invalid-operation", "Нужна константа Lamp.Operation");
  if (operation.owner !== "lamp") fail("foreign-operation", "Операция принадлежит другому устройству");
  if (!COMPARISONS.has(operation.name)) fail("unsupported-operation", `Сравнение ${operation.name} не поддержано`);
  return {
    left: readSignalOperand(value.left_operand, "Левый операнд"),
    operation: operation.name,
    right: readRight(value.right_operand),
  };
}

function readColorMode(config) {
  if (typeof config.use_colors !== "boolean") fail("invalid-colors", "use_colors должен быть boolean");
  const present = Object.hasOwn(config, "color_mode");
  if (!config.use_colors) {
    if (present) fail("invalid-color-mode", "color_mode допустим только вместе с use_colors: true");
    return null;
  }
  if (!present || !COLOR_MODES.has(config.color_mode)) {
    fail("invalid-color-mode", "color_mode должен быть mapping, components или packed");
  }
  return config.color_mode;
}

function normalValue(rows, name) {
  const found = rows.find((entry) => (
    entry.signal.type === "virtual"
    && entry.signal.name === name
    && entry.signal.quality === "normal"
  ));
  return found ? found.constant : 0;
}

function componentValue(rows, name) {
  const value = normalValue(rows, name);
  if (value < 0 || value > 255) {
    throw new RuntimeError("unsupported-case", `Компонент ${name} вне 0..255 не поддержан без игрового fixture`);
  }
  return value;
}

function colorOf(mode, rows) {
  if (mode === "mapping") {
    for (const name of COLOR_ORDER) {
      if (normalValue(rows, name) > 0) return { mode: "mapping", name };
    }
    return null;
  }
  if (mode === "components") {
    return {
      mode: "components",
      red: componentValue(rows, "signal-red"),
      green: componentValue(rows, "signal-green"),
      blue: componentValue(rows, "signal-blue"),
    };
  }
  const value = normalValue(rows, "signal-white");
  if (value < 0 || value > 16777215) {
    throw new RuntimeError("unsupported-case", "packed RGB вне 0..16777215 не поддержан без игрового fixture");
  }
  return { mode: "packed", value };
}

export function readLampState(value, code = "invalid-state") {
  const reject = (message) => {
    throw new RuntimeError(code, message);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("Состояние лампы должно быть объектом");
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !Object.hasOwn(value, "lit") || !Object.hasOwn(value, "color")) {
    reject("Состояние лампы содержит lit и color");
  }
  if (typeof value.lit !== "boolean") reject("lit лампы должен быть boolean");
  if (value.color === null) return { lit: value.lit, color: null };
  if (!value.color || typeof value.color !== "object" || Array.isArray(value.color)) {
    reject("color лампы должен быть объектом или null");
  }
  if (value.color.mode === "mapping") {
    const colorKeys = Object.keys(value.color);
    if (colorKeys.length !== 2 || !Object.hasOwn(value.color, "name")) {
      reject("mapping содержит mode и name");
    }
    if (!COLOR_NAMES.has(value.color.name)) reject("Имя цвета mapping не входит в порядок лампы");
    return { lit: value.lit, color: { mode: "mapping", name: value.color.name } };
  }
  if (value.color.mode === "components") {
    const colorKeys = Object.keys(value.color);
    if (colorKeys.length !== 4
      || !Object.hasOwn(value.color, "red")
      || !Object.hasOwn(value.color, "green")
      || !Object.hasOwn(value.color, "blue")) {
      reject("components содержит mode, red, green и blue");
    }
    for (const name of ["red", "green", "blue"]) {
      const component = value.color[name];
      if (!Number.isInteger(component) || component < 0 || component > 255) {
        reject("Компонент цвета должен быть целым 0..255");
      }
    }
    return {
      lit: value.lit,
      color: {
        mode: "components",
        red: value.color.red,
        green: value.color.green,
        blue: value.color.blue,
      },
    };
  }
  if (value.color.mode === "packed") {
    const colorKeys = Object.keys(value.color);
    if (colorKeys.length !== 2 || !Object.hasOwn(value.color, "value")) {
      reject("packed содержит mode и value");
    }
    if (!Number.isInteger(value.color.value) || value.color.value < 0 || value.color.value > 16777215) {
      reject("packed value должен быть целым 0..16777215");
    }
    return { lit: value.lit, color: { mode: "packed", value: value.color.value } };
  }
  reject("Режим color должен быть mapping, components или packed");
}

export class Lamp {
  static Operation = Object.freeze(Object.fromEntries(
    [...COMPARISONS.keys()].map((name) => [name, new OperationToken("lamp", name)]),
  ));

  #left;
  #operation;
  #right;
  #useColors;
  #colorMode;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-lamp-config", "Lamp принимает объект настроек");
    }
    for (const key of Object.keys(config)) {
      if (key === "red_output" || key === "green_output") {
        fail("forbidden-output", "Лампа не пишет в сети");
      }
      if (UNSUPPORTED.has(key)) {
        fail("unsupported-case", `Настройка ${key} лампы не поддержана без игрового fixture`);
      }
      if (!ALLOWED.has(key)) fail("invalid-lamp-config", `Неизвестный параметр ${key}`);
    }
    if (!Object.hasOwn(config, "condition")) fail("invalid-condition", "У лампы нужно условие");
    if (!Object.hasOwn(config, "use_colors")) fail("invalid-colors", "use_colors должен быть boolean");
    const condition = readCondition(config.condition);
    this.#left = condition.left;
    this.#operation = condition.operation;
    this.#right = condition.right;
    this.#useColors = config.use_colors;
    this.#colorMode = readColorMode(config);
    for (const key of INPUTS) this[key] = readWire(config[key], Object.hasOwn(config, key));
    this.observe = (view) => this.#observe(view);
  }

  get condition() {
    return {
      left: this.#left,
      operation: this.#operation,
      right: this.#right,
    };
  }

  get useColors() {
    return this.#useColors;
  }

  get colorMode() {
    return this.#colorMode;
  }

  validateProfile(profileName) {
    const signals = [this.#left.signal];
    if (this.#right.kind === "signal") signals.push(this.#right.signal);
    for (const signal of signals) {
      if (signal.profile !== profileName) {
        fail("wrong-profile", `Сигнал профиля ${signal.profile} нельзя использовать в профиле ${profileName}`);
      }
    }
  }

  #observe(view) {
    const left = view.read(this.#left.signal, this.#left.mask);
    const right = this.#right.kind === "constant"
      ? this.#right.constant
      : view.read(this.#right.signal, this.#right.mask);
    const lit = COMPARISONS.get(this.#operation)(left, right);
    if (!lit || !this.#useColors) return { lit, color: null };
    return { lit: true, color: colorOf(this.#colorMode, view.present(BOTH)) };
  }
}
