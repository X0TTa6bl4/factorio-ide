import assert from "node:assert/strict";
import test from "node:test";
import { Arithmetic } from "../../../src/arithmetic.js";
import { Circuit } from "../../../src/circuit.js";
import { Constant } from "../../../src/constant.js";
import { Decider } from "../../../src/decider.js";
import { ConfigError, RuntimeError } from "../../../src/errors.js";
import { INT32_MAX } from "../../../src/int32.js";
import { itemFacts } from "../../../src/item-facts.js";
import { Selector } from "../../../src/selector.js";
import { Quality, Signal, openProfile } from "../../../src/signal-profile.js";
import { OperationToken } from "../../../src/signal-token.js";
import { throwsCode } from "../signals/support.mjs";

const space = openProfile("space-age").tree;
const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;
const T = Signal.Signals.signal_T;
const D = Signal.Signals.signal_D;
const L = Signal.Signals.signal_L;
const iron = Signal.Intermediate.iron_plate;
const coal = Signal.Intermediate.coal;
const fish = Signal.Intermediate.raw_fish;
const bomb = Signal.Combat.atomic_bomb;
const silo = Signal.Production.rocket_silo;
const combinator = Signal.Logistic.selector_combinator;
const water = Signal.Fluids.water;
const spaceIron = space.Intermediate.iron_plate;
const spaceCopper = space.Intermediate.copper_plate;
const anyQuality = space.Unsorted.signal_any_quality;
const OP = Selector.Operation;
const SORT = Selector.Sort;
const CMP = Selector.Compare;

function count(signal, constant) {
  return { signal, constant };
}

function select(extra = {}) {
  return {
    operation: OP.SELECT,
    sort: SORT.DESC,
    index: { constant: 0 },
    compare: CMP.EQ,
    ...extra,
  };
}

function mapOf(entries) {
  return new Map(entries.map((entry) => [`${entry.signal.type}/${entry.signal.name}/${entry.signal.quality}`, entry.constant]));
}

async function run(build, steps = 1) {
  const circuit = new Circuit();
  const ports = build(circuit);
  const simulation = await circuit.createSimulation();
  for (let step = 0; step < steps; step += 1) await simulation.step();
  return { circuit, simulation, ...ports };
}

function outputMap(simulation, network) {
  return mapOf(simulation.present(network));
}

test("константы Selector покрывают девять режимов", () => {
  const names = ["SELECT", "COUNT", "RANDOM", "STACK_SIZE", "ROCKET_CAPACITY", "QUALITY_FILTER", "QUALITY_TRANSFER", "QUALITY_SELECT", "TIME"];
  assert.deepEqual(Object.keys(OP), names);
  for (const name of names) {
    assert.equal(OP[name].owner, "selector");
    assert.equal(Object.isFrozen(OP[name]), true);
  }
  assert.equal(Object.isFrozen(OP), true);
  assert.equal(Object.isFrozen(SORT), true);
  assert.equal(Object.isFrozen(CMP), true);
  assert.equal(SORT.DESC.name, "DESC");
  assert.equal(CMP.GTE.name, "GTE");
  assert.equal(new Selector(select()).usesRandom(), false);
  assert.equal(new Selector({ operation: OP.RANDOM, interval: 1 }).usesRandom(), true);
  assert.equal(new Circuit().world, null);
  assert.equal(itemFacts("base", "missing-item"), null);
  assert.equal(itemFacts("base", "coal").weight, 2000);
  assert.equal(itemFacts("base", "iron-plate").stackSize, 100);
  assert.equal(itemFacts("base", "iron-plate").weight, null);
  assert.equal(itemFacts("space-age", "coal").stackSize, 50);
});

