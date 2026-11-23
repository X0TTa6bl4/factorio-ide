import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, RuntimeError } from "../../../src/errors.js";
import {
  compileScenarioSource,
  createEventScriptSession,
  formatDiagnostic,
  readScenarioSettings,
  readTimeoutMs,
} from "../../../src/event-script.js";

const SOURCE = "export class Arrival extends EventCombinator {\n  main() {}\n}\n";

function accept(request) {
  return {
    runId: request.runId,
    revision: request.revision,
    stepId: request.stepId,
    phase: request.phase,
    tick: request.tick,
    devices: [],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function input(source = SOURCE, extra = {}) {
  return {
    source,
    everyTick: true,
    inputChanged: false,
    stateText: "{}",
    timeoutMs: 1000,
    ...extra,
  };
}

function harness(options = {}) {
  const box = {
    session: null,
    opens: 0,
    released: 0,
    timeouts: [],
    sources: [],
    steps: 0,
    inits: 0,
  };
  function openExecutor(moduleSource, timeoutMs) {
    box.opens += 1;
    box.timeouts.push(timeoutMs);
    box.sources.push(moduleSource);
    if (options.failOpen && box.opens >= options.failOpen) {
      return Promise.reject(new Error("worker-link"));
    }
    let gate = null;
    const executor = {
      replayInit: true,
      prepare(request) {
        if (request.phase === "init") {
          box.inits += 1;
          if (options.failInits?.includes(box.inits)) {
            return Promise.reject(options.failInitsError);
          }
        }
        if (request.phase === "step") {
          box.steps += 1;
          if (options.editOnStep && box.steps === 1) box.session.noteEdit();
          if (options.failSteps && box.steps <= options.failSteps) {
            return Promise.reject(options.stepError);
          }
          if (options.holdStep && box.steps === 1) {
            gate = deferred();
            box.gate = gate;
            return gate.promise.then(() => accept(request));
          }
        }
        return Promise.resolve(accept(request));
      },
    };
    if (options.withStop !== false) {
      executor.stop = () => {
        gate?.reject(new RuntimeError("worker-stopped", "Исполнитель сценария остановлен"));
      };
    }
    const opened = { executor };
    if (options.release !== false) {
      opened.release = () => {
        box.released += 1;
      };
    }
    return opened;
  }
  const session = createEventScriptSession({
    engineHref: "https://example.test/src/index.js",
    openExecutor,
  });
  box.session = session;
  return { session, box };
}

test("компилятор принимает один класс и отбрасывает посторонний модуль", () => {
  assert.equal(compileScenarioSource(1, "https://engine").code, "invalid-script");
  assert.equal(compileScenarioSource(SOURCE, "").code, "invalid-script");
  assert.equal(compileScenarioSource("   ", "https://engine").code, "invalid-script");
  assert.match(compileScenarioSource("import { X } from './x.js';\n", "https://engine").message, /Импорт/);
  assert.match(compileScenarioSource("const load = import('./x.js');\n", "https://engine").message, /Импорт/);
  assert.match(compileScenarioSource("class Arrival extends EventCombinator {}", "https://engine").message, /один export class/);
  assert.match(compileScenarioSource(`${SOURCE}\nexport class Other extends EventCombinator {}`, "https://engine").message, /один export class/);
  assert.match(compileScenarioSource(`${SOURCE}export const devices = [];\n`, "https://engine").message, /только класс/);
  const compiled = compileScenarioSource(`// export class Hidden extends EventCombinator
export class Arrival extends EventCombinator {
  main() {
    const text = "export import(";
    const sample = \`keep\`;
    return text.length + sample.length;
  }
}
`, "https://example.test/src/index.js");
  assert.equal(compiled.ok, true);
  assert.equal(compiled.className, "Arrival");
  assert.match(compiled.moduleSource, /^class Arrival extends EventCombinator/m);
  assert.match(compiled.moduleSource, /export const devices = \[Arrival\]/);
  assert.match(compiled.moduleSource, /import \{ EventCombinator, Signal \} from "https:\/\/example\.test\/src\/index\.js";\s*$/);
  assert.equal(readTimeoutMs(0).code, "invalid-executor");
  assert.equal(readTimeoutMs(1.5).ok, false);
  assert.equal(readTimeoutMs(1).timeoutMs, 1);
  assert.equal(readScenarioSettings({ everyTick: 1, inputChanged: false, stateText: "{}" }).code, "invalid-run");
  assert.equal(readScenarioSettings({ everyTick: true, inputChanged: false, stateText: 1 }).code, "invalid-state");
  assert.match(readScenarioSettings({ everyTick: true, inputChanged: false, stateText: "{" }).message, /не является JSON/);
  assert.equal(readScenarioSettings({ everyTick: true, inputChanged: true, stateText: "" }).state && true, true);
  assert.deepEqual(readScenarioSettings({ everyTick: false, inputChanged: true, stateText: "[1]" }).state, [1]);
  assert.equal(readScenarioSettings({ everyTick: true, inputChanged: false, stateText: "1e309" }).code, "invalid-state");
  assert.deepEqual(formatDiagnostic(null), {
    code: "script-error",
    message: "null",
    deviceId: "",
    tick: "",
    location: "",
  });
  assert.equal(formatDiagnostic({ code: "", deviceId: null, tick: null, location: 1 }).code, "script-error");
  assert.equal(formatDiagnostic({ code: "async-main", deviceId: 0, tick: 0, location: "main" }).tick, "0");
  assert.throws(() => createEventScriptSession({ engineHref: "", openExecutor() {} }), ConfigError);
  assert.throws(() => createEventScriptSession({ engineHref: "https://engine", openExecutor: null }), ConfigError);
});

test("компилятор меняет только объявление в коде", () => {
  const source = [
    '// import helper from "./hidden.js"',
    "/*",
    "export class Hidden extends EventCombinator {}",
    "*/",
    "export class Arrival extends EventCombinator {",
    "  main() { /* marker */",
    '    const text = "export import(";',
    "    const single = 'it\\\\'s';",
    "    const sample = `",
    "export class Nested extends EventCombinator {}",
    "import('./inside-literal.js');",
    "keep\\n",
    "`;",
    "    const value = `${ 1 + { n: 2 } }`;",
    "    const nested = `${ `inner` }`;",
    "    const noted = `${ // export class Skip extends EventCombinator",
    "      /* export class Block extends EventCombinator {} */",
    "      'x' + \"y\" }`;",
    "    return sample.length;",
    "  }",
    "}",
    'const broken = "unterminated',
    "const tail = 'end",
  ].join("\n");
  const compiled = compileScenarioSource(source, "https://example.test/src/index.js");
  assert.equal(compiled.ok, true, compiled.message);
  assert.equal(compiled.className, "Arrival");
  assert.equal(compiled.moduleSource.includes("export class Arrival"), false);
  assert.match(compiled.moduleSource, /^class Arrival extends EventCombinator \{/m);
  assert.match(compiled.moduleSource, /export class Hidden/);
  assert.match(compiled.moduleSource, /export class Nested/);
  assert.match(compiled.moduleSource, /import\('\.\/inside-literal\.js'\)/);
  const markerLine = source.split("\n").findIndex((line) => line.includes("marker"));
  assert.equal(compiled.moduleSource.split("\n").findIndex((line) => line.includes("marker")), markerLine);
  assert.match(compiled.moduleSource, /export const devices = \[Arrival\]/);
  assert.match(compileScenarioSource("/* export class Arrival extends EventCombinator {}", "https://engine").message, /один export class/);
  assert.match(
    compileScenarioSource("export class Arrival extends EventCombinator {}\nconst load = `${import(\"./x.js\")}`;", "https://engine").message,
    /Импорт/,
  );
  assert.equal(compileScenarioSource("export class Arrival extends EventCombinator {}\nconst raw = `", "https://engine").ok, true);
  assert.equal(compileScenarioSource("export class Arrival extends EventCombinator {}\nconst raw = `\\", "https://engine").ok, true);
  assert.equal(compileScenarioSource("export class Arrival extends EventCombinator {}\nconst slash = \"\\", "https://engine").ok, true);
  assert.equal(
    compileScenarioSource("export class Arrival extends EventCombinator {}\nconst t = `${ /*", "https://engine").ok,
    true,
  );
});

test("проверка, шаг и сброс держат одну опубликованную границу", async () => {
  const { session, box } = harness();
  assert.equal(session.view().status, "idle");
  await assert.rejects(session.reset(), (error) => error.code === "run-paused");
  await assert.rejects(session.stop(), (error) => error.code === "run-paused");
  await assert.rejects(session.check(input(SOURCE, { timeoutMs: 0 })), (error) => error instanceof ConfigError && error.code === "invalid-executor");
  assert.equal(session.view().status, "failed");
  await assert.rejects(session.check(input("нет класса")), (error) => error.code === "invalid-script");
  await assert.rejects(session.check(input(SOURCE, { everyTick: "yes" })), (error) => error.code === "invalid-run");
  await assert.rejects(session.check(input(SOURCE, { stateText: "{" })), (error) => error.code === "invalid-state");
  assert.equal(box.opens, 0);
  const started = await session.check(input(SOURCE, { stateText: "{\"n\":1}", inputChanged: true }));
  assert.equal(started.revision, 1);
  assert.equal(started.tick, 0);
  assert.equal(started.runId, 1);
  assert.equal(started.className, "Arrival");
  assert.equal(started.shell, "EventCombinator");
  assert.equal(started.canStep, true);
  assert.match(box.sources[0], /export const devices = \[Arrival\]/);
  const stepped = await session.step();
  assert.equal(stepped.tick, 1);
  assert.equal(stepped.runId, 1);
  assert.deepEqual(stepped.state, { n: 1 });
  session.noteEdit();
  assert.equal(session.view().status, "paused");
  await assert.rejects(session.step(), (error) => error.code === "run-paused");
  await assert.rejects(session.check(input("export const devices = [];\n")), (error) => error.code === "invalid-script");
  assert.equal(session.view().revision, 1);
  assert.equal(session.view().status, "paused");
  const again = await session.check(input());
  assert.equal(again.revision, 2);
  assert.equal(again.tick, 0);
  assert.equal(box.released >= 1, true);
  await assert.rejects(session.restore(), (error) => error.code === "invalid-snapshot");
  const remembered = session.remember();
  assert.equal(remembered, 0);
  await session.step();
  await session.step();
  assert.equal(session.view().tick, 2);
  const restored = await session.restore();
  assert.equal(restored.tick, 0);
  assert.equal(restored.runId, session.view().runId);
  const runId = session.view().runId;
  const reset = await session.reset();
  assert.equal(reset.tick, 0);
  assert.equal(reset.runId, runId + 1);
  assert.equal(reset.status, "ready");
});

test("повторный шаг, правка и остановка не публикуют чужой ответ", async () => {
  const held = harness({ holdStep: true });
  await held.session.check(input());
  const first = held.session.step();
  await assert.rejects(held.session.step(), (error) => error.code === "step-busy");
  await assert.rejects(held.session.check(input()), (error) => error.code === "step-busy");
  await assert.rejects(async () => held.session.remember(), (error) => error.code === "step-busy");
  await assert.rejects(held.session.restore(), (error) => error.code === "step-busy");
  const reset = await held.session.reset();
  await first;
  assert.equal(reset.tick, 0);
  assert.notEqual(reset.runId, 1);
  assert.equal(held.session.view().status, "ready");

  const edited = harness({ editOnStep: true });
  await edited.session.check(input());
  await assert.rejects(edited.session.step(), (error) => error.code === "run-paused");
  assert.equal(edited.session.view().tick, 0);
  assert.equal(edited.session.view().dirty, true);

  const stopping = harness();
  await stopping.session.check(input());
  await stopping.session.step();
  const runId = stopping.session.view().runId;
  stopping.session.setTimeoutMs(40);
  const paused = await stopping.session.stop();
  assert.equal(paused.tick, 1);
  assert.equal(paused.runId, runId);
  assert.equal(paused.status, "paused");
  assert.equal(stopping.box.timeouts.at(-1), 40);
  assert.throws(() => stopping.session.setTimeoutMs(0), ConfigError);
  stopping.session.noteEdit();
  await assert.rejects(stopping.session.stop(), (error) => error.code === "run-paused");

  const during = harness({ holdStep: true });
  await during.session.check(input());
  const spinning = during.session.step();
  const stopped = await during.session.stop();
  await spinning;
  assert.equal(stopped.tick, 0);
  assert.equal(stopped.runId, 1);
});

test("timeout и ошибка сценария оставляют границу и оживляют только живой Worker", async () => {
  const timed = harness({
    failSteps: 1,
    stepError: new RuntimeError("timeout", "Исполнитель сценария не ответил вовремя"),
  });
  await timed.session.check(input());
  await assert.rejects(timed.session.step(), (error) => error.code === "timeout" && error.tick === 0 && error.deviceId === "d1");
  assert.equal(timed.session.view().tick, 0);
  assert.equal(timed.session.view().diagnostic.tick, "0");
  assert.equal(timed.session.view().diagnostic.deviceId, "d1");
  assert.equal(timed.session.view().status, "paused");
  assert.equal(timed.session.view().canStep, true);
  const continued = await timed.session.step();
  assert.equal(continued.tick, 1);

  const markedTimeout = harness({
    failSteps: 1,
    stepError: Object.assign(new RuntimeError("timeout", "уже помечен"), { tick: 4, deviceId: "other" }),
  });
  await markedTimeout.session.check(input());
  await assert.rejects(
    markedTimeout.session.step(),
    (error) => error.tick === 4 && error.deviceId === "other",
  );
  assert.equal(markedTimeout.session.view().diagnostic.deviceId, "other");

  const stopped = harness({
    failSteps: 1,
    stepError: new RuntimeError("worker-stopped", "Исполнитель сценария остановлен"),
  });
  await stopped.session.check(input());
  await assert.rejects(stopped.session.step(), (error) => error.code === "worker-stopped");
  assert.equal(stopped.session.view().tick, 0);

  const broken = harness({
    failSteps: 1,
    stepError: Object.assign(new RuntimeError("async-main", "синхронно"), { deviceId: "d1", tick: 0, location: "main" }),
  });
  await broken.session.check(input());
  await assert.rejects(broken.session.step(), (error) => error.location === "main" && error.deviceId === "d1");
  assert.equal(broken.session.view().diagnostic.code, "async-main");
  assert.equal(broken.session.view().tick, 0);
  assert.equal(broken.box.opens, 1);

  const initError = harness({
    failInits: [2],
    failInitsError: new RuntimeError("script-error", "init сломан"),
  });
  await initError.session.check(input());
  await assert.rejects(initError.session.reset(), (error) => error.code === "script-error");
  assert.equal(initError.session.view().status, "paused");

  const initTimeout = harness({
    failInits: [2],
    failInitsError: new RuntimeError("timeout", "Исполнитель сценария не ответил вовремя"),
  });
  await initTimeout.session.check(input());
  const retried = await initTimeout.session.reset();
  assert.equal(retried.tick, 0);
  assert.equal(retried.status, "ready");

  const initStopped = harness({
    failInits: [2],
    failInitsError: new RuntimeError("worker-stopped", "Исполнитель сценария остановлен"),
  });
  await initStopped.session.check(input());
  assert.equal((await initStopped.session.reset()).tick, 0);

  const offline = harness({ failOpen: 1 });
  await assert.rejects(offline.session.check(input()), (error) => error.message === "worker-link");
  assert.equal(offline.session.view().status, "failed");
  assert.equal(offline.session.view().canStep, false);

  const initBind = harness();
  const rejected = {
    executor: {
      prepare() {
        return Promise.reject(new RuntimeError("script-error", "сборка"));
      },
    },
  };
  const custom = createEventScriptSession({
    engineHref: "https://example.test/src/index.js",
    openExecutor() {
      return rejected;
    },
  });
  await assert.rejects(custom.check(input()), (error) => error.message === "сборка");
  assert.equal(custom.view().status, "failed");
  void initBind;

  const revive = harness({
    failSteps: 1,
    failOpen: 2,
    stepError: new RuntimeError("timeout", "Исполнитель сценария не ответил вовремя"),
  });
  await revive.session.check(input());
  await assert.rejects(revive.session.step(), (error) => error.message === "worker-link");
  assert.equal(revive.session.view().status, "failed");
  await assert.rejects(revive.session.step(), (error) => error.code === "worker-stopped");

  const resetRevive = harness({ failOpen: 2, failInits: [2], failInitsError: new RuntimeError("worker-stopped", "стоп") });
  await resetRevive.session.check(input());
  await assert.rejects(resetRevive.session.reset(), (error) => error.message === "worker-link");
  assert.equal(resetRevive.session.view().status, "failed");

  const noStop = harness({ withStop: false, holdStep: true });
  await noStop.session.check(input());
  const pending = noStop.session.step();
  noStop.session.noteEdit();
  noStop.box.gate.resolve();
  await assert.rejects(pending, (error) => error.code === "run-paused");
  assert.equal(noStop.session.view().tick, 0);

  await assert.rejects(harness().session.restore(), (error) => error.code === "run-paused");
  const bare = harness({ release: false });
  await bare.session.check(input());
  await bare.session.check(input());
  assert.equal(bare.session.view().revision, 2);
  assert.equal(bare.box.released, 0);
});

test("discard снимает прогон и не принимает опоздавшее открытие", async () => {
  const ready = harness();
  await ready.session.check(input());
  await ready.session.step();
  const cleared = ready.session.discard();
  assert.equal(cleared.status, "idle");
  assert.equal(cleared.runId, null);
  assert.equal(cleared.tick, null);
  assert.equal(cleared.canStep, false);
  assert.equal(ready.box.released >= 1, true);

  let finish;
  let released = 0;
  const session = createEventScriptSession({
    engineHref: "https://example.test/src/index.js",
    openExecutor() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const pending = session.check(input());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(session.discard().status, "idle");
  finish({
    executor: {
      prepare() {
        return Promise.resolve(accept({ runId: 1, revision: 1, stepId: 1, phase: "init", tick: 0 }));
      },
      stop() {},
    },
    release() {
      released += 1;
    },
  });
  const view = await pending;
  assert.equal(view.status, "idle");
  assert.equal(view.runId, null);
  assert.equal(released, 1);
});
