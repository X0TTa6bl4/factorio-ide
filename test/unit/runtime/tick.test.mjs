import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, RuntimeError } from "../../../src/errors.js";
import { INT32_MAX, INT32_MIN, addInt32 } from "../../../src/int32.js";
import { Circuit, OperationToken, Signal, openProfile } from "../../../src/index.js";
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

function source(ports, signals, enabled = true) {
  return { enabled, signals, ...ports };
}

function computed(ports, compute) {
  return { ...ports, compute };
}

function accept(request, devices = []) {
  return {
    runId: request.runId,
    revision: request.revision,
    stepId: request.stepId,
    phase: request.phase,
    tick: request.tick,
    devices,
  };
}

function queueExecutor() {
  const plans = [];
  return {
    push(plan) {
      plans.push(plan);
    },
    prepare(request) {
      const plan = plans.shift();
      if (!plan) return accept(request);
      return plan(request);
    },
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

async function rejectsRuntime(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "RuntimeError");
    assert.equal(error.code, code);
    return true;
  });
}

function values(simulation, network, signals) {
  return signals.map((signal) => simulation.read(network, signal));
}

test("TICK-1 t0 содержит константы и пустые вычисляемые выходы, reset повторяет границу", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const constant = source({ red_output: red, green_output: green }, [count(A, 3), count(A, 0)]);
  let calls = 0;
  const calculator = computed({ red_input: red, green_output: green }, (view) => {
    calls += 1;
    assert.equal(view.tick, 0);
    assert.equal(view.nextTick, 1);
    assert.equal(Object.isFrozen(view), true);
    assert.throws(() => {
      view.tick = 4;
    }, TypeError);
    const seen = view.present(redOnly);
    assert.equal(seen[0].constant, 3);
    seen[0].constant = 0;
    assert.equal(view.read(A, neither), 0);
    assert.equal(view.read(A, greenOnly), 0);
    return { signals: [count(B, addInt32(view.read(A, redOnly), 2))] };
  });
  const silent = computed({}, () => {
    calls += 1;
    return { signals: [count(C, 8)] };
  });
  const greenOnlySource = source({ green_output: circuit.network("green_only") }, [count(C, 4)]);
  circuit.add(constant);
  circuit.add(calculator);
  circuit.add(silent);
  circuit.add(greenOnlySource);
  const simulation = await circuit.createSimulation({});
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.runId, 1);
  assert.equal(simulation.revision, 1);
  assert.equal(calls, 0);
  assert.deepEqual(values(simulation, red, [A, B, C]), [3, 0, 0]);
  assert.equal(simulation.read(green, A), 3);
  assert.equal(simulation.read(circuit.network("green_only"), C), 4);
  assert.deepEqual(simulation.device(calculator).output, { red: [], green: [] });
  assert.equal(simulation.device(calculator).state, null);
  assert.deepEqual(simulation.device(constant).output.red.map((entry) => entry.constant), [3]);
  assert.deepEqual(simulation.device(constant).held, { red: [], green: [] });
  assert.equal(await simulation.step(), undefined);
  assert.equal(calls, 2);
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(green, B), 5);
  assert.deepEqual(simulation.device(silent).output, { red: [], green: [] });
  assert.equal(simulation.read(red, A), 3);
  const shown = simulation.device(constant).output.red;
  shown[0].constant = 0;
  assert.equal(simulation.device(constant).output.red[0].constant, 3);
  assert.equal(await simulation.reset(), undefined);
  assert.equal(simulation.runId, 2);
  assert.equal(simulation.tick, 0);
  assert.equal(calls, 2);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(green, B), 0);
  assert.deepEqual(simulation.device(calculator).output.green, []);
  await simulation.reset();
  assert.equal(simulation.runId, 3);
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(green, A), 3);
});

test("замороженный постоянный вклад не накапливается и не читает позднее описание", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const live = source({ red_output: red }, [count(A, INT32_MAX)]);
  const other = source({ red_output: red }, [count(A, 1), count(B, 1), count(B, -1)]);
  const disabled = source({ red_output: red }, [count(C, 6)], false);
  let generation = 0;
  function current() {
    generation += 1;
    return { signals: [count(C, generation)] };
  }
  const calculator = computed({ red_output: red }, current);
  circuit.add(live);
  circuit.add(other);
  circuit.add(disabled);
  circuit.add(calculator);
  const simulation = await circuit.createSimulation();
  live.enabled = false;
  live.signals[0].constant = 9;
  calculator.compute = () => ({ signals: [count(C, 100)] });
  for (let step = 0; step < 10; step += 1) await simulation.step();
  assert.equal(simulation.tick, 10);
  assert.equal(simulation.read(red, A), INT32_MIN);
  assert.equal(simulation.read(red, B), 0);
  assert.equal(simulation.read(red, C), 10);
  assert.equal(simulation.device(live).output.red[0].constant, INT32_MAX);
  assert.equal(simulation.device(disabled).output.red.length, 0);
  assert.equal(generation, 10);
});

