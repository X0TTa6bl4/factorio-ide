import assert from "node:assert/strict";
import test from "node:test";
import {
  Arithmetic,
  Circuit,
  Constant,
  Decider,
  EventCombinator,
  Quality,
  RuntimeError,
  Selector,
  Signal,
  openProfile,
} from "../../../src/index.js";
import { ConfigError } from "../../../src/errors.js";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;
const D = Signal.Signals.signal_D;
const E = Signal.Signals.signal_E;
const F = Signal.Signals.signal_F;
const G = Signal.Signals.signal_G;
const K = Signal.Signals.signal_K;
const T = Signal.Signals.signal_T;
const L = Signal.Signals.signal_L;
const SUM = Arithmetic.Operation.SUM;
const DIV = Arithmetic.Operation.DIV;
const GT = Decider.Operation.GT;
const LT = Decider.Operation.LT;
const OP = Selector.Operation;
const SORT = Selector.Sort;
const CMP = Selector.Compare;

function count(signal, constant) {
  return { signal, constant };
}

function output(red, green, signals) {
  return { red, green, signals };
}

function labels(simulation, network) {
  return simulation.present(network)
    .map((entry) => `${entry.signal.name}/${entry.signal.quality}=${entry.constant}`)
    .sort();
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error instanceof ConfigError && error.code === code);
}

async function traceRows(simulation, read, steps) {
  const rows = [read()];
  for (let index = 0; index < steps; index += 1) {
    await simulation.step();
    rows.push(read());
  }
  return rows;
}

test("цепочка пяти типов публикует каждый выход на своей границе", async () => {
  class Mark extends EventCombinator {
    main() {
      if (this.tick === 0) this.pulse(output(true, false, [count(E, 1)]), 1);
    }
  }
  const expected = [
    { A: 3, B: 0, C: 0, E: 0, pick: 0, D: 0 },
    { A: 3, B: 5, C: 0, E: 1, pick: 0, D: 0 },
    { A: 3, B: 5, C: 1, E: 0, pick: 0, D: 0 },
    { A: 3, B: 5, C: 1, E: 0, pick: 1, D: 0 },
    { A: 3, B: 5, C: 1, E: 0, pick: 1, D: 1 },
  ];
  async function run(reverse) {
    const circuit = new Circuit();
    const red = circuit.network("red_a");
    const mid = circuit.network("green_b");
    const decided = circuit.network("red_c");
    const picked = circuit.network("green_pick");
    const counted = circuit.network("red_count");
    const devices = [
      new Constant({ enabled: true, red_output: red, signals: [count(A, 3)] }),
      new Arithmetic({
        red_input: red,
        green_output: mid,
        left_operand: { red: true, green: false, signal: A },
        right_operand: { constant: 2 },
        operation: SUM,
        return: B,
      }),
      new Decider({
        green_input: mid,
        red_output: decided,
        conditions: [{
          left_operand: { red: false, green: true, signal: B },
          right_operand: { constant: 0 },
          operation: GT,
        }],
        when_true: [count(C, 1)],
      }),
      new Selector({
        operation: OP.SELECT,
        sort: SORT.DESC,
        index: { constant: 0 },
        compare: CMP.EQ,
        red_input: decided,
        green_output: picked,
      }),
      new Selector({
        operation: OP.COUNT,
        signal: D,
        green_input: picked,
        red_output: counted,
      }),
      new Mark({ red_output: red }),
    ];
    for (const device of reverse ? [...devices].reverse() : devices) circuit.add(device);
    const simulation = await circuit.createSimulation();
    return traceRows(simulation, () => ({
      A: simulation.read(red, A),
      B: simulation.read(mid, B),
      C: simulation.read(decided, C),
      E: simulation.read(red, E),
      pick: simulation.read(picked, C),
      D: simulation.read(counted, D),
    }), 4);
  }
  assert.deepEqual(await run(false), expected);
  assert.deepEqual(await run(true), expected);
});

