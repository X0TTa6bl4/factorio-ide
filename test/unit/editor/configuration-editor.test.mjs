import assert from "node:assert/strict";
import test from "node:test";

import { createConfigurationEditor, diagnoseOperand, Signal } from "../../../src/index.js";

const chest = "Signal.Logistic.wooden_chest";

function arithmetic(body) {
  return `arithmetic adder = new Arithmetic({
    ${body}
  })`;
}

const validMask = arithmetic(`
  left_operand: { red: false, green: false, signal: ${chest} },
  right_operand: { constant: 1 },
  operation: Arithmetic.Operation.SUM,
  return: ${chest}
`);

test("01 допустимые сигнал, операция и сеть своего цвета проходят проверку", async () => {
  const editor = createConfigurationEditor({ text: "" });
  assert.equal(editor.diagnostics.length === 0 || editor.text === "", true);
  const sample = createConfigurationEditor();
  assert.equal(sample.diagnostics.map((item) => item.message).join("\n"), "");
  const signals = sample.suggestions({
    kind: "signal",
    role: "arithmetic-operand",
    query: "Signal.Logistic.wooden",
  });
  assert.equal(signals.items.some((item) => item.name === chest), true);
  assert.equal(signals.items.some((item) => item.kind === "new"), false);
  const operations = sample.suggestions({
    kind: "operation",
    owner: "Arithmetic",
    group: "Operation",
    query: "Arithmetic.Operation.SU",
  });
  assert.deepEqual(operations.items.map((item) => item.name), ["Arithmetic.Operation.SUM", "Arithmetic.Operation.SUB"]);
  const launched = await sample.launch();
  assert.equal(launched.applied, true);
  const stepped = await sample.step();
  assert.equal(stepped.applied, true);
  const green = sample.publication().networks.find((network) => network.name === "green_1");
  assert.equal(green.signals.some((signal) => signal.constant === 5), true);
});

