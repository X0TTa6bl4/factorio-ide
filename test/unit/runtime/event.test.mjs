import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "../../../src/event.js";
import { fnv1a32, initialRng, xorshift32 } from "../../../src/rng.js";
import { canonicalSignal } from "../../../src/signal-codec.js";
import {
  Circuit,
  ConfigError,
  EventCombinator,
  INT32_MAX,
  INT32_MIN,
  RuntimeError,
  Signal,
  openProfile,
} from "../../../src/index.js";
import { rejectsCode, throwsCode } from "../signals/support.mjs";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;
const redOnly = { red: true, green: false };
const greenOnly = { red: false, green: true };
const both = { red: true, green: true };
const neither = { red: false, green: false };

function count(signal, constant) {
  return { signal, constant };
}

function output(red, green, signals) {
  return { red, green, signals };
}

function source(ports, signals) {
  return { enabled: true, signals, ...ports };
}

function computed(ports, compute) {
  return { ...ports, compute };
}

async function rejectsRuntime(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "RuntimeError");
    assert.equal(error.code, code);
    return true;
  });
}

function envelope(overrides) {
  return {
    from: "d1",
    to: "d1",
    sentTick: 0,
    deliveryTick: 1,
    sequence: 0,
    type: "x",
    data: null,
    ...overrides,
  };
}

async function steps(simulation, countSteps) {
  for (let index = 0; index < countSteps; index += 1) await simulation.step();
}

test("векторы FNV-1a и xorshift32 совпадают с контрактом", () => {
  assert.equal(fnv1a32(""), 2166136261);
  assert.equal(fnv1a32("a"), 3826002220);
  assert.equal(fnv1a32("d1"), 2283607014);
  assert.equal(fnv1a32("я"), 1086369929);
  assert.equal(initialRng(fnv1a32("d1"), "d1"), 0x6d2b79f5);
  assert.notEqual(initialRng(1, "d1"), 0x6d2b79f5);
  let state = 1;
  assert.equal(state = xorshift32(state), 270369);
  assert.equal(state = xorshift32(state), 67634689);
  assert.equal(xorshift32(state), 2647435461);
  const iron = openProfile("space-age").tree.Intermediate.iron_plate;
  const rare = canonicalSignal("space-age", { type: iron.type, name: iron.name, quality: "rare" });
  assert.equal(rare.quality, "rare");
  assert.equal(canonicalSignal("space-age", { type: iron.type, name: iron.name, quality: "rare" }), rare);
  assert.equal(canonicalSignal("base", { type: A.type, name: A.name, quality: A.quality }), A);
  assert.equal(canonicalSignal("base", { type: A.type, name: A.name }), A);
  throwsCode(() => canonicalSignal("base", null), "invalid-signal");
  throwsCode(() => canonicalSignal("base", []), "invalid-signal");
  throwsCode(() => canonicalSignal("base", { type: "missing", name: "missing" }), "unknown-signal");
});

test("конструктор проверяет настройки и не запускает сценарий", () => {
  let calls = 0;
  class Probe extends EventCombinator {
    init() {
      calls += 1;
    }
  }
  const event = new Probe({});
  assert.equal(calls, 0);
  assert.equal(event.participate, true);
  assert.deepEqual(event.runMode, { every_tick: true, input_changed: false });
  assert.deepEqual(event.state, {});
  event.state = { n: 1 };
  assert.deepEqual(event.state, { n: 1 });
  const quiet = new Probe({ run: { every_tick: false, input_changed: false }, state: { ok: true } });
  assert.equal(quiet.state.ok, true);
  assert.throws(() => quiet.tick, (error) => error instanceof RuntimeError && error.code === "inactive-script");
  assert.throws(() => quiet.readSignal(A, redOnly), (error) => error instanceof RuntimeError && error.code === "inactive-script");
  assert.throws(() => { quiet.tick = 1; }, (error) => error instanceof RuntimeError && error.code === "readonly");
  for (const config of [undefined, null, [], "x", 1]) {
    throwsCode(() => new Probe(config), "invalid-event-config");
  }
  throwsCode(() => new Probe({ peers: {} }), "invalid-event-config");
  throwsCode(() => new Probe({ red_input: "red_1" }), "invalid-port");
  throwsCode(() => new Probe({ green_output: 1 }), "invalid-port");
  throwsCode(() => new Probe({ red_output: [] }), "invalid-port");
  throwsCode(() => new Probe({ state: undefined }), "invalid-state");
  for (const run of [null, [], 1, {}, { every_tick: true }, { every_tick: true, input_changed: false, extra: 1 }, { every_tick: 1, input_changed: false }]) {
    throwsCode(() => new Probe({ run }), "invalid-run");
  }
});

test("ER-01 init и константа дают A=5 независимо от порядка", async () => {
  class Hold extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 2)]));
    }
  }
  for (const eventsFirst of [true, false]) {
    const circuit = new Circuit();
    const red = circuit.network("red_1");
    const event = new Hold({ red_output: red, run: { every_tick: false, input_changed: false } });
    const constant = source({ red_output: red }, [count(A, 3)]);
    if (eventsFirst) {
      circuit.add(event);
      circuit.add(constant);
    } else {
      circuit.add(constant);
      circuit.add(event);
    }
    const simulation = await circuit.createSimulation();
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.read(red, A), 5);
  }
});

