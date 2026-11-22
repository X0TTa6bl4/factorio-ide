/** Таблица каналов: ключ — тройка type/name/quality, нули не хранятся. */

import { compareText } from "./compare.js";
import { ConfigError } from "./errors.js";
import { addInt32, isInt32 } from "./int32.js";
import { assertChannel, channelKey } from "./signal-token.js";

function assertMask(mask) {
  if (!mask || typeof mask !== "object" || Array.isArray(mask)) {
    throw new ConfigError("invalid-mask", "Маска цветов должна быть объектом {red, green}");
  }
  const keys = Object.keys(mask);
  if (keys.length !== 2 || !Object.hasOwn(mask, "red") || !Object.hasOwn(mask, "green")) {
    throw new ConfigError("invalid-mask", "Маска должна содержать только red и green");
  }
  if (typeof mask.red !== "boolean" || typeof mask.green !== "boolean") {
    throw new ConfigError("invalid-mask", "red и green маски должны быть boolean");
  }
}

export function createTable() {
  return new Map();
}

export function addToTable(table, token, constant) {
  assertChannel(token);
  if (!isInt32(constant)) {
    throw new ConfigError("invalid-constant", "Количество должно быть целым int32");
  }
  const key = channelKey(token);
  const current = table.get(key);
  const next = addInt32(current ? current.value : 0, constant);
  if (next === 0) {
    table.delete(key);
    return;
  }
  table.set(key, { token: current ? current.token : token, value: next });
}

export function readTable(table, token) {
  const found = table.get(channelKey(token));
  return found ? found.value : 0;
}

export function presentTable(table) {
  return [...table.values()]
    .map((entry) => ({ signal: entry.token, constant: entry.value }))
    .sort((left, right) => compareText(channelKey(left.signal), channelKey(right.signal)));
}

export function combineMasked(redTable, greenTable, mask) {
  assertMask(mask);
  const out = createTable();
  if (mask.red) {
    for (const entry of redTable.values()) addToTable(out, entry.token, entry.value);
  }
  if (mask.green) {
    for (const entry of greenTable.values()) addToTable(out, entry.token, entry.value);
  }
  return out;
}
