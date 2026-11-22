/** Сравнение опубликованных каналов: новое значение, сдвиг и исчезновение. */

export function signalKey(signal) {
  return signal.quality && signal.quality !== "normal"
    ? `${signal.name}/${signal.quality}`
    : signal.name;
}

export function ownKey(color, name) {
  return `${color}:${name}`;
}

export function indexSignals(entries) {
  const map = new Map();
  for (const entry of entries) map.set(signalKey(entry.signal), entry.constant);
  return map;
}

export function indexOutput(output) {
  const map = new Map();
  for (const color of ["red", "green"]) {
    for (const entry of output[color]) {
      map.set(ownKey(color, signalKey(entry.signal)), entry.constant);
    }
  }
  return map;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

export function diffRows(previous, current, showPrior) {
  const prior = previous ?? new Map();
  const now = current ?? new Map();
  const names = [...new Set([...prior.keys(), ...now.keys()])].sort();
  return names.map((name) => {
    const hasNow = now.has(name);
    const value = hasNow ? now.get(name) : null;
    if (!showPrior) {
      return { name, before: null, value, change: "baseline", delta: "—" };
    }
    const hasPrior = prior.has(name);
    const before = hasPrior ? prior.get(name) : null;
    if (hasPrior && !hasNow) {
      return { name, before, value: null, change: "gone", delta: "исчез" };
    }
    if (!hasPrior && hasNow) {
      return { name, before: null, value, change: "new", delta: signed(value) };
    }
    if (before !== value) {
      return { name, before, value, change: "changed", delta: signed(value - before) };
    }
    return { name, before, value, change: "same", delta: "0" };
  });
}
