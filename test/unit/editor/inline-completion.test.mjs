import assert from "node:assert/strict";
import test from "node:test";
import { completionContext, nestAtCaret, structuralInsertion } from "../../../src/config-completion.js";
import { createConfigurationEditor } from "../../../src/config-editor.js";
import { eventCompletion } from "../../../src/event-complete.js";

const chest = "Signal.Logistic.wooden_chest";

function at(text, marker = "|") {
  const offset = text.indexOf(marker);
  assert.notEqual(offset, -1);
  return { text: text.replace(marker, ""), offset };
}

function listed(text, marker = "|") {
  const place = at(text, marker);
  const editor = createConfigurationEditor({ text: place.text });
  const before = editor.index().networks.map((item) => item.id);
  const result = editor.suggestions({ offset: place.offset, revision: editor.revision });
  assert.equal(result.applied, true);
  assert.deepEqual(editor.index().networks.map((item) => item.id), before);
  return { editor, ...place, ...result };
}

test("незаконченный набор открывает тип, сеть, сигнал и операцию", () => {
  const types = listed("Arith|");
  assert.equal(types.context.kind, "type");
  assert.equal(types.items.some((item) => item.name === "Arithmetic"), true);
  assert.equal(types.items.some((item) => item.name === "Decider"), false);

  const network = listed("Arithmetic({\n  red_input: red_|\n");
  assert.equal(network.context.kind, "network");
  assert.equal(network.context.color, "red");
  assert.equal(network.items[0].name, "red_new");
  assert.equal(network.items.some((item) => item.kind === "create"), false);
  assert.equal(network.items.some((item) => item.name.startsWith("green_")), false);

  const loose = listed("red_input: red_|");
  assert.equal(loose.context.color, "red");
  assert.equal(loose.items.some((item) => item.name.startsWith("green_")), false);

  const signal = listed("Arithmetic({\n  left_operand: { signal: Signal.Logistic.wood|\n");
  assert.equal(signal.context.kind, "signal");
  assert.equal(signal.items.some((item) => item.name === chest), true);
  assert.equal(signal.items.some((item) => item.name.includes("signal_everything")), false);

  const operation = listed("Arithmetic({\n  operation: Arithmetic.Operation.|\n");
  assert.equal(operation.context.kind, "operation");
  assert.equal(operation.items.length > 0, true);
  assert.equal(operation.items.every((item) => item.name.startsWith("Arithmetic.Operation.")), true);
  assert.equal(operation.items.some((item) => item.name.startsWith("Decider.")), false);
});

test("ключи, вложенный операнд и чужая операция зависят от места", () => {
  const keys = listed("Arithmetic({\n  lef|\n})");
  assert.equal(keys.context.kind, "key");
  assert.deepEqual(keys.items.map((item) => item.name), ["left_operand"]);

  const operand = listed("Arithmetic({\n  left_operand: { si|\n})");
  assert.equal(operand.items.some((item) => item.name === "signal"), true);
  assert.equal(operand.items.some((item) => item.name === "when_true"), false);

  const constant = listed("Arithmetic({\n  left_operand: { constant: 1, si|\n})");
  assert.equal(constant.items.some((item) => item.name === "signal"), false);

  const foreign = listed("Arithmetic({\n  operation: Decider.Operation.|\n})");
  assert.equal(foreign.items.length, 0);

  const meta = listed("Decider({\n  conditions: [{ right_operand: { signal: Signal.Meta.|\n}]})");
  assert.equal(meta.items.some((item) => item.kind === "signal" && item.name.includes("signal_")), false);

  const each = listed("Arithmetic({\n  left_operand: { signal: Signal.Meta.|\n})");
  assert.deepEqual(each.items.map((item) => item.name), ["Signal.Meta.signal_each"]);
});