test("02 пустая маска допустима, null операнда не становится нулём", () => {
  const editor = createConfigurationEditor({ text: validMask });
  assert.equal(editor.diagnostics.length, 0);
  const device = editor.model().devices.find((item) => item.name === "adder");
  assert.deepEqual(device.config.left_operand, {
    red: false,
    green: false,
    signal: chest,
  });
  const unset = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, green: false, signal: Signal.Intermediate.iron_plate },
      right_operand: null,
      operation: Arithmetic.Operation.SUM,
      return: Signal.Intermediate.iron_plate
    `),
  });
  assert.equal(unset.diagnostics.length, 0);
  assert.equal(unset.model().devices[0].config.right_operand, null);
  assert.notEqual(unset.model().devices[0].config.right_operand, 0);
});

test("03 смешанный операнд, пропущенный green и нецелые константы не преобразуются", () => {
  const mixed = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { constant: 5, signal: ${chest} },
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  const mixedError = mixed.diagnostics.find((item) => item.code === "mixed-operand");
  assert.equal(mixedError.field, "adder.left_operand");
  assert.equal(mixedError.expected, "Operand | OperandConst");

  const missing = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, signal: ${chest} },
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  const missingError = missing.diagnostics.find((item) => item.field === "adder.left_operand.green");
  assert.equal(missingError.expected, "boolean");

  const text = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, green: false, signal: ${chest} },
      right_operand: { constant: "5" },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  const stringError = text.diagnostics.find((item) => item.field === "adder.right_operand.constant");
  assert.equal(stringError.code, "invalid-constant");
  assert.equal(stringError.expected, "int32");
  assert.equal(stringError.received, "string");

  const fraction = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, green: false, signal: ${chest} },
      right_operand: { constant: 1.5 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  assert.equal(fraction.diagnostics.find((item) => item.field === "adder.right_operand.constant").received, "дробное число");

  const overflow = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, green: false, signal: ${chest} },
      right_operand: { constant: 2147483648 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  assert.equal(overflow.diagnostics.find((item) => item.field === "adder.right_operand.constant").received, "вне int32");
});

test("04 Each в обоих операндах и несовместимый выход сравнивающего блокируют запуск", async () => {
  const both = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, green: false, signal: Signal.Meta.signal_each },
      right_operand: { red: true, green: false, signal: Signal.Meta.signal_each },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  const each = both.diagnostics.find((item) => item.code === "invalid-each");
  assert.ok(each.related.includes("adder.left_operand.signal"));
  assert.ok(each.related.includes("adder.right_operand.signal"));
  assert.equal((await both.launch()).applied, false);

  const decider = createConfigurationEditor({
    text: `decider gate = new Decider({
      conditions: [{
        left_operand: { red: true, green: false, signal: Signal.Intermediate.iron_plate },
        right_operand: { constant: 1 },
        operation: Decider.Operation.GT
      }],
      when_true: [{ signal: Signal.Meta.signal_each, constant: 1 }]
    })`,
  });
  const output = decider.diagnostics.find((item) => item.code === "invalid-each");
  assert.ok(output.related.includes("gate.conditions"));
  assert.ok(output.related.includes("gate.when_true"));
  assert.equal((await decider.launch()).applied, false);
});

test("запись вида без new указывает на эту форму, вызов остаётся допустимым", () => {
  const legacy = createConfigurationEditor({
    text: "arithmetic adder = Arithmetic({ operation: Arithmetic.Operation.SUM })",
  });
  const message = legacy.diagnostics.find((item) => item.code === "forbidden-effect");
  assert.match(message.message, /вид имя =/);
  assert.equal(message.message.includes("только формой"), false);
  const call = createConfigurationEditor({ text: userArithmetic });
  assert.equal(call.diagnostics.some((item) => item.message.includes("new Класс")), false);
});

test("05 произвольный вызов и присваивание отклоняются, new Arithmetic остаётся декларацией", () => {
  const forbidden = createConfigurationEditor({
    text: `foo()\ncount = 1\nred_1.signal = 4\n`,
  });
  assert.equal(forbidden.diagnostics.some((item) => item.code === "forbidden-effect"), true);
  assert.equal(globalThis.polluted, undefined);
  const allowed = createConfigurationEditor({ text: validMask });
  assert.equal(allowed.diagnostics.some((item) => item.code === "forbidden-effect"), false);
  assert.equal(allowed.model().devices[0].kind, "arithmetic");
});

test("06 недоступные сигнал и качество не предлагаются и диагностируются", () => {
  const editor = createConfigurationEditor();
  const signals = editor.suggestions({ kind: "signal", role: "channel", query: "Signal.Production.biolab" });
  assert.equal(signals.items.length, 0);
  const qualities = editor.suggestions({ kind: "quality", query: "Quality.R" });
  assert.equal(qualities.items.some((item) => item.name === "Quality.RARE"), false);
  assert.equal(qualities.items.some((item) => item.kind === "new"), false);
  const inserted = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, green: false, signal: Signal.Production.biolab },
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  assert.equal(inserted.diagnostics.some((item) => item.code === "unavailable-signal"), true);
  const quality = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, green: false, signal: ${chest}.withQuality(Quality.RARE) },
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  assert.equal(quality.diagnostics.some((item) => item.code === "unavailable-quality"), true);
});

test("07 виджет, подсказки и запуск одинаково принимают и отклоняют операнд", async () => {
  const value = { red: false, green: false, signal: Signal.Logistic.wooden_chest };
  assert.equal(diagnoseOperand(value, { field: "adder.left_operand", device: "arithmetic", side: "left" }).length, 0);
  const editor = createConfigurationEditor({ text: validMask });
  assert.equal(editor.diagnostics.length, 0);
  assert.equal(editor.suggestions({
    kind: "signal",
    role: "arithmetic-operand",
    query: chest,
  }).items.some((item) => item.name === chest), true);
  assert.equal((await editor.launch()).applied, true);

  const bad = { constant: 5, signal: Signal.Logistic.wooden_chest, red: false, green: false };
  assert.equal(diagnoseOperand(bad, { field: "adder.left_operand" }).some((item) => item.code === "mixed-operand"), true);
  const rejected = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { constant: 5, signal: ${chest} },
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  assert.equal(rejected.diagnostics.some((item) => item.code === "mixed-operand"), true);
  assert.equal((await rejected.launch()).applied, false);
});

test("ED-A1 префикс заменяет свой диапазон для сигнала, операции и сценария", () => {
  const text = `event clock = new EventCombinator({ run: { every_tick: true, input_changed: false } })
event other = new EventCombinator({ run: { every_tick: false, input_changed: true } })
peers clock { receiver: o }
arithmetic adder = new Arithmetic({
  left_operand: { red: true, green: false, signal: Signal.Log },
  right_operand: { constant: 1 },
  operation: Arithmetic.Op,
  return: ${chest}
})`;
  const editor = createConfigurationEditor({ text });
  const signal = editor.locate("adder", ["left_operand", "signal"]);
  const suggested = editor.suggestions({ kind: "signal", role: "arithmetic-operand", query: signal.text });
  assert.equal(suggested.items.some((item) => item.value === "Signal.Logistic" && item.caption === "Logistic"), true);
  assert.equal(suggested.items.some((item) => item.name === chest), false);
  assert.equal(suggested.items.some((item) => item.name.includes("biolab")), false);
  const applied = editor.applySuggestion({
    kind: "signal",
    choice: "item",
    name: chest,
    range: signal.range,
    use: `signal:${chest}`,
  });
  assert.equal(applied.applied, true);
  assert.match(editor.text, /signal: Signal\.Logistic\.wooden_chest/);
  assert.equal(editor.text.includes("Signal.Logistic.wooden_chestistic"), false);

  const operation = editor.locate("adder", ["operation"]);
  const operations = editor.suggestions({
    kind: "operation",
    owner: "Arithmetic",
    group: "Operation",
    query: operation.text,
  });
  assert.equal(operations.items.some((item) => item.value === "Arithmetic.Operation" && item.caption === "Operation" && item.label === ""), true);
  assert.equal(operations.items.some((item) => item.name.includes("SUM")), false);
  editor.applySuggestion({
    kind: "operation",
    choice: "item",
    name: "Arithmetic.Operation.SUM",
    range: operation.range,
  });
  const peer = editor.locate("clock", ["receiver"]);
  const peers = editor.suggestions({ kind: "peer", query: peer.text });
  assert.deepEqual(peers.items.map((item) => item.name), ["other"]);
  editor.applySuggestion({ kind: "peer", choice: "item", name: "other", range: peer.range });
  assert.match(editor.text, /receiver: other/);
});

test("ED-A2 каталоговый сигнал не удаляется и не получает _new", () => {
  const before = Signal.Logistic.wooden_chest;
  const editor = createConfigurationEditor({ text: "wire red_1 {}\n" });
  assert.equal(Signal.Logistic.wooden_chest, before);
  const items = editor.suggestions({ kind: "signal", role: "channel", query: chest });
  assert.equal(items.items.some((item) => item.kind === "new" || item.kind === "create"), false);
  assert.equal(items.items[0].name, chest);
  const rejected = editor.applySuggestion({
    kind: "signal",
    choice: "new",
    name: "Signal.Logistic._new",
    range: { start: 0, end: 0 },
  });
  assert.equal(rejected.applied, false);
  assert.equal(Signal.Logistic.wooden_chest, before);
});

test("ED-A3 устаревшая revision не меняет документ, актуальная вставка проходит общий валидатор", async () => {
  const editor = createConfigurationEditor({ text: validMask });
  const stale = editor.revision;
  editor.replace(`${validMask}\n`);
  assert.equal(editor.suggestions({
    revision: stale,
    kind: "signal",
    role: "arithmetic-operand",
    query: "Signal",
  }).applied, false);
  assert.equal(editor.applySuggestion({
    revision: stale,
    kind: "signal",
    choice: "item",
    name: chest,
    range: { start: 0, end: 0 },
  }).applied, false);
  assert.equal(editor.completeParse(stale, { ok: true }).applied, false);
  const current = editor.locate("adder", ["return"]);
  editor.applySuggestion({
    kind: "signal",
    choice: "item",
    name: chest,
    range: current.range,
    use: `signal:${chest}`,
  });
  editor.completeParse(editor.revision, { ok: true, color: "green" });
  const launched = await editor.launch();
  assert.equal(launched.applied, true);
  assert.equal(editor.diagnostics.length, 0);
});

test("кеш подсказок не подтверждает неверный цвет перед запуском", async () => {
  const editor = createConfigurationEditor({
    text: `wire red_1 {}
arithmetic adder = new Arithmetic({
  green_input: red_1,
  left_operand: null,
  right_operand: null,
  operation: Arithmetic.Operation.SUM
})`,
  });
  assert.equal(editor.completeParse(editor.revision, { ok: true }).applied, true);
  const launched = await editor.launch();
  assert.equal(launched.applied, false);
  assert.equal(editor.diagnostics.some((item) => item.code === "wrong-color"), true);
});

test("группа Constant.Group подставляется в секцию без eval", () => {
  const editor = createConfigurationEditor({
    text: `group plates = new Constant.Group({
      name: "plates",
      filters: [{ signal: Signal.Intermediate.iron_plate, min: 2, max: null }]
    })
constant source = new Constant({
      enabled: true,
      sections: [{ active: true, multiplier: 1, group: plates }]
    })`,
  });
  assert.equal(editor.diagnostics.map((item) => `${item.field}: ${item.message}`).join("\n"), "");
  assert.equal(editor.model().devices[0].kind, "constant");
});

test("green_new вставляет свободное имя одной отменой", () => {
  const editor = createConfigurationEditor();
  const before = editor.text;
  const kept = editor.index().networks.find((item) => item.name === "green_1").id;
  const adder = editor.index().devices.find((item) => item.kind === "arithmetic");
  const port = editor.locate(adder.id, ["green_output"]);
  const listed = editor.suggestions({ kind: "network", color: "green", query: "g" });
  const fresh = listed.items.find((item) => item.name === "green_new");
  assert.equal(fresh.kind, "new");
  assert.equal(listed.items.findIndex((item) => item.name === "green_1") < listed.items.indexOf(fresh), true);
  assert.equal(listed.items.some((item) => item.kind === "create"), false);
  const applied = editor.applySuggestion({
    kind: "network",
    choice: "new",
    color: "green",
    range: port.range,
  });
  assert.equal(applied.text, "green_2");
  assert.match(editor.text, /green_output: green_2/);
  assert.equal(editor.text.includes("green_new"), false);
  assert.equal(editor.undo().applied, true);
  assert.equal(editor.text, before);
  assert.equal(editor.index().networks.find((item) => item.name === "green_1").id, kept);
  assert.equal(editor.index().networks.some((item) => item.name === "green_2"), false);
  assert.equal(editor.redo().applied, true);
  assert.match(editor.text, /green_output: green_2/);
});

test("неиспользуемая сеть исчезает только из корректного документа", () => {
  const editor = createConfigurationEditor({
    text: `wire red_1 {}
wire green_9 {}
arithmetic adder = new Arithmetic({
  red_input: red_1,
  left_operand: null,
  right_operand: null,
  operation: Arithmetic.Operation.SUM
})`,
  });
  assert.equal(editor.text.includes("green_9"), false);
  assert.equal(editor.index().networks.some((item) => item.name === "green_9"), false);
  const broken = createConfigurationEditor({
    text: `wire green_9 {}
arithmetic adder = new Arithmetic({
  green_input: green_9
`,
  });
  assert.equal(broken.diagnostics.length > 0, true);
  assert.equal(broken.text.includes("green_9"), true);
});

const userArithmetic = `Arithmetic({
  red_input: red_1,
  green_output: green_1,
  left_operand: { red: true, green: true, signal: ${chest} },
  right_operand: { constant: 2 },
  operation: Arithmetic.Operation.SUM,
  return: ${chest}
})`;

test("простой вызов принимает пример, цвет и повтор имени сети", async () => {
  const editor = createConfigurationEditor({
    text: `Constant({
      enabled: true,
      red_output: red_1,
      signals: [{ signal: ${chest}, constant: 3 }]
    })
    ${userArithmetic}`,
  });
  assert.equal(editor.diagnostics.map((item) => item.message).join("\n"), "");
  assert.equal(editor.text.includes("wire "), false);
  const red = editor.index().networks.find((item) => item.name === "red_1");
  const green = editor.index().networks.find((item) => item.name === "green_1");
  assert.equal(red.color, "red");
  assert.equal(green.color, "green");
  assert.equal(editor.index().networks.filter((item) => item.name === "red_1").length, 1);
  assert.equal(editor.text.includes(red.id), false);
  const launched = await editor.launch();
  assert.equal(launched.applied, true);
  await editor.step();
  const published = editor.publication().networks.find((item) => item.name === "green_1");
  assert.equal(published.signals.some((signal) => signal.constant === 5), true);
});

test("Constant и Arithmetic в простой форме дают те же тики, что прежняя запись", async () => {
  const legacy = `wire red_1 {}
wire green_1 {}
constant source = new Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: ${chest}, constant: 3 }]
})
arithmetic adder = new Arithmetic({
  red_input: red_1,
  green_output: green_1,
  left_operand: { red: true, green: true, signal: ${chest} },
  right_operand: { constant: 2 },
  operation: Arithmetic.Operation.SUM,
  return: ${chest}
})`;
  const previous = createConfigurationEditor({ text: legacy });
  const current = createConfigurationEditor({ text: `Constant({
    enabled: true,
    red_output: red_1,
    signals: [{ signal: ${chest}, constant: 3 }]
  })
  ${userArithmetic}` });
  await previous.launch();
  await previous.step();
  await current.launch();
  await current.step();
  assert.deepEqual(current.publication().networks.map((item) => ({
    name: item.name,
    signals: item.signals,
  })), previous.publication().networks.map((item) => ({
    name: item.name,
    signals: item.signals,
  })));
  assert.match(previous.text, /new Arithmetic/);
  assert.equal(previous.index().devices.find((item) => item.kind === "arithmetic").name, "adder");
});

test("неверное значение и произвольная функция отклоняются с диапазоном", () => {
  const editor = createConfigurationEditor({
    text: `${userArithmetic.replace("constant: 2", "constant: 1.5")}\nfoo()\n`,
  });
  const fraction = editor.diagnostics.find((item) => item.received === "дробное число");
  const call = editor.diagnostics.find((item) => item.code === "forbidden-effect");
  assert.equal(fraction.field, "arithmetic#1.right_operand.constant");
  assert.ok(fraction.range.end > fraction.range.start);
  assert.ok(call.range.end > call.range.start);
  const reserved = createConfigurationEditor({
    text: "Arithmetic({ red_input: red_new })",
  });
  assert.equal(reserved.diagnostics.some((item) => item.code === "invalid-name"), true);
  assert.equal(reserved.index().networks.length, 0);
  const outside = createConfigurationEditor({
    text: `Arithmetic({
      left_operand: mystery,
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    })`,
  });
  assert.equal(outside.index().networks.length, 0);
  assert.equal(outside.diagnostics.some((item) => item.code === "invalid-operand"), true);
});

test("правка поля и вставка соседнего вызова сохраняют ID и ссылку сети", () => {
  const editor = createConfigurationEditor({ text: userArithmetic });
  const arithmetic = editor.index().devices.find((item) => item.kind === "arithmetic");
  const network = editor.index().networks.find((item) => item.name === "red_1");
  editor.replace(editor.text.replace("constant: 2", "constant: 4"));
  const edited = editor.index().devices.find((item) => item.kind === "arithmetic");
  assert.equal(edited.id, arithmetic.id);
  assert.equal(editor.index().networks.find((item) => item.name === "red_1").id, network.id);
  assert.equal(editor.text.includes(arithmetic.id), false);
  editor.replace(`Constant({ enabled: true, signals: [] })\n${editor.text}`);
  assert.equal(editor.index().devices.find((item) => item.kind === "arithmetic").id, arithmetic.id);
  assert.notEqual(editor.index().devices.find((item) => item.kind === "constant").id, arithmetic.id);
  assert.equal(editor.index().networks.find((item) => item.name === "red_1").id, network.id);
});

test("именованный вызов и прежние группы, peers и wire открываются без переписывания", () => {
  const text = `wire red_1 { label: "сундуки" }
