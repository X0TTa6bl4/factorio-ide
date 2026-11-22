import assert from "node:assert/strict";
import test from "node:test";
import { Circuit, createNetworkEditor } from "../../../src/index.js";
import { throwsCode } from "../signals/support.mjs";

const LINKED = `// red_1
constant source {
  label: "red_1"
  red_output: red_1
  signal signal_A 5
}

wire reader {
  red_input: red_1
}
`;

const OPEN = `wire lamp {
  green_input: null
  red_input: null
}
`;

function names(items) {
  return items.map((item) => item.name);
}

function entry(editor, name) {
  return editor.index().entries.find((item) => item.name === name) ?? null;
}

test("01 два порта получают один объект и ID", () => {
  const editor = createNetworkEditor({ text: `wire reader {\n  red_input: null\n  red_output: null\n}\n` });
  const created = editor.applySuggestion({ device: "reader", port: "red_input", choice: "new" });
  const reused = editor.applySuggestion({ device: "reader", port: "red_output", choice: "network", name: "red_1" });
  assert.equal(created.applied, true);
  assert.equal(created.name, "red_1");
  assert.equal(reused.id, created.id);
  assert.equal(entry(editor, "red_1").uses.length, 2);
  assert.equal(editor.text.includes("red_new"), false);
  const saved = createNetworkEditor();
  saved.load(LINKED);
  assert.equal(entry(saved, "red_1").uses.length, 2);
  assert.equal(new Set(saved.retained().ports.map((port) => port.id)).size, 1);
});

test("02 08 переименование сохраняет ID и не трогает комментарий со строкой", () => {
  const editor = createNetworkEditor();
  editor.load(LINKED);
  const id = entry(editor, "red_1").id;
  const renamed = editor.rename("red_1", "red_main");
  assert.equal(renamed.id, id);
  assert.equal(entry(editor, "red_main").id, id);
  assert.equal(entry(editor, "red_main").uses.length, 2);
  assert.match(editor.text, /\/\/ red_1/);
  assert.match(editor.text, /"red_1"/);
  assert.match(editor.text, /red_output: red_main/);
  assert.match(editor.text, /red_input: red_main/);
  assert.equal(editor.text.includes("red_output: red_1"), false);
  editor.undo();
  assert.equal(entry(editor, "red_1").id, id);
  assert.match(editor.text, /red_output: red_1/);
});

test("03 чужой цвет, строка и чужая схема блокируют запуск", async () => {
  const editor = createNetworkEditor({ text: OPEN });
  editor.applySuggestion({ device: "lamp", port: "green_input", choice: "create", name: "green_1" });
  editor.replace(`wire lamp {\n  green_input: green_1\n  red_input: green_1\n}\n`);
  assert.equal(editor.diagnostics.some((item) => item.code === "wrong-color" && item.field === "red_input"), true);
  assert.equal(editor.canLaunch, false);
  assert.equal((await editor.launch()).applied, false);
  assert.equal(entry(editor, "green_1").id !== undefined, true);

  editor.replace(`wire lamp {\n  green_input: green_1\n  red_input: "red_1"\n}\n`);
  assert.equal(editor.diagnostics.some((item) => item.code === "invalid-port" && item.field === "red_input"), true);
  assert.equal((await editor.launch()).applied, false);

  const other = new Circuit();
  const foreign = other.network("red_2");
  assert.equal(editor.diagnose("red", foreign).code, "foreign-network");
  assert.equal(editor.diagnose("red", "red_2").code, "invalid-port");
  assert.equal(editor.diagnose("green", null).ok, true);
  assert.equal(entry(editor, "green_1") !== null, true);
});

test("04 отмена удаления не меняет схему, подтверждение не оставляет ссылку", () => {
  const editor = createNetworkEditor();
  editor.load(LINKED);
  const id = entry(editor, "red_1").id;
  const before = editor.text;
  const plan = editor.planRemoval("red_1");
  assert.equal(plan.uses.length, 2);
  assert.deepEqual(editor.cancelRemoval(), { changed: false, revision: editor.revision, text: before });
  assert.equal(editor.text, before);
  assert.equal(entry(editor, "red_1").id, id);
  const removed = editor.commitRemoval("red_1");
  assert.equal(removed.removed, true);
  assert.equal(removed.id, id);
  assert.equal(entry(editor, "red_1"), null);
  assert.equal(editor.ports().every((port) => port.text === "null"), true);
  assert.match(editor.text, /red_output: null/);
  assert.match(editor.text, /red_input: null/);
  assert.match(editor.text, /\/\/ red_1/);
  editor.undo();
  assert.equal(entry(editor, "red_1").id, id);
});

