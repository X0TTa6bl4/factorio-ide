import assert from "node:assert/strict";
import test from "node:test";
import {
  Arithmetic,
  Circuit,
  Constant,
  OperationToken,
  Quality,
  RuntimeError,
  Signal,
  openProfile,
} from "../../../src/index.js";
import { INT32_MAX, INT32_MIN } from "../../../src/int32.js";
import { throwsCode } from "../signals/support.mjs";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;
const D = Signal.Signals.signal_D;
const SUM = Arithmetic.Operation.SUM;
const OPS = Arithmetic.Operation;
const space = openProfile("space-age").tree;
const iron = space.Intermediate.iron_plate;
const selector = space.Unsorted.signal_any_quality;

function signal(signal, red = true, green = false) {
  return { red, green, signal };
}

function base(extra = {}) {
  return {
    left_operand: { constant: 1 },
    right_operand: { constant: 2 },
    operation: SUM,
    ...extra,
  };
}

test("константы Arithmetic.Operation покрывают игровые операции и не исполняют ^ как XOR", () => {
  const names = ["SUM", "SUB", "MUL", "DIV", "MOD", "POW", "SHL", "SHR", "AND", "OR", "XOR"];
  assert.deepEqual(Object.keys(OPS), names);
  for (const name of names) {
    assert.equal(OPS[name].owner, "arithmetic");
    assert.equal(OPS[name].name, name);
    assert.equal(Object.isFrozen(OPS[name]), true);
  }
  assert.equal(Object.isFrozen(OPS), true);
  assert.equal(OPS.POW.name, "POW");
  assert.notEqual(OPS.POW, OPS.XOR);
});

test("арифметическая конфигурация отклоняется атомарно", () => {
  const circuit = new Circuit();
  const kept = new Constant({ enabled: true, signals: [], red_output: circuit.network("red_kept") });
  circuit.add(kept);
  const cases = [
    [null, "invalid-arithmetic-config"],
    [[], "invalid-arithmetic-config"],
    [1, "invalid-arithmetic-config"],
    [base({ sections: [] }), "unsupported-setting"],
    [base({ group: "a" }), "unsupported-setting"],
    [base({ multiplier: 2 }), "unsupported-setting"],
    [base({ note: true }), "invalid-arithmetic-config"],
    [{ right_operand: { constant: 1 }, operation: SUM }, "missing-operand"],
    [{ left_operand: { constant: 1 }, operation: SUM }, "missing-operand"],
    [{ left_operand: { constant: 1 }, right_operand: { constant: 2 } }, "missing-operation"],
    [base({ left_operand: 5 }), "invalid-operand"],
    [base({ left_operand: [1] }), "invalid-operand"],
    [base({ right_operand: null, left_operand: { constant: 1, red: true, green: false, signal: A } }), "mixed-operand"],
    [base({ left_operand: { constant: 1, extra: true } }), "invalid-operand"],
    [base({ left_operand: { constant: "5" } }), "invalid-constant"],
    [base({ left_operand: { constant: 1.5 } }), "invalid-constant"],
    [base({ left_operand: { constant: Number.NaN } }), "invalid-constant"],
    [base({ left_operand: { constant: INT32_MAX + 1 } }), "invalid-constant"],
    [base({ left_operand: { constant: INT32_MIN - 1 } }), "invalid-constant"],
    [base({ left_operand: { signal: A } }), "invalid-operand"],
    [base({ left_operand: { red: true } }), "invalid-operand"],
    [base({ left_operand: { green: false } }), "invalid-operand"],
    [base({ left_operand: { red: true, green: false, signal: A, extra: true } }), "invalid-operand"],
    [base({ left_operand: { red: 1, green: false, signal: A } }), "invalid-mask"],
    [base({ left_operand: { red: true, green: "false", signal: A } }), "invalid-mask"],
    [base({ left_operand: signal(Signal.Meta.signal_anything) }), "unsupported-mode"],
    [base({ left_operand: signal(Signal.Meta.signal_everything) }), "unsupported-mode"],
    [base({ right_operand: signal(Signal.Meta.signal_anything) }), "unsupported-mode"],
    [base({ left_operand: signal(SUM) }), "invalid-signal"],
    [base({ left_operand: signal(Quality.RARE) }), "invalid-signal"],
    [base({ operation: "SUM" }), "invalid-operation"],
    [base({ operation: new OperationToken("decider", "SUM") }), "foreign-operation"],
    [base({ operation: new OperationToken("arithmetic", "POWER") }), "unsupported-operation"],
    [base({ return: Signal.Meta.signal_each }), "invalid-each"],
    [base({ return: Signal.Meta.signal_anything }), "unsupported-mode"],
    [base({ return: Signal.Meta.signal_everything }), "unsupported-mode"],
    [base({
      left_operand: signal(Signal.Meta.signal_each),
      right_operand: signal(Signal.Meta.signal_each, false, true),
    }), "invalid-each"],
    [base({
      left_operand: signal(Signal.Meta.signal_each),
      right_operand: signal(A, false, true),
    }), "unsupported-case"],
    [base({
      left_operand: signal(A, true, true),
      right_operand: signal(Signal.Meta.signal_each, true, false),
    }), "unsupported-case"],
    [base({ left_operand: { constant: 5, red: false } }), "mixed-operand"],
    [base({ left_operand: { constant: Number.POSITIVE_INFINITY } }), "invalid-constant"],
    [base({ right_operand: { constant: Number.NEGATIVE_INFINITY } }), "invalid-constant"],
    [base({ return: 123 }), "invalid-return"],
    [base({ return: SUM }), "invalid-return"],
    [base({ return: "signal-B" }), "invalid-signal"],
    [base({ red_input: "red_1" }), "invalid-port"],
    [base({ red_input: SUM }), "invalid-port"],
    [base({ red_input: A }), "invalid-port"],
    [base({ red_input: Signal.Meta.signal_each }), "invalid-port"],
    [base({ red_input: Quality.RARE }), "invalid-port"],
    [base({ red_input: selector }), "invalid-port"],
    [base({ red_input: 0 }), "invalid-port"],
    [base({ red_input: true }), "invalid-port"],
    [base({ red_input: [] }), "invalid-port"],
  ];
  for (const [config, code] of cases) throwsCode(() => new Arithmetic(config), code);
  throwsCode(() => circuit.add(new Arithmetic(base({
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: signal(Signal.Meta.signal_each),
  }))), "invalid-each");
  throwsCode(() => circuit.add(new Arithmetic(base({
    left_operand: signal(Signal.Meta.signal_each, true, false),
    right_operand: signal(A, true, true),
  }))), "unsupported-case");
  const plain = new Arithmetic(base({ red_input: {} }));
  throwsCode(() => circuit.add(plain), "invalid-port");
  assert.deepEqual(circuit.devices, [kept]);
});

