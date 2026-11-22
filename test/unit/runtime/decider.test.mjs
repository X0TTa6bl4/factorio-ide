import assert from "node:assert/strict";
import test from "node:test";
import {
  Arithmetic,
  Circuit,
  Constant,
  Decider,
  INT32_MAX,
  INT32_MIN,
  OperationToken,
  Quality,
  RuntimeError,
  Signal,
  openProfile,
} from "../../../src/index.js";
import { throwsCode } from "../signals/support.mjs";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;
const D = Signal.Signals.signal_D;
const coal = Signal.Intermediate.coal;
const iron = Signal.Intermediate.iron_plate;
const copper = Signal.Intermediate.copper_plate;
const water = Signal.Fluids.water;
const EACH = Signal.Meta.signal_each;
const EVERY = Signal.Meta.signal_everything;
const ANY = Signal.Meta.signal_anything;
const OP = Decider.Operation;
const AND = Decider.Logic.AND;
const OR = Decider.Logic.OR;
const space = openProfile("space-age").tree;
const spaceIron = space.Intermediate.iron_plate;
const selector = space.Unsorted.signal_any_quality;

function wire(signal, red = true, green = false) {
  return { red, green, signal };
}

function cmp(left, operation, right, logic) {
  const condition = { left_operand: left, right_operand: right, operation };
  if (logic) condition.logic = logic;
  return condition;
}

function fixed(signal, constant) {
  return { signal, constant };
}

function copy(signal, red = true, green = false) {
  return { signal, red, green };
}

function count(signal, constant) {
  return { signal, constant };
}

function base(extra = {}) {
  return { conditions: [cmp(wire(A), OP.EQ, { constant: 0 })], ...extra };
}

function listed(entries) {
  return entries.map((entry) => [entry.signal.type, entry.signal.name, entry.signal.quality, entry.constant]);
}

async function simulate({
  redSignals = [],
  greenSignals = [],
  conditions,
  whenTrue,
  whenFalse,
  profile,
} = {}) {
  const circuit = new Circuit(profile ? { profile } : {});
  const red = circuit.network("red_in");
  const green = circuit.network("green_in");
  const out = circuit.network("green_out");
  const mirrored = circuit.network("red_out");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: redSignals }));
  circuit.add(new Constant({ enabled: true, green_output: green, signals: greenSignals }));
  const deviceConfig = {
    red_input: red,
    green_input: green,
    green_output: out,
    red_output: mirrored,
    conditions,
  };
  if (whenTrue !== undefined) deviceConfig.when_true = whenTrue;
  if (whenFalse !== undefined) deviceConfig.when_false = whenFalse;
  circuit.add(new Decider(deviceConfig));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.present(out).length, 0);
  await simulation.step();
  return { simulation, out, mirrored };
}

function truth(on) {
  return { yes: on ? 1 : 0, no: on ? 0 : 1 };
}

async function decide(redSignals, conditions, greenSignals = []) {
  const result = await simulate({
    redSignals,
    greenSignals,
    conditions,
    whenTrue: [fixed(D, 1)],
    whenFalse: [fixed(C, 1)],
  });
  return {
    yes: result.simulation.read(result.out, D),
    no: result.simulation.read(result.out, C),
    simulation: result.simulation,
    out: result.out,
  };
}

test("константы Decider.Operation и Decider.Logic не совпадают с арифметическими", () => {
  assert.deepEqual(Object.keys(OP), ["GT", "LT", "EQ", "GTE", "LTE", "NEQ"]);
  assert.deepEqual(Object.keys(Decider.Logic), ["AND", "OR"]);
  for (const name of Object.keys(OP)) {
    assert.equal(OP[name].owner, "decider");
    assert.equal(OP[name].name, name);
    assert.equal(Object.isFrozen(OP[name]), true);
  }
  for (const name of ["AND", "OR"]) {
    assert.equal(Decider.Logic[name].owner, "decider");
    assert.equal(Object.isFrozen(Decider.Logic[name]), true);
  }
  assert.equal(Object.isFrozen(OP), true);
  assert.equal(Object.isFrozen(Decider.Logic), true);
  assert.notEqual(Decider.Logic.AND, Arithmetic.Operation.AND);
  assert.notEqual(Decider.Logic.OR, Arithmetic.Operation.OR);
  assert.equal(OP.AND, undefined);
});