test("ER-02 чтение в init отменяет весь старт", async () => {
  let first = 0;
  class First extends EventCombinator {
    init() {
      first += 1;
      this.setOutput(output(true, false, [count(A, 2)]));
    }
  }
  class Second extends EventCombinator {
    init() {
      this.readSignals(redOnly);
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const spare = circuit.network("green_spare");
  circuit.add(new First({ red_output: red }));
  circuit.add(new Second({ red_input: red }));
  await rejectsRuntime(circuit.createSimulation(), "forbidden-read");
  assert.equal(first, 1);
  assert.equal(circuit.network("green_spare"), spare);
  assert.equal(circuit.network("red_1"), red);
});

test("ER-03 вход неизменяем, выход виден следующему вычислителю на следующем тике", async () => {
  class Mirror extends EventCombinator {
    main() {
      const seen = this.readSignals(redOnly);
      assert.equal(Object.isFrozen(seen), true);
      assert.throws(() => {
        seen[0].constant = 0;
      }, TypeError);
      this.state.value = this.readSignal(A, redOnly);
      this.setOutput(output(false, true, [count(B, this.state.value)]));
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  circuit.add(source({ red_output: red }, [count(A, 3)]));
  circuit.add(new Mirror({ red_input: red, green_output: green }));
  circuit.add(computed({ green_input: green, red_output: red }, (view) => ({
    signals: [count(C, view.read(B, greenOnly))],
  })));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(green, B), 0);
  await simulation.step();
  assert.equal(simulation.read(green, B), 3);
  assert.equal(simulation.read(red, C), 0);
  await simulation.step();
  assert.equal(simulation.read(red, C), 3);
  assert.equal(simulation.read(red, A), 3);
});

test("ER-04 ER-05 импульс живёт заданное число границ без main", async () => {
  class Pulse extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 2)]));
      this.wakeAt(0);
    }

    main() {
      this.state.runs = (this.state.runs ?? 0) + 1;
      this.pulse(output(true, false, [count(A, 3)]), 2);
    }
  }
  class Short extends EventCombinator {
    init() {
      this.pulse(output(true, false, [count(A, 4)]));
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const event = new Pulse({ red_output: red, run: { every_tick: false, input_changed: false } });
  circuit.add(event);
  const simulation = await circuit.createSimulation();
  const trace = [simulation.read(red, A)];
  for (let step = 0; step < 3; step += 1) {
    await simulation.step();
    trace.push(simulation.read(red, A));
  }
  assert.deepEqual(trace, [2, 5, 5, 2]);
  assert.equal(simulation.device(event).state.runs, 1);

  const other = new Circuit();
  const wire = other.network("red_1");
  other.add(new Short({ red_output: wire, run: { every_tick: false, input_changed: false } }));
  const short = await other.createSimulation();
  assert.equal(short.read(wire, A), 4);
  await short.step();
  assert.equal(short.read(wire, A), 0);
});

test("ER-06 пересечение импульсов суммируется, сроки независимы", async () => {
  class Mix extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 2)]));
      this.pulse(output(true, false, [count(A, 3)]), 2);
      this.pulse(output(true, false, [count(A, 4)]), 1);
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  circuit.add(new Mix({ red_output: red, run: { every_tick: false, input_changed: false } }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 9);
  await simulation.step();
  assert.equal(simulation.read(red, A), 5);
  await simulation.step();
  assert.equal(simulation.read(red, A), 2);
});

test("ER-07 ER-08 ER-10 удержание заменяется, импульс переживает set", async () => {
  class Replace extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 1), count(B, 2)]));
      this.setOutput(output(true, false, [count(A, 3)]));
      this.setOutput(output(false, true, [count(C, 4)]));
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  circuit.add(new Replace({ red_output: red, green_output: green, run: { every_tick: false, input_changed: false } }));
  const replaced = await circuit.createSimulation();
  assert.equal(replaced.read(red, A), 3);
  assert.equal(replaced.read(red, B), 0);
  assert.equal(replaced.read(green, C), 4);

  class ClearHold extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 2)]));
      this.pulse(output(true, false, [count(A, 3)]), 3);
      this.wakeAt(0);
    }

    main() {
      this.setOutput(output(true, false, []));
    }
  }
  const second = new Circuit();
  const wire = second.network("red_1");
  second.add(new ClearHold({ red_output: wire, run: { every_tick: false, input_changed: false } }));
  const cleared = await second.createSimulation();
  assert.equal(cleared.read(wire, A), 5);
  await cleared.step();
  assert.equal(cleared.read(wire, A), 3);
  await cleared.step();
  assert.equal(cleared.read(wire, A), 3);
  await cleared.step();
  assert.equal(cleared.read(wire, A), 0);

  class KeepPulse extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 1)]));
      this.pulse(output(true, false, [count(A, 3)]), 2);
      this.setOutput(output(true, false, [count(A, 4)]));
    }
  }
  const third = new Circuit();
  const kept = third.network("red_1");
  third.add(new KeepPulse({ red_output: kept, run: { every_tick: false, input_changed: false } }));
  const simulation = await third.createSimulation();
  assert.equal(simulation.read(kept, A), 7);
  await simulation.step();
  assert.equal(simulation.read(kept, A), 7);
  await simulation.step();
  assert.equal(simulation.read(kept, A), 4);
});

test("ER-09 порядок clear и pulse в одном main", async () => {
  class Order extends EventCombinator {
    init() {
      this.pulse(output(true, false, [count(A, 3)]), 2);
      if (this.state.order === "pulse-clear") this.clearOutput(redOnly);
      if (this.state.order === "clear-pulse") {
        this.clearOutput(redOnly);
        this.pulse(output(true, false, [count(B, 4)]), 2);
      }
    }
  }
  const empty = new Circuit();
  const red = empty.network("red_1");
  empty.add(new Order({
    red_output: red,
    state: { order: "pulse-clear" },
    run: { every_tick: false, input_changed: false },
  }));
  const cleared = await empty.createSimulation();
  assert.equal(cleared.read(red, A), 0);
  assert.equal(cleared.device(empty.devices[0]).pulses.length, 0);

  const next = new Circuit();
  const wire = next.network("red_1");
  next.add(new Order({
    red_output: wire,
    state: { order: "clear-pulse" },
    run: { every_tick: false, input_changed: false },
  }));
  const created = await next.createSimulation();
  assert.equal(created.read(wire, B), 4);
  assert.equal(created.device(next.devices[0]).pulses.length, 1);
});