group plates = new Constant.Group({
  name: "plates",
  filters: [{ signal: ${chest}, min: 1, max: null }]
})
Arithmetic source({
  red_input: red_1,
  left_operand: { red: true, green: false, signal: ${chest} },
  right_operand: { constant: 1 },
  operation: Arithmetic.Operation.SUM,
  return: ${chest}
})
event clock = new EventCombinator({ run: { every_tick: true, input_changed: false } })
event other = new EventCombinator({ run: { every_tick: false, input_changed: true } })
peers clock { receiver: other }`;
  const editor = createConfigurationEditor({ text });
  assert.equal(editor.diagnostics.map((item) => item.message).join("\n"), "");
  assert.equal(editor.text, text);
  assert.equal(editor.index().devices.find((item) => item.name === "source").kind, "arithmetic");
  assert.deepEqual(editor.model().peers, [{ source: "clock", receiver: "other" }]);
  const deviceId = editor.index().devices.find((item) => item.name === "source").id;
  const networkId = editor.index().networks.find((item) => item.name === "red_1").id;
  editor.replace(text.replace('label: "сундуки"', 'label: "ящики"'));
  assert.equal(editor.index().devices.find((item) => item.name === "source").id, deviceId);
  assert.equal(editor.index().networks.find((item) => item.name === "red_1").id, networkId);
  assert.match(editor.text, /wire red_1/);
  assert.match(editor.text, /new EventCombinator/);
});

test("подсказка сети не создаёт её до подтверждения, отмена убирает создание", () => {
  const editor = createConfigurationEditor({
    text: `Arithmetic({
      red_input: null,
      left_operand: null,
      right_operand: null,
      operation: Arithmetic.Operation.SUM
    })`,
  });
  const device = editor.index().devices[0];
  const port = editor.locate(device.id, ["red_input"]);
  const listed = editor.suggestions({ kind: "network", color: "red", query: "r" });
  assert.equal(listed.items[0].name, "red_new");
  assert.equal(editor.index().networks.length, 0);
  const applied = editor.applySuggestion({
    kind: "network",
    choice: "new",
    color: "red",
    range: port.range,
  });
  assert.equal(applied.text, "red_1");
  assert.equal(editor.text.includes("wire "), false);
  assert.equal(editor.index().networks.some((item) => item.name === "red_1"), true);
  assert.equal(editor.undo().applied, true);
  assert.equal(editor.index().networks.length, 0);
});

test("ошибочный текст не продолжает сохранённый прогон", async () => {
  const editor = createConfigurationEditor();
  await editor.launch();
  await editor.step();
  const tick = editor.publication().tick;
  editor.replace(editor.text.replace("constant: 2", "constant: 1.5"));
  assert.equal(editor.publication(), null);
  assert.equal(editor.view().current, false);
  assert.equal(editor.view().staleRun.tick, tick);
  const refused = await editor.step();
  assert.equal(refused.applied, false);
  assert.equal(editor.publication(), null);
  assert.equal(editor.view().staleRun.tick, tick);
});

test("сброс возвращает границу 0, шаг назад не меняет текст", async () => {
  const editor = createConfigurationEditor();
  await editor.launch();
  assert.equal(editor.publication().tick, 0);
  assert.equal(editor.publication().networks.some((network) => network.color === "red"), true);
  await editor.step();
  await editor.step();
  assert.equal(editor.publication().tick, 2);
  const text = editor.text;
  const back = await editor.back();
  assert.equal(back.applied, true);
  assert.equal(editor.publication().tick, 1);
  assert.equal(editor.text, text);
  assert.equal(editor.undo().applied, false);
  assert.equal(editor.publication().tick, 1);
  const reset = await editor.reset();
  assert.equal(reset.applied, true);
  assert.equal(editor.publication().tick, 0);
  const exhausted = await editor.back();
  assert.equal(exhausted.applied, false);
  assert.equal(exhausted.code, "history-exhausted");
  assert.equal(editor.publication().tick, 0);
});

test("один сигнал в двух сетях различим, пустая сеть остаётся в снимке", async () => {
  const editor = createConfigurationEditor({
    text: `Constant({
      enabled: true,
      red_output: red_a,
      signals: [{ signal: Signal.Signals.signal_A, constant: 1 }]
    })
    Constant({
      enabled: true,
      green_output: green_b,
      signals: [{ signal: Signal.Signals.signal_A, constant: 4 }]
    })
    Arithmetic({
      red_input: red_a,
      green_input: green_empty,
      left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
      right_operand: { constant: 0 },
      operation: Arithmetic.Operation.SUM,
      return: Signal.Signals.signal_A
    })`,
  });
  assert.equal(editor.diagnostics.map((item) => item.message).join("\n"), "");
  await editor.launch();
  const networks = editor.publication().networks;
  const red = networks.find((network) => network.name === "red_a");
  const green = networks.find((network) => network.name === "green_b");
  const empty = networks.find((network) => network.name === "green_empty");
  assert.equal(red.color, "red");
  assert.equal(green.color, "green");
  assert.equal(red.signals.find((signal) => signal.name === "signal-A").constant, 1);
  assert.equal(green.signals.find((signal) => signal.name === "signal-A").constant, 4);
  assert.deepEqual(empty.signals, []);
  assert.notEqual(red.id, green.id);
});

test("завершение токена создаёт введённое имя одной отменой и не трогает чужое", () => {
  const editor = createConfigurationEditor({
    text: `Arithmetic({
      red_input: red_limit,
      left_operand: null,
      right_operand: null,
      operation: Arithmetic.Operation.SUM
    })`,
  });
  const limitId = editor.index().networks.find((item) => item.name === "red_limit").id;
  editor.replace("Arithmetic({ red_input: red_limit, red_output: red_limi");
  assert.equal(editor.index().networks.some((item) => item.name === "red_limi"), false);
  const token = "red_output: red_limi";
  const offset = editor.text.indexOf(token) + token.length;
  const found = editor.suggestions({ offset, revision: editor.revision });
  assert.equal(found.context.kind, "network");
  assert.equal(found.context.slice, "red_limi");
  assert.equal(found.items.some((item) => item.kind === "create" || item.name === "red_new"), false);
  assert.equal(found.items.some((item) => item.name === "red_limit"), true);
  assert.equal(found.items.some((item) => item.name === "red_limi"), false);
  const finished = editor.finishNetwork({
    revision: found.revision,
    color: found.context.color,
    name: found.context.slice,
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: offset,
    selectionEnd: offset,
  });
  assert.equal(finished.applied, true);
  assert.equal(finished.text, "red_limi");
  const ordered = editor.suggestions({ kind: "network", color: "red", query: "red_limi" }).items.map((item) => item.name);
  assert.equal(ordered[0], "red_limi");
  assert.equal(ordered.includes("red_limit"), true);
  assert.equal(ordered.includes("red_new"), false);
  const created = editor.index().networks.find((item) => item.name === "red_limi");
  assert.equal(created.color, "red");
  assert.equal(editor.index().networks.find((item) => item.name === "red_limit").id, limitId);
  const revision = editor.revision;
  const again = editor.finishNetwork({
    revision,
    color: "red",
    name: "red_limi",
    range: found.context.range,
    anchor: editor.suggestions({ offset, revision }).anchor,
    selectionStart: offset,
    selectionEnd: offset,
  });
  assert.equal(again.reason, "repeat");
  assert.equal(editor.revision, revision);
  assert.equal(editor.index().networks.filter((item) => item.name === "red_limi").length, 1);
  assert.equal(editor.undo().applied, true);
  assert.equal(editor.index().networks.some((item) => item.name === "red_limi"), false);
  assert.equal(editor.index().networks.find((item) => item.name === "red_limit").id, limitId);
  assert.equal(editor.redo().applied, true);
  assert.equal(editor.index().networks.find((item) => item.name === "red_limi").id, created.id);

  editor.replace(editor.text.replace("red_input:", "red_input: "));
  const stale = editor.finishNetwork({
    revision: editor.revision,
    color: "red",
    name: "red_other",
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: offset,
    selectionEnd: offset,
  });
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, "stale");
  assert.equal(editor.index().networks.some((item) => item.name === "red_other"), false);
  assert.equal(editor.text.includes("red_other"), false);
  assert.equal(editor.index().networks.find((item) => item.name === "red_limit").id, limitId);
});

test("Tab, служебное имя и невалидный ввод не создают лишнюю сеть", () => {
  const text = "Arithmetic({ red_input: red_limi";
  const editor = createConfigurationEditor({ text });
  const offset = text.indexOf("red_limi") + "red_limi".length;
  const found = editor.suggestions({ offset });
  const tabbed = editor.finishNetwork({
    revision: found.revision,
    color: "red",
    name: "red_limi",
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: offset,
    selectionEnd: offset,
    tab: true,
  });
  assert.equal(tabbed.text, "red_limi\t");
  assert.match(editor.text, /red_limi\t/);
  const id = editor.index().networks.find((item) => item.name === "red_limi").id;
  assert.equal(editor.undo().applied, true);
  assert.equal(editor.text, text);
  assert.equal(editor.index().networks.some((item) => item.name === "red_limi"), false);
  assert.equal(editor.redo().applied, true);
  assert.equal(editor.index().networks.find((item) => item.name === "red_limi").id, id);

  const service = createConfigurationEditor({ text: "Arithmetic({ green_input: green_new" });
  const serviceAt = service.text.indexOf("green_new") + "green_new".length;
  const serviceFound = service.suggestions({ offset: serviceAt });
  const named = service.finishNetwork({
    revision: serviceFound.revision,
    color: "green",
    name: serviceFound.context.slice,
    range: serviceFound.context.range,
    anchor: serviceFound.anchor,
    selectionStart: serviceAt,
    selectionEnd: serviceAt,
  });
  assert.match(named.text, /^green_\d+$/);
  assert.equal(service.text.includes("green_new"), false);
  assert.equal(service.index().networks.some((item) => item.name === "green_new"), false);
  assert.equal(service.index().networks.some((item) => item.name === named.text), true);

  const ignored = createConfigurationEditor({ text: "Arithmetic({ red_input: red_1" });
  const kept = ignored.index().networks.map((item) => item.name);
  const at = ignored.text.indexOf("red_1") + "red_1".length;
  const open = ignored.suggestions({ offset: at });
  for (const name of ["", "red_", "null", "green_1", "foo"]) {
    const outcome = ignored.finishNetwork({
      revision: ignored.revision,
      color: "red",
      name,
      range: open.context.range,
      anchor: open.anchor,
      selectionStart: at,
      selectionEnd: at,
    });
    assert.equal(outcome.applied, false, name);
  }
  assert.deepEqual(ignored.index().networks.map((item) => item.name), kept);
  assert.equal(ignored.text, "Arithmetic({ red_input: red_1");
});

test("пустая история не меняет документ, новая правка очищает повтор", () => {
  const editor = createConfigurationEditor({ text: "Constant({ enabled: true })" });
  const text = editor.text;
  const revision = editor.revision;
  assert.equal(editor.canUndo, false);
  assert.equal(editor.canRedo, false);
  assert.equal(editor.undo().applied, false);
  assert.equal(editor.redo().applied, false);
  assert.equal(editor.text, text);
  assert.equal(editor.revision, revision);

  const next = `${text}\n`;
  editor.replace(next, {
    before: { start: text.length, end: text.length },
    after: { start: next.length, end: next.length },
  });
  assert.equal(editor.canUndo, true);
  assert.equal(editor.canRedo, false);
  const undone = editor.undo();
  assert.equal(undone.applied, true);
  assert.equal(editor.text, text);
  assert.deepEqual(undone.cursor, { start: text.length, end: text.length });
  assert.equal(editor.canUndo, false);
  assert.equal(editor.canRedo, true);
  const redone = editor.redo();
  assert.equal(redone.applied, true);
  assert.equal(editor.text, next);
  assert.deepEqual(redone.cursor, { start: next.length, end: next.length });

  editor.replace("Arithmetic({})");
  assert.equal(editor.canRedo, false);
  assert.equal(editor.redo().applied, false);
  assert.equal(editor.text, "Arithmetic({})");
});

test("блокирующие ошибки несут диапазон токена, пути, значения или конца текста", () => {
  const signal = createConfigurationEditor({
    text: `Decider({
      red_input: red_1,
      conditions: [{
        left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
        right_operand: { constant: 1 },
        operation: Decider.Operation.GT
      }],
      when_true: [{ signal: SSignal.Signals.signal_A, constant: 1 }]
    })`,
  });
  const path = signal.diagnostics.find((item) => item.code === "unknown-path");
  assert.equal(signal.text.slice(path.range.start, path.range.end), "SSignal.Signals.signal_A");
  assert.match(path.message, /SSignal\.Signals\.signal_A/);
  assert.equal(signal.canLaunch, false);

  const fixed = createConfigurationEditor({ text: signal.text.replace("SSignal", "Signal") });
  assert.equal(fixed.diagnostics.some((item) => item.code === "unknown-path"), false);

  const value = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, green: false, signal: ${chest} },
      right_operand: { constant: "5" },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  const quoted = value.diagnostics.find((item) => item.field === "adder.right_operand.constant");
  assert.equal(value.text.slice(quoted.range.start, quoted.range.end), "\"5\"");

  const missing = createConfigurationEditor({
    text: arithmetic(`
      left_operand: { red: true, signal: ${chest} },
      right_operand: { constant: 1 },
      operation: Arithmetic.Operation.SUM,
      return: ${chest}
    `),
  });
  const green = missing.diagnostics.find((item) => item.field === "adder.left_operand.green");
  const object = missing.text.slice(green.range.start, green.range.end);
  assert.match(object, /\{ red: true, signal:/);
  assert.ok(green.range.start > 0);

  const network = createConfigurationEditor({
    text: "Arithmetic({ red_input: blue_1 })",
  });
  const name = network.diagnostics.find((item) => item.code === "invalid-name");
  assert.equal(network.text.slice(name.range.start, name.range.end), "blue_1");

  const eof = createConfigurationEditor({ text: "Arithmetic({ red_input:" });
  const syntax = eof.diagnostics.find((item) => item.code === "syntax");
  assert.equal(syntax.range.start, eof.text.length);
  assert.equal(syntax.range.end, eof.text.length);
  assert.ok(eof.diagnostics.every((item) => item.range.start !== 0 || item.range.end !== 0));

  const several = createConfigurationEditor({
    text: `Arithmetic({
      red_input: blue_1,
      right_operand: { constant: 1.5 },
      return: SSignal.Signals.signal_A
    })`,
  });
  const slices = several.diagnostics.map((item) => several.text.slice(item.range.start, item.range.end));
  assert.ok(slices.includes("blue_1"));
  assert.ok(slices.includes("1.5"));
  assert.ok(slices.includes("SSignal.Signals.signal_A"));
  assert.equal(several.canLaunch, false);

  const clean = createConfigurationEditor();
  assert.equal(clean.diagnostics.length, 0);
  assert.equal(clean.canLaunch, true);
  const broken = clean.text.replaceAll("Signal.Logistic.wooden_chest", "SSignal.Logistic.wooden_chest");
  clean.replace(broken);
  assert.ok(clean.diagnostics.some((item) => clean.text.slice(item.range.start, item.range.end).startsWith("SSignal")));
  assert.equal(clean.canLaunch, false);
  clean.undo();
  assert.equal(clean.diagnostics.length, 0);
  assert.equal(clean.canLaunch, true);
  assert.equal(clean.text.includes("SSignal"), false);
});
