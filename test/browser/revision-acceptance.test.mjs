/** Пользовательский путь эпика: корень, события, смешанный текст и прямые адреса. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

let server;
let browser;
let port;

const MIXED = `constant source = new Constant({
  enabled: true,
  red_output: red_1,
  signals: [{ signal: Signal.Logistic.wooden_chest, constant: 3 }]
})
Arithmetic({
  red_input: red_1,
  green_output: green_1,
  left_operand: { red: true, green: false, signal: Signal.Logistic.wooden_chest },
  right_operand: { constant: 2 },
  operation: Arithmetic.Operation.SUM,
  return: Signal.Logistic.wooden_chest
})`;

function track(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

test.before(async () => {
  server = await startServer({ host: "127.0.0.1", port: 0 });
  port = server.address().port;
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("корень, события и смешанная схема проходят один путь", { timeout: 90_000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = track(page);
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForSelector("#document");
    const opened = await page.locator("#document").inputValue();
    assert.match(opened, /Arithmetic\(\{/);
    assert.equal(opened.includes("new Arithmetic"), false);
    assert.equal(opened.includes("wire "), false);
    assert.equal(await page.locator("#demo-rows").count(), 0);
    assert.equal(await page.locator("h1").textContent(), "Редактор");
    assert.equal(await page.locator("select").count(), 0);
    assert.equal(await page.locator(".fl-workspace__title").count(), 0);

    const draft = "Arithmetic({ return: Signal.Signals.signal_Z })";
    await page.locator("#document").fill(draft);
    await page.waitForFunction((marker) => sessionStorage.getItem("f-logic.editor-draft.v1")?.includes(marker), draft);
    await page.goto(`http://127.0.0.1:${port}/pages/event/`);
    await page.waitForSelector("#check");
    assert.equal(await page.locator("h1").textContent(), "Сценарий");
    await page.waitForFunction(() => (document.querySelector("#demo-expect")?.textContent ?? "").includes("signal-A = 1"));
    await page.locator("#check").click();
    await page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "ready");
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "1");
    assert.match(await page.locator("#red-body").textContent(), /signal-A/);
    await page.locator("#open-editor").click();
    await page.waitForFunction(() => (document.querySelector("#document")?.value ?? "").includes("signal_Z"));
    assert.match(page.url(), /draft=1/);

    await page.locator("#document").fill(MIXED);
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");
    assert.equal(await page.locator(".fl-screen__drawers").count(), 0);
    assert.equal(await page.locator(".fl-editor-inspector").getAttribute("aria-label"), "Сети и настройки");
    assert.deepEqual(
      (await page.locator(".fl-editor-inspector > section h2").allTextContents()).map((text) => text.trim()),
      ["Сети"],
    );
    assert.equal(await page.locator("#diagnostics-panel, #document-hint").count(), 0);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0");
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "1"
      && document.querySelector("#live-signals tr[data-network='green_1'][data-value='5']"));
    const published = await page.locator("#document").inputValue();
    assert.match(published, /new Constant/);
    assert.match(published, /Arithmetic\(\{/);
    await page.locator("#back").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0");
    assert.equal(await page.locator("#document").inputValue(), published);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "1"
      && document.querySelector("#live-signals tr[data-network='green_1'][data-value='5']"));

    await page.locator("#document").fill(published.replace("constant: 2", "constant: 1.5"));
    await page.waitForFunction(() => document.querySelector("#play")?.disabled === true
      && document.querySelector("#signal-panel")?.dataset.run === "stale"
      && document.querySelector("#live-signals tr[data-network='green_1'][data-value='5']"));
    assert.match(await page.locator("#stale-note").textContent(), /Старый прогон/);

    for (const pathname of ["/", "/factorio-ide/", "/pages/configure/", "/factorio-ide/pages/event/", "/pages/project/"]) {
      const response = await page.goto(`http://127.0.0.1:${port}${pathname}`);
      assert.equal(response.ok(), true, pathname);
      assert.equal(await page.locator(".fl-workspace__title, [data-release-note]").count(), 0, pathname);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
