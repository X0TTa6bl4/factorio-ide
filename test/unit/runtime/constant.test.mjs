import assert from "node:assert/strict";
import test from "node:test";
import { Circuit, Constant, OperationToken, Quality, Signal, openProfile } from "../../../src/index.js";
import { INT32_MAX, INT32_MIN } from "../../../src/int32.js";
import { rejectsCode, throwsCode } from "../signals/support.mjs";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const selector = openProfile("space-age").tree.Unsorted.signal_any_quality;

function count(signal, constant) {
  return { signal, constant };
}

function valid(extra = {}) {
  return { enabled: true, signals: [], ...extra };
}

test("CONST конфигурация принимает пустой список и копирует записи", () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const input = [count(A, 3)];
  const source = new Constant({
    enabled: true,
    signals: input,
    red_output: red,
    green_output: null,
  });
  input.push(count(B, 9));
  input[0] = count(A, 8);
  circuit.add(source);
  circuit.add(source);
  assert.equal(circuit.devices.length, 1);
  assert.equal(source.signals.length, 1);
  assert.equal(source.signals[0].constant, 3);
  assert.equal(source.red_output, red);
  assert.equal(source.green_output, null);
  assert.equal(new Constant(valid()).red_output, null);
  assert.equal(new Constant({ ...valid(), red_output: null }).red_output, null);
});

test("CONST отклоняет форму, входы, секции и порты до регистрации", () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_2");
  const other = new Circuit().network("red_foreign");
  const cases = [
    [null, "invalid-constant-config"],
    [[], "invalid-constant-config"],
    [1, "invalid-constant-config"],
    [valid({ sections: [] }), "mixed-source"],
    [valid({ group: "a" }), "invalid-constant-config"],
    [valid({ multiplier: 2 }), "invalid-constant-config"],
    [valid({ red_input: null }), "forbidden-input"],
    [valid({ green_input: red }), "forbidden-input"],
    [valid({ note: true }), "invalid-constant-config"],
    [{ signals: [] }, "invalid-enabled"],
    [valid({ enabled: "true" }), "invalid-enabled"],
    [{ enabled: true }, "invalid-source"],
    [valid({ signals: {} }), "invalid-signals"],
    [valid({ signals: [null] }), "invalid-signal-count"],
    [valid({ signals: [[]] }), "invalid-signal-count"],
    [valid({ signals: [count(A, 1), count(A, 1.5)] }), "invalid-constant"],
    [valid({ signals: [count(Signal.Meta.signal_each, 1)] }), "meta-signal"],
    [valid({ signals: [count(ArithmeticOperation(), 1)] }), "invalid-signal"],
    [valid({ signals: [count(Quality.RARE, 1)] }), "invalid-signal"],
    [valid({ signals: [{ signal: { type: "virtual", name: "signal-A", quality: "normal" }, constant: 1 }] }), "invalid-signal"],
    [valid({ signals: [count(A, "3")] }), "invalid-constant"],
    [valid({ signals: [count(A, Number.NaN)] }), "invalid-constant"],
    [valid({ signals: [count(A, Number.POSITIVE_INFINITY)] }), "invalid-constant"],
    [valid({ signals: [count(A, INT32_MAX + 1)] }), "invalid-constant"],
    [valid({ signals: [count(A, INT32_MIN - 1)] }), "invalid-constant"],
    [valid({ signals: [count(A, true)] }), "invalid-constant"],
    [valid({ signals: [{ signal: A }] }), "invalid-signal-count"],
    [valid({ signals: [{ constant: 1 }] }), "invalid-signal-count"],
    [valid({ red_output: "red_1" }), "invalid-port"],
    [valid({ red_output: ArithmeticOperation() }), "invalid-port"],
    [valid({ red_output: A }), "invalid-port"],
    [valid({ red_output: Signal.Meta.signal_each }), "invalid-port"],
    [valid({ red_output: Quality.RARE }), "invalid-port"],
    [valid({ red_output: selector }), "invalid-port"],
    [valid({ red_output: 0 }), "invalid-port"],
    [valid({ red_output: true }), "invalid-port"],
    [valid({ red_output: [] }), "invalid-port"],
  ];
  for (const [config, code] of cases) {
    throwsCode(() => new Constant(config), code);
  }
  assert.equal(circuit.devices.length, 0);
  const plain = new Constant(valid({ red_output: {} }));
  throwsCode(() => circuit.add(plain), "invalid-port");
  const colored = new Constant(valid({ red_output: green }));
  throwsCode(() => circuit.add(colored), "wrong-color");
  const foreign = new Constant(valid({ red_output: other }));
  throwsCode(() => circuit.add(foreign), "foreign-network");
  const later = new Constant(valid({ red_output: red }));
  later.red_input = red;
  throwsCode(() => circuit.add(later), "forbidden-input");
  assert.equal(circuit.devices.length, 0);
  assert.equal(circuit.network("red_1"), red);
});

