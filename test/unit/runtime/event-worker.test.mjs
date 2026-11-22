import assert from "node:assert/strict";
import test from "node:test";
import { EventCombinator, Signal } from "../../../src/index.js";
import { bootEventWorker } from "../../../src/event-worker.js";
import {
  createWorkerExecutor,
  deserializeRequest,
  deserializeResponse,
  handleWorkerMessage,
  installEventWorker,
} from "../../../src/event-host.js";
import { Circuit, ConfigError, RuntimeError } from "../../../src/index.js";
import { throwsCode } from "../signals/support.mjs";

const A = Signal.Signals.signal_A;

function echo(data) {
  return {
    kind: "result",
    id: data.id,
    response: {
      runId: data.request.runId,
      revision: data.request.revision,
      stepId: data.request.stepId,
      phase: data.request.phase,
      tick: data.request.tick,
      devices: [],
    },
  };
}

function linkedWorker(importModule) {
  const hostListeners = [];
  const scopeListeners = [];
  const posts = [];
  const worker = {
    terminated: false,
    postMessage(data) {
      queueMicrotask(() => {
        for (const listener of scopeListeners) listener({ data });
      });
    },
    addEventListener(type, listener) {
      if (type === "message") hostListeners.push(listener);
    },
    terminate() {
      this.terminated = true;
    },
  };
  const scope = {
    posts,
    postMessage(data) {
      posts.push(data);
      queueMicrotask(() => {
        for (const listener of hostListeners) listener({ data });
      });
    },
    addEventListener(type, listener) {
      if (type === "message") scopeListeners.push(listener);
    },
  };
  installEventWorker(scope, importModule ? { importModule } : {});
  return { worker, scope, hostListeners };
}

test("точка входа Worker ставит обработчик только в области потока", async () => {
  assert.equal(bootEventWorker(null), false);
  assert.equal(bootEventWorker({}), false);
  assert.equal(bootEventWorker({ addEventListener() {} }), false);
  const events = [];
  assert.equal(bootEventWorker({
    addEventListener(type, listener) {
      events.push(type, typeof listener);
    },
    postMessage() {},
  }), true);
  assert.deepEqual(events, ["message", "function"]);
  throwsCode(() => installEventWorker({}), "invalid-executor");
  let listener;
  const scope = {
    addEventListener(type, fn) {
      listener = fn;
    },
    postMessage() {},
  };
  installEventWorker(scope, { importModule: async () => ({ devices: [] }) });
  listener(null);
  listener({});
  const missingCode = {
    postMessage(data) {
      const reply = data.kind === "bind"
        ? { kind: "bound", id: data.id }
        : data.request.phase === "init"
          ? echo(data)
          : { kind: "error", id: data.id, name: "ConfigError", message: "нет кода" };
      queueMicrotask(() => missingCode.listener({ data: reply }));
    },
    addEventListener(type, fn) {
      this.listener = fn;
    },
  };
  const executor = await createWorkerExecutor(missingCode, { scriptUrl: "x", timeoutMs: 200 });
  const circuit = new Circuit();
  circuit.add(new EventCombinator({}));
  const simulation = await circuit.createSimulation({ executor });
  await assert.rejects(simulation.step(), (error) => error instanceof ConfigError && error.code === "invalid-script");
  const runtimeMissing = {
    postMessage(data) {
      queueMicrotask(() => runtimeMissing.listener({
        data: data.kind === "bind"
          ? { kind: "bound", id: data.id }
          : data.request.phase === "init"
            ? {
              kind: "result",
              id: data.id,
              response: {
                runId: data.request.runId,
                revision: data.request.revision,
                stepId: data.request.stepId,
                phase: data.request.phase,
                tick: data.request.tick,
                devices: [],
              },
            }
            : { kind: "error", id: data.id, name: "RuntimeError", message: "без кода" },
      }));
    },
    addEventListener(type, fn) {
      this.listener = fn;
    },
  };
  const runtimeExecutor = await createWorkerExecutor(runtimeMissing, { scriptUrl: "x", timeoutMs: 200 });
  const second = new Circuit();
  second.add(new EventCombinator({}));
  const secondRun = await second.createSimulation({ executor: runtimeExecutor });
  await assert.rejects(secondRun.step(), (error) => error instanceof RuntimeError && error.code === "script-error");
});

