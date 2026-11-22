/** PERF-1…3: измерения больших схем и решение о переносе ядра. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILE,
  buildScenario,
  decideWorker,
  environment,
  measureScheduler,
} from "./performance-profile.mjs";

function assertRow(row) {
  assert.equal(row.seed, PROFILE.seed);
  assert.equal(row.historyLimit, PROFILE.historyLimit);
  assert.equal(row.warmup, PROFILE.warmup);
  assert.equal(row.repetitions, PROFILE.repetitions);
  assert.ok(PROFILE.scenarios.includes(row.scenario));
  assert.ok(PROFILE.sizes.includes(row.size));
  assert.ok(row.scheduler === "full" || row.scheduler === "optimized");
  assert.ok(Number.isFinite(row.min) && row.min >= 0);
  assert.ok(Number.isFinite(row.median) && row.median >= row.min);
  assert.ok(Number.isFinite(row.max) && row.max >= row.median);
  assert.ok(Number.isFinite(row.resumeGap) && row.resumeGap >= 0);
  assert.equal(typeof row.heapUsed, "number");
  assert.ok(row.heapUsed > 0);
  assert.equal(typeof row.rss, "number");
  assert.ok(row.rss > 0);
}

test("нагрузка отвергает неизвестное имя и малый размер", () => {
  assert.throws(() => buildScenario("lamp", 16), /Неизвестная нагрузка/);
  assert.throws(() => buildScenario("chain", 7), /от 8/);
  assert.throws(() => buildScenario("cycle", 1.5), /от 8/);
});

test("решение о Worker сравнивает медиану с интервалом 100 мс", () => {
  const below = decideWorker([
    { scenario: "cycle", size: 8192, scheduler: "full", median: 99.999 },
    { scenario: "sparse", size: 1024, scheduler: "optimized", median: 2 },
  ]);
  assert.equal(below.moveEngine, false);
  assert.equal(below.playbackIntervalMs, 100);
  assert.equal(below.worst.scenario, "cycle");
  assert.equal(below.worst.median, 99.999);

  const above = decideWorker([
    { scenario: "chain", size: 1024, scheduler: "optimized", median: 10 },
    { scenario: "sparse", size: 8192, scheduler: "full", median: 100 },
  ]);
  assert.equal(above.moveEngine, true);
  assert.equal(above.worst.scheduler, "full");
  assert.equal(above.worst.size, 8192);

  assert.throws(() => decideWorker([]), /Нет измерений/);
  assert.throws(() => decideWorker(null), /Нет измерений/);
  assert.throws(() => decideWorker([{ median: Number.NaN }]), /конечным числом/);
});

test("малые схемы full и optimized публикуют одну границу", async () => {
  for (const scenario of PROFILE.scenarios) {
    const full = await measureScheduler(scenario, 16, "full", true);
    const optimized = await measureScheduler(scenario, 16, "optimized", true);
    assert.deepEqual(optimized.snapshot, full.snapshot);
    assert.equal(full.snapshot.tick, PROFILE.warmup + PROFILE.repetitions);
  }
});

test("PERF-1…3 большие схемы совпадают и записывают время шага", { timeout: 180_000 }, async () => {
  const env = environment();
  assert.equal(env.runtime, "node");
  assert.match(env.version, /^v\d+\.\d+\.\d+$/);
  assert.match(env.platform, /\//);
  const rows = [];
  for (const scenario of PROFILE.scenarios) {
    for (const size of PROFILE.sizes) {
      const full = await measureScheduler(scenario, size, "full", true);
      const optimized = await measureScheduler(scenario, size, "optimized", true);
      assert.deepEqual(optimized.snapshot, full.snapshot);
      assert.equal(full.snapshot.tick, PROFILE.warmup + PROFILE.repetitions);
      assertRow(full.row);
      assertRow(optimized.row);
      rows.push(full.row, optimized.row);
      console.log(JSON.stringify({ env, ...full.row }));
      console.log(JSON.stringify({ env, ...optimized.row }));
    }
  }
  const decision = decideWorker(rows);
  // Порог проверяется на этих строках. Зафиксированное «не переносить» — прогон 19.11.2026,
  // а не повторное сравнение под нагрузкой всего test:full.
  assert.equal(decision.moveEngine, rows.some((row) => row.median >= PROFILE.playbackIntervalMs));
  assert.equal(decision.playbackIntervalMs, PROFILE.playbackIntervalMs);
  console.log(JSON.stringify({ decision }));
});

test("измерение отвергает чужой планировщик", async () => {
  await assert.rejects(measureScheduler("chain", 16, "dependency"), /full или optimized/);
});