test("диапазон не захватывает середину строки, выделение, комментарий и длинную строку", () => {
  const line = "Arithmetic({ red_input: red_Z, green_output: green_1 })";
  const offset = line.indexOf("red_Z") + "red_Z".length;
  const editor = createConfigurationEditor({ text: line });
  const found = editor.suggestions({ offset });
  assert.equal(found.context.range.start, line.indexOf("red_Z"));
  assert.equal(found.context.range.end, line.indexOf("red_Z") + "red_Z".length);
  const applied = editor.applySuggestion({
    revision: found.revision,
    kind: "network",
    choice: "new",
    color: "red",
    name: "red_new",
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: offset,
    selectionEnd: offset,
  });
  assert.equal(applied.applied, true);
  assert.match(editor.text, /red_input: red_\d+/);
  assert.match(editor.text, /green_output: green_1/);
  assert.equal(editor.text.split("green_output").length, 2);
  assert.equal(editor.text.includes("red_new"), false);
  assert.equal(editor.undo().applied, true);
  assert.equal(editor.text, line);
  assert.equal(editor.index().networks.some((item) => item.name === applied.text), false);

  const selected = editor.suggestions({
    offset: line.indexOf("red_Z"),
    selectionEnd: line.indexOf("red_Z") + "red_Z".length,
  });
  assert.equal(selected.context.slice, "red_Z");
  assert.equal(line.slice(0, selected.context.range.start).endsWith("red_input: "), true);

  const comment = completionContext("// Arith", "// Arith".length);
  assert.equal(comment.kind, "none");
  const block = completionContext("/* Signal.Logistic.wood */", 8);
  assert.equal(block.kind, "none");

  const long = `${" ".repeat(400)}Signal.Logistic.wood`;
  const tail = completionContext(long, long.length);
  assert.equal(tail.kind, "signal");
  assert.equal(tail.query, "Signal.Logistic.wood");
  assert.equal(long.slice(0, tail.range.start), " ".repeat(400));
});

test("MRU меняется после подтверждения, просмотр меню порядок не двигает", () => {
  const editor = createConfigurationEditor({ text: "Arithmetic({ return: Signal.Logistic.w })" });
  const offset = editor.text.indexOf("Signal.Logistic.w") + "Signal.Logistic.w".length;
  const first = editor.suggestions({ offset });
  const again = editor.suggestions({ offset });
  assert.deepEqual(again.items.map((item) => item.name), first.items.map((item) => item.name));
  const choice = first.items.find((item) => item.name === chest);
  assert.ok(choice);
  const applied = editor.applySuggestion({
    kind: "signal",
    choice: "item",
    name: chest,
    range: first.context.range,
    anchor: first.anchor,
    selectionStart: offset,
    selectionEnd: offset,
    revision: first.revision,
    use: `signal:${chest}`,
  });
  assert.equal(applied.applied, true);
  const ordered = editor.suggestions({ kind: "signal", role: "channel", query: "Signal.Logistic." });
  assert.equal(ordered.items[0].name, chest);
});

test("устаревшие revision, диапазон и курсор не создают сеть", () => {
  const text = "Arithmetic({\n  red_input: red_\n})";
  const editor = createConfigurationEditor({ text });
  const offset = text.indexOf("red_") + "red_".length;
  const found = editor.suggestions({ offset });
  const names = () => editor.index().networks.map((item) => item.name);
  const before = names();
  editor.replace(`${text}\n`);
  assert.equal(editor.suggestions({ offset, revision: found.revision }).applied, false);
  assert.equal(editor.applySuggestion({
    revision: found.revision,
    kind: "network",
    choice: "new",
    color: "red",
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: offset,
    selectionEnd: offset,
  }).applied, false);
  assert.deepEqual(names(), before);

  const fresh = createConfigurationEditor({ text });
  const open = fresh.suggestions({ offset });
  const moved = fresh.applySuggestion({
    revision: open.revision,
    kind: "network",
    choice: "new",
    color: "red",
    range: open.context.range,
    anchor: open.anchor,
    selectionStart: 0,
    selectionEnd: 0,
  });
  assert.equal(moved.applied, false);
  assert.equal(moved.reason, "stale");
  assert.deepEqual(namesOf(fresh), before);

  const rejected = fresh.applySuggestion({
    kind: "signal",
    choice: "new",
    name: "Signal.Meta._new",
    range: { start: 0, end: 0 },
  });
  assert.equal(rejected.applied, false);
  assert.equal(rejected.reason, "catalog");
});

test("сценарий подсказывает API и не переносит грамматику конфигурации", () => {
  const call = eventCompletion("this.pul", "this.pul".length);
  assert.equal(call.items.some((item) => item.name === "this.pulse"), true);
  assert.equal(call.items.some((item) => item.name === "Arithmetic"), false);
  const dot = eventCompletion("this.", "this.".length);
  assert.equal(dot.items.some((item) => item.name === "this.setOutput"), true);
  assert.equal(dot.items.some((item) => item.name.includes("red_input")), false);
  const comment = eventCompletion("// this.set", "// this.set".length);
  assert.equal(comment.context.kind, "none");
  assert.equal(comment.items.length, 0);
  const word = eventCompletion("  setOu", "  setOu".length);
  assert.equal(word.context.slice, "setOu");
  assert.equal(word.items.some((item) => item.name === "this.setOutput"), true);
});

