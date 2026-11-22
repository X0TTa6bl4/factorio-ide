/** Выбирающий комбинатор: девять режимов. Спорные ветви диагностируются, а не подменяются догадкой. */

import { compareText } from "./compare.js";
import { ConfigError, RuntimeError } from "./errors.js";
import { itemFacts } from "./item-facts.js";
import { addInt32, INT32_MAX, isInt32 } from "./int32.js";
import { xorshift32 } from "./rng.js";
import { Quality } from "./signal-profile.js";
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
const BOTH = Object.freeze({ red: true, green: true });
const ROCKET_LIFT = 1000000;
const OPERATIONS = [
  ["SELECT", "select"],
  ["COUNT", "count"],
  ["RANDOM", "random"],
  ["STACK_SIZE", "stack-size"],
  ["ROCKET_CAPACITY", "rocket-capacity"],
  ["QUALITY_FILTER", "quality-filter"],
  ["QUALITY_TRANSFER", "quality-transfer"],
  ["QUALITY_SELECT", "quality-select"],
  ["TIME", "time"],
];
const FIELDS = {
  select: ["sort", "index", "compare"],
  count: ["signal"],
  random: ["interval"],
  "stack-size": [],
  "rocket-capacity": [],
  "quality-filter": ["quality", "compare"],
  "quality-transfer": ["source", "destination"],
  "quality-select": ["highest"],
  time: ["game_tick", "day_tick", "day_length"],
};
const QUALITY_MODES = new Set(["quality-filter", "quality-transfer", "quality-select"]);
const COMPARISONS = new Map([
  ["EQ", (left, right) => left === right],
  ["GT", (left, right) => left > right],
  ["LT", (left, right) => left < right],
  ["GTE", (left, right) => left >= right],
  ["LTE", (left, right) => left <= right],
  ["NEQ", (left, right) => left !== right],
]);
const QUALITY_BY_NAME = new Map(Object.values(Quality).map((token) => [token.name, token]));

function fail(code, message) {
  throw new ConfigError(code, message);
}

function unsupported(message) {
  throw new RuntimeError("unsupported-case", message);
}

function readWire(value, present) {
  if (!present || value === null) return null;
  if (typeof value === "string") fail("invalid-port", "Требуется ссылка на сеть или null, получена строка");
  if (isOperationToken(value)) fail("invalid-port", "Операция не является сетью");
  if (isSignalToken(value) || isMetaToken(value) || isQualityToken(value) || isQualitySelectorToken(value)) {
    fail("invalid-port", "Сигнал не является сетью");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-port", "Требуется ссылка на сеть или null");
  }
  return value;
}

function readOperation(value) {
  if (!isOperationToken(value)) fail("invalid-operation", "Нужна константа Selector.Operation");
  if (value.owner !== "selector") fail("foreign-operation", "Операция принадлежит другому комбинатору");
  if (!Object.hasOwn(FIELDS, value.name)) fail("unsupported-operation", `Режим ${value.name} не поддержан`);
  return value.name;
}

function readSort(value) {
  if (!isOperationToken(value)) fail("invalid-sort", "Нужна константа Selector.Sort");
  if (value.owner !== "selector") fail("foreign-operation", "Порядок принадлежит другому комбинатору");
  if (value.name !== "DESC" && value.name !== "ASC") {
    fail("invalid-sort", "Порядок должен быть DESC или ASC");
  }
  return value.name;
}

function readCompare(value) {
  if (!isOperationToken(value)) fail("invalid-compare", "Нужна константа Selector.Compare");
  if (value.owner !== "selector") fail("foreign-operation", "Сравнение принадлежит другому комбинатору");
  if (!COMPARISONS.has(value.name)) fail("invalid-compare", "Сравнение не поддержано");
  return value.name;
}

function readIndex(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-index", "Индекс задаётся constant или signal");
  }
  const keys = Object.keys(value);
  if (Object.hasOwn(value, "constant")) {
    if (keys.length !== 1) fail("invalid-index", "Числовой индекс содержит только constant");
    if (!isInt32(value.constant)) fail("invalid-constant", "Индекс должен быть целым int32");
    return { kind: "constant", constant: value.constant };
  }
  if (keys.length !== 1 || !Object.hasOwn(value, "signal")) {
    fail("invalid-index", "Индекс задаётся constant или signal");
  }
  return { kind: "signal", signal: assertChannel(value.signal) };
}

