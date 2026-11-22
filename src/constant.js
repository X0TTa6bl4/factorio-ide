/** Constant: signals либо секции, фильтры и общие группы. Множитель кроме 1 отклоняется. */

import { ConfigError } from "./errors.js";
import { isInt32 } from "./int32.js";
import { readSignalCount } from "./signal-count.js";
import {
  assertChannel,
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "./signal-token.js";

const OUTPUTS = ["red_output", "green_output"];
const ALLOWED = new Set(["enabled", "signals", "sections", ...OUTPUTS]);
const SECTION_KEYS = new Set(["active", "filters", "group", "multiplier"]);

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

function readFilter(filter) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    fail("invalid-filter", "Фильтр должен быть объектом");
  }
  const keys = Object.keys(filter);
  if (keys.length !== 3 || !Object.hasOwn(filter, "signal") || !Object.hasOwn(filter, "min") || !Object.hasOwn(filter, "max")) {
    fail("invalid-filter", "Фильтр содержит signal, min и max");
  }
  const signal = assertChannel(filter.signal);
  if (!isInt32(filter.min) || (filter.max !== null && !isInt32(filter.max))) {
    fail("invalid-constant", "min и max должны быть целым int32, max может быть null");
  }
  return Object.freeze({ signal, min: filter.min, max: filter.max });
}

function readFilters(filters) {
  if (!Array.isArray(filters)) fail("invalid-filters", "filters должен быть массивом");
  return Object.freeze(filters.map(readFilter));
}

function readMultiplier(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("invalid-multiplier", "multiplier должен быть конечным числом");
  }
  if (value !== 1) {
    fail("unsupported-case", "Множитель кроме 1 не поддержан без игрового fixture");
  }
}

class Group {
  #name;
  #filters;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-group", "Group принимает объект настроек");
    }
    const keys = Object.keys(config);
    if (keys.length !== 2 || !Object.hasOwn(config, "name") || !Object.hasOwn(config, "filters")) {
      fail("invalid-group", "Group содержит name и filters");
    }
    if (typeof config.name !== "string" || config.name.length === 0) {
      fail("invalid-group-name", "Имя группы должно быть непустой строкой");
    }
    const filters = readFilters(config.filters);
    this.#name = config.name;
    this.#filters = filters;
  }

  get name() {
    return this.#name;
  }

  get filters() {
    return this.#filters;
  }

  replaceFilters(filters) {
    const next = readFilters(filters);
    this.#filters = next;
  }
}

function readGroupRef(value) {
  if (value === null) return null;
  if (typeof value === "string") {
    fail("unsupported-case", "Идентичность группы по имени не поддержана без игрового fixture");
  }
  if (!(value instanceof Group)) fail("invalid-group", "group должен быть Constant.Group или null");
  return value;
}

function readSection(section) {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    fail("invalid-section", "Секция должна быть объектом");
  }
  for (const key of Object.keys(section)) {
    if (!SECTION_KEYS.has(key)) fail("invalid-section", `Неизвестное поле секции ${key}`);
  }
  if (!Object.hasOwn(section, "active") || typeof section.active !== "boolean") {
    fail("invalid-section", "active секции должен быть boolean");
  }
  if (!Object.hasOwn(section, "multiplier")) fail("invalid-multiplier", "У секции нужен multiplier");
  readMultiplier(section.multiplier);
  if (!Object.hasOwn(section, "group")) fail("invalid-section", "У секции нужно поле group");
  const group = readGroupRef(section.group);
  const hasFilters = Object.hasOwn(section, "filters");
  if (group && hasFilters) fail("mixed-source", "Секция с группой не содержит filters");
  if (!group && !hasFilters) fail("invalid-section", "Секция без группы содержит filters");
  return Object.freeze({
    active: section.active,
    multiplier: 1,
    group,
    filters: group ? null : readFilters(section.filters),
  });
}

function readSource(config) {
  const hasSignals = Object.hasOwn(config, "signals");
  const hasSections = Object.hasOwn(config, "sections");
  if (hasSignals && hasSections) fail("mixed-source", "Нужен один из списков signals или sections");
  if (!hasSignals && !hasSections) fail("invalid-source", "Нужен массив signals или sections");
  if (hasSignals) {
    if (!Array.isArray(config.signals)) fail("invalid-signals", "signals должен быть массивом");
    const signals = Object.freeze(config.signals.map(readEntry));
    const filters = Object.freeze(signals.map((entry) => Object.freeze({
      signal: entry.signal,
      min: entry.constant,
      max: null,
    })));
    return {
      signals,
      sections: Object.freeze([Object.freeze({
        active: true,
        multiplier: 1,
        group: null,
        filters,
      })]),
    };
  }
  if (!Array.isArray(config.sections)) fail("invalid-sections", "sections должен быть массивом");
  return { signals: null, sections: Object.freeze(config.sections.map(readSection)) };
}

export class Constant {
  static Group = Group;

  #sections;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-constant-config", "Constant принимает объект настроек");
    }
    for (const key of Object.keys(config)) {
      if (key === "red_input" || key === "green_input") {
        fail("forbidden-input", "Источник Constant не имеет входов");
      }
      if (!ALLOWED.has(key)) fail("invalid-constant-config", `Неизвестный параметр ${key}`);
    }
    if (!Object.hasOwn(config, "enabled") || typeof config.enabled !== "boolean") {
      fail("invalid-enabled", "enabled должен быть boolean");
    }
    const source = readSource(config);
    const ports = OUTPUTS.map((key) => [key, readWire(config[key], Object.hasOwn(config, key))]);
    this.enabled = config.enabled;
    this.#sections = source.sections;
    if (source.signals) this.signals = source.signals;
    for (const [key, value] of ports) this[key] = value;
  }

  get sections() {
    return this.#sections;
  }

  contribution(profileName) {
    if (typeof this.enabled !== "boolean") {
      fail("invalid-enabled", "enabled должен быть boolean");
    }
    const counts = [];
    for (const section of this.#sections) {
      const filters = section.group ? section.group.filters : section.filters;
      for (const filter of filters) {
        if (filter.signal.profile !== profileName) {
          fail(
            "wrong-profile",
            `Сигнал профиля ${filter.signal.profile} нельзя использовать в профиле ${profileName}`,
          );
        }
        if (this.enabled && section.active) {
          counts.push({ signal: filter.signal, constant: filter.min });
        }
      }
    }
    return counts;
  }
}
