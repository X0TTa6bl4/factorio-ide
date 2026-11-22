/** Упрощённые станция и поезд: присутствие, отправление и переход по стабильным ID. */

import { compareText } from "./compare.js";
import { ConfigError, RuntimeError } from "./errors.js";
import { isInt32 } from "./int32.js";
import {
  assertChannel,
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "./signal-token.js";

const STATION_PORTS = ["red_input", "green_input", "red_output", "green_output"];
const TRAIN_PORTS = ["red_input", "green_input", "red_output", "green_output"];
const STATION_FIELDS = new Set([...STATION_PORTS, "depart"]);
const TRAIN_FIELDS = new Set(["route", "transit", "at"]);
const UNSUPPORTED_STATION = new Set([
  "send_to_train",
  "read_from_train",
  "read_stopped_train",
  "set_trains_limit",
  "read_trains_count",
  "stopped_train_signal",
  "trains_count_signal",
  "trains_limit_signal",
  "set_priority",
  "priority_signal",
  "circuit_enable_disable",
  "circuit_condition",
  "connect_to_logistic_network",
  "logistic_condition",
]);
const STATION_STATE_KEYS = ["present", "trainId"];
const TRAIN_STATE_KEYS = [
  "fromId",
  "fromIndex",
  "index",
  "phase",
  "remaining",
  "route",
  "stationId",
  "transit",
];
const DEVICE_ID = /^d[1-9][0-9]*$/;

function fail(code, message) {
  throw new ConfigError(code, message);
}

function runtimeFail(code, message) {
  throw new RuntimeError(code, message);
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

function sameList(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function cloneState(state) {
  return {
    phase: state.phase,
    index: state.index,
    remaining: state.remaining,
    fromIndex: state.fromIndex,
    stationId: state.stationId,
    fromId: state.fromId,
    route: state.route.slice(),
    transit: state.transit,
  };
}

export function initialTrainState(route, at, transit) {
  return {
    phase: "at",
    index: at,
    remaining: 0,
    fromIndex: null,
    stationId: route[at],
    fromId: null,
    route: route.slice(),
    transit,
  };
}

export function readStationState(value, code) {
  const reject = (message) => runtimeFail(code, message);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("Состояние станции должно быть объектом");
  }
  const keys = Object.keys(value);
  if (keys.length !== STATION_STATE_KEYS.length || STATION_STATE_KEYS.some((key) => !Object.hasOwn(value, key))) {
    reject("Состояние станции содержит present и trainId");
  }
  if (typeof value.present !== "boolean") reject("present станции должен быть boolean");
  if (value.present) {
    if (typeof value.trainId !== "string" || !DEVICE_ID.test(value.trainId)) {
      reject("trainId присутствующей станции должен быть ID поезда");
    }
  } else if (value.trainId !== null) {
    reject("У пустой станции trainId равен null");
  }
  return { present: value.present, trainId: value.trainId };
}

export function readTrainState(value, description, code) {
  const reject = (message) => runtimeFail(code, message);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("Состояние поезда должно быть объектом");
  }
  const keys = Object.keys(value);
  if (keys.length !== TRAIN_STATE_KEYS.length || TRAIN_STATE_KEYS.some((key) => !Object.hasOwn(value, key))) {
    reject("Состояние поезда содержит неверный набор полей");
  }
  if (!Array.isArray(value.route) || !sameList(value.route, description.route)) {
    reject("Маршрут в снимке не совпадает с описанием поезда");
  }
  if (value.transit !== description.transit) reject("Длительность перехода не совпадает с описанием поезда");
  if (!Number.isInteger(value.index) || value.index < 0 || value.index >= value.route.length) {
    reject("Индекс поезда вне маршрута");
  }
  if (value.stationId !== value.route[value.index]) reject("stationId поезда не совпадает с индексом маршрута");
  if (value.phase === "at") {
    if (value.remaining !== 0 || value.fromIndex !== null || value.fromId !== null) {
      reject("Поезд на станции не хранит незавершённый переход");
    }
  } else if (value.phase === "transit") {
    if (!Number.isInteger(value.remaining) || value.remaining < 1 || value.remaining > value.transit) {
      reject("Оставшийся переход должен быть целым от 1 до transit");
    }
    if (!Number.isInteger(value.fromIndex) || value.fromIndex < 0 || value.fromIndex >= value.route.length) {
      reject("fromIndex перехода вне маршрута");
    }
    if (value.fromId !== value.route[value.fromIndex]) reject("fromId перехода не совпадает с маршрутом");
  } else {
    reject("Фаза поезда должна быть at или transit");
  }
  return cloneState(value);
}

function stepTrain(state, stationIds, departCounts) {
  if (!Array.isArray(state.route) || state.route.length === 0) {
    runtimeFail("invalid-state", "Маршрут поезда пуст");
  }
  if (!stationIds.has(state.stationId)) {
    runtimeFail("missing-station", `Станция ${state.stationId} отсутствует`);
  }
  if (state.phase === "at") {
    const depart = departCounts.get(state.stationId) ?? 0;
    if (depart > 0) {
      const index = (state.index + 1) % state.route.length;
      const stationId = state.route[index];
      if (!stationIds.has(stationId)) runtimeFail("missing-station", `Станция ${stationId} отсутствует`);
      return {
        phase: "transit",
        index,
        remaining: state.transit,
        fromIndex: state.index,
        stationId,
        fromId: state.stationId,
        route: state.route.slice(),
        transit: state.transit,
      };
    }
    return cloneState(state);
  }
  if (state.phase !== "transit") runtimeFail("invalid-state", "Фаза поезда неизвестна");
  if (!Number.isInteger(state.remaining) || state.remaining < 1) {
    runtimeFail("invalid-state", "Переход с remaining вне 1..transit");
  }
  if (state.remaining > 1) {
    const next = cloneState(state);
    next.remaining -= 1;
    return next;
  }
  return {
    phase: "at",
    index: state.index,
    remaining: 0,
    fromIndex: null,
    stationId: state.stationId,
    fromId: null,
    route: state.route.slice(),
    transit: state.transit,
  };
}

export function advanceTrains({ phase, trains, stations, departCounts }) {
  const stationIds = new Set(stations.map((station) => station.id));
  const nextTrains = new Map();
  for (const train of trains) {
    const state = phase === "init" ? cloneState(train.state) : stepTrain(train.state, stationIds, departCounts);
    if (state.phase === "at" && !stationIds.has(state.stationId)) {
      runtimeFail("missing-station", `Станция ${state.stationId} отсутствует`);
    }
    nextTrains.set(train.id, state);
  }
  const occupants = new Map();
  for (const [id, state] of nextTrains) {
    if (state.phase !== "at") continue;
    const list = occupants.get(state.stationId) ?? [];
    list.push(id);
    occupants.set(state.stationId, list);
  }
  for (const [stationId, list] of occupants) {
    if (list.length > 1) {
      const names = list.slice().sort(compareText);
      runtimeFail("station-conflict", `Станция ${stationId} не выбирает поезд: ${names.join(", ")}`);
    }
  }
  const published = new Map();
  for (const station of stations) {
    const list = occupants.get(station.id) ?? [];
    const trainId = list[0] ?? null;
    published.set(station.id, {
      present: trainId !== null,
      state: { present: trainId !== null, trainId },
    });
  }
  return { trains: nextTrains, stations: published };
}

export class Station {
  #depart;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-station-config", "Station принимает объект настроек");
    }
    for (const key of Object.keys(config)) {
      if (UNSUPPORTED_STATION.has(key)) {
        fail("unsupported-case", `Настройка ${key} станции не поддержана без игрового fixture`);
      }
      if (!STATION_FIELDS.has(key)) fail("invalid-station-config", `Неизвестный параметр ${key}`);
    }
    if (!Object.hasOwn(config, "depart")) fail("invalid-depart", "У станции нужен сигнал depart");
    this.#depart = assertChannel(config.depart);
    for (const key of STATION_PORTS) this[key] = readWire(config[key], Object.hasOwn(config, key));
  }

  get depart() {
    return this.#depart;
  }

  validateProfile(profileName) {
    if (this.#depart.profile !== profileName) {
      fail("wrong-profile", `Сигнал профиля ${this.#depart.profile} нельзя использовать в профиле ${profileName}`);
    }
  }
}

export class Train {
  #route;
  #transit;
  #at;

  constructor(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      fail("invalid-train-config", "Train принимает объект настроек");
    }
    for (const key of Object.keys(config)) {
      if (TRAIN_PORTS.includes(key)) fail("forbidden-port", "Поезд не подключается к сетям");
      if (!TRAIN_FIELDS.has(key)) fail("invalid-train-config", `Неизвестный параметр ${key}`);
    }
    if (!Array.isArray(config.route) || config.route.length === 0) {
      fail("invalid-route", "Маршрут должен быть непустым массивом станций");
    }
    for (const station of config.route) {
      if (!(station instanceof Station)) fail("unknown-station", "Элемент маршрута должен быть станцией");
    }
    if (!isInt32(config.transit) || config.transit < 1) {
      fail("invalid-transit", "transit должен быть целым int32 от 1");
    }
    if (!Number.isInteger(config.at) || config.at < 0 || config.at >= config.route.length) {
      fail("invalid-index", "at должен быть индексом маршрута");
    }
    this.#route = Object.freeze(config.route.slice());
    this.#transit = config.transit;
    this.#at = config.at;
  }

  get route() {
    return this.#route;
  }

  get transit() {
    return this.#transit;
  }

  get at() {
    return this.#at;
  }
}