test("профиль операнда и выхода проверяется при регистрации", async () => {
  const matching = new Circuit({ profile: "space-age" });
  const red = matching.network("red_1");
  const green = matching.network("green_1");
  matching.add(new Constant({
    enabled: true,
    red_output: red,
    signals: [{ signal: iron, constant: 3 }],
  }));
  matching.add(new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: signal(iron),
    right_operand: { constant: 2 },
    operation: SUM,
    return: iron,
  }));
  const simulation = await matching.createSimulation();
  assert.equal(simulation.read(green, iron), 0);
  await simulation.step();
  assert.equal(simulation.read(green, iron), 5);

  const rejected = new Circuit({ profile: "space-age" });
  const wire = rejected.network("red_1");
  throwsCode(() => rejected.add(new Arithmetic({
    red_output: wire,
    left_operand: signal(A),
    right_operand: { constant: 1 },
    operation: SUM,
    return: iron,
  })), "wrong-profile");
  throwsCode(() => rejected.add(new Arithmetic({
    red_output: wire,
    left_operand: { constant: 1 },
    right_operand: signal(A),
    operation: SUM,
    return: iron,
  })), "wrong-profile");
  throwsCode(() => rejected.add(new Arithmetic({
    red_output: wire,
    left_operand: { constant: 1 },
    right_operand: { constant: 2 },
    operation: SUM,
    return: A,
  })), "wrong-profile");
  rejected.add(new Arithmetic({
    left_operand: null,
    right_operand: signal(iron),
    operation: SUM,
    return: null,
  }));
  rejected.add(new Arithmetic({
    left_operand: null,
    right_operand: null,
    operation: SUM,
  }));
  assert.equal(rejected.devices.length, 2);
  assert.equal(rejected.network("red_1"), wire);
});

