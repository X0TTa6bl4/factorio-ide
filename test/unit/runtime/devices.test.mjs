import assert from "node:assert/strict";
import test from "node:test";
import { buildPrepared, checkConfiguration, operationCatalog } from "../../../src/config-check.js";
import { readLampState } from "../../../src/lamp.js";
import {
  Arithmetic,
  Circuit,
  ConfigError,
  Constant,
  EventCombinator,
  INT32_MAX,
  INT32_MIN,
  Lamp,
  OperationToken,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  Quality,
  RuntimeError,
  Signal,
  Storage,
  openProfile,
  readProject,
} from "../../../src/index.js";
import { throwsCode } from "../signals/support.mjs";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const RED = Signal.Signals.signal_red;
const GREEN = Signal.Signals.signal_green;
const BLUE = Signal.Signals.signal_blue;
const YELLOW = Signal.Signals.signal_yellow;
const PINK = Signal.Signals.signal_pink;
const CYAN = Signal.Signals.signal_cyan;
const WHITE = Signal.Signals.signal_white;
const GREY = Signal.Signals.signal_grey;
const BLACK = Signal.Signals.signal_black;
const OP = Lamp.Operation;
const redMask = { red: true, green: false };
const greenMask = { red: false, green: true };
const bothMask = { red: true, green: true };
const noneMask = { red: false, green: false };

function count(signal, constant) {
  return { signal, constant };
}

function signalOperand(signal, mask = redMask) {
  return { red: mask.red, green: mask.green, signal };
}

function condition(operation, right, mask = redMask, signal = A) {
  return {
    left_operand: signalOperand(signal, mask),
    operation,
    right_operand: right,
  };
}

function lamp(extra = {}) {
  return {
    condition: condition(OP.GT, { constant: 0 }),
    use_colors: false,
    ...extra,
  };
}

function storage(extra = {}) {
  return {
    enabled: true,
    mode: "read",
    contents: [],
    ...extra,
  };
}

async function boot(build, options) {
  const circuit = new Circuit();
  const ports = {
    red: circuit.network("red_bus"),
    green: circuit.network("green_bus"),
    other: circuit.network("red_other"),
  };
  const devices = build(circuit, ports);
  const simulation = await circuit.createSimulation(options);
  return { circuit, simulation, ports, ...devices };
}

test("лампа и хранилище принимают минимальную форму и копируют списки", () => {
  const circuit = new Circuit();
  const red = circuit.network("red_bus");
  const contents = [count(A, 3)];
  const chest = new Storage({ ...storage({ contents, red_output: red }) });
  contents.push(count(B, 9));
  contents[0] = count(A, 8);
  circuit.add(chest);
  assert.equal(chest.contents.length, 1);
  assert.equal(chest.contents[0].constant, 3);
  assert.equal(chest.mode, "read");
  assert.equal(chest.red_output, red);
  assert.equal(new Storage(storage()).green_output, null);

  const bulb = new Lamp(lamp({ red_input: red }));
  assert.equal(bulb.red_input, red);
  assert.equal(bulb.green_input, null);
  assert.equal(bulb.useColors, false);
  assert.equal(bulb.colorMode, null);
  assert.equal(bulb.condition.operation, "GT");
  assert.equal(bulb.condition.right.constant, 0);
  circuit.add(bulb);
  assert.equal(circuit.devices.length, 2);
});

