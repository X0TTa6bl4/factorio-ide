import assert from "node:assert/strict";
import test from "node:test";
import { Arithmetic, Circuit, Constant, EventCombinator, Signal } from "../../../src/index.js";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const SUM = Arithmetic.Operation.SUM;

function count(signal, constant) {
  return { signal, constant };
}

function output(red, green, signals) {
  return { red, green, signals };
}

async function trace(simulation, red, green, steps) {
  const points = [[simulation.read(red, A), simulation.read(green, B)]];
  for (let index = 0; index < steps; index += 1) {
    await simulation.step();
    points.push([simulation.read(red, A), simulation.read(green, B)]);
  }
  return points;
}

test("FIRST-1 CONST-1 на t0 виден A, на t1 B, reset и выключенный источник держат границу", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const source = new Constant({
    enabled: true,
    red_output: red,
    signals: [count(A, 3)],
  });
  const arithmetic = new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 2 },
    operation: SUM,
    return: B,
  });
  circuit.add(arithmetic);
  circuit.add(source);
  const simulation = await circuit.createSimulation();
  assert.deepEqual(await trace(simulation, red, green, 1), [[3, 0], [3, 5]]);
  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.deepEqual([simulation.read(red, A), simulation.read(green, B)], [3, 0]);

  const off = new Circuit();
  const wire = off.network("red_1");
  const disabled = new Constant({ enabled: false, red_output: wire, signals: [count(A, 5)] });
  off.add(disabled);
  const first = await off.createSimulation();
  assert.equal(first.read(wire, A), 0);
  disabled.enabled = true;
  const second = await off.createSimulation();
  assert.equal(first.read(wire, A), 0);
  assert.equal(second.read(wire, A), 5);
  for (let index = 0; index < 10; index += 1) await second.step();
  assert.equal(second.tick, 10);
  assert.equal(second.read(wire, A), 5);
  assert.equal(first.tick, 0);
});

test("CONST-2 дубли взаимно гасятся, оба выхода несут один вклад", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const source = new Constant({
    enabled: true,
    red_output: red,
    green_output: green,
    signals: [count(A, 3), count(A, -3), count(B, -2)],
  });
  circuit.add(source);
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 0);
  assert.equal(simulation.read(green, A), 0);
  assert.equal(simulation.read(red, B), -2);
  assert.equal(simulation.read(green, B), -2);
  assert.deepEqual(simulation.present(red).map((entry) => entry.signal.name), ["signal-B"]);
  assert.deepEqual(
    simulation.device(source).output.red.map((entry) => entry.constant),
    simulation.device(source).output.green.map((entry) => entry.constant),
  );
});

test("FIRST-2 FIRST-4 вклад B исчезает, null и отключённый выход ничего не передают", async () => {
  let emit = true;
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const spare = circuit.network("red_spare");
  circuit.add({
    red_output: red,
    compute() {
      return { signals: emit ? [count(A, 4)] : [] };
    },
  });
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 0 },
    operation: SUM,
    return: B,
  }));
  const silent = new Arithmetic({
    left_operand: { constant: 2 },
    right_operand: { constant: 3 },
    operation: SUM,
    return: B,
  });
  circuit.add(silent);
  circuit.add(new Constant({ enabled: true, red_output: spare, signals: [count(A, 1)] }));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  await simulation.step();
  assert.equal(simulation.read(green, B), 4);
  emit = false;
  await simulation.step();
  assert.equal(simulation.read(red, A), 0);
  assert.equal(simulation.read(green, B), 4);
  await simulation.step();
  assert.equal(simulation.read(green, B), 0);
  assert.equal(simulation.present(green).some((entry) => entry.signal === B), false);
  assert.equal(simulation.read(spare, B), 0);
  assert.equal(simulation.device(silent).output.red.length, 0);

  const blank = new Circuit();
  const out = blank.network("green_1");
  blank.add(new Arithmetic({
    green_output: out,
    left_operand: null,
    right_operand: { constant: 5 },
    operation: SUM,
    return: B,
  }));
  const quiet = await blank.createSimulation();
  await quiet.step();
  assert.equal(quiet.read(out, B), 0);
});

