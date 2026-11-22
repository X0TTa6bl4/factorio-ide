import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";
import { exampleProject } from "../../src/index.js";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

let server;
let browser;
let port;

const WIDTHS = [320, 390, 768, 1024, 1440];

function track(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function openProject(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/project/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#project-name")?.value === "Петля"
    && document.querySelector("#network-rows")?.textContent?.includes("n1"));
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

test("импорт не запускает сценарий и не затирает открытую схему", { timeout: 60_000 }, async () => {
  const { page, errors } = await openProject();
  try {
    assert.equal(await page.evaluate(() => globalThis.__fLogicImportRan ?? null), null);
    assert.match(await page.locator("#event-source").inputValue(), /__fLogicImportRan/);
    await page.locator("#event-source").fill("globalThis.__fLogicImportRan = 5;\n");
    await page.locator("#event-source").blur();
    await page.waitForFunction(() => document.querySelector("#project-status")?.textContent?.includes("не выполнялся"));
    assert.equal(await page.evaluate(() => globalThis.__fLogicImportRan ?? null), null);

    await page.setInputFiles("#import-file", {
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{"),
    });
    await page.waitForFunction(() => document.querySelector("#project-error")?.dataset.code === "invalid-json");
    assert.equal(await page.locator("#project-name").inputValue(), "Петля");

    const future = exampleProject();
    future.version = 2;
    await page.setInputFiles("#import-file", {
      name: "future.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(future)),
    });
    await page.waitForFunction(() => document.querySelector("#project-error")?.dataset.code === "unsupported-version");
    assert.equal(await page.locator("#project-name").inputValue(), "Петля");
    assert.equal(await page.evaluate(() => globalThis.__fLogicImportRan ?? null), null);

    const imported = exampleProject();
    imported.name = "Привоз";
    await page.setInputFiles("#import-file", {
      name: "scheme.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await page.waitForFunction(() => document.querySelector("#project-name")?.value === "Привоз");
    assert.equal(await page.evaluate(() => globalThis.__fLogicImportRan ?? null), null);
    assert.match(await page.locator("#network-rows").innerText(), /n1/);
    assert.match(await page.locator("#device-rows").innerText(), /d7/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("коллизия, квота и клавиатура не уничтожают запись", { timeout: 60_000 }, async () => {
  const { page, errors } = await openProject();
  try {
    await page.locator("#save-project").click();
    await page.waitForFunction(() => document.querySelector("#saved-rows")?.textContent?.includes("Петля"));
    const imported = exampleProject();
    await page.setInputFiles("#import-file", {
      name: "scheme.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await page.waitForFunction(() => document.querySelector("#project-status")?.textContent?.includes("не запускался"));
    await page.locator("#save-project").click();
    await page.waitForFunction(() => document.querySelector("#collision-dialog")?.open);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#collision-dialog")?.open === false);
    const focus = await page.evaluate(() => ({
      id: document.activeElement?.id ?? "",
      visible: document.activeElement?.matches(":focus-visible") ?? false,
      outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none",
    }));
    assert.equal(focus.id, "save-project");
    assert.equal(focus.visible, true);
    assert.notEqual(focus.outline, "none");
    assert.equal(await page.locator("#saved-rows tr").count(), 1);

    await page.locator("#save-project").click();
    await page.locator("#collision-name").fill("Копия");
    await page.getByRole("button", { name: "Сохранить как", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#saved-rows")?.textContent?.includes("Копия"));
    assert.equal(await page.locator("#saved-rows tr").count(), 2);

    await page.locator("#project-name").fill("Квота");
    await page.locator("#project-name").blur();
    await page.waitForFunction(() => document.querySelector("#project-name")?.value === "Квота");
    await page.evaluate(() => {
      localStorage.setItem = () => {
        throw new DOMException("quota", "QuotaExceededError");
      };
    });
    await page.locator("#save-project").click();
    await page.waitForFunction(() => document.querySelector("#project-error")?.dataset.code === "storage-quota");
    assert.equal(await page.locator("#project-name").inputValue(), "Квота");
    const stored = await page.evaluate(() => localStorage.getItem("f-logic.projects.v1"));
    assert.match(stored, /Петля/);
    assert.equal(stored.includes("Квота"), false);
    await page.getByRole("button", { name: "Открыть", exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector("#project-name")?.value === "Петля");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("таблицы и текст не растягивают документ", { timeout: 60_000 }, async () => {
  const { page, errors } = await openProject(1440);
  try {
    await page.locator("#event-source").fill(`${"signal-A ".repeat(80)}\n`);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        source: getComputedStyle(document.querySelector("#event-source")).overflowX,
        table: getComputedStyle(document.querySelector("#network-scroll")).overflow,
      }));
      assert.ok(metrics.document <= 1, `ширина ${width}: документ ${metrics.document}`);
      assert.equal(metrics.source, "auto");
      assert.equal(metrics.table, "auto");
    }
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-project").click();
    const download = await downloadPromise;
    const text = await readFile(await download.path(), "utf8");
    assert.match(text, /f-logic-project/);
    assert.match(text, /"id": "n1"/);
    assert.equal(text.includes("[object"), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
