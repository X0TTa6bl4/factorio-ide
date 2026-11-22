/** JSON-дерево state и полезной нагрузки сообщения: без циклов и посторонних типов. */

import { ConfigError, RuntimeError } from "./errors.js";

const MESSAGE = "Значение должно быть JSON-деревом без циклов";

export function cloneConfigJson(value) {
  return visit(value, new WeakSet(), ConfigError);
}

export function cloneRuntimeJson(value) {
  return visit(value, new WeakSet(), RuntimeError);
}

function fail(ErrorClass) {
  throw new ErrorClass("invalid-state", MESSAGE);
}

function visit(value, stack, ErrorClass) {
  if (value === null) return null;
  const type = typeof value;
  if (type === "boolean" || type === "string") return value;
  if (type === "number") {
    if (!Number.isFinite(value)) fail(ErrorClass);
    return value;
  }
  if (type !== "object") fail(ErrorClass);
  if (stack.has(value)) fail(ErrorClass);
  if (Array.isArray(value)) {
    stack.add(value);
    try {
      return value.map((item) => visit(item, stack, ErrorClass));
    } finally {
      stack.delete(value);
    }
  }
  if (value.constructor !== Object) fail(ErrorClass);
  stack.add(value);
  try {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = visit(value[key], stack, ErrorClass);
    return copy;
  } finally {
    stack.delete(value);
  }
}
