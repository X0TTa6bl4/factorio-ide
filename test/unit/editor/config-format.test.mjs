import assert from "node:assert/strict";
import test from "node:test";

import { createConfigurationEditor } from "../../../src/config-editor.js";
import { formatConfiguration } from "../../../src/config-format.js";

const chest = "Signal.Logistic.wooden_chest";

function shape(editor) {
  const model = editor.model();
  if (!model) return null;
  return {
    devices: model.devices.map((item) => ({ name: item.name, kind: item.kind, config: item.config })),
    wires: model.wires,
    peers: model.peers,
  };
}

test("поля идут в порядке подсказок, модель и комментарии сохраняются", () => {
  const source = `Arithmetic({
  return: ${chest}, // выход
  // вход
  red_input: red_1,
  green_output: green_1,
  right_operand: { constant: 2 },
  operation: Arithmetic.Operation.SUM,
  left_operand: { signal: ${chest}, green: true, red: true }
})`;
  const formatted = formatConfiguration(source);
  assert.equal(formatted.changed, true);
  assert.equal(formatted.text, `Arithmetic({
	// вход
	red_input: red_1,
	green_output: green_1,
	left_operand: { red: true, green: true, signal: ${chest} },
	right_operand: { constant: 2 },
	operation: Arithmetic.Operation.SUM,
	return: ${chest} // выход
})
`);
  assert.equal(formatConfiguration(formatted.text).changed, false);
  assert.equal(formatConfiguration(formatted.text).text, formatted.text);
  const before = createConfigurationEditor({ text: source });
  const after = createConfigurationEditor({ text: formatted.text });
  assert.equal(before.diagnostics.length, 0);
  assert.equal(after.diagnostics.length, 0);
  assert.deepEqual(shape(after), shape(before));
});

test("вложенные типы упорядочиваются, state и неизвестные ключи остаются", () => {
  const source = `event clock = new EventCombinator({
  run: { input_changed: false, every_tick: true },
  state: { zeta: 1, alpha: 2 }
})
Decider({
  when_true: [{ constant: 1, signal: ${chest} }],
  conditions: [{ logic: Decider.Logic.AND, operation: Decider.Operation.GT, right_operand: { constant: 0 }, left_operand: { signal: ${chest}, green: false, red: true } }],
  red_input: red_1
})
Selector({
  signal: ${chest},
  index: { constant: 0 },
  operation: Selector.Operation.SELECT,
  red_input: red_1,
  compare: Selector.Compare.EQ,
  sort: Selector.Sort.DESC
})
Constant({
  custom: 1,
  enabled: true,
  extra: 2,
  note: "a\\\\nb"
})`;
  const formatted = formatConfiguration(source);
  assert.equal(formatted.text, `event clock = new EventCombinator({
	state: { zeta: 1, alpha: 2 },
	run: { every_tick: true, input_changed: false }
})

Decider({
	red_input: red_1,
	conditions: [{
		left_operand: { red: true, green: false, signal: ${chest} },
		right_operand: { constant: 0 },
		operation: Decider.Operation.GT,
		logic: Decider.Logic.AND
	}],
	when_true: [{ signal: ${chest}, constant: 1 }]
})

Selector({
	red_input: red_1,
	operation: Selector.Operation.SELECT,
	sort: Selector.Sort.DESC,
	index: { constant: 0 },
	compare: Selector.Compare.EQ,
	signal: ${chest}
})

Constant({
	enabled: true,
	custom: 1,
	extra: 2,
	note: "a\\\\nb"
})
`);
  assert.equal(formatConfiguration(formatted.text).text, formatted.text);
  const before = createConfigurationEditor({ text: source });
  const after = createConfigurationEditor({ text: formatted.text });
  assert.deepEqual(shape(after), shape(before));
});

test("синтаксическая ошибка и запрещённый эффект не меняют текст", () => {
  globalThis.alert = () => {
    throw new Error("executed");
  };
  const broken = "Constant({ enabled: true";
  const syntax = formatConfiguration(broken, { start: 4, end: 8 });
  assert.equal(syntax.changed, false);
  assert.equal(syntax.reason, "syntax");
  assert.equal(syntax.text, broken);
  assert.deepEqual(syntax.caret, { start: 4, end: 8 });
  const evil = `Constant({ enabled: true })\nalert(1)`;
  const blocked = formatConfiguration(evil);
  assert.equal(blocked.changed, false);
  assert.equal(blocked.reason, "forbidden-effect");
  assert.equal(blocked.text, evil);
  const editor = createConfigurationEditor({ text: broken });
  const revision = editor.revision;
  assert.equal(editor.format({ start: 1, end: 1 }).applied, false);
  assert.equal(editor.revision, revision);
  assert.equal(editor.text, broken);
  assert.equal(editor.undo().applied, false);
});

