/** Хранилище: заданный список содержимого публикуется в выбранные сети. Слоты и логистика не считаются. */

import { ConfigError } from "./errors.js";
import { readSignalCount } from "./signal-count.js";
import {
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "./signal-token.js";

const OUTPUTS = ["red_output", "green_output"];
const ALLOWED = new Set(["enabled", "mode", "contents", ...OUTPUTS]);
const UNSUPPORTED_MODES = new Set(["empty-slots", "requests", "enable", "pipeline", "temperature"]);

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

function readEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    fail("invalid-signal-count", "SignalCount должен быть объектом");
  }
  const profile = isSignalToken(entry.signal) ? entry.signal.profile : "base";
  const read = readSignalCount(entry, profile);
  return Object.freeze({ signal: read.signal, constant: read.constant });
}

function readMode(value) {
  if (typeof value !== "string") fail("invalid-mode", "mode должен быть строкой");
  if (UNSUPPORTED_MODES.has(value)) {
    fail("unsupported-case", `Режим хранилища ${value} не поддержан без игрового fixture`);
  }
  if (value !== "read") fail("invalid-mode", "Поддержан только режим read");
  return value;
}

export class Storage {
  #contents;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-storage-config", "Storage принимает объект настроек");
    }
    for (const key of Object.keys(config)) {
      if (key === "red_input" || key === "green_input") {
        fail("forbidden-input", "Хранилище в режиме read не имеет входов");
      }
      if (!ALLOWED.has(key)) fail("invalid-storage-config", `Неизвестный параметр ${key}`);
    }
    if (!Object.hasOwn(config, "enabled") || typeof config.enabled !== "boolean") {
      fail("invalid-enabled", "enabled должен быть boolean");
    }
    if (!Object.hasOwn(config, "mode")) fail("invalid-mode", "mode должен быть строкой");
    readMode(config.mode);
    if (!Array.isArray(config.contents)) fail("invalid-contents", "contents должен быть массивом");
    const contents = Object.freeze(config.contents.map(readEntry));
    this.enabled = config.enabled;
    this.mode = "read";
    this.#contents = contents;
    for (const key of OUTPUTS) this[key] = readWire(config[key], Object.hasOwn(config, key));
  }

  get contents() {
    return this.#contents;
  }

  contribution(profileName) {
    if (typeof this.enabled !== "boolean") {
      fail("invalid-enabled", "enabled должен быть boolean");
    }
    const counts = [];
    for (const entry of this.#contents) {
      if (entry.signal.profile !== profileName) {
        fail("wrong-profile", `Сигнал профиля ${entry.signal.profile} нельзя использовать в профиле ${profileName}`);
      }
      if (this.enabled) counts.push({ signal: entry.signal, constant: entry.constant });
    }
    return counts;
  }
}
