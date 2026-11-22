import assert from "node:assert/strict";
import test from "node:test";
import { buildPrepared, checkConfiguration } from "../../../src/config-check.js";
import {
  advanceTrains,
  initialTrainState,
  readStationState,
  readTrainState,
} from "../../../src/train.js";
import {
  Circuit,
  Constant,
  EventCombinator,
  INT32_MAX,
  Lamp,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  Quality,
  Signal,
  Station,
  Train,
  openProfile,
  readProject,
} from "../../../src/index.js";
import { rejectsCode, throwsCode } from "../signals/support.mjs";

const D = Signal.Signals.signal_D;
const T = Signal.Signals.signal_T;
const A = Signal.Signals.signal_A;
const EACH = Signal.Meta.signal_each;

function names(simulation, network) {
  return simulation.present(network).map((entry) => (
    `${entry.signal.type}/${entry.signal.name}/${entry.signal.quality}=${entry.constant}`
  ));
}

function hold(port, signalToken, constant) {
  return new Constant({
    enabled: true,
    red_output: port?.color === "red" ? port : null,
    green_output: port?.color === "green" ? port : null,
    signals: [{ signal: signalToken, constant }],
  });
}

function atState(route, index, transit) {
  return initialTrainState(route, index, transit);
}

function transitState(route, index, fromIndex, remaining, transit) {
  return {
    phase: "transit",
    index,
    remaining,
    fromIndex,
    stationId: route[index],
    fromId: route[fromIndex],
    route: route.slice(),
    transit,
  };
}

async function rejectsRuntime(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "RuntimeError");
    assert.equal(error.code, code);
    return true;
  });
}

function runtimeCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.name, "RuntimeError");
    assert.equal(error.code, code);
    return true;
  });
}

test("конструкторы станции и поезда отклоняют чужую форму", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_bus");
  const green = circuit.network("green_bus");
  const stop = new Station({ depart: D });
  const cases = [
    [() => new Station(null), "invalid-station-config"],
    [() => new Station([]), "invalid-station-config"],
    [() => new Station({ depart: D, cargo: 1 }), "invalid-station-config"],
    [() => new Station({ depart: D, read_from_train: true }), "unsupported-case"],
    [() => new Station({}), "invalid-depart"],
    [() => new Station({ depart: EACH }), "meta-signal"],
    [() => new Station({ depart: Quality.RARE }), "invalid-signal"],
    [() => new Station({ depart: "signal-D" }), "invalid-signal"],
    [() => new Station({ depart: D, red_input: "red_bus" }), "invalid-port"],
    [() => new Station({ depart: D, red_input: D }), "invalid-port"],
    [() => new Station({ depart: D, green_output: Lamp.Operation.GT }), "invalid-port"],
    [() => new Station({ depart: D, red_output: 1 }), "invalid-port"],
    [() => new Train(null), "invalid-train-config"],
    [() => new Train({ route: [stop], transit: 1, at: 0, cargo: true }), "invalid-train-config"],
    [() => new Train({ route: [stop], transit: 1, at: 0, red_input: null }), "forbidden-port"],
    [() => new Train({ transit: 1, at: 0 }), "invalid-route"],
    [() => new Train({ route: [], transit: 1, at: 0 }), "invalid-route"],
    [() => new Train({ route: [stop, null], transit: 1, at: 0 }), "unknown-station"],
    [() => new Train({ route: [new Lamp({ use_colors: false, condition: {
      left_operand: { red: true, green: true, signal: A },
      operation: Lamp.Operation.GT,
      right_operand: { constant: 0 },
    } })], transit: 1, at: 0 }), "unknown-station"],
    [() => new Train({ route: [stop], transit: 0, at: 0 }), "invalid-transit"],
    [() => new Train({ route: [stop], transit: 1.5, at: 0 }), "invalid-transit"],
    [() => new Train({ route: [stop], transit: "1", at: 0 }), "invalid-transit"],
    [() => new Train({ route: [stop], at: 0 }), "invalid-transit"],
    [() => new Train({ route: [stop], transit: 1, at: 1 }), "invalid-index"],
    [() => new Train({ route: [stop], transit: 1, at: true }), "invalid-index"],
    [() => new Train({ route: [stop], transit: 1 }), "invalid-index"],
  ];
  for (const [fn, code] of cases) throwsCode(fn, code);
  const explicit = new Station({
    depart: D,
    red_input: null,
    green_input: green,
    red_output: red,
    green_output: null,
  });
  assert.equal(explicit.red_input, null);
  assert.equal(explicit.depart, D);
  const foreign = new Circuit().network("red_foreign");
  throwsCode(() => circuit.add(new Station({ depart: D, red_input: foreign })), "foreign-network");
  throwsCode(() => circuit.add(new Station({ depart: D, green_input: red })), "wrong-color");
  const plate = openProfile("space-age").tree.Intermediate.iron_plate;
  throwsCode(() => circuit.add(new Station({ depart: plate })), "wrong-profile");
  const lone = new Station({ depart: D });
  const home = new Circuit();
  home.add(new Train({ route: [lone], transit: 1, at: 0 }));
  await rejectsCode(home.createSimulation(), "missing-station");
});