test("оба цвета одного вызова получают независимые копии", async () => {
  class Both extends EventCombinator {
    init() {
      this.setOutput(output(true, true, [count(C, 3)]));
      this.pulse(output(true, true, [count(A, 1)]), 2);
      this.pulse(output(false, true, [count(B, 2)]), 1);
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  circuit.add(new Both({
    red_output: red,
    green_output: green,
    run: { every_tick: false, input_changed: false },
  }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, C), 3);
  assert.equal(simulation.read(green, C), 3);
  assert.equal(simulation.read(red, A), 1);
  assert.equal(simulation.read(green, A), 1);
  assert.equal(simulation.read(green, B), 2);
  assert.equal(simulation.read(red, B), 0);
  await simulation.step();
  assert.equal(simulation.read(green, B), 0);
  assert.equal(simulation.read(red, A), 1);
});

test("неверный rng в правке не публикуется", async () => {
  const circuit = new Circuit();
  const event = { participate: true };
  circuit.add(event);
  const values = ["1", 1.5, -1, 4294967296];
  for (const rng of values) {
    const executor = {
      prepare(request) {
        return {
          runId: request.runId,
          revision: request.revision,
          stepId: request.stepId,
          phase: request.phase,
          tick: request.tick,
          devices: request.phase === "init" ? [] : [{ id: circuit.deviceId(event), rng }],
        };
      },
    };
    const simulation = await circuit.createSimulation({ executor });
    await rejectsRuntime(simulation.step(), "invalid-rng");
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.device(event).rng, null);
  }
});

test("две новые границы сортируются, readSignals в init запрещён, пустой rng отклоняется", async () => {
  class Plan extends EventCombinator {
    init() {
      this.wakeAt(8);
      this.wakeAt(9);
      this.wakeAt(0);
      this.setOutput(output(false, true, [count(B, 1)]));
      this.clearOutput({ red: false, green: true });
    }

    main() {
      this.cancelWake(8);
      this.cancelWake(9);
      this.wakeAt(5);
      this.wakeAt(2);
      this.send(this, { type: "list", data: [1, { ok: true }] });
    }
  }
  const circuit = new Circuit();
  const event = new Plan({});
  circuit.add(event);
  const simulation = await circuit.createSimulation();
  simulation.capture();
  assert.deepEqual(simulation.device(event).wakes, [0, 8, 9]);
  await simulation.step();
  assert.deepEqual(simulation.device(event).wakes, [2, 5]);

  class Reads extends EventCombinator {
    init() {
      this.readSignal(A, redOnly);
    }
  }
  const other = new Circuit();
  other.add(new Reads({}));
  await rejectsRuntime(other.createSimulation(), "forbidden-read");

  class Bare extends EventCombinator {
    main() {
      this.random();
    }
  }
  const bare = new Bare({});
  assert.throws(() => runScript(bare, {
    id: "d9",
    phase: "step",
    tick: 0,
    nextTick: 1,
    profile: "base",
    view: {
      state: {},
      rng: null,
      messages: [],
      wakes: [],
      receiverId: null,
      inputs: { red: [], green: [] },
    },
    ids: new Map(),
    byId: new Map(),
  }), (error) => error.code === "invalid-rng");
});

test("ER-11 цвета независимы, false-false ничего не меняет, пустой порт молчит", async () => {
  class Colors extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 2)]));
      this.setOutput(output(false, true, [count(B, 5)]));
      this.setOutput(output(false, false, [count(C, 9)]));
      this.clearOutput(neither);
      this.pulse(output(false, false, [count(C, 8)]), 2);
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  circuit.add(new Colors({ red_output: red, run: { every_tick: false, input_changed: false } }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 2);
  assert.equal(simulation.read(red, B), 0);
  assert.equal(simulation.read(red, C), 0);
  const orphan = new Circuit();
  const detached = new Colors({ run: { every_tick: false, input_changed: false } });
  orphan.add(detached);
  const quiet = await orphan.createSimulation();
  assert.equal(quiet.capture().networks.length, 0);
  assert.equal(quiet.device(detached).output.red[0].constant, 2);
  assert.equal(quiet.device(detached).output.green[0].constant, 5);
});

test("ER-12 дубли, ноль и отрицательные складываются по int32", async () => {
  class Sum extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [
        count(A, 1),
        count(A, 2),
        count(B, 5),
        count(B, -5),
        count(C, -2),
      ]));
      this.setOutput(output(false, true, [count(C, INT32_MAX), count(C, 1)]));
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  circuit.add(new Sum({ red_output: red, green_output: green, run: { every_tick: false, input_changed: false } }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(red, B), 0);
  assert.equal(simulation.read(red, C), -2);
  assert.equal(simulation.read(green, A), 0);
  assert.equal(simulation.read(green, C), INT32_MIN);
});