test("форматирование — одна правка истории, каретка остаётся на токене", () => {
  const source = `Arithmetic({ return: ${chest}, red_input: red_1, green_output: green_1, left_operand: { red: true, green: true, signal: ${chest} }, right_operand: { constant: 2 }, operation: Arithmetic.Operation.SUM })`;
  const editor = createConfigurationEditor({ text: source });
  const before = shape(editor);
  const at = source.indexOf("return");
  const outcome = editor.format({ start: at, end: at + "return".length });
  assert.equal(outcome.applied, true);
  assert.equal(editor.text.slice(outcome.cursor.start, outcome.cursor.end), "return");
  assert.equal(editor.text.indexOf("red_input") < editor.text.indexOf("return"), true);
  assert.deepEqual(shape(editor), before);
  assert.equal(editor.format(outcome.cursor).applied, false);
  assert.equal(editor.revision, outcome.revision);
  const undone = editor.undo();
  assert.equal(undone.applied, true);
  assert.equal(editor.text, source);
  assert.deepEqual(undone.cursor, { start: at, end: at + "return".length });
  const redone = editor.redo();
  assert.equal(redone.applied, true);
  assert.equal(editor.text.slice(redone.cursor.start, redone.cursor.end), "return");
  assert.notEqual(editor.text, source);
});

test("пустой объект не дополняется полями, порядок Selector совпадает с подсказками", () => {
  const bare = formatConfiguration("Constant({enabled:true})");
  assert.equal(bare.text, `Constant({
	enabled: true
})
`);
  assert.equal(bare.text.includes("signals"), false);
  const empty = formatConfiguration("Constant({ signals: [], enabled: true })\nwire red_1 { label: \"a\" }");
  assert.equal(empty.text, `Constant({
	enabled: true,
	signals: []
})

wire red_1 {
	label: "a"
}
`);
  assert.equal(formatConfiguration(empty.text).changed, false);
  const text = "Selector({\n\toperation: Selector.Operation.SELECT,\n\t})";
  const editor = createConfigurationEditor({ text });
  const offset = text.indexOf("\t})");
  const items = editor.suggestions({ offset }).items.map((item) => item.name);
  assert.deepEqual(items, [
    "red_input", "green_input", "red_output", "green_output",
    "sort", "index", "compare",
  ]);
});

const signal = "Signal.Signals.signal_A";
const signalB = "Signal.Signals.signal_B";
const signalC = "Signal.Signals.signal_C";

test("эталон Constant и Decider сжимает плоские объекты и оставляет условие многострочным", () => {
  const source = `Constant({ red_output: red_1, enabled: true, signals: [{ constant: 1, signal: ${signal} }] })
Decider({ when_true: [{ constant: 1, signal: ${signal} }], conditions: [{ operation: Decider.Operation.LTE, right_operand: { constant: 59 }, left_operand: { signal: ${signal}, green: false, red: true } }], red_output: red_1, red_input: red_1 })`;
  const expected = `Constant({
	enabled: true,
	signals: [{ signal: ${signal}, constant: 1 }],
	red_output: red_1
})

Decider({
	red_input: red_1,
	red_output: red_1,
	conditions: [{
		left_operand: { red: true, green: false, signal: ${signal} },
		right_operand: { constant: 59 },
		operation: Decider.Operation.LTE
	}],
	when_true: [{ signal: ${signal}, constant: 1 }]
})
`;
  const formatted = formatConfiguration(source);
  assert.equal(formatted.text, expected);
  assert.equal(formatted.text.includes("conditions: [{\n"), true);
  assert.equal(formatted.text.includes("}]"), true);
  assert.equal(formatConfiguration(formatted.text).changed, false);
  const typo = source.replace("when_true: [{ constant: 1, signal: Signal", "when_true: [{ constant: 1, signal: SSignal");
  const kept = formatConfiguration(typo);
  assert.equal(kept.text.includes("SSignal.Signals.signal_A"), true);
  assert.equal(kept.text.includes("signal: Signal.Signals.signal_A"), true);
  const before = createConfigurationEditor({ text: source });
  const after = createConfigurationEditor({ text: formatted.text });
  assert.equal(before.diagnostics.length, 0);
  assert.equal(after.diagnostics.length, 0);
  assert.deepEqual(shape(after), shape(before));
});