test("чтение состояний и переходы покрывают отказы модели", () => {
  const route = ["d1", "d2"];
  const description = { route, transit: 2 };
  assert.deepEqual(readStationState({ present: false, trainId: null }, "invalid-state"), {
    present: false,
    trainId: null,
  });
  assert.equal(readStationState({ present: true, trainId: "d3" }, "invalid-state").trainId, "d3");
  const stationCases = [
    null,
    [],
    { present: false },
    { present: "no", trainId: null },
    { present: true, trainId: null },
    { present: true, trainId: "train" },
    { present: true, trainId: "d0" },
    { present: false, trainId: "d1" },
  ];
  for (const value of stationCases) runtimeCode(() => readStationState(value, "invalid-state"), "invalid-state");
  const parked = atState(route, 0, 2);
  assert.equal(readTrainState(parked, description, "invalid-state").phase, "at");
  assert.equal(readTrainState(transitState(route, 1, 0, 2, 2), description, "invalid-state").remaining, 2);
  assert.equal(readTrainState(transitState(route, 1, 0, 1, 2), description, "invalid-state").phase, "transit");
  const trainCases = [
    null,
    { ...parked, extra: true },
    { ...parked, route: ["d2", "d1"] },
    { ...parked, transit: 1 },
    { ...parked, index: 2 },
    { ...parked, index: 1.5 },
    { ...parked, stationId: "d2" },
    { ...parked, remaining: 1 },
    { ...parked, fromIndex: 0 },
    { ...parked, phase: "gone" },
    transitState(route, 1, 0, 0, 2),
    transitState(route, 1, 0, 3, 2),
    transitState(route, 1, 0, 1.5, 2),
    transitState(route, 1, 9, 1, 2),
    { ...transitState(route, 1, 0, 1, 2), fromId: "d9" },
  ];
  for (const value of trainCases) runtimeCode(() => readTrainState(value, description, "invalid-snapshot"), "invalid-snapshot");

  const stations = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];
  runtimeCode(() => advanceTrains({
    phase: "init",
    departCounts: new Map(),
    stations,
    trains: [
      { id: "d8", state: atState(["d1"], 0, 1) },
      { id: "d2", state: atState(["d1"], 0, 1) },
    ],
  }), "station-conflict");
  runtimeCode(() => advanceTrains({
    phase: "init",
    departCounts: new Map(),
    stations: [],
    trains: [{ id: "d4", state: atState(["d1"], 0, 1) }],
  }), "missing-station");
  runtimeCode(() => advanceTrains({
    phase: "step",
    departCounts: new Map([["d1", 1]]),
    stations: [{ id: "d1" }],
    trains: [{ id: "d4", state: atState(["d1", "d9"], 0, 1) }],
  }), "missing-station");
  runtimeCode(() => advanceTrains({
    phase: "step",
    departCounts: new Map(),
    stations,
    trains: [{ id: "d4", state: { ...atState(["d9"], 0, 1), route: ["d9"] } }],
  }), "missing-station");
  runtimeCode(() => advanceTrains({
    phase: "step",
    departCounts: new Map(),
    stations,
    trains: [{ id: "d4", state: { phase: "at", index: 0, remaining: 0, fromIndex: null, stationId: "d1", fromId: null, route: [], transit: 1 } }],
  }), "invalid-state");
  runtimeCode(() => advanceTrains({
    phase: "step",
    departCounts: new Map(),
    stations,
    trains: [{ id: "d4", state: { ...atState(route, 0, 1), phase: "gone" } }],
  }), "invalid-state");
  runtimeCode(() => advanceTrains({
    phase: "step",
    departCounts: new Map(),
    stations,
    trains: [{ id: "d4", state: transitState(route, 1, 0, 0, 2) }],
  }), "invalid-state");
  runtimeCode(() => advanceTrains({
    phase: "step",
    departCounts: new Map(),
    stations,
    trains: [{ id: "d4", state: transitState(route, 1, 0, 1.5, 2) }],
  }), "invalid-state");
  const stayed = advanceTrains({
    phase: "step",
    departCounts: new Map(),
    stations,
    trains: [{ id: "d4", state: atState(route, 0, 2) }],
  });
  assert.equal(stayed.trains.get("d4").phase, "at");
  const counted = advanceTrains({
    phase: "step",
    departCounts: new Map([["d1", 1]]),
    stations,
    trains: [{ id: "d4", state: transitState(route, 1, 0, 2, 2) }],
  });
  assert.equal(counted.trains.get("d4").remaining, 1);
  const arrived = advanceTrains({
    phase: "step",
    departCounts: new Map(),
    stations,
    trains: [{ id: "d4", state: transitState(route, 1, 0, 1, 2) }],
  });
  assert.equal(arrived.trains.get("d4").phase, "at");
  assert.equal(arrived.stations.get("d2").present, true);
  assert.throws(() => advanceTrains({
    phase: "step",
    departCounts: new Map(),
    stations,
    trains: [
      { id: "d8", state: transitState(["d1", "d2"], 1, 0, 1, 1) },
      { id: "d2", state: transitState(["d3", "d2"], 1, 0, 1, 1) },
    ],
  }), (error) => {
    assert.equal(error.code, "station-conflict");
    assert.match(error.message, /d2, d8/);
    return true;
  });
  const handoff = advanceTrains({
    phase: "step",
    departCounts: new Map([["d1", 1], ["d2", 1]]),
    stations,
    trains: [
      { id: "d4", state: atState(["d1", "d2"], 0, 1) },
      { id: "d5", state: atState(["d2", "d3"], 0, 1) },
    ],
  });
  assert.equal(handoff.trains.get("d4").phase, "transit");
  assert.equal(handoff.trains.get("d5").stationId, "d3");
  assert.equal(handoff.stations.get("d2").present, false);
});