test("ER-13 неверный импульс, сигнал и state не публикуют шаг", async () => {
  let mode = "ok";
  class Probe extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 1)]));
    }

    main() {
      if (mode === "zero") this.pulse(output(true, false, [count(B, 1)]), 0);
      if (mode === "negative") this.pulse(output(true, false, [count(B, 1)]), -1);
      if (mode === "fraction") this.pulse(output(true, false, [count(B, 1)]), 1.5);
      if (mode === "meta") this.setOutput(output(true, false, [count(Signal.Meta.signal_each, 1)]));
      if (mode === "mixed") this.setOutput(output(true, false, [1]));
      if (mode === "state") this.state = { bad: undefined };
      if (mode === "profile") {
        this.setOutput(output(true, false, [count(openProfile("space-age").tree.Intermediate.iron_plate, 1)]));
      }
    }
  }
  const cases = [
    ["zero", "invalid-pulse"],
    ["negative", "invalid-pulse"],
    ["fraction", "invalid-pulse"],
    ["meta", "meta-signal"],
    ["mixed", "invalid-signal-count"],
    ["state", "invalid-state"],
    ["profile", "wrong-profile"],
  ];
  for (const [next, code] of cases) {
    mode = next;
    const circuit = new Circuit();
    const red = circuit.network("red_1");
    circuit.add(new Probe({ red_output: red }));
    const simulation = await circuit.createSimulation();
    const before = simulation.capture();
    if (code === "meta-signal" || code === "invalid-signal-count" || code === "wrong-profile") {
      await rejectsCode(simulation.step(), code);
    } else await rejectsRuntime(simulation.step(), code);
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.read(red, A), 1);
    assert.deepEqual(simulation.capture(), before);
  }
});

test("ER-14 every_tick и input_changed дают один main", async () => {
  class Counter extends EventCombinator {
    main() {
      this.state.ticks = [...(this.state.ticks ?? []), this.tick];
    }
  }
  const changed = new Circuit();
  const red = changed.network("red_1");
  const event = new Counter({
    red_input: red,
    run: { every_tick: false, input_changed: true },
  });
  changed.add(event);
  changed.add(computed({ red_output: red }, (view) => ({
    signals: [count(B, view.tick === 0 ? 1 : view.tick === 2 ? 2 : 1)],
  })));
  const simulation = await changed.createSimulation();
  await steps(simulation, 4);
  assert.deepEqual(simulation.device(event).state.ticks, [0, 1, 3]);

  const always = new Circuit();
  const wire = always.network("red_1");
  const steady = new Counter({ red_input: wire });
  always.add(source({ red_output: wire }, [count(A, 3)]));
  always.add(steady);
  const ticking = await always.createSimulation();
  await steps(ticking, 3);
  assert.deepEqual(ticking.device(steady).state.ticks, [0, 1, 2]);

  const pair = new Circuit();
  const left = pair.network("red_1");
  const right = pair.network("green_1");
  const bothInputs = new Counter({
    red_input: left,
    green_input: right,
    run: { every_tick: false, input_changed: true },
  });
  pair.add(bothInputs);
  pair.add(computed({ red_output: left }, () => ({ signals: [count(A, 1)] })));
  pair.add(computed({ green_output: right }, () => ({ signals: [count(B, 1)] })));
  const joined = await pair.createSimulation();
  await steps(joined, 3);
  assert.deepEqual(joined.device(bothInputs).state.ticks, [0, 1]);
});