test("константа и самоссылка складывают предыдущий снимок: 1, 3, 5, 7", async () => {
  async function run(constantFirst) {
    const circuit = new Circuit();
    const net = circuit.network("red_loop");
    const counted = circuit.network("green_count");
    const source = new Constant({ enabled: true, red_output: net, signals: [count(A, 1)] });
    const arithmetic = new Arithmetic({
      red_input: net,
      red_output: net,
      left_operand: { red: true, green: false, signal: A },
      right_operand: { constant: 1 },
      operation: SUM,
      return: A,
    });
    const counter = new Selector({
      operation: OP.COUNT,
      signal: D,
      red_input: net,
      green_output: counted,
    });
    for (const device of constantFirst ? [source, arithmetic, counter] : [counter, arithmetic, source]) {
      circuit.add(device);
    }
    const simulation = await circuit.createSimulation();
    const rows = await traceRows(simulation, () => ({
      A: simulation.read(net, A),
      D: simulation.read(counted, D),
    }), 3);
    assert.deepEqual(rows, [
      { A: 1, D: 0 },
      { A: 3, D: 1 },
      { A: 5, D: 1 },
      { A: 7, D: 1 },
    ]);
    assert.equal(simulation.present(net).length, 1);
  }
  await run(true);
  await run(false);
});

test("разные цвета и общая шина суммируют вклады и не оставляют ноль", async () => {
  async function run(reverse) {
    const circuit = new Circuit();
    const redIn = circuit.network("red_in");
    const greenIn = circuit.network("green_in");
    const bus = circuit.network("green_bus");
    const summed = circuit.network("green_sum");
    const redOnly = circuit.network("green_red");
    const top = circuit.network("red_top");
    const counted = circuit.network("red_count");
    const devices = [
      new Constant({ enabled: true, red_output: redIn, signals: [count(A, 4), count(B, -3)] }),
      new Constant({ enabled: true, green_output: greenIn, signals: [count(A, -4), count(C, 6)] }),
      new Constant({ enabled: true, green_output: bus, signals: [count(B, 3), count(F, 1)] }),
      new Constant({ enabled: true, green_output: bus, signals: [count(F, -1)] }),
      new Arithmetic({
        red_input: redIn,
        green_input: greenIn,
        green_output: summed,
        left_operand: { red: true, green: true, signal: A },
        right_operand: { constant: 0 },
        operation: SUM,
        return: D,
      }),
      new Arithmetic({
        red_input: redIn,
        green_output: redOnly,
        left_operand: { red: true, green: false, signal: A },
        right_operand: { constant: 0 },
        operation: SUM,
        return: A,
      }),
      new Arithmetic({
        red_input: redIn,
        green_output: bus,
        left_operand: { red: true, green: false, signal: B },
        right_operand: { constant: 0 },
        operation: SUM,
        return: B,
      }),
      new Decider({
        green_input: greenIn,
        green_output: bus,
        conditions: [{
          left_operand: { red: false, green: true, signal: C },
          right_operand: { constant: 0 },
          operation: GT,
        }],
        when_true: [count(E, 1)],
      }),
      new Selector({
        operation: OP.SELECT,
        sort: SORT.DESC,
        index: { constant: 0 },
        compare: CMP.EQ,
        green_input: greenIn,
        red_output: top,
      }),
      new Selector({
        operation: OP.COUNT,
        signal: G,
        green_input: bus,
        red_output: counted,
      }),
    ];
    for (const device of reverse ? [...devices].reverse() : devices) circuit.add(device);
    const simulation = await circuit.createSimulation();
    assert.equal(simulation.read(redIn, B), -3);
    assert.deepEqual(labels(simulation, bus), ["signal-B/normal=3"]);
    assert.equal(simulation.present(summed).length, 0);
    assert.equal(simulation.present(top).length, 0);
    await simulation.step();
    assert.equal(simulation.present(summed).length, 0);
    assert.equal(simulation.read(redOnly, A), 4);
    assert.deepEqual(labels(simulation, bus), ["signal-E/normal=1"]);
    assert.equal(simulation.read(top, C), 6);
    assert.equal(simulation.read(counted, G), 1);
    await simulation.step();
    assert.deepEqual(labels(simulation, bus), ["signal-E/normal=1"]);
    assert.equal(simulation.read(counted, G), 1);
    assert.equal(simulation.present(bus).some((entry) => entry.constant === 0), false);
  }
  await run(false);
  await run(true);
});