function ArithmeticOperation() {
  return new OperationToken("arithmetic", "SUM");
}

function filter(signal, min, max) {
  return { signal, min, max };
}

function section(extra = {}) {
  return { active: true, multiplier: 1, group: null, filters: [], ...extra };
}

test("signals — одна активная секция с множителем 1 и max null", () => {
  const source = new Constant({ enabled: true, signals: [count(A, 5), count(B, 0)] });
  const listed = new Constant({ enabled: true, sections: [] });
  assert.equal(Object.hasOwn(listed, "signals"), false);
  assert.equal(listed.sections.length, 0);
  assert.deepEqual(source.sections, [{
    active: true,
    multiplier: 1,
    group: null,
    filters: [
      { signal: A, min: 5, max: null },
      { signal: B, min: 0, max: null },
    ],
  }]);
  source.enabled = 1;
  throwsCode(() => source.contribution("base"), "invalid-enabled");
});

test("секции параметризуют пустоту, знаки, активность, фильтр и обе сети", async () => {
  const cases = [
    { sections: [section()], value: 0, other: 0 },
    { sections: [section({ filters: [filter(A, 0, null), filter(B, 0, 1)] })], value: 0, other: 0 },
    { sections: [section({ filters: [filter(A, -4, null), filter(B, 2, null)] })], value: -4, other: 2 },
    { sections: [section({ filters: [filter(A, 2, null)] }), section({ filters: [filter(A, 3, 9)] })], value: 5, other: 0 },
    { sections: [section({ filters: [filter(A, 2, null)] }), section({ active: false, filters: [filter(A, 3, null)] })], value: 2, other: 0 },
    { enabled: false, sections: [section({ filters: [filter(A, 2, null)] }), section({ filters: [filter(A, 3, null)] })], value: 0, other: 0 },
    { sections: [section({ filters: [filter(A, 2, null), filter(A, -2, null)] })], value: 0, other: 0 },
    { sections: [section({ filters: [filter(A, 5, 10)] })], value: 5, other: 0 },
    { sections: [section({ filters: [filter(A, 4, 1)] })], value: 4, other: 0 },
  ];
  for (const item of cases) {
    const circuit = new Circuit();
    const red = circuit.network("red_1");
    const green = circuit.network("green_1");
    const input = item.sections[0].filters;
    const source = new Constant({
      enabled: item.enabled !== false,
      red_output: red,
      green_output: green,
      sections: item.sections,
    });
    if (input) input.push(filter(B, 9, null));
    circuit.add(source);
    const simulation = await circuit.createSimulation();
    assert.equal(simulation.read(red, A), item.value);
    assert.equal(simulation.read(green, A), item.value);
    assert.equal(simulation.read(red, B), item.other);
    for (let step = 0; step < 10; step += 1) await simulation.step();
    assert.equal(simulation.tick, 10);
    assert.equal(simulation.read(red, A), item.value);
    assert.equal(simulation.read(green, B), item.other);
  }
});

test("сумма секций оборачивает int32, тип и качество остаются разными каналами", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const item = Signal.Intermediate.water_barrel;
  const recipe = Signal.Intermediate.water_barrel.fill;
  circuit.add(new Constant({
    enabled: true,
    red_output: red,
    sections: [
      section({ filters: [filter(A, INT32_MAX, null), filter(item, 3, null)] }),
      section({ filters: [filter(A, 1, null), filter(B, INT32_MIN, null), filter(recipe, 7, null)] }),
      section({ filters: [filter(B, -1, null)] }),
    ],
  }));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), INT32_MIN);
  assert.equal(simulation.read(red, B), INT32_MAX);
  assert.equal(item.name, recipe.name);
  assert.notEqual(item.type, recipe.type);
  assert.equal(simulation.read(red, item), 3);
  assert.equal(simulation.read(red, recipe), 7);

  const space = openProfile("space-age");
  const plate = space.tree.Intermediate.iron_plate;
  const rare = plate.withQuality(Quality.RARE);
  const quality = new Circuit({ profile: "space-age" });
  const green = quality.network("green_1");
  quality.add(new Constant({
    enabled: true,
    green_output: green,
    sections: [section({ filters: [filter(plate, 3, null), filter(rare, 8, null)] })],
  }));
  const second = await quality.createSimulation();
  assert.equal(plate.name, rare.name);
  assert.equal(second.read(green, plate), 3);
  assert.equal(second.read(green, rare), 8);
});