test("reset из вычислителя отменяет commit и не публикует его выход", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  let simulation;
  let cancel = true;
  circuit.add(source({ red_output: red }, [count(A, 3)]));
  circuit.add(computed({ red_output: red }, () => {
    if (cancel) {
      cancel = false;
      simulation.reset();
    }
    return { signals: [count(B, 9)] };
  }));
  simulation = await circuit.createSimulation();
  const runId = simulation.runId;
  await rejectsRuntime(simulation.step(), "step-cancelled");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.runId, runId + 1);
  assert.deepEqual(values(simulation, red, [A, B]), [3, 0]);
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.runId, runId + 1);
  assert.deepEqual(values(simulation, red, [A, B]), [3, 9]);
});

test("TICK-2 два вычислителя дают две границы задержки", async () => {
  const circuit = new Circuit();
  const input = circuit.network("red_in");
  const middle = circuit.network("green_mid");
  const output = circuit.network("red_out");
  circuit.add(source({ red_output: input }, [count(A, 3)]));
  circuit.add(computed({ red_input: input, green_output: middle }, (view) => {
    assert.equal(view.read(B, redOnly), 0);
    return { signals: [count(B, addInt32(view.read(A, redOnly), 2))] };
  }));
  circuit.add(computed({ green_input: middle, red_output: output }, (view) => {
    const present = view.present(greenOnly);
    const seen = present.find((entry) => entry.signal === B);
    return { signals: [count(C, addInt32(seen ? seen.constant : 0, 1))] };
  }));
  const simulation = await circuit.createSimulation();
  assert.deepEqual(values(simulation, input, [A, B, C]), [3, 0, 0]);
  assert.deepEqual(values(simulation, middle, [A, B, C]), [0, 0, 0]);
  assert.deepEqual(values(simulation, output, [A, B, C]), [0, 0, 0]);
  await simulation.step();
  assert.deepEqual(values(simulation, middle, [B]), [5]);
  assert.deepEqual(values(simulation, output, [C]), [1]);
  assert.equal(simulation.readMask({ red: input, green: middle }, both, A), 3);
  await simulation.step();
  assert.equal(simulation.tick, 2);
  assert.equal(simulation.read(middle, B), 5);
  assert.equal(simulation.read(output, C), 6);
  assert.equal(simulation.read(input, A), 3);
});

test("TICK-3 самоссылка A+1 идёт 0,1,2,3 без рекурсии", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_loop");
  const seen = [];
  circuit.add(computed({ red_input: red, red_output: red }, (view) => {
    const value = view.read(A, redOnly);
    seen.push(value);
    return { signals: [count(A, addInt32(value, 1))] };
  }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 0);
  for (let tick = 1; tick <= 3; tick += 1) {
    await simulation.step();
    assert.equal(simulation.tick, tick);
    assert.equal(simulation.read(red, A), tick);
  }
  assert.deepEqual(seen, [0, 1, 2]);
});

test("метод класса читает this и публикуется тем же проходом", async () => {
  class Increment {
    constructor(port, signal) {
      this.red_input = port;
      this.red_output = port;
      this.signal = signal;
    }

    compute(view) {
      const value = view.read(this.signal, redOnly);
      return { signals: [{ signal: this.signal, constant: addInt32(value, 1) }] };
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  circuit.add(new Increment(red, A));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 0);
  await simulation.step();
  assert.equal(simulation.read(red, A), 1);
});

test("TICK-4 цикл и перестановка устройств дают одну трассу", async () => {
  async function cycle(order) {
    const circuit = new Circuit();
    const nets = [
      circuit.network("red_a"),
      circuit.network("red_b"),
      circuit.network("red_c"),
    ];
    const devices = nets.map((network, index) => computed({
      red_input: network,
      red_output: nets[(index + 1) % nets.length],
    }, (view) => ({
      signals: [count(A, addInt32(view.read(A, redOnly), 1))],
    })));
    for (const index of order) circuit.add(devices[index]);
    const simulation = await circuit.createSimulation();
    const trace = [values(simulation, nets[0], [A]).concat(values(simulation, nets[1], [A]), values(simulation, nets[2], [A]))];
    for (let tick = 0; tick < 3; tick += 1) {
      await simulation.step();
      trace.push(values(simulation, nets[0], [A]).concat(values(simulation, nets[1], [A]), values(simulation, nets[2], [A])));
    }
    return trace;
  }
  const forward = await cycle([0, 1, 2]);
  const backward = await cycle([2, 0, 1]);
  assert.deepEqual(forward, [
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
  ]);
  assert.deepEqual(backward, forward);

  async function summed(order) {
    const circuit = new Circuit();
    const red = circuit.network("red_sum");
    const writers = [
      computed({ red_output: red }, () => ({ signals: [count(A, 1)] })),
      computed({ red_output: red }, () => ({ signals: [count(A, 2)] })),
    ];
    for (const index of order) circuit.add(writers[index]);
    const simulation = await circuit.createSimulation();
    await simulation.step();
    return simulation.read(red, A);
  }
  assert.equal(await summed([0, 1]), 3);
  assert.equal(await summed([1, 0]), 3);
});

test("TICK-5 пропавший вклад исчезает и не копится в next", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  let emit = true;
  const writer = computed({ red_output: red, green_output: circuit.network("green_1") }, () => {
    if (!emit) return { signals: [] };
    return { signals: [count(A, 1), count(B, 5)] };
  });
  const constant = source({ red_output: red }, [count(A, 4)]);
  circuit.add(constant);
  circuit.add(writer);
  const simulation = await circuit.createSimulation();
  assert.deepEqual(values(simulation, red, [A, B]), [4, 0]);
  await simulation.step();
  assert.deepEqual(values(simulation, red, [A, B]), [5, 5]);
  assert.equal(simulation.read(circuit.network("green_1"), B), 5);
  assert.equal(simulation.device(writer).output.red.length, 2);
  emit = false;
  await simulation.step();
  assert.deepEqual(values(simulation, red, [A, B]), [4, 0]);
  assert.equal(simulation.read(circuit.network("green_1"), B), 0);
  assert.deepEqual(simulation.device(writer).output, { red: [], green: [] });
  assert.equal(simulation.device(constant).output.red[0].constant, 4);
  await simulation.step();
  assert.deepEqual(values(simulation, red, [A, B]), [4, 0]);
});