test("отрицательные каналы сохраняются, взаимная отмена не создаёт итог", async () => {
  const cases = [
    { parts: [count(A, 5), count(A, -5)], value: 0, negative: false },
    { parts: [count(A, -7)], value: -7, negative: true },
    { parts: [count(A, -7), count(A, 2)], value: -5, negative: true },
    { parts: [count(A, 4), count(B, -4)], value: 4, negative: false, other: -4 },
  ];
  for (const item of cases) {
    const circuit = new Circuit();
    const red = circuit.network("red_in");
    const copied = circuit.network("green_copy");
    const flag = circuit.network("red_flag");
    const [first, ...rest] = item.parts;
    circuit.add(new Constant({ enabled: true, red_output: red, signals: [first] }));
    if (rest.length > 0) {
      circuit.add(new Constant({ enabled: true, red_output: red, signals: rest }));
    }
    circuit.add(new Arithmetic({
      red_input: red,
      green_output: copied,
      left_operand: { red: true, green: false, signal: A },
      right_operand: { constant: 0 },
      operation: SUM,
      return: A,
    }));
    circuit.add(new Decider({
      red_input: red,
      red_output: flag,
      conditions: [{
        left_operand: { red: true, green: false, signal: A },
        right_operand: { constant: 0 },
        operation: LT,
      }],
      when_true: [count(C, 1)],
    }));
    const simulation = await circuit.createSimulation();
    assert.equal(simulation.read(red, A), item.value);
    if (item.other !== undefined) assert.equal(simulation.read(red, B), item.other);
    if (item.value === 0) assert.equal(simulation.present(red).some((entry) => entry.signal === A), false);
    await simulation.step();
    assert.equal(simulation.read(copied, A), item.value);
    assert.equal(simulation.read(flag, C), item.negative ? 1 : 0);
    if (item.value === 0) assert.equal(simulation.present(copied).length, 0);
  }
});

test("качества не складываются между собой, отмена действует внутри качества", async () => {
  const iron = openProfile("space-age").tree.Intermediate.iron_plate;
  const rare = iron.withQuality(Quality.RARE);
  const cases = [
    { signals: [count(iron, 4), count(rare, -4)], iron: 4, rare: -4 },
    { signals: [count(iron, 1), count(rare, 3), count(rare, -3)], iron: 1, rare: 0 },
  ];
  for (const item of cases) {
    const circuit = new Circuit({ profile: "space-age" });
    const red = circuit.network("red_in");
    const filtered = circuit.network("green_rare");
    const copied = circuit.network("green_copy");
    circuit.add(new Constant({ enabled: true, red_output: red, signals: item.signals }));
    circuit.add(new Selector({
      operation: OP.QUALITY_FILTER,
      quality: Quality.RARE,
      compare: CMP.EQ,
      red_input: red,
      green_output: filtered,
    }));
    circuit.add(new Arithmetic({
      red_input: red,
      green_output: copied,
      left_operand: { red: true, green: false, signal: iron },
      right_operand: { constant: 0 },
      operation: SUM,
      return: iron,
    }));
    const simulation = await circuit.createSimulation();
    assert.equal(simulation.read(red, iron), item.iron);
    assert.equal(simulation.read(red, rare), item.rare);
    await simulation.step();
    assert.equal(simulation.read(filtered, rare), item.rare);
    assert.equal(simulation.read(copied, iron), item.iron);
    assert.equal(simulation.read(copied, rare), 0);
    if (item.rare === 0) assert.equal(simulation.present(filtered).length, 0);
  }
});