test("сложение читает маски, константу и пустой операнд", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const bothOut = circuit.network("red_both");
  const greenConst = circuit.network("green_const");
  const greenEmpty = circuit.network("green_empty");
  const greenRight = circuit.network("green_right");
  const greenReturn = circuit.network("green_return");
  const greenMask = circuit.network("green_mask");
  const greenSwap = circuit.network("green_swap");
  const greenNull = circuit.network("green_null");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: [{ signal: A, constant: 3 }] }));
  circuit.add(new Constant({ enabled: true, green_output: green, signals: [{ signal: C, constant: 4 }] }));
  const sum = new Arithmetic({
    red_input: red,
    green_input: green,
    red_output: bothOut,
    green_output: green,
    left_operand: { red: true, green: true, signal: A },
    right_operand: signal(C, false, true),
    operation: SUM,
    return: B,
  });
  const constants = new Arithmetic({
    green_output: greenConst,
    left_operand: { constant: INT32_MAX },
    right_operand: { constant: 1 },
    operation: SUM,
    return: C,
  });
  const empty = new Arithmetic({
    red_input: null,
    green_output: greenEmpty,
    left_operand: null,
    right_operand: { constant: 5 },
    operation: SUM,
    return: B,
  });
  const rightNull = new Arithmetic({
    green_output: greenRight,
    left_operand: { constant: 4 },
    right_operand: null,
    operation: SUM,
    return: B,
  });
  const noReturn = new Arithmetic({
    left_operand: { constant: 2 },
    right_operand: { constant: 3 },
    operation: SUM,
    green_output: greenReturn,
  });
  const masked = new Arithmetic({
    red_input: red,
    green_output: greenMask,
    left_operand: { red: false, green: false, signal: A },
    right_operand: { constant: 5 },
    operation: SUM,
    return: B,
  });
  const swapped = new Arithmetic({
    red_input: red,
    green_output: greenSwap,
    left_operand: { constant: 2 },
    right_operand: signal(A),
    operation: SUM,
    return: B,
  });
  const explicitNull = new Arithmetic({
    green_output: greenNull,
    left_operand: { constant: 1 },
    right_operand: { constant: 1 },
    operation: SUM,
    return: null,
  });
  circuit.add(sum);
  circuit.add(constants);
  circuit.add(empty);
  circuit.add(rightNull);
  circuit.add(noReturn);
  circuit.add(masked);
  circuit.add(swapped);
  circuit.add(explicitNull);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.read(green, B), 7);
  assert.equal(simulation.read(bothOut, B), 7);
  assert.equal(simulation.read(greenConst, C), INT32_MIN);
  assert.equal(simulation.read(greenEmpty, B), 0);
  assert.equal(simulation.read(greenRight, B), 0);
  assert.equal(simulation.read(greenReturn, B), 0);
  assert.equal(simulation.read(greenMask, B), 5);
  assert.equal(simulation.read(greenSwap, B), 5);
  assert.equal(simulation.read(greenNull, B), 0);
  assert.equal(simulation.device(empty).output.green.length, 0);
  assert.equal(simulation.device(noReturn).output.green.length, 0);
});

function listed(entries) {
  return entries.map((entry) => [entry.signal.type, entry.signal.name, entry.signal.quality, entry.constant]);
}

function wrap(value) {
  return Number(BigInt.asIntN(32, value));
}

function model(operation, left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  if (operation.name === "SUM") return wrap(a + b);
  if (operation.name === "SUB") return wrap(a - b);
  if (operation.name === "MUL") return wrap(a * b);
  if (operation.name === "DIV") return Number(a / b);
  if (operation.name === "MOD") return Number(a % b);
  if (operation.name === "AND") return wrap(a & b);
  if (operation.name === "OR") return wrap(a | b);
  if (operation.name === "XOR") return wrap(a ^ b);
  if (operation.name === "SHL") return wrap(a << b);
  if (operation.name === "SHR") return Number(a >> b);
  throw new Error(`нет оракула ${operation.name}`);
}

async function runConstants(rows) {
  const circuit = new Circuit();
  const outputs = rows.map((_, index) => circuit.network(`green_${index}`));
  rows.forEach((row, index) => {
    circuit.add(new Arithmetic({
      green_output: outputs[index],
      left_operand: { constant: row.left },
      right_operand: { constant: row.right },
      operation: row.operation,
      return: B,
    }));
  });
  const simulation = await circuit.createSimulation();
  await simulation.step();
  rows.forEach((row, index) => {
    assert.equal(
      simulation.read(outputs[index], B),
      row.expected,
      `${row.operation.name} ${row.left} ${row.right}`,
    );
  });
  return simulation;
}

