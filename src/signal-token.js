/** Неизменяемые токены сигнала, метасигнала, качества и операции. */

import { ConfigError } from "./errors.js";

export class OperationToken {
  #owner;
  #name;

  constructor(owner, name) {
    if (typeof owner !== "string" || owner === "") {
      throw new ConfigError("invalid-operation", "У операции должен быть непустой владелец");
    }
    if (typeof name !== "string" || name === "") {
      throw new ConfigError("invalid-operation", "У операции должно быть непустое имя");
    }
    this.#owner = owner;
    this.#name = name;
    Object.freeze(this);
  }

  get kind() {
    return "operation";
  }

  get owner() {
    return this.#owner;
  }

  get name() {
    return this.#name;
  }
}

class QualityToken {
  #name;
  #level;

  constructor(name, level) {
    this.#name = name;
    this.#level = level;
    Object.freeze(this);
  }

  get kind() {
    return "quality";
  }

  get name() {
    return this.#name;
  }

  get level() {
    return this.#level;
  }
}

class QualitySelectorToken {
  #name;
  #profile;
  #metadata;

  constructor(spec) {
    this.#name = spec.name;
    this.#profile = spec.profile;
    this.#metadata = Object.freeze({
      publicPath: spec.publicPath,
      section: spec.section,
      group: spec.group,
      prototypeId: spec.prototypeId,
      role: spec.role,
      gameName: spec.gameName,
      jsName: spec.jsName,
    });
  }

  get kind() {
    return "quality-selector";
  }

  get name() {
    return this.#name;
  }

  get profile() {
    return this.#profile;
  }

  get metadata() {
    return this.#metadata;
  }
}

class MetaToken {
  #name;
  #profile;
  #metadata;

  constructor(spec) {
    this.#name = spec.name;
    this.#profile = spec.profile;
    this.#metadata = Object.freeze({
      publicPath: spec.publicPath,
      section: spec.section,
      group: spec.group,
      prototypeId: spec.prototypeId,
      role: spec.role,
      gameName: spec.gameName,
      jsName: spec.jsName,
    });
  }

  get kind() {
    return "meta";
  }

  get name() {
    return this.#name;
  }

  get profile() {
    return this.#profile;
  }

  get metadata() {
    return this.#metadata;
  }
}

class SignalToken {
  #type;
  #name;
  #quality;
  #profile;
  #allowed;
  #metadata;

  constructor(spec) {
    this.#type = spec.type;
    this.#name = spec.name;
    this.#quality = spec.quality;
    this.#profile = spec.profile;
    this.#allowed = spec.allowed;
    this.#metadata = Object.freeze({
      publicPath: spec.publicPath,
      section: spec.section,
      group: spec.group,
      prototypeId: spec.prototypeId,
      role: spec.role,
      jsName: spec.jsName,
      source: spec.source,
      derived: spec.derived,
    });
  }

  get kind() {
    return "signal";
  }

  get type() {
    return this.#type;
  }

  get name() {
    return this.#name;
  }

  get quality() {
    return this.#quality;
  }

  get profile() {
    return this.#profile;
  }

  get metadata() {
    return this.#metadata;
  }

  withQuality(quality) {
    if (!isQualityToken(quality)) {
      throw new ConfigError("invalid-quality", "withQuality принимает константу Quality");
    }
    if (!this.#allowed.has(quality.name)) {
      throw new ConfigError(
        "unavailable-quality",
        `Качество ${quality.name} недоступно в профиле ${this.#profile}`,
      );
    }
    return mintSignalToken({
      type: this.#type,
      name: this.#name,
      quality: quality.name,
      publicPath: this.#metadata.publicPath,
      section: this.#metadata.section,
      group: this.#metadata.group,
      prototypeId: this.#metadata.prototypeId,
      role: this.#metadata.role,
      jsName: this.#metadata.jsName,
      profile: this.#profile,
      allowed: this.#allowed,
      source: "withQuality",
      derived: true,
    });
  }
}

export function mintQuality(spec) {
  return new QualityToken(spec.name, spec.level);
}

export function mintMetaToken(spec) {
  return new MetaToken(spec);
}

export function mintQualitySelector(spec) {
  return new QualitySelectorToken(spec);
}

export function mintSignalToken(spec, freeze = true) {
  const token = new SignalToken(spec);
  if (freeze) Object.freeze(token);
  return token;
}

export function freezeToken(token) {
  Object.freeze(token);
}

export function isOperationToken(value) {
  return value instanceof OperationToken;
}

export function isQualityToken(value) {
  return value instanceof QualityToken;
}

export function isMetaToken(value) {
  return value instanceof MetaToken;
}

export function isQualitySelectorToken(value) {
  return value instanceof QualitySelectorToken;
}

export function isSignalToken(value) {
  return value instanceof SignalToken;
}

export function assertChannel(token) {
  if (isMetaToken(token)) {
    throw new ConfigError("meta-signal", "Метасигнал не является каналом");
  }
  if (isOperationToken(token)) {
    throw new ConfigError("invalid-signal", "Операция не является сигналом");
  }
  if (isQualityToken(token)) {
    throw new ConfigError("invalid-signal", "Модификатор качества не является каналом");
  }
  if (isQualitySelectorToken(token)) {
    throw new ConfigError("invalid-signal", "Селектор качества не является каналом");
  }
  if (!isSignalToken(token)) {
    throw new ConfigError("invalid-signal", "Требуется токен обычного сигнала каталога");
  }
  return token;
}

export function channelKey(token) {
  const signal = assertChannel(token);
  return JSON.stringify([signal.type, signal.name, signal.quality]);
}