test("конфигурация сравнивающего отклоняется атомарно", () => {
  const circuit = new Circuit();
  const kept = new Constant({ enabled: true, signals: [], red_output: circuit.network("red_kept") });
  circuit.add(kept);
  const each = [cmp(wire(EACH), OP.GT, { constant: 0 })];
  const hole = [cmp(wire(A), OP.EQ, { constant: 0 })];
  hole.length = 2;
  const sparseOut = [fixed(D, 1)];
  sparseOut.length = 2;
  const cases = [
    [null, "invalid-decider-config"],
    [[], "invalid-decider-config"],
    [1, "invalid-decider-config"],
    [base({ sections: [] }), "unsupported-setting"],
    [base({ group: "a" }), "unsupported-setting"],
    [base({ multiplier: 2 }), "unsupported-setting"],
    [base({ note: true }), "invalid-decider-config"],
    [{}, "missing-conditions"],
    [base({ conditions: null }), "invalid-conditions"],
    [base({ conditions: {} }), "invalid-conditions"],
    [base({ conditions: [] }), "invalid-conditions"],
    [base({ conditions: [null] }), "invalid-condition"],
    [base({ conditions: [1] }), "invalid-condition"],
    [base({ conditions: hole }), "invalid-condition"],
    [base({ conditions: [{ ...cmp(wire(A), OP.EQ, { constant: 0 }), logic: AND }] }), "invalid-logic"],
    [base({ conditions: [cmp(wire(A), OP.EQ, { constant: 0 }), { left_operand: wire(B), right_operand: { constant: 0 }, operation: OP.EQ }] }), "missing-logic"],
    [base({ conditions: [{ ...cmp(wire(A), OP.EQ, { constant: 0 }), extra: true }] }), "invalid-condition"],
    [base({ conditions: [{ right_operand: { constant: 0 }, operation: OP.EQ }] }), "missing-operand"],
    [base({ conditions: [{ left_operand: wire(A), operation: OP.EQ }] }), "missing-operand"],
    [base({ conditions: [{ left_operand: wire(A), right_operand: { constant: 0 } }] }), "missing-operation"],
    [base({ conditions: [cmp(5, OP.EQ, { constant: 0 })] }), "invalid-operand"],
    [base({ conditions: [cmp([], OP.EQ, { constant: 0 })] }), "invalid-operand"],
    [base({ conditions: [cmp({ constant: 0, signal: A }, OP.EQ, { constant: 1 })] }), "mixed-operand"],
    [base({ conditions: [cmp({ constant: 0, extra: true }, OP.EQ, { constant: 1 })] }), "invalid-operand"],
    [base({ conditions: [cmp({ constant: "0" }, OP.EQ, { constant: 1 })] }), "invalid-constant"],
    [base({ conditions: [cmp({ constant: 1.5 }, OP.EQ, { constant: 1 })] }), "invalid-constant"],
    [base({ conditions: [cmp({ constant: Number.NaN }, OP.EQ, { constant: 1 })] }), "invalid-constant"],
    [base({ conditions: [cmp({ constant: Number.POSITIVE_INFINITY }, OP.EQ, { constant: 1 })] }), "invalid-constant"],
    [base({ conditions: [cmp({ constant: INT32_MAX + 1 }, OP.EQ, { constant: 1 })] }), "invalid-constant"],
    [base({ conditions: [cmp({ constant: INT32_MIN - 1 }, OP.EQ, { constant: 1 })] }), "invalid-constant"],
    [base({ conditions: [cmp({ constant: 0 }, OP.EQ, { constant: 1 })] }), "invalid-operand"],
    [base({ conditions: [cmp(wire(A), OP.EQ, { constant: 1, extra: true })] }), "invalid-operand"],
    [base({ conditions: [cmp({ red: true, signal: A }, OP.EQ, { constant: 0 })] }), "invalid-operand"],
    [base({ conditions: [cmp({ red: true }, OP.EQ, { constant: 0 })] }), "invalid-operand"],
    [base({ conditions: [cmp({ ...wire(A), extra: true }, OP.EQ, { constant: 0 })] }), "invalid-operand"],
    [base({ conditions: [cmp({ red: 1, green: false, signal: A }, OP.EQ, { constant: 0 })] }), "invalid-mask"],
    [base({ conditions: [cmp({ red: true, green: "false", signal: A }, OP.EQ, { constant: 0 })] }), "invalid-mask"],
    [base({ conditions: [cmp(wire(A), OP.EQ, wire(EACH))] }), "invalid-operand"],
    [base({ conditions: [cmp(wire(A), OP.EQ, wire(EVERY))] }), "invalid-operand"],
    [base({ conditions: [cmp(wire(A), OP.EQ, wire(ANY))] }), "invalid-operand"],
    [base({ conditions: [cmp(wire(OP.EQ), OP.EQ, { constant: 0 })] }), "invalid-signal"],
    [base({ conditions: [cmp(wire(Quality.RARE), OP.EQ, { constant: 0 })] }), "invalid-signal"],
    [base({ conditions: [cmp(wire(selector), OP.EQ, { constant: 0 })] }), "invalid-signal"],
    [base({ conditions: [cmp(wire(A), "EQ", { constant: 0 })] }), "invalid-operation"],
    [base({ conditions: [cmp(wire(A), Arithmetic.Operation.SUM, { constant: 0 })] }), "foreign-operation"],
    [base({ conditions: [cmp(wire(A), Arithmetic.Operation.AND, { constant: 0 })] }), "foreign-operation"],
    [base({ conditions: [cmp(wire(A), new OperationToken("decider", "POWER"), { constant: 0 })] }), "unsupported-operation"],
    [base({ conditions: [cmp(wire(A), AND, { constant: 0 })] }), "unsupported-operation"],
    [base({ conditions: [cmp(wire(A), OR, { constant: 0 })] }), "unsupported-operation"],
    [base({ conditions: [cmp(wire(A), OP.EQ, { constant: 0 }), cmp(wire(B), OP.EQ, { constant: 0 }, "AND")] }), "invalid-logic"],
    [base({ conditions: [cmp(wire(A), OP.EQ, { constant: 0 }), cmp(wire(B), OP.EQ, { constant: 0 }, Arithmetic.Operation.AND)] }), "foreign-operation"],
    [base({ conditions: [cmp(wire(A), OP.EQ, { constant: 0 }), cmp(wire(B), OP.EQ, { constant: 0 }, OP.GT)] }), "invalid-logic"],
    [base({ conditions: [cmp(wire(A), OP.EQ, { constant: 0 }), { left_operand: wire(B), right_operand: { constant: 0 }, operation: OP.EQ, logic: null }] }), "invalid-logic"],
    [base({ when_true: 1 }), "invalid-output"],
    [base({ when_true: {} }), "invalid-output"],
    [base({ when_true: [null] }), "invalid-output"],
    [base({ when_true: [1] }), "invalid-output"],
    [base({ when_true: sparseOut }), "invalid-output"],
    [base({ when_false: "x" }), "invalid-output"],
    [base({ when_true: [{ constant: 1 }] }), "invalid-output"],
    [base({ when_true: [{ signal: coal, constant: 1, red: true }] }), "mixed-output"],
    [base({ when_true: [{ signal: coal, constant: 1, red: true, green: false }] }), "mixed-output"],
    [base({ when_true: [{ signal: EACH, constant: 1, red: true }] }), "invalid-output"],
    [base({ when_true: [{ signal: EVERY, constant: 1, red: true, green: false, extra: true }] }), "invalid-output"],
    [base({ when_true: [{ signal: EVERY, constant: 1, red: 1, green: false }] }), "invalid-mask"],
    [base({ when_true: [{ signal: EVERY, constant: 1.5, red: true, green: false }] }), "invalid-constant"],
    [base({ when_true: [{ signal: coal, constant: 1, extra: true }] }), "invalid-output"],
    [base({ when_true: [{ signal: coal, constant: "5" }] }), "invalid-constant"],
    [base({ when_true: [{ signal: coal, constant: 1.5 }] }), "invalid-constant"],
    [base({ when_true: [{ signal: 123, constant: 1 }] }), "invalid-signal"],
    [base({ when_true: [{ signal: coal, red: true }] }), "invalid-output"],
    [base({ when_true: [{ signal: coal, red: true, green: false, extra: true }] }), "invalid-output"],
    [base({ when_true: [{ signal: coal, red: "true", green: false }] }), "invalid-mask"],
    [base({ when_true: [{ signal: OP.EQ, red: true, green: false }] }), "invalid-signal"],
    [base({ when_true: [{ signal: coal }] }), "invalid-output"],
    [base({ when_true: [fixed(EVERY, 1)] }), "invalid-output"],
    [base({ when_true: [fixed(ANY, 1)] }), "invalid-output"],
    [base({ when_true: [fixed(EACH, 1)] }), "invalid-each"],
    [base({ when_true: [copy(EACH)] }), "invalid-each"],
    [base({ when_true: [{ signal: EACH, constant: 1, red: true, green: false }] }), "invalid-each"],
    [base({ conditions: each, when_true: [copy(EVERY)] }), "invalid-each"],
    [base({ conditions: each, when_true: [{ signal: EVERY, constant: 1, red: true, green: false }] }), "invalid-each"],
    [base({ when_true: [{ signal: EVERY, constant: 1, red: false, green: false }] }), "unsupported-case"],
    [base({ when_true: [{ signal: ANY, constant: 1, red: true, green: false }] }), "unsupported-case"],
    [base({ conditions: each, when_true: [{ signal: ANY, constant: 1, red: true, green: true }] }), "unsupported-case"],
    [base({ conditions: each, when_true: [{ signal: EACH, constant: 1, red: true, green: false }] }), "unsupported-case"],
    [base({ conditions: each, when_true: [copy(coal)] }), "unsupported-case"],
    [base({ conditions: each, when_true: [copy(EACH, false, true)] }), "unsupported-case"],
    [base({ conditions: each, when_true: [copy(EACH, true, true)] }), "unsupported-case"],
    [base({ conditions: [cmp(wire(EACH, true, false), OP.GT, { constant: 0 }), cmp(wire(EACH, false, true), OP.GT, { constant: 0 }, AND)] }), "unsupported-case"],
    [base({ conditions: [cmp(wire(EACH, true, true), OP.GT, { constant: 0 }), cmp(wire(EACH, true, false), OP.GT, { constant: 0 }, AND)] }), "unsupported-case"],
    [base({ conditions: [cmp(wire(EACH), OP.GT, { constant: 0 }), cmp(wire(EACH), OP.LT, { constant: 1 }, OR)] }), "unsupported-case"],
    [base({ conditions: [cmp(wire(EACH), OP.GT, { constant: 0 }), cmp(wire(ANY), OP.GT, { constant: 0 }, AND)] }), "unsupported-case"],
    [base({ conditions: [cmp(wire(ANY), OP.GT, { constant: 0 }), cmp(wire(EVERY), OP.GT, { constant: 0 }, AND)] }), "unsupported-case"],
    [base({ when_true: [fixed(coal, 1), fixed(coal, 2)] }), "unsupported-case"],
    [base({ conditions: each, when_true: [fixed(EACH, 1), copy(EACH)] }), "unsupported-case"],
    [base({ red_input: "red_1" }), "invalid-port"],
    [base({ red_input: OP.EQ }), "invalid-port"],
    [base({ red_input: A }), "invalid-port"],
    [base({ red_input: EACH }), "invalid-port"],
    [base({ red_input: Quality.RARE }), "invalid-port"],
    [base({ red_input: selector }), "invalid-port"],
    [base({ red_input: 0 }), "invalid-port"],
    [base({ red_input: true }), "invalid-port"],
    [base({ green_input: [] }), "invalid-port"],
  ];
  for (const [config, code] of cases) throwsCode(() => new Decider(config), code);
  throwsCode(() => circuit.add(new Decider(base({ red_input: {} }))), "invalid-port");
  assert.deepEqual(circuit.devices, [kept]);
});