test("TICK-6 ошибка до публикации оставляет тик, сети и runtime", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  let fail = true;
  const event = { participate: true, red_output: red, state: { n: 1 } };
  const executor = queueExecutor();
  executor.push((request) => accept(request, [{
    id: "d1",
    state: { n: 1 },
    wake: [4],
    held: { red: [count(C, 2)] },
  }]));
  circuit.add(event);
  circuit.add(source({ red_output: red }, [count(A, 3)]));
  circuit.add(computed({ red_input: red, green_output: green }, (view) => ({
    signals: [count(B, addInt32(view.read(A, redOnly), 2))],
  })));
  circuit.add(computed({ red_output: red }, () => {
    if (fail) throw new Error("boom");
    return { signals: [count(B, 1)] };
  }));
  const simulation = await circuit.createSimulation({ executor });
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    state: { n: 9 },
    held: { red: [count(C, 8)] },
  }]));
  await assert.rejects(simulation.step(), (error) => {
    assert.equal(error.message, "boom");
    return true;
  });
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.runId, 1);
  assert.deepEqual(values(simulation, red, [A, B, C]), [3, 0, 2]);
  assert.equal(simulation.read(green, B), 0);
  assert.deepEqual(simulation.device(event).state, { n: 1 });
  assert.deepEqual(simulation.device(event).wakes, [4]);
  assert.equal(simulation.device(event).output.red[0].constant, 2);
  fail = false;
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    state: { n: 9 },
    held: { red: [count(C, 8)] },
  }]));
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(green, B), 5);
  assert.equal(simulation.read(red, B), 1);
  assert.equal(simulation.read(red, C), 8);
  assert.deepEqual(simulation.device(event).state, { n: 9 });
  assert.deepEqual(simulation.device(event).wakes, [4]);
});

test("инертное устройство не получает выход, пустая схема шагает", async () => {
  const empty = new Circuit();
  const bare = await empty.createSimulation();
  await bare.step();
  assert.equal(bare.tick, 1);
  await bare.reset();
  assert.equal(bare.tick, 0);

  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const inert = {
    red_input: red,
    red_output: red,
    operation: new OperationToken("Arithmetic", "SUM"),
  };
  circuit.add(source({ red_output: red }, [count(A, 2)]));
  circuit.add(inert);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.read(red, A), 2);
  assert.deepEqual(simulation.device(inert).output, { red: [], green: [] });
  throwsCode(() => simulation.device({}), "not-in-simulation");
});

test("вычислитель отклоняет несинхронный и неверный выход, не публикуя тик", async () => {
  const cases = [
    [() => Promise.resolve({ signals: [] }), "async-compute"],
    [() => null, "invalid-output"],
    [() => [], "invalid-output"],
    [() => 5, "invalid-output"],
    [() => (() => {}), "invalid-output"],
    [() => ({ other: [] }), "invalid-output"],
    [() => ({ signals: [], extra: true }), "invalid-output"],
    [() => ({ signals: 1 }), "invalid-output"],
  ];
  for (const [compute, code] of cases) {
    const circuit = new Circuit();
    const red = circuit.network("red_1");
    circuit.add(source({ red_output: red }, [count(A, 3)]));
    circuit.add(computed({ red_output: red }, compute));
    const simulation = await circuit.createSimulation();
    await rejectsRuntime(simulation.step(), code);
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.read(red, A), 3);
    assert.equal(simulation.read(red, B), 0);
  }
});