test("ER-15 wake, вход и сообщение будят один main", async () => {
  class Sender extends EventCombinator {
    init() {
      this.wakeAt(98);
    }

    main() {
      this.send(this.peers.receiver, { type: "go", data: { n: 1 } });
    }
  }
  class Receiver extends EventCombinator {
    init() {
      this.wakeAt(99);
    }

    main() {
      this.state.ticks = [...(this.state.ticks ?? []), this.tick];
      this.state.next = this.nextTick;
      this.state.inbox = this.messages.length;
      this.state.input = this.readSignal(B, redOnly);
      if (this.tick === 99) this.setOutput(output(true, false, [count(A, 7)]));
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const receiver = new Receiver({
    red_input: red,
    red_output: red,
    run: { every_tick: false, input_changed: true },
  });
  const sender = new Sender({ run: { every_tick: false, input_changed: false } });
  circuit.add(receiver);
  circuit.add(computed({ red_output: red }, (view) => ({
    signals: view.tick === 98 ? [count(B, 5)] : [],
  })));
  circuit.add(sender);
  circuit.setPeers(sender, { receiver });
  const simulation = await circuit.createSimulation();
  await steps(simulation, 100);
  assert.equal(simulation.tick, 100);
  assert.equal(simulation.read(red, A), 7);
  assert.deepEqual(simulation.device(receiver).state.ticks, [0, 99]);
  assert.equal(simulation.device(receiver).state.next, 100);
  assert.equal(simulation.device(receiver).state.inbox, 1);
  assert.equal(simulation.device(receiver).state.input, 5);
});

test("ER-16 прошлое пробуждение — ошибка, отменённое будущее не наступает", async () => {
  let mode = "current";
  class Waker extends EventCombinator {
    main() {
      if (mode === "current") this.wakeAt(this.tick);
      if (mode === "past") this.wakeAt(0);
      if (mode === "idle") this.state.ready = true;
      if (mode === "fraction") this.wakeAt(1.5);
      if (mode === "text") this.wakeAt("1");
    }
  }
  for (const [next, code] of [["current", "invalid-wake"], ["fraction", "invalid-wake"], ["text", "invalid-wake"]]) {
    mode = next;
    const circuit = new Circuit();
    circuit.add(new Waker({}));
    const simulation = await circuit.createSimulation();
    await rejectsRuntime(simulation.step(), code);
    assert.equal(simulation.tick, 0);
  }
  mode = "idle";
  const later = new Circuit();
  later.add(new Waker({}));
  const simulation = await later.createSimulation();
  await simulation.step();
  mode = "past";
  await rejectsRuntime(simulation.step(), "invalid-wake");
  assert.equal(simulation.tick, 1);

  class Plan extends EventCombinator {
    init() {
      this.wakeAt(0);
      this.wakeAt(3);
      this.wakeAt(3);
    }

    main() {
      this.cancelWake(3);
      this.wakeAt(4);
      this.cancelWake(4);
      this.state.n = (this.state.n ?? 0) + 1;
    }
  }
  const planned = new Circuit();
  const event = new Plan({ run: { every_tick: false, input_changed: false } });
  planned.add(event);
  const run = await planned.createSimulation();
  await steps(run, 5);
  assert.equal(run.device(event).state.n, 1);
  assert.deepEqual(run.device(event).wakes, []);
});

test("ER-17 сообщение шага 0 читается на 1 и влияет на выход на 2", async () => {
  class Sender extends EventCombinator {
    init() {
      this.wakeAt(0);
    }

    main() {
      const data = { trainId: "train-1", nested: { ok: true } };
      this.send(this.peers.receiver, { type: "train-arrived", data });
      data.trainId = "changed";
      data.nested.ok = false;
    }
  }
  class Receiver extends EventCombinator {
    main() {
      const message = this.messages[0];
      let frozen = false;
      try {
        message.data.trainId = "mutated";
      } catch (error) {
        frozen = error instanceof TypeError;
      }
      this.state.trainId = message.data.trainId;
      this.state.frozen = frozen && Object.isFrozen(this.messages);
      this.setOutput(output(true, false, [count(B, 1)]));
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const sender = new Sender({ run: { every_tick: false, input_changed: false } });
  const receiver = new Receiver({
    red_output: red,
    run: { every_tick: false, input_changed: false },
  });
  circuit.add(sender);
  circuit.add(receiver);
  circuit.setPeers(sender, { receiver });
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(red, B), 0);
  const inbox = simulation.device(receiver).messages;
  assert.equal(inbox[0].type, "train-arrived");
  assert.equal(inbox[0].sentTick, 0);
  assert.equal(inbox[0].deliveryTick, 1);
  assert.deepEqual(inbox[0].data, { trainId: "train-1", nested: { ok: true } });
  await simulation.step();
  assert.equal(simulation.tick, 2);
  assert.equal(simulation.read(red, B), 1);
  assert.equal(simulation.device(receiver).state.trainId, "train-1");
  assert.equal(simulation.device(receiver).state.frozen, true);
  assert.deepEqual(simulation.device(receiver).messages, []);
});

test("ER-18 порядок доставки зависит от id, а не от порядка добавления", async () => {
  function build(names) {
    const circuit = new Circuit();
    const red = circuit.network("red_1");
    const receiver = new EventCombinator({
      red_output: red,
      run: { every_tick: false, input_changed: false },
    });
    const senders = names.map((name) => {
      const sender = new class extends EventCombinator {
        init() {
          this.wakeAt(0);
        }

        main() {
          this.send(this.peers.receiver, { type: name, data: { name } });
          this.send(this.peers.receiver, { type: `${name}-2`, data: { name } });
          this.setOutput(output(true, false, [count(name === "a" ? A : name === "b" ? B : C, 1)]));
        }
      }({ red_output: red, run: { every_tick: false, input_changed: false } });
      return sender;
    });
    circuit.add(receiver);
    for (const sender of senders) circuit.add(sender);
    for (const sender of senders) circuit.setPeers(sender, { receiver });
    return { circuit, receiver };
  }
  async function inbox(names) {
    const { circuit, receiver } = build(names);
    const simulation = await circuit.createSimulation();
    await simulation.step();
    const messages = simulation.device(receiver).messages;
    const sorted = messages.slice().sort((left, right) => (
      left.from === right.from ? left.sequence - right.sequence : left.from < right.from ? -1 : 1
    ));
    assert.deepEqual(messages, sorted);
    await simulation.step();
    assert.deepEqual(simulation.device(receiver).messages, []);
    return {
      values: [simulation.read(circuit.network("red_1"), A), simulation.read(circuit.network("red_1"), B), simulation.read(circuit.network("red_1"), C)],
      types: messages.map((message) => message.type),
    };
  }
  const forward = await inbox(["a", "b", "c"]);
  const reverse = await inbox(["c", "b", "a"]);
  assert.deepEqual(forward.values, [1, 1, 1]);
  assert.deepEqual(reverse.values, [1, 1, 1]);
  assert.deepEqual(forward.types, ["a", "a-2", "b", "b-2", "c", "c-2"]);
  assert.deepEqual(reverse.types, ["c", "c-2", "b", "b-2", "a", "a-2"]);
  assert.deepEqual(await inbox(["a", "b", "c"]), forward);
});

test("ER-19 чужой получатель и send в init не оставляют сообщение", async () => {
  class Early extends EventCombinator {
    init() {
      this.send(this, { type: "x", data: {} });
    }
  }
  const circuit = new Circuit();
  const spare = circuit.network("green_spare");
  circuit.add(new Early({}));
  await rejectsRuntime(circuit.createSimulation(), "forbidden-send");
  assert.equal(circuit.network("green_spare"), spare);

  const foreign = new Circuit();
  const outsider = new EventCombinator({});
  foreign.add(outsider);
  let mode = "foreign";
  class Sender extends EventCombinator {
    init() {
      this.wakeAt(0);
    }

    main() {
      if (mode === "foreign") this.send(outsider, { type: "x", data: {} });
      if (mode === "object") this.send({}, { type: "x", data: {} });
      if (mode === "text") this.send("red_1", { type: "x", data: {} });
      if (mode === "null") this.send(null, { type: "x", data: {} });
      if (mode === "shape") this.send(this.peers.receiver, { type: "", data: {} });
      if (mode === "extra") this.send(this.peers.receiver, { type: "x", data: {}, extra: 1 });
      if (mode === "data") this.send(this.peers.receiver, { type: "x", data: undefined });
    }
  }
  const home = new Circuit();
  const receiver = new EventCombinator({ run: { every_tick: false, input_changed: false } });
  const sender = new Sender({ run: { every_tick: false, input_changed: false } });
  home.add(receiver);
  home.add(sender);
  home.setPeers(sender, { receiver });
  const simulation = await home.createSimulation();
  for (const [next, code] of [
    ["foreign", "invalid-message"],
    ["object", "invalid-message"],
    ["text", "invalid-message"],
    ["null", "invalid-message"],
    ["shape", "invalid-message"],
    ["extra", "invalid-message"],
    ["data", "invalid-state"],
  ]) {
    mode = next;
    const before = simulation.capture();
    await rejectsRuntime(simulation.step(), code);
    assert.equal(simulation.tick, 0);
    assert.deepEqual(simulation.device(receiver).messages, []);
    assert.deepEqual(simulation.capture(), before);
  }
});

test("ER-20 ошибка после действий восстанавливает весь checkpoint", async () => {
  let fail = true;
  class Actor extends EventCombinator {
    main() {
      this.state.n = 2;
      this.random();
      this.send(this.peers.receiver, { type: "ping", data: { n: 1 } });
      this.setOutput(output(true, false, [count(A, 9)]));
      this.wakeAt(this.tick + 4);
      if (fail) throw new Error("boom");
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const receiver = new EventCombinator({ run: { every_tick: false, input_changed: false } });
  const actor = new Actor({ red_output: red });
  circuit.add(source({ red_output: red }, [count(C, 3)]));
  circuit.add(actor);
  circuit.add(receiver);
  circuit.setPeers(actor, { receiver });
  const simulation = await circuit.createSimulation();
  const before = simulation.capture();
  const rng = simulation.device(actor).rng;
  await assert.rejects(simulation.step(), (error) => {
    assert.equal(error.name, "RuntimeError");
    assert.equal(error.code, "script-error");
    assert.equal(error.deviceId, circuit.deviceId(actor));
    assert.equal(error.tick, 0);
    assert.equal(error.cause.message, "boom");
    return true;
  });
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 0);
  assert.equal(simulation.read(red, C), 3);
  assert.equal(simulation.device(actor).rng, rng);
  assert.deepEqual(simulation.device(actor).state, {});
  assert.deepEqual(simulation.device(actor).wakes, []);
  assert.deepEqual(simulation.device(receiver).messages, []);
  assert.deepEqual(simulation.capture(), before);
  fail = false;
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(red, A), 9);
  assert.equal(simulation.device(receiver).messages.length, 1);
});

test("ER-21 reset повторяет init, restore продолжает без init", async () => {
  let inits = 0;
  class Story extends EventCombinator {
    init() {
      inits += 1;
      this.state.n = 1;
      this.pulse(output(true, false, [count(A, 3)]), 4);
    }

    main() {
      this.state.n += 1;
      this.send(this.peers.receiver, { type: "tick", data: { n: this.tick } });
    }
  }
  class Inbox extends EventCombinator {
    main() {
      this.state.seen = this.messages.map((message) => message.type);
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const story = new Story({ red_output: red });
  const inbox = new Inbox({ run: { every_tick: false, input_changed: false } });
  circuit.add(story);
  circuit.add(inbox);
  circuit.setPeers(story, { receiver: inbox });
  const simulation = await circuit.createSimulation();
  assert.equal(inits, 1);
  await simulation.step();
  const saved = JSON.parse(JSON.stringify(simulation.capture()));
  const tampered = JSON.parse(JSON.stringify(saved));
  tampered.devices[0].state.n = 9;
  assert.equal(simulation.device(story).state.n, 2);
  await simulation.step();
  const continued = simulation.capture();
  assert.equal(inits, 1);
  await simulation.restore(saved);
  assert.equal(inits, 1);
  assert.equal(simulation.tick, saved.tick);
  await simulation.step();
  assert.deepEqual(simulation.capture(), continued);
  await simulation.reset();
  assert.equal(inits, 2);
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.device(story).state.n, 1);
  const fresh = await circuit.createSimulation();
  assert.equal(fresh.read(red, A), simulation.read(red, A));
  assert.deepEqual(fresh.device(story).wakes, simulation.device(story).wakes);
});

test("ER-22 Promise из main не публикует поздний эффект", async () => {
  let late = false;
  class AsyncMain extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 1)]));
    }

    main() {
      const promise = Promise.resolve().then(() => {
        late = true;
      });
      return promise;
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  circuit.add(new AsyncMain({ red_output: red }));
  const simulation = await circuit.createSimulation();
  await rejectsRuntime(simulation.step(), "async-main");
  await Promise.resolve();
  assert.equal(late, true);
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 1);

  class Thenable extends EventCombinator {
    main() {
      return { then() {} };
    }
  }
  class FunctionThenable extends EventCombinator {
    main() {
      const fn = function delay() {};
      fn.then = function then() {};
      return fn;
    }
  }
  const other = new Circuit();
  other.add(new Thenable({}));
  const second = await other.createSimulation();
  await rejectsRuntime(second.step(), "async-main");
  assert.equal(second.tick, 0);
  const third = new Circuit();
  third.add(new FunctionThenable({}));
  const functionRun = await third.createSimulation();
  await rejectsRuntime(functionRun.step(), "async-main");
  assert.equal(functionRun.tick, 0);
});