test("шесть сравнений на 1, 2 и 3 ловят подмену знака", async () => {
  const expect = {
    1: { GT: false, LT: true, EQ: false, GTE: false, LTE: true, NEQ: true },
    2: { GT: false, LT: false, EQ: true, GTE: true, LTE: true, NEQ: false },
    3: { GT: true, LT: false, EQ: false, GTE: true, LTE: false, NEQ: true },
  };
  for (const value of [1, 2, 3]) {
    for (const name of Object.keys(expect[value])) {
      const got = await decide([count(A, value)], [cmp(wire(A), OP[name], { constant: 2 })]);
      assert.deepEqual(
        { yes: got.yes, no: got.no },
        truth(expect[value][name]),
        `${name} при A=${value}`,
      );
    }
  }
});

test("границы int32 и знак сравнения не сворачиваются в JS-побитовые операции", async () => {
  const samples = [
    [INT32_MAX, OP.GT, INT32_MAX, false],
    [INT32_MAX, OP.GTE, INT32_MAX, true],
    [INT32_MAX, OP.EQ, INT32_MAX, true],
    [INT32_MAX, OP.LT, INT32_MAX, false],
    [INT32_MAX, OP.LTE, INT32_MAX, true],
    [INT32_MAX, OP.NEQ, INT32_MAX, false],
    [INT32_MIN, OP.LT, 0, true],
    [INT32_MIN, OP.GT, INT32_MIN, false],
    [INT32_MIN, OP.NEQ, INT32_MIN, false],
    [INT32_MIN, OP.NEQ, 0, true],
    [-1, OP.LT, 0, true],
    [-2, OP.GT, -3, true],
    [-1, OP.LTE, -1, true],
  ];
  for (const [value, operation, right, on] of samples) {
    const got = await decide(
      [count(A, value)],
      [cmp(wire(A), operation, { constant: right })],
    );
    assert.deepEqual({ yes: got.yes, no: got.no }, truth(on));
  }
});