test("TR-01 пустая станция и присутствие на обоих цветах", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_out");
  const green = circuit.network("green_out");
  const empty = new Station({ depart: D, red_output: red, green_output: green });
  const stop = new Station({ depart: D, red_output: red, green_output: green });
  const hidden = new Station({ depart: D });
  const train = new Train({ route: [stop, hidden], transit: 1, at: 0 });
  circuit.add(empty, "d1");
  circuit.add(stop, "d2");
  circuit.add(hidden, "d3");
  circuit.add(train, "d4");
  circuit.add(hold(red, A, 4), "d5");
  const simulation = await circuit.createSimulation();
  assert.deepEqual(simulation.device(empty).state, { present: false, trainId: null });
  assert.deepEqual(names(simulation, red), ["virtual/signal-A/normal=4", "virtual/signal-T/normal=1"]);
  assert.deepEqual(names(simulation, green), ["virtual/signal-T/normal=1"]);
  assert.deepEqual(simulation.device(hidden).state, { present: false, trainId: null });
  assert.equal(simulation.device(stop).output.red.length, 1);
  assert.equal(simulation.gameVersion, "2.1.24");
});

test("TR-02 TR-03 TR-05 маршрут, удержание и кольцо из одной станции", async () => {
  const circuit = new Circuit();
  const redA = circuit.network("red_a");
  const redB = circuit.network("red_b");
  const stopA = new Station({ depart: D, red_input: null, red_output: redA });
  const stopB = new Station({ depart: D, red_output: redB });
  const train = new Train({ route: [stopA, stopB], transit: 1, at: 0 });
  circuit.add(stopA, "d1");
  circuit.add(stopB, "d2");
  circuit.add(train, "d3");
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.device(train).state.phase, "at");
  assert.deepEqual(names(simulation, redA), ["virtual/signal-T/normal=1"]);
  await simulation.step();
  await simulation.step();
  assert.equal(simulation.device(train).state.stationId, "d1");
  assert.deepEqual(names(simulation, redA), ["virtual/signal-T/normal=1"]);

  const moving = new Circuit();
  const outA = moving.network("red_a");
  const outB = moving.network("red_b");
  const depart = moving.network("red_go");
  const origin = new Station({ depart: D, red_input: depart, red_output: outA });
  const goal = new Station({ depart: D, red_output: outB });
  const loco = new Train({ route: [origin, goal], transit: 2, at: 0 });
  const bulb = new Lamp({
    red_input: outA,
    use_colors: false,
    condition: {
      left_operand: { red: true, green: true, signal: T },
      operation: Lamp.Operation.GT,
      right_operand: { constant: 0 },
    },
  });
  moving.add(hold(depart, D, 1), "d1");
  moving.add(origin, "d2");
  moving.add(goal, "d3");
  moving.add(loco, "d4");
  moving.add(bulb, "d5");
  const run = await moving.createSimulation();
  assert.equal(run.device(bulb).state.lit, true);
  await run.step();
  assert.equal(run.device(loco).state.phase, "transit");
  assert.equal(run.device(loco).state.remaining, 2);
  assert.deepEqual(names(run, outA), []);
  assert.equal(run.device(bulb).state.lit, false);
  await run.step();
  assert.equal(run.device(loco).state.remaining, 1);
  assert.deepEqual(names(run, outB), []);
  await run.step();
  assert.equal(run.device(loco).state.phase, "at");
  assert.equal(run.device(loco).state.stationId, "d3");
  assert.deepEqual(names(run, outB), ["virtual/signal-T/normal=1"]);
  await run.step();
  assert.equal(run.device(loco).state.stationId, "d3");

  const loop = new Circuit();
  const gate = loop.network("red_go");
  const yard = loop.network("red_yard");
  const only = new Station({ depart: D, red_input: gate, red_output: yard });
  const ring = new Train({ route: [only, only], transit: 1, at: 0 });
  loop.add(hold(gate, D, 1), "d1");
  loop.add(only, "d2");
  loop.add(ring, "d3");
  const spun = await loop.createSimulation();
  await spun.step();
  assert.equal(spun.device(ring).state.phase, "transit");
  assert.deepEqual(names(spun, yard), []);
  await spun.step();
  assert.equal(spun.device(ring).state.phase, "at");
  assert.deepEqual(names(spun, yard), ["virtual/signal-T/normal=1"]);
});

