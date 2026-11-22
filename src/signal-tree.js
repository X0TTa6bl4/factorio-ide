/** Дерево Signal.* из индекса publicPath. Промежуточный токен хранит вложенные пути. */

import { compareText } from "./compare.js";
import { ConfigError } from "./errors.js";
import {
  freezeToken,
  isSignalToken,
  mintMetaToken,
  mintQualitySelector,
  mintSignalToken,
} from "./signal-token.js";

const SECTION_GROUP = {
  Logistic: "logistics",
  Production: "production",
  Intermediate: "intermediate-products",
  Space: "space",
  Combat: "combat",
  Fluids: "fluids",
  Signals: "signals",
  Enemies: "enemies",
  Environment: "environment",
  Unsorted: "other",
  Meta: null,
};

const META_NAMES = {
  "signal-each": "each",
  "signal-everything": "everything",
  "signal-anything": "anything",
};

function requiredString(value, label) {
  if (typeof value !== "string" || value === "") {
    throw new ConfigError("invalid-catalog", `${label} должен быть непустой строкой`);
  }
  return value;
}

function partsOf(publicPath) {
  const path = requiredString(publicPath, "publicPath");
  const parts = path.split(".");
  if (parts[0] !== "Signal" || parts.length < 3 || parts.some((part) => part.length === 0)) {
    throw new ConfigError("invalid-catalog", `Некорректный publicPath ${path}`);
  }
  return parts;
}

function readInfo(publicPath, info) {
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    throw new ConfigError("invalid-catalog", `${publicPath}: запись пути должна быть объектом`);
  }
  const gameType = requiredString(info.gameType, `${publicPath}: gameType`);
  const gameName = requiredString(info.gameName, `${publicPath}: gameName`);
  const prototypeId = requiredString(info.prototypeId, `${publicPath}: prototypeId`);
  const role = requiredString(info.role, `${publicPath}: role`);
  if (typeof info.channel !== "boolean") {
    throw new ConfigError("invalid-catalog", `${publicPath}: channel должен быть boolean`);
  }
  return { gameType, gameName, prototypeId, role, channel: info.channel };
}

function defineChild(parent, key, value) {
  Object.defineProperty(parent, key, {
    value,
    enumerable: true,
    writable: false,
    configurable: false,
  });
}

export function assembleSignals(profileName, paths, allowed) {
  const entries = Array.isArray(paths) ? paths : Object.entries(paths);
  const byPath = new Map();
  const index = new Map();
  const special = new Map();

  for (const [publicPath, raw] of entries) {
    const parts = partsOf(publicPath);
    if (byPath.has(publicPath)) {
      throw new ConfigError("invalid-catalog", `Повтор пути ${publicPath}`);
    }
    const info = readInfo(publicPath, raw);
    const section = parts[1];
    if (!Object.hasOwn(SECTION_GROUP, section)) {
      throw new ConfigError("invalid-catalog", `Неизвестный раздел ${section}`);
    }
    const jsName = parts[parts.length - 1];
    const identity = `${info.gameType}/${info.gameName}`;
    if (info.role === "meta" || info.role === "quality-selector") {
      if (special.has(identity) || index.has(identity)) {
        throw new ConfigError("invalid-catalog", `Повтор сигнала ${identity}`);
      }
      const common = {
        profile: profileName,
        publicPath,
        section,
        group: SECTION_GROUP[section],
        prototypeId: info.prototypeId,
        role: info.role,
        gameName: info.gameName,
        jsName,
      };
      let token;
      if (info.role === "meta") {
        const shortName = META_NAMES[info.gameName];
        if (!shortName) {
          throw new ConfigError("invalid-catalog", `Неизвестный метасигнал ${info.gameName}`);
        }
        token = mintMetaToken({ ...common, name: shortName });
      } else {
        token = mintQualitySelector({ ...common, name: info.gameName });
      }
      special.set(identity, info.role);
      byPath.set(publicPath, token);
    } else if (info.role === "ordinary" && info.channel === true) {
      if (index.has(identity) || special.has(identity)) {
        throw new ConfigError("invalid-catalog", `Повтор сигнала ${identity}`);
      }
      const spec = {
        type: info.gameType,
        name: info.gameName,
        quality: "normal",
        publicPath,
        section,
        group: SECTION_GROUP[section],
        prototypeId: info.prototypeId,
        role: info.role,
        jsName,
        profile: profileName,
        allowed,
        source: "constant",
        derived: false,
      };
      index.set(identity, spec);
      byPath.set(publicPath, mintSignalToken(spec, false));
    } else {
      throw new ConfigError("invalid-catalog", `${publicPath}: путь не является каналом или метасигналом`);
    }
  }

  const ordered = [...byPath.entries()].sort((left, right) => {
    const depth = left[0].split(".").length - right[0].split(".").length;
    return depth || compareText(left[0], right[0]);
  });
  const root = {};
  const sections = new Map();

  for (const [publicPath, token] of ordered) {
    const parts = publicPath.split(".");
    if (!sections.has(parts[1])) {
      const section = {};
      defineChild(root, parts[1], section);
      sections.set(parts[1], section);
    }
    if (parts.length === 3) {
      defineChild(sections.get(parts[1]), parts[2], token);
    } else {
      const parent = byPath.get(parts.slice(0, -1).join("."));
      if (!isSignalToken(parent)) {
        throw new ConfigError("invalid-catalog", `Промежуточный путь не является сигналом: ${publicPath}`);
      }
      defineChild(parent, parts[parts.length - 1], token);
    }
  }

  for (const token of byPath.values()) freezeToken(token);
  for (const section of sections.values()) Object.freeze(section);
  Object.freeze(root);
  return { tree: root, index, special };
}
