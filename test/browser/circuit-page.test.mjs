import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";
import { chooseSelect } from "./choose-select.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

let server;
let browser;
let port;

function track(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function openCircuit() {
  const page = await browser.newPage();
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/circuit/`);
  await page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "ready");
  return { page, errors };
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

test("страница показывает A=3, после шага B=5 и возвращает границу 0", { timeout: 60_000 }, async () => {
  const { page, errors } = await openCircuit();
  try {
    await page.getByRole("button", { name: "Меню" }).click();
    assert.equal(await page.getByRole("link", { name: "Документация" }).count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.match(await page.locator("#red-body").textContent(), /signal-A/);
    assert.match(await page.locator("#red-body").textContent(), /3/);
    assert.match(await page.locator("#green-body").textContent(), /Нет сигналов/);
    assert.match(await page.locator("#event-state").textContent(), /observe/);
    assert.equal(await page.locator("#device-count").textContent(), "3");
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    assert.equal(resources.some((name) => name.includes("/src/event-worker.js")), true);
    assert.equal(resources.some((name) => name.includes("/api/")), false);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "1");
    assert.match(await page.locator("#green-body").textContent(), /signal-B/);
    assert.match(await page.locator("#green-body").textContent(), /5/);
    assert.match(await page.locator("#red-body").textContent(), /signal-A/);
    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "0");
    assert.match(await page.locator("#green-body").textContent(), /Нет сигналов/);
    assert.equal(await page.locator("#run").isDisabled(), true);
    assert.equal(await page.locator("#speed .fl-selectbox__control").isDisabled(), true);
    const label = await page.locator("#timeout-ms").evaluate((element) => element.labels?.[0]?.textContent ?? "");
    assert.match(label, /Лимит/);
    await page.locator("#reset").focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "step");
    assert.equal(await page.locator("#step").evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
    await page.locator("[data-device='constant']").click();
    assert.equal(await page.locator("[data-device='constant']").getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("#output-body").textContent(), /signal-A/);
    await page.locator("#unsupported").click();
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("unsupported-mode"));
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.match(await page.locator("#red-body").textContent(), /3/);
    assert.equal(await page.locator("#device-count").textContent(), "3");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("зависание Worker не публикует B и оставляет интерфейс отзывчивым", { timeout: 60_000 }, async () => {
  const { page, errors } = await openCircuit();
  try {
    await page.locator("#timeout-ms").fill("300");
    await chooseSelect(page, "preset", "spin");
    await page.waitForFunction(() => document.querySelector("#preset-active")?.textContent === "spin"
      && document.querySelector("#run-status")?.dataset.status === "ready");
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    const pending = page.evaluate(() => window.__circuitPage.step().catch((error) => error.code));
    await page.locator("#ui-ping").click();
    assert.equal(await page.locator("#ui-alive").textContent(), "Интерфейс: alive");
    assert.equal(await pending, "timeout");
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.match(await page.locator("#red-body").textContent(), /signal-A/);
    assert.doesNotMatch(await page.locator("#green-body").textContent(), /signal-B/);
    assert.match(await page.locator("#diagnostic").textContent(), /timeout/);
    assert.match(await page.locator("#diagnostic").textContent(), /блок /);
    assert.match(await page.locator("#diagnostic").textContent(), /тик 0/);
    assert.equal(await page.locator("#toolbar").getAttribute("aria-busy"), "false");
    const spinning = page.evaluate(() => window.__circuitPage.step().catch((error) => error.code));
    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "ready"
      && document.querySelector("#tick-value").textContent === "0");
    assert.doesNotMatch(await page.locator("#green-body").textContent(), /signal-B/);
    await spinning;
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const fit = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        table: getComputedStyle(document.querySelector(".fl-table-wrap")).overflow,
      }));
      assert.equal(fit.overflow, false, `overflow at ${width}`);
      assert.equal(fit.table, "auto", `table overflow at ${width}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