test("лампа отклоняет форму, выходы, чужие операции и неподдержанные настройки", () => {
  const circuit = new Circuit();
  const red = circuit.network("red_bus");
  const cases = [
    [null, "invalid-lamp-config"],
    [[], "invalid-lamp-config"],
    [lamp({ note: true }), "invalid-lamp-config"],
    [lamp({ red_output: null }), "forbidden-output"],
    [lamp({ green_output: red }), "forbidden-output"],
    [lamp({ logistic_condition: {} }), "unsupported-case"],
    [lamp({ connect_to_logistic_network: false }), "unsupported-case"],
    [lamp({ circuit_enabled: true }), "unsupported-case"],
    [lamp({ red_signal: RED }), "unsupported-case"],
    [lamp({ green_signal: GREEN }), "unsupported-case"],
    [lamp({ blue_signal: BLUE }), "unsupported-case"],
    [lamp({ rgb_signal: WHITE }), "unsupported-case"],
    [{ use_colors: false }, "invalid-condition"],
    [lamp({ condition: null }), "invalid-condition"],
    [lamp({ condition: [] }), "invalid-condition"],
    [lamp({ condition: { left_operand: signalOperand(A), operation: OP.GT } }), "invalid-condition"],
    [lamp({ condition: { ...condition(OP.GT, { constant: 0 }), logic: "AND" } }), "invalid-condition"],
    [lamp({ condition: { ...condition("GT", { constant: 0 }) } }), "invalid-operation"],
    [lamp({ condition: condition(Arithmetic.Operation.SUM, { constant: 0 }) }), "foreign-operation"],
    [lamp({ condition: condition(new OperationToken("lamp", "NOPE"), { constant: 0 }) }), "unsupported-operation"],
    [{ condition: condition(OP.GT, { constant: 0 }) }, "invalid-colors"],
    [lamp({ use_colors: "true" }), "invalid-colors"],
    [lamp({ use_colors: true }), "invalid-color-mode"],
    [lamp({ use_colors: true, color_mode: "rgb" }), "invalid-color-mode"],
    [lamp({ use_colors: false, color_mode: "mapping" }), "invalid-color-mode"],
    [lamp({ condition: { left_operand: null, operation: OP.GT, right_operand: { constant: 0 } } }), "invalid-operand"],
    [lamp({ condition: { left_operand: [], operation: OP.GT, right_operand: { constant: 0 } } }), "invalid-operand"],
    [lamp({ condition: condition(OP.GT, { constant: 0 }, redMask, null) }), "invalid-signal"],
    [lamp({ condition: condition(OP.GT, null) }), "invalid-operand"],
    [lamp({ condition: { left_operand: { constant: 1 }, operation: OP.GT, right_operand: { constant: 0 } } }), "invalid-operand"],
    [lamp({ condition: { left_operand: { red: true, green: false }, operation: OP.GT, right_operand: { constant: 0 } } }), "invalid-operand"],
    [lamp({ condition: { left_operand: { red: 1, green: false, signal: A }, operation: OP.GT, right_operand: { constant: 0 } } }), "invalid-mask"],
    [lamp({ condition: { left_operand: signalOperand(Signal.Meta.signal_each), operation: OP.GT, right_operand: { constant: 0 } } }), "meta-signal"],
    [lamp({ condition: { left_operand: signalOperand(Quality.RARE), operation: OP.GT, right_operand: { constant: 0 } } }), "invalid-signal"],
    [lamp({ condition: condition(OP.GT, { constant: 1, signal: A }) }), "mixed-operand"],
    [lamp({ condition: condition(OP.GT, { constant: 1, extra: true }) }), "invalid-operand"],
    [lamp({ condition: condition(OP.GT, { constant: 1.5 }) }), "invalid-constant"],
    [lamp({ condition: condition(OP.GT, { constant: "1" }) }), "invalid-constant"],
    [lamp({ red_input: "red_bus" }), "invalid-port"],
    [lamp({ red_input: A }), "invalid-port"],
    [lamp({ red_input: OP.GT }), "invalid-port"],
    [lamp({ red_input: 1 }), "invalid-port"],
  ];
  for (const [config, code] of cases) {
    throwsCode(() => new Lamp(config), code);
  }
  const foreign = new Circuit().network("red_foreign");
  throwsCode(() => circuit.add(new Lamp(lamp({ red_input: foreign }))), "foreign-network");
  const plate = openProfile("space-age").tree.Intermediate.iron_plate;
  throwsCode(() => circuit.add(new Lamp(lamp({
    condition: condition(OP.EQ, { constant: 0 }, redMask, plate),
  }))), "wrong-profile");
});