test("TR-04 текущий вход, сумма цветов и отрицательное переполнение", async () => {
  const circuit = new Circuit();
  const go = circuit.network("red_go");
  const out = circuit.network("red_out");
  const stop = new Station({ depart: D, red_input: go, red_output: out });
  const train = new Train({ route: [stop], transit: 1, at: 0 });
  class Later extends EventCombinator {
    main() {
      if (this.nextTick === 1) {
        this.setOutput({ red: true, green: false, signals: [{ signal: D, constant: 1 }] });
      }
    }
  }
  circuit.add(new Later({ red_output: go }), "d1");
  circuit.add(stop, "d2");
  circuit.add(train, "d3");
  const simulation = await circuit.createSimulation();
  assert.deepEqual(names(simulation, go), []);
  assert.equal(simulation.device(train).state.phase, "at");
  await simulation.step();
  assert.deepEqual(names(simulation, go), ["virtual/signal-D/normal=1"]);
  assert.equal(simulation.device(train).state.phase, "at");
  await simulation.step();
  assert.equal(simulation.device(train).state.phase, "transit");

  const mixed = new Circuit();
  const red = mixed.network("red_go");
  const green = mixed.network("green_go");
  const yard = mixed.network("red_yard");
  const station = new Station({ depart: D, red_input: red, green_input: green, red_output: yard });
  const loco = new Train({ route: [station], transit: 1, at: 0 });
  mixed.add(hold(red, D, 2), "d1");
  mixed.add(hold(green, D, -1), "d2");
  mixed.add(station, "d3");
  mixed.add(loco, "d4");
  const moved = await mixed.createSimulation();
  await moved.step();
  assert.equal(moved.device(loco).state.phase, "transit");

  const wrapped = new Circuit();
  const hi = wrapped.network("red_go");
  const lo = wrapped.network("green_go");
  const pad = wrapped.network("red_yard");
  const full = new Station({ depart: D, red_input: hi, green_input: lo, red_output: pad });
  const parked = new Train({ route: [full], transit: 1, at: 0 });
  wrapped.add(hold(hi, D, INT32_MAX), "d1");
  wrapped.add(hold(lo, D, 1), "d2");
  wrapped.add(full, "d3");
  wrapped.add(parked, "d4");
  const stayed = await wrapped.createSimulation();
  await stayed.step();
  assert.equal(stayed.device(parked).state.phase, "at");

  const greenOnly = new Circuit();
  const wire = greenOnly.network("green_go");
  const mark = greenOnly.network("green_out");
  const side = new Station({ depart: D, green_input: wire, green_output: mark });
  const rider = new Train({ route: [side], transit: 1, at: 0 });
  greenOnly.add(hold(wire, D, 1), "d1");
  greenOnly.add(side, "d2");
  greenOnly.add(rider, "d3");
  const left = await greenOnly.createSimulation();
  assert.deepEqual(names(left, mark), ["virtual/signal-T/normal=1"]);
  await left.step();
  assert.deepEqual(names(left, mark), []);
});

