/** Панели кода и сетей: одна таблица, история и фокус при смене ширины. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";

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

async function openEditor(width, height, pathname) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}${pathname}`);
  await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");
  return { page, context, errors };
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

test("переключение панелей сохраняет схему, историю и одну таблицу", { timeout: 90_000 }, async () => {
  for (const pathname of ["/", "/pages/configure/"]) {
    const { page, context, errors } = await openEditor(1280, 800, pathname);
    try {
      assert.equal(await page.locator('[role="tablist"]').count(), 0);
      assert.equal(await page.locator('[role="group"] [data-work-view]').count(), 2);
      assert.equal(await page.locator('[role="group"] #open-events').count(), 0);
      assert.equal(await page.locator("#open-events").getAttribute("aria-expanded"), null);
      assert.match(await page.locator("#open-events").getAttribute("href"), /event\/index\.html$/);
      assert.match(await page.locator("#open-events").getAttribute("title"), /Общего прогона/);
      assert.equal(await page.locator("#toolbar #undo").count(), 0);
      assert.equal(await page.locator("#live-signals").count(), 1);
      assert.equal(await page.locator("#document").count(), 1);
      assert.equal(await page.locator("#gutter").count(), 1);

      await page.locator("#step").click();
      await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0");
      const before = await page.evaluate(() => {
        document.querySelector("#document").dataset.panelMark = "kept";
        document.querySelector("#live-signals").dataset.panelMark = "kept";
        return {
          tick: document.querySelector("#tick-value").textContent,
          text: document.querySelector("#document").value,
          rows: document.querySelectorAll("#live-signals tr").length,
        };
      });
      await page.locator('[data-work-view="networks"]').click();
      assert.equal(await page.locator("#networks-column").isHidden(), true);
      assert.equal(await page.locator("#code-panel").isHidden(), false);
      assert.equal(await page.locator('[data-work-view="networks"]').getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator('[data-work-view="code"]').getAttribute("aria-expanded"), "true");
      const hidden = await page.evaluate(() => ({
        tick: document.querySelector("#tick-value").textContent,
        text: document.querySelector("#document").value,
        rows: document.querySelectorAll("#live-signals tr").length,
        area: document.querySelector("#document").dataset.panelMark,
        table: document.querySelector("#live-signals").dataset.panelMark,
      }));
      assert.equal(hidden.tick, before.tick);
      assert.equal(hidden.text, before.text);
      assert.equal(hidden.rows, before.rows);
      assert.equal(hidden.area, "kept");
      assert.equal(hidden.table, "kept");
      await page.locator('[data-work-view="networks"]').click();
      assert.equal(await page.locator("#networks-column").isHidden(), false);

      const area = page.locator("#document");
      await area.focus();
      await area.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
      await page.keyboard.type("Q");
      const edited = `${before.text}Q`;
      assert.equal(await area.inputValue(), edited);
      await page.locator('[data-work-view="networks"]').click();
      await page.locator("#undo").click();
      assert.equal(await area.inputValue(), before.text);
      assert.equal(await page.locator("#redo").isDisabled(), false);
      await page.locator("#redo").click();
      assert.equal(await area.inputValue(), edited);
      assert.equal(await page.locator("#live-signals").count(), 1);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test("узкая ширина показывает одну панель и не теряет фокус при resize", { timeout: 90_000 }, async () => {
  const { page, context, errors } = await openEditor(390, 700, "/");
  try {
    assert.equal(await page.locator("#code-panel").isHidden(), false);
    assert.equal(await page.locator("#networks-column").isHidden(), true);
    assert.equal(await page.locator('[data-work-view="code"]').getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator('[data-work-view="networks"]').getAttribute("aria-expanded"), "false");
    const narrowUndo = await page.locator("#undo").boundingBox();
    assert.ok(narrowUndo.x >= 0 && narrowUndo.y >= 0);
    assert.ok(narrowUndo.x + narrowUndo.width <= 391);
    assert.ok(narrowUndo.y + narrowUndo.height <= 701);

    await page.locator('[data-work-view="networks"]').click();
    assert.equal(await page.locator("#code-panel").isHidden(), true);
    assert.equal(await page.locator("#networks-column").isHidden(), false);
    assert.equal(await page.locator("#live-signals").count(), 1);
    await page.locator('[data-work-view="code"]').click();
    assert.equal(await page.locator("#code-panel").isHidden(), false);

    await page.locator("#document").focus();
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#networks-column")).display !== "none"
      && document.activeElement?.id === "document");
    assert.equal(await page.locator("#code-panel").isHidden(), false);

    await page.locator("#signal-filter").focus();
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#code-panel")).display === "none"
      && document.activeElement?.id === "signal-filter");
    assert.equal(await page.locator("#networks-column").isHidden(), false);
    const text = await page.locator("#document").inputValue();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#code-panel")).display !== "none"
      && getComputedStyle(document.querySelector("#networks-column")).display !== "none"
      && document.activeElement?.id === "signal-filter");
    assert.equal(await page.locator("#document").inputValue(), text);
    const scrolled = await page.evaluate(() => {
      const scroller = document.scrollingElement;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + 200;
      const moved = scroller.scrollTop > before + 1;
      scroller.scrollTop = before;
      return moved;
    });
    assert.equal(scrolled, false);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("грубый указатель увеличивает кнопки истории", { timeout: 60_000 }, async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = track(page);
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");
    const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
    assert.equal(coarse, true);
    const box = await page.locator("#undo").boundingBox();
    const play = await page.locator("#play").boundingBox();
    assert.equal(Math.round(box.width), 36);
    assert.equal(Math.round(box.height), 40);
    assert.ok(box.width < play.width);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