function readInterval(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4294967295) {
    fail("invalid-interval", "Интервал random должен быть целым uint32");
  }
  if (value === 0) {
    fail("unsupported-case", "Интервал 0 расходится у Wiki и API и не нормализуется без эталона");
  }
  return value;
}

function readGrade(value) {
  if (isQualitySelectorToken(value)) return { kind: "any", token: value };
  if (isQualityToken(value)) return { kind: "grade", token: value };
  fail("invalid-quality", "Фильтр качества принимает Quality или указатель любого качества");
}

function readSource(value) {
  if (isQualityToken(value)) return { kind: "static", quality: value };
  if (isSignalToken(value)) return { kind: "signal", signal: value };
  fail("invalid-source", "Источник качества — модификатор Quality или сигнал");
}

function readChannel(value) {
  if (value === null) return null;
  return assertChannel(value);
}

function assertFields(config, mode) {
  const allowed = new Set([...PORTS, "operation", ...FIELDS[mode]]);
  for (const key of Object.keys(config)) {
    if (key === "sections" || key === "group" || key === "multiplier") {
      fail("unsupported-setting", `Настройка ${key} в этом контуре не поддерживается`);
    }
    if (!allowed.has(key)) fail("invalid-selector-config", `Неизвестный параметр ${key}`);
  }
}

function requireField(config, key, code, message) {
  if (!Object.hasOwn(config, key)) fail(code, message);
}

function present(view) {
  return view.present(BOTH);
}

function sameItem(entry, signal) {
  return entry.signal.type === signal.type && entry.signal.name === signal.name;
}

function sum(entries) {
  let total = 0;
  for (const entry of entries) total = addInt32(total, entry.constant);
  return total;
}

function qualityToken(name) {
  const token = QUALITY_BY_NAME.get(name);
  if (!token) unsupported("Уровень качества не входит в снимок 2.1.24");
  return token;
}

function evaluateSelect(spec, view) {
  const entries = present(view);
  if (entries.length === 0) return [];
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.constant)) {
      unsupported("Порядок равных значений select не подтверждён игровым эталоном");
    }
    seen.add(entry.constant);
  }
  const index = spec.index.kind === "constant"
    ? spec.index.constant
    : view.read(spec.index.signal, BOTH);
  const sorted = [...entries].sort((left, right) => (
    spec.sort === "DESC" ? right.constant - left.constant : left.constant - right.constant
  ));
  if (sorted.length === 1 && index !== 0) return [sorted[0]];
  const compare = COMPARISONS.get(spec.compare);
  return sorted.filter((_, rank) => compare(rank, index));
}

function evaluateCount(spec, view) {
  const count = present(view).length;
  if (count === 0) return [];
  return [{ signal: spec.signal, constant: count }];
}

function identity(signal) {
  return { type: signal.type, name: signal.name, quality: signal.quality };
}

function pick(entries, rng) {
  const sorted = [...entries].sort((left, right) => compareText(channelKey(left.signal), channelKey(right.signal)));
  const next = xorshift32(rng);
  return { rng: next, entry: sorted[next % sorted.length] };
}

function findHeld(entries, held) {
  const key = JSON.stringify([held.type, held.name, held.quality]);
  return entries.find((entry) => channelKey(entry.signal) === key) ?? null;
}

function evaluateRandom(interval, view) {
  const memory = view.random;
  const entries = present(view);
  if (memory.held) {
    const held = findHeld(entries, memory.held);
    if (!held) unsupported("Исчезновение выбранного случайного сигнала не подтверждено игровым эталоном");
    const elapsed = memory.elapsed + 1;
    if (elapsed >= interval) {
      const chosen = pick(entries, memory.rng);
      return {
        signals: [chosen.entry],
        random: { rng: chosen.rng, held: identity(chosen.entry.signal), elapsed: 0 },
      };
    }
    return {
      signals: [held],
      random: { rng: memory.rng, held: memory.held, elapsed },
    };
  }
  if (entries.length === 0) {
    return { signals: [], random: { rng: memory.rng, held: null, elapsed: 0 } };
  }
  const elapsed = memory.elapsed + 1;
  if (elapsed < interval) {
    return { signals: [], random: { rng: memory.rng, held: null, elapsed } };
  }
  const chosen = pick(entries, memory.rng);
  return {
    signals: [chosen.entry],
    random: { rng: chosen.rng, held: identity(chosen.entry.signal), elapsed: 0 },
  };
}