test("конфигурация Selector отклоняется атомарно", () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const kept = new Constant({ enabled: true, signals: [], red_output: circuit.network("red_kept") });
  circuit.add(kept);
  const cases = [
    [null, "invalid-selector-config"],
    [[], "invalid-selector-config"],
    [1, "invalid-selector-config"],
    [select({ sections: [] }), "unsupported-setting"],
    [select({ group: "a" }), "unsupported-setting"],
    [select({ multiplier: 2 }), "unsupported-setting"],
    [select({ note: true }), "invalid-selector-config"],
    [{ sort: SORT.DESC }, "missing-operation"],
    [{ operation: "select" }, "invalid-operation"],
    [{ operation: Arithmetic.Operation.SUM }, "foreign-operation"],
    [{ operation: new OperationToken("selector", "POWER") }, "unsupported-operation"],
    [{ operation: SORT.DESC }, "unsupported-operation"],
    [select({ sort: CMP.EQ }), "invalid-sort"],
    [select({ sort: "DESC" }), "invalid-sort"],
    [select({ sort: Decider.Operation.GT }), "foreign-operation"],
    [{ operation: OP.SELECT, index: { constant: 0 }, compare: CMP.EQ }, "missing-sort"],
    [{ operation: OP.SELECT, sort: SORT.DESC, compare: CMP.EQ }, "missing-index"],
    [{ operation: OP.SELECT, sort: SORT.DESC, index: { constant: 0 } }, "missing-compare"],
    [select({ index: null }), "invalid-index"],
    [select({ index: [] }), "invalid-index"],
    [select({ index: {} }), "invalid-index"],
    [select({ index: { constant: 1, signal: A } }), "invalid-index"],
    [select({ index: { constant: 1.5 } }), "invalid-constant"],
    [select({ index: { constant: "0" } }), "invalid-constant"],
    [select({ index: { signal: Signal.Meta.signal_each } }), "meta-signal"],
    [select({ compare: Decider.Operation.EQ }), "foreign-operation"],
    [select({ compare: SORT.DESC }), "invalid-compare"],
    [select({ compare: "EQ" }), "invalid-compare"],
    [{ operation: OP.COUNT }, "missing-signal"],
    [{ operation: OP.COUNT, signal: Signal.Meta.signal_each }, "meta-signal"],
    [{ operation: OP.RANDOM }, "missing-interval"],
    [{ operation: OP.RANDOM, interval: 0 }, "unsupported-case"],
    [{ operation: OP.RANDOM, interval: 1.5 }, "invalid-interval"],
    [{ operation: OP.RANDOM, interval: -1 }, "invalid-interval"],
    [{ operation: OP.RANDOM, interval: 4294967296 }, "invalid-interval"],
    [{ operation: OP.RANDOM, interval: Number.NaN }, "invalid-interval"],
    [{ operation: OP.QUALITY_FILTER, compare: CMP.EQ }, "missing-quality"],
    [{ operation: OP.QUALITY_FILTER, quality: Quality.RARE }, "missing-compare"],
    [{ operation: OP.QUALITY_FILTER, quality: A, compare: CMP.EQ }, "invalid-quality"],
    [{ operation: OP.QUALITY_FILTER, quality: anyQuality, compare: CMP.GT }, "invalid-compare"],
    [{ operation: OP.QUALITY_TRANSFER, destination: spaceIron }, "missing-source"],
    [{ operation: OP.QUALITY_TRANSFER, source: Quality.RARE }, "missing-destination"],
    [{ operation: OP.QUALITY_TRANSFER, source: 1, destination: spaceIron }, "invalid-source"],
    [{ operation: OP.QUALITY_TRANSFER, source: anyQuality, destination: spaceIron }, "invalid-source"],
    [{ operation: OP.QUALITY_TRANSFER, source: Quality.RARE, destination: Signal.Meta.signal_each }, "meta-signal"],
    [{ operation: OP.QUALITY_SELECT }, "missing-highest"],
    [{ operation: OP.QUALITY_SELECT, highest: "true" }, "invalid-highest"],
    [{ operation: OP.TIME }, "missing-output"],
    [{ operation: OP.TIME, game_tick: null, day_tick: null, day_length: null }, "missing-output"],
    [{ operation: OP.TIME, game_tick: T, day_tick: T }, "unsupported-case"],
    [{ operation: OP.TIME, game_tick: Signal.Meta.signal_each }, "meta-signal"],
    [select({ red_input: "red_1" }), "invalid-port"],
    [select({ red_input: OP.SELECT }), "invalid-port"],
    [select({ red_input: A }), "invalid-port"],
    [select({ red_input: Signal.Meta.signal_each }), "invalid-port"],
    [select({ red_input: Quality.RARE }), "invalid-port"],
    [select({ red_input: anyQuality }), "invalid-port"],
    [select({ red_input: 0 }), "invalid-port"],
    [select({ red_input: true }), "invalid-port"],
    [select({ red_input: [] }), "invalid-port"],
  ];
  for (const [config, code] of cases) throwsCode(() => new Selector(config), code);
  assert.equal(circuit.devices.length, 1);
  const plain = new Selector(select({ red_output: {} }));
  throwsCode(() => circuit.add(plain), "invalid-port");
  throwsCode(() => circuit.add(new Selector(select({ red_output: green }))), "wrong-color");
  const baseQuality = new Selector({
    operation: OP.QUALITY_FILTER,
    quality: Quality.NORMAL,
    compare: CMP.EQ,
  });
  throwsCode(() => circuit.add(baseQuality), "unavailable-mode");
  throwsCode(() => circuit.add(new Selector({ operation: OP.TIME, game_tick: T })), "missing-world");
  throwsCode(() => new Circuit().add(new Selector({ operation: OP.COUNT, signal: spaceIron })), "wrong-profile");
  assert.equal(new Selector(select({ red_output: null })).red_output, null);
  assert.equal(new Selector(select()).red_input, null);
  circuit.add(new Selector(select({ red_output: red })));
  assert.equal(circuit.devices.length, 2);
});

