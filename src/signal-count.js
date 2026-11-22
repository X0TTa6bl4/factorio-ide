/** SignalCount: обычный канал каталога и количество int32. */

import { ConfigError } from "./errors.js";
import { isInt32 } from "./int32.js";
import { assertChannel } from "./signal-token.js";

export function readSignalCount(entry, profileName) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ConfigError("invalid-signal-count", "SignalCount должен быть объектом");
  }
  const keys = Object.keys(entry);
  if (keys.length !== 2 || !Object.hasOwn(entry, "signal") || !Object.hasOwn(entry, "constant")) {
    throw new ConfigError("invalid-signal-count", "SignalCount содержит только signal и constant");
  }
  const signal = assertChannel(entry.signal);
  if (signal.profile !== profileName) {
    throw new ConfigError(
      "wrong-profile",
      `Сигнал профиля ${signal.profile} нельзя использовать в профиле ${profileName}`,
    );
  }
  if (!isInt32(entry.constant)) {
    throw new ConfigError("invalid-constant", "Количество должно быть целым int32");
  }
  return { signal, constant: entry.constant };
}