test("общая группа меняется у каждого использования на границе нового прогона", async () => {
  const shared = new Constant.Group({
    name: "plates",
    filters: [filter(A, 2, null)],
  });
  const other = new Constant.Group({ name: "plates", filters: [filter(A, 2, null)] });
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const spare = circuit.network("red_spare");
  const redSource = new Constant({
    enabled: true,
    red_output: red,
    sections: [
      { active: true, multiplier: 1, group: shared },
      { active: true, multiplier: 1, group: shared },
    ],
  });
  const greenSource = new Constant({
    enabled: true,
    green_output: green,
    sections: [{ active: true, multiplier: 1, group: shared }],
  });
  circuit.add(redSource);
  circuit.add(new Constant({
    enabled: true,
    red_output: spare,
    sections: [{ active: true, multiplier: 1, group: other }],
  }));
  circuit.add(greenSource);
  const first = await circuit.createSimulation();
  assert.equal(first.read(red, A), 4);
  assert.equal(first.read(green, A), 2);
  assert.equal(first.read(spare, A), 2);
  assert.equal(redSource.sections[0].group, shared);
  assert.equal(redSource.sections[0].filters, null);
  throwsCode(() => shared.replaceFilters([filter(A, 3, null), { signal: A }]), "invalid-filter");
  assert.equal(shared.filters.length, 1);
  assert.equal(shared.filters[0].min, 2);
  shared.replaceFilters([filter(A, 3, null)]);
  await first.step();
  await first.reset();
  assert.equal(first.read(red, A), 4);
  assert.equal(first.read(green, A), 2);
  assert.equal(first.read(spare, A), 2);
  redSource.enabled = false;
  const second = await circuit.createSimulation();
  assert.equal(first.read(red, A), 4);
  assert.equal(second.read(red, A), 0);
  assert.equal(second.read(green, A), 3);
  assert.equal(second.read(spare, A), 2);
  greenSource.enabled = false;
  const third = await circuit.createSimulation();
  assert.equal(second.read(green, A), 3);
  assert.equal(third.read(green, A), 0);
  const plate = openProfile("space-age").tree.Intermediate.iron_plate;
  shared.replaceFilters([filter(plate, 1, null)]);
  await rejectsCode(circuit.createSimulation(), "wrong-profile");
  assert.equal(third.read(spare, A), 2);
});

