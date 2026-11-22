/** Граница Worker: снимок prepare уходит в сценарий, назад возвращаются правки. */

import { ConfigError, RuntimeError } from "./errors.js";
import { EventCombinator } from "./event.js";
import { cloneRuntimeJson } from "./json-value.js";
import { runPrepare } from "./scenario.js";
import { deserializeCounts, serializeCounts } from "./signal-codec.js";

function scriptLocation(error) {
  const source = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (!(source instanceof Error) || typeof source.stack !== "string") return "";
  for (const line of source.stack.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    if (trimmed.includes("/src/") || trimmed.includes("\\src\\")) continue;
    return trimmed.slice(3).trim();
  }
  return "";
}

function restoreError(message) {
  const text = typeof message.message === "string" ? message.message : "Ошибка исполнителя";
  const error = message.name === "ConfigError"
    ? new ConfigError(message.code || "invalid-script", text)
    : new RuntimeError(message.name === "RuntimeError" ? (message.code || "script-error") : "script-error", text);
  if (message.deviceId !== undefined) error.deviceId = message.deviceId;
  if (message.tick !== undefined) error.tick = message.tick;
  if (typeof message.location === "string" && message.location !== "") error.location = message.location;
  return error;
}

function errorPayload(id, error) {
  const payload = {
    kind: "error",
    id: id ?? null,
    name: "Error",
    code: "script-error",
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof ConfigError || error instanceof RuntimeError) {
    payload.name = error.name;
    payload.code = error.code;
  }
  if (error && error.deviceId !== undefined) payload.deviceId = error.deviceId;
  if (error && error.tick !== undefined) payload.tick = error.tick;
  const location = scriptLocation(error);
  if (location !== "") payload.location = location;
  return payload;
}

function copyMessage(message) {
  return {
    from: message.from,
    to: message.to,
    sentTick: message.sentTick,
    deliveryTick: message.deliveryTick,
    sequence: message.sequence,
    type: message.type,
    data: cloneRuntimeJson(message.data),
  };
}

export function serializeRequest(request) {
  return {
    runId: request.runId,
    revision: request.revision,
    stepId: request.stepId,
    phase: request.phase,
    tick: request.tick,
    nextTick: request.nextTick,
    devices: request.devices.map((view) => {
      const copy = {
        id: view.id,
        state: cloneRuntimeJson(view.state),
        messages: view.messages.map(copyMessage),
        wakes: view.wakes.slice(),
        held: {
          red: serializeCounts(view.held.red),
          green: serializeCounts(view.held.green),
        },
        pulses: view.pulses.map((pulse) => ({
          color: pulse.color,
          start: pulse.start,
          end: pulse.end,
          signals: serializeCounts(pulse.signals),
        })),
        rng: view.rng,
        run: view.run
          ? { every_tick: view.run.every_tick, input_changed: view.run.input_changed }
          : null,
        receiverId: view.receiverId ?? null,
      };
      if (Object.hasOwn(view, "inputs")) {
        copy.inputs = {
          red: serializeCounts(view.inputs.red),
          green: serializeCounts(view.inputs.green),
        };
        copy.inputChanged = view.inputChanged === true;
      }
      return copy;
    }),
  };
}

function countList(value, profile) {
  if (!Array.isArray(value)) throw new RuntimeError("invalid-result", "Список сигналов ответа должен быть массивом");
  return deserializeCounts(value, profile);
}

export function deserializeRequest(payload, profile) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.devices)) {
    throw new RuntimeError("invalid-result", "Запрос prepare должен быть объектом");
  }
  const request = {
    runId: payload.runId,
    revision: payload.revision,
    stepId: payload.stepId,
    phase: payload.phase,
    tick: payload.tick,
    nextTick: payload.nextTick,
    profile,
    devices: payload.devices.map((view) => {
      const copy = {
        id: view.id,
        state: cloneRuntimeJson(view.state),
        messages: view.messages.map(copyMessage),
        wakes: view.wakes.slice(),
        held: {
          red: countList(view.held.red, profile),
          green: countList(view.held.green, profile),
        },
        pulses: view.pulses.map((pulse) => ({
          color: pulse.color,
          start: pulse.start,
          end: pulse.end,
          signals: countList(pulse.signals, profile),
        })),
        rng: view.rng,
        run: view.run
          ? { every_tick: view.run.every_tick, input_changed: view.run.input_changed }
          : null,
        receiverId: view.receiverId ?? null,
      };
      if (Object.hasOwn(view, "inputs")) {
        copy.inputs = {
          red: countList(view.inputs.red, profile),
          green: countList(view.inputs.green, profile),
        };
        copy.inputChanged = view.inputChanged === true;
      }
      return copy;
    }),
  };
  return request;
}