test("ER-23 seed и восстановленный x=1 дают одну последовательность", async () => {
  class Roll extends EventCombinator {
    main() {
      const draws = [];
      for (let index = 0; index < 3; index += 1) draws.push(this.random() * 4294967296);
      this.state.draws = draws;
    }
  }
  async function play(seed) {
    const circuit = new Circuit({ seed });
    const event = new Roll({});
    circuit.add(event);
    const simulation = await circuit.createSimulation();
    await simulation.step();
    return simulation.device(event).state.draws;
  }
  assert.deepEqual(await play(1), await play(1));
  assert.notDeepEqual(await play(1), await play(2));

  const circuit = new Circuit();
  const event = new Roll({ run: { every_tick: true, input_changed: false } });
  circuit.add(event);
  const simulation = await circuit.createSimulation();
  const snapshot = simulation.capture();
  const device = snapshot.devices.find((item) => item.id === circuit.deviceId(event));
  device.rng = 1;
  await simulation.restore(snapshot);
  await simulation.step();
  assert.deepEqual(simulation.device(event).state.draws, [270369, 67634689, 2647435461]);
});

test("ER-24 обмен сообщениями идёт по одной границе", async () => {
  class Left extends EventCombinator {
    init() {
      this.wakeAt(0);
    }

    main() {
      this.state.ticks = [...(this.state.ticks ?? []), this.tick];
      if (this.messages.length === 0) this.send(this.peers.receiver, { type: "ping", data: {} });
    }
  }
  class Right extends EventCombinator {
    main() {
      this.state.ticks = [...(this.state.ticks ?? []), this.tick];
      this.send(this.peers.receiver, { type: "pong", data: {} });
    }
  }
  const circuit = new Circuit();
  const left = new Left({ run: { every_tick: false, input_changed: false } });
  const right = new Right({ run: { every_tick: false, input_changed: false } });
  circuit.add(left);
  circuit.add(right);
  circuit.setPeers(left, { receiver: right });
  circuit.setPeers(right, { receiver: left });
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.deepEqual(simulation.device(left).state.ticks, [0]);
  assert.deepEqual(simulation.device(right).state, {});
  assert.equal(simulation.device(right).messages[0].type, "ping");
  await simulation.step();
  assert.deepEqual(simulation.device(right).state.ticks, [1]);
  assert.deepEqual(simulation.device(left).state.ticks, [0]);
  assert.equal(simulation.device(left).messages[0].type, "pong");
  await simulation.step();
  assert.deepEqual(simulation.device(left).state.ticks, [0, 2]);
});