test("обработчик сообщений связывает модуль и отклоняет чужой запрос", async () => {
  const state = { shadows: null };
  assert.equal(await handleWorkerMessage(state, null, async () => ({})), null);
  assert.equal(await handleWorkerMessage(state, [], async () => ({})), null);
  assert.equal(await handleWorkerMessage(state, { kind: "noop", id: 1 }, async () => ({})), null);
  const missing = await handleWorkerMessage(state, { kind: "bind", id: 2, url: "" }, async () => ({}));
  assert.equal(missing.code, "invalid-script");
  const bad = await handleWorkerMessage(state, { kind: "bind", id: 3, url: "x" }, async () => ({ devices: [1] }));
  assert.equal(bad.code, "invalid-script");
  const plain = await handleWorkerMessage(state, { kind: "bind", id: 4, url: "x" }, async () => ({
    devices: [class Plain {}],
  }));
  assert.equal(plain.code, "invalid-script");
  const unbound = await handleWorkerMessage(state, { kind: "prepare", id: 5, profile: "base", request: { devices: [] } }, async () => ({}));
  assert.equal(unbound.code, "script-unbound");
  const boom = await handleWorkerMessage(state, { kind: "bind", url: "x" }, async () => {
    throw "boom";
  });
  const coded = new RuntimeError("script-error", "метка");
  coded.deviceId = "d1";
  coded.tick = 2;
  const marked = await handleWorkerMessage(state, { kind: "bind", id: 6, url: "x" }, async () => {
    throw coded;
  });
  assert.equal(marked.deviceId, "d1");
  assert.equal(marked.tick, 2);
  const nameless = await handleWorkerMessage(state, { kind: "prepare", id: 11 }, async () => ({}));
  assert.equal(nameless.code, "script-unbound");
  assert.equal(boom.name, "Error");
  assert.match(boom.message, /boom/);
  class Bad extends EventCombinator {
    constructor() {
      super({ extra: true });
    }
  }
  const config = await handleWorkerMessage(state, { kind: "bind", id: 7, url: "x" }, async () => ({ devices: [Bad] }));
  assert.equal(config.name, "ConfigError");
  class Box extends EventCombinator {
    init() {
      this.state.n = 1;
    }
  }
  const bound = await handleWorkerMessage(state, { kind: "bind", id: 8, url: "x" }, async () => ({ devices: [Box] }));
  assert.equal(bound.kind, "bound");
  const mismatch = await handleWorkerMessage(state, {
    kind: "prepare",
    id: 9,
    profile: "base",
    request: { devices: [] },
  }, async () => ({}));
  assert.equal(mismatch.code, "script-mismatch");
  const profile = await handleWorkerMessage(state, {
    kind: "prepare",
    id: 10,
    profile: 1,
    request: { devices: [] },
  }, async () => ({}));
  assert.equal(profile.code, "invalid-result");
});

test("запрос и ответ Worker сериализуют сигналы", () => {
  for (const value of [null, { devices: {} }]) {
    assert.throws(() => deserializeRequest(value, "base"), (error) => error instanceof RuntimeError && error.code === "invalid-result");
  }
  for (const value of [null, [], {}]) {
    assert.throws(() => deserializeResponse(value, "base"), (error) => error instanceof RuntimeError && error.code === "invalid-result");
  }
  assert.throws(() => deserializeResponse({
    devices: [{ id: "d1", state: {}, rng: 1, held: { red: null } }],
  }, "base"), (error) => error.code === "invalid-result");
});

test("настоящий обмен с подключённым обработчиком повторяет трассу 2/5/5/2", async () => {
  const { worker } = linkedWorker();
  const executor = await createWorkerExecutor(worker, {
    scriptUrl: new URL("../../browser/event/trace-devices.js", import.meta.url).href,
    timeoutMs: 1000,
  });
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const plain = { participate: true, state: { kept: true } };
  circuit.add(plain);
  const event = circuit.add(new (await import("../../browser/event/trace-devices.js")).HoldPulse({
    red_output: red,
    green_output: circuit.network("green_1"),
    run: { every_tick: false, input_changed: false },
  }));
  const simulation = await circuit.createSimulation({ executor });
  const trace = [simulation.read(red, A)];
  for (let step = 0; step < 3; step += 1) {
    await simulation.step();
    trace.push(simulation.read(red, A));
  }
  assert.deepEqual(trace, [2, 5, 5, 2]);
  assert.equal(simulation.device(plain).state.kept, true);
  const before = simulation.tick;
  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 2);
  assert.notEqual(simulation.runId, 1);
  assert.equal(before, 3);
  void event;
});