test("событие меняет вход по тикам, игровые устройства видят его со следующей границы", async () => {
  class Ramp extends EventCombinator {
    main() {
      this.setOutput(output(true, false, [count(A, this.nextTick + 10)]));
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const green = circuit.network("green_b");
  const flag = circuit.network("red_c");
  const counted = circuit.network("green_count");
  circuit.add(new Ramp({ red_output: red }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 0 },
    operation: SUM,
    return: B,
  }));
  circuit.add(new Decider({
    green_input: green,
    red_output: flag,
    conditions: [{
      left_operand: { red: false, green: true, signal: B },
      right_operand: { constant: 0 },
      operation: GT,
    }],
    when_true: [count(C, 1)],
  }));
  circuit.add(new Selector({
    operation: OP.COUNT,
    signal: D,
    red_input: red,
    green_output: counted,
  }));
  const simulation = await circuit.createSimulation();
  const rows = await traceRows(simulation, () => ({
    A: simulation.read(red, A),
    B: simulation.read(green, B),
    C: simulation.read(flag, C),
    D: simulation.read(counted, D),
  }), 3);
  assert.deepEqual(rows, [
    { A: 0, B: 0, C: 0, D: 0 },
    { A: 11, B: 0, C: 0, D: 0 },
    { A: 12, B: 11, C: 0, D: 1 },
    { A: 13, B: 12, C: 1, D: 1 },
  ]);
});

test("отключение и повторное подключение не меняют уже идущий прогон", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const green = circuit.network("green_out");
  const alt = circuit.network("green_alt");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: [count(A, 3)] }));
  circuit.add(new Constant({ enabled: true, green_output: green, signals: [count(D, 1)] }));
  circuit.add(new Constant({ enabled: true, green_output: alt, signals: [count(F, 1)] }));
  const arithmetic = new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 2 },
    operation: SUM,
    return: B,
  });
  circuit.add(arithmetic);
  const firstId = circuit.deviceId(arithmetic);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.read(green, B), 5);
  assert.equal(simulation.read(green, D), 1);

  arithmetic.green_output = null;
  await simulation.step();
  assert.equal(simulation.read(green, B), 5);
  const detached = await circuit.createSimulation();
  await detached.step();
  assert.equal(detached.read(green, B), 0);
  assert.equal(detached.read(green, D), 1);
  assert.equal(detached.device(arithmetic).output.green.length, 0);
  assert.equal(simulation.read(green, B), 5);

  arithmetic.green_output = alt;
  const moved = await circuit.createSimulation();
  await moved.step();
  assert.equal(moved.read(alt, B), 5);
  assert.equal(moved.read(alt, F), 1);
  assert.equal(moved.read(green, B), 0);
  assert.equal(simulation.tick, 2);

  arithmetic.green_output = green;
  circuit.remove(arithmetic);
  const without = await circuit.createSimulation();
  await without.step();
  assert.equal(without.read(green, B), 0);
  assert.equal(without.read(green, D), 1);
  await simulation.step();
  assert.equal(simulation.read(green, B), 5);
  circuit.add(arithmetic);
  assert.notEqual(circuit.deviceId(arithmetic), firstId);
  const restored = await circuit.createSimulation();
  await restored.step();
  assert.equal(restored.read(green, B), 5);
  assert.equal(simulation.read(green, B), 5);

  arithmetic.red_input = null;
  const blind = await circuit.createSimulation();
  await blind.step();
  assert.equal(blind.read(green, B), 2);
  arithmetic.red_input = green;
  await assert.rejects(circuit.createSimulation(), (error) => error.code === "wrong-color");
  assert.equal(simulation.read(green, B), 5);
  arithmetic.red_input = red;
});

