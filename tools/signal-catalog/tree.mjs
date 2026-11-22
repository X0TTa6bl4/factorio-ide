/** Дерево Signal.* произвольной глубины. Промежуточный токен может хранить вложенные пути. */

import { CatalogError } from "./errors.mjs";
import { compareText } from "./format.mjs";

const IDENTITY = ["prototypeId", "gameType", "gameName", "role", "channel"];

function partsOf(publicPath) {
  if (typeof publicPath !== "string" || publicPath.length === 0) {
    throw new CatalogError("schema", "publicPath должен быть строкой");
  }
  const parts = publicPath.split(".");
  if (parts[0] !== "Signal" || parts.length < 3 || parts.some((part) => part.length === 0)) {
    throw new CatalogError("schema", `Некорректный publicPath ${publicPath}`);
  }
  return parts;
}

function place(root, publicPath, value) {
  const parts = partsOf(publicPath);
  let node = root;
  for (let index = 1; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (node[key] === undefined) node[key] = {};
    node = node[key];
  }
  const leaf = parts[parts.length - 1];
  const existing = node[leaf];
  if (existing?.prototypeId && existing.prototypeId !== value.prototypeId) {
    throw new CatalogError("collision", `${publicPath}: путь занят ${existing.prototypeId}`);
  }
  if (existing === undefined) node[leaf] = {};
  for (const key of IDENTITY) node[leaf][key] = value[key];
}

export function mountSignals(paths) {
  const listed = Array.isArray(paths) ? paths.map((entry) => [entry.publicPath, entry]) : null;
  if (!listed && (!paths || typeof paths !== "object")) {
    throw new CatalogError("schema", "Индекс путей должен быть объектом");
  }
  const root = {};
  const entries = (listed ?? Object.entries(paths)).sort((left, right) => {
    const depth = left[0].split(".").length - right[0].split(".").length;
    return depth || compareText(left[0], right[0]);
  });
  for (const [publicPath, value] of entries) {
    if (!value || typeof value !== "object" || typeof value.prototypeId !== "string") {
      throw new CatalogError("schema", `${publicPath}: в индексе нет prototypeId`);
    }
    place(root, publicPath, value);
  }
  return root;
}

export function readSignal(tree, publicPath) {
  const parts = partsOf(publicPath);
  let node = tree;
  for (let index = 1; index < parts.length; index += 1) {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, parts[index])) return null;
    node = node[parts[index]];
  }
  if (!node || typeof node !== "object" || typeof node.prototypeId !== "string") return null;
  return node;
}
