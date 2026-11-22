import assert from "node:assert/strict";

export function throwsCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.name, "ConfigError");
    assert.equal(error.code, code);
    return true;
  });
}

export async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "ConfigError");
    assert.equal(error.code, code);
    return true;
  });
}

export function signalRow(type, name, extras = {}) {
  return {
    channel: true,
    gameType: type,
    gameName: name,
    prototypeId: `${type}/${name}`,
    role: "ordinary",
    ...extras,
  };
}

export function collectTokens(root, accept) {
  const found = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (accept(node)) found.push(node);
    for (const key of Object.keys(node)) walk(node[key]);
  };
  walk(root);
  return found;
}