test("хранилище отклоняет режимы, входы и количества", () => {
  const circuit = new Circuit();
  const red = circuit.network("red_bus");
  const cases = [
    [null, "invalid-storage-config"],
    [[], "invalid-storage-config"],
    [storage({ note: true }), "invalid-storage-config"],
    [storage({ red_input: null }), "forbidden-input"],
    [storage({ green_input: red }), "forbidden-input"],
    [{ enabled: true, contents: [] }, "invalid-mode"],
    [storage({ mode: 1 }), "invalid-mode"],
    [storage({ mode: "hold" }), "invalid-mode"],
    [storage({ mode: "empty-slots" }), "unsupported-case"],
    [storage({ mode: "requests" }), "unsupported-case"],
    [storage({ mode: "enable" }), "unsupported-case"],
    [storage({ mode: "pipeline" }), "unsupported-case"],
    [storage({ mode: "temperature" }), "unsupported-case"],
    [storage({ enabled: "true" }), "invalid-enabled"],
    [storage({ contents: null }), "invalid-contents"],
    [storage({ contents: [null] }), "invalid-signal-count"],
    [storage({ contents: [count(Signal.Meta.signal_each, 1)] }), "meta-signal"],
    [storage({ contents: [count(A, INT32_MAX + 1)] }), "invalid-constant"],
    [storage({ red_output: "red_bus" }), "invalid-port"],
    [storage({ red_output: A }), "invalid-port"],
    [storage({ red_output: OP.GT }), "invalid-port"],
    [storage({ red_output: [] }), "invalid-port"],
  ];
  for (const [config, code] of cases) {
    throwsCode(() => new Storage(config), code);
  }
  const plate = openProfile("space-age").tree.Intermediate.iron_plate;
  const chest = new Storage(storage({ contents: [count(plate, 1)], red_output: red }));
  throwsCode(() => circuit.add(chest), "wrong-profile");
  const broken = new Storage(storage({ red_output: red }));
  broken.enabled = "no";
  throwsCode(() => circuit.add(broken), "invalid-enabled");
});

test("наблюдатель с чужим состоянием и двумя ролями отклоняется до публикации", async () => {
  const mixed = new Circuit();
  throwsCode(() => mixed.add({ observe() {}, compute() {} }), "mixed-device");
  const pending = new Circuit();
  pending.add({
    observe() {
      return Promise.resolve({ lit: false, color: null });
    },
  });
  await assert.rejects(pending.createSimulation(), (error) => error instanceof RuntimeError && error.code === "async-observe");
  const callable = new Circuit();
  callable.add({
    observe() {
      const value = function observation() {};
      value.then = () => undefined;
      return value;
    },
  });
  await assert.rejects(callable.createSimulation(), (error) => error instanceof RuntimeError && error.code === "async-observe");
  const blank = new Circuit();
  blank.add({ observe() { return null; } });
  await assert.rejects(blank.createSimulation(), (error) => error instanceof RuntimeError && error.code === "invalid-state");
});

test("AD-01 AD-03 хранилище публикует содержимое на границе 0 только в подключённые сети", async () => {
  const { simulation, ports } = await boot((circuit, networks) => {
    circuit.add(new Storage(storage({
      contents: [count(A, 4), count(A, 1), count(B, 0)],
      red_output: networks.red,
      green_output: networks.green,
    })));
    circuit.add(new Constant({
      enabled: true,
      signals: [count(B, 2)],
      red_output: networks.other,
    }));
    return {};
  });
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(ports.red, A), 5);
  assert.equal(simulation.read(ports.green, A), 5);
  assert.equal(simulation.read(ports.red, B), 0);
  assert.equal(simulation.read(ports.other, A), 0);
  assert.equal(simulation.read(ports.other, B), 2);
  await simulation.step();
  assert.equal(simulation.read(ports.red, A), 5);
});

