/** Точка входа Worker: подключает обработчик сценариев к области потока. */

import { installEventWorker } from "./event-host.js";

export function bootEventWorker(scope) {
  if (!scope || typeof scope.addEventListener !== "function" || typeof scope.postMessage !== "function") {
    return false;
  }
  installEventWorker(scope);
  return true;
}

bootEventWorker(globalThis);