test("литералы матрицы дают проектные int32-результаты и не путают степень с XOR", async () => {
  const max = INT32_MAX;
  const min = INT32_MIN;
  await runConstants([
    { left: 7, right: 3, operation: OPS.SUM, expected: 10 },
    { left: 7, right: 3, operation: OPS.SUB, expected: 4 },
    { left: 7, right: 3, operation: OPS.MUL, expected: 21 },
    { left: 7, right: 3, operation: OPS.DIV, expected: 2 },
    { left: 7, right: 3, operation: OPS.MOD, expected: 1 },
    { left: 2, right: 3, operation: OPS.POW, expected: 8 },
    { left: 2, right: 3, operation: OPS.XOR, expected: 1 },
    { left: -21, right: 10, operation: OPS.DIV, expected: -2 },
    { left: -13, right: 3, operation: OPS.MOD, expected: -1 },
    { left: -13, right: -3, operation: OPS.MOD, expected: -1 },
    { left: 13, right: -3, operation: OPS.MOD, expected: 1 },
    { left: -8, right: 1, operation: OPS.SHR, expected: -4 },
    { left: 6, right: 3, operation: OPS.AND, expected: 2 },
    { left: 6, right: 3, operation: OPS.OR, expected: 7 },
    { left: 6, right: 3, operation: OPS.XOR, expected: 5 },
    { left: 3, right: 2, operation: OPS.SHL, expected: 12 },
    { left: max, right: 1, operation: OPS.SUM, expected: min },
    { left: min, right: 1, operation: OPS.SUB, expected: max },
    { left: max, right: max, operation: OPS.MUL, expected: 1 },
    { left: max, right: 2, operation: OPS.MUL, expected: -2 },
    { left: min, right: -1, operation: OPS.MUL, expected: min },
    { left: 65537, right: 65537, operation: OPS.MUL, expected: 131073 },
    { left: 1, right: 2, operation: OPS.DIV, expected: 0 },
    { left: -5, right: 2, operation: OPS.DIV, expected: -2 },
    { left: 5, right: -2, operation: OPS.DIV, expected: -2 },
    { left: -5, right: -2, operation: OPS.DIV, expected: 2 },
    { left: min, right: 2, operation: OPS.DIV, expected: -1073741824 },
    { left: min, right: -2, operation: OPS.DIV, expected: 1073741824 },
    { left: 1, right: 31, operation: OPS.SHL, expected: min },
    { left: min, right: 31, operation: OPS.SHR, expected: -1 },
    { left: -1, right: 1, operation: OPS.AND, expected: 1 },
    { left: 2, right: 30, operation: OPS.POW, expected: 1073741824 },
    { left: -2, right: 31, operation: OPS.POW, expected: min },
    { left: -3, right: 5, operation: OPS.POW, expected: -243 },
    { left: -3, right: 6, operation: OPS.POW, expected: 729 },
    { left: 0, right: 5, operation: OPS.POW, expected: 0 },
    { left: 1, right: max, operation: OPS.POW, expected: 1 },
    { left: -1, right: max, operation: OPS.POW, expected: -1 },
    { left: -1, right: 2, operation: OPS.POW, expected: 1 },
    { left: -1, right: 3, operation: OPS.POW, expected: -1 },
    { left: 5, right: 1, operation: OPS.POW, expected: 5 },
  ]);
});

test("знаки и границы сходятся с независимым BigInt-оракулом", async () => {
  const values = [-21, -8, -1, 0, 1, 3, 7, INT32_MAX, INT32_MIN];
  const rows = [];
  for (const operation of [OPS.SUM, OPS.SUB, OPS.MUL, OPS.AND, OPS.OR, OPS.XOR]) {
    for (const left of values) {
      for (const right of values) rows.push({ left, right, operation, expected: model(operation, left, right) });
    }
  }
  for (const operation of [OPS.DIV, OPS.MOD]) {
    for (const left of values) {
      for (const right of values) {
        if (right === 0 || (left === INT32_MIN && right === -1)) continue;
        rows.push({ left, right, operation, expected: model(operation, left, right) });
      }
    }
  }
  for (const operation of [OPS.SHL, OPS.SHR]) {
    for (const left of [-8, -1, 1, 3, INT32_MAX, INT32_MIN]) {
      for (const right of [0, 1, 2, 31]) {
        rows.push({ left, right, operation, expected: model(operation, left, right) });
      }
    }
  }
  const token = new OperationToken("arithmetic", "SUB");
  rows.push({ left: 9, right: 4, operation: token, expected: 5 });
  await runConstants(rows);
});

