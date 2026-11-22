/** Арифметический комбинатор: int32-операции, маски и один Each. Спорные ветви диагностируются. */

import { ConfigError, RuntimeError } from "./errors.js";
import { addInt32, INT32_MIN, isInt32 } from "./int32.js";
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
const ALLOWED = new Set([...PORTS, "left_operand", "right_operand", "operation", "return"]);
const INT32_SIGN_BIT = 2147483648n;

const OPERATIONS = new Map([
  ["SUM", (left, right) => addInt32(left, right)],
  ["SUB", (left, right) => Number(BigInt.asIntN(32, BigInt(left) - BigInt(right)))],
  ["MUL", (left, right) => Math.imul(left, right)],
  ["DIV", divideInt32],
  ["MOD", moduloInt32],
  ["POW", powerInt32],
  ["SHL", (left, right) => Number(BigInt.asIntN(32, BigInt(left) << BigInt(shiftCount(right))))],
  ["SHR", (left, right) => left >> shiftCount(right)],
  ["AND", (left, right) => left & right],
  ["OR", (left, right) => left | right],
  ["XOR", (left, right) => left ^ right],
]);

function fail(code, message) {
  throw new ConfigError(code, message);
}

function unsupported(message) {
  throw new RuntimeError("unsupported-case", message);
}

function divideInt32(left, right) {
  if (right === 0 || (left === INT32_MIN && right === -1)) {
    unsupported("Деление на ноль и MIN/-1 не подтверждены игровым эталоном");
  }
  return Number(BigInt(left) / BigInt(right));
}

function moduloInt32(left, right) {
  if (right === 0 || (left === INT32_MIN && right === -1)) {
    unsupported("Остаток при делении на ноль и MIN/-1 не подтверждены игровым эталоном");
  }
  return Number(BigInt(left) % BigInt(right));
}

function powerInt32(base, exponent) {
  if (exponent < 0) unsupported("Отрицательная степень не подтверждена игровым эталоном");
  if (exponent === 0) unsupported("Нулевая степень не подтверждена игровым эталоном");
  if (base === 0) return 0;
  if (base === 1) return 1;
  if (base === -1) return exponent % 2 === 0 ? 1 : -1;
  if (exponent > 31) unsupported("Переполнение степени не подтверждено игровым эталоном");
  let result = 1n;
  const factor = BigInt(base);
  for (let step = 0; step < exponent; step += 1) {
    result *= factor;
    if (result >= INT32_SIGN_BIT || result < -INT32_SIGN_BIT) {
      unsupported("Переполнение степени не подтверждено игровым эталоном");
    }
  }
  return Number(result);
}

function shiftCount(count) {
  if (count < 0 || count >= 32) {
    unsupported("Сдвиг вне диапазона 0..31 не подтверждён игровым эталоном");
  }
  return count;
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

function readMeta(token, label) {
  if (token.name === "each") return token;
  fail("unsupported-mode", `${label} не принимает Anything и Everything`);
}

function readOperand(value, label) {
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
    return { kind: "constant", constant: value.constant };
  }
  if (keys.length !== 3 || !Object.hasOwn(value, "red") || !Object.hasOwn(value, "green") || !Object.hasOwn(value, "signal")) {
    fail("invalid-operand", `${label} содержит red, green и signal`);
  }
  if (typeof value.red !== "boolean" || typeof value.green !== "boolean") {
    fail("invalid-mask", "red и green операнда должны быть boolean");
  }
  if (isMetaToken(value.signal)) {
    return { kind: "each", red: value.red, green: value.green, signal: readMeta(value.signal, label) };
  }
  return { kind: "signal", red: value.red, green: value.green, signal: assertChannel(value.signal) };
}

function readOperation(value) {
  if (!isOperationToken(value)) fail("invalid-operation", "Нужна константа Arithmetic.Operation");
  if (value.owner !== "arithmetic") fail("foreign-operation", "Операция принадлежит другому комбинатору");
  if (!OPERATIONS.has(value.name)) {
    fail("unsupported-operation", `Операция ${value.name} не поддержана`);
  }
  return value.name;
}

function readReturn(config) {
  if (!Object.hasOwn(config, "return") || config.return === null) return null;
  const value = config.return;
  if (isMetaToken(value)) {
    return { kind: "each", signal: readMeta(value, "return") };
  }
  if (typeof value === "number" || isOperationToken(value)) {
    fail("invalid-return", "Выход должен быть обычным сигналом, Each или null");
  }
  return { kind: "channel", signal: assertChannel(value) };
}