test("TR-06 повторное отправление, пустой вход и удалённая станция", async () => {
  const circuit = new Circuit();
  const go = circuit.network("red_go");
  const origin = circuit.network("red_a");
  const goal = circuit.network("red_b");
  const stopA = new Station({ depart: D, red_input: go, red_output: origin });
  const stopB = new Station({ depart: D, red_output: goal });
  const train = new Train({ route: [stopA, stopB], transit: 1, at: 0 });
  circuit.add(hold(go, D, 1), "d1");
  circuit.add(stopA, "d2");
  circuit.add(stopB, "d3");
  circuit.add(train, "d4");
  const simulation = await circuit.createSimulation();
  await simulation.step();
  await simulation.step();
  await simulation.step();
  assert.equal(simulation.device(train).state.stationId, "d3");
  assert.deepEqual(names(simulation, origin), []);
  assert.deepEqual(names(simulation, goal), ["virtual/signal-T/normal=1"]);
  assert.equal(simulation.device(stopA).state.present, false);

  const other = new Circuit();
  const stop = new Station({ depart: D });
  other.add(stop, "d1");
  other.add(new Train({ route: [stop], transit: 1, at: 0 }), "d2");
  other.remove(stop);
  await rejectsCode(other.createSimulation(), "missing-station");

  const shared = new Station({ depart: D });
  const first = new Circuit();
  first.add(shared);
  const second = new Circuit();
  throwsCode(() => second.add(shared), "foreign-device");
  const pair = new Circuit();
  const left = new Station({ depart: D });
  const right = new Station({ depart: D });
  pair.add(new Train({ route: [left], transit: 1, at: 0 }), "d1");
  pair.add(new Train({ route: [left], transit: 1, at: 0 }), "d2");
  pair.add(left, "d3");
  pair.add(right, "d4");
  await rejectsCode(pair.createSimulation(), "station-occupied");
});

test("TR-07 и TR-12 конфликт не выбирает поезд и не публикует границу", async () => {
  const circuit = new Circuit();
  const go = circuit.network("red_go");
  const a = circuit.network("red_a");
  const b = circuit.network("red_b");
  const c = circuit.network("red_c");
  const stopA = new Station({ depart: D, red_input: go, red_output: a });
  const stopB = new Station({ depart: D, red_input: go, red_output: b });
  const stopC = new Station({ depart: D, red_output: c });
  const first = new Train({ route: [stopA, stopC], transit: 1, at: 0 });
  const second = new Train({ route: [stopB, stopC], transit: 1, at: 0 });
  circuit.add(hold(go, D, 1), "d1");
  circuit.add(stopA, "d2");
  circuit.add(stopB, "d3");
  circuit.add(stopC, "d4");
  circuit.add(first, "d5");
  circuit.add(second, "d6");
  const simulation = await circuit.createSimulation();
  await simulation.step();
  const before = simulation.capture();
  const history = simulation.historyTicks().slice();
  await rejectsRuntime(simulation.step(), "station-conflict");
  assert.equal(simulation.tick, 1);
  assert.deepEqual(simulation.historyTicks(), history);
  assert.deepEqual(simulation.capture(), before);

  const pass = new Circuit();
  const wire = pass.network("red_go");
  const fromA = pass.network("red_a");
  const fromB = pass.network("red_b");
  const intoC = pass.network("red_c");
  const alpha = new Station({ depart: D, red_input: wire, red_output: fromA });
  const beta = new Station({ depart: D, red_input: wire, red_output: fromB });
  const gamma = new Station({ depart: D, red_output: intoC });
  pass.add(hold(wire, D, 1), "d1");
  pass.add(alpha, "d2");
  pass.add(beta, "d3");
  pass.add(gamma, "d4");
  pass.add(new Train({ route: [alpha, beta], transit: 1, at: 0 }), "d5");
  pass.add(new Train({ route: [beta, gamma], transit: 1, at: 0 }), "d6");
  const smooth = await pass.createSimulation();
  await smooth.step();
  await smooth.step();
  assert.equal(smooth.tick, 2);
  assert.deepEqual(names(smooth, fromB), ["virtual/signal-T/normal=1"]);
  assert.deepEqual(names(smooth, intoC), ["virtual/signal-T/normal=1"]);

  const blocked = new Circuit();
  const leave = blocked.network("red_go");
  const home = blocked.network("red_a");
  const busy = blocked.network("red_b");
  const start = new Station({ depart: D, red_input: leave, red_output: home });
  const occupied = new Station({ depart: D, red_output: busy });
  blocked.add(hold(leave, D, 1), "d1");
  blocked.add(start, "d2");
  blocked.add(occupied, "d3");
  blocked.add(new Train({ route: [start, occupied], transit: 1, at: 0 }), "d4");
  blocked.add(new Train({ route: [occupied], transit: 1, at: 0 }), "d5");
  const stuck = await blocked.createSimulation();
  await stuck.step();
  await rejectsRuntime(stuck.step(), "station-conflict");
  assert.equal(stuck.tick, 1);
  assert.deepEqual(names(stuck, busy), ["virtual/signal-T/normal=1"]);
});