test("секции и группы отклоняют неверную форму без молчаливого преобразования", () => {
  const group = new Constant.Group({ name: " ", filters: [] });
  assert.equal(group.name, " ");
  const owned = new Constant.Group({ name: "owned", filters: [filter(A, 1, null)] });
  const cases = [
    [() => new Constant.Group(null), "invalid-group"],
    [() => new Constant.Group([]), "invalid-group"],
    [() => new Constant.Group({ name: "a" }), "invalid-group"],
    [() => new Constant.Group({ filters: [] }), "invalid-group"],
    [() => new Constant.Group({ name: "a", filters: [], extra: true }), "invalid-group"],
    [() => new Constant.Group({ filters: [], extra: 1 }), "invalid-group"],
    [() => new Constant.Group({ name: "a", extra: 1 }), "invalid-group"],
    [() => new Constant.Group({ name: "", filters: [] }), "invalid-group-name"],
    [() => new Constant.Group({ name: 1, filters: [] }), "invalid-group-name"],
    [() => new Constant.Group({ name: "a", filters: null }), "invalid-filters"],
    [() => new Constant.Group({ name: "a", filters: [null] }), "invalid-filter"],
    [() => new Constant.Group({ name: "a", filters: [[]] }), "invalid-filter"],
    [() => new Constant.Group({ name: "a", filters: [{ signal: A, min: 1 }] }), "invalid-filter"],
    [() => new Constant.Group({ name: "a", filters: [{ min: 1, max: null, extra: 1 }] }), "invalid-filter"],
    [() => new Constant.Group({ name: "a", filters: [{ signal: A, max: null, extra: 1 }] }), "invalid-filter"],
    [() => new Constant.Group({ name: "a", filters: [{ signal: A, min: 1, extra: 1 }] }), "invalid-filter"],
    [() => new Constant.Group({ name: "a", filters: [filter(Signal.Meta.signal_each, 1, null)] }), "meta-signal"],
    [() => new Constant.Group({ name: "a", filters: [filter(ArithmeticOperation(), 1, null)] }), "invalid-signal"],
    [() => new Constant.Group({ name: "a", filters: [filter(Quality.RARE, 1, null)] }), "invalid-signal"],
    [() => new Constant.Group({ name: "a", filters: [filter(selector, 1, null)] }), "invalid-signal"],
    [() => new Constant.Group({ name: "a", filters: [filter({ type: "virtual", name: "signal-A", quality: "normal" }, 1, null)] }), "invalid-signal"],
    [() => new Constant.Group({ name: "a", filters: [filter(A, "1", null)] }), "invalid-constant"],
    [() => new Constant.Group({ name: "a", filters: [filter(A, 1, "2")] }), "invalid-constant"],
    [() => new Constant.Group({ name: "a", filters: [filter(A, 1.5, null)] }), "invalid-constant"],
    [() => new Constant.Group({ name: "a", filters: [filter(A, Number.NaN, null)] }), "invalid-constant"],
    [() => new Constant.Group({ name: "a", filters: [filter(A, INT32_MAX + 1, null)] }), "invalid-constant"],
    [() => new Constant.Group({ name: "a", filters: [filter(A, 1, INT32_MIN - 1)] }), "invalid-constant"],
    [() => new Constant({ enabled: true, sections: {} }), "invalid-sections"],
    [() => new Constant({ enabled: true, sections: [null] }), "invalid-section"],
    [() => new Constant({ enabled: true, sections: [[]] }), "invalid-section"],
    [() => new Constant({ enabled: true, sections: [{ ...section(), note: true }] }), "invalid-section"],
    [() => new Constant({ enabled: true, sections: [{ ...section(), active: "true" }] }), "invalid-section"],
    [() => new Constant({ enabled: true, sections: [{ multiplier: 1, group: null, filters: [] }] }), "invalid-section"],
    [() => new Constant({ enabled: true, sections: [{ active: true, group: null, filters: [] }] }), "invalid-multiplier"],
    [() => new Constant({ enabled: true, sections: [section({ multiplier: "1" })] }), "invalid-multiplier"],
    [() => new Constant({ enabled: true, sections: [section({ multiplier: true })] }), "invalid-multiplier"],
    [() => new Constant({ enabled: true, sections: [section({ multiplier: Number.NaN })] }), "invalid-multiplier"],
    [() => new Constant({ enabled: true, sections: [section({ multiplier: Number.POSITIVE_INFINITY })] }), "invalid-multiplier"],
    [() => new Constant({ enabled: true, sections: [section({ multiplier: 0 })] }), "unsupported-case"],
    [() => new Constant({ enabled: true, sections: [section({ multiplier: -2 })] }), "unsupported-case"],
    [() => new Constant({ enabled: true, sections: [section({ multiplier: 1.5 })] }), "unsupported-case"],
    [() => new Constant({ enabled: true, sections: [section({ multiplier: 2 })] }), "unsupported-case"],
    [() => new Constant({ enabled: true, sections: [{ active: true, multiplier: 1, filters: [] }] }), "invalid-section"],
    [() => new Constant({ enabled: true, sections: [{ active: true, multiplier: 1, group: null }] }), "invalid-section"],
    [() => new Constant({ enabled: true, sections: [{ active: true, multiplier: 1, group: "plates" }] }), "unsupported-case"],
    [() => new Constant({ enabled: true, sections: [{ active: true, multiplier: 1, group: {} }] }), "invalid-group"],
    [() => new Constant({ enabled: true, sections: [{ active: true, multiplier: 1, group: owned, filters: [] }] }), "mixed-source"],
    [() => new Constant({ enabled: true, sections: [section()], red_output: "red_1" }), "invalid-port"],
  ];
  for (const [run, code] of cases) throwsCode(run, code);
  const circuit = new Circuit();
  const mixed = new Constant({ enabled: true, sections: [section({ filters: [filter(A, 1, null)] })] });
  mixed.compute = () => ({ signals: [] });
  throwsCode(() => circuit.add(mixed), "mixed-device");
  const plate = openProfile("space-age").tree.Intermediate.iron_plate;
  throwsCode(() => circuit.add(new Constant({
    enabled: false,
    sections: [section({ active: false, filters: [filter(plate, 1, null)] })],
  })), "wrong-profile");
  assert.equal(circuit.devices.length, 0);
  assert.equal(group.filters.length, 0);
  const local = new Constant({
    enabled: true,
    sections: [section({ filters: [filter(B, 4, null)] }), { active: true, multiplier: 1, group }],
  });
  assert.deepEqual(local.contribution("base"), [{ signal: B, constant: 4 }]);
  const quiet = new Constant({
    enabled: false,
    sections: [section({ active: false, filters: [filter(A, 5, null)] })],
  });
  assert.deepEqual(quiet.contribution("base"), []);
});
