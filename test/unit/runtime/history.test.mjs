/** Ограниченная история: снимок не следует за будущим, откат и повтор совпадают. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Arithmetic,
  Circuit,
  Constant,
  DEFAULT_HISTORY_LIMIT,
  EventCombinator,
  RuntimeError,
  Selector,
  Signal,
} from "../../../src/index.js";
import { rejectsCode } from "../signals/support.mjs";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const quiet = { every_tick: false, input_changed: false };

function echo(request, devices = []) {
  return {
    runId: request.runId,
    revision: request.revision,
    stepId: request.stepId,
    phase: request.phase,
    tick: request.tick,
    devices,
  };
}

async function rejectsRuntime(promise, code) {
  await assert.rejects(promise, (error) => error instanceof RuntimeError && error.code === code);
}

function counter() {
  const circuit = new Circuit({ seed: 1 });
  const green = circuit.network("green_count");
  circuit.add(new Arithmetic({
    green_input: green,
    green_output: green,
    left_operand: { red: false, green: true, signal: A },
    right_operand: { constant: 1 },
    operation: Arithmetic.Operation.SUM,
    return: A,
  }));
  return { circuit, green };
}

async function stepped(limit, count) {
  const built = counter();
  const simulation = await built.circuit.createSimulation(limit === undefined ? undefined : { historyLimit: limit });
  for (let index = 0; index < count; index += 1) await simulation.step();
  return { ...built, simulation };
}

test("HIST-1 откат и повтор совпадают, включая RNG и кэш выхода", async () => {
  const first = await stepped(undefined, 4);
  const saved = first.simulation.capture();
  assert.equal(first.simulation.historyLimit, DEFAULT_HISTORY_LIMIT);
  assert.deepEqual(first.simulation.historyTicks(), [0, 1, 2, 3, 4]);
  await first.simulation.step();
  const continued = first.simulation.capture();
  await first.simulation.back();
  assert.equal(first.simulation.tick, 4);
  assert.deepEqual(first.simulation.capture(), saved);
  await first.simulation.step();
  assert.deepEqual(first.simulation.capture(), continued);
  assert.equal(first.simulation.read(first.green, A), 5);

  const circuit = new Circuit({ seed: 3 });
  const net = circuit.network("red_net");
  const out = circuit.network("red_out");
  circuit.add(new Constant({ enabled: true, red_output: net, signals: [{ signal: A, constant: 1 }] }));
  circuit.add(new Arithmetic({
    red_input: net,
    red_output: net,
    left_operand: { red: true, green: true, signal: A },
    right_operand: { constant: 0 },
    operation: Arithmetic.Operation.SUM,
    return: A,
  }));
  const selector = new Selector({
    operation: Selector.Operation.RANDOM,
    interval: 1,
    red_input: net,
    red_output: out,
  });
  circuit.add(selector);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  await simulation.step();
  const rng = simulation.device(selector).state.rng;
  const output = simulation.device(selector).output;
  const boundary = simulation.capture();
  await simulation.step();
  const later = simulation.capture();
  await simulation.back();
  assert.equal(simulation.device(selector).state.rng, rng);
  assert.deepEqual(simulation.device(selector).output, output);
  assert.deepEqual(simulation.capture(), boundary);
  await simulation.step();
  assert.deepEqual(simulation.capture(), later);
});

test("HIST-2 сообщения и пробуждения восстанавливаются без повторного исполнения", async () => {
  async function build() {
    const log = [];
    class Ping extends EventCombinator {
      init() {
        this.wakeAt(1);
      }

      main() {
        log.push(`ping:${this.tick}`);
        if (this.tick === 1) {
          this.send(this.peers.receiver, { type: "ping", data: { n: 1 } });
          this.wakeAt(3);
        }
      }
    }
    class Pong extends EventCombinator {
      main() {
        log.push(`pong:${this.tick}:${this.messages.map((message) => message.type).join(",")}`);
      }
    }
    class Watch extends EventCombinator {
      main() {
        log.push(`watch:${this.tick}`);
        this.state.seen = this.tick;
      }
    }
    const circuit = new Circuit({ seed: 4 });
    const red = circuit.network("red_bus");
    circuit.add(new Constant({ enabled: true, red_output: red, signals: [{ signal: B, constant: 2 }] }));
    const ping = new Ping({ run: quiet });
    const pong = new Pong({ run: quiet });
    const watch = new Watch({ red_input: red, run: { every_tick: false, input_changed: true } });
    circuit.add(ping);
    circuit.add(pong);
    circuit.add(watch);
    circuit.setPeers(ping, { receiver: pong });
    const simulation = await circuit.createSimulation({ historyLimit: 8 });
    return { simulation, ping, pong, watch, log };
  }

  const left = await build();
  const right = await build();
  assert.equal(left.simulation.historyLimit, 8);
  await left.simulation.step();
  await left.simulation.step();
  const saved = left.simulation.capture();
  assert.ok(left.simulation.device(left.pong).messages.some((message) => message.type === "ping"));
  assert.ok(left.simulation.device(left.ping).wakes.includes(3));
  assert.equal(typeof left.simulation.device(left.watch).seenInputs, "string");
  await left.simulation.step();
  const logged = left.log.length;
  await left.simulation.restore(saved);
  assert.equal(left.log.length, logged);
  assert.equal(left.simulation.tick, saved.tick);
  assert.deepEqual(left.simulation.device(left.pong).messages, saved.devices.find((item) => item.messages.some((message) => message.type === "ping")).messages);
  assert.deepEqual(left.simulation.device(left.ping).wakes, saved.devices.find((item) => item.wakes.includes(3)).wakes);
  await left.simulation.step();
  await right.simulation.step();
  await right.simulation.step();
  await right.simulation.step();
  assert.deepEqual(left.simulation.capture(), right.simulation.capture());
});

test("HIST-3 снимок не меняется от последующих шагов и правки возвращённого объекта", async () => {
  const { simulation } = await stepped(8, 2);
  const frozen = JSON.parse(JSON.stringify(simulation.capture()));
  const leaked = simulation.capture();
  leaked.tick = 90;
  leaked.networks[0].signals.push({ signal: { type: "virtual", name: "signal-Z", quality: "normal" }, constant: 5 });
  const viewed = simulation.historySnapshot(2);
  viewed.devices[0].output.green.push({ signal: A, constant: 99 });
  await simulation.step();
  await simulation.recall(2);
  assert.deepEqual(simulation.capture(), frozen);
  assert.equal(simulation.historySnapshot(2).tick, 2);
  assert.equal(simulation.historySnapshot(2).devices[0].output.green.some((entry) => entry.constant === 99), false);
});

test("HIST-4 новая ветка не использует отброшенное будущее", async () => {
  let visits = 0;
  class Marker extends EventCombinator {
    main() {
      if (this.tick === 1) {
        visits += 1;
        this.state.visit = visits;
      }
    }
  }
  const circuit = new Circuit();
  const marker = new Marker({});
  circuit.add(marker);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  await simulation.step();
  await simulation.step();
  assert.equal(simulation.tick, 3);
  assert.equal(simulation.device(marker).state.visit, 1);
  await simulation.recall(1);
  assert.deepEqual(simulation.historyTicks(), [0, 1]);
  assert.equal(simulation.historySnapshot(3), null);
  assert.deepEqual(simulation.device(marker).state, {});
  await simulation.step();
  assert.equal(visits, 2);
  assert.deepEqual(simulation.historyTicks(), [0, 1, 2]);
  assert.equal(simulation.device(marker).state.visit, 2);
  assert.equal(simulation.historySnapshot(3), null);
});

test("HIST-5 несериализуемое состояние, чужой снимок и исчерпанный предел атомарны", async () => {
  const { simulation } = await stepped(1, 2);
  assert.deepEqual(simulation.historyTicks(), [2]);
  const before = simulation.capture();
  await rejectsRuntime(simulation.back(), "history-exhausted");
  await rejectsRuntime(simulation.recall(0), "history-missing");
  await rejectsRuntime(simulation.recall(1.5), "history-missing");
  await rejectsRuntime(simulation.recall(-1), "history-missing");
  await rejectsRuntime(simulation.recall("1"), "history-missing");
  assert.deepEqual(simulation.capture(), before);

  class Holder extends EventCombinator {
    main() {
      this.state.n = 1;
    }
  }
  const heldCircuit = new Circuit();
  heldCircuit.add(new Holder({}));
  const heldRun = await heldCircuit.createSimulation({ historyLimit: 4 });
  await heldRun.step();
  const intact = heldRun.capture();
  const intactTicks = heldRun.historyTicks();
  const cycle = {};
  cycle.self = cycle;
  const cyclic = heldRun.capture();
  cyclic.devices[0].state = cycle;
  await rejectsRuntime(heldRun.restore(cyclic), "invalid-state");
  const nested = heldRun.capture();
  nested.devices[0].messages = [{
    from: nested.devices[0].id,
    to: nested.devices[0].id,
    sentTick: 0,
    deliveryTick: 1,
    sequence: 0,
    type: "loop",
    data: cycle,
  }];
  await rejectsRuntime(heldRun.restore(nested), "invalid-state");
  const broken = heldRun.capture();
  delete broken.profile;
  await rejectsRuntime(heldRun.restore(broken), "invalid-snapshot");
  assert.deepEqual(heldRun.capture(), intact);
  assert.deepEqual(heldRun.historyTicks(), intactTicks);

  await rejectsCode(counter().circuit.createSimulation({ historyLimit: 0 }), "invalid-simulation-options");
  await rejectsCode(counter().circuit.createSimulation({ historyLimit: 1.5 }), "invalid-simulation-options");
  await rejectsCode(counter().circuit.createSimulation({ historyLimit: "8" }), "invalid-simulation-options");

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const busyCircuit = new Circuit();
  const red = busyCircuit.network("red_1");
  const event = { participate: true, red_output: red, state: { n: 1 } };
  busyCircuit.add(event);
  const busy = await busyCircuit.createSimulation({
    historyLimit: 4,
    executor: {
      prepare(request) {
        if (request.phase === "init") return echo(request, [{ id: busyCircuit.deviceId(event), state: { n: 1 } }]);
        return gate.then(() => echo(request, [{ id: busyCircuit.deviceId(event), state: { n: 2 } }]));
      },
    },
  });
  const running = busy.step();
  await rejectsRuntime(busy.back(), "step-busy");
  await rejectsRuntime(busy.recall(0), "step-busy");
  await rejectsRuntime(busy.restore(busy.capture()), "step-busy");
  assert.equal(busy.tick, 0);
  assert.deepEqual(busy.historyTicks(), [0]);
  release();
  await running;
  assert.equal(busy.tick, 1);
});

test("HIST-6 очередь читается из снимка, reset оставляет только границу 0", async () => {
  const log = [];
  class Ping extends EventCombinator {
    init() {
      log.push("init");
      this.wakeAt(1);
    }

    main() {
      log.push(`main:${this.tick}`);
      if (this.tick === 1) this.send(this.peers.receiver, { type: "ping", data: { n: 4 } });
    }
  }
  class Pong extends EventCombinator {
    main() {
      log.push(`pong:${this.tick}`);
    }
  }
  const circuit = new Circuit({ seed: 9 });
  const ping = new Ping({ run: quiet });
  const pong = new Pong({ run: quiet });
  circuit.add(ping);
  circuit.add(pong);
  circuit.setPeers(ping, { receiver: pong });
  const simulation = await circuit.createSimulation({ historyLimit: 6 });
  await simulation.step();
  await simulation.step();
  assert.equal(simulation.device(pong).messages.length, 1);
  const queued = simulation.historySnapshot(simulation.tick);
  await simulation.step();
  const logged = log.length;
  await simulation.recall(queued.tick);
  assert.equal(log.length, logged);
  assert.deepEqual(simulation.device(pong).messages, queued.devices.find((item) => item.messages.length > 0).messages);
  await simulation.reset();
  assert.deepEqual(simulation.historyTicks(), [0]);
  assert.equal(simulation.tick, 0);
  assert.deepEqual(simulation.device(pong).messages, []);
  await rejectsRuntime(simulation.recall(queued.tick), "history-missing");
  assert.equal(log.filter((item) => item === "init").length, 2);
  assert.equal(log.filter((item) => item.startsWith("main:")).length, 1);

  const plain = await stepped(4, 3);
  await plain.simulation.reset();
  assert.deepEqual(plain.simulation.historyTicks(), [0]);
  assert.equal(plain.simulation.tick, 0);
  assert.equal(plain.simulation.read(plain.green, A), 0);
  await plain.simulation.step();
  assert.deepEqual(plain.simulation.historyTicks(), [0, 1]);

  let inits = 0;
  const failing = new Circuit();
  const block = { participate: true, state: { n: 1 } };
  failing.add(block);
  const id = failing.deviceId(block);
  const held = await failing.createSimulation({
    historyLimit: 5,
    executor: {
      replayInit: true,
      prepare(request) {
        if (request.phase === "init") {
          inits += 1;
          if (inits > 1) throw new Error("init-broke");
          return echo(request, [{ id, state: { n: 1 } }]);
        }
        return echo(request, [{ id, state: { n: request.tick + 2 } }]);
      },
    },
  });
  await held.step();
  await assert.rejects(held.reset(), (error) => error.message === "init-broke");
  assert.equal(held.tick, 1);
  assert.deepEqual(held.historyTicks(), [0, 1]);
  await held.step();
  assert.deepEqual(held.historyTicks(), [0, 1, 2]);
  await held.recall(held.tick);
  assert.deepEqual(held.historyTicks(), [0, 1, 2]);

  const displaced = counter();
  const displacedRun = await displaced.circuit.createSimulation({ historyLimit: 2 });
  const root = displacedRun.capture();
  await displacedRun.step();
  await displacedRun.step();
  await displacedRun.step();
  assert.equal(displacedRun.historySnapshot(0), null);
  await displacedRun.restore(root);
  assert.deepEqual(displacedRun.historyTicks(), [0]);
  assert.equal(displacedRun.read(displaced.green, A), 0);
});