test("random, time и RNG события повторяются после reset, restore и смены мира", async () => {
  class Draw extends EventCombinator {
    main() {
      this.state.draw = this.random();
      const value = this.state.draw < 0.5 ? 1 : 2;
      this.setOutput(output(true, false, [count(A, value)]));
    }
  }
  const world = { origin: 10, dayLength: 6 };
  function build(seed, clock) {
    const circuit = new Circuit({ seed, world: clock });
    const redIn = circuit.network("red_in");
    const randOut = circuit.network("green_rand");
    const counted = circuit.network("red_count");
    const timeOut = circuit.network("green_time");
    const eventOut = circuit.network("red_evt");
    const mathOut = circuit.network("green_math");
    const flag = circuit.network("red_flag");
    circuit.add(new Constant({ enabled: true, red_output: redIn, signals: [count(B, 4), count(C, 9)] }));
    const random = new Selector({
      operation: OP.RANDOM,
      interval: 2,
      red_input: redIn,
      green_output: randOut,
    });
    const event = new Draw({ red_output: eventOut });
    circuit.add(random);
    circuit.add(new Selector({
      operation: OP.COUNT,
      signal: K,
      green_input: randOut,
      red_output: counted,
    }));
    circuit.add(new Selector({
      operation: OP.TIME,
      game_tick: T,
      day_tick: D,
      day_length: L,
      green_output: timeOut,
    }));
    circuit.add(event);
    circuit.add(new Arithmetic({
      red_input: eventOut,
      green_output: mathOut,
      left_operand: { red: true, green: false, signal: A },
      right_operand: { constant: 0 },
      operation: SUM,
      return: B,
    }));
    circuit.add(new Decider({
      red_input: eventOut,
      red_output: flag,
      conditions: [{
        left_operand: { red: true, green: false, signal: A },
        right_operand: { constant: 0 },
        operation: GT,
      }],
      when_true: [count(E, 1)],
    }));
    return { circuit, random, event, randOut, counted, timeOut, eventOut, mathOut, flag };
  }
  function frame(simulation, built) {
    return {
      tick: simulation.tick,
      rand: labels(simulation, built.randOut),
      count: simulation.read(built.counted, K),
      time: labels(simulation, built.timeOut),
      evt: simulation.read(built.eventOut, A),
      math: simulation.read(built.mathOut, B),
      flag: simulation.read(built.flag, E),
      randomState: simulation.device(built.random).state,
      eventRng: simulation.device(built.event).rng,
      draw: simulation.device(built.event).state.draw ?? null,
    };
  }
  async function play(seed, clock) {
    const built = build(seed, clock);
    const simulation = await built.circuit.createSimulation();
    const frames = [];
    let snapshot = null;
    const record = () => frames.push(frame(simulation, built));
    record();
    for (let index = 0; index < 5; index += 1) {
      await simulation.step();
      record();
      if (index === 2) snapshot = simulation.capture();
    }
    return { simulation, built, frames, snapshot };
  }
  const first = await play(11, world);
  assert.equal(first.frames[1].evt === 1 || first.frames[1].evt === 2, true);
  assert.equal(first.frames[1].math, 0);
  assert.equal(first.frames[1].flag, 0);
  assert.equal(first.frames[2].math, first.frames[1].evt);
  assert.equal(first.frames[2].flag, 1);
  assert.deepEqual(first.frames[1].rand, []);
  assert.equal(first.frames[2].rand.length, 1);
  assert.equal(first.frames[3].count, 1);
  assert.deepEqual(first.frames[1].time, ["signal-D/normal=4", "signal-L/normal=6", "signal-T/normal=10"]);
  assert.deepEqual(first.frames[3].time, ["signal-L/normal=6", "signal-T/normal=12"]);
  const again = await play(11, world);
  assert.deepEqual(again.frames, first.frames);
  await first.simulation.restore(first.snapshot);
  assert.deepEqual(frame(first.simulation, first.built), first.frames[3]);
  await first.simulation.step();
  assert.deepEqual(frame(first.simulation, first.built), first.frames[4]);
  await first.simulation.step();
  assert.deepEqual(frame(first.simulation, first.built), first.frames[5]);
  await first.simulation.reset();
  const replay = [];
  replay.push(frame(first.simulation, first.built));
  for (let index = 0; index < 5; index += 1) {
    await first.simulation.step();
    replay.push(frame(first.simulation, first.built));
  }
  assert.deepEqual(replay, first.frames);
  const shifted = await play(11, { origin: 80, dayLength: 6 });
  for (let index = 0; index < first.frames.length; index += 1) {
    const left = first.frames[index];
    const right = shifted.frames[index];
    assert.deepEqual(right.rand, left.rand);
    assert.equal(right.count, left.count);
    assert.equal(right.evt, left.evt);
    assert.equal(right.math, left.math);
    assert.equal(right.flag, left.flag);
    assert.deepEqual(right.randomState, left.randomState);
    assert.equal(right.eventRng, left.eventRng);
    assert.equal(right.draw, left.draw);
  }
  assert.notDeepEqual(shifted.frames[1].time, first.frames[1].time);
  assert.equal(shifted.frames[1].time.some((entry) => entry.endsWith("=80")), true);
});

