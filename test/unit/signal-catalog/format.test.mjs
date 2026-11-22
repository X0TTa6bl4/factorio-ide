import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, cell, compareText, stableValue } from "../../../tools/signal-catalog/format.mjs";
import { sha256 } from "../../../tools/signal-catalog/hash.mjs";
import { CatalogError } from "../../../tools/signal-catalog/errors.mjs";
import { joinPath, nameCheck, publicName, sectionForGroup } from "../../../tools/signal-catalog/names.mjs";

test("канонический JSON не зависит от порядка ключей и локали сравнения", () => {
  assert.equal(canonicalJson({ b: 1, a: [null, { d: true, c: "x" }] }), canonicalJson({ a: [null, { c: "x", d: true }], b: 1 }));
  assert.equal(canonicalJson([]), "[]\n");
  assert.equal(canonicalJson({}), "{}\n");
  assert.equal(stableValue({ b: 1, a: 2 }), stableValue({ a: 2, b: 1 }));
  assert.equal(stableValue([1, "a"]), '[1,"a"]');
  assert.equal(compareText("z", "ä"), -1);
  assert.equal(compareText("a", "a"), 0);
  assert.equal(compareText("b", "a"), 1);
  assert.equal(cell(null), "");
  assert.equal(cell("a|b\nc"), "a\\|b c");
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("CAT-02 CAT-04 имя из prototype.name без перевода и без сокращения", () => {
  assert.equal(publicName("wooden-chest"), "wooden_chest");
  assert.equal(publicName("signal-A"), "signal_A");
  assert.equal(publicName("signal-each"), "signal_each");
  assert.equal(nameCheck("wooden-chest").kind, "identifier");
  assert.equal(nameCheck("a-b").publicName, nameCheck("a_b").publicName);
  assert.deepEqual(nameCheck("__proto__"), { ok: false, kind: "service-property", publicName: "__proto__" });
  assert.deepEqual(nameCheck("1x2-remnants"), { ok: true, kind: "identifier", publicName: "remnants_1x2" });
  assert.equal(nameCheck("default").ok, true);
  assert.equal(nameCheck("default").kind, "keyword");
  assert.equal(nameCheck("prototype").kind, "readonly-static");
  assert.equal(nameCheck("name").kind, "readonly-static");
  assert.equal(nameCheck("length").kind, "readonly-static");
  assert.equal(nameCheck("a/b").ok, false);
  assert.equal(nameCheck("жидкость").ok, true);
  assert.equal(sectionForGroup("logistics"), "Logistic");
  assert.equal(sectionForGroup("nope"), null);
  assert.equal(joinPath("Logistic", "wooden_chest"), "Signal.Logistic.wooden_chest");
  assert.throws(() => publicName(""), CatalogError);
  assert.throws(() => publicName(null), CatalogError);
  const read = new Function("Signal", "return Signal.Logistic.wooden_chest;");
  assert.equal(read({ Logistic: { wooden_chest: "ok" } }), "ok");
  assert.equal(new Function("Signal", "return Signal.Logistic.default;")({ Logistic: { default: "ok" } }), "ok");
  assert.throws(() => new Function("Signal", "return Signal.Environment.1x2_remnants;"));
  assert.equal(new Function("Signal", "return Signal.Environment.remnants_1x2;")({ Environment: { remnants_1x2: "ok" } }), "ok");
});

test("CAT-04 ведущий цифровой блок переносится целиком, остальные цифры сохраняются", () => {
  assert.equal(publicName("1x2-remnants"), "remnants_1x2");
  assert.equal(publicName("12-large-remnants"), "large_remnants_12");
  assert.equal(publicName("1x2-Remnants"), "Remnants_1x2");
  assert.equal(publicName("assembling-machine-2"), "assembling_machine_2");
  assert.equal(publicName("signal-0"), "signal_0");
  assert.equal(nameCheck("1bad").ok, false);
  assert.equal(nameCheck("123").ok, false);
});
