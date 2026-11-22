import assert from "node:assert/strict";
import test from "node:test";

import { paintConfiguration, paintJavaScript } from "../../../pages/code-paint.js";

function marked(parts, className) {
  return parts.filter((part) => part.className === className).map((part) => part.text);
}

test("конфигурация отличает слово, тип, поле, путь, число и комментарий", () => {
  const parts = paintConfiguration(`constant source = new Constant({
  red_output: red_1,
  signals: [{ signal: Signal.Logistic.wooden_chest, constant: 3 }]
})
// заметка
`);
  assert.deepEqual(marked(parts, "kw"), ["constant", "new"]);
  assert.ok(marked(parts, "type").includes("Constant"));
  assert.ok(marked(parts, "type").includes("Signal"));
  assert.ok(marked(parts, "prop").includes("red_output"));
  assert.ok(marked(parts, "prop").includes("constant"));
  assert.deepEqual(marked(parts, "path"), ["Logistic", "wooden_chest"]);
  assert.deepEqual(marked(parts, "num"), ["3"]);
  assert.deepEqual(marked(parts, "cmt"), ["// заметка"]);
});

test("вызов комбинатора подсвечивает тип и поле", () => {
  const parts = paintConfiguration("Arithmetic({ red_input: red_1 })");
  assert.ok(marked(parts, "type").includes("Arithmetic"));
  assert.ok(marked(parts, "prop").includes("red_input"));
});

test("диагностика подчёркивает путь, не дублирует символы и отмечает конец текста", () => {
  const text = "Decider({ when_true: [{ signal: SSignal.Signals.signal_A, constant: 1.5 }] })";
  const pathStart = text.indexOf("SSignal.Signals.signal_A");
  const valueStart = text.indexOf("1.5");
  const parts = paintConfiguration(text, [
    { range: { start: pathStart, end: pathStart + "SSignal.Signals.signal_A".length } },
    { range: { start: valueStart, end: valueStart + 3 } },
    { range: { start: valueStart, end: valueStart + 1 } },
  ]);
  assert.equal(parts.map((part) => part.text).join(""), text);
  const path = parts.filter((part) => part.className.includes("err") && part.text !== "1.5" && !part.text.startsWith("1"));
  assert.equal(path.map((part) => part.text).join(""), "SSignal.Signals.signal_A");
  assert.ok(path.some((part) => part.className.includes("type")));
  assert.ok(path.some((part) => part.className.includes("path")));
  assert.equal(parts.filter((part) => part.className.includes("num")).map((part) => part.text).join(""), "1.5");
  assert.ok(parts.some((part) => part.className.includes("num") && part.className.includes("err")));

  const end = paintConfiguration("Arithmetic({", [
    { range: { start: "Arithmetic({".length, end: "Arithmetic({".length } },
  ]);
  assert.equal(end.map((part) => part.text).join(""), "Arithmetic({");
  assert.equal(end.at(-1).className, "err-point");
  assert.equal(end.at(-1).text, "");

  const clear = paintConfiguration("Arithmetic({ red_input: red_1 })");
  assert.equal(clear.some((part) => part.className.includes("err")), false);
});

test("сценарий отличает ключевые слова JavaScript и строку", () => {
  const parts = paintJavaScript(`export class Arrival extends EventCombinator {
  main() {
    if (this.nextTick === 1) return "a<b";
  }
}
// "не строка"
`);
  assert.ok(marked(parts, "kw").includes("export"));
  assert.ok(marked(parts, "kw").includes("class"));
  assert.ok(marked(parts, "kw").includes("this"));
  assert.deepEqual(marked(parts, "type"), ["Arrival", "EventCombinator"]);
  assert.deepEqual(marked(parts, "num"), ["1"]);
  assert.deepEqual(marked(parts, "cmt"), ["// \"не строка\""]);
  assert.deepEqual(marked(parts, "str"), ["\"a<b\""]);
});