function evaluateStack(view) {
  const produced = [];
  for (const entry of present(view)) {
    if (entry.signal.type !== "item") continue;
    const facts = itemFacts(view.profile, entry.signal.name);
    if (!facts) unsupported("Предмета нет в снимке 2.1.24");
    produced.push({ signal: entry.signal, constant: facts.stackSize });
  }
  return produced;
}

function rocketCount(weight) {
  if (!Number.isInteger(weight)) return null;
  const capacity = Math.floor(ROCKET_LIFT / weight);
  return capacity >= 1 ? capacity : 0;
}

function evaluateRocket(view) {
  const produced = [];
  for (const entry of present(view)) {
    if (entry.signal.type !== "item") continue;
    const facts = itemFacts(view.profile, entry.signal.name);
    if (!facts) unsupported("Предмета нет в снимке 2.1.24");
    if (facts.weight === null) {
      unsupported("Вес предмета не задан в снимке 2.1.24, вместимость ракеты не выдумывается");
    }
    const capacity = rocketCount(facts.weight);
    if (capacity === null) unsupported("Дробный вес не задаёт целую вместимость ракеты");
    if (capacity === 0) continue;
    produced.push({ signal: entry.signal, constant: capacity });
  }
  return produced;
}

function evaluateQualityFilter(spec, view) {
  const entries = present(view);
  if (spec.quality.kind === "any") return entries;
  const compare = COMPARISONS.get(spec.compare);
  const grade = spec.quality.token.level;
  return entries.filter((entry) => compare(qualityToken(entry.signal.quality).level, grade));
}

function evaluateQualityTransfer(spec, view) {
  const entries = present(view);
  const targets = entries.filter((entry) => sameItem(entry, spec.destination));
  if (targets.length === 0) return [];
  let grade = spec.source.kind === "static" ? spec.source.quality : null;
  if (spec.source.kind === "signal") {
    const sources = entries.filter((entry) => sameItem(entry, spec.source.signal));
    if (sources.length === 0) return [];
    const names = new Set(sources.map((entry) => entry.signal.quality));
    if (names.size !== 1) unsupported("Несколько качеств источника переноса не подтверждены игровым эталоном");
    grade = qualityToken(sources[0].signal.quality);
  }
  const total = sum(targets);
  if (total === 0) return [];
  return [{ signal: spec.destination.withQuality(grade), constant: total }];
}

