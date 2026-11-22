/** Канонический токен канала для снимка и границы Worker: type/name/quality. */

import { openProfile } from "./signal-profile.js";
import { isSignalToken } from "./signal-token.js";

const indexes = new Map();

function indexFor(profile) {
  const existing = indexes.get(profile.name);
  if (existing) return existing;
  const index = new Map();
  const walk = (node) => {
    if (isSignalToken(node)) index.set(`${node.type}/${node.name}/${node.quality}`, node);
    for (const key of Object.keys(node)) walk(node[key]);
  };
  walk(profile.tree);
  indexes.set(profile.name, index);
  return index;
}

export function signalIdentity(token) {
  return { type: token.type, name: token.name, quality: token.quality };
}

export function canonicalSignal(profileName, key) {
  const profile = openProfile(profileName);
  const index = indexFor(profile);
  if (key && typeof key === "object" && !Array.isArray(key)) {
    const quality = Object.hasOwn(key, "quality") ? key.quality : "normal";
    const known = index.get(`${key.type}/${key.name}/${quality}`);
    if (known) return known;
  }
  const token = profile.importSignal(key);
  index.set(`${token.type}/${token.name}/${token.quality}`, token);
  return token;
}

export function serializeCounts(counts) {
  return counts.map((entry) => ({
    signal: signalIdentity(entry.signal),
    constant: entry.constant,
  }));
}

export function deserializeCounts(counts, profileName) {
  return counts.map((entry) => ({
    signal: canonicalSignal(profileName, entry.signal),
    constant: entry.constant,
  }));
}