test("05 правка во время запуска снимает текущие результаты", async () => {
  const editor = createNetworkEditor();
  editor.load(LINKED);
  const started = await editor.launch();
  assert.equal(started.applied, true);
  assert.equal(started.tick, 0);
  const live = editor.publication();
  assert.equal(live.current, true);
  assert.equal(live.networks.find((network) => network.name === "red_1").signals[0].constant, 5);
  const pending = editor.launch();
  editor.replace(`${editor.text}\n`);
  const stale = await pending;
  assert.equal(stale.applied, false);
  assert.equal(stale.stale, true);
  assert.equal(editor.publication(), null);
  assert.equal(editor.view().current, false);
  const again = await editor.launch();
  assert.equal(again.applied, true);
  await editor.step();
  assert.equal(editor.publication().tick, 1);
  editor.replace(editor.text.replace("signal signal_A 5", "signal signal_A 9"));
  assert.equal(editor.publication(), null);
  assert.equal(editor.view().current, false);
  assert.equal(editor.status === "ready", false);
});

test("06 пустой порт остаётся null, неизвестное имя не создаёт сеть", async () => {
  const editor = createNetworkEditor({ text: `wire reader {\n  red_input: null\n}\n` });
  assert.equal(editor.ports()[0].kind, "null");
  assert.equal(editor.index().entries.length, 0);
  editor.replace(`wire reader {\n  red_input: red_99\n}\n`);
  assert.equal(editor.diagnostics.some((item) => item.code === "unknown-network" && item.field === "red_input"), true);
  assert.equal(editor.index().entries.length, 0);
  assert.equal(editor.canLaunch, false);
  assert.equal((await editor.launch()).applied, false);
  assert.equal(editor.index().entries.length, 0);
});

test("ED-N1 ввод g показывает green_new и зелёные сети по MRU", () => {
  const editor = createNetworkEditor({
    text: `wire reader {\n  green_input: null\n  green_output: null\n  red_input: null\n}\nconstant source {\n  green_output: null\n}\n`,
  });
  editor.applySuggestion({ device: "reader", port: "green_input", choice: "create", name: "green_55" });
  editor.applySuggestion({ device: "reader", port: "green_output", choice: "create", name: "green_22" });
  editor.applySuggestion({ device: "source", port: "green_output", choice: "create", name: "green_25" });
  editor.applySuggestion({ device: "reader", port: "red_input", choice: "create", name: "red_9" });
  const listed = editor.suggestions({ color: "green", query: "g" });
  assert.deepEqual(names(listed.items), ["green_25", "green_22", "green_55", "green_new"]);
  assert.equal(listed.items.at(-1).kind, "new");
  assert.equal(listed.items.some((item) => item.kind === "create"), false);
  assert.equal(listed.items.some((item) => item.name.startsWith("red_")), false);
});

test("ED-N2 green_new создаёт green_1 одной транзакцией undo", () => {
  const editor = createNetworkEditor({ text: OPEN });
  assert.equal(editor.suggestions({ color: "green", query: "g" }).items[0].name, "green_new");
  assert.equal(editor.suggestions({ color: "green", query: "g" }).items.some((item) => item.kind === "create"), false);
  assert.equal(entry(editor, "green_1"), null);
  assert.equal(entry(editor, "green_2"), null);
  const created = editor.applySuggestion({ device: "lamp", port: "green_input", choice: "new" });
  assert.equal(created.name, "green_1");
  assert.match(editor.text, /green_input: green_1/);
  assert.equal(editor.text.includes("green_new"), false);
  const id = created.id;
  assert.equal(editor.undo().applied, true);
  assert.match(editor.text, /green_input: null/);
  assert.equal(entry(editor, "green_1"), null);
  assert.equal(editor.canUndo, false);
  assert.equal(editor.redo().applied, true);
  assert.equal(entry(editor, "green_1").id, id);
});