function serializePatch(patch) {
  const copy = {
    id: patch.id,
    state: cloneRuntimeJson(patch.state),
    rng: patch.rng,
  };
  if (patch.clear) copy.clear = { ...patch.clear };
  if (patch.held) {
    copy.held = {};
    if (Object.hasOwn(patch.held, "red")) copy.held.red = serializeCounts(patch.held.red);
    if (Object.hasOwn(patch.held, "green")) copy.held.green = serializeCounts(patch.held.green);
  }
  if (patch.pulses) {
    copy.pulses = patch.pulses.map((pulse) => ({
      red: pulse.red,
      green: pulse.green,
      signals: serializeCounts(pulse.signals),
      duration: pulse.duration,
    }));
  }
  if (patch.wake) copy.wake = patch.wake.slice();
  if (patch.cancelWake) copy.cancelWake = patch.cancelWake.slice();
  if (patch.send) {
    copy.send = patch.send.map((message) => ({
      to: message.to,
      type: message.type,
      data: cloneRuntimeJson(message.data),
    }));
  }
  return copy;
}

export function serializeResponse(response) {
  return {
    runId: response.runId,
    revision: response.revision,
    stepId: response.stepId,
    phase: response.phase,
    tick: response.tick,
    devices: response.devices.map(serializePatch),
  };
}

function deserializePatch(patch, profile) {
  const copy = {
    id: patch.id,
    state: cloneRuntimeJson(patch.state),
    rng: patch.rng,
  };
  if (patch.clear) copy.clear = { ...patch.clear };
  if (patch.held) {
    copy.held = {};
    if (Object.hasOwn(patch.held, "red")) copy.held.red = countList(patch.held.red, profile);
    if (Object.hasOwn(patch.held, "green")) copy.held.green = countList(patch.held.green, profile);
  }
  if (patch.pulses) {
    copy.pulses = patch.pulses.map((pulse) => ({
      red: pulse.red,
      green: pulse.green,
      signals: countList(pulse.signals, profile),
      duration: pulse.duration,
    }));
  }
  if (patch.wake) copy.wake = patch.wake.slice();
  if (patch.cancelWake) copy.cancelWake = patch.cancelWake.slice();
  if (patch.send) {
    copy.send = patch.send.map((message) => ({
      to: message.to,
      type: message.type,
      data: cloneRuntimeJson(message.data),
    }));
  }
  return copy;
}

export function deserializeResponse(payload, profile) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.devices)) {
    throw new RuntimeError("invalid-result", "Ответ prepare должен быть объектом");
  }
  return {
    runId: payload.runId,
    revision: payload.revision,
    stepId: payload.stepId,
    phase: payload.phase,
    tick: payload.tick,
    devices: payload.devices.map((patch) => deserializePatch(patch, profile)),
  };
}

async function bindScripts(state, message, importModule) {
  if (typeof message.url !== "string" || message.url === "") {
    throw new RuntimeError("invalid-script", "Модуль сценария не указан");
  }
  const loaded = await importModule(message.url);
  if (!loaded || !Array.isArray(loaded.devices) || loaded.devices.some((item) => typeof item !== "function")) {
    throw new RuntimeError("invalid-script", "Модуль сценария должен экспортировать массив devices");
  }
  const shadows = [];
  for (const Class of loaded.devices) {
    const device = new Class({});
    if (!(device instanceof EventCombinator)) {
      throw new RuntimeError("invalid-script", "Элемент devices должен быть EventCombinator");
    }
    shadows.push(device);
  }
  state.shadows = shadows;
  return { kind: "bound", id: message.id };
}

function prepareScripts(state, message) {
  if (!state.shadows) throw new RuntimeError("script-unbound", "Сценарий Worker не подключён");
  if (typeof message.profile !== "string") throw new RuntimeError("invalid-result", "Не указан профиль прогона");
  const request = deserializeRequest(message.request, message.profile);
  const events = request.devices.filter((view) => view.run);
  if (events.length !== state.shadows.length) {
    throw new RuntimeError("script-mismatch", "Число сценариев не совпало с модулем devices");
  }
  const byId = new Map();
  events.forEach((view, index) => byId.set(view.id, state.shadows[index]));
  return {
    kind: "result",
    id: message.id,
    response: serializeResponse(runPrepare(request, byId)),
  };
}