test("неверный операнд вычислителя и повтор шага после ошибки", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  let mode = "mask";
  circuit.add(source({ red_output: red }, [count(A, 3)]));
  circuit.add(computed({ red_input: red, red_output: red }, (view) => {
    if (mode === "mask") view.read(A, { red: true });
    if (mode === "meta") view.read(Signal.Meta.signal_each, redOnly);
    if (mode === "profile") {
      return { signals: [count(openProfile("space-age").tree.Intermediate.iron_plate, 1)] };
    }
    if (mode === "count") return { signals: [count(B, 1.5)] };
    if (mode === "zero") return { signals: [count(B, 1), count(B, -1), count(C, 2), count(C, 3)] };
    return { signals: [count(B, 4)] };
  }));
  const simulation = await circuit.createSimulation();
  await rejectsCode(simulation.step(), "invalid-mask");
  mode = "meta";
  await rejectsCode(simulation.step(), "meta-signal");
  mode = "profile";
  await rejectsCode(simulation.step(), "wrong-profile");
  mode = "count";
  await rejectsCode(simulation.step(), "invalid-constant");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 3);
  mode = "zero";
  await simulation.step();
  assert.equal(simulation.read(red, B), 0);
  assert.equal(simulation.read(red, C), 5);
  mode = "done";
  await simulation.step();
  assert.equal(simulation.read(red, B), 4);
  assert.equal(simulation.read(red, C), 0);
});

test("описание устройства выбирает один способ исполнения", () => {
  const circuit = new Circuit();
  throwsCode(() => circuit.add({ participate: false }), "invalid-participant");
  throwsCode(() => circuit.add({ participate: 1 }), "invalid-participant");
  throwsCode(() => circuit.add({ compute: 1 }), "invalid-compute");
  throwsCode(() => circuit.add({
    enabled: true,
    signals: [],
    compute: () => ({ signals: [] }),
  }), "mixed-device");
  throwsCode(() => circuit.add({
    enabled: true,
    signals: [],
    participate: true,
  }), "mixed-device");
  throwsCode(() => circuit.add({
    participate: true,
    compute: () => ({ signals: [] }),
  }), "mixed-device");
  assert.equal(circuit.devices.length, 0);
  const cycle = {};
  cycle.self = cycle;
  throwsCode(() => circuit.add({ participate: true, state: cycle }), "invalid-state");
  const list = [];
  list.push(list);
  throwsCode(() => circuit.add({ participate: true, state: list }), "invalid-state");
  for (const state of [
    undefined,
    Number.NaN,
    Infinity,
    -Infinity,
    1n,
    Symbol("x"),
    () => {},
    new Date(0),
    new Map(),
    new Set(),
    Object.create(null),
    new (class Box {})(),
    { bad: undefined },
    [Number.NaN],
  ]) {
    throwsCode(() => circuit.add({ participate: true, state }), "invalid-state");
  }
  assert.equal(circuit.devices.length, 0);
});

test("state копируется при сборке и не делится с описанием", async () => {
  const circuit = new Circuit();
  const shared = { n: 1 };
  const event = {
    participate: true,
    state: { a: shared, b: shared, items: [1, true, "a", null], ok: false },
  };
  const explicitNull = { participate: true, state: null };
  const omitted = { participate: true };
  circuit.add(event);
  circuit.add(explicitNull);
  circuit.add(omitted);
  const simulation = await circuit.createSimulation();
  const state = simulation.device(event).state;
  assert.equal(state.a.n, 1);
  assert.notEqual(state.a, state.b);
  assert.deepEqual(state.items, [1, true, "a", null]);
  assert.equal(state.ok, false);
  shared.n = 9;
  event.state.a.n = 8;
  state.a.n = 7;
  assert.equal(simulation.device(event).state.a.n, 1);
  assert.equal(simulation.device(explicitNull).state, null);
  assert.deepEqual(simulation.device(omitted).state, {});
  const spare = circuit.network("green_spare");
  event.state = { self: null };
  event.state.self = event.state;
  await rejectsCode(circuit.createSimulation(), "invalid-state");
  assert.equal(circuit.network("green_spare"), spare);
  assert.equal(simulation.device(event).state.a.n, 1);
});

test("настройки прогона и сбой init не удаляют сети", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const spare = circuit.network("green_spare");
  circuit.add(source({ red_output: red }, [count(A, 1)]));
  await rejectsCode(circuit.createSimulation(null), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation([]), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation(1), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation("base"), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation({ extra: true }), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation({ executor: null }), "invalid-executor");
  await rejectsCode(circuit.createSimulation({ executor: [] }), "invalid-executor");
  await rejectsCode(circuit.createSimulation({ executor: () => {} }), "invalid-executor");
  await rejectsCode(circuit.createSimulation({ executor: { prepare: 1 } }), "invalid-executor");
  assert.equal(circuit.network("green_spare"), spare);
  const boom = queueExecutor();
  boom.push(() => {
    throw new Error("init-boom");
  });
  await assert.rejects(circuit.createSimulation({ executor: boom }), (error) => {
    assert.equal(error.message, "init-boom");
    return true;
  });
  assert.equal(circuit.network("green_spare"), spare);
  const forbidden = queueExecutor();
  const event = { participate: true, red_output: red };
  circuit.add(event);
  forbidden.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    send: [{ to: circuit.deviceId(event), type: "x", data: {} }],
  }]));
  await rejectsRuntime(circuit.createSimulation({ executor: forbidden }), "forbidden-send");
  assert.equal(circuit.network("green_spare"), spare);
});

