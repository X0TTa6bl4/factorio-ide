/** Профили base и space-age: дерево констант и импорт проверенного ключа. */

import { ConfigError } from "./errors.js";
import basePaths from "../data/signal-catalog/2.1.24/base-paths.json" with { type: "json" };
import baseQualities from "../data/signal-catalog/2.1.24/base-qualities.json" with { type: "json" };
import spacePaths from "../data/signal-catalog/2.1.24/space-age-paths.json" with { type: "json" };
import spaceQualities from "../data/signal-catalog/2.1.24/space-age-qualities.json" with { type: "json" };
import { mintQuality, mintSignalToken } from "./signal-token.js";
import { assembleSignals } from "./signal-tree.js";

const QUALITY_NAMES = ["normal", "uncommon", "rare", "epic", "legendary"];
const QUALITY_KEYS = {
  normal: "NORMAL",
  uncommon: "UNCOMMON",
  rare: "RARE",
  epic: "EPIC",
  legendary: "LEGENDARY",
};

function allowedQualityNames(document) {
  const names = new Set(["normal"]);
  for (const entry of document.entries) {
    if (entry.role === "ordinary") names.add(entry.gameName);
  }
  return names;
}

export function buildQualityTokens(document) {
  if (!document || !Array.isArray(document.entries)) {
    throw new ConfigError("invalid-catalog", "В каталоге нет списка качеств");
  }
  const levels = new Map();
  for (const entry of document.entries) {
    if (entry.role !== "ordinary" && entry.gameName !== "normal") continue;
    const level = entry.level && entry.level.value;
    if (!Number.isInteger(level)) {
      throw new ConfigError("invalid-catalog", `Нет уровня качества ${entry.gameName}`);
    }
    levels.set(entry.gameName, level);
  }
  const tokens = {};
  for (const name of QUALITY_NAMES) {
    if (!levels.has(name)) {
      throw new ConfigError("invalid-catalog", `Нет уровня качества ${name}`);
    }
    tokens[QUALITY_KEYS[name]] = mintQuality({ name, level: levels.get(name) });
  }
  return Object.freeze(tokens);
}

export class SignalProfile {
  #index;
  #special;
  #allowed;

  constructor(name, gameVersion, tree, index, special, allowed) {
    this.name = name;
    this.gameVersion = gameVersion;
    this.tree = tree;
    this.#index = index;
    this.#special = special;
    this.#allowed = allowed;
    Object.freeze(this);
  }

  importSignal(key) {
    if (!key || typeof key !== "object" || Array.isArray(key)) {
      throw new ConfigError("invalid-signal", "Ключ сигнала должен быть объектом");
    }
    for (const field of Object.keys(key)) {
      if (field !== "type" && field !== "name" && field !== "quality") {
        throw new ConfigError("invalid-signal", `Лишнее поле ключа ${field}`);
      }
    }
    if (typeof key.type !== "string" || key.type === "" || typeof key.name !== "string" || key.name === "") {
      throw new ConfigError("invalid-signal", "type и name должны быть непустыми строками");
    }
    const quality = Object.hasOwn(key, "quality") ? key.quality : "normal";
    if (typeof quality !== "string" || quality === "") {
      throw new ConfigError("invalid-quality", "quality должна быть непустой строкой");
    }
    if (!this.#allowed.has(quality)) {
      throw new ConfigError("unavailable-quality", `Качество ${quality} недоступно в профиле ${this.name}`);
    }
    const identity = `${key.type}/${key.name}`;
    const special = this.#special.get(identity);
    if (special === "meta") {
      throw new ConfigError("meta-signal", "Метасигнал не является каналом");
    }
    if (special === "quality-selector") {
      throw new ConfigError("invalid-signal", "Селектор качества не является каналом");
    }
    const spec = this.#index.get(identity);
    if (!spec) {
      throw new ConfigError("unknown-signal", `В профиле ${this.name} нет сигнала ${identity}`);
    }
    return mintSignalToken({
      ...spec,
      quality,
      jsName: null,
      source: "import",
      derived: false,
    });
  }
}

export function createProfile(name, pathsDocument, qualitiesDocument) {
  if (typeof name !== "string" || name === "") {
    throw new ConfigError("invalid-profile", "Имя профиля должно быть непустой строкой");
  }
  if (!pathsDocument || typeof pathsDocument !== "object" || typeof pathsDocument.gameVersion !== "string") {
    throw new ConfigError("invalid-catalog", "В каталоге нет gameVersion");
  }
  if (!pathsDocument.paths || typeof pathsDocument.paths !== "object" || Array.isArray(pathsDocument.paths)) {
    throw new ConfigError("invalid-catalog", "В каталоге нет индекса путей");
  }
  if (!qualitiesDocument || !Array.isArray(qualitiesDocument.entries)) {
    throw new ConfigError("invalid-catalog", "В каталоге нет качеств");
  }
  const allowed = allowedQualityNames(qualitiesDocument);
  const assembled = assembleSignals(name, pathsDocument.paths, allowed);
  return new SignalProfile(
    name,
    pathsDocument.gameVersion,
    assembled.tree,
    assembled.index,
    assembled.special,
    allowed,
  );
}

function loadProfiles() {
  return {
    base: createProfile("base", basePaths, baseQualities),
    "space-age": createProfile("space-age", spacePaths, spaceQualities),
  };
}

const PROFILES = loadProfiles();

export function openProfile(name) {
  if (!Object.hasOwn(PROFILES, name)) {
    throw new ConfigError("invalid-profile", "Профиль должен быть base или space-age");
  }
  return PROFILES[name];
}

export const Quality = buildQualityTokens(spaceQualities);
export const Signal = openProfile("base").tree;