test("AD-02 AD-06 границы int32, пустой список и выключенное хранилище", async () => {
  const { simulation, ports } = await boot((circuit, networks) => {
    circuit.add(new Storage(storage({
      contents: [count(A, INT32_MAX), count(A, 1), count(B, INT32_MIN)],
      red_output: networks.red,
    })));
    circuit.add(new Storage(storage({
      enabled: false,
      contents: [count(A, 9)],
      green_output: networks.green,
    })));
    circuit.add(new Storage(storage({
      contents: [],
      red_output: networks.other,
    })));
    return {};
  });
  assert.equal(simulation.read(ports.red, A), INT32_MIN);
  assert.equal(simulation.read(ports.red, B), INT32_MIN);
  assert.equal(simulation.read(ports.green, A), 0);
  assert.equal(simulation.read(ports.other, A), 0);
});

test("AD-04 AD-05 лампа видит постоянный сигнал сразу и гаснет вместе с его исчезновением", async () => {
  class Pulse extends EventCombinator {
    init() {
      this.setOutput({ red: true, green: false, signals: [count(A, 5)] });
    }

    main() {
      this.clearOutput({ red: true, green: false });
    }
  }
  const seen = [];
  for (const lampFirst of [true, false]) {
    const circuit = new Circuit();
    const red = circuit.network("red_bus");
    const bulb = new Lamp(lamp({ red_input: red, condition: condition(OP.GT, { constant: 0 }) }));
    const event = new Pulse({ red_output: red });
    if (lampFirst) {
      circuit.add(bulb);
      circuit.add(event);
    } else {
      circuit.add(event);
      circuit.add(bulb);
    }
    const simulation = await circuit.createSimulation();
    assert.equal(simulation.read(red, A), 5);
    assert.deepEqual(simulation.device(bulb).state, { lit: true, color: null });
    assert.deepEqual(simulation.device(bulb).output.red, []);
    assert.equal(simulation.device(bulb).seenInputs, null);
    await simulation.step();
    assert.equal(simulation.read(red, A), 0);
    assert.equal(simulation.device(bulb).state.lit, false);
    assert.equal(typeof simulation.device(bulb).seenInputs, "string");
    seen.push(simulation.device(bulb).state.lit);
    const snapshot = simulation.capture();
    await simulation.back();
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.device(bulb).state.lit, true);
    await simulation.restore(snapshot);
    assert.equal(simulation.device(bulb).state.lit, false);
    await simulation.reset();
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.read(red, A), 5);
    assert.equal(simulation.device(bulb).state.lit, true);
  }
  assert.deepEqual(seen, [false, false]);
});

test("сравнения лампы и маски цветов не сливают чужую сеть", async () => {
  const rows = [
    [OP.GT, 2, 50, false],
    [OP.LT, 1, 2, true],
    [OP.EQ, 4, 4, true],
    [OP.GTE, 4, 4, true],
    [OP.LTE, 1, 2, true],
    [OP.NEQ, 1, 2, true],
    [OP.EQ, 1, 2, false],
  ];
  for (const [operation, left, right, expected] of rows) {
    const { simulation, ports, bulb } = await boot((circuit, networks) => {
      circuit.add(new Constant({
        enabled: true,
        signals: [count(A, left), count(B, 9)],
        red_output: networks.red,
      }));
      circuit.add(new Constant({
        enabled: true,
        signals: [count(A, 100)],
        green_output: networks.green,
      }));
      const device = new Lamp(lamp({
        red_input: networks.red,
        green_input: networks.green,
        condition: {
          left_operand: signalOperand(A, redMask),
          operation,
          right_operand: { constant: right },
        },
      }));
      circuit.add(device);
      return { bulb: device };
    });
    assert.equal(simulation.device(bulb).state.lit, expected);
    assert.equal(simulation.read(ports.red, A), left);
    assert.equal(simulation.read(ports.red, B), 9);
    assert.equal(simulation.read(ports.green, A), 100);
  }

  const { simulation, ports, bulb } = await boot((circuit, networks) => {
    circuit.add(new Constant({
      enabled: true,
      signals: [count(A, 5)],
      red_output: networks.red,
    }));
    const device = new Lamp(lamp({
      red_input: networks.red,
      condition: condition(OP.EQ, signalOperand(A, noneMask), noneMask),
    }));
    circuit.add(device);
    return { bulb: device };
  });
  assert.equal(simulation.device(bulb).state.lit, true);
  assert.equal(simulation.read(ports.red, A), 5);
});