test("контекст мира проверяется при создании схемы", () => {
  const cases = [
    [{ world: 1 }, "invalid-world"],
    [{ world: [] }, "invalid-world"],
    [{ world: { origin: 0 } }, "invalid-world"],
    [{ world: { origin: 0, dayLength: 1, extra: true } }, "invalid-world"],
    [{ world: { origin: -1, dayLength: 1 } }, "invalid-world"],
    [{ world: { origin: 1.5, dayLength: 1 } }, "invalid-world"],
    [{ world: { origin: 0, dayLength: 0 } }, "invalid-world"],
    [{ world: { origin: 0, dayLength: 1.2 } }, "invalid-world"],
  ];
  for (const [config, code] of cases) throwsCode(() => new Circuit(config), code);
  const world = { origin: 5, dayLength: 8 };
  const circuit = new Circuit({ world });
  assert.deepEqual(circuit.world, world);
  circuit.add(new Selector({ operation: OP.TIME, game_tick: T, day_tick: D, day_length: L }));
  assert.equal(circuit.devices.length, 1);
});

test("select сортирует, пропускает один сигнал вне индекса и оставляет диапазон", async () => {
  const { simulation, out } = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({
      enabled: true,
      red_output: input,
      signals: [count(A, 10), count(B, -2)],
    }));
    circuit.add(new Selector({
      ...select(),
      red_input: input,
      red_output: out,
    }));
    return { out };
  });
  assert.equal(simulation.tick, 1);
  assert.deepEqual(outputMap(simulation, out), mapOf([count(A, 10)]));
  const bare = await run((circuit) => {
    const bareOut = circuit.network("red_bare");
    circuit.add(new Selector(select({ red_output: bareOut })));
    return { bareOut };
  });
  assert.equal(bare.simulation.present(bare.bareOut).length, 0);

  const ascending = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({ enabled: true, red_output: input, signals: [count(A, 10), count(B, -2)] }));
    circuit.add(new Selector({
      ...select({ sort: SORT.ASC }),
      red_input: input,
      red_output: out,
    }));
    return { out };
  });
  assert.deepEqual(outputMap(ascending.simulation, ascending.out), mapOf([count(B, -2)]));

  const single = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({ enabled: true, red_output: input, signals: [count(A, 10)] }));
    circuit.add(new Selector({
      ...select({ index: { constant: 5 }, compare: CMP.GT }),
      red_input: input,
      red_output: out,
    }));
    return { out };
  });
  assert.equal(single.simulation.read(single.out, A), 10);

  const outside = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({ enabled: true, red_output: input, signals: [count(A, 10), count(B, -2)] }));
    circuit.add(new Selector({
      ...select({ index: { constant: 5 } }),
      red_input: input,
      red_output: out,
    }));
    return { out };
  });
  assert.equal(outside.simulation.present(outside.out).length, 0);

  const ranked = await run((circuit) => {
    const input = circuit.network("red_in");
    const networks = {};
    circuit.add(new Constant({
      enabled: true,
      red_output: input,
      signals: [count(A, 30), count(B, 20), count(C, 10)],
    }));
    for (const [name, compare, index] of [
      ["eq", CMP.EQ, 1],
      ["gt", CMP.GT, 0],
      ["lt", CMP.LT, 2],
      ["gte", CMP.GTE, 2],
      ["lte", CMP.LTE, 0],
      ["neq", CMP.NEQ, 1],
    ]) {
      networks[name] = circuit.network(`red_${name}`);
      circuit.add(new Selector({
        operation: OP.SELECT,
        sort: SORT.DESC,
        index: { constant: index },
        compare,
        red_input: input,
        red_output: networks[name],
      }));
    }
    return networks;
  });
  assert.deepEqual(outputMap(ranked.simulation, ranked.eq), mapOf([count(B, 20)]));
  assert.deepEqual(outputMap(ranked.simulation, ranked.gt), mapOf([count(B, 20), count(C, 10)]));
  assert.deepEqual(outputMap(ranked.simulation, ranked.lt), mapOf([count(A, 30), count(B, 20)]));
  assert.deepEqual(outputMap(ranked.simulation, ranked.gte), mapOf([count(C, 10)]));
  assert.deepEqual(outputMap(ranked.simulation, ranked.lte), mapOf([count(A, 30)]));
  assert.deepEqual(outputMap(ranked.simulation, ranked.neq), mapOf([count(A, 30), count(C, 10)]));
});