test("спорная числовая ветвь не публикует шаг", async () => {
  const cases = [
    [7, 0, OPS.DIV],
    [0, 0, OPS.DIV],
    [INT32_MIN, -1, OPS.DIV],
    [7, 0, OPS.MOD],
    [INT32_MIN, -1, OPS.MOD],
    [2, 0, OPS.POW],
    [0, 0, OPS.POW],
    [2, -1, OPS.POW],
    [-1, INT32_MIN, OPS.POW],
    [2, 31, OPS.POW],
    [2, 32, OPS.POW],
    [3, 20, OPS.POW],
    [-8, -1, OPS.SHR],
    [1, 32, OPS.SHL],
    [3, -1, OPS.SHL],
    [-100, 5, OPS.POW],
  ];
  for (const [left, right, operation] of cases) {
    const circuit = new Circuit();
    const red = circuit.network("red_in");
    const green = circuit.network("green_out");
    const other = circuit.network("green_other");
    circuit.add(new Constant({
      enabled: true,
      red_output: red,
      signals: [{ signal: A, constant: 3 }],
    }));
    circuit.add(new Arithmetic({
      green_output: other,
      left_operand: { constant: 2 },
      right_operand: { constant: 3 },
      operation: OPS.SUM,
      return: C,
    }));
    circuit.add(new Arithmetic({
      red_input: red,
      green_output: green,
      left_operand: { constant: left },
      right_operand: { constant: right },
      operation,
      return: B,
    }));
    const simulation = await circuit.createSimulation();
    await assert.rejects(simulation.step(), (error) => {
      assert.equal(error.name, "RuntimeError");
      assert.equal(error instanceof RuntimeError, true);
      assert.equal(error.code, "unsupported-case");
      return true;
    });
    assert.equal(simulation.tick, 0);
    assert.equal(simulation.read(red, A), 3);
    assert.equal(simulation.read(green, B), 0);
    assert.equal(simulation.read(other, C), 0);
    assert.equal(simulation.present(green).length, 0);
  }
});

test("невыбранный выход и пустой Each не вычисляют спорную ветвь", async () => {
  const circuit = new Circuit();
  const quiet = circuit.network("green_quiet");
  const empty = circuit.network("green_empty");
  circuit.add(new Arithmetic({
    green_output: quiet,
    left_operand: { constant: 7 },
    right_operand: { constant: 0 },
    operation: OPS.DIV,
  }));
  circuit.add(new Arithmetic({
    green_output: empty,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 0 },
    operation: OPS.DIV,
    return: Signal.Meta.signal_each,
  }));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.equal(simulation.tick, 1);
  assert.equal(simulation.present(quiet).length, 0);
  assert.equal(simulation.present(empty).length, 0);
});

test("маски, отсутствующий канал и константы читаются по проектной модели", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const green = circuit.network("green_in");
  const sumOut = circuit.network("green_sum");
  const missingOut = circuit.network("green_missing");
  const zeroOut = circuit.network("green_zero");
  const constOut = circuit.network("green_const");
  const cancelOut = circuit.network("green_cancel");
  circuit.add(new Constant({
    enabled: true,
    red_output: red,
    signals: [{ signal: A, constant: 10 }, { signal: B, constant: 4 }, { signal: C, constant: 0 }],
  }));
  circuit.add(new Constant({
    enabled: true,
    green_output: green,
    signals: [{ signal: A, constant: 3 }, { signal: C, constant: 7 }],
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: sumOut,
    left_operand: signal(A),
    right_operand: { red: true, green: true, signal: A },
    operation: OPS.SUM,
    return: D,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: missingOut,
    left_operand: signal(D),
    right_operand: { constant: 5 },
    operation: OPS.SUM,
    return: B,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: zeroOut,
    left_operand: signal(C),
    right_operand: { constant: 5 },
    operation: OPS.SUM,
    return: B,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: constOut,
    left_operand: { constant: 2 },
    right_operand: { constant: 3 },
    operation: OPS.SUM,
    return: B,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: cancelOut,
    left_operand: { red: true, green: true, signal: A },
    right_operand: { constant: 5 },
    operation: OPS.SUB,
    return: B,
  }));
  const replacedRed = circuit.network("red_cancel");
  const replacedGreen = circuit.network("green_cancel");
  const replacedOut = circuit.network("green_replaced");
  circuit.add(new Constant({
    enabled: true,
    red_output: replacedRed,
    signals: [{ signal: A, constant: 3 }],
  }));
  circuit.add(new Constant({
    enabled: true,
    green_output: replacedGreen,
    signals: [{ signal: A, constant: -3 }],
  }));
  circuit.add(new Arithmetic({
    red_input: replacedRed,
    green_input: replacedGreen,
    green_output: replacedOut,
    left_operand: { red: true, green: true, signal: A },
    right_operand: { constant: 5 },
    operation: OPS.SUM,
    return: B,
  }));
  const simulation = await circuit.createSimulation();
  assert.deepEqual(listed(simulation.present(red)), [
    ["virtual", "signal-A", "normal", 10],
    ["virtual", "signal-B", "normal", 4],
  ]);
  await simulation.step();
  assert.equal(simulation.read(sumOut, D), 23);
  assert.equal(simulation.read(missingOut, B), 5);
  assert.equal(simulation.read(zeroOut, B), 5);
  assert.equal(simulation.read(constOut, B), 5);
  assert.equal(simulation.read(red, A), 10);
  assert.equal(simulation.read(red, B), 4);
  assert.equal(simulation.present(constOut).length, 1);
  assert.equal(simulation.read(cancelOut, B), 8);
  assert.equal(simulation.read(replacedRed, A), 3);
  assert.equal(simulation.read(replacedGreen, A), -3);
  assert.equal(simulation.read(replacedOut, B), 5);
  await simulation.step();
  assert.equal(simulation.read(sumOut, D), 23);
});