test("группа постоянного меняет следующий прогон и не меняет reset текущего", async () => {
  const shared = new Constant.Group({
    name: "plates",
    filters: [{ signal: A, min: 2, max: null }],
  });
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const green = circuit.network("green_out");
  circuit.add(new Constant({
    enabled: true,
    red_output: red,
    sections: [{ active: true, multiplier: 1, group: shared }],
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 1 },
    operation: SUM,
    return: B,
  }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 2);
  await simulation.step();
  assert.equal(simulation.read(green, B), 3);
  shared.replaceFilters([{ signal: A, min: 9, max: null }]);
  await simulation.step();
  assert.equal(simulation.read(red, A), 2);
  assert.equal(simulation.read(green, B), 3);
  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 2);
  assert.equal(simulation.read(green, B), 0);
  await simulation.step();
  assert.equal(simulation.read(green, B), 3);
  const next = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 2);
  assert.equal(next.read(red, A), 9);
  await next.step();
  assert.equal(next.read(green, B), 10);
  assert.equal(simulation.read(green, B), 3);
});

test("ошибка конфигурации, сценария и спорной ветви не портит соседей", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const green = circuit.network("green_out");
  const kept = circuit.network("red_kept");
  const source = new Constant({ enabled: true, red_output: red, signals: [count(A, 8)] });
  circuit.add(source);
  circuit.add(new Constant({ enabled: true, red_output: kept, signals: [count(D, 3)] }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 0 },
    operation: SUM,
    return: B,
  }));
  const running = await circuit.createSimulation();
  assert.equal(circuit.devices.length, 3);
  throwsCode(() => new Decider({ conditions: null }), "invalid-conditions");
  throwsCode(() => new Selector({ operation: OP.RANDOM, interval: 0 }), "unsupported-case");
  const quality = new Selector({
    operation: OP.QUALITY_FILTER,
    quality: Quality.RARE,
    compare: CMP.EQ,
  });
  throwsCode(() => circuit.add(quality), "unavailable-mode");
  assert.equal(circuit.devices.includes(quality), false);
  assert.equal(circuit.devices.length, 3);
  await running.step();
  assert.equal(running.read(red, A), 8);
  assert.equal(running.read(kept, D), 3);

  const spare = circuit.network("red_spare");
  class Boom extends EventCombinator {
    init() {
      throw new Error("init");
    }
  }
  const boom = new Boom({});
  circuit.add(boom);
  await assert.rejects(circuit.createSimulation(), (error) => {
    assert.equal(error instanceof RuntimeError, true);
    assert.equal(error.code, "script-error");
    assert.equal(error.deviceId, circuit.deviceId(boom));
    assert.equal(error.tick, 0);
    return true;
  });
  assert.equal(spare.circuit, circuit);
  assert.equal(circuit.network("red_spare"), spare);
  assert.equal(running.read(kept, D), 3);
  circuit.remove(boom);
  const recovered = await circuit.createSimulation();
  assert.equal(spare.circuit, null);
  assert.equal(recovered.read(red, A), 8);
  assert.equal(running.read(red, A), 8);

  source.enabled = "no";
  await assert.rejects(circuit.createSimulation(), (error) => error.code === "invalid-enabled");
  assert.equal(running.read(kept, D), 3);
  source.enabled = true;

  let broken = false;
  class Flaky extends EventCombinator {
    main() {
      this.state.seen = this.nextTick;
      this.setOutput(output(true, false, [count(A, this.nextTick + 4)]));
      if (broken) throw new Error("stop");
    }
  }
  const events = new Circuit();
  const eventRed = events.network("red_in");
  const eventGreen = events.network("green_out");
  const keptNet = events.network("red_kept");
  const event = new Flaky({ red_output: eventRed });
  events.add(event);
  events.add(new Constant({ enabled: true, red_output: keptNet, signals: [count(D, 3)] }));
  events.add(new Arithmetic({
    red_input: eventRed,
    green_output: eventGreen,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 0 },
    operation: SUM,
    return: B,
  }));
  const flaky = await events.createSimulation();
  await flaky.step();
  await flaky.step();
  assert.equal(flaky.tick, 2);
  assert.equal(flaky.read(eventRed, A), 6);
  assert.equal(flaky.read(eventGreen, B), 5);
  assert.equal(flaky.device(event).state.seen, 2);
  broken = true;
  await assert.rejects(flaky.step(), (error) => error.code === "script-error" && error.deviceId === events.deviceId(event));
  assert.equal(flaky.tick, 2);
  assert.equal(flaky.read(eventRed, A), 6);
  assert.equal(flaky.read(eventGreen, B), 5);
  assert.equal(flaky.read(keptNet, D), 3);
  assert.equal(flaky.device(event).state.seen, 2);
  broken = false;
  await flaky.step();
  assert.equal(flaky.tick, 3);
  assert.equal(flaky.read(eventRed, A), 7);
  assert.equal(flaky.read(eventGreen, B), 6);
  assert.equal(flaky.device(event).state.seen, 3);

  let clear = true;
  class Divisor extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(B, 2)]));
    }

    main() {
      if (clear && this.tick === 0) this.setOutput(output(true, false, []));
      else this.setOutput(output(true, false, [count(B, 9)]));
    }
  }
  const mixed = new Circuit();
  const mixedRed = mixed.network("red_in");
  const mixedGreen = mixed.network("green_out");
  const mixedKept = mixed.network("red_kept");
  mixed.add(new Constant({ enabled: true, red_output: mixedRed, signals: [count(A, 8)] }));
  mixed.add(new Constant({ enabled: true, red_output: mixedKept, signals: [count(D, 3)] }));
  mixed.add(new Divisor({ red_output: mixedRed }));
  mixed.add(new Arithmetic({
    red_input: mixedRed,
    green_output: mixedGreen,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { red: true, green: false, signal: B },
    operation: DIV,
    return: C,
  }));
  const division = await mixed.createSimulation();
  await division.step();
  assert.equal(division.tick, 1);
  assert.equal(division.read(mixedRed, B), 0);
  assert.equal(division.read(mixedGreen, C), 4);
  await assert.rejects(division.step(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  assert.equal(division.tick, 1);
  assert.equal(division.read(mixedRed, A), 8);
  assert.equal(division.read(mixedRed, B), 0);
  assert.equal(division.read(mixedGreen, C), 4);
  assert.equal(division.read(mixedKept, D), 3);
  clear = false;
  await division.reset();
  assert.equal(division.tick, 0);
  assert.equal(division.read(mixedRed, B), 2);
  assert.equal(division.read(mixedGreen, C), 0);
  await division.step();
  assert.equal(division.read(mixedGreen, C), 4);
  assert.equal(division.read(mixedRed, B), 9);

  class Twin extends EventCombinator {
    main() {
      this.setOutput(output(true, false, [count(B, this.tick === 0 ? 5 : 9)]));
    }
  }
  const tied = new Circuit();
  const tieRed = tied.network("red_in");
  const tieOut = tied.network("green_out");
  const tieKept = tied.network("red_kept");
  tied.add(new Constant({ enabled: true, red_output: tieRed, signals: [count(A, 5)] }));
  tied.add(new Constant({ enabled: true, red_output: tieKept, signals: [count(D, 3)] }));
  tied.add(new Twin({ red_output: tieRed }));
  const selector = new Selector({
    operation: OP.SELECT,
    sort: SORT.DESC,
    index: { constant: 0 },
    compare: CMP.EQ,
    red_input: tieRed,
    green_output: tieOut,
  });
  tied.add(selector);
  const choice = await tied.createSimulation();
  await choice.step();
  assert.equal(choice.read(tieOut, A), 5);
  assert.equal(choice.read(tieRed, B), 5);
  await assert.rejects(choice.step(), (error) => error.code === "unsupported-case");
  assert.equal(choice.tick, 1);
  assert.equal(choice.read(tieOut, A), 5);
  assert.equal(choice.read(tieRed, B), 5);
  assert.equal(choice.read(tieKept, D), 3);
  assert.equal(choice.device(selector).output.green.length, 1);
  await choice.reset();
  assert.equal(choice.tick, 0);
  assert.equal(choice.read(tieRed, B), 0);
  assert.equal(choice.present(tieOut).length, 0);
  assert.equal(choice.read(tieKept, D), 3);
});