test("TR-08 порядок устройств и оптимизированный планировщик", async () => {
  async function trace(order, scheduler) {
    const circuit = new Circuit();
    const outA = circuit.network("red_a");
    const outB = circuit.network("red_b");
    const go = circuit.network("red_go");
    const devices = {
      source: hold(go, D, 1),
      stopA: new Station({ depart: D, red_input: go, red_output: outA }),
      stopB: new Station({ depart: D, red_output: outB }),
    };
    devices.train = new Train({ route: [devices.stopA, devices.stopB], transit: 2, at: 0 });
    const ids = { source: "d1", stopA: "d2", stopB: "d3", train: "d4" };
    for (const name of order) circuit.add(devices[name], ids[name]);
    const simulation = await circuit.createSimulation(scheduler ? { scheduler } : undefined);
    const rows = [];
    for (let tick = 0; tick < 4; tick += 1) {
      rows.push([
        names(simulation, outA),
        names(simulation, outB),
        simulation.device(devices.train).state.phase,
        simulation.device(devices.train).state.remaining,
      ]);
      if (tick < 3) await simulation.step();
    }
    return rows;
  }
  const forward = ["source", "stopA", "stopB", "train"];
  const reverse = ["train", "stopB", "source", "stopA"];
  const expected = await trace(forward);
  assert.deepEqual(await trace(reverse), expected);
  assert.deepEqual(await trace(forward, "optimized"), expected);
  assert.deepEqual(expected.map((row) => row[2]), ["at", "transit", "transit", "at"]);
});

test("TR-09 событийный прототип повторяет signal-T", async () => {
  const circuit = new Circuit();
  const go = circuit.network("red_go");
  const redA = circuit.network("red_a");
  const redB = circuit.network("red_b");
  const mirrorA = circuit.network("red_mirror");
  const mirrorB = circuit.network("green_mirror");
  const stopA = new Station({ depart: D, red_input: go, red_output: redA });
  const stopB = new Station({ depart: D, red_output: redB });
  class Mirror extends EventCombinator {
    init() {
      this.setOutput({ red: true, green: false, signals: [{ signal: T, constant: 1 }] });
    }

    main() {
      if (this.nextTick === 1) this.clearOutput({ red: true, green: false });
      if (this.nextTick === 2) {
        this.setOutput({ red: false, green: true, signals: [{ signal: T, constant: 1 }] });
      }
    }
  }
  circuit.add(hold(go, D, 1), "d1");
  circuit.add(stopA, "d2");
  circuit.add(stopB, "d3");
  circuit.add(new Train({ route: [stopA, stopB], transit: 1, at: 0 }), "d4");
  circuit.add(new Mirror({ red_output: mirrorA, green_output: mirrorB }), "d5");
  const simulation = await circuit.createSimulation();
  for (let tick = 0; tick < 4; tick += 1) {
    assert.deepEqual(names(simulation, redA), names(simulation, mirrorA));
    assert.deepEqual(names(simulation, redB), names(simulation, mirrorB));
    if (tick < 3) await simulation.step();
  }
});