test("ED-N3 префикс оставляет совпадения, создание и своё имя", () => {
  const editor = createNetworkEditor({
    text: `wire reader {\n  green_input: null\n  green_output: null\n}\nconstant source {\n  green_output: null\n}\n`,
  });
  editor.applySuggestion({ device: "reader", port: "green_input", choice: "create", name: "green_buffer1" });
  editor.applySuggestion({ device: "reader", port: "green_output", choice: "create", name: "green_other" });
  editor.applySuggestion({ device: "source", port: "green_output", choice: "create", name: "green_buffer2" });
  const listed = editor.suggestions({ color: "green", query: "green_buffer" });
  assert.deepEqual(names(listed.items), ["green_buffer2", "green_buffer1"]);
  assert.equal(listed.items.some((item) => item.kind === "create" || item.name === "green_new"), false);
  assert.equal(listed.items.some((item) => item.name === "green_other"), false);
});

test("ED-N4 последняя ссылка удаляет сеть, новое создание получает другой ID", () => {
  const editor = createNetworkEditor({ text: OPEN });
  const created = editor.applySuggestion({ device: "lamp", port: "green_input", choice: "new" });
  editor.replace(`wire lamp {\n  green_input: null\n  red_input: null\n}\n`);
  assert.equal(entry(editor, "green_1"), null);
  assert.equal(editor.suggestions({ color: "green", query: "green_1" }).items.some((item) => item.kind === "create"), false);
  const again = editor.applySuggestion({ device: "lamp", port: "green_input", choice: "create", name: "green_1" });
  assert.notEqual(again.id, created.id);
});

test("ED-N5 синтаксическая ошибка не удаляет сеть и блокирует запуск", async () => {
  const editor = createNetworkEditor();
  editor.load(LINKED);
  const id = entry(editor, "red_1").id;
  const retainedId = editor.retained().networks[0].id;
  editor.replace(`wire reader {\n  red_input: red_1\n`);
  assert.equal(entry(editor, "red_1").id, id);
  assert.equal(editor.canLaunch, false);
  assert.equal(editor.retained().matchesText, false);
  assert.equal(editor.retained().networks.some((network) => network.id === retainedId), true);
  assert.equal((await editor.launch()).applied, false);
  assert.equal(entry(editor, "red_1").id, id);
});

test("ED-N6 поздняя revision и кеш цвета не подменяют полную сборку", async () => {
  const editor = createNetworkEditor({ text: `wire lamp {\n  green_input: green_1\n  red_input: null\n}\n` });
  editor.load(editor.text);
  while (editor.revision < 11) editor.replace(`${editor.text}\n`);
  assert.equal(editor.revision, 11);
  const id = entry(editor, "green_1").id;
  assert.deepEqual(editor.completeParse(10, { cache: { green_1: "red" }, drop: "green_1" }), {
    applied: false,
    revision: 11,
  });
  assert.equal(editor.hintCache, null);
  assert.equal(entry(editor, "green_1").id, id);
  editor.replace(`wire lamp {\n  green_input: green_1\n  red_input: green_1\n}\n`);
  assert.equal(editor.completeParse(editor.revision, { cache: { ok: true } }).applied, true);
  assert.deepEqual(editor.hintCache, { ok: true });
  const launched = await editor.launch();
  assert.equal(launched.applied, false);
  assert.equal(editor.diagnostics.some((item) => item.code === "wrong-color"), true);
  const hinted = editor.suggestions({ color: "green", query: "red_9" });
  assert.equal(hinted.items.some((item) => item.name === "red_9"), false);
});

test("ED-N7 наведение не меняет MRU, подтверждённая вставка меняет", () => {
  const editor = createNetworkEditor({
    text: `wire reader {\n  green_input: null\n  green_output: null\n}\n`,
  });
  editor.applySuggestion({ device: "reader", port: "green_input", choice: "create", name: "green_25" });
  editor.applySuggestion({ device: "reader", port: "green_output", choice: "create", name: "green_22" });
  const before = editor.preview("green_25").mru;
  assert.equal(editor.preview("green_25").mru, before);
  assert.equal(editor.preview("green_22").mru > before, true);
  editor.suggestions({ color: "green", query: "green_" });
  assert.equal(editor.preview("green_25").mru, before);
  editor.applySuggestion({ device: "reader", port: "green_output", choice: "network", name: "green_25" });
  assert.equal(editor.preview("green_25").mru > before, true);
  assert.deepEqual(names(editor.suggestions({ color: "green", query: "g" }).items), ["green_25", "green_new"]);
});