test("ошибка, таймаут и остановка Worker не публикуют тик", async () => {
  let listener;
  const silent = {
    terminated: false,
    postMessage(data) {
      if (data.kind === "bind") queueMicrotask(() => listener({ data: { kind: "bound", id: data.id } }));
      if (data.kind === "prepare" && data.request.phase === "init") {
        queueMicrotask(() => listener({ data: echo(data) }));
      }
    },
    addEventListener(type, fn) {
      listener = fn;
    },
    terminate() {
      this.terminated = true;
    },
  };
  const executor = await createWorkerExecutor(silent, {
    scriptUrl: "fixture",
    timeoutMs: 30,
    profile: "base",
  });
  const circuit = new Circuit();
  circuit.add(new EventCombinator({}));
  const simulation = await circuit.createSimulation({ executor });
  await assert.rejects(simulation.step(), (error) => {
    assert.equal(error.code, "timeout");
    return true;
  });
  assert.equal(silent.terminated, true);
  assert.equal(simulation.tick, 0);
  await assert.rejects(simulation.step(), (error) => error.code === "worker-stopped");
  listener({ data: null });
  listener({ data: { kind: "result", id: 999, response: {} } });
  listener(null);

  const failing = {
    postMessage(data) {
      const reply = data.kind === "bind"
        ? { kind: "bound", id: data.id }
        : data.request.phase === "init"
          ? echo(data)
          : {
            kind: "error",
            id: data.id,
            name: "RuntimeError",
            code: "script-error",
            message: "сбой",
            deviceId: "d1",
            tick: 0,
          };
      queueMicrotask(() => failing.listener({ data: reply }));
    },
    addEventListener(type, fn) {
      this.listener = fn;
    },
  };
  const errorExecutor = await createWorkerExecutor(failing, { scriptUrl: "fixture", timeoutMs: 200 });
  const second = new Circuit();
  second.add(new EventCombinator({}));
  const failed = await second.createSimulation({ executor: errorExecutor });
  await assert.rejects(failed.step(), (error) => {
    assert.equal(error.code, "script-error");
    assert.equal(error.deviceId, "d1");
    assert.equal(error.tick, 0);
    return true;
  });
  assert.equal(failed.tick, 0);

  const generic = {
    postMessage(data) {
      const reply = data.kind === "bind" || data.request.phase === "init"
        ? (data.kind === "bind" ? { kind: "bound", id: data.id } : echo(data))
        : { kind: "error", id: data.id, name: "Error", message: 5 };
      queueMicrotask(() => generic.listener({ data: reply }));
    },
    addEventListener(type, fn) {
      this.listener = fn;
    },
  };
  const genericExecutor = await createWorkerExecutor(generic, { scriptUrl: "fixture" });
  const third = new Circuit();
  third.add(new EventCombinator({}));
  const genericRun = await third.createSimulation({ executor: genericExecutor });
  await assert.rejects(genericRun.step(), (error) => error.message === "Ошибка исполнителя" && error.code === "script-error");

  const config = {
    postMessage(data) {
      const reply = data.kind === "bind" || data.request.phase === "init"
        ? (data.kind === "bind" ? { kind: "bound", id: data.id } : echo(data))
        : { kind: "error", id: data.id, name: "ConfigError", code: "meta-signal", message: "мета" };
      queueMicrotask(() => config.listener({ data: reply }));
    },
    addEventListener(type, fn) {
      this.listener = fn;
    },
  };
  const configExecutor = await createWorkerExecutor(config, { scriptUrl: "fixture" });
  const fourth = new Circuit();
  fourth.add(new EventCombinator({}));
  const configRun = await fourth.createSimulation({ executor: configExecutor });
  await assert.rejects(configRun.step(), (error) => error instanceof ConfigError && error.code === "meta-signal");
});

async function rejectsConfig(promise, code) {
  await assert.rejects(promise, (error) => error instanceof ConfigError && error.code === code);
}

test("настройки и обрыв postMessage отклоняются", async () => {
  const worker = { postMessage() {}, addEventListener() {} };
  await rejectsConfig(createWorkerExecutor(null, { scriptUrl: "x" }), "invalid-executor");
  await rejectsConfig(createWorkerExecutor({ postMessage() {} }, { scriptUrl: "x" }), "invalid-executor");
  await rejectsConfig(createWorkerExecutor(worker, null), "invalid-executor");
  await rejectsConfig(createWorkerExecutor(worker, []), "invalid-executor");
  await rejectsConfig(createWorkerExecutor(worker, { scriptUrl: "x", extra: 1 }), "invalid-executor");
  await rejectsConfig(createWorkerExecutor(worker, { scriptUrl: "" }), "invalid-executor");
  await rejectsConfig(createWorkerExecutor(worker, { scriptUrl: "x", timeoutMs: 0 }), "invalid-executor");
  await rejectsConfig(createWorkerExecutor(worker, { scriptUrl: "x", timeoutMs: 1.5 }), "invalid-executor");
  await rejectsConfig(createWorkerExecutor(worker, { scriptUrl: "x", profile: "mod" }), "invalid-profile");
  const blocked = {
    postMessage() {
      throw new Error("blocked");
    },
    addEventListener() {},
  };
  await assert.rejects(createWorkerExecutor(blocked, { scriptUrl: "x", timeoutMs: 50 }), (error) => error.message === "blocked");
});