test("select читает оба цвета, индекс-сигнал и меняющийся вход", async () => {
  const colors = await run((circuit) => {
    const red = circuit.network("red_in");
    const green = circuit.network("green_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({ enabled: true, red_output: red, signals: [count(A, 4)] }));
    circuit.add(new Constant({ enabled: true, green_output: green, signals: [count(A, 6), count(B, 1)] }));
    const copy = circuit.network("green_copy");
    circuit.add(new Selector({
      ...select(),
      red_input: red,
      green_input: green,
      red_output: out,
      green_output: copy,
    }));
    return { out, copy };
  });
  assert.equal(colors.simulation.read(colors.out, A), 10);
  assert.equal(colors.simulation.read(colors.copy, A), 10);

  const indexed = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({
      enabled: true,
      red_output: input,
      signals: [count(A, 10), count(B, 4), count(C, 1)],
    }));
    circuit.add(new Selector({
      ...select({ index: { signal: C } }),
      red_input: input,
      red_output: out,
    }));
    return { out };
  });
  assert.equal(indexed.simulation.read(indexed.out, B), 4);

  const absent = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({ enabled: true, red_output: input, signals: [count(A, 10), count(B, 4)] }));
    circuit.add(new Selector({
      ...select({ index: { signal: C } }),
      red_input: input,
      red_output: out,
    }));
    return { out };
  });
  assert.equal(absent.simulation.read(absent.out, A), 10);

  const circuit = new Circuit();
  const net = circuit.network("red_net");
  const out = circuit.network("red_out");
  circuit.add(new Constant({ enabled: true, red_output: net, signals: [count(A, 1)] }));
  circuit.add(new Arithmetic({
    red_input: net,
    red_output: net,
    left_operand: { red: true, green: true, signal: A },
    right_operand: { constant: 1 },
    operation: Arithmetic.Operation.SUM,
    return: A,
  }));
  circuit.add(new Selector({ ...select(), red_input: net, red_output: out }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(out, A), 0);
  await simulation.step();
  assert.equal(simulation.read(out, A), 1);
  await simulation.step();
  assert.equal(simulation.read(out, A), 3);

  const tied = new Selector(select());
  assert.throws(() => tied.compute({
    present: () => [count(A, 5), count(B, 5)],
    read: () => 0,
  }), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  const exact = new Selector(select({ compare: CMP.NEQ }));
  assert.deepEqual(exact.compute({
    present: () => [count(A, 4)],
    read: () => 0,
  }).signals, []);
});

test("count считает каналы и не создаёт нулевой выход", async () => {
  const filled = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({ enabled: true, red_output: input, signals: [count(A, 100), count(B, -2)] }));
    circuit.add(new Selector({ operation: OP.COUNT, signal: C, red_input: input, red_output: out }));
    return { out };
  });
  assert.equal(filled.simulation.read(filled.out, C), 2);

  const empty = await run((circuit) => {
    const out = circuit.network("red_out");
    circuit.add(new Selector({ operation: OP.COUNT, signal: C, red_output: out }));
    return { out };
  });
  assert.equal(empty.simulation.present(empty.out).length, 0);
  assert.equal(empty.simulation.device(empty.circuit.devices[0]).state, null);

  const circuit = new Circuit();
  const net = circuit.network("red_net");
  const out = circuit.network("red_out");
  circuit.add(new Constant({ enabled: true, red_output: net, signals: [count(T, 1)] }));
  circuit.add(new Arithmetic({
    red_input: net,
    red_output: net,
    left_operand: { red: true, green: true, signal: T },
    right_operand: { constant: 0 },
    operation: Arithmetic.Operation.SUM,
    return: T,
  }));
  circuit.add(new Decider({
    red_input: net,
    red_output: net,
    conditions: [{
      left_operand: { red: true, green: true, signal: T },
      right_operand: { constant: 2 },
      operation: Decider.Operation.LT,
    }],
    when_true: [{ signal: B, constant: 7 }],
  }));
  circuit.add(new Selector({ operation: OP.COUNT, signal: C, red_input: net, red_output: out }));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.read(out, C), 1);
  await simulation.step();
  assert.equal(simulation.read(out, C), 2);
});