function masksDiffer(eachOperand, other) {
  return eachOperand.red !== other.red || eachOperand.green !== other.green;
}

function assertEach(left, right, output) {
  const leftEach = left?.kind === "each";
  const rightEach = right?.kind === "each";
  if (leftEach && rightEach) fail("invalid-each", "Each допускается только в одном операнде");
  if (output?.kind === "each" && !leftEach && !rightEach) {
    fail("invalid-each", "Выход Each требует Each в одном операнде");
  }
  const eachOperand = leftEach ? left : rightEach ? right : null;
  const other = leftEach ? right : rightEach ? left : null;
  if (eachOperand && other?.kind === "signal" && masksDiffer(eachOperand, other)) {
    fail("unsupported-case", "Each и сигнал с разными масками цветов не подтверждены игровым эталоном");
  }
}

function readScalar(operand, view) {
  if (operand.kind === "constant") return operand.constant;
  return view.read(operand.signal, { red: operand.red, green: operand.green });
}

function present(view, red, green) {
  return view.present({ red, green });
}

function rejectCancellation(view) {
  const green = new Map();
  for (const entry of present(view, false, true)) green.set(channelKey(entry.signal), entry.constant);
  for (const entry of present(view, true, false)) {
    const other = green.get(channelKey(entry.signal));
    if (other !== undefined && addInt32(entry.constant, other) === 0) {
      unsupported("Отмена канала при Each на обоих цветах не подтверждена игровым эталоном");
    }
  }
}

function evaluateEach(name, left, right, output, view) {
  const leftEach = left.kind === "each";
  const eachOperand = leftEach ? left : right;
  const other = leftEach ? right : left;
  if (eachOperand.red && eachOperand.green) rejectCancellation(view);
  const otherValue = readScalar(other, view);
  const produced = [];
  for (const entry of present(view, eachOperand.red, eachOperand.green)) {
    const value = leftEach
      ? OPERATIONS.get(name)(entry.constant, otherValue)
      : OPERATIONS.get(name)(otherValue, entry.constant);
    if (value !== 0) produced.push({ signal: entry.signal, constant: value });
  }
  if (output.kind === "each") return { signals: produced };
  let sum = 0;
  for (const entry of produced) sum = addInt32(sum, entry.constant);
  if (sum === 0) return { signals: [] };
  return { signals: [{ signal: output.signal, constant: sum }] };
}

function operandSignal(operand) {
  if (!operand || operand.kind === "constant") return null;
  return operand.signal;
}

export class Arithmetic {
  static Operation = Object.freeze(Object.fromEntries(
    [...OPERATIONS.keys()].map((name) => [name, new OperationToken("arithmetic", name)]),
  ));

  #left;
  #right;
  #output;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-arithmetic-config", "Arithmetic принимает объект настроек");
    }
    for (const key of Object.keys(config)) {
      if (key === "sections" || key === "group" || key === "multiplier") {
        fail("unsupported-setting", `Настройка ${key} в этом контуре не поддерживается`);
      }
      if (!ALLOWED.has(key)) fail("invalid-arithmetic-config", `Неизвестный параметр ${key}`);
    }
    if (!Object.hasOwn(config, "left_operand") || !Object.hasOwn(config, "right_operand")) {
      fail("missing-operand", "Нужны left_operand и right_operand");
    }
    if (!Object.hasOwn(config, "operation")) {
      fail("missing-operation", "Операция обязательна и не выбирается по умолчанию");
    }
    const left = readOperand(config.left_operand, "left_operand");
    const right = readOperand(config.right_operand, "right_operand");
    const name = readOperation(config.operation);
    const output = readReturn(config);
    assertEach(left, right, output);
    for (const key of PORTS) this[key] = readWire(config[key], Object.hasOwn(config, key));
    this.#left = left;
    this.#right = right;
    this.#output = output;
    this.compute = (view) => {
      if (left === null || right === null || output === null) return { signals: [] };
      if (left.kind === "each" || right.kind === "each") return evaluateEach(name, left, right, output, view);
      const value = OPERATIONS.get(name)(readScalar(left, view), readScalar(right, view));
      if (value === 0) return { signals: [] };
      return { signals: [{ signal: output.signal, constant: value }] };
    };
  }

  validateProfile(profileName) {
    for (const signal of [operandSignal(this.#left), operandSignal(this.#right), operandSignal(this.#output)]) {
      if (signal && signal.profile !== profileName) {
        fail(
          "wrong-profile",
          `Сигнал профиля ${signal.profile} нельзя использовать в профиле ${profileName}`,
        );
      }
    }
  }
}