export async function handleWorkerMessage(state, message, importModule) {
  try {
    if (!message || typeof message !== "object" || Array.isArray(message)) return null;
    if (message.kind === "bind") return await bindScripts(state, message, importModule);
    if (message.kind === "prepare") return prepareScripts(state, message);
    return null;
  } catch (error) {
    return errorPayload(message && message.id, error);
  }
}

export function installEventWorker(scope, options = {}) {
  if (!scope || typeof scope.addEventListener !== "function" || typeof scope.postMessage !== "function") {
    throw new ConfigError("invalid-executor", "Область Worker должна принимать сообщения");
  }
  const importModule = options.importModule ?? ((url) => import(url));
  const state = { shadows: null };
  scope.addEventListener("message", (event) => {
    const incoming = event ? event.data : undefined;
    Promise.resolve(handleWorkerMessage(state, incoming, importModule)).then((response) => {
      if (response) scope.postMessage(response);
    });
  });
  return state;
}

function readWorkerOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new ConfigError("invalid-executor", "Настройки Worker должны быть объектом");
  }
  for (const key of Object.keys(options)) {
    if (key !== "profile" && key !== "scriptUrl" && key !== "timeoutMs") {
      throw new ConfigError("invalid-executor", `Неизвестный параметр ${key}`);
    }
  }
  if (typeof options.scriptUrl !== "string" || options.scriptUrl === "") {
    throw new ConfigError("invalid-executor", "scriptUrl должен быть непустой строкой");
  }
  const timeoutMs = Object.hasOwn(options, "timeoutMs") ? options.timeoutMs : 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new ConfigError("invalid-executor", "timeoutMs должен быть целым числом от 1");
  }
  const profile = Object.hasOwn(options, "profile") ? options.profile : "base";
  if (profile !== "base" && profile !== "space-age") {
    throw new ConfigError("invalid-profile", "Профиль должен быть base или space-age");
  }
  return { scriptUrl: options.scriptUrl, timeoutMs, profile };
}

function stoppedError() {
  return new RuntimeError("worker-stopped", "Исполнитель сценария остановлен");
}

function createBridge(worker, timeoutMs) {
  let nextId = 0;
  let stopped = false;
  const pending = new Map();

  function rejectAll(error) {
    stopped = true;
    const waiters = [...pending.values()];
    pending.clear();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    if (typeof worker.terminate === "function") worker.terminate();
  }

  worker.addEventListener("message", (event) => {
    const message = event && event.data;
    if (!message || typeof message !== "object") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.kind === "error") waiter.reject(restoreError(message));
    else if (message.kind === "result") waiter.resolve(message.response);
    else waiter.resolve(message);
  });
  return {
    isStopped() {
      return stopped;
    },
    stop() {
      rejectAll(stoppedError());
    },
    roundTrip(body) {
      if (stopped) return Promise.reject(stoppedError());
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiter = pending.get(id);
          pending.delete(id);
          waiter.reject(new RuntimeError("timeout", "Исполнитель сценария не ответил вовремя"));
          rejectAll(stoppedError());
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          worker.postMessage({ ...body, id });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
          rejectAll(stoppedError());
        }
      });
    },
  };
}

export async function createWorkerExecutor(worker, options) {
  if (!worker || typeof worker !== "object" || typeof worker.postMessage !== "function"
    || typeof worker.addEventListener !== "function") {
    throw new ConfigError("invalid-executor", "Worker должен принимать сообщения");
  }
  const settings = readWorkerOptions(options);
  const bridge = createBridge(worker, settings.timeoutMs);
  await bridge.roundTrip({ kind: "bind", url: settings.scriptUrl });
  return {
    replayInit: true,
    prepare(request) {
      return bridge.roundTrip({
        kind: "prepare",
        profile: settings.profile,
        request: serializeRequest(request),
      }).then((response) => {
        if (bridge.isStopped()) throw stoppedError();
        return deserializeResponse(response, settings.profile);
      });
    },
    stop() {
      bridge.stop();
    },
  };
}