test("random повторяет seed, держит интервал и восстанавливает состояние", async () => {
  async function play(seed, steps) {
    const circuit = new Circuit({ seed });
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({ enabled: true, red_output: input, signals: [count(A, 4), count(B, 9)] }));
    const selector = new Selector({ operation: OP.RANDOM, interval: 2, red_input: input, red_output: out });
    circuit.add(selector);
    const simulation = await circuit.createSimulation();
    const outputs = [];
    for (let step = 0; step < steps; step += 1) {
      await simulation.step();
      outputs.push(simulation.present(out).map((entry) => `${entry.signal.name}:${entry.constant}`));
    }
    return { simulation, selector, outputs };
  }
  const first = await play(7, 4);
  const second = await play(7, 4);
  assert.deepEqual(first.outputs, second.outputs);
  assert.deepEqual(first.outputs[0], []);
  assert.equal(first.outputs[1].length, 1);
  assert.deepEqual(first.outputs[2], first.outputs[1]);
  assert.equal(first.outputs[3].length, 1);
  assert.equal(first.simulation.device(first.selector).state.elapsed, 0);
  const other = await play(8, 0);
  const same = await play(7, 0);
  assert.notEqual(other.simulation.device(other.selector).state.rng, same.simulation.device(same.selector).state.rng);
  assert.equal(same.simulation.device(same.selector).state.held, null);

  const circuit = new Circuit({ seed: 3 });
  const net = circuit.network("red_net");
  const out = circuit.network("red_out");
  circuit.add(new Constant({ enabled: true, red_output: net, signals: [count(A, 1)] }));
  circuit.add(new Arithmetic({
    red_input: net,
    red_output: net,
    left_operand: { red: true, green: true, signal: A },
    right_operand: { constant: 0 },
    operation: Arithmetic.Operation.SUM,
    return: A,
  }));
  const selector = new Selector({ operation: OP.RANDOM, interval: 3, red_input: net, red_output: out });
  circuit.add(selector);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  await simulation.step();
  assert.equal(simulation.present(out).length, 0);
  assert.equal(simulation.device(selector).state.elapsed, 2);
  await simulation.step();
  assert.equal(simulation.read(out, A), 3);
  await simulation.step();
  assert.equal(simulation.read(out, A), 4);
  const snapshot = simulation.capture();
  await simulation.step();
  const later = simulation.read(out, A);
  await simulation.restore(snapshot);
  assert.equal(simulation.read(out, A), 4);
  await simulation.step();
  assert.equal(simulation.read(out, A), later);
  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.present(out).length, 0);
  assert.equal(simulation.device(selector).state.elapsed, 0);
  assert.equal(simulation.device(selector).state.held, null);
});