function evaluateQualitySelect(spec, view) {
  const groups = new Map();
  for (const entry of present(view)) {
    const key = `${entry.signal.type}/${entry.signal.name}`;
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  const produced = [];
  for (const list of groups.values()) {
    let best = list[0];
    let tie = false;
    for (let index = 1; index < list.length; index += 1) {
      const entry = list[index];
      const bestLevel = qualityToken(best.signal.quality).level;
      const entryLevel = qualityToken(entry.signal.quality).level;
      if (entryLevel === bestLevel) tie = true;
      else if (spec.highest ? entryLevel > bestLevel : entryLevel < bestLevel) best = entry;
    }
    if (tie) unsupported("Одинаковые уровни качества не подтверждены игровым эталоном");
    produced.push(best);
  }
  return produced;
}

function evaluateTime(spec, view) {
  const game = BigInt(view.world.origin) + BigInt(view.tick);
  if (game > BigInt(INT32_MAX)) {
    unsupported("Переполнение игрового тика не подтверждено игровым эталоном");
  }
  const gameTick = Number(game);
  const channels = [
    [spec.gameTick, gameTick],
    [spec.dayTick, gameTick % view.world.dayLength],
    [spec.dayLength, view.world.dayLength],
  ];
  return channels
    .filter(([signal, constant]) => signal && constant !== 0)
    .map(([signal, constant]) => ({ signal, constant }));
}

function remember(list, value) {
  if (isSignalToken(value) || isQualitySelectorToken(value)) list.push(value);
}

export class Selector {
  static Operation = Object.freeze(Object.fromEntries(
    OPERATIONS.map(([key, name]) => [key, new OperationToken("selector", name)]),
  ));

  static Sort = Object.freeze({
    DESC: new OperationToken("selector", "DESC"),
    ASC: new OperationToken("selector", "ASC"),
  });

  static Compare = Object.freeze(Object.fromEntries(
    [...COMPARISONS.keys()].map((name) => [name, new OperationToken("selector", name)]),
  ));

  #mode;
  #signals;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-selector-config", "Selector принимает объект настроек");
    }
    if (!Object.hasOwn(config, "operation")) {
      fail("missing-operation", "Режим обязателен и не выбирается по умолчанию");
    }
    const mode = readOperation(config.operation);
    assertFields(config, mode);
    const spec = { mode };
    const signals = [];
    if (mode === "select") {
      requireField(config, "sort", "missing-sort", "Нужен порядок Selector.Sort");
      requireField(config, "index", "missing-index", "Нужен индекс");
      requireField(config, "compare", "missing-compare", "Нужно сравнение Selector.Compare");
      spec.sort = readSort(config.sort);
      spec.index = readIndex(config.index);
      spec.compare = readCompare(config.compare);
      if (spec.index.kind === "signal") signals.push(spec.index.signal);
    } else if (mode === "count") {
      requireField(config, "signal", "missing-signal", "Нужен выходной сигнал count");
      spec.signal = assertChannel(config.signal);
      signals.push(spec.signal);
    } else if (mode === "random") {
      requireField(config, "interval", "missing-interval", "Нужен интервал random");
      spec.interval = readInterval(config.interval);
    } else if (mode === "quality-filter") {
      requireField(config, "quality", "missing-quality", "Нужен фильтр качества");
      requireField(config, "compare", "missing-compare", "Нужно сравнение Selector.Compare");
      spec.quality = readGrade(config.quality);
      spec.compare = readCompare(config.compare);
      if (spec.quality.kind === "any" && spec.compare !== "EQ") {
        fail("invalid-compare", "Для любого качества допустимо только равенство");
      }
      remember(signals, spec.quality.token);
    } else if (mode === "quality-transfer") {
      requireField(config, "source", "missing-source", "Нужен источник качества");
      requireField(config, "destination", "missing-destination", "Нужен целевой сигнал");
      spec.source = readSource(config.source);
      spec.destination = assertChannel(config.destination);
      if (spec.source.kind === "signal") signals.push(spec.source.signal);
      signals.push(spec.destination);
    } else if (mode === "quality-select") {
      requireField(config, "highest", "missing-highest", "Нужен признак highest");
      if (typeof config.highest !== "boolean") fail("invalid-highest", "highest должен быть boolean");
      spec.highest = config.highest;
    } else if (mode === "time") {
      spec.gameTick = readChannel(Object.hasOwn(config, "game_tick") ? config.game_tick : null);
      spec.dayTick = readChannel(Object.hasOwn(config, "day_tick") ? config.day_tick : null);
      spec.dayLength = readChannel(Object.hasOwn(config, "day_length") ? config.day_length : null);
      const chosen = [spec.gameTick, spec.dayTick, spec.dayLength].filter(Boolean);
      if (chosen.length === 0) fail("missing-output", "Нужен хотя бы один канал time");
      const keys = chosen.map((signal) => channelKey(signal));
      if (new Set(keys).size !== keys.length) {
        fail("unsupported-case", "Один канал time для разных показаний не подтверждён игровым эталоном");
      }
      signals.push(...chosen);
    }
    for (const key of PORTS) this[key] = readWire(config[key], Object.hasOwn(config, key));
    this.#mode = mode;
    this.#signals = signals;
    this.compute = (view) => {
      if (mode === "select") return { signals: evaluateSelect(spec, view) };
      if (mode === "count") return { signals: evaluateCount(spec, view) };
      if (mode === "random") return evaluateRandom(spec.interval, view);
      if (mode === "stack-size") return { signals: evaluateStack(view) };
      if (mode === "rocket-capacity") return { signals: evaluateRocket(view) };
      if (mode === "quality-filter") return { signals: evaluateQualityFilter(spec, view) };
      if (mode === "quality-transfer") return { signals: evaluateQualityTransfer(spec, view) };
      if (mode === "quality-select") return { signals: evaluateQualitySelect(spec, view) };
      return { signals: evaluateTime(spec, view) };
    };
  }

  usesRandom() {
    return this.#mode === "random";
  }

  usesClock() {
    return this.#mode === "time";
  }

  validateProfile(profileName) {
    if (QUALITY_MODES.has(this.#mode) && profileName !== "space-age") {
      fail("unavailable-mode", `Режим ${this.#mode} доступен в профиле space-age`);
    }
    for (const signal of this.#signals) {
      if (signal.profile !== profileName) {
        fail("wrong-profile", `Сигнал профиля ${signal.profile} нельзя использовать в профиле ${profileName}`);
      }
    }
  }

  validateWorld(world) {
    if (this.#mode === "time" && world === null) {
      fail("missing-world", "Режим time требует контекст мира Circuit");
    }
  }
}