test("массивы из 0, 1, 2 и 3 элементов и вложенные массивы", () => {
  const source = `Constant({ signals: [], enabled: true })
Constant({ signals: [{ constant: 1, signal: ${signal} }], enabled: true })
Constant({ signals: [{ constant: 2, signal: ${signalB} }, { constant: 1, signal: ${signal} }], enabled: true })
Constant({ enabled: true, signals: [{ signal: ${signal}, constant: 1 }, { signal: ${signalB}, constant: 2 }, { signal: ${signalC}, constant: 3 }] })
Constant({
  enabled: true,
  sections: [
    { multiplier: 1, group: null, active: true, filters: [] },
    { filters: [{ max: null, min: 1, signal: ${signal} }], active: false, group: null, multiplier: 1 },
    { active: true, group: null, multiplier: 1, filters: [{ signal: ${signal}, min: 1, max: 2 }, { signal: ${signalB}, min: 3, max: null }] },
    { active: true, group: null, multiplier: 1, filters: [{ signal: ${signalC}, min: 5, max: null }, { signal: ${signal}, min: 1, max: 2 }, { signal: ${signalB}, min: 3, max: 4 }] }
  ]
})`;
  const expected = `Constant({
	enabled: true,
	signals: []
})

Constant({
	enabled: true,
	signals: [{ signal: ${signal}, constant: 1 }]
})

Constant({
	enabled: true,
	signals: [
		{ signal: ${signalB}, constant: 2 },
		{ signal: ${signal}, constant: 1 }
	]
})

Constant({
	enabled: true,
	signals: [
		{ signal: ${signal}, constant: 1 },
		{ signal: ${signalB}, constant: 2 },
		{ signal: ${signalC}, constant: 3 }
	]
})

Constant({
	enabled: true,
	sections: [
		{
			active: true,
			filters: [],
			group: null,
			multiplier: 1
		},
		{
			active: false,
			filters: [{ signal: ${signal}, min: 1, max: null }],
			group: null,
			multiplier: 1
		},
		{
			active: true,
			filters: [
				{ signal: ${signal}, min: 1, max: 2 },
				{ signal: ${signalB}, min: 3, max: null }
			],
			group: null,
			multiplier: 1
		},
		{
			active: true,
			filters: [
				{ signal: ${signalC}, min: 5, max: null },
				{ signal: ${signal}, min: 1, max: 2 },
				{ signal: ${signalB}, min: 3, max: 4 }
			],
			group: null,
			multiplier: 1
		}
	]
})
`;
  const formatted = formatConfiguration(source);
  assert.equal(formatted.text, expected);
  assert.equal(formatConfiguration(formatted.text).text, formatted.text);
  const before = createConfigurationEditor({ text: source });
  const after = createConfigurationEditor({ text: formatted.text });
  assert.equal(before.diagnostics.length, 0);
  assert.equal(after.diagnostics.length, 0);
  assert.deepEqual(shape(after), shape(before));
});

test("комментарий разворачивает свой контейнер и остаётся при поле", () => {
  const source = `Arithmetic({
  left_operand: { signal: ${chest}, // канал
    red: true, green: false },
  right_operand: { constant: 2 },
  operation: Arithmetic.Operation.SUM,
  return: ${chest}
})
Constant({
  enabled: true,
  signals: [
    // первый
    { constant: 1, signal: ${chest} }
  ],
  note: "a\\\\nb"
})`;
  const expected = `Arithmetic({
	left_operand: {
		red: true,
		green: false,
		signal: ${chest} // канал
	},
	right_operand: { constant: 2 },
	operation: Arithmetic.Operation.SUM,
	return: ${chest}
})

Constant({
	enabled: true,
	signals: [
		// первый
		{ signal: ${chest}, constant: 1 }
	],
	note: "a\\\\nb"
})
`;
  const formatted = formatConfiguration(source);
  assert.equal(formatted.text, expected);
  assert.equal(formatConfiguration(formatted.text).changed, false);
  const before = createConfigurationEditor({ text: source });
  const after = createConfigurationEditor({ text: formatted.text });
  assert.deepEqual(shape(after), shape(before));
});