test("random диагностирует исчезновение выбора и чужое состояние", async () => {
  const circuit = new Circuit({ seed: 1 });
  const net = circuit.network("red_net");
  const seen = circuit.network("red_seen");
  const out = circuit.network("red_out");
  circuit.add(new Constant({ enabled: true, red_output: net, signals: [count(T, 1)] }));
  circuit.add(new Arithmetic({
    red_input: net,
    red_output: net,
    left_operand: { red: true, green: true, signal: T },
    right_operand: { constant: 0 },
    operation: Arithmetic.Operation.SUM,
    return: T,
  }));
  circuit.add(new Decider({
    red_input: net,
    red_output: seen,
    conditions: [{
      left_operand: { red: true, green: true, signal: T },
      right_operand: { constant: 3 },
      operation: Decider.Operation.LT,
    }],
    when_true: [{ signal: B, constant: 7 }],
  }));
  const selector = new Selector({ operation: OP.RANDOM, interval: 1, red_input: seen, red_output: out });
  circuit.add(selector);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.present(out).length, 0);
  await simulation.step();
  assert.equal(simulation.read(out, B), 7);
  await simulation.step();
  assert.equal(simulation.read(out, B), 7);
  const kept = simulation.tick;
  await assert.rejects(simulation.step(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  assert.equal(simulation.tick, kept);
  assert.equal(simulation.device(selector).state.held.name, "signal-B");

  const blank = new Circuit();
  const target = blank.network("red_out");
  const device = new Selector({ operation: OP.RANDOM, interval: 1, red_output: target });
  blank.add(device);
  const broken = [
    () => ({ signals: [] }),
    () => ({ signals: [], random: null }),
    () => ({ signals: [], random: { rng: 1, held: null, elapsed: 0, extra: 1 } }),
    () => ({ signals: [], random: { rng: -1, held: null, elapsed: 0 } }),
    () => ({ signals: [], random: { rng: 1, held: null, elapsed: 1.5 } }),
    () => ({ signals: [], random: { rng: 1, held: [], elapsed: 0 } }),
    () => ({ signals: [], random: { rng: 1, held: "signal-A", elapsed: 0 } }),
    () => ({ signals: [], random: { rng: 1, held: { type: "virtual", name: "signal-A" }, elapsed: 0 } }),
    () => ({ signals: [], random: { rng: 1, held: { type: "virtual", name: "missing", quality: "normal" }, elapsed: 0 } }),
    () => ({ signals: 1, random: { rng: 1, held: null, elapsed: 0 } }),
  ];
  for (const compute of broken) {
    device.compute = compute;
    const failed = await blank.createSimulation();
    await assert.rejects(failed.step(), (error) => error instanceof RuntimeError);
  }
  device.compute = () => ({ signals: [], random: { rng: 4, held: null, elapsed: 0 } });
  const replaced = await blank.createSimulation();
  await replaced.step();
  assert.equal(replaced.device(device).state.rng, 4);

  const snapshot = simulation.capture();
  const deviceState = snapshot.devices.find((item) => item.id === circuit.deviceId(selector));
  const originals = [
    [null, "Состояние random должно быть объектом"],
    [{ rng: 1, elapsed: 0 }, "Состояние random содержит rng, held и elapsed"],
    [{ rng: 1, held: { type: "virtual", name: "signal-A", quality: "normal", extra: true }, elapsed: 0 }, "Канал состояния random содержит type, name и quality"],
  ];
  for (const [state] of originals) {
    deviceState.state = state;
    await assert.rejects(simulation.restore(snapshot), (error) => error instanceof RuntimeError && error.code === "invalid-snapshot");
  }
  const counted = await run((host) => {
    const out = host.network("red_out");
    host.add(new Selector({ operation: OP.COUNT, signal: C, red_output: out }));
    return { out };
  });
  const plain = counted.simulation.capture();
  plain.devices[0].state = { unexpected: true };
  await assert.rejects(counted.simulation.restore(plain), (error) => error.code === "invalid-snapshot");
});

test("stack-size и rocket-capacity берут только подтверждённые данные предмета", async () => {
  const stacked = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({
      enabled: true,
      red_output: input,
      signals: [count(iron, 2), count(water, 9), count(A, 4), count(combinator, 7)],
    }));
    circuit.add(new Selector({ operation: OP.STACK_SIZE, red_input: input, red_output: out }));
    return { out };
  });
  assert.deepEqual(new Selector({ operation: OP.STACK_SIZE }).compute({ profile: "base", present: () => [] }).signals, []);
  assert.deepEqual(new Selector({ operation: OP.ROCKET_CAPACITY }).compute({ profile: "base", present: () => [] }).signals, []);
  assert.equal(stacked.simulation.read(stacked.out, iron), 100);
  assert.equal(stacked.simulation.read(stacked.out, combinator), 50);
  assert.equal(stacked.simulation.read(stacked.out, water), 0);
  assert.equal(stacked.simulation.read(stacked.out, A), 0);

  const capacity = await run((circuit) => {
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({
      enabled: true,
      red_output: input,
      signals: [count(coal, 2), count(water, 1), count(A, 1), count(bomb, 1), count(silo, 1), count(combinator, 3)],
    }));
    circuit.add(new Selector({ operation: OP.ROCKET_CAPACITY, red_input: input, red_output: out }));
    return { out };
  });
  assert.equal(capacity.simulation.read(capacity.out, coal), 500);
  assert.equal(capacity.simulation.read(capacity.out, combinator), 50);
  assert.equal(capacity.simulation.read(capacity.out, bomb), 0);
  assert.equal(capacity.simulation.read(capacity.out, silo), 0);
  assert.equal(capacity.simulation.present(capacity.out).length, 2);

  async function rejectsItem(signal, operation) {
    const circuit = new Circuit();
    const input = circuit.network("red_in");
    circuit.add(new Constant({ enabled: true, red_output: input, signals: [count(signal, 1)] }));
    circuit.add(new Selector({ operation, red_input: input, red_output: circuit.network("red_out") }));
    const simulation = await circuit.createSimulation();
    await assert.rejects(simulation.step(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  }
  await rejectsItem(iron, OP.ROCKET_CAPACITY);
  await rejectsItem(fish, OP.ROCKET_CAPACITY);

  const direct = {
    profile: "base",
    present: () => [count({ type: "item", name: "not-in-catalog", quality: "normal" }, 1)],
  };
  assert.throws(() => new Selector({ operation: OP.STACK_SIZE }).compute(direct), (error) => error.code === "unsupported-case");
  assert.throws(() => new Selector({ operation: OP.ROCKET_CAPACITY }).compute(direct), (error) => error.code === "unsupported-case");

  const quality = new Circuit({ profile: "space-age" });
  const input = quality.network("red_in");
  const out = quality.network("red_out");
  const rare = spaceIron.withQuality(Quality.RARE);
  quality.add(new Constant({ enabled: true, red_output: input, signals: [count(rare, 3)] }));
  quality.add(new Selector({ operation: OP.STACK_SIZE, red_input: input, red_output: out }));
  const simulation = await quality.createSimulation();
  await simulation.step();
  assert.equal(simulation.read(out, rare), 100);
});

