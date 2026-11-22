/** PERF-1: отзывчивость главного потока. Ядро остаётся на странице. */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { startServer } from "../../dev/server.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

test("разреженная схема 4096 отвечает на странице и не создаёт Worker", { timeout: 120_000 }, async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const port = server.address().port;
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/test/browser/performance/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#out")?.textContent !== "wait");
    const report = JSON.parse(await page.locator("#out").textContent());
    assert.deepEqual(errors, []);
    assert.equal(report.error, undefined);
    assert.equal(report.environment.runtime, "browser");
    assert.equal(typeof report.environment.version, "string");
    assert.equal(report.workers, 0);
    assert.equal(report.dom, true);
    assert.equal(report.rows.length, 2);
    for (const row of report.rows) {
      assert.equal(row.scenario, "sparse");
      assert.equal(row.size, 4096);
      assert.equal(row.repetitions, 5);
      assert.ok(Number.isFinite(row.median) && row.median >= 0);
      assert.ok(Number.isFinite(row.resumeGap) && row.resumeGap >= 0);
      assert.ok(row.heapUsed === null || (typeof row.heapUsed === "number" && row.heapUsed > 0));
    }
    assert.equal(report.decision.playbackIntervalMs, 100);
    assert.equal(report.decision.moveEngine, report.rows.some((row) => row.median >= 100));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});