test("чтение, запись и пробуждение проверяют форму аргументов", async () => {
  let mode = "signals";
  class Forms extends EventCombinator {
    main() {
      if (mode === "signals") {
        assert.equal(this.readSignal(A, neither), 0);
        assert.deepEqual(this.readSignals(neither), []);
        assert.equal(this.readSignal(B, redOnly), 0);
        const listed = this.readSignals(redOnly);
        assert.equal(listed[0].signal, A);
        const again = this.readSignals(both);
        assert.equal(again[0].constant, 4);
      }
      if (mode === "mask") this.readSignal(A, { red: true });
      if (mode === "meta") this.readSignal(Signal.Meta.signal_each, redOnly);
      if (mode === "output") this.setOutput({ red: true, green: false });
      if (mode === "flag") this.setOutput({ red: 1, green: false, signals: [] });
      if (mode === "clear") this.clearOutput({ red: true });
      if (mode === "clear-flag") this.clearOutput({ red: true, green: "no" });
      if (mode === "wake-miss") this.cancelWake(9);
      if (mode === "readonly") this.nextTick = 4;
      if (mode === "peers") this.peers = {};
      if (mode === "messages") this.messages = [];
      if (mode === "null") this.setOutput(null);
      if (mode === "list") this.setOutput([]);
      if (mode === "number") this.setOutput(1);
      if (mode === "bad-signals") this.setOutput({ red: true, green: false, signals: 1 });
      if (mode === "string") throw "boom";
      if (mode === "return") return 0;
      if (mode === "self") this.send(this, { type: "self", data: null });
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const event = new Forms({ red_input: red, green_input: green, red_output: red });
  circuit.add(source({ red_output: red }, [count(A, 1)]));
  circuit.add(source({ green_output: green }, [count(A, 3)]));
  circuit.add(event);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.deepEqual(simulation.device(event).state, {});
  const cases = [
    ["mask", "invalid-mask", ConfigError],
    ["meta", "meta-signal", ConfigError],
    ["output", "invalid-output", RuntimeError],
    ["flag", "invalid-output", RuntimeError],
    ["clear", "invalid-output", RuntimeError],
    ["clear-flag", "invalid-output", RuntimeError],
    ["wake-miss", "unknown-wake", RuntimeError],
    ["readonly", "readonly", RuntimeError],
    ["peers", "readonly", RuntimeError],
    ["messages", "readonly", RuntimeError],
    ["null", "invalid-output", RuntimeError],
    ["list", "invalid-output", RuntimeError],
    ["number", "invalid-output", RuntimeError],
    ["bad-signals", "invalid-output", RuntimeError],
    ["string", "script-error", RuntimeError],
  ];
  for (const [next, code, ErrorClass] of cases) {
    mode = next;
    await assert.rejects(simulation.step(), (error) => {
      assert.equal(error instanceof ErrorClass, true);
      assert.equal(error.code, code);
      assert.equal(simulation.tick, 1);
      return true;
    });
  }
  mode = "return";
  await simulation.step();
  assert.equal(simulation.tick, 2);
  mode = "self";
  await simulation.step();
  assert.equal(simulation.device(event).messages[0].type, "self");
  assert.equal(simulation.device(event).messages[0].data, null);
});

test("снимок отвергает повреждённую форму и не сдвигает границу", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  circuit.add(source({ red_output: red }, [count(A, 2)]));
  const event = new EventCombinator({ red_output: red, state: { n: 1 } });
  circuit.add(event);
  const plain = { participate: true };
  circuit.add(plain);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  const good = simulation.capture();
  const tick = simulation.tick;
  const broken = [
    null,
    [],
    { ...good, extra: 1 },
    { ...good, profile: "space-age" },
    { ...good, gameVersion: "0" },
    { ...good, tick: -1 },
    { ...good, tick: 1.5 },
    { ...good, networks: {} },
    { ...good, devices: {} },
    { ...good, networks: [null] },
    { ...good, networks: [{ ...good.networks[0], extra: 1 }] },
    { ...good, networks: [{ id: "missing", signals: [] }] },
    { ...good, networks: [good.networks[0], good.networks[0]] },
    { ...good, networks: [] },
    { ...good, networks: [{ id: good.networks[0].id, signals: {} }] },
    { ...good, networks: [{ id: good.networks[0].id, signals: [{ signal: { type: A.type, name: A.name, quality: A.quality }, constant: 1.5 }] }] },
    { ...good, networks: [{ id: good.networks[0].id, signals: [{ signal: { type: "no", name: "no", quality: "normal" }, constant: 1 }] }] },
    { ...good, devices: [null] },
    { ...good, devices: [{ ...good.devices[0], extra: true }] },
    { ...good, devices: [{ ...good.devices[0], id: "missing" }] },
    { ...good, devices: [good.devices[0], good.devices[0], good.devices[1]] },
    { ...good, devices: [good.devices[0]] },
  ];
  for (const snapshot of broken) {
    await assert.rejects(simulation.restore(snapshot));
    assert.equal(simulation.tick, tick);
    assert.equal(simulation.read(red, A), 2);
  }
  const eventSnap = good.devices.find((item) => item.id === circuit.deviceId(event));
  const plainSnap = good.devices.find((item) => item.id === circuit.deviceId(plain));
  const constantSnap = good.devices.find((item) => item !== eventSnap && item !== plainSnap);
  const more = [
    { ...good, devices: good.devices.map((item) => (item === constantSnap ? { ...item, state: {} } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, rng: null } : item)) },
    { ...good, devices: good.devices.map((item) => (item === plainSnap ? { ...item, rng: 1 } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, seenInputs: 1 } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, wakes: [-1] } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, messages: {} } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, messages: [envelope({ type: "" })] } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, messages: [envelope({ from: 1 })] } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, messages: [envelope({ sentTick: -1 })] } : item)) },
    { ...good, networks: [{ id: good.networks[0].id, signals: [{ signal: { type: "", name: A.name, quality: "normal" }, constant: 1 }] }] },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, pulses: {} } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, pulses: [{ color: "blue", start: 0, end: 1, signals: [] }] } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, pulses: [{ color: "red", start: 2, end: 1, signals: [] }] } : item)) },
    { ...good, devices: good.devices.map((item) => (item === eventSnap ? { ...item, output: [] } : item)) },
  ];
  for (const snapshot of more) {
    await assert.rejects(simulation.restore(snapshot), (error) => error instanceof RuntimeError || error instanceof ConfigError);
    assert.equal(simulation.tick, tick);
  }
  const copy = JSON.parse(JSON.stringify(good));
  copy.devices[0].output.red[0].constant = 0;
  await simulation.restore(copy);
  await simulation.restore(good);
  assert.equal(simulation.read(red, A), 2);
});