test("качество фильтруется, переносится и выбирается по уровням снимка", async () => {
  const normal = spaceIron;
  const uncommon = spaceIron.withQuality(Quality.UNCOMMON);
  const rare = spaceIron.withQuality(Quality.RARE);
  const epic = spaceIron.withQuality(Quality.EPIC);
  const legendary = spaceIron.withQuality(Quality.LEGENDARY);
  const copper = spaceCopper;
  const copperRare = spaceCopper.withQuality(Quality.RARE);
  const circuit = new Circuit({ profile: "space-age" });
  const input = circuit.network("red_in");
  const filtered = circuit.network("red_filter");
  const anyOut = circuit.network("red_any");
  const direct = circuit.network("red_direct");
  const highest = circuit.network("red_high");
  const lowest = circuit.network("red_low");
  circuit.add(new Constant({
    enabled: true,
    red_output: input,
    signals: [
      count(normal, 1),
      count(uncommon, 2),
      count(rare, 3),
      count(epic, 4),
      count(legendary, 5),
      count(copper, 8),
    ],
  }));
  const wire = { red_input: input };
  circuit.add(new Selector({
    ...wire,
    operation: OP.QUALITY_FILTER,
    quality: Quality.RARE,
    compare: CMP.GTE,
    red_output: filtered,
  }));
  circuit.add(new Selector({
    ...wire,
    operation: OP.QUALITY_FILTER,
    quality: anyQuality,
    compare: CMP.EQ,
    red_output: anyOut,
  }));
  circuit.add(new Selector({
    ...wire,
    operation: OP.QUALITY_TRANSFER,
    source: Quality.LEGENDARY,
    destination: spaceIron,
    red_output: direct,
  }));
  circuit.add(new Selector({
    ...wire,
    operation: OP.QUALITY_SELECT,
    highest: true,
    red_output: highest,
  }));
  circuit.add(new Selector({
    ...wire,
    operation: OP.QUALITY_SELECT,
    highest: false,
    red_output: lowest,
  }));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.deepEqual(outputMap(simulation, filtered), mapOf([
    count(rare, 3),
    count(epic, 4),
    count(legendary, 5),
  ]));
  assert.equal(simulation.present(anyOut).length, 6);
  assert.equal(simulation.read(direct, legendary), 15);
  assert.equal(simulation.read(direct, copper), 0);
  assert.equal(simulation.read(highest, legendary), 5);
  assert.equal(simulation.read(highest, copper), 8);
  assert.equal(simulation.read(lowest, normal), 1);
  assert.equal(simulation.read(lowest, copper), 8);

  const transfer = new Circuit({ profile: "space-age" });
  const source = transfer.network("red_in");
  const moved = transfer.network("red_moved");
  transfer.add(new Constant({
    enabled: true,
    red_output: source,
    signals: [count(rare, 4), count(copper, 2), count(copperRare, 3)],
  }));
  transfer.add(new Selector({
    operation: OP.QUALITY_TRANSFER,
    source: spaceIron,
    destination: spaceCopper,
    red_input: source,
    red_output: moved,
  }));
  const movedSimulation = await transfer.createSimulation();
  await movedSimulation.step();
  assert.equal(movedSimulation.read(moved, copperRare), 5);

  const cancelled = new Circuit({ profile: "space-age" });
  const both = cancelled.network("red_in");
  cancelled.add(new Constant({
    enabled: true,
    red_output: both,
    signals: [count(normal, 5), count(rare, -5)],
  }));
  const silent = cancelled.network("red_out");
  cancelled.add(new Selector({
    operation: OP.QUALITY_TRANSFER,
    source: Quality.EPIC,
    destination: spaceIron,
    red_input: both,
    red_output: silent,
  }));
  const silentSimulation = await cancelled.createSimulation();
  await silentSimulation.step();
  assert.equal(silentSimulation.present(silent).length, 0);

  const missing = new Circuit({ profile: "space-age" });
  const onlyIron = missing.network("red_in");
  missing.add(new Constant({ enabled: true, red_output: onlyIron, signals: [count(normal, 2)] }));
  const nowhere = missing.network("red_out");
  missing.add(new Selector({
    operation: OP.QUALITY_TRANSFER,
    source: spaceCopper,
    destination: spaceIron,
    red_input: onlyIron,
    red_output: nowhere,
  }));
  const missingSimulation = await missing.createSimulation();
  await missingSimulation.step();
  assert.equal(missingSimulation.present(nowhere).length, 0);

  const ambiguous = new Selector({
    operation: OP.QUALITY_TRANSFER,
    source: spaceIron,
    destination: spaceCopper,
  });
  assert.throws(() => ambiguous.compute({
    profile: "space-age",
    present: () => [count(normal, 1), count(rare, 1), count(copper, 1)],
  }), (error) => error.code === "unsupported-case");
  const noTarget = new Selector({
    operation: OP.QUALITY_TRANSFER,
    source: Quality.RARE,
    destination: spaceIron,
  });
  assert.deepEqual(noTarget.compute({ present: () => [count(copper, 1)] }).signals, []);
  assert.deepEqual(new Selector({
    operation: OP.QUALITY_FILTER,
    quality: Quality.RARE,
    compare: CMP.EQ,
  }).compute({ present: () => [] }).signals, []);
  assert.deepEqual(new Selector({ operation: OP.QUALITY_SELECT, highest: false }).compute({
    present: () => [],
  }).signals, []);
  const unknown = new Selector({
    operation: OP.QUALITY_FILTER,
    quality: Quality.RARE,
    compare: CMP.EQ,
  });
  assert.throws(() => unknown.compute({
    present: () => [count({ type: "item", name: "iron-plate", quality: "nope" }, 1)],
  }), (error) => error.code === "unsupported-case");
  const tied = new Selector({ operation: OP.QUALITY_SELECT, highest: true });
  assert.throws(() => tied.compute({
    present: () => [count(normal, 1), count(normal, 2)],
  }), (error) => error.code === "unsupported-case");
  assert.throws(() => new Circuit().add(new Selector({
    operation: OP.QUALITY_SELECT,
    highest: false,
    signal: spaceIron,
  })), (error) => error instanceof ConfigError && error.code === "invalid-selector-config");
});