test("Each слева и справа собирает каналы и один выход", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const green = circuit.network("green_in");
  const eachOut = circuit.network("green_each");
  const folded = circuit.network("green_fold");
  const redOnly = circuit.network("green_red");
  const doubled = circuit.network("green_double");
  const doubledFold = circuit.network("green_double_fold");
  const rightEach = circuit.network("green_right");
  const leftSub = circuit.network("green_left_sub");
  const rightSub = circuit.network("green_right_sub");
  const emptyOut = circuit.network("green_empty");
  const blind = circuit.network("green_blind");
  const greenOnly = circuit.network("green_only");
  const overflow = circuit.network("green_overflow");
  const same = circuit.network("green_same");
  const rightSignal = circuit.network("green_right_signal");
  const zeroed = circuit.network("green_zeroed");
  const cancelledSum = circuit.network("green_cancelled_sum");
  circuit.add(new Constant({
    enabled: true,
    red_output: red,
    signals: [{ signal: A, constant: 10 }, { signal: B, constant: 4 }],
  }));
  circuit.add(new Constant({
    enabled: true,
    green_output: green,
    signals: [{ signal: A, constant: 3 }, { signal: C, constant: 7 }],
  }));
  const each = new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: eachOut,
    left_operand: { red: true, green: true, signal: Signal.Meta.signal_each },
    right_operand: { constant: 0 },
    operation: OPS.SUM,
    return: Signal.Meta.signal_each,
  });
  circuit.add(each);
  circuit.add(new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: folded,
    left_operand: { red: true, green: true, signal: Signal.Meta.signal_each },
    right_operand: { constant: 0 },
    operation: OPS.SUM,
    return: D,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: redOnly,
    left_operand: { red: true, green: false, signal: Signal.Meta.signal_each },
    right_operand: { constant: 0 },
    operation: OPS.SUM,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: doubled,
    left_operand: { red: true, green: true, signal: Signal.Meta.signal_each },
    right_operand: { constant: 2 },
    operation: OPS.MUL,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: doubledFold,
    left_operand: { red: true, green: true, signal: Signal.Meta.signal_each },
    right_operand: { constant: 2 },
    operation: OPS.MUL,
    return: A,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: rightEach,
    left_operand: { constant: 2 },
    right_operand: signal(Signal.Meta.signal_each),
    operation: OPS.MUL,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: leftSub,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 10 },
    operation: OPS.SUB,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: rightSub,
    left_operand: { constant: 10 },
    right_operand: signal(Signal.Meta.signal_each),
    operation: OPS.SUB,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    green_output: emptyOut,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 1 },
    operation: OPS.SUM,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: blind,
    left_operand: { red: false, green: false, signal: Signal.Meta.signal_each },
    right_operand: { constant: 1 },
    operation: OPS.SUM,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    green_input: green,
    green_output: greenOnly,
    left_operand: { red: false, green: true, signal: Signal.Meta.signal_each },
    right_operand: { constant: 0 },
    operation: OPS.SUM,
    return: Signal.Meta.signal_each,
  }));
  const wide = circuit.network("red_wide");
  circuit.add(new Constant({
    enabled: true,
    red_output: wide,
    signals: [{ signal: A, constant: INT32_MAX }, { signal: B, constant: 1 }],
  }));
  circuit.add(new Arithmetic({
    red_input: wide,
    green_output: overflow,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 0 },
    operation: OPS.SUM,
    return: C,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: same,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: signal(A),
    operation: OPS.SUM,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: rightSignal,
    left_operand: signal(A),
    right_operand: signal(Signal.Meta.signal_each),
    operation: OPS.SUB,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: wide,
    green_output: zeroed,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 0 },
    operation: OPS.MUL,
    return: Signal.Meta.signal_each,
  }));
  const pair = circuit.network("red_pair");
  circuit.add(new Constant({
    enabled: true,
    red_output: pair,
    signals: [{ signal: A, constant: 5 }, { signal: B, constant: -5 }],
  }));
  circuit.add(new Arithmetic({
    red_input: pair,
    green_output: cancelledSum,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 0 },
    operation: OPS.SUM,
    return: D,
  }));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.deepEqual(listed(simulation.present(eachOut)), [
    ["virtual", "signal-A", "normal", 13],
    ["virtual", "signal-B", "normal", 4],
    ["virtual", "signal-C", "normal", 7],
  ]);
  assert.equal(simulation.read(folded, D), 24);
  assert.deepEqual(listed(simulation.present(redOnly)), [
    ["virtual", "signal-A", "normal", 10],
    ["virtual", "signal-B", "normal", 4],
  ]);
  assert.equal(simulation.read(doubled, A), 26);
  assert.equal(simulation.read(doubled, B), 8);
  assert.equal(simulation.read(doubled, C), 14);
  assert.equal(simulation.read(doubledFold, A), 48);
  assert.equal(simulation.present(doubledFold).length, 1);
  assert.equal(simulation.read(rightEach, A), 20);
  assert.equal(simulation.read(rightEach, B), 8);
  assert.equal(simulation.read(leftSub, A), 0);
  assert.equal(simulation.read(leftSub, B), -6);
  assert.equal(simulation.read(rightSub, A), 0);
  assert.equal(simulation.read(rightSub, B), 6);
  assert.equal(simulation.present(emptyOut).length, 0);
  assert.equal(simulation.present(blind).length, 0);
  assert.deepEqual(listed(simulation.present(greenOnly)), [
    ["virtual", "signal-A", "normal", 3],
    ["virtual", "signal-C", "normal", 7],
  ]);
  assert.equal(simulation.read(overflow, C), INT32_MIN);
  assert.equal(simulation.present(overflow).length, 1);
  assert.equal(simulation.read(same, A), 20);
  assert.equal(simulation.read(same, B), 14);
  assert.equal(simulation.read(rightSignal, A), 0);
  assert.equal(simulation.read(rightSignal, B), 6);
  assert.equal(simulation.present(zeroed).length, 0);
  assert.equal(simulation.read(cancelledSum, D), 0);
  await simulation.step();
  assert.equal(simulation.read(eachOut, A), 13);
  assert.equal(simulation.device(each).output.green.length, 3);
});