test("AND теснее OR, null остаётся в выражении", async () => {
  const samples = [
    { signals: [[A, 1], [B, 0], [C, 0]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(wire(B), OP.GT, { constant: 0 }, OR),
      cmp(wire(C), OP.GT, { constant: 0 }, AND),
    ], on: true },
    { signals: [[A, 0], [B, 1], [C, 0]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(wire(B), OP.GT, { constant: 0 }, OR),
      cmp(wire(C), OP.GT, { constant: 0 }, AND),
    ], on: false },
    { signals: [[A, 0], [B, 1], [C, 1]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(wire(B), OP.GT, { constant: 0 }, OR),
      cmp(wire(C), OP.GT, { constant: 0 }, AND),
    ], on: true },
    { signals: [[A, 0], [B, 0], [C, 1]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(wire(B), OP.GT, { constant: 0 }, AND),
      cmp(wire(C), OP.GT, { constant: 0 }, OR),
    ], on: true },
    { signals: [[A, 1], [B, 0], [C, 0]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(wire(B), OP.GT, { constant: 0 }, AND),
      cmp(wire(C), OP.GT, { constant: 0 }, OR),
    ], on: false },
    { signals: [[A, 1]], conditions: [
      cmp(null, OP.EQ, { constant: 1 }),
      cmp(wire(A), OP.EQ, { constant: 1 }, OR),
    ], on: true },
    { signals: [[A, 1]], conditions: [
      cmp(null, OP.EQ, { constant: 1 }),
      cmp(wire(A), OP.EQ, { constant: 1 }, AND),
    ], on: false },
    { signals: [[A, 1]], conditions: [cmp(wire(A), OP.EQ, null)], on: false },
    { signals: [[A, 1], [C, 1]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(null, OP.GT, { constant: 0 }, OR),
      cmp(wire(C), OP.GT, { constant: 0 }, AND),
    ], on: true },
    { signals: [[A, 0], [C, 1]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(null, OP.GT, { constant: 0 }, OR),
      cmp(wire(C), OP.GT, { constant: 0 }, AND),
    ], on: false },
    { signals: [[A, 1], [B, 1], [C, 1]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(wire(B), OP.GT, { constant: 0 }, AND),
      cmp(wire(C), OP.GT, { constant: 0 }, AND),
    ], on: true },
    { signals: [[A, 1], [B, 0], [C, 1]], conditions: [
      cmp(wire(A), OP.GT, { constant: 0 }),
      cmp(wire(B), OP.GT, { constant: 0 }, AND),
      cmp(wire(C), OP.GT, { constant: 0 }, AND),
    ], on: false },
  ];
  for (const sample of samples) {
    const got = await decide(sample.signals.map(([signal, constant]) => count(signal, constant)), sample.conditions);
    assert.deepEqual({ yes: got.yes, no: got.no }, truth(sample.on));
  }
});

test("пустой вход, нулевой канал и отмена цветов читают обычный сигнал как 0", async () => {
  const missingGreater = await decide([], [cmp(wire(A), OP.GT, { constant: 0 })]);
  const missingEqual = await decide([], [cmp(wire(A), OP.EQ, { constant: 0 })]);
  const zeroEqual = await decide([count(A, 0)], [cmp(wire(A), OP.EQ, { constant: 0 })]);
  const blind = await decide([count(A, 5)], [cmp(wire(A, false, false), OP.EQ, { constant: 0 })]);
  const blindGreater = await decide([count(A, 5)], [cmp(wire(A, false, false), OP.GT, { constant: 0 })]);
  const cancelled = await decide(
    [count(A, 4)],
    [cmp(wire(A, true, true), OP.EQ, { constant: 0 })],
    [count(A, -4)],
  );
  assert.deepEqual({ yes: missingGreater.yes, no: missingGreater.no }, truth(false));
  assert.deepEqual({ yes: missingEqual.yes, no: missingEqual.no }, truth(true));
  assert.deepEqual({ yes: zeroEqual.yes, no: zeroEqual.no }, truth(true));
  assert.deepEqual({ yes: blind.yes, no: blind.no }, truth(true));
  assert.deepEqual({ yes: blindGreater.yes, no: blindGreater.no }, truth(false));
  assert.deepEqual({ yes: cancelled.yes, no: cancelled.no }, truth(true));
});

