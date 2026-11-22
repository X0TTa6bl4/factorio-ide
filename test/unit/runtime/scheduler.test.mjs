/** Пересчёт по зависимостям: очередь, сохранённые вклады и совпадение с полным проходом. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Arithmetic,
  Circuit,
  Constant,
  Decider,
  EventCombinator,
  Selector,
  Signal,
} from "../../../src/index.js";
import { rejectsCode } from "../signals/support.mjs";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;
const D = Signal.Signals.signal_D;
const E = Signal.Signals.signal_E;
const F = Signal.Signals.signal_F;
const G = Signal.Signals.signal_G;
const K = Signal.Signals.signal_K;
const L = Signal.Signals.signal_L;
const T = Signal.Signals.signal_T;
const EACH = Signal.Meta.signal_each;
const SUM = Arithmetic.Operation.SUM;
const SUB = Arithmetic.Operation.SUB;
const GT = Decider.Operation.GT;
const OP = Selector.Operation;
const red = { red: true, green: false };
const green = { red: false, green: true };
const neither = { red: false, green: false };
const quiet = { every_tick: false, input_changed: false };
const onInput = { every_tick: false, input_changed: true };

function count(signal, constant) {
  return { signal, constant };
}

function track(device) {
  const original = device.compute;
  const ticks = [];
  device.compute = (view) => {
    ticks.push(view.tick);
    return original(view);
  };
  return ticks;
}

function wire(signal, mask = red) {
  return { ...mask, signal };
}

async function settle(simulation, steps) {
  for (let index = 0; index < steps; index += 1) await simulation.step();
}

test("планировщик принимает только full и optimized", async () => {
  const circuit = new Circuit();
  circuit.network("red_1");
  await rejectsCode(circuit.createSimulation({ scheduler: "dependency" }), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation({ scheduler: "" }), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation({ scheduler: null }), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation({ scheduler: 1 }), "invalid-simulation-options");
  await rejectsCode(circuit.createSimulation({ scheduler: false }), "invalid-simulation-options");
  assert.equal(circuit.networks.length, 1);
});

test("SCH-1 устойчивый выход считается один раз и сохраняет вклад", async () => {
  function build() {
    const circuit = new Circuit();
    const source = circuit.network("red_src");
    const redOut = circuit.network("red_out");
    const greenOut = circuit.network("green_out");
    const writer = new Arithmetic({
      red_input: source,
      red_output: redOut,
      green_output: greenOut,
      left_operand: wire(A),
      right_operand: { constant: 10 },
      operation: Arithmetic.Operation.MUL,
      return: B,
    });
    const ticks = track(writer);
    circuit.add(new Constant({ enabled: true, red_output: source, signals: [count(A, 1)] }));
    circuit.add(writer);
    return { circuit, redOut, greenOut, writer, ticks };
  }
  const full = build();
  const optimized = build();
  const fullRun = await full.circuit.createSimulation({ scheduler: "full" });
  const optimizedRun = await optimized.circuit.createSimulation({ scheduler: "optimized" });
  await settle(fullRun, 3);
  await settle(optimizedRun, 3);
  assert.deepEqual(full.ticks, [0, 1, 2]);
  assert.deepEqual(optimized.ticks, [0]);
  assert.equal(optimizedRun.read(optimized.redOut, B), 10);
  assert.equal(optimizedRun.read(optimized.greenOut, B), 10);
  assert.deepEqual(optimizedRun.capture(), fullRun.capture());
  assert.deepEqual(optimizedRun.device(optimized.writer).output.red, [{ signal: B, constant: 10 }]);
  assert.deepEqual(optimizedRun.device(optimized.writer).output.green, [{ signal: B, constant: 10 }]);
});

test("SCH-2 два изменившихся входа дают один расчёт", async () => {
  class Both extends EventCombinator {
    main() {
      if (this.nextTick === 1) {
        this.setOutput({ red: true, green: false, signals: [count(A, 2)] });
        this.setOutput({ red: false, green: true, signals: [count(C, 4)] });
      }
    }
  }
  const circuit = new Circuit();
  const left = circuit.network("red_left");
  const right = circuit.network("green_right");
  const out = circuit.network("red_out");
  const reader = new Arithmetic({
    red_input: left,
    green_input: right,
    red_output: out,
    left_operand: wire(A),
    right_operand: wire(C, green),
    operation: SUM,
    return: B,
  });
  const ticks = track(reader);
  circuit.add(new Both({ red_output: left, green_output: right }));
  circuit.add(reader);
  const simulation = await circuit.createSimulation({ scheduler: "optimized" });
  await settle(simulation, 3);
  assert.deepEqual(ticks, [0, 1]);
  assert.equal(simulation.read(out, B), 6);
});

test("SCH-3 взаимная компенсация не будит читателя сети", async () => {
  class Boost extends EventCombinator {
    main() {
      if (this.nextTick === 1) this.setOutput({ red: false, green: true, signals: [count(K, 1)] });
    }
  }
  const circuit = new Circuit();
  const control = circuit.network("green_control");
  const bus = circuit.network("red_bus");
  const out = circuit.network("green_out");
  const up = new Arithmetic({
    green_input: control,
    red_output: bus,
    left_operand: wire(K, green),
    right_operand: { constant: 0 },
    operation: SUM,
    return: A,
  });
  const down = new Arithmetic({
    green_input: control,
    red_output: bus,
    left_operand: { constant: 5 },
    right_operand: wire(K, green),
    operation: SUB,
    return: A,
  });
  const reader = new Arithmetic({
    red_input: bus,
    green_output: out,
    left_operand: wire(A),
    right_operand: { constant: 0 },
    operation: SUM,
    return: C,
  });
  const upTicks = track(up);
  const downTicks = track(down);
  const readerTicks = track(reader);
  circuit.add(new Constant({ enabled: true, green_output: control, signals: [count(K, 1)] }));
  circuit.add(new Boost({ green_output: control }));
  circuit.add(up);
  circuit.add(down);
  circuit.add(reader);
  const simulation = await circuit.createSimulation({ scheduler: "optimized" });
  await settle(simulation, 3);
  assert.deepEqual([simulation.read(bus, A), simulation.read(out, C)], [5, 5]);
  assert.deepEqual(upTicks, [0, 1]);
  assert.deepEqual(downTicks, [0, 1]);
  assert.deepEqual(readerTicks, [0, 1]);
});

test("SCH-4 выход только в красный не меняет зелёную сеть", async () => {
  const circuit = new Circuit();
  const redSrc = circuit.network("red_src");
  const greenSrc = circuit.network("green_src");
  const redOut = circuit.network("red_out");
  const greenOut = circuit.network("green_out");
  const writer = new Arithmetic({
    red_input: redSrc,
    red_output: redOut,
    left_operand: wire(A),
    right_operand: { constant: 10 },
    operation: Arithmetic.Operation.MUL,
    return: C,
  });
  const greenReader = new Arithmetic({
    green_input: greenSrc,
    green_output: greenOut,
    left_operand: wire(B, green),
    right_operand: { constant: 0 },
    operation: SUM,
    return: D,
  });
  const redReader = new Arithmetic({
    red_input: redOut,
    green_output: greenOut,
    left_operand: wire(C),
    right_operand: { constant: 0 },
    operation: SUM,
    return: E,
  });
  const writerTicks = track(writer);
  const greenTicks = track(greenReader);
  const redTicks = track(redReader);
  circuit.add(new Constant({ enabled: true, red_output: redSrc, signals: [count(A, 1)] }));
  circuit.add(new Constant({ enabled: true, green_output: greenSrc, signals: [count(B, 2)] }));
  circuit.add(writer);
  circuit.add(greenReader);
  circuit.add(redReader);
  const simulation = await circuit.createSimulation({ scheduler: "optimized" });
  await settle(simulation, 3);
  assert.deepEqual(writerTicks, [0]);
  assert.deepEqual(greenTicks, [0]);
  assert.deepEqual(redTicks, [0, 1]);
  assert.equal(simulation.read(redOut, C), 10);
  assert.equal(simulation.read(greenSrc, C), 0);
  assert.equal(simulation.read(greenSrc, B), 2);
  assert.equal(simulation.read(greenOut, D), 2);
  assert.equal(simulation.read(greenOut, E), 10);
  assert.deepEqual(simulation.device(writer).output.green, []);
});

test("SCH-5 самоссылка идёт по границам без рекурсии", async () => {
  async function trace(withConstant) {
    const circuit = new Circuit();
    const loop = circuit.network("red_loop");
    const writer = new Arithmetic({
      red_input: loop,
      red_output: loop,
      left_operand: wire(A),
      right_operand: { constant: 1 },
      operation: SUM,
      return: A,
    });
    const ticks = track(writer);
    if (withConstant) {
      circuit.add(new Constant({ enabled: true, red_output: loop, signals: [count(A, 1)] }));
    }
    circuit.add(writer);
    const simulation = await circuit.createSimulation({ scheduler: "optimized" });
    const values = [simulation.read(loop, A)];
    for (let step = 0; step < 3; step += 1) {
      await simulation.step();
      values.push(simulation.read(loop, A));
    }
    return { ticks, values };
  }
  const plain = await trace(false);
  const summed = await trace(true);
  assert.deepEqual(plain.values, [0, 1, 2, 3]);
  assert.deepEqual(plain.ticks, [0, 1, 2]);
  assert.deepEqual(summed.values, [1, 3, 5, 7]);
  assert.deepEqual(summed.ticks, [0, 1, 2]);
});

test("SCH-6 null не даёт вклад, пустой и закрытый вход читаются как 0", async () => {
  function build() {
    const circuit = new Circuit();
    const source = circuit.network("red_src");
    const empty = circuit.network("red_empty");
    const redOut = circuit.network("red_out");
    const greenOut = circuit.network("green_out");
    circuit.add(new Constant({ enabled: true, red_output: source, signals: [count(A, 9)] }));
    circuit.add(new Arithmetic({
      red_output: redOut,
      left_operand: null,
      right_operand: { constant: 9 },
      operation: SUM,
      return: A,
    }));
    circuit.add(new Arithmetic({
      red_input: source,
      green_output: greenOut,
      left_operand: wire(A, neither),
      right_operand: { constant: 4 },
      operation: SUM,
      return: B,
    }));
    circuit.add(new Arithmetic({
      red_input: empty,
      green_output: greenOut,
      left_operand: wire(A),
      right_operand: { constant: 0 },
      operation: SUM,
      return: C,
    }));
    return { circuit, source, redOut, greenOut };
  }
  const fullBuilt = build();
  const optimizedBuilt = build();
  const full = await fullBuilt.circuit.createSimulation({ scheduler: "full" });
  const optimized = await optimizedBuilt.circuit.createSimulation({ scheduler: "optimized" });
  await settle(full, 2);
  await settle(optimized, 2);
  assert.equal(optimized.read(optimizedBuilt.redOut, A), 0);
  assert.equal(optimized.read(optimizedBuilt.greenOut, B), 4);
  assert.equal(optimized.read(optimizedBuilt.greenOut, C), 0);
  assert.equal(optimized.read(optimizedBuilt.source, A), 9);
  assert.deepEqual(optimized.capture(), full.capture());
});

test("SCH-7 исчезнувший вклад удаляется и будит читателя", async () => {
  class Fade extends EventCombinator {
    main() {
      if (this.nextTick === 1) this.setOutput({ red: true, green: false, signals: [count(A, 4)] });
      if (this.nextTick === 2) this.clearOutput({ red: true, green: false });
    }
  }
  const circuit = new Circuit();
  const source = circuit.network("red_src");
  const out = circuit.network("green_out");
  const reader = new Arithmetic({
    red_input: source,
    green_output: out,
    left_operand: wire(A),
    right_operand: { constant: 0 },
    operation: SUM,
    return: B,
  });
  const ticks = track(reader);
  circuit.add(new Fade({ red_output: source }));
  circuit.add(reader);
  const simulation = await circuit.createSimulation({ scheduler: "optimized" });
  const seen = [];
  for (let step = 0; step < 4; step += 1) {
    await simulation.step();
    seen.push(simulation.read(out, B));
  }
  assert.deepEqual(seen, [0, 4, 0, 0]);
  assert.deepEqual(ticks, [0, 1, 2]);
  assert.deepEqual(simulation.device(reader).output.green, []);
  assert.equal(simulation.read(source, A), 0);
});

test("SCH-8 время, случайный выбор, событие и конец импульса просыпаются без нового входа", async () => {
  const world = { origin: 20, dayLength: 10 };
  function clockCircuit() {
    const circuit = new Circuit({ world });
    const out = circuit.network("red_clock");
    const idle = circuit.network("green_idle");
    const clock = new Selector({
      operation: OP.TIME,
      game_tick: A,
      day_length: B,
      red_output: out,
    });
    const stable = new Arithmetic({
      left_operand: { constant: 2 },
      right_operand: { constant: 3 },
      operation: SUM,
      return: C,
      green_output: idle,
    });
    const clockTicks = track(clock);
    const stableTicks = track(stable);
    circuit.add(clock);
    circuit.add(stable);
    return { circuit, out, idle, clockTicks, stableTicks };
  }
  const clocked = clockCircuit();
  const clockRun = await clocked.circuit.createSimulation({ scheduler: "optimized" });
  await settle(clockRun, 4);
  assert.deepEqual(clocked.clockTicks, [0, 1, 2, 3]);
  assert.deepEqual(clocked.stableTicks, [0]);
  assert.equal(clockRun.read(clocked.out, A), 23);
  assert.equal(clockRun.read(clocked.out, B), 10);
  assert.equal(clockRun.read(clocked.idle, C), 5);

  function randomCircuit() {
    const circuit = new Circuit({ seed: 9 });
    const source = circuit.network("red_src");
    const out = circuit.network("green_roll");
    const roller = new Selector({
      operation: OP.RANDOM,
      interval: 3,
      red_input: source,
      green_output: out,
    });
    const ticks = track(roller);
    circuit.add(new Constant({ enabled: true, red_output: source, signals: [count(A, 4), count(B, 1)] }));
    circuit.add(roller);
    return { circuit, roller, ticks };
  }
  const fullRandom = randomCircuit();
  const optimizedRandom = randomCircuit();
  const fullRoll = await fullRandom.circuit.createSimulation({ scheduler: "full" });
  const optimizedRoll = await optimizedRandom.circuit.createSimulation({ scheduler: "optimized" });
  for (let step = 0; step < 4; step += 1) {
    await fullRoll.step();
    await optimizedRoll.step();
    assert.deepEqual(optimizedRoll.capture(), fullRoll.capture());
  }
  assert.deepEqual(optimizedRandom.ticks, [0, 1, 2, 3]);
  assert.deepEqual(fullRandom.ticks, [0, 1, 2, 3]);
  assert.equal(optimizedRoll.device(optimizedRandom.roller).state.elapsed, fullRoll.device(fullRandom.roller).state.elapsed);

  class Alarm extends EventCombinator {
    init() {
      this.wakeAt(2);
    }

    main() {
      this.state = { n: (this.state.n ?? 0) + 1 };
      this.wakeAt(this.tick + 2);
    }
  }
  function alarmCircuit() {
    const circuit = new Circuit({ seed: 3 });
    const alarm = new Alarm({ run: quiet });
    circuit.add(alarm);
    return { circuit, alarm };
  }
  const fullAlarm = alarmCircuit();
  const optimizedAlarm = alarmCircuit();
  const fullAlarmRun = await fullAlarm.circuit.createSimulation({ scheduler: "full" });
  const optimizedAlarmRun = await optimizedAlarm.circuit.createSimulation({ scheduler: "optimized" });
  for (let step = 0; step < 5; step += 1) {
    await fullAlarmRun.step();
    await optimizedAlarmRun.step();
    assert.deepEqual(optimizedAlarmRun.capture(), fullAlarmRun.capture());
  }
  assert.deepEqual(optimizedAlarmRun.device(optimizedAlarm.alarm).state, { n: 2 });

  class Burst extends EventCombinator {
    init() {
      this.pulse({ red: true, green: false, signals: [count(A, 3)] }, 1);
    }

    main() {
      this.state = { ran: true };
    }
  }
  const burst = new Circuit();
  const source = burst.network("red_src");
  const copied = burst.network("green_copy");
  const lone = burst.network("red_lone");
  const reader = new Arithmetic({
    red_input: source,
    green_output: copied,
    left_operand: wire(A),
    right_operand: { constant: 0 },
    operation: SUM,
    return: B,
  });
  const idle = new Arithmetic({
    left_operand: { constant: 1 },
    right_operand: { constant: 1 },
    operation: SUM,
    return: D,
    red_output: lone,
  });
  const readerTicks = track(reader);
  const idleTicks = track(idle);
  const event = new Burst({ red_output: source, run: quiet });
  burst.add(event);
  burst.add(reader);
  burst.add(idle);
  class Lone extends EventCombinator {
    main() {
      this.setOutput({ red: true, green: false, signals: [count(E, this.nextTick)] });
    }
  }
  burst.add(new Lone({ red_output: burst.network("red_private") }));
  const burstRun = await burst.createSimulation({ scheduler: "optimized" });
  const copiedValues = [];
  for (let step = 0; step < 3; step += 1) {
    await burstRun.step();
    copiedValues.push(burstRun.read(copied, B));
  }
  assert.deepEqual(copiedValues, [3, 0, 0]);
  assert.deepEqual(readerTicks, [0, 1]);
  assert.deepEqual(idleTicks, [0]);
  assert.deepEqual(burstRun.device(event).state, {});
});

test("SCH-9 первая очередь считает два константных операнда и повторяет её после reset", async () => {
  const circuit = new Circuit();
  const out = circuit.network("red_out");
  const writer = new Arithmetic({
    left_operand: { constant: 2 },
    right_operand: { constant: 3 },
    operation: SUM,
    return: A,
    red_output: out,
  });
  const ticks = track(writer);
  circuit.add(writer);
  const simulation = await circuit.createSimulation({ scheduler: "optimized" });
  assert.equal(simulation.read(out, A), 0);
  await simulation.step();
  assert.equal(simulation.read(out, A), 5);
  await simulation.step();
  assert.deepEqual(ticks, [0]);
  assert.equal(simulation.read(out, A), 5);
  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(out, A), 0);
  await simulation.step();
  assert.deepEqual(ticks, [0, 0]);
  assert.equal(simulation.read(out, A), 5);
  const reference = new Circuit();
  const referenceOut = reference.network("red_out");
  reference.add(new Arithmetic({
    left_operand: { constant: 2 },
    right_operand: { constant: 3 },
    operation: SUM,
    return: A,
    red_output: referenceOut,
  }));
  const full = await reference.createSimulation({ scheduler: "full" });
  await full.step();
  await full.step();
  await full.reset();
  await full.step();
  assert.deepEqual(simulation.capture(), full.capture());
});

test("SCH-10 полный и оптимизированный проходы совпадают на каждой границе", async () => {
  class Hold extends EventCombinator {
    main() {
      const message = this.messages[0];
      this.state = { heard: message ? message.type : null, seen: this.tick };
      if (this.tick === 0) this.setOutput({ red: true, green: false, signals: [count(K, 5)] });
    }
  }
  class Ping extends EventCombinator {
    init() {
      this.wakeAt(1);
    }

    main() {
      this.state = { n: (this.state.n ?? 0) + 1 };
      this.random();
      if (this.tick === 1) {
        this.send(this.peers.receiver, { type: "go", data: { ok: true } });
        this.pulse({ red: true, green: false, signals: [count(L, 2)] }, 1);
        this.wakeAt(4);
      }
    }
  }
  function build() {
    const circuit = new Circuit({ seed: 11, world: { origin: 20, dayLength: 10 } });
    const source = circuit.network("red_src");
    const middle = circuit.network("green_mid");
    const loop = circuit.network("red_loop");
    const flag = circuit.network("red_flag");
    const counted = circuit.network("green_count");
    const clock = circuit.network("red_clock");
    const clockCopy = circuit.network("green_clock");
    const rolled = circuit.network("green_roll");
    const events = circuit.network("red_event");
    circuit.add(new Constant({ enabled: true, red_output: source, signals: [count(A, 3)] }));
    circuit.add(new Constant({ enabled: true, red_output: loop, signals: [count(B, 1)] }));
    circuit.add(new Arithmetic({
      red_input: source,
      green_output: middle,
      left_operand: wire(A),
      right_operand: { constant: 1 },
      operation: SUM,
      return: C,
    }));
    circuit.add(new Arithmetic({
      red_input: loop,
      red_output: loop,
      left_operand: wire(B),
      right_operand: { constant: 1 },
      operation: SUM,
      return: B,
    }));
    circuit.add(new Decider({
      green_input: middle,
      red_output: flag,
      conditions: [{
        left_operand: wire(C, green),
        right_operand: { constant: 0 },
        operation: GT,
      }],
      when_true: [count(D, 1)],
    }));
    circuit.add(new Selector({
      operation: OP.COUNT,
      signal: E,
      red_input: flag,
      green_output: counted,
    }));
    circuit.add(new Selector({
      operation: OP.TIME,
      game_tick: F,
      day_length: G,
      red_output: clock,
    }));
    circuit.add(new Arithmetic({
      red_input: clock,
      green_output: clockCopy,
      left_operand: wire(F),
      right_operand: { constant: 0 },
      operation: SUM,
      return: T,
    }));
    circuit.add(new Selector({
      operation: OP.RANDOM,
      interval: 2,
      red_input: source,
      green_output: rolled,
    }));
    const hold = new Hold({ red_input: events, red_output: events, run: onInput });
    const ping = new Ping({ red_output: events, run: quiet });
    circuit.add(hold);
    circuit.add(ping);
    circuit.setPeers(ping, { receiver: hold });
    return circuit;
  }
  const full = await build().createSimulation({ scheduler: "full", historyLimit: 8 });
  const optimized = await build().createSimulation({ scheduler: "optimized", historyLimit: 8 });
  assert.deepEqual(optimized.capture(), full.capture());
  for (let step = 0; step < 6; step += 1) {
    await full.step();
    await optimized.step();
    assert.equal(optimized.tick, full.tick);
    assert.deepEqual(optimized.capture(), full.capture());
  }
  await full.recall(3);
  await optimized.recall(3);
  await full.step();
  await optimized.step();
  assert.deepEqual(optimized.capture(), full.capture());
  await full.back();
  await optimized.back();
  await full.step();
  await optimized.step();
  assert.deepEqual(optimized.capture(), full.capture());
  await full.reset();
  await optimized.reset();
  assert.deepEqual(optimized.capture(), full.capture());
  await full.step();
  await optimized.step();
  assert.deepEqual(optimized.capture(), full.capture());
});

test("SCH-11 мутации задержки, вклада и сравнения сетей видны на границах", async () => {
  const circuit = new Circuit();
  const loop = circuit.network("red_loop");
  const keptRed = circuit.network("red_kept");
  const keptGreen = circuit.network("green_kept");
  const swapped = circuit.network("red_swap");
  const copied = circuit.network("green_copy");
  const delay = new Arithmetic({
    red_input: loop,
    red_output: loop,
    left_operand: wire(A),
    right_operand: { constant: 1 },
    operation: SUM,
    return: A,
  });
  const keeper = new Arithmetic({
    left_operand: { constant: 6 },
    right_operand: { constant: 1 },
    operation: SUM,
    return: B,
    red_output: keptRed,
    green_output: keptGreen,
  });
  const mirror = new Arithmetic({
    red_input: swapped,
    green_output: copied,
    left_operand: { ...red, signal: EACH },
    right_operand: { constant: 1 },
    operation: SUM,
    return: EACH,
  });
  const delayTicks = track(delay);
  const keeperTicks = track(keeper);
  const mirrorTicks = track(mirror);
  class Swap extends EventCombinator {
    main() {
      if (this.nextTick === 1) this.setOutput({ red: true, green: false, signals: [count(A, 1)] });
      else if (this.nextTick === 2) this.setOutput({ red: true, green: false, signals: [count(A, 2)] });
      else this.setOutput({ red: true, green: false, signals: [count(C, 1)] });
    }
  }
  circuit.add(delay);
  circuit.add(keeper);
  circuit.add(new Swap({ red_output: swapped }));
  circuit.add(mirror);
  const simulation = await circuit.createSimulation({ scheduler: "optimized" });
  assert.equal(simulation.read(loop, A), 0);
  await simulation.step();
  assert.equal(simulation.read(loop, A), 1);
  assert.equal(simulation.read(keptRed, B), 7);
  assert.equal(simulation.read(keptGreen, B), 7);
  await simulation.step();
  assert.equal(simulation.read(loop, A), 2);
  assert.equal(simulation.read(keptRed, B), 7);
  assert.equal(simulation.read(copied, A), 2);
  await simulation.step();
  assert.equal(simulation.read(loop, A), 3);
  assert.equal(simulation.read(copied, A), 3);
  await simulation.step();
  assert.equal(simulation.read(copied, A), 0);
  assert.equal(simulation.read(copied, C), 2);
  assert.deepEqual(delayTicks, [0, 1, 2, 3]);
  assert.deepEqual(keeperTicks, [0]);
  assert.deepEqual(mirrorTicks, [0, 1, 2, 3]);
});

test("ошибка оптимизированного шага не публикует границу и оставляет устройство в очереди", async () => {
  const circuit = new Circuit();
  const redOut = circuit.network("red_out");
  const greenOut = circuit.network("green_out");
  const stable = new Arithmetic({
    left_operand: { constant: 2 },
    right_operand: { constant: 3 },
    operation: SUM,
    return: A,
    red_output: redOut,
  });
  let boom = true;
  const fragile = new Arithmetic({
    left_operand: { constant: 4 },
    right_operand: { constant: 3 },
    operation: SUM,
    return: B,
    green_output: greenOut,
  });
  const stableTicks = track(stable);
  const original = fragile.compute;
  fragile.compute = (view) => {
    if (boom) throw new Error("boom");
    return original(view);
  };
  circuit.add(stable);
  circuit.add(fragile);
  const simulation = await circuit.createSimulation({ scheduler: "optimized" });
  await assert.rejects(simulation.step(), (error) => error.message === "boom");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(redOut, A), 0);
  assert.equal(simulation.read(greenOut, B), 0);
  assert.deepEqual(stableTicks, [0]);
  boom = false;
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.read(redOut, A), 5);
  assert.equal(simulation.read(greenOut, B), 7);
  assert.deepEqual(stableTicks, [0, 0]);
});