test("AD-07 AD-11 цвет лампы следует контракту и не пишет сеть", async () => {
  const { simulation, ports, bulb } = await boot((circuit, networks) => {
    circuit.add(new Constant({
      enabled: true,
      signals: [count(RED, 1), count(GREEN, 1000), count(A, 3)],
      red_output: networks.red,
    }));
    const device = new Lamp({
      red_input: networks.red,
      use_colors: true,
      color_mode: "mapping",
      condition: condition(OP.GT, { constant: 0 }),
    });
    circuit.add(device);
    return { bulb: device };
  });
  assert.deepEqual(simulation.device(bulb).state, { lit: true, color: { mode: "mapping", name: "signal-red" } });
  assert.equal(simulation.read(ports.red, RED), 1);
  assert.equal(simulation.device(bulb).output.green.length, 0);

  const summed = await boot((circuit, networks) => {
    circuit.add(new Constant({
      enabled: true,
      signals: [count(RED, 1), count(A, 1)],
      red_output: networks.red,
    }));
    circuit.add(new Constant({
      enabled: true,
      signals: [count(RED, -1), count(GREEN, 4)],
      green_output: networks.green,
    }));
    const device = new Lamp({
      red_input: networks.red,
      green_input: networks.green,
      use_colors: true,
      color_mode: "mapping",
      condition: condition(OP.EQ, { constant: 1 }),
    });
    circuit.add(device);
    return { bulb: device };
  });
  assert.deepEqual(summed.simulation.device(summed.bulb).state.color, { mode: "mapping", name: "signal-green" });

  const grey = await boot((circuit, networks) => {
    circuit.add(new Constant({
      enabled: true,
      signals: [count(CYAN, 3), count(GREY, 4), count(BLACK, 0), count(A, 1)],
      red_output: networks.red,
    }));
    const device = new Lamp({
      red_input: networks.red,
      use_colors: true,
      color_mode: "mapping",
      condition: condition(OP.EQ, { constant: 1 }),
    });
    circuit.add(device);
    return { bulb: device };
  });
  assert.deepEqual(grey.simulation.device(grey.bulb).state.color, { mode: "mapping", name: "signal-cyan" });

  const dark = await boot((circuit, networks) => {
    circuit.add(new Constant({
      enabled: true,
      signals: [count(A, 1), count(PINK, -3)],
      red_output: networks.red,
    }));
    const device = new Lamp({
      red_input: networks.red,
      use_colors: true,
      color_mode: "mapping",
      condition: condition(OP.GT, { constant: 0 }),
    });
    circuit.add(device);
    return { bulb: device };
  });
  assert.equal(dark.simulation.device(dark.bulb).state.lit, true);
  assert.equal(dark.simulation.device(dark.bulb).state.color, null);

  const parts = await boot((circuit, networks) => {
    circuit.add(new Constant({
      enabled: true,
      signals: [count(RED, 10), count(GREEN, 20), count(BLUE, 30), count(A, 1)],
      red_output: networks.red,
    }));
    const device = new Lamp({
      red_input: networks.red,
      use_colors: true,
      color_mode: "components",
      condition: condition(OP.GT, { constant: 0 }),
    });
    circuit.add(device);
    return { bulb: device };
  });
  assert.deepEqual(parts.simulation.device(parts.bulb).state, {
    lit: true,
    color: { mode: "components", red: 10, green: 20, blue: 30 },
  });

  const packed = await boot((circuit, networks) => {
    circuit.add(new Constant({
      enabled: true,
      signals: [count(WHITE, 16777215), count(A, 1)],
      red_output: networks.red,
    }));
    const device = new Lamp({
      red_input: networks.red,
      use_colors: true,
      color_mode: "packed",
      condition: condition(OP.GTE, { constant: 1 }),
    });
    circuit.add(device);
    return { bulb: device };
  });
  assert.deepEqual(packed.simulation.device(packed.bulb).state.color, { mode: "packed", value: 16777215 });
});