test("после точки подпись — следующий сегмент, вставка достраивает путь", () => {
  const text = "return: Signal.";
  const editor = createConfigurationEditor({ text });
  const found = editor.suggestions({ offset: text.length });
  assert.equal(found.context.kind, "signal");
  assert.equal(found.context.pathPrefix, "Signal.");
  assert.equal(found.context.pathSegment, "");
  const group = found.items.find((item) => item.caption === "Logistic");
  assert.equal(group.value, "Signal.Logistic");
  assert.equal(group.name, "Signal.Logistic");
  assert.equal(found.items.every((item) => item.caption && !item.caption.includes(".")), true);
  assert.equal(found.items.some((item) => item.name === chest), false);
  const applied = editor.applySuggestion({
    revision: found.revision,
    kind: "signal",
    choice: "item",
    name: group.value,
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  assert.equal(applied.applied, true);
  assert.equal(editor.text, "return: Signal.Logistic.");

  const leafText = "return: Signal.Logistic.wood";
  const leaves = createConfigurationEditor({ text: leafText });
  const atLeaf = leaves.suggestions({ offset: leafText.length });
  assert.equal(atLeaf.context.pathPrefix, "Signal.Logistic.");
  assert.equal(atLeaf.context.pathSegment, "wood");
  const leaf = atLeaf.items.find((item) => item.value === chest);
  assert.equal(leaf.caption, "wooden_chest");
  const inserted = leaves.applySuggestion({
    revision: atLeaf.revision,
    kind: "signal",
    choice: "item",
    name: leaf.value,
    range: atLeaf.context.range,
    anchor: atLeaf.anchor,
    selectionStart: leafText.length,
    selectionEnd: leafText.length,
  });
  assert.equal(inserted.applied, true);
  assert.equal(leaves.text, `return: ${chest}`);
});

test("знаки операций заменяют Operation, режим Selector остаётся без знака", () => {
  const editor = createConfigurationEditor({ text: "" });
  const signs = (owner, group) => Object.fromEntries(
    editor.suggestions({ kind: "operation", owner, group, query: `${owner}.${group}.` }).items
      .map((item) => [item.caption, item.label]),
  );
  assert.deepEqual(signs("Arithmetic", "Operation"), {
    AND: "AND",
    DIV: "/",
    MOD: "%",
    MUL: "*",
    OR: "OR",
    POW: "^",
    SHL: "<<",
    SHR: ">>",
    SUB: "-",
    SUM: "+",
    XOR: "XOR",
  });
  assert.deepEqual(signs("Decider", "Operation"), {
    EQ: "=",
    GT: ">",
    GTE: ">=",
    LT: "<",
    LTE: "<=",
    NEQ: "!=",
  });
  assert.deepEqual(signs("Decider", "Logic"), { AND: "AND", OR: "OR" });
  assert.deepEqual(signs("Lamp", "Operation"), signs("Decider", "Operation"));
  assert.deepEqual(signs("Selector", "Compare"), signs("Decider", "Operation"));
  const modes = editor.suggestions({
    kind: "operation",
    owner: "Selector",
    group: "Operation",
    query: "Selector.Operation.",
  }).items;
  assert.equal(modes.length > 0, true);
  assert.equal(modes.every((item) => item.label === "" && item.value === `Selector.Operation.${item.caption}`), true);
  assert.equal(modes.some((item) => item.caption === "SELECT"), true);
  const sort = editor.suggestions({
    kind: "operation",
    owner: "Selector",
    group: "Sort",
    query: "Selector.Sort.",
  }).items;
  assert.deepEqual(sort.map((item) => [item.caption, item.label]), [["ASC", ""], ["DESC", ""]]);

  const loose = "Arithmetic({ operation: ";
  const opened = createConfigurationEditor({ text: loose }).suggestions({ offset: loose.length });
  assert.equal(opened.context.kind, "operation");
  assert.equal(opened.context.query, "");
  const sum = opened.items.find((item) => item.value === "Arithmetic.Operation.SUM");
  assert.equal(sum.caption, "SUM");
  assert.equal(sum.label, "+");
  assert.equal(opened.items.every((item) => item.label !== "Operation"), true);
});

test("строка и комментарий не получают путь, устаревший выбор не вставляет сигнал", () => {
  const quoted = completionContext("\"Signal.Logistic.\"", "\"Signal.Logistic.\"".length - 1);
  assert.equal(quoted.kind, "none");
  assert.equal(quoted.pathPrefix, "");
  const line = completionContext("// Signal.", "// Signal.".length);
  assert.equal(line.kind, "none");

  const text = "return: Signal.";
  const editor = createConfigurationEditor({ text });
  const found = editor.suggestions({ offset: text.length });
  editor.replace(`${text}\n`);
  const stale = editor.applySuggestion({
    revision: found.revision,
    kind: "signal",
    choice: "item",
    name: "Signal.Logistic",
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  assert.equal(stale.applied, false);
  assert.equal(editor.text, `${text}\n`);
});

test("класс, поле и законченное значение вставляются структурно", () => {
  const classes = [
    ["Arithmetic", "red_input"],
    ["Constant", "enabled"],
    ["Decider", "red_input"],
    ["Selector", "red_input"],
  ];
  for (const [name, field] of classes) {
    const prefix = name.slice(0, 4);
    const editor = createConfigurationEditor({ text: prefix });
    const applied = acceptAt(editor, prefix.length, { kind: "type", name });
    const scaffold = `${name}({\n\t\n})`;
    assert.equal(editor.text, scaffold);
    assert.equal(applied.cursor, `${name}({\n\t`.length);
    const fields = editor.suggestions({ offset: applied.cursor });
    assert.equal(fields.context.kind, "key");
    assert.equal(fields.context.query, "");
    assert.equal(fields.items.some((item) => item.name === field), true);
    if (name === "Arithmetic") {
      assert.deepEqual(fields.items.map((item) => item.name), [
        "red_input", "green_input", "red_output", "green_output",
        "left_operand", "right_operand", "operation", "return",
      ]);
    }
  }

  const legacy = createConfigurationEditor({ text: "new Event" });
  acceptAt(legacy, "new Event".length, { kind: "type", name: "EventCombinator" });
  assert.equal(legacy.text, "new EventCombinator({\n\t\n})");
  const group = createConfigurationEditor({ text: "new Constant" });
  acceptAt(group, "new Constant".length, { kind: "type", name: "Constant.Group" });
  assert.equal(group.text, "new Constant.Group({\n\t\n})");
});

test("поле, путь и вложенное значение не теряют пунктуацию", () => {
  const marked = (source, choice) => {
    const place = at(source);
    const context = completionContext(place.text, place.offset);
    const edit = structuralInsertion(place.text, context, choice);
    assert.ok(edit);
    const text = place.text.slice(0, edit.range.start) + edit.text + place.text.slice(edit.range.end);
    return text.slice(0, edit.caret) + "|" + text.slice(edit.caret);
  };
  assert.equal(
    marked("Arithmetic({\n\tred_in|\n})", { kind: "key", name: "red_input" }),
    "Arithmetic({\n\tred_input: |,\n})",
  );
  assert.equal(
    marked("Arithmetic({\n\tred_in|:\n})", { kind: "key", name: "red_input" }),
    "Arithmetic({\n\tred_input: |,\n})",
  );
  assert.equal(
    marked("Arithmetic({\n\tred_in|: ,\n})", { kind: "key", name: "red_input" }),
    "Arithmetic({\n\tred_input: |,\n})",
  );
  assert.equal(
    marked("Arithmetic({\n\tred_in|,\n})", { kind: "key", name: "red_input" }),
    "Arithmetic({\n\tred_input: |,\n})",
  );
  assert.equal(
    marked("Arithmetic({\n\tred_in|: red_1,\n})", { kind: "key", name: "red_input" }),
    "Arithmetic({\n\tred_input|: red_1,\n})",
  );
  assert.equal((marked("Arithmetic({\n\tred_in|: ,\n})", { kind: "key", name: "red_input" }).match(/:/g) ?? []).length, 1);
  assert.equal((marked("Arithmetic({\n\tred_in|: ,\n})", { kind: "key", name: "red_input" }).match(/,/g) ?? []).length, 1);

  const editor = createConfigurationEditor({ text: "Arithmetic({\n\treturn: Signal.\n})" });
  const midway = acceptAt(editor, editor.text.indexOf("Signal.") + "Signal.".length, {
    kind: "signal",
    name: "Signal.Logistic",
    leaf: false,
  });
  assert.equal(editor.text, "Arithmetic({\n\treturn: Signal.Logistic.\n})");
  assert.equal(editor.text[midway.cursor], "\n");
  const continued = editor.suggestions({ offset: midway.cursor });
  assert.equal(continued.context.kind, "signal");
  assert.equal(continued.items.some((item) => item.name === chest), true);
  assert.equal(continued.context.kind === "key", false);

  const leaf = acceptAt(editor, midway.cursor, { kind: "signal", name: chest, leaf: true });
  assert.equal(editor.text, "Arithmetic({\n\treturn: Signal.Logistic.wooden_chest,\n\t\n})");
  assert.equal(leaf.cursor, "Arithmetic({\n\treturn: Signal.Logistic.wooden_chest,\n\t".length);
  const rest = editor.suggestions({ offset: leaf.cursor });
  assert.equal(rest.context.kind, "key");
  assert.equal(rest.items.some((item) => item.name === "return"), false);
  assert.equal(rest.items.some((item) => item.name === "red_input"), true);

  const nested = createConfigurationEditor({ text: "Arithmetic({\n\tleft_operand: {\n\t\tred\n\t},\n})" });
  const key = acceptAt(nested, nested.text.indexOf("red") + "red".length, { kind: "key", name: "red" });
  assert.equal(nested.text, "Arithmetic({\n\tleft_operand: {\n\t\tred: ,\n\t},\n})");
  assert.equal(nested.text[key.cursor], ",");
  acceptAt(nested, key.cursor, { kind: "boolean", name: "true" });
  assert.equal(nested.text, "Arithmetic({\n\tleft_operand: {\n\t\tred: true,\n\t\t\n\t},\n})");
  const inside = nested.suggestions({ offset: nested.text.indexOf("true,\n") + "true,\n".length + 2 });
  assert.equal(inside.context.kind, "key");
  assert.equal(inside.items.some((item) => item.name === "green"), true);
  assert.equal(inside.items.some((item) => item.name === "signal"), true);
  assert.equal(inside.items.some((item) => item.name === "red"), false);
  assert.equal(inside.items.some((item) => item.name === "red_input"), false);

  const nestAt = "Arithmetic({\n\tleft_operand: ".length;
  const opened = nestAtCaret(`Arithmetic({\n\tleft_operand: {,\n})`, nestAt + 1, "{");
  assert.equal(opened.text, "{\n\t\t\n\t},");
  assert.equal(opened.caret, nestAt + "{\n\t\t".length);
});

test("структурная вставка отменяется целиком и не применяет устаревший диапазон", () => {
  const editor = createConfigurationEditor({ text: "Arith" });
  const applied = acceptAt(editor, 5, { kind: "type", name: "Arithmetic" });
  const undone = editor.undo();
  assert.equal(undone.applied, true);
  assert.equal(editor.text, "Arith");
  assert.deepEqual(undone.cursor, { start: 5, end: 5 });
  const redone = editor.redo();
  assert.equal(editor.text, "Arithmetic({\n\t\n})");
  assert.deepEqual(redone.cursor, { start: applied.cursor, end: applied.cursor });

  const port = acceptAt(editor, applied.cursor, { kind: "key", name: "red_input" });
  assert.equal(editor.text, "Arithmetic({\n\tred_input: ,\n})");
  assert.equal(editor.text[port.cursor], ",");
  const networks = editor.suggestions({ offset: port.cursor });
  assert.equal(networks.context.kind, "network");
  assert.equal(networks.context.color, "red");
  const created = editor.applySuggestion({
    revision: networks.revision,
    kind: "network",
    choice: "new",
    color: "red",
    name: "red_new",
    range: networks.context.range,
    anchor: networks.anchor,
    selectionStart: port.cursor,
    selectionEnd: port.cursor,
  });
  assert.equal(created.applied, true);
  assert.match(created.text, /^red_\d+$/);
  assert.match(editor.text, /red_input: red_\d+,\n\t\n\}/);
  assert.equal(editor.text.includes("red_new"), false);
  const removed = editor.undo();
  assert.equal(editor.text, "Arithmetic({\n\tred_input: ,\n})");
  assert.deepEqual(removed.cursor, { start: port.cursor, end: port.cursor });
  assert.equal(editor.index().networks.some((item) => item.name === created.text), false);
  const restored = editor.redo();
  assert.match(editor.text, /red_input: red_\d+,\n\t\n\}/);
  assert.equal(restored.cursor.start, created.cursor);

  editor.replace("Arith");
  const found = editor.suggestions({ offset: 5 });
  editor.replace("Deci");
  const stale = editor.applySuggestion({
    revision: found.revision,
    kind: "type",
    choice: "item",
    name: "Arithmetic",
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: 5,
    selectionEnd: 5,
  });
  assert.equal(stale.applied, false);
  assert.equal(editor.text, "Deci");
});

function acceptAt(editor, offset, choice) {
  const found = editor.suggestions({ offset, selectionEnd: offset });
  const applied = editor.applySuggestion({
    revision: found.revision,
    kind: choice.kind,
    choice: "item",
    name: choice.name,
    leaf: choice.leaf,
    range: found.context.range,
    anchor: found.anchor,
    selectionStart: offset,
    selectionEnd: offset,
  });
  assert.equal(applied.applied, true, choice.name);
  return { ...found, ...applied };
}

function namesOf(editor) {
  return editor.index().networks.map((item) => item.name);
}