test("time читает контекст мира и задерживается на один тик", async () => {
  async function clock(world, steps) {
    const circuit = new Circuit({ world });
    const input = circuit.network("red_in");
    const out = circuit.network("red_out");
    circuit.add(new Constant({ enabled: true, red_output: input, signals: [count(A, 9)] }));
    circuit.add(new Selector({
      operation: OP.TIME,
      game_tick: T,
      day_tick: D,
      day_length: L,
      red_input: input,
      red_output: out,
    }));
    const simulation = await circuit.createSimulation();
    assert.equal(simulation.present(out).length, 0);
    for (let step = 0; step < steps; step += 1) await simulation.step();
    return simulation.present(out);
  }
  const first = mapOf(await clock({ origin: 5, dayLength: 4 }, 1));
  assert.equal(first.get("virtual/signal-T/normal"), 5);
  assert.equal(first.get("virtual/signal-D/normal"), 1);
  assert.equal(first.get("virtual/signal-L/normal"), 4);
  const wrapped = mapOf(await clock({ origin: 5, dayLength: 4 }, 4));
  assert.equal(wrapped.get("virtual/signal-T/normal"), 8);
  assert.equal(wrapped.has("virtual/signal-D/normal"), false);
  assert.equal(wrapped.get("virtual/signal-L/normal"), 4);
  const other = mapOf(await clock({ origin: 100, dayLength: 25000 }, 1));
  assert.equal(other.get("virtual/signal-T/normal"), 100);
  assert.equal(other.get("virtual/signal-D/normal"), 100);
  assert.equal(other.get("virtual/signal-L/normal"), 25000);

  const partial = new Circuit({ world: { origin: 0, dayLength: 10 } });
  const out = partial.network("red_out");
  partial.add(new Selector({ operation: OP.TIME, day_length: L, red_output: out }));
  const simulation = await partial.createSimulation();
  await simulation.step();
  assert.deepEqual(outputMap(simulation, out), mapOf([count(L, 10)]));

  const overflow = new Circuit({ world: { origin: INT32_MAX, dayLength: 1 } });
  const full = overflow.network("red_out");
  overflow.add(new Selector({ operation: OP.TIME, game_tick: T, day_length: L, red_output: full }));
  const limited = await overflow.createSimulation();
  await limited.step();
  assert.equal(limited.read(full, T), INT32_MAX);
  await assert.rejects(limited.step(), (error) => error.code === "unsupported-case");
});