test("TX-1 задержанный prepare публикует ровно один тик", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  let calls = 0;
  circuit.add(source({ red_output: red }, [count(A, 3)]));
  circuit.add(computed({ red_output: red }, () => {
    calls += 1;
    return { signals: [count(B, 1)] };
  }));
  let pending;
  const executor = {
    prepare(request) {
      if (request.phase === "init") return accept(request);
      pending = deferred();
      pending.request = request;
      return pending.promise;
    },
  };
  const simulation = await circuit.createSimulation({ executor });
  const step = simulation.step();
  assert.equal(calls, 0);
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(red, B), 0);
  await rejectsRuntime(simulation.step(), "step-busy");
  assert.equal(simulation.tick, 0);
  pending.resolve(accept(pending.request));
  assert.equal(await step, undefined);
  assert.equal(calls, 1);
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(red, B), 1);
  const again = simulation.step();
  pending.resolve(accept(pending.request));
  await again;
  assert.equal(simulation.tick, 2);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(red, B), 1);
});

test("TX-2 reset во время prepare отменяет старый шаг и меняет runId", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const event = { participate: true, red_output: red };
  circuit.add(source({ red_output: red }, [count(A, 3)]));
  circuit.add(event);
  const gates = [];
  const executor = {
    prepare(request) {
      if (request.phase === "init") {
        return accept(request, [{ id: circuit.deviceId(event), state: { n: 1 } }]);
      }
      const gate = deferred();
      gate.request = request;
      gates.push(gate);
      return gate.promise;
    },
  };
  const simulation = await circuit.createSimulation({ executor });
  const firstRun = simulation.runId;
  const first = simulation.step();
  const firstGate = gates[0];
  assert.equal(await simulation.reset(), undefined);
  assert.notEqual(simulation.runId, firstRun);
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 3);
  firstGate.resolve({ bad: true });
  await rejectsRuntime(first, "step-cancelled");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, B), 0);
  assert.deepEqual(simulation.device(event).state, { n: 1 });

  const second = simulation.step();
  const secondGate = gates[1];
  const third = simulation.step();
  await rejectsRuntime(third, "step-busy");
  secondGate.resolve(accept(secondGate.request, [{
    id: circuit.deviceId(event),
    held: { red: [count(B, 99)] },
  }]));
  await second;
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(red, B), 99);
  assert.equal(simulation.runId, firstRun + 1);

  const late = simulation.step();
  const lateGate = gates[2];
  lateGate.reject(new Error("late"));
  await simulation.reset();
  await rejectsRuntime(late, "step-cancelled");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, B), 0);
  assert.equal(simulation.runId, firstRun + 2);
});

test("сбой prepare без reset сохраняет границу и позволяет повтор", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  circuit.add(source({ red_output: red }, [count(A, 3)]));
  let fail = true;
  const executor = {
    prepare(request) {
      if (fail && request.phase === "step") throw new Error("boom");
      return accept(request);
    },
  };
  const simulation = await circuit.createSimulation({ executor });
  await assert.rejects(simulation.step(), (error) => error.message === "boom");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 3);
  fail = false;
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(red, A), 3);
});

test("ответ prepare сверяется с запросом и не применяется частично", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const constant = source({ red_output: red }, [count(A, 3)]);
  const first = { participate: true, red_output: red, state: { n: 1 } };
  const second = { participate: true };
  circuit.add(constant);
  circuit.add(first);
  circuit.add(second);
  const executor = queueExecutor();
  executor.push((request) => {
    assert.equal(request.phase, "init");
    assert.equal(request.tick, 0);
    assert.equal(request.nextTick, 0);
    assert.equal(request.stepId, 1);
    assert.equal(request.revision, 1);
    assert.equal(Object.hasOwn(request.devices[0], "inputs"), false);
    return accept(request, [{ id: circuit.deviceId(first), send: [] }]);
  });
  const simulation = await circuit.createSimulation({ executor });
  const plans = [
    () => null,
    () => [],
    (request) => ({ ...accept(request), extra: 1 }),
    (request) => {
      const response = accept(request);
      delete response.tick;
      response.other = 1;
      return response;
    },
    (request) => ({ ...accept(request), runId: request.runId + 1 }),
    (request) => ({ ...accept(request), revision: 2 }),
    (request) => ({ ...accept(request), stepId: request.stepId + 1 }),
    (request) => ({ ...accept(request), phase: "init" }),
    (request) => ({ ...accept(request), tick: request.tick + 1 }),
    (request) => ({ ...accept(request), devices: "no" }),
    (request) => accept(request, [null]),
    (request) => accept(request, [[]]),
    (request) => accept(request, [{}]),
    (request) => accept(request, [{ id: 1 }]),
    (request) => accept(request, [{ id: circuit.deviceId(first), extra: true }]),
    (request) => accept(request, [
      { id: circuit.deviceId(first) },
      { id: circuit.deviceId(first) },
    ]),
    (request) => accept(request, [{ id: "missing" }]),
    (request) => accept(request, [{ id: circuit.deviceId(constant) }]),
    (request) => accept(request, [{
      id: circuit.deviceId(first),
      state: { n: 9 },
    }, {
      id: circuit.deviceId(second),
      pulses: [{ red: true, green: false, signals: [count(B, 1)], duration: 0 }],
    }]),
  ];
  const codes = [
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "invalid-result",
    "duplicate-device",
    "unknown-device",
    "not-participant",
    "invalid-pulse",
  ];
  for (let index = 0; index < plans.length; index += 1) {
    executor.push(plans[index]);
    await rejectsRuntime(simulation.step(), codes[index]);
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.runId, 1);
    assert.deepEqual(simulation.device(first).state, { n: 1 });
    assert.equal(simulation.read(red, A), 3);
    assert.equal(simulation.read(red, B), 0);
  }
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(red, A), 3);
});