test("контрольные Each*2 и Each*10 различают выход Each и сбор в один канал", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_pair");
  const triple = circuit.network("red_triple");
  const each = circuit.network("green_each");
  const folded = circuit.network("green_fold");
  const tens = circuit.network("green_tens");
  const sum = circuit.network("green_sum");
  circuit.add(new Constant({
    enabled: true,
    red_output: red,
    signals: [{ signal: A, constant: 3 }, { signal: B, constant: -2 }],
  }));
  circuit.add(new Constant({
    enabled: true,
    red_output: triple,
    signals: [{ signal: A, constant: 1 }, { signal: B, constant: 1 }, { signal: C, constant: 1 }],
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: each,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 2 },
    operation: OPS.MUL,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: folded,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 2 },
    operation: OPS.MUL,
    return: C,
  }));
  circuit.add(new Arithmetic({
    red_input: triple,
    green_output: tens,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 10 },
    operation: OPS.MUL,
    return: Signal.Meta.signal_each,
  }));
  circuit.add(new Arithmetic({
    red_input: triple,
    green_output: sum,
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 10 },
    operation: OPS.MUL,
    return: B,
  }));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.deepEqual(listed(simulation.present(each)), [
    ["virtual", "signal-A", "normal", 6],
    ["virtual", "signal-B", "normal", -4],
  ]);
  assert.equal(simulation.read(folded, C), 2);
  assert.equal(simulation.present(folded).length, 1);
  assert.deepEqual(listed(simulation.present(tens)), [
    ["virtual", "signal-A", "normal", 10],
    ["virtual", "signal-B", "normal", 10],
    ["virtual", "signal-C", "normal", 10],
  ]);
  assert.deepEqual(listed(simulation.present(sum)), [["virtual", "signal-B", "normal", 30]]);
});