test("FIRST-3 отключённые входы и A+5 дают B на следующей границе", async () => {
  const circuit = new Circuit();
  const green = circuit.network("green_1");
  circuit.add(new Arithmetic({
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 5 },
    operation: SUM,
    return: B,
  }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(green, B), 0);
  await simulation.step();
  assert.equal(simulation.read(green, B), 5);
});

test("импульс события меняет вход арифметического на границе, сумма появляется ещё через тик", async () => {
  class Pulse extends EventCombinator {
    main() {
      if (this.tick === 0) this.pulse(output(true, false, [count(A, 3)]), 1);
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  circuit.add(new Pulse({ red_output: red }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 2 },
    operation: SUM,
    return: B,
  }));
  const simulation = await circuit.createSimulation();
  assert.deepEqual(await trace(simulation, red, green, 3), [
    [0, 0],
    [3, 2],
    [0, 5],
    [0, 2],
  ]);
});

test("FIRST-2 событие и Constant складываются на t0 независимо от порядка", async () => {
  class Seed extends EventCombinator {
    init() {
      this.setOutput(output(true, false, [count(A, 2)]));
    }
  }
  async function read(firstEvent) {
    const circuit = new Circuit();
    const red = circuit.network("red_1");
    const source = new Constant({ enabled: true, red_output: red, signals: [count(A, 3)] });
    const event = new Seed({ red_output: red, run: { every_tick: false, input_changed: false } });
    for (const device of firstEvent ? [event, source] : [source, event]) circuit.add(device);
    const simulation = await circuit.createSimulation();
    return simulation.read(red, A);
  }
  assert.equal(await read(false), 5);
  assert.equal(await read(true), 5);
});

test("сообщение видно на следующей границе, перестановка устройств сохраняет трассу", async () => {
  class Sender extends EventCombinator {
    main() {
      if (this.tick === 0) this.send(this.peers.receiver, { type: "go", data: { n: 1 } });
    }
  }
  class Receiver extends EventCombinator {
    main() {
      if (this.messages.length === 0) return;
      this.setOutput(output(true, false, [count(A, 3)]));
    }
  }
  async function run(order) {
    const circuit = new Circuit();
    const red = circuit.network("red_1");
    const green = circuit.network("green_1");
    const sender = new Sender({});
    const receiver = new Receiver({ red_output: red });
    const arithmetic = new Arithmetic({
      red_input: red,
      green_output: green,
      left_operand: { red: true, green: false, signal: A },
      right_operand: { constant: 2 },
      operation: SUM,
      return: B,
    });
    const devices = { sender, receiver, arithmetic };
    for (const name of order) circuit.add(devices[name]);
    circuit.setPeers(sender, { receiver });
    const simulation = await circuit.createSimulation();
    const points = [];
    for (let index = 0; index < 4; index += 1) {
      const inbox = simulation.device(receiver).messages;
      points.push([
        simulation.tick,
        simulation.read(red, A),
        simulation.read(green, B),
        inbox.length,
        inbox[0] ? inbox[0].deliveryTick : null,
      ]);
      await simulation.step();
    }
    return points;
  }
  const forward = await run(["sender", "receiver", "arithmetic"]);
  const reverse = await run(["arithmetic", "receiver", "sender"]);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward, [
    [0, 0, 0, 0, null],
    [1, 0, 2, 1, 1],
    [2, 3, 2, 0, null],
    [3, 3, 5, 0, null],
  ]);
});

test("ошибка сценария не публикует частичный шаг арифметического", async () => {
  class Boom extends EventCombinator {
    main() {
      throw new Error("разрыв");
    }
  }
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: [count(A, 3)] }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 2 },
    operation: SUM,
    return: B,
  }));
  circuit.add(new Boom({ red_input: red }));
  const simulation = await circuit.createSimulation();
  await assert.rejects(simulation.step(), (error) => {
    assert.equal(error.code, "script-error");
    return true;
  });
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(green, B), 0);
});