test("сообщение и отмена пробуждения проходят границу Worker", async () => {
  class Sender extends EventCombinator {
    init() {
      this.wakeAt(0);
      this.wakeAt(4);
      this.setOutput({
        red: true,
        green: true,
        signals: [{ signal: A, constant: 1 }],
      });
    }

    main() {
      this.clearOutput({ red: false, green: true });
      this.cancelWake(4);
      this.wakeAt(this.tick + 3);
      this.wakeAt(this.tick + 5);
      this.send(this.peers.receiver, { type: "ping", data: { n: 1, items: [1, { ok: true }] } });
    }
  }
  class Receiver extends EventCombinator {
    main() {
      this.state.got = this.messages[0].type;
    }
  }
  const { worker } = linkedWorker(async () => ({ devices: [Sender, Receiver] }));
  const executor = await createWorkerExecutor(worker, { scriptUrl: "memory", timeoutMs: 1000 });
  const circuit = new Circuit();
  const sender = new Sender({ run: { every_tick: false, input_changed: false } });
  const receiver = new Receiver({ run: { every_tick: false, input_changed: false } });
  circuit.add(sender);
  circuit.add(receiver);
  circuit.setPeers(sender, { receiver });
  const simulation = await circuit.createSimulation({ executor });
  await simulation.step();
  assert.equal(simulation.device(receiver).messages[0].type, "ping");
  assert.deepEqual(simulation.device(sender).wakes, [3, 5]);
  await simulation.step();
  assert.equal(simulation.device(receiver).state.got, "ping");
});

test("остановка отклоняет текущий шаг и поздний ответ", async () => {
  let listener;
  const worker = {
    terminated: false,
    last: null,
    postMessage(data) {
      this.last = data;
      if (data.kind === "bind" || data.request.phase === "init") {
        const reply = data.kind === "bind"
          ? { kind: "bound", id: data.id }
          : echo(data);
        queueMicrotask(() => listener({ data: reply }));
      }
    },
    addEventListener(type, fn) {
      listener = fn;
    },
    terminate() {
      this.terminated = true;
    },
  };
  const executor = await createWorkerExecutor(worker, { scriptUrl: "x", timeoutMs: 1000 });
  const circuit = new Circuit();
  circuit.add(new EventCombinator({}));
  const simulation = await circuit.createSimulation({ executor });
  const pending = simulation.step();
  executor.stop();
  listener({
    data: {
      kind: "result",
      id: worker.last.id,
      response: echo(worker.last).response,
    },
  });
  await assert.rejects(pending, (error) => error.code === "worker-stopped");
  assert.equal(simulation.tick, 0);
  assert.equal(worker.terminated, true);
  executor.stop();
  await assert.rejects(simulation.step(), (error) => error.code === "worker-stopped");
});

test("ответ, пришедший раньше остановки, не публикуется", async () => {
  let listener;
  const worker = {
    last: null,
    postMessage(data) {
      this.last = data;
      if (data.kind === "bind" || data.request.phase === "init") {
        const reply = data.kind === "bind" ? { kind: "bound", id: data.id } : echo(data);
        queueMicrotask(() => listener({ data: reply }));
      }
    },
    addEventListener(type, fn) {
      listener = fn;
    },
    terminate() {},
  };
  const executor = await createWorkerExecutor(worker, { scriptUrl: "x", timeoutMs: 1000 });
  const circuit = new Circuit();
  circuit.add(new EventCombinator({}));
  const simulation = await circuit.createSimulation({ executor });
  const pending = simulation.step();
  listener({ data: echo(worker.last) });
  executor.stop();
  await assert.rejects(pending, (error) => error.code === "worker-stopped");
  assert.equal(simulation.tick, 0);
});