test("TR-10 пауза, reset и повтор", async () => {
  const circuit = new Circuit();
  const go = circuit.network("red_go");
  const out = circuit.network("red_out");
  const stop = new Station({ depart: D, red_input: go, red_output: out });
  const train = new Train({ route: [stop], transit: 1, at: 0 });
  circuit.add(hold(go, D, 1), "d1");
  circuit.add(stop, "d2");
  circuit.add(train, "d3");
  const simulation = await circuit.createSimulation();
  const parked = simulation.capture();
  assert.equal(simulation.tick, parked.tick);
  assert.deepEqual(simulation.capture(), parked);
  await simulation.step();
  const mid = names(simulation, out);
  await simulation.step();
  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.deepEqual(names(simulation, out), ["virtual/signal-T/normal=1"]);
  assert.deepEqual(simulation.historyTicks(), [0]);
  await simulation.step();
  assert.deepEqual(names(simulation, out), mid);
});

test("TR-11 снимок восстанавливает маршрут без очереди", async () => {
  async function open() {
    const circuit = new Circuit();
    const go = circuit.network("red_go");
    const outA = circuit.network("red_a");
    const outB = circuit.network("green_b");
    const stopA = new Station({ depart: D, red_input: go, red_output: outA });
    const stopB = new Station({ depart: D, green_output: outB });
    const stopC = new Station({ depart: D });
    const train = new Train({ route: [stopA, stopB], transit: 2, at: 0 });
    const other = new Train({ route: [stopC, stopA], transit: 1, at: 0 });
    circuit.add(hold(go, D, 1), "d1");
    circuit.add(stopA, "d2");
    circuit.add(stopB, "d3");
    circuit.add(stopC, "d4");
    circuit.add(train, "d5");
    circuit.add(other, "d6");
    return {
      simulation: await circuit.createSimulation(),
      outA,
      outB,
      train,
      stopA,
      stopB,
      stopC,
    };
  }
  const live = await open();
  const origin = live.simulation.capture();
  await live.simulation.restore(origin);
  await live.simulation.step();
  const snapshot = live.simulation.capture();
  const saved = snapshot.devices.find((item) => item.id === "d5").state;
  assert.deepEqual(saved.route, ["d2", "d3"]);
  assert.equal(saved.phase, "transit");
  assert.equal(Object.hasOwn(saved, "queue"), false);
  await live.simulation.step();
  await live.simulation.step();
  const done = [names(live.simulation, live.outA), names(live.simulation, live.outB), live.simulation.device(live.train).state.phase];
  await live.simulation.restore(snapshot);
  assert.equal(live.simulation.tick, 1);
  await live.simulation.step();
  await live.simulation.step();
  assert.deepEqual(
    [names(live.simulation, live.outA), names(live.simulation, live.outB), live.simulation.device(live.train).state.phase],
    done,
  );
  await live.simulation.back();
  assert.equal(live.simulation.tick, 2);

  const broken = await open();
  const corruptions = [
    (shot) => {
      shot.devices.find((item) => item.id === "d5").state.phase = "gone";
    },
    (shot) => {
      const station = shot.devices.find((item) => item.id === "d2").state;
      station.present = false;
      station.trainId = null;
    },
    (shot) => {
      shot.devices.find((item) => item.id === "d2").state.trainId = "d6";
    },
    (shot) => {
      shot.devices.find((item) => item.id === "d2").output.red = [];
    },
    (shot) => {
      const row = shot.devices.find((item) => item.id === "d2");
      row.output.red[0].constant = 2;
    },
    (shot) => {
      shot.devices.find((item) => item.id === "d2").output.red[0].signal.name = "signal-A";
    },
    (shot) => {
      const row = shot.devices.find((item) => item.id === "d2");
      row.output.red.push(structuredClone(row.output.red[0]));
    },
    (shot) => {
      const row = shot.devices.find((item) => item.id === "d2");
      row.output.green.push(structuredClone(row.output.red[0]));
    },
    (shot) => {
      const trainRow = shot.devices.find((item) => item.id === "d5");
      trainRow.state.phase = "transit";
      trainRow.state.remaining = 1;
      trainRow.state.fromIndex = 0;
      trainRow.state.fromId = "d2";
      trainRow.state.index = 1;
      trainRow.state.stationId = "d3";
      const station = shot.devices.find((item) => item.id === "d2");
      station.state.present = false;
      station.state.trainId = null;
    },
    (shot) => {
      const second = shot.devices.find((item) => item.id === "d6");
      second.state.index = 1;
      second.state.stationId = "d2";
    },
  ];
  for (const mutate of corruptions) {
    const shot = structuredClone(broken.simulation.capture());
    mutate(shot);
    await rejectsRuntime(broken.simulation.restore(shot), "invalid-snapshot");
    assert.equal(broken.simulation.tick, 0);
  }

  const space = openProfile("space-age");
  const depart = space.importSignal({ type: "virtual", name: "signal-D", quality: "normal" });
  const colored = new Circuit({ profile: "space-age" });
  const yard = colored.network("red_yard");
  const stop = new Station({ depart, red_output: yard });
  colored.add(stop, "d1");
  colored.add(new Train({ route: [stop], transit: 1, at: 0 }), "d2");
  const exotic = await colored.createSimulation();
  const shot = exotic.capture();
  shot.devices.find((item) => item.id === "d1").output.red[0].signal.quality = "uncommon";
  await rejectsRuntime(exotic.restore(shot), "invalid-snapshot");
});

