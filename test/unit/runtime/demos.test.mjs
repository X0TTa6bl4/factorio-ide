import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Signal } from "../../../src/index.js";
import { buildScheme, SCHEME_IDS, schemeMeta } from "../../../pages/debugger/schemes.js";
import { docArticles } from "../../../pages/docs/content.js";
import { EVENT_DEMO, GAME_BEHAVIOR_VERIFIED, RELEASE_NOTE } from "../../../pages/release.js";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;

function network(built, name) {
  for (const item of built.devices) {
    for (const key of ["red_input", "green_input", "red_output", "green_output"]) {
      const port = item.device[key];
      if (port?.name === name) return port;
    }
  }
  throw new Error(name);
}

function has(simulation, port, signal) {
  return simulation.present(port).some((entry) => entry.signal.name === signal.name);
}

test("подписи выпуска не называют поведение схем игровой совместимостью", async () => {
  assert.equal(GAME_BEHAVIOR_VERIFIED, false);
  assert.match(RELEASE_NOTE, /2\.1\.24/);
  assert.match(RELEASE_NOTE, /не заявлена/);
  assert.doesNotMatch(RELEASE_NOTE, /совместимо с Factorio/);
  const component = await readFile(new URL("../../../ui/components/release-note.html", import.meta.url), "utf8");
  const examples = await readFile(new URL("../../../pages/examples/index.html", import.meta.url), "utf8");
  assert.equal(component.includes(RELEASE_NOTE), true);
  assert.equal(JSON.stringify(docArticles()).includes(RELEASE_NOTE), true);
  assert.equal(examples.includes("Совместимость"), false);
  assert.match(examples, /Документация/);
  assert.match(EVENT_DEMO.expect, /Граница 0/);
  assert.match(EVENT_DEMO.expect, /signal-A = 1/);
});

test("схемы четырёх устройств дают записанные границы", async () => {
  assert.deepEqual(SCHEME_IDS, ["sources", "counter", "decider", "selector", "fault", "invalid", "unsupported"]);
  for (const id of SCHEME_IDS) assert.match(schemeMeta(id).expect, /Граница|Код|Конструктор|Selector/);

  const sources = buildScheme("sources");
  const bus = network(sources, "red_bus");
  const sourcesRun = await sources.circuit.createSimulation();
  assert.equal(sourcesRun.read(bus, A), 7);
  assert.equal(sourcesRun.read(bus, B), 3);
  await sourcesRun.step();
  assert.equal(has(sourcesRun, bus, A), false);
  assert.equal(sourcesRun.read(bus, B), 3);

  const counter = buildScheme("counter");
  const loop = network(counter, "green_count");
  const counterRun = await counter.circuit.createSimulation();
  assert.equal(has(counterRun, loop, A), false);
  await counterRun.step();
  await counterRun.step();
  await counterRun.step();
  assert.equal(counterRun.read(loop, A), 3);

  const decider = buildScheme("decider");
  const gate = network(decider, "green_gate");
  const red = network(decider, "red_gate");
  const deciderRun = await decider.circuit.createSimulation();
  assert.equal(deciderRun.read(red, A), 5);
  assert.equal(deciderRun.present(gate).length, 0);
  await deciderRun.step();
  assert.equal(deciderRun.read(gate, B), 1);

  const selector = buildScheme("selector");
  const items = network(selector, "red_items");
  const count = network(selector, "red_count");
  const selectorRun = await selector.circuit.createSimulation();
  assert.equal(selectorRun.read(items, A), 100);
  assert.equal(selectorRun.read(items, B), -2);
  assert.equal(selectorRun.present(count).length, 0);
  await selectorRun.step();
  assert.equal(selectorRun.read(count, C), 2);
});

test("неподдержанный режим и чужая схема не создают прогон", () => {
  const unsupported = buildScheme("unsupported");
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "unsupported-case");
  const invalid = buildScheme("invalid");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid-operand");
  const missing = buildScheme("absent");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "unknown-scheme");
});