test("маски входа складывают цвета и не подменяют отключённый цвет другим", async () => {
  const greenOnly = await decide(
    [count(A, 5)],
    [cmp(wire(A, false, true), OP.GT, { constant: 0 })],
    [count(B, 4)],
  );
  const redOnly = await decide(
    [count(A, 5)],
    [cmp(wire(A, true, false), OP.GT, { constant: 0 })],
    [count(A, 0)],
  );
  const summed = await decide(
    [count(A, 4)],
    [cmp(wire(A, true, true), OP.GTE, { constant: 9 })],
    [count(A, 5)],
  );
  const over = await decide(
    [count(A, 4)],
    [cmp(wire(A, true, true), OP.GTE, { constant: 10 })],
    [count(A, 5)],
  );
  assert.deepEqual({ yes: greenOnly.yes, no: greenOnly.no }, truth(false));
  assert.deepEqual({ yes: redOnly.yes, no: redOnly.no }, truth(true));
  assert.deepEqual({ yes: summed.yes, no: summed.no }, truth(true));
  assert.deepEqual({ yes: over.yes, no: over.no }, truth(false));
});

test("ветки, копирование и фиксированное количество взаимно исключены для простого условия", async () => {
  const present = await simulate({
    redSignals: [count(A, 5), count(B, 9), count(iron, 15)],
    conditions: [cmp(wire(A), OP.GT, { constant: 0 })],
    whenTrue: [copy(B), fixed(coal, 5), copy(iron), fixed(D, -3)],
    whenFalse: [fixed(C, 5)],
  });
  assert.equal(present.simulation.tick, 1);
  assert.equal(present.simulation.read(present.out, B), 9);
  assert.equal(present.simulation.read(present.out, coal), 5);
  assert.equal(present.simulation.read(present.out, iron), 15);
  assert.equal(present.simulation.read(present.out, D), -3);
  assert.equal(present.simulation.read(present.out, C), 0);
  assert.equal(present.simulation.read(present.mirrored, coal), 5);
  await present.simulation.step();
  assert.equal(present.simulation.tick, 2);
  assert.equal(present.simulation.read(present.out, B), 9);

  const absent = await simulate({
    redSignals: [count(A, 0)],
    conditions: [cmp(wire(A), OP.GT, { constant: 0 })],
    whenTrue: [copy(B)],
    whenFalse: [fixed(C, 5), fixed(B, INT32_MIN)],
  });
  assert.equal(absent.simulation.read(absent.out, B), INT32_MIN);
  assert.equal(absent.simulation.read(absent.out, C), 5);

  const missingCopy = await simulate({
    redSignals: [count(A, 1)],
    conditions: [cmp(wire(A), OP.GT, { constant: 0 })],
    whenTrue: [copy(B)],
    whenFalse: [fixed(B, 5)],
  });
  assert.equal(missingCopy.simulation.present(missingCopy.out).length, 0);

  const created = await simulate({
    redSignals: [count(A, 1)],
    conditions: [cmp(wire(A), OP.GT, { constant: 0 })],
    whenTrue: [fixed(B, 5)],
    whenFalse: null,
  });
  assert.equal(created.simulation.read(created.out, B), 5);

  const blank = await simulate({
    conditions: [cmp(wire(A), OP.EQ, { constant: 0 })],
    whenFalse: null,
  });
  assert.equal(blank.simulation.present(blank.out).length, 0);
  const emptyBranch = await simulate({
    redSignals: [count(A, 1)],
    conditions: [cmp(wire(A), OP.GT, { constant: 0 })],
    whenTrue: [],
    whenFalse: [fixed(C, 4)],
  });
  assert.equal(emptyBranch.simulation.present(emptyBranch.out).length, 0);
  const zeroConstant = await simulate({
    redSignals: [count(A, 1)],
    conditions: [cmp(wire(A), OP.GT, { constant: 0 })],
    whenTrue: [fixed(D, 0)],
  });
  assert.equal(zeroConstant.simulation.present(zeroConstant.out).length, 0);
});

test("копирование B читает R, G, оба цвета и пустую маску", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const green = circuit.network("green_in");
  const redOut = circuit.network("green_red");
  const greenOut = circuit.network("green_green");
  const bothOut = circuit.network("green_both");
  const noneOut = circuit.network("green_none");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: [count(B, 4)] }));
  circuit.add(new Constant({ enabled: true, green_output: green, signals: [count(B, 5)] }));
  const condition = [cmp(wire(D), OP.EQ, { constant: 0 })];
  circuit.add(new Decider({
    red_input: red, green_input: green, green_output: redOut, conditions: condition, when_true: [copy(B, true, false)],
  }));
  circuit.add(new Decider({
    red_input: red, green_input: green, green_output: greenOut, conditions: condition, when_true: [copy(B, false, true)],
  }));
  circuit.add(new Decider({
    red_input: red, green_input: green, green_output: bothOut, conditions: condition, when_true: [copy(B, true, true)],
  }));
  circuit.add(new Decider({
    red_input: red, green_input: green, green_output: noneOut, conditions: condition, when_true: [copy(B, false, false)],
  }));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.read(redOut, B), 4);
  assert.equal(simulation.read(greenOut, B), 5);
  assert.equal(simulation.read(bothOut, B), 9);
  assert.equal(simulation.present(noneOut).length, 0);
});