test("ED-N8 undo создания восстанавливает тот же ID", () => {
  const editor = createNetworkEditor({ text: OPEN });
  const created = editor.applySuggestion({ device: "lamp", port: "red_input", choice: "new" });
  editor.undo();
  editor.redo();
  assert.equal(entry(editor, "red_1").id, created.id);
  editor.commitRemoval("red_1");
  editor.undo();
  assert.equal(entry(editor, "red_1").id, created.id);
});

test("ED-N9 пустая таблица не удаляет подключённую сеть", async () => {
  const editor = createNetworkEditor({
    text: `constant source {\n  red_output: red_1\n}\nwire reader {\n  red_input: red_1\n}\n`,
  });
  editor.load(editor.text);
  const id = entry(editor, "red_1").id;
  const launched = await editor.launch();
  assert.equal(launched.applied, true);
  const network = editor.publication().networks.find((item) => item.id === id);
  assert.deepEqual(network.signals, []);
  await editor.step();
  assert.equal(entry(editor, "red_1").id, id);
  assert.equal(entry(editor, "red_1").uses.length, 2);
  assert.deepEqual(editor.publication().networks.find((item) => item.id === id).signals, []);
});

test("индекс редактора не хранит сигналы тика", async () => {
  const editor = createNetworkEditor();
  editor.load(LINKED);
  await editor.launch();
  const index = editor.index();
  assert.equal(Object.hasOwn(index, "signals"), false);
  assert.equal(Object.hasOwn(index, "current"), false);
  assert.equal(Object.hasOwn(index, "next"), false);
  for (const item of index.entries) {
    assert.equal(Object.hasOwn(item, "signals"), false);
    assert.equal(Object.hasOwn(item, "current"), false);
    assert.equal(Object.hasOwn(item, "next"), false);
  }
  assert.equal(editor.publication().current, true);
});

test("равный MRU сортируется по имени, повтор текста не двигает его", () => {
  const editor = createNetworkEditor({
    text: `// keep\nwire reader {\n  green_input: green_25\n  green_output: green_2\n}\n`,
  });
  editor.load(editor.text);
  const listed = names(editor.suggestions({ color: "green", query: "" }).items);
  assert.deepEqual(listed, ["green_2", "green_25", "green_new", "null"]);
  const revision = editor.revision;
  const before = editor.preview("green_25").mru;
  assert.deepEqual(editor.replace(editor.text), { changed: false, revision });
  assert.equal(editor.preview("green_25").mru, before);
  editor.replace(editor.text.replace("//", "// note"));
  assert.equal(editor.preview("green_25").mru, before);
});

test("устаревшая подсказка не меняет документ", () => {
  const editor = createNetworkEditor({ text: OPEN });
  const revision = editor.revision;
  assert.deepEqual(editor.suggestions({ color: "green", query: "g", revision: revision - 1 }), {
    applied: false,
    revision,
    items: [],
  });
  assert.deepEqual(
    editor.applySuggestion({ device: "lamp", port: "green_input", choice: "new", revision: revision - 1 }),
    { applied: false, revision },
  );
  assert.match(editor.text, /green_input: null/);
});

test("ошибочное создание и вставка в constant откатываются", () => {
  const editor = createNetworkEditor({ text: `constant source {\n  red_input: null\n  red_output: null\n}\n` });
  throwsCode(() => editor.applySuggestion({ device: "source", port: "red_output", choice: "create", name: "green_1" }), "wrong-color");
  throwsCode(() => editor.applySuggestion({ device: "source", port: "red_output", choice: "create", name: "red_new" }), "invalid-name");
  const rolled = editor.applySuggestion({ device: "source", port: "red_input", choice: "new" });
  assert.equal(rolled.applied, false);
  assert.match(editor.text, /red_input: null/);
  assert.equal(editor.index().entries.length, 0);
  assert.equal(editor.diagnostics.some((item) => item.code === "forbidden-input"), false);
});