test("текст и файл схемы собирают станцию и поезд", async () => {
  const text = `wire red_stop {}
train loco = new Train({
  route: [stop],
  transit: 1,
  at: 0
})
station stop = new Station({
  depart: Signal.Signals.signal_D,
  red_output: red_stop
})`;
  const checked = checkConfiguration(text);
  assert.equal(checked.diagnostics.map((item) => item.code).join(","), "");
  const networks = new Map([["red_stop", { name: "red_stop", color: "red" }]]);
  const built = buildPrepared(checked.prepared, [], networks, new Map());
  assert.equal(built.devices[0].device instanceof Train, true);
  assert.equal(built.devices[1].device instanceof Station, true);
  const rejected = checkConfiguration(`wire red_bus {}
station stop = new Station({ red_output: red_bus })
train loco = new Train({ route: [stop, 1], transit: 1, at: 0 })`);
  assert.ok(rejected.diagnostics.some((item) => item.code === "invalid-depart"));
  assert.ok(rejected.diagnostics.some((item) => item.code === "unknown-station"));
  const unnamed = checkConfiguration(`train loco = new Train({
  route: [missing],
  transit: 1,
  at: 0
})`);
  assert.ok(unnamed.diagnostics.some((item) => item.code === "unknown-station"));
  const orphan = checkConfiguration(`wire red_bus {}
station stop = new Station({ red_output: red_bus })
train loco = new Train({ route: [stop], transit: 1, at: 0 })`);
  assert.ok(orphan.diagnostics.some((item) => item.code === "unknown-station"));
  const bare = checkConfiguration("train loco = new Train({ transit: 1, at: 0 })");
  assert.ok(bare.diagnostics.some((item) => item.code === "invalid-route"));

  const profile = openProfile("base");
  const ports = { red_input: null, green_input: null, red_output: null, green_output: null };
  const document = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: "Поезда",
    profile: "base",
    gameVersion: profile.gameVersion,
    seed: 1,
    world: null,
    networks: [{ id: "n1", name: "red_stop", color: "red" }],
    groups: [],
    scenarioState: null,
    devices: [
      {
        id: "d2",
        name: "loco",
        kind: "train",
        ports: { ...ports },
        config: { route: [{ kind: "device", id: "d1" }], transit: 1, at: 0 },
        source: null,
        receiver: null,
      },
      {
        id: "d1",
        name: "stop",
        kind: "station",
        ports: { ...ports, red_output: "n1" },
        config: { depart: { kind: "signal", type: "virtual", name: "signal-D", quality: "normal" } },
        source: null,
        receiver: null,
      },
    ],
  };
  const loaded = readProject(document);
  assert.equal(loaded.circuit.devices.some((item) => item instanceof Train), true);
  const simulation = await loaded.circuit.createSimulation();
  assert.deepEqual(names(simulation, loaded.circuit.network("red_stop")), ["virtual/signal-T/normal=1"]);
  const missing = structuredClone(document);
  missing.devices[0].config.route[0].id = "d9";
  assert.throws(() => readProject(missing), (error) => error.code === "missing-station");
  const constant = structuredClone(document);
  constant.devices[1].kind = "constant";
  constant.devices[1].config = { enabled: true, signals: [] };
  constant.devices[1].ports = { ...ports };
  assert.throws(() => readProject(constant), (error) => error.code === "unknown-station");
  const leaked = structuredClone(document);
  leaked.devices[1].config.note = { kind: "device", id: "d1" };
  assert.throws(() => readProject(leaked), (error) => error.code === "invalid-project");
  const wired = structuredClone(document);
  wired.devices[0].ports.red_input = "n1";
  assert.throws(() => readProject(wired), (error) => error.code === "forbidden-port");
});