test("таймаут одного обмена отпускает остальные", async () => {
  let listener;
  let inits = 0;
  const worker = {
    terminated: false,
    postMessage(data) {
      if (data.kind === "bind") {
        queueMicrotask(() => listener({ data: { kind: "bound", id: data.id } }));
        return;
      }
      if (data.request.phase === "init") {
        inits += 1;
        if (inits === 1) queueMicrotask(() => listener({ data: echo(data) }));
      }
    },
    addEventListener(type, fn) {
      listener = fn;
    },
    terminate() {
      this.terminated = true;
    },
  };
  const executor = await createWorkerExecutor(worker, { scriptUrl: "x", timeoutMs: 30 });
  const circuit = new Circuit();
  circuit.add(new EventCombinator({}));
  const simulation = await circuit.createSimulation({ executor });
  const stepPromise = simulation.step();
  const resetPromise = simulation.reset();
  await assert.rejects(stepPromise, (error) => error.code === "step-cancelled" || error.code === "timeout");
  await assert.rejects(resetPromise, (error) => error.code === "worker-stopped" || error.code === "timeout");
  assert.equal(worker.terminated, true);
  assert.equal(simulation.tick, 0);
});

test("место в коде проходит границу Worker", async () => {
  const cause = new Error("внутри");
  cause.stack = "Error: внутри\n    at Boom.main (scenario.js:4:2)\n    at runScript (/src/event.js:10:1)";
  const wrapped = new RuntimeError("script-error", "обёртка");
  wrapped.cause = cause;
  wrapped.deviceId = "event-1";
  wrapped.tick = 3;
  const marked = await handleWorkerMessage({ shadows: null }, { kind: "bind", id: 12, url: "x" }, async () => {
    throw wrapped;
  });
  assert.equal(marked.location, "Boom.main (scenario.js:4:2)");
  const onlyEngine = new Error("движок");
  onlyEngine.stack = "Error: движок\n    at runScript (/src/event.js:10:1)";
  const hidden = await handleWorkerMessage({ shadows: null }, { kind: "bind", id: 13, url: "x" }, async () => {
    throw onlyEngine;
  });
  assert.equal(Object.hasOwn(hidden, "location"), false);
  let listener;
  const worker = {
    postMessage(data) {
      const reply = data.kind === "bind"
        ? { kind: "bound", id: data.id }
        : data.request.phase === "init"
          ? echo(data)
          : {
            kind: "error",
            id: data.id,
            name: "RuntimeError",
            code: "script-error",
            message: "сбой",
            deviceId: "d1",
            tick: 0,
            location: "Boom.main (scenario.js:2:1)",
          };
      queueMicrotask(() => listener({ data: reply }));
    },
    addEventListener(type, fn) {
      listener = fn;
    },
  };
  const executor = await createWorkerExecutor(worker, { scriptUrl: "x", timeoutMs: 200 });
  const circuit = new Circuit();
  circuit.add(new EventCombinator({}));
  const simulation = await circuit.createSimulation({ executor });
  await assert.rejects(simulation.step(), (error) => {
    assert.equal(error.location, "Boom.main (scenario.js:2:1)");
    return error.code === "script-error";
  });
  const blank = {
    postMessage(data) {
      const reply = data.kind === "bind" || data.request.phase === "init"
        ? (data.kind === "bind" ? { kind: "bound", id: data.id } : echo(data))
        : { kind: "error", id: data.id, name: "RuntimeError", code: "script-error", message: "пусто", location: "" };
      queueMicrotask(() => blank.listener({ data: reply }));
    },
    addEventListener(type, fn) {
      this.listener = fn;
    },
  };
  const blankExecutor = await createWorkerExecutor(blank, { scriptUrl: "x", timeoutMs: 200 });
  const second = new Circuit();
  second.add(new EventCombinator({}));
  const secondRun = await second.createSimulation({ executor: blankExecutor });
  await assert.rejects(secondRun.step(), (error) => error.location === undefined && error.message === "пусто");
});

test("поздний ответ после таймаута не принимается", async () => {
  let listener;
  const worker = {
    terminated: false,
    last: null,
    postMessage(data) {
      this.last = data;
    },
    addEventListener(type, fn) {
      listener = fn;
    },
    terminate() {
      this.terminated = true;
    },
  };
  const pending = createWorkerExecutor(worker, { scriptUrl: "x", timeoutMs: 20 });
  await assert.rejects(pending, (error) => error.code === "timeout");
  listener({ data: { kind: "bound", id: worker.last.id } });
  listener({ data: { kind: "result", id: worker.last.id, response: { devices: [] } } });
  assert.equal(worker.terminated, true);
});