test("провод, метасигнал и повтор устройства дают диагностику поля", async () => {
  const editor = createNetworkEditor({ text: `wire reader {\n  red_input: null\n  signal signal_A 1\n}\n` });
  assert.equal(editor.diagnostics[0].code, "invalid-field");
  assert.equal(editor.canLaunch, false);
  editor.replace(`constant source {\n  red_output: null\n  signal signal_each 1\n}\n`);
  assert.equal(editor.diagnostics.some((item) => item.code === "meta-signal"), true);
  editor.replace(`wire reader {\n  red_input: null\n}\nwire reader {\n  red_output: null\n}\n`);
  assert.equal(editor.diagnostics.some((item) => item.code === "duplicate-device"), true);
  assert.equal((await editor.launch()).applied, false);
});

test("границы разбора, отказа и второго свободного имени", async () => {
  throwsCode(() => createNetworkEditor(null), "invalid-editor-options");
  throwsCode(() => createNetworkEditor({ text: 1 }), "invalid-document");
  const editor = createNetworkEditor({
    profile: "base",
    seed: 3,
    text: "/* keep */\nwire lamp {\n  red_input: null\n  green_input: null\n}\n// tail",
  });
  assert.equal(editor.canRedo, false);
  assert.equal(editor.undo().applied, false);
  assert.equal(editor.redo().applied, false);
  throwsCode(() => editor.replace(1), "invalid-document");
  throwsCode(() => editor.load(1), "invalid-document");
  throwsCode(() => editor.suggestions({ color: "blue" }), "wrong-color");
  assert.equal(editor.diagnose("blue", null).code, "wrong-color");
  assert.equal(editor.completeParse(editor.revision, null).applied, true);
  assert.equal(editor.completeParse(editor.revision, []).applied, true);
  assert.equal(editor.hintCache, null);

  editor.applySuggestion({ device: "lamp", port: "red_input", choice: "new" });
  const second = editor.applySuggestion({ device: "lamp", port: "red_input", choice: "new" });
  assert.equal(second.name, "red_2");
  throwsCode(() => editor.applySuggestion({ device: "missing", port: "red_input", choice: "null" }), "unknown-port");
  throwsCode(() => editor.applySuggestion({ device: "lamp", port: "red_input", choice: "other" }), "invalid-choice");
  throwsCode(() => editor.applySuggestion({ device: "lamp", port: "red_input", choice: "network", name: "red_9" }), "missing-network");
  editor.applySuggestion({ device: "lamp", port: "green_input", choice: "create", name: "green_1" });
  throwsCode(
    () => editor.applySuggestion({ device: "lamp", port: "red_input", choice: "network", name: "green_1" }),
    "wrong-color",
  );
  throwsCode(
    () => editor.applySuggestion({ device: "lamp", port: "red_input", choice: "create", name: "red_2" }),
    "occupied-name",
  );

  const syntax = [
    ["/*", "Комментарий не закрыт"],
    ["constant source {\n  label: \"ab", "Строка не закрыта"],
    ["wire lamp { red_input: null } @", "Недопустимый символ"],
    ["lamp x {}", "Ожидается constant или wire"],
    ["wire {", "У устройства нет имени"],
    ["wire lamp", "Ожидается блок устройства"],
    ["wire lamp { 1 }", "Ожидается поле устройства"],
    ["constant source { signal 1 }", "Сигнал записывается"],
    ["constant source { enabled true }", "Ожидается двоеточие"],
    ["constant source { red_output: }", "Ожидается значение поля"],
    ["constant source { enabled: 1 }", "enabled принимает"],
    ["constant source { label: red_1 }", "Подпись label"],
    ["constant source { title: 1 }", "Неизвестное поле"],
  ];
  for (const [text, message] of syntax) {
    editor.replace(text);
    assert.equal(editor.diagnostics[0].code, "syntax");
    assert.match(editor.diagnostics[0].message, new RegExp(message));
  }
  throwsCode(() => editor.rename("red_2", "red_4"), "syntax");
  throwsCode(() => editor.commitRemoval("red_2"), "syntax");

  editor.replace("wire lamp {\n  red_input: 5\n}\n");
  assert.equal(editor.diagnostics[0].code, "invalid-port");
  editor.replace("wire lamp {\n  red_input: lamp\n}\n");
  assert.equal(editor.diagnostics[0].code, "invalid-port");
  editor.replace("wire lamp {\n  red_input: null\n  red_input: null\n}\n");
  assert.equal(editor.diagnostics.some((item) => item.code === "duplicate-field"), true);
  editor.replace("wire lamp {\n  enabled: true\n  red_input: null\n}\n");
  assert.equal(editor.diagnostics.some((item) => item.code === "invalid-field"), true);
  editor.replace("constant source {\n  enabled: false\n  red_output: null\n  signal signal_A -3\n  signal missing_signal 1\n  signal signal_A 2147483648\n}\n");
  assert.equal(editor.diagnostics.some((item) => item.code === "invalid-signal"), true);
  assert.equal(editor.diagnostics.some((item) => item.code === "invalid-constant"), true);
  const blocked = editor.load("wire lamp {\n  red_input: \"x\"\n}\n");
  assert.deepEqual(blocked.declared, []);
  editor.resetRun();
  assert.equal(editor.status, "invalid");
  const refused = await editor.step();
  assert.equal(refused.applied, false);

  const running = createNetworkEditor();
  running.load(LINKED);
  await running.launch();
  const pending = running.step();
  running.replace(`${running.text}\n`);
  assert.equal((await pending).stale, true);
  running.resetRun();
  assert.equal(running.status, "editing");
  const noted = createNetworkEditor({
    text: "constant source {\n  label: \"a\\\\b\"\n  red_output: null\n}\n",
  });
  assert.equal(noted.text.includes("a\\\\b"), true);
  assert.equal(noted.canLaunch, true);
});