test("Each фильтрует каналы, суммирует вклады и пишет обе ветки в одном тике", async () => {
  const combined = await simulate({
    redSignals: [count(A, 150), count(B, 50), count(C, 200)],
    conditions: [cmp(wire(EACH), OP.GT, { constant: 100 })],
    whenTrue: [copy(EACH)],
    whenFalse: [copy(EACH)],
  });
  assert.equal(combined.simulation.read(combined.out, A), 150);
  assert.equal(combined.simulation.read(combined.out, C), 200);
  assert.equal(combined.simulation.read(combined.out, B), 50);

  const constants = await simulate({
    redSignals: [count(A, 150), count(B, 50), count(C, 200)],
    conditions: [cmp(wire(EACH), OP.GT, { constant: 100 })],
    whenTrue: [fixed(EACH, 1)],
  });
  assert.equal(constants.simulation.read(constants.out, A), 1);
  assert.equal(constants.simulation.read(constants.out, C), 1);
  assert.equal(constants.simulation.read(constants.out, B), 0);

  const folded = await simulate({
    redSignals: [count(A, 150), count(B, 50), count(C, 200)],
    conditions: [cmp(wire(EACH), OP.GT, { constant: 100 })],
    whenTrue: [fixed(D, 1)],
  });
  assert.equal(folded.simulation.read(folded.out, D), 2);
  assert.equal(folded.simulation.present(folded.out).length, 1);

  const wrapped = await simulate({
    redSignals: [count(A, 150), count(C, 200)],
    conditions: [cmp(wire(EACH), OP.GT, { constant: 100 })],
    whenTrue: [fixed(D, INT32_MAX)],
  });
  assert.equal(wrapped.simulation.read(wrapped.out, D), -2);

  const ranged = await simulate({
    redSignals: [count(iron, 150), count(copper, 50), count(coal, 200)],
    conditions: [
      cmp(wire(EACH), OP.GT, { constant: 100 }),
      cmp(wire(EACH), OP.LT, { constant: 200 }, AND),
    ],
    whenTrue: [copy(EACH)],
    whenFalse: [copy(EACH)],
  });
  assert.equal(ranged.simulation.read(ranged.out, iron), 150);
  assert.equal(ranged.simulation.read(ranged.out, copper), 50);
  assert.equal(ranged.simulation.read(ranged.out, coal), 200);

  const negative = await simulate({
    redSignals: [count(A, 3), count(B, -2)],
    conditions: [cmp(wire(EACH), OP.GT, { constant: 0 })],
    whenTrue: [copy(EACH)],
    whenFalse: [copy(EACH)],
  });
  assert.equal(negative.simulation.read(negative.out, A), 3);
  assert.equal(negative.simulation.read(negative.out, B), -2);

  const empty = await simulate({
    conditions: [cmp(wire(EACH), OP.EQ, { constant: 0 })],
    whenTrue: [copy(EACH)],
    whenFalse: [copy(EACH)],
  });
  assert.equal(empty.simulation.present(empty.out).length, 0);

  const zeroEach = await simulate({
    redSignals: [count(A, 3)],
    conditions: [cmp(wire(EACH), OP.GT, { constant: 0 })],
    whenTrue: [fixed(EACH, 0)],
  });
  assert.equal(zeroEach.simulation.present(zeroEach.out).length, 0);

  const fluid = await simulate({
    redSignals: [count(water, 20), count(A, 5)],
    conditions: [cmp(wire(EACH), OP.GT, { constant: 10 })],
    whenTrue: [copy(EACH)],
  });
  assert.equal(fluid.simulation.read(fluid.out, water), 20);
  assert.equal(fluid.simulation.read(fluid.out, A), 0);
});

test("Each не исключает правый сигнал и принимает обычное условие с другой маской", async () => {
  const included = await simulate({
    redSignals: [count(A, 1), count(B, 10)],
    conditions: [cmp(wire(EACH), OP.GTE, wire(B))],
    whenTrue: [copy(EACH)],
  });
  assert.equal(included.simulation.read(included.out, A), 0);
  assert.equal(included.simulation.read(included.out, B), 10);

  const otherMask = await simulate({
    redSignals: [count(A, 150), count(B, 50)],
    greenSignals: [count(C, 5)],
    conditions: [
      cmp(wire(EACH, true, false), OP.GT, { constant: 100 }),
      cmp(wire(C, false, true), OP.GT, { constant: 0 }, AND),
    ],
    whenTrue: [copy(EACH, true, false)],
  });
  assert.equal(otherMask.simulation.read(otherMask.out, A), 150);
  assert.equal(otherMask.simulation.read(otherMask.out, B), 0);
  assert.equal(otherMask.simulation.read(otherMask.out, C), 0);

  const otherFails = await simulate({
    redSignals: [count(A, 150), count(B, 50)],
    conditions: [
      cmp(wire(EACH), OP.GT, { constant: 100 }),
      cmp(wire(C), OP.GT, { constant: 0 }, AND),
    ],
    whenTrue: [copy(EACH)],
    whenFalse: [copy(EACH)],
  });
  assert.equal(otherFails.simulation.read(otherFails.out, A), 150);
  assert.equal(otherFails.simulation.read(otherFails.out, B), 50);
  assert.equal(otherFails.simulation.read(otherFails.out, C), 0);

  const sameMask = await simulate({
    redSignals: [count(A, 150), count(C, 200), count(D, 1)],
    conditions: [
      cmp(wire(EACH), OP.GT, { constant: 100 }),
      cmp(wire(D), OP.EQ, { constant: 1 }, AND),
    ],
    whenTrue: [copy(EACH)],
  });
  assert.equal(sameMask.simulation.read(sameMask.out, A), 150);
  assert.equal(sameMask.simulation.read(sameMask.out, C), 200);
  assert.equal(sameMask.simulation.read(sameMask.out, D), 0);

  const cancelled = await simulate({
    redSignals: [count(A, 5), count(B, 8)],
    greenSignals: [count(A, -5)],
    conditions: [cmp(wire(EACH, true, true), OP.GT, { constant: 0 })],
    whenTrue: [copy(EACH, true, true)],
  });
  assert.equal(cancelled.simulation.read(cancelled.out, A), 0);
  assert.equal(cancelled.simulation.read(cancelled.out, B), 8);
});