test("повтор снимка и занятый шаг не смешивают init", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const event = {
    participate: true,
    red_output: red,
    state: { n: 1 },
  };
  const executor = {
    replayInit: true,
    prepare(request) {
      if (request.phase === "init") {
        return {
          runId: request.runId,
          revision: request.revision,
          stepId: request.stepId,
          phase: request.phase,
          tick: request.tick,
          devices: [{ id: circuit.deviceId(event), state: { n: request.devices[0].state.n ?? 1 } }],
        };
      }
      return gate.then(() => {
        throw new Error("late");
      });
    },
  };
  circuit.add(event);
  const simulation = await circuit.createSimulation({ executor });
  const running = simulation.step();
  await rejectsRuntime(simulation.restore(simulation.capture()), "step-busy");
  await rejectsRuntime(simulation.step(), "step-busy");
  release();
  await assert.rejects(running, (error) => error.message === "late");
  assert.equal(simulation.tick, 0);
  const failing = {
    replayInit: true,
    prepare() {
      throw new Error("init-broke");
    },
  };
  const again = new Circuit();
  const block = { participate: true, state: { n: 4 } };
  again.add(block);
  again.add(source({ red_output: again.network("red_1") }, [count(A, 6)]));
  const started = await again.createSimulation({
    executor: {
      replayInit: true,
      prepare(request) {
        if (request.phase === "init" && request.runId === 1) {
          return {
            runId: request.runId,
            revision: request.revision,
            stepId: request.stepId,
            phase: request.phase,
            tick: request.tick,
            devices: [{ id: again.deviceId(block), state: { n: 4 }, wake: [2] }],
          };
        }
        if (request.phase === "step") {
          return {
            runId: request.runId,
            revision: request.revision,
            stepId: request.stepId,
            phase: request.phase,
            tick: request.tick,
            devices: [],
          };
        }
        return failing.prepare();
      },
    },
  });
  await started.step().catch(() => {});
  assert.equal(started.tick, 1);
  await assert.rejects(started.reset(), (error) => error.message === "init-broke");
  assert.equal(started.tick, 1);
  assert.equal(started.read(again.network("red_1"), A), 6);
});