test("Circuit возвращает исключённую сеть с тем же ID", () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  assert.equal(circuit.restoreNetwork(red, "red_3").name, "red_3");
  const green = circuit.network("green_1");
  circuit.detachNetwork(red);
  assert.equal(red.circuit, null);
  assert.equal(circuit.networks.includes(red), false);
  assert.equal(circuit.restoreNetwork(red).id, red.id);
  assert.equal(circuit.networks.includes(red), true);
  circuit.detachNetwork(red);
  assert.equal(circuit.restoreNetwork(red, "red_2").name, "red_2");
  assert.equal(red.id, "n1");
  throwsCode(() => circuit.restoreNetwork(red, "green_2"), "wrong-color");
  circuit.detachNetwork(green);
  circuit.network("green_1");
  throwsCode(() => circuit.restoreNetwork(green, "green_1"), "occupied-name");
  throwsCode(() => circuit.restoreNetwork(new Circuit().network("red_9"), "red_8"), "foreign-network");
  throwsCode(() => circuit.restoreNetwork({ name: "red_1" }, "red_3"), "foreign-network");
  throwsCode(() => circuit.detachNetwork(new Circuit().network("red_4")), "foreign-network");
});

test("точное имя выше префикса, служебный пункт только по своему префиксу", () => {
  const editor = createNetworkEditor({
    text: `wire lamp {\n  red_input: null\n  red_output: null\n  green_input: null\n  green_output: null\n}\n`,
  });
  editor.applySuggestion({ device: "lamp", port: "red_input", choice: "create", name: "red_t" });
  editor.applySuggestion({ device: "lamp", port: "red_output", choice: "create", name: "red_ta" });
  editor.applySuggestion({ device: "lamp", port: "green_input", choice: "create", name: "green_t" });
  editor.applySuggestion({ device: "lamp", port: "green_output", choice: "create", name: "green_ta" });
  const red = names(editor.suggestions({ color: "red", query: "red_t" }).items);
  assert.deepEqual(red, ["red_t", "red_ta"]);
  assert.equal(red.includes("red_new"), false);
  const redN = names(editor.suggestions({ color: "red", query: "red_n" }).items);
  assert.deepEqual(redN, ["red_new"]);
  const green = names(editor.suggestions({ color: "green", query: "green_t" }).items);
  assert.deepEqual(green, ["green_t", "green_ta"]);
  assert.equal(green.includes("green_new"), false);
  const greenN = names(editor.suggestions({ color: "green", query: "green_n" }).items);
  assert.deepEqual(greenN, ["green_new"]);
  assert.equal(editor.suggestions({ color: "red", query: "red_" }).items.at(-1).name, "red_new");
  assert.equal(editor.suggestions({ color: "green", query: "" }).items.some((item) => item.kind === "create"), false);
});