test("Each по качеству не сливает каналы, чужой профиль Each отклоняется", async () => {
  const space = openProfile("space-age");
  const iron = space.tree.Intermediate.iron_plate;
  const rare = iron.withQuality(Quality.RARE);
  const water = space.tree.Fluids.water;
  const letter = space.tree.Signals.signal_A;
  const each = space.tree.Meta.signal_each;
  const circuit = new Circuit({ profile: "space-age" });
  const red = circuit.network("red_in");
  const out = circuit.network("green_out");
  circuit.add(new Constant({
    enabled: true,
    red_output: red,
    signals: [
      { signal: iron, constant: 3 },
      { signal: rare, constant: 4 },
      { signal: water, constant: 2 },
      { signal: letter, constant: 5 },
    ],
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_output: out,
    left_operand: { red: true, green: false, signal: each },
    right_operand: { constant: 2 },
    operation: OPS.MUL,
    return: each,
  }));
  const simulation = await circuit.createSimulation();
  await simulation.step();
  assert.deepEqual(listed(simulation.present(out)), [
    ["fluid", "water", "normal", 4],
    ["item", "iron-plate", "normal", 6],
    ["item", "iron-plate", "rare", 8],
    ["virtual", "signal-A", "normal", 10],
  ]);
  const rejected = new Circuit({ profile: "space-age" });
  throwsCode(() => rejected.add(new Arithmetic({
    left_operand: signal(Signal.Meta.signal_each),
    right_operand: { constant: 1 },
    operation: OPS.SUM,
    return: iron,
  })), "wrong-profile");
  throwsCode(() => rejected.add(new Arithmetic({
    left_operand: { constant: 1 },
    right_operand: signal(Signal.Meta.signal_each),
    operation: OPS.SUM,
    return: iron,
  })), "wrong-profile");
  throwsCode(() => rejected.add(new Arithmetic({
    left_operand: signal(each),
    right_operand: { constant: 1 },
    operation: OPS.SUM,
    return: Signal.Meta.signal_each,
  })), "wrong-profile");
  assert.equal(rejected.devices.length, 0);
});

test("отмена цветов при Each на обоих входах не публикует соседний результат", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const green = circuit.network("green_in");
  const out = circuit.network("green_out");
  const other = circuit.network("green_other");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: [{ signal: A, constant: 3 }, { signal: B, constant: 2 }] }));
  circuit.add(new Constant({ enabled: true, green_output: green, signals: [{ signal: A, constant: -3 }] }));
  circuit.add(new Arithmetic({
    green_output: other,
    left_operand: { constant: 4 },
    right_operand: { constant: 5 },
    operation: OPS.SUM,
    return: C,
  }));
  circuit.add(new Arithmetic({
    red_input: red,
    green_input: green,
    green_output: out,
    left_operand: { red: true, green: true, signal: Signal.Meta.signal_each },
    right_operand: { constant: 0 },
    operation: OPS.SUM,
    return: Signal.Meta.signal_each,
  }));
  const simulation = await circuit.createSimulation();
  await assert.rejects(simulation.step(), (error) => error instanceof RuntimeError && error.code === "unsupported-case");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.read(out, B), 0);
  assert.equal(simulation.read(other, C), 0);
});

test("null-операнд Each оставляет пустой вклад на следующем шаге", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_in");
  const out = circuit.network("green_out");
  circuit.add(new Constant({ enabled: true, red_output: red, signals: [{ signal: A, constant: 9 }] }));
  const device = new Arithmetic({
    red_input: red,
    green_output: out,
    left_operand: null,
    right_operand: signal(Signal.Meta.signal_each),
    operation: OPS.SUM,
    return: B,
  });
  circuit.add(device);
  const simulation = await circuit.createSimulation();
  await simulation.step();
  await simulation.step();
  assert.equal(simulation.tick, 2);
  assert.equal(simulation.read(out, B), 0);
  assert.equal(simulation.device(device).output.green.length, 0);
  assert.equal(simulation.read(red, A), 9);
});