test("TX-3 мутация кандидата и чужой state не входят в checkpoint", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const event = { participate: true, red_input: red, red_output: red };
  let calls = 0;
  circuit.add(source({ red_output: red }, [count(A, 3)]));
  circuit.add(computed({ red_output: red }, () => {
    calls += 1;
    return { signals: [count(B, 5)] };
  }));
  circuit.add(event);
  const executor = queueExecutor();
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    state: { n: 1 },
    wake: [4],
    held: { red: [count(C, 2)] },
  }]));
  const simulation = await circuit.createSimulation({ executor });
  executor.push((request) => {
    assert.equal(request.phase, "step");
    assert.equal(request.tick, 0);
    assert.equal(request.nextTick, 1);
    assert.equal(request.stepId, 2);
    assert.equal(Object.hasOwn(request.devices[0], "inputs"), true);
    assert.equal(request.devices[0].inputs.green.length, 0);
    assert.equal(request.devices[0].inputs.red.some((entry) => entry.signal === B), false);
    assert.equal(request.devices[0].inputs.red.find((entry) => entry.signal === A).constant, 3);
    request.devices[0].state.n = 9;
    request.devices[0].held.red.push(count(A, 5));
    throw new Error("boom");
  });
  await assert.rejects(simulation.step(), (error) => error.message === "boom");
  assert.equal(calls, 0);
  assert.equal(simulation.tick, 0);
  assert.deepEqual(simulation.device(event).state, { n: 1 });
  assert.equal(simulation.device(event).held.red[0].constant, 2);
  assert.equal(simulation.read(red, B), 0);
  assert.deepEqual(simulation.device(event).wakes, [4]);
});

test("TX-4 импульс без main исчезает на границе, удержание остаётся", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const event = { participate: true, red_output: red, green_output: green };
  circuit.add(source({ red_output: red }, [count(C, 4)]));
  circuit.add(event);
  const seen = [];
  const executor = {
    prepare(request) {
      seen.push(request.phase);
      if (request.phase === "init") {
        return accept(request, [{
          id: circuit.deviceId(event),
          held: { red: [count(A, 2)], green: [count(B, 7)] },
          pulses: [{ red: true, green: false, signals: [count(A, 3)], duration: 2 }],
          wake: [0, 2],
        }]);
      }
      return accept(request);
    },
  };
  const simulation = await circuit.createSimulation({ executor });
  assert.deepEqual(values(simulation, red, [A, C]), [5, 4]);
  assert.equal(simulation.read(green, B), 7);
  assert.equal(simulation.device(event).pulses.length, 1);
  assert.deepEqual(simulation.device(event).wakes, [0, 2]);
  await simulation.step();
  assert.deepEqual(seen, ["init", "step"]);
  assert.equal(simulation.tick, 1);
  assert.deepEqual(values(simulation, red, [A, C]), [5, 4]);
  assert.equal(simulation.read(green, B), 7);
  assert.deepEqual(simulation.device(event).wakes, [2]);
  await simulation.step();
  assert.equal(simulation.tick, 2);
  assert.deepEqual(values(simulation, red, [A, C]), [2, 4]);
  assert.equal(simulation.read(green, B), 7);
  assert.deepEqual(simulation.device(event).pulses, []);
  assert.equal(simulation.device(event).held.red[0].constant, 2);
  assert.equal(simulation.device(event).held.green[0].constant, 7);
  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.deepEqual(values(simulation, red, [A, C]), [5, 4]);
  assert.equal(simulation.device(event).pulses[0].end, 2);
  assert.deepEqual(simulation.device(event).wakes, [0, 2]);
});

test("импульс шага, очистка и замена удержания соблюдают цвета", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const event = { participate: true, red_output: red, green_output: green };
  circuit.add(event);
  const executor = queueExecutor();
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    held: { red: [count(A, 2)], green: [count(B, 7)] },
    pulses: [{
      red: true,
      green: true,
      signals: [count(A, 3)],
      duration: 5,
    }],
  }]));
  const simulation = await circuit.createSimulation({ executor });
  assert.equal(simulation.read(red, A), 5);
  assert.equal(simulation.read(green, A), 3);
  assert.equal(simulation.read(green, B), 7);
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    held: { red: [] },
  }]));
  await simulation.step();
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.device(event).held.red.length, 0);
  assert.equal(simulation.device(event).pulses.filter((pulse) => pulse.color === "red").length, 1);
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    clear: { red: true, green: false },
    held: { red: [count(A, 9)] },
  }]));
  await simulation.step();
  assert.equal(simulation.read(red, A), 9);
  assert.equal(simulation.device(event).pulses.every((pulse) => pulse.color === "green"), true);
  assert.equal(simulation.read(green, B), 7);
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    pulses: [{ red: true, green: false, signals: [count(C, 1)], duration: 2 }],
  }]));
  await simulation.step();
  const pulse = simulation.device(event).pulses.find((item) => item.color === "red" && item.signals[0].signal === C);
  assert.equal(pulse.start, 3);
  assert.equal(pulse.end, 5);
  assert.equal(simulation.read(red, C), 1);
  await simulation.step();
  assert.equal(simulation.read(red, C), 1);
  await simulation.step();
  assert.equal(simulation.read(red, C), 0);
  assert.equal(simulation.read(red, A), 9);
});