test("качество и предмет не сливаются в одном Each", async () => {
  const rare = spaceIron.withQuality(Quality.RARE);
  const each = space.Meta.signal_each;
  const result = await simulate({
    profile: "space-age",
    redSignals: [count(spaceIron, 150), count(rare, 40)],
    conditions: [cmp(wire(each), OP.GT, { constant: 100 })],
    whenTrue: [copy(each)],
    whenFalse: [copy(each)],
  });
  assert.equal(result.simulation.read(result.out, spaceIron), 150);
  assert.equal(result.simulation.read(result.out, rare), 40);
});

test("Everything и Anything на пустом и заполненном входе", async () => {
  const everythingEmpty = await decide([], [cmp(wire(EVERY), OP.GT, { constant: 0 })]);
  const anythingEmpty = await decide([], [cmp(wire(ANY), OP.GT, { constant: 0 })]);
  assert.deepEqual({ yes: everythingEmpty.yes, no: everythingEmpty.no }, truth(true));
  assert.deepEqual({ yes: anythingEmpty.yes, no: anythingEmpty.no }, truth(false));

  const passed = await simulate({
    redSignals: [count(A, 1), count(B, 150), count(C, 50)],
    conditions: [cmp(wire(A), OP.EQ, { constant: 1 })],
    whenTrue: [copy(EVERY)],
  });
  assert.deepEqual(listed(passed.simulation.present(passed.out)), [
    ["virtual", "signal-A", "normal", 1],
    ["virtual", "signal-B", "normal", 150],
    ["virtual", "signal-C", "normal", 50],
  ]);

  const notAll = await decide(
    [count(A, 1), count(B, 150), count(C, 50)],
    [cmp(wire(EVERY), OP.GT, { constant: 100 })],
  );
  assert.deepEqual({ yes: notAll.yes, no: notAll.no }, truth(false));

  const all = await decide(
    [count(A, 2), count(B, 3)],
    [cmp(wire(EVERY), OP.GT, { constant: 0 })],
  );
  assert.deepEqual({ yes: all.yes, no: all.no }, truth(true));

  const excluded = await decide(
    [count(A, 5), count(B, 1)],
    [cmp(wire(EVERY), OP.GT, wire(B))],
  );
  assert.deepEqual({ yes: excluded.yes, no: excluded.no }, truth(true));

  const vacuous = await decide(
    [count(B, 1)],
    [cmp(wire(EVERY), OP.GT, { constant: 3 })],
  );
  const vacuousExcluded = await decide(
    [count(B, 1)],
    [cmp(wire(EVERY), OP.GT, wire(B))],
  );
  assert.deepEqual({ yes: vacuous.yes, no: vacuous.no }, truth(false));
  assert.deepEqual({ yes: vacuousExcluded.yes, no: vacuousExcluded.no }, truth(true));

  const anythingExcluded = await decide(
    [count(A, 1), count(B, 10)],
    [cmp(wire(ANY), OP.GT, { constant: 5 })],
  );
  const anythingWithoutRight = await decide(
    [count(A, 1), count(B, 10)],
    [cmp(wire(ANY), OP.GT, wire(B))],
  );
  const onlyExcluded = await decide(
    [count(B, 10)],
    [cmp(wire(ANY), OP.GT, wire(B))],
  );
  assert.deepEqual({ yes: anythingExcluded.yes, no: anythingExcluded.no }, truth(true));
  assert.deepEqual({ yes: anythingWithoutRight.yes, no: anythingWithoutRight.no }, truth(false));
  assert.deepEqual({ yes: onlyExcluded.yes, no: onlyExcluded.no }, truth(false));

  const redAnything = await decide(
    [count(A, 1)],
    [
      cmp(wire(ANY, true, false), OP.GT, { constant: 0 }),
      cmp(wire(ANY, false, true), OP.GT, { constant: 0 }, AND),
    ],
  );
  const either = await decide(
    [count(A, 1)],
    [
      cmp(wire(ANY, true, false), OP.GT, { constant: 0 }),
      cmp(wire(ANY, false, true), OP.GT, { constant: 0 }, OR),
    ],
  );
  assert.deepEqual({ yes: redAnything.yes, no: redAnything.no }, truth(false));
  assert.deepEqual({ yes: either.yes, no: either.no }, truth(true));
});