test("редкое качество цвета не выбирается, обычный зелёный выбирается", async () => {
  const space = openProfile("space-age");
  const rareRed = space.tree.Signals.signal_red.withQuality(Quality.RARE);
  const green = space.tree.Signals.signal_green;
  const signalA = space.tree.Signals.signal_A;
  const circuit = new Circuit({ profile: "space-age" });
  const red = circuit.network("red_bus");
  circuit.add(new Constant({
    enabled: true,
    signals: [count(rareRed, 5), count(green, 1), count(signalA, 1)],
    red_output: red,
  }));
  const bulb = new Lamp({
    red_input: red,
    use_colors: true,
    color_mode: "mapping",
    condition: {
      left_operand: signalOperand(signalA),
      operation: OP.EQ,
      right_operand: { constant: 1 },
    },
  });
  circuit.add(bulb);
  const simulation = await circuit.createSimulation();
  assert.deepEqual(simulation.device(bulb).state.color, { mode: "mapping", name: "signal-green" });
});

test("компонент и packed вне диапазона не публикуют границу", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_bus");
  circuit.add(new Constant({
    enabled: true,
    signals: [count(RED, 256), count(A, 1)],
    red_output: red,
  }));
  circuit.add(new Lamp({
    red_input: red,
    use_colors: true,
    color_mode: "components",
    condition: condition(OP.GT, { constant: 0 }),
  }));
  await assert.rejects(circuit.createSimulation(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");

  const delayed = new Circuit();
  const bus = delayed.network("red_bus");
  const color = delayed.network("green_color");
  delayed.add(new Constant({
    enabled: true,
    signals: [count(A, 1)],
    red_output: bus,
  }));
  delayed.add(new Arithmetic({
    red_input: bus,
    green_output: color,
    left_operand: signalOperand(A),
    right_operand: { constant: 16777215 },
    operation: Arithmetic.Operation.SUM,
    return: WHITE,
  }));
  const bulb = new Lamp({
    red_input: bus,
    green_input: color,
    use_colors: true,
    color_mode: "packed",
    condition: condition(OP.GT, { constant: 0 }),
  });
  delayed.add(bulb);
  const simulation = await delayed.createSimulation();
  assert.equal(simulation.device(bulb).state.lit, true);
  assert.equal(simulation.read(color, WHITE), 0);
  await assert.rejects(simulation.step(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(color, WHITE), 0);
  assert.equal(simulation.device(bulb).state.color.mode, "packed");
  assert.equal(simulation.device(bulb).state.color.value, 0);
});

test("полный и оптимизированный проходы дают одну трассу лампы", async () => {
  async function trace(scheduler) {
    const circuit = new Circuit();
    const bus = circuit.network("red_bus");
    const color = circuit.network("green_color");
    circuit.add(new Constant({
      enabled: true,
      signals: [count(A, 1)],
      red_output: bus,
    }));
    circuit.add(new Arithmetic({
      red_input: bus,
      green_output: color,
      left_operand: signalOperand(A),
      right_operand: { constant: 0 },
      operation: Arithmetic.Operation.SUM,
      return: YELLOW,
    }));
    const bulb = new Lamp({
      green_input: color,
      use_colors: true,
      color_mode: "mapping",
      condition: condition(OP.GT, { constant: 0 }, greenMask, YELLOW),
    });
    circuit.add(bulb);
    const simulation = await circuit.createSimulation({ scheduler });
    const states = [simulation.device(bulb).state];
    const seen = [simulation.device(bulb).seenInputs];
    await simulation.step();
    states.push(simulation.device(bulb).state);
    seen.push(simulation.device(bulb).seenInputs);
    await simulation.step();
    states.push(simulation.device(bulb).state);
    seen.push(simulation.device(bulb).seenInputs);
    return { states, seen, yellow: simulation.read(color, YELLOW) };
  }
  const full = await trace("full");
  const optimized = await trace("optimized");
  assert.deepEqual(optimized, full);
  assert.equal(full.states[0].lit, false);
  assert.equal(full.states[1].lit, true);
  assert.deepEqual(full.states[1].color, { mode: "mapping", name: "signal-yellow" });
  assert.deepEqual(full.states[2], full.states[1]);
  assert.equal(full.yellow, 1);
});

test("хранилище в цикле совпадает с постоянным источником и не зависит от порядка", async () => {
  async function trace(order) {
    const circuit = new Circuit();
    const red = circuit.network("red_loop");
    const chest = new Storage(storage({ contents: [count(A, 1)], red_output: red }));
    const adder = new Arithmetic({
      red_input: red,
      red_output: red,
      left_operand: signalOperand(A),
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: A,
    });
    const bulb = new Lamp(lamp({ red_input: red }));
    for (const device of order(chest, adder, bulb)) circuit.add(device);
    const simulation = await circuit.createSimulation();
    const values = [simulation.read(red, A)];
    await simulation.step();
    values.push(simulation.read(red, A));
    await simulation.step();
    values.push(simulation.read(red, A));
    return { values, lit: simulation.device(bulb).state.lit };
  }
  const forward = await trace((chest, adder, bulb) => [chest, adder, bulb]);
  const reverse = await trace((chest, adder, bulb) => [bulb, adder, chest]);
  assert.deepEqual(forward, { values: [1, 3, 5], lit: true });
  assert.deepEqual(reverse, forward);
});

test("AD-09 AD-10 файл схемы и событийное сравнение сохраняют смысл", async () => {
  const profile = openProfile("base");
  const signal = { kind: "signal", type: "virtual", name: "signal-A", quality: "normal" };
  const loaded = readProject({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: "Склад",
    profile: "base",
    gameVersion: profile.gameVersion,
    seed: 1,
    world: null,
    networks: [
      { id: "n1", name: "red_bus", color: "red" },
      { id: "n2", name: "green_bus", color: "green" },
    ],
    groups: [],
    devices: [
      {
        id: "d1",
        name: "chest",
        kind: "storage",
        ports: { red_input: null, green_input: null, red_output: "n1", green_output: null },
        config: { enabled: true, mode: "read", contents: [{ signal, constant: 4 }] },
        source: null,
        receiver: null,
      },
      {
        id: "d2",
        name: "bulb",
        kind: "lamp",
        ports: { red_input: "n1", green_input: null, red_output: null, green_output: null },
        config: {
          use_colors: false,
          condition: {
            left_operand: { red: true, green: false, signal },
            operation: { kind: "operation", owner: "lamp", name: "GT" },
            right_operand: { constant: 0 },
          },
        },
        source: null,
        receiver: null,
      },
    ],
    scenarioState: null,
  });
  const chest = loaded.circuit.devices[0];
  const bulb = loaded.circuit.devices[1];
  assert.equal(chest.contents[0].constant, 4);
  assert.equal(bulb.red_input.name, "red_bus");
  class Note extends EventCombinator {
    main() {
      this.state = { lit: this.readSignal(A, redMask) > 0 };
    }
  }
  loaded.circuit.add(new Note({ red_input: loaded.circuit.network("red_bus") }));
  const simulation = await loaded.circuit.createSimulation();
  assert.equal(simulation.read(loaded.circuit.network("red_bus"), A), 4);
  assert.equal(simulation.device(bulb).state.lit, true);
  await simulation.step();
  const note = loaded.circuit.devices[2];
  assert.equal(simulation.device(note).state.lit, true);
  assert.equal(simulation.device(bulb).state.lit, true);

  const blocked = {
    ...loaded.document,
    devices: loaded.document.devices.map((device) => (
      device.kind === "lamp"
        ? { ...device, ports: { ...device.ports, red_output: "n1" } }
        : device
    )),
  };
  assert.throws(() => readProject(blocked), (error) => error instanceof ConfigError && error.code === "forbidden-output");
  const input = {
    ...loaded.document,
    devices: loaded.document.devices.map((device) => (
      device.kind === "storage"
        ? { ...device, ports: { ...device.ports, red_input: "n1" } }
        : device
    )),
  };
  assert.throws(() => readProject(input), (error) => error instanceof ConfigError && error.code === "forbidden-input");
});

test("текст конфигурации собирает лампу и хранилище и диагностирует режим", () => {
  const text = `wire red_bus {}
storage chest = new Storage({
  enabled: true,
  mode: "read",
  red_output: red_bus,
  contents: [{ signal: Signal.Signals.signal_A, constant: 4 }]
})
lamp bulb = new Lamp({
  red_input: red_bus,
  use_colors: true,
  color_mode: "components",
  condition: {
    left_operand: { red: true, green: true, signal: Signal.Signals.signal_A },
    operation: Lamp.Operation.LTE,
    right_operand: { red: false, green: true, signal: Signal.Signals.signal_B }
  }
})`;
  const checked = checkConfiguration(text);
  assert.equal(checked.diagnostics.map((item) => item.message).join("\n"), "");
  assert.deepEqual(checked.model.devices.map((item) => item.kind), ["storage", "lamp"]);
  const networks = new Map([["red_bus", { name: "red_bus", color: "red" }]]);
  const built = buildPrepared(checked.prepared, [], networks, new Map());
  assert.equal(built.devices[0].device instanceof Storage, true);
  assert.equal(built.devices[1].device instanceof Lamp, true);
  assert.equal(operationCatalog().some((item) => item.path === "Lamp.Operation.LTE"), true);

  const rejected = checkConfiguration(`storage chest = new Storage({
    enabled: true,
    mode: "requests",
    contents: []
  })`);
  assert.equal(rejected.diagnostics.some((item) => item.code === "unsupported-case"), true);
  assert.equal(rejected.prepared.length, 0);
});

test("снимок лампы отвергает чужое состояние", async () => {
  const { circuit, simulation, bulb } = await boot((next, networks) => {
    const device = new Lamp(lamp({ red_input: networks.red }));
    next.add(device);
    return { bulb: device };
  });
  const snapshot = simulation.capture();
  const entry = snapshot.devices.find((item) => item.id === circuit.deviceId(bulb));
  entry.state = { lit: true };
  await assert.rejects(simulation.restore(snapshot), (error) => error instanceof RuntimeError && error.code === "invalid-snapshot");
  for (const value of [null, [], { lit: true }, { lit: true, color: 1 }, { lit: true, color: [] }, { lit: true, color: null, extra: 1 }, { lit: 1, color: null }, { lit: true, color: { mode: "mapping" } }, { lit: true, color: { mode: "mapping", name: "signal-red", extra: 1 } }, { lit: true, color: { mode: "mapping", name: "signal-orange" } }, { lit: true, color: { mode: "components", red: 1, green: 1 } }, { lit: true, color: { mode: "components", red: 1.5, green: 0, blue: 0 } }, { lit: true, color: { mode: "components", red: 1, green: 1, blue: 256 } }, { lit: true, color: { mode: "packed", value: -1 } }, { lit: true, color: { mode: "packed", value: 16777216 } }, { lit: true, color: { mode: "packed" } }, { lit: true, color: { mode: "other" } }]) {
    assert.throws(() => readLampState(value, "invalid-snapshot"), (error) => error instanceof RuntimeError && error.code === "invalid-snapshot");
  }
  assert.deepEqual(readLampState({ lit: false, color: { mode: "components", red: 0, green: 1, blue: 2 } }), {
    lit: false,
    color: { mode: "components", red: 0, green: 1, blue: 2 },
  });
});