test("clear green снимает удержание и импульс выбранного цвета", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const event = { participate: true, red_output: red, green_output: green };
  circuit.add(event);
  const executor = queueExecutor();
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    held: { red: [count(C, 1)], green: [count(B, 7)] },
    pulses: [{ red: true, green: true, signals: [count(A, 3)], duration: 4 }],
  }]));
  const simulation = await circuit.createSimulation({ executor });
  assert.equal(simulation.read(green, A), 3);
  assert.equal(simulation.read(green, B), 7);
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    clear: { green: true },
  }]));
  await simulation.step();
  assert.equal(simulation.read(green, A), 0);
  assert.equal(simulation.read(green, B), 0);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(red, C), 1);
  assert.deepEqual(simulation.device(event).held.green, []);
  assert.deepEqual(simulation.device(event).pulses.map((pulse) => pulse.color), ["red"]);
});

test("пробуждения идемпотентны, прошлое назначение отклоняется", async () => {
  const circuit = new Circuit();
  const event = { participate: true };
  circuit.add(event);
  const executor = queueExecutor();
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    wake: [0, 5, 5],
  }]));
  const simulation = await circuit.createSimulation({ executor });
  assert.deepEqual(simulation.device(event).wakes, [0, 5]);
  const rejected = [
    [{ wake: [0] }, "invalid-wake"],
    [{ wake: [-1] }, "invalid-wake"],
    [{ wake: [1.5] }, "invalid-wake"],
    [{ wake: [Number.MAX_SAFE_INTEGER + 1] }, "invalid-wake"],
    [{ wake: "1" }, "invalid-wake"],
    [{ cancelWake: [9] }, "unknown-wake"],
    [{ cancelWake: [1.5] }, "invalid-wake"],
    [{ wake: {} }, "invalid-wake"],
    [{ cancelWake: {} }, "invalid-wake"],
  ];
  for (const [patch, code] of rejected) {
    executor.push((request) => accept(request, [{ id: circuit.deviceId(event), ...patch }]));
    await rejectsRuntime(simulation.step(), code);
    assert.equal(simulation.tick, 0);
    assert.deepEqual(simulation.device(event).wakes, [0, 5]);
  }
  executor.push((request) => accept(request, [{
    id: circuit.deviceId(event),
    wake: [3],
    cancelWake: [5],
  }]));
  await simulation.step();
  assert.deepEqual(simulation.device(event).wakes, [3]);
});

test("init отклоняет неверное пробуждение и пустой send допустим", async () => {
  const circuit = new Circuit();
  const event = { participate: true };
  circuit.add(event);
  const bad = queueExecutor();
  bad.push((request) => accept(request, [{ id: circuit.deviceId(event), wake: [-1] }]));
  await rejectsRuntime(circuit.createSimulation({ executor: bad }), "invalid-wake");
  const ok = queueExecutor();
  ok.push((request) => accept(request, [{ id: circuit.deviceId(event), wake: [0], send: [] }]));
  const simulation = await circuit.createSimulation({ executor: ok });
  assert.deepEqual(simulation.device(event).wakes, [0]);
  assert.deepEqual(simulation.device(event).messages, []);
});

test("сообщения доставляются на следующем тике и сортируются по id", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const alpha = { participate: true };
  const receiver = { participate: true, red_output: red };
  const beta = { participate: true };
  const gamma = { participate: true };
  circuit.add(alpha);
  circuit.add(receiver);
  circuit.add(beta);
  circuit.add(gamma);
  const data = { n: 1 };
  const executor = queueExecutor();
  const simulation = await circuit.createSimulation({ executor });
  executor.push((request) => accept(request, [
    {
      id: circuit.deviceId(beta),
      send: [
        { to: circuit.deviceId(receiver), type: "second", data: { n: 2 } },
        { to: circuit.deviceId(receiver), type: "third", data: { n: 3 } },
      ],
    },
    {
      id: circuit.deviceId(alpha),
      send: [{ to: circuit.deviceId(receiver), type: "train-arrived", data }],
    },
    {
      id: circuit.deviceId(gamma),
      send: [{ to: circuit.deviceId(receiver), type: "later", data: { n: 4 } }],
    },
  ]));
  await simulation.step();
  data.n = 5;
  const messages = simulation.device(receiver).messages;
  assert.deepEqual(messages.map((message) => [message.from, message.sequence, message.type, message.sentTick, message.deliveryTick]), [
    [circuit.deviceId(alpha), 0, "train-arrived", 0, 1],
    [circuit.deviceId(beta), 0, "second", 0, 1],
    [circuit.deviceId(beta), 1, "third", 0, 1],
    [circuit.deviceId(gamma), 0, "later", 0, 1],
  ]);
  assert.deepEqual(messages[0].data, { n: 1 });
  messages[0].data.n = 8;
  assert.equal(simulation.device(receiver).messages[0].data.n, 1);
  assert.deepEqual(simulation.device(alpha).messages, []);
  executor.push(() => {
    throw new Error("boom");
  });
  await assert.rejects(simulation.step(), (error) => error.message === "boom");
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.device(receiver).messages.length, 4);
  await simulation.step();
  assert.equal(simulation.tick, 2);
  assert.deepEqual(simulation.device(receiver).messages, []);
});