test("выход Anything допустим, но непустой выбор не публикует тик", async () => {
  const empty = await simulate({
    conditions: [cmp(wire(EVERY), OP.GT, { constant: 0 })],
    whenTrue: [copy(ANY)],
  });
  assert.equal(empty.simulation.tick, 1);
  assert.equal(empty.simulation.present(empty.out).length, 0);

  const eachIdle = new Decider({
    conditions: [cmp(wire(EACH), OP.GT, { constant: 10 })],
    when_true: [copy(ANY)],
    when_false: [copy(EACH)],
  });
  const eachBusy = new Decider({
    conditions: [cmp(wire(EACH), OP.GT, { constant: 10 })],
    when_true: [copy(ANY)],
  });
  assert.equal(typeof eachIdle.compute, "function");
  assert.equal(typeof eachBusy.compute, "function");

  const idle = await simulate({
    redSignals: [count(A, 1)],
    conditions: [cmp(wire(EACH), OP.GT, { constant: 10 })],
    whenTrue: [copy(ANY)],
    whenFalse: [copy(EACH)],
  });
  assert.equal(idle.simulation.read(idle.out, A), 1);

  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const out = circuit.network("green_out");
  const other = circuit.network("green_other");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: [count(A, 1)] }));
  circuit.add(new Decider({
    red_input: red,
    green_output: other,
    conditions: [cmp(wire(A), OP.GT, { constant: 0 })],
    when_true: [fixed(C, 7)],
  }));
  circuit.add(new Decider({
    red_input: red,
    green_output: out,
    conditions: [cmp(wire(A), OP.GT, { constant: 0 })],
    when_true: [copy(ANY)],
  }));
  const simulation = await circuit.createSimulation();
  await assert.rejects(simulation.step(), (error) => {
    assert.equal(error.name, "RuntimeError");
    assert.equal(error instanceof RuntimeError, true);
    assert.equal(error.code, "unsupported-case");
    return true;
  });
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 1);
  assert.equal(simulation.read(other, C), 0);
  assert.equal(simulation.read(out, A), 0);

  const eachCircuit = new Circuit();
  const eachRed = eachCircuit.network("red_in");
  const eachOut = eachCircuit.network("green_out");
  eachCircuit.add(new Constant({ enabled: true, red_output: eachRed, signals: [count(A, 20)] }));
  eachCircuit.add(new Decider({
    red_input: eachRed,
    green_output: eachOut,
    conditions: [cmp(wire(EACH), OP.GT, { constant: 10 })],
    when_true: [copy(ANY)],
  }));
  const eachSimulation = await eachCircuit.createSimulation();
  await assert.rejects(eachSimulation.step(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  assert.equal(eachSimulation.tick, 0);
  assert.equal(eachSimulation.read(eachOut, A), 0);
});

test("повтор канала в одном тике не публикует границу", async () => {
  const separate = await simulate({
    redSignals: [count(A, 1), count(B, 2)],
    conditions: [cmp(wire(A), OP.EQ, { constant: 1 })],
    whenTrue: [copy(EVERY), fixed(D, 4)],
  });
  assert.equal(separate.simulation.read(separate.out, A), 1);
  assert.equal(separate.simulation.read(separate.out, B), 2);
  assert.equal(separate.simulation.read(separate.out, D), 4);

  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const out = circuit.network("green_out");
  const other = circuit.network("green_other");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: [count(A, 1), count(B, 2)] }));
  circuit.add(new Decider({
    green_output: other,
    conditions: [cmp(wire(D), OP.EQ, { constant: 0 })],
    when_true: [fixed(C, 3)],
  }));
  circuit.add(new Decider({
    red_input: red,
    green_output: out,
    conditions: [cmp(wire(A), OP.EQ, { constant: 1 })],
    when_true: [copy(EVERY), fixed(A, 4)],
  }));
  const simulation = await circuit.createSimulation();
  await assert.rejects(simulation.step(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 1);
  assert.equal(simulation.read(other, C), 0);

  const eachCircuit = new Circuit();
  const eachRed = eachCircuit.network("red_in");
  const eachOut = eachCircuit.network("green_out");
  eachCircuit.add(new Constant({
    enabled: true,
    red_output: eachRed,
    signals: [count(A, 150), count(B, 50)],
  }));
  eachCircuit.add(new Decider({
    red_input: eachRed,
    green_output: eachOut,
    conditions: [cmp(wire(EACH), OP.GT, { constant: 100 })],
    when_true: [fixed(D, 1)],
    when_false: [fixed(D, 1)],
  }));
  const eachSimulation = await eachCircuit.createSimulation();
  await assert.rejects(eachSimulation.step(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  assert.equal(eachSimulation.tick, 0);
  assert.equal(eachSimulation.read(eachOut, D), 0);
});

test("профиль операндов и выходов проверяется при регистрации", async () => {
  const each = space.Meta.signal_each;
  const matching = new Circuit({ profile: "space-age" });
  const red = matching.network("red_in");
  const out = matching.network("green_out");
  matching.add(new Constant({
    enabled: true,
    red_output: red,
    signals: [count(spaceIron, 3)],
  }));
  matching.add(new Decider({
    red_input: red,
    green_output: out,
    conditions: [cmp(wire(spaceIron), OP.GT, { constant: 0 })],
    when_true: [fixed(spaceIron, 5)],
  }));
  const simulation = await matching.createSimulation();
  await simulation.step();
  assert.equal(simulation.read(out, spaceIron), 5);

  const rejected = new Circuit({ profile: "space-age" });
  const wireOut = rejected.network("red_out");
  throwsCode(() => rejected.add(new Decider({
    red_output: wireOut,
    conditions: [cmp(wire(A), OP.EQ, { constant: 0 })],
  })), "wrong-profile");
  throwsCode(() => rejected.add(new Decider({
    red_output: wireOut,
    conditions: [cmp(wire(spaceIron), OP.EQ, wire(A))],
  })), "wrong-profile");
  throwsCode(() => rejected.add(new Decider({
    red_output: wireOut,
    conditions: [cmp(wire(spaceIron), OP.EQ, { constant: 0 })],
    when_true: [fixed(A, 1)],
  })), "wrong-profile");
  throwsCode(() => rejected.add(new Decider({
    red_output: wireOut,
    conditions: [cmp(wire(EACH), OP.GT, { constant: 0 })],
    when_true: [fixed(spaceIron, 1)],
  })), "wrong-profile");
  throwsCode(() => rejected.add(new Decider({
    red_output: wireOut,
    conditions: [cmp(wire(each), OP.GT, { constant: 0 })],
    when_true: [fixed(EACH, 1)],
  })), "wrong-profile");
  rejected.add(new Decider({
    conditions: [cmp(null, OP.EQ, null)],
  }));
  rejected.add(new Decider({
    conditions: [cmp(wire(spaceIron), OP.EQ, { constant: 0 })],
    when_true: null,
  }));
  assert.equal(rejected.devices.length, 2);
});