test("неверное сообщение и формы импульса не публикуются", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const constant = source({ red_output: red }, [count(A, 1)]);
  const sender = { participate: true };
  const receiver = { participate: true };
  circuit.add(constant);
  circuit.add(sender);
  circuit.add(receiver);
  const executor = queueExecutor();
  const simulation = await circuit.createSimulation({ executor });
  const id = circuit.deviceId(sender);
  const patches = [
    [{ send: {} }, "invalid-message"],
    [{ send: [{ to: 1, type: "a", data: {} }] }, "invalid-message"],
    [{ send: [{ to: "missing", type: "a", data: {} }] }, "invalid-message"],
    [{ send: [{ to: circuit.deviceId(constant), type: "a", data: {} }] }, "invalid-message"],
    [{ send: [{ to: circuit.deviceId(receiver), type: "", data: {} }] }, "invalid-message"],
    [{ send: [{ to: circuit.deviceId(receiver), type: 1, data: {} }] }, "invalid-message"],
    [{ send: [{ to: circuit.deviceId(receiver), type: "a", data: Number.NaN }] }, "invalid-state"],
    [{ send: [{ to: circuit.deviceId(receiver), type: "a" }] }, "invalid-message"],
    [{ send: [{ to: circuit.deviceId(receiver), type: "a", data: {}, extra: 1 }] }, "invalid-message"],
    [{ pulses: {} }, "invalid-pulse"],
    [{ pulses: [null] }, "invalid-pulse"],
    [{ pulses: [{ red: 1, green: false, signals: [], duration: 1 }] }, "invalid-pulse"],
    [{ pulses: [{ red: true, green: 1, signals: [], duration: 1 }] }, "invalid-pulse"],
    [{ pulses: [{ red: true, green: false, signals: [], duration: 0 }] }, "invalid-pulse"],
    [{ pulses: [{ red: true, green: false, signals: [], duration: 1.5 }] }, "invalid-pulse"],
    [{ pulses: [{ red: true, green: false, signals: [count(A, 1)], duration: 1, extra: 1 }] }, "invalid-pulse"],
    [{ pulses: [{ red: false, green: false, signals: [count(Signal.Meta.signal_each, 1)], duration: 1 }] }, "meta-signal"],
    [{ held: {} }, "invalid-result"],
    [{ held: [] }, "invalid-result"],
    [{ held: { blue: [] } }, "invalid-result"],
    [{ held: { red: {} } }, "invalid-result"],
    [{ held: { red: [count(openProfile("space-age").tree.Intermediate.iron_plate, 1)] } }, "wrong-profile"],
    [{ clear: {} }, "invalid-result"],
    [{ clear: [] }, "invalid-result"],
    [{ clear: { blue: true } }, "invalid-result"],
    [{ clear: { red: 1 } }, "invalid-result"],
    [{ state: { loop: null } }, "invalid-state"],
  ];
  for (const [patch, code] of patches) {
    if (patch.state) patch.state.loop = patch.state;
    executor.push((request) => accept(request, [{ id, ...patch }]));
    if (code === "meta-signal" || code === "wrong-profile") await rejectsCode(simulation.step(), code);
    else await rejectsRuntime(simulation.step(), code);
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.read(red, A), 1);
    assert.deepEqual(simulation.device(receiver).messages, []);
  }
  executor.push((request) => accept(request, [{
    id,
    pulses: [{ red: false, green: false, signals: [count(B, 1)], duration: 1 }],
    clear: { green: false },
    held: { green: [count(B, 2)] },
  }]));
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.device(sender).pulses.length, 0);
  assert.equal(simulation.device(sender).held.green[0].constant, 2);
  assert.equal(simulation.read(red, A), 1);
});

test("оба цвета выхода вычислителя независимы", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  circuit.add(computed({
    red_output: red,
    green_output: green,
  }, () => ({ signals: [count(B, 4)] })));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.read(red, B), 4);
  assert.equal(simulation.read(green, B), 4);
  assert.equal(simulation.readMask({ red, green }, both, B), 8);
  assert.deepEqual(
    simulation.device(circuit.devices[0]).output.red.map((entry) => entry.constant),
    [4],
  );
  assert.deepEqual(
    simulation.device(circuit.devices[0]).output.green.map((entry) => entry.constant),
    [4],
  );
});
