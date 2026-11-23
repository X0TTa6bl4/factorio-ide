/** Сквозная приёмка компактного интерфейса: оба адреса, граница 900 px, панели и справка. */

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

const media = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.cursor/tasks/0004-epic-_-ui-minimization-round/0009-task-_-minimization-acceptance/media",
);
const WIDTHS = [320, 390, 768, 900, 901, 1440, 1920];
const HEIGHTS = [600, 900];
const PREFIXES = ["", "/factorio-ide"];

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

async function openPage(prefix, pathname, width = 1440, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(() => sessionStorage.clear());
  const page = await context.newPage();
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}${prefix}${pathname}`);
  return { context, page, errors };
}

async function frame(page) {
  return page.evaluate(() => {
    const scroller = document.scrollingElement;
    const before = scroller.scrollTop;
    scroller.scrollTop = before + 240;
    const documentScrolls = scroller.scrollTop > before + 1;
    scroller.scrollTop = before;
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id).filter(Boolean);
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const broken = [...document.querySelectorAll("[aria-controls]")].flatMap((node) => {
      const id = node.getAttribute("aria-controls");
      if (!id || document.getElementById(id)) return [];
      return [node.id || node.getAttribute("aria-label") || node.textContent.trim().slice(0, 40)];
    });
    return {
      wide: document.documentElement.scrollWidth > window.innerWidth + 1,
      tall: document.documentElement.scrollHeight > window.innerHeight + 1,
      documentScrolls,
      duplicates,
      broken,
    };
  });
}

function assertFrame(fit, label, { vertical = true } = {}) {
  assert.equal(fit.wide, false, `${label} ширина`);
  assert.deepEqual(fit.duplicates, [], `${label} id`);
  assert.deepEqual(fit.broken, [], `${label} aria-controls`);
  if (vertical) {
    assert.equal(fit.tall, false, `${label} высота`);
    assert.equal(fit.documentScrolls, false, `${label} прокрутка`);
  }
}

test.before(async () => {
  mkdirSync(media, { recursive: true });
  server = await startServer({ host: "127.0.0.1", port: 0 });
  port = server.address().port;
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("экраны симуляции держатся в окне на обоих адресах", { timeout: 300_000 }, async () => {
  const page = await browser.newPage();
  const errors = track(page);
  try {
    const cores = [
      ["/", "#play"],
      ["/pages/configure/", "#play"],
      ["/pages/event/", "#check"],
    ];
    for (const prefix of PREFIXES) {
      for (const [pathname, ready] of cores) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`http://127.0.0.1:${port}${prefix}${pathname}`);
        await page.waitForSelector(ready);
        for (const width of WIDTHS) {
          for (const height of HEIGHTS) {
            await page.setViewportSize({ width, height });
            const fit = await frame(page);
            const label = `${prefix || "/"}${pathname} ${width}x${height}`;
            assertFrame(fit, label);
            if (pathname !== "/pages/event/") {
              const narrow = width <= 900;
              try {
                await page.waitForFunction((isNarrow) => {
                  const column = document.querySelector("#networks-column");
                  const code = document.querySelector("#code-panel");
                  const media = window.matchMedia("(max-width: 900px)").matches;
                  return media === isNarrow && column.hidden === isNarrow && code.hidden === false;
                }, narrow, { timeout: 1000 });
              } catch (error) {
                const state = await page.evaluate(() => ({
                  inner: window.innerWidth,
                  client: document.documentElement.clientWidth,
                  scroll: document.documentElement.scrollWidth,
                  height: document.documentElement.scrollHeight,
                  view: window.innerHeight,
                  media: window.matchMedia("(max-width: 900px)").matches,
                  hidden: document.querySelector("#networks-column").hidden,
                  networks: document.querySelector("[data-workbench]")?.dataset.networks,
                }));
                throw new Error(`${label} ${JSON.stringify(state)} ${error.message}`);
              }
              const panels = await page.evaluate(() => ({
                play: Math.round(document.querySelector("#play").getBoundingClientRect().width),
                undoRight: document.querySelector("#undo").getBoundingClientRect().right,
                undoBottom: document.querySelector("#undo").getBoundingClientRect().bottom,
              }));
              assert.equal(panels.play, 40, label);
              assert.ok(panels.undoRight <= width + 1, label);
              assert.ok(panels.undoBottom <= height + 1, label);
            } else {
              const eventFit = await page.evaluate(() => {
                const check = document.querySelector("#check").getBoundingClientRect();
                const stop = document.querySelector("#stop").getBoundingClientRect();
                const inside = (rect) => rect.width > 20 && rect.height > 20
                  && rect.left >= -1 && rect.right <= window.innerWidth + 1
                  && rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
                return inside(check) && inside(stop);
              });
              assert.equal(eventFit, true, label);
            }
          }
        }
      }
    }

    const rest = [
      ["/pages/debugger/", "#play"],
      ["/pages/circuit/", "#step"],
      ["/pages/networks/", "#launch"],
      ["/pages/examples/", "#demos-title"],
      ["/pages/project/", "#save-project"],
      ["/ui/", ".fl-brand"],
      ["/ui/compact.html", ".fl-compact-demo"],
      ["/ui/workspace.html", ".fl-brand"],
    ];
    const samples = [[320, 600], [900, 600], [901, 900], [1440, 900], [1920, 900]];
    for (const prefix of PREFIXES) {
      for (const [pathname, ready] of rest) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`http://127.0.0.1:${port}${prefix}${pathname}`);
        await page.waitForSelector(ready);
        if (pathname.endsWith("compact.html")) {
          await page.waitForSelector(".fl-compact-demo [aria-label='Запустить']");
        }
        for (const [width, height] of samples) {
          await page.setViewportSize({ width, height });
          const fit = await frame(page);
          assertFrame(fit, `${prefix || "/"}${pathname} ${width}x${height}`);
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("редактор: пульт, складки, диагностика, клавиатура и resize", { timeout: 180_000 }, async () => {
  for (const pathname of ["/", "/factorio-ide/pages/configure/"]) {
    const { context, page, errors } = await openPage("", pathname, 1440, 900);
    try {
      await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");
      assert.equal(await page.locator("#document-hint").count(), 0);
      assert.equal(await page.locator(".fl-more").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Совместимость" }).count(), 0);
      await page.getByRole("button", { name: "Меню" }).click();
      assert.equal(await page.getByRole("link", { name: "Документация" }).count(), 1);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("h1").evaluate((node) => node.classList.contains("fl-sr")), true);
      assert.equal(await page.locator("#toolbar #undo, #toolbar #redo").count(), 0);
      assert.equal(await page.locator(".fl-work-edit #undo").count(), 1);
      assert.equal(await page.locator('[role="tablist"]').count(), 0);
      const playText = (await page.locator("#play").innerText()).trim();
      assert.equal(playText, "");
      const undo = await page.locator("#undo").boundingBox();
      const play = await page.locator("#play").boundingBox();
      assert.ok(undo.width < play.width);
      assert.equal(Math.round(undo.width), 32);
      assert.equal(await page.locator("#speed .fl-selectbox__control").innerText(), "1");
      await page.locator("#speed .fl-selectbox__control").focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForSelector("#speed .fl-selectbox__title");
      assert.equal((await page.locator("#speed .fl-selectbox__title").innerText()).trim(), "Скорость");
      assert.match(await page.locator("#speed [role='option']").first().innerText(), /тик\/с/);
      const menuInside = await page.locator("#speed .fl-selectbox__popover, #speed [role='listbox']").first().evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top >= -1 && rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1;
      });
      assert.equal(menuInside, true, pathname);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#speed .fl-selectbox__control").getAttribute("aria-expanded"), "false");

      await page.locator("#play").evaluate((node) => node.focus({ focusVisible: true }));
      const outline = await page.locator("#play").evaluate((node) => getComputedStyle(node).outlineStyle);
      assert.notEqual(outline, "none");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "step");

      await page.locator("#signal-filter").focus();
      await page.setViewportSize({ width: 390, height: 800 });
      await page.waitForFunction(() => document.querySelector("#networks-column").hidden === false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "signal-filter");
      assert.equal(await page.evaluate(() => {
        const column = document.querySelector("#networks-column");
        return column.contains(document.activeElement) && column.getBoundingClientRect().width > 8;
      }), true);
      await page.locator("[data-work-view='code']").click();
      await page.waitForFunction(() => document.querySelector("#code-panel").hidden === false
        && document.querySelector("#networks-column").hidden === true);
      await page.locator("#document").focus();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => document.querySelector("#code-panel").hidden === false
        && document.querySelector("#networks-column").hidden === false);
      await page.setViewportSize({ width: 320, height: 600 });
      await page.waitForFunction(() => document.querySelector("#networks-column").hidden === true
        && document.querySelector("#code-panel").hidden === false
        && document.activeElement?.id === "document");

      const lines = Array.from({ length: 40 }, (_, index) => `// ${"signal-A ".repeat(14)}${index + 1}`);
      const token = "not_real_".repeat(8);
      lines.push(`Constant({ signals: [{ signal: Signal.Logistic.${token}, constant: 1 }] })`);
      await page.locator("#document").fill(lines.join("\n"));
      try {
        await page.waitForFunction((needle) => {
          const kind = document.querySelector("#editor-status")?.dataset.kind;
          const text = document.querySelector("#document-state")?.textContent ?? "";
          return (kind === "error" || kind === "errors") && text.includes(needle);
        }, token.slice(0, 12), { timeout: 5000 });
      } catch (error) {
        const state = await page.evaluate(() => ({
          kind: document.querySelector("#editor-status")?.dataset.kind,
          text: document.querySelector("#document-state")?.textContent,
          value: document.querySelector("#document")?.value.slice(-80),
        }));
        throw new Error(`${pathname} ${JSON.stringify(state)} ${error.message}`);
      }
      const wrapped = await page.evaluate(() => {
        const status = document.querySelector("#editor-status");
        const text = document.querySelector("#document-state");
        const statusRect = status.getBoundingClientRect();
        const textRect = text.getBoundingClientRect();
        return {
          statusInside: statusRect.right <= window.innerWidth + 1 && statusRect.left >= -1,
          textInside: textRect.right <= window.innerWidth + 1,
          wraps: text.scrollHeight > 18 || textRect.height > 18,
          pageWide: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      assert.equal(wrapped.statusInside, true, pathname);
      assert.equal(wrapped.textInside, true, pathname);
      assert.equal(wrapped.wraps, true, pathname);
      assert.equal(wrapped.pageWide, false, pathname);
      await page.locator("#document").evaluate((node) => { node.scrollTop = 0; node.scrollLeft = 0; });
      const gutter = page.locator("#gutter");
      const point = await gutter.boundingBox();
      await page.mouse.move(point.x + point.width / 2, point.y + 24);
      await page.mouse.wheel(0, 280);
      const scrolled = await page.locator("#document").evaluate((node) => ({
        top: node.scrollTop,
        gutterTop: document.querySelector("#gutter").scrollTop,
        gutterLeft: document.querySelector("#gutter").scrollLeft,
      }));
      assert.ok(scrolled.top > 10, `${pathname} gutter ${scrolled.top}`);
      assert.equal(scrolled.gutterTop, scrolled.top);
      assert.equal(scrolled.gutterLeft, 0);

      if (pathname === "/") {
        await page.screenshot({ path: path.join(media, "editor-status-320.png") });
        for (const [width, height, name] of [
          [320, 600, "editor-320.png"],
          [390, 900, "editor-390.png"],
          [768, 900, "editor-768.png"],
          [900, 600, "editor-900.png"],
          [901, 900, "editor-901.png"],
          [1440, 900, "editor-1440.png"],
          [1920, 900, "editor-1920.png"],
        ]) {
          await page.setViewportSize({ width, height });
          await page.screenshot({ path: path.join(media, name) });
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test("экран событий, руководство и грубый указатель", { timeout: 180_000 }, async () => {
  const event = await openPage("", "/pages/event/", 390, 700);
  try {
    await event.page.waitForSelector("#check");
    assert.equal(await event.page.locator("#play, #speed, #back").count(), 0);
    assert.equal((await event.page.locator("#check").innerText()).trim(), "Проверить");
    assert.equal((await event.page.locator("#stop").innerText()).trim(), "Остановить");
    assert.equal((await event.page.locator("#step").innerText()).trim(), "");
    assert.equal(await event.page.getByRole("button", { name: "Совместимость" }).count(), 0);
    await event.page.locator("[data-work-view='code']").evaluate((node) => node.focus({ focusVisible: true }));
    const codeOutline = await event.page.locator("[data-work-view='code']").evaluate((node) => getComputedStyle(node).outlineStyle);
    assert.notEqual(codeOutline, "none");
    await event.page.keyboard.press("Tab");
    assert.equal(await event.page.evaluate(() => document.activeElement?.getAttribute("data-work-view")), "networks");
    await event.page.keyboard.press("Enter");
    await event.page.waitForFunction(() => document.querySelector("#networks-column").hidden === false
      && document.querySelector("#code-panel").hidden === true);
    await event.page.screenshot({ path: path.join(media, "event-390.png") });
    await event.page.setViewportSize({ width: 1440, height: 900 });
    await event.page.locator("#script-source").focus();
    await event.page.waitForFunction(() => document.querySelector("#code-panel").hidden === false
      && document.querySelector("#networks-column").hidden === false);
    const columns = await event.page.evaluate(() => {
      const code = document.querySelector("#code-panel").getBoundingClientRect();
      const networks = document.querySelector("#networks-column").getBoundingClientRect();
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return { code: code.width, networks: networks.width, min: root * 16, side: networks.x >= code.x + code.width - 8 };
    });
    assert.ok(columns.side);
    assert.ok(columns.code > columns.networks * 1.5);
    assert.ok(columns.networks + 1 >= columns.min);
    await event.page.screenshot({ path: path.join(media, "event-1440.png") });
    assert.deepEqual(event.errors, []);
  } finally {
    await event.context.close();
  }

  for (const prefix of PREFIXES) {
    const docs = await openPage(prefix, "/pages/docs/index.html#editor", 1440, 900);
    try {
      await docs.page.waitForSelector("#editor");
      const editorText = await docs.page.locator("[data-doc-article='editor']").innerText();
      assert.match(editorText, /Tab/);
      assert.match(editorText, /Ctrl\+Alt\+L|⌥⌘L/);
      await docs.page.goto(`http://127.0.0.1:${port}${prefix}/pages/docs/index.html#compatibility`);
      await docs.page.waitForSelector("#compatibility");
      const note = await docs.page.locator("[data-doc-article='compatibility']").innerText();
      assert.match(note, /2\.1\.24/);
      assert.match(note, /не заявлена/);
      assert.equal(await docs.page.getByRole("button", { name: "Совместимость" }).count(), 0);
      for (const [width, height] of [[320, 600], [390, 900], [1440, 900], [1920, 900]]) {
        await docs.page.setViewportSize({ width, height });
        const wide = await docs.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        assert.equal(wide, false, `${prefix} docs ${width}`);
      }
      if (prefix === "") {
        await docs.page.setViewportSize({ width: 390, height: 800 });
        await docs.page.screenshot({ path: path.join(media, "docs-compatibility-390.png") });
        await docs.page.goto(`http://127.0.0.1:${port}/pages/docs/index.html#editor`);
        await docs.page.waitForSelector("#editor");
        await docs.page.setViewportSize({ width: 1440, height: 900 });
        await docs.page.screenshot({ path: path.join(media, "docs-editor-1440.png") });
      }
      assert.deepEqual(docs.errors, []);
    } finally {
      await docs.context.close();
    }
  }

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 800 },
    hasTouch: true,
  });
  const touch = await touchContext.newPage();
  const touchErrors = track(touch);
  try {
    await touch.goto(`http://127.0.0.1:${port}/`);
    await touch.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");
    const coarse = await touch.evaluate(() => matchMedia("(pointer: coarse)").matches);
    assert.equal(coarse, true);
    const undo = await touch.locator("#undo").boundingBox();
    assert.equal(Math.round(undo.width), 36);
    assert.ok(Math.round(undo.height) >= 40);
    const lines = Array.from({ length: 40 }, (_, index) => `// ${"wide-token ".repeat(12)}${index}`);
    await touch.locator("#document").fill(lines.join("\n"));
    await touch.locator("#document").evaluate((node) => { node.scrollTop = 200; node.scrollLeft = 80; });
    const gutter = touch.locator("#gutter");
    const box = await gutter.boundingBox();
    await touch.dispatchEvent("#gutter", "pointerdown", {
      pointerType: "touch", pointerId: 1, button: 0, clientX: box.x + 8, clientY: box.y + 40, bubbles: true,
    });
    await touch.dispatchEvent("#gutter", "pointermove", {
      pointerType: "touch", pointerId: 1, button: 0, clientX: box.x + 36, clientY: box.y + 110, bubbles: true,
    });
    await touch.dispatchEvent("#gutter", "pointerup", {
      pointerType: "touch", pointerId: 1, button: 0, bubbles: true,
    });
    const after = await touch.locator("#document").evaluate((node) => ({ top: node.scrollTop, left: node.scrollLeft }));
    assert.ok(after.top < 200, `touch scroll ${after.top}`);
    await touch.screenshot({ path: path.join(media, "editor-touch-390.png") });
    assert.deepEqual(touchErrors, []);
  } finally {
    await touchContext.close();
  }

  const library = await openPage("", "/ui/compact.html", 320, 600);
  try {
    await library.page.waitForSelector(".fl-compact-demo [aria-label='Запустить']");
    await library.page.screenshot({ path: path.join(media, "compact-320.png") });
    await library.page.setViewportSize({ width: 1440, height: 900 });
    await library.page.screenshot({ path: path.join(media, "compact-1440.png") });
    await library.page.goto(`http://127.0.0.1:${port}/factorio-ide/ui/`);
    await library.page.waitForSelector(".fl-brand");
    await library.page.setViewportSize({ width: 320, height: 600 });
    await library.page.screenshot({ path: path.join(media, "catalog-320.png") });
    assert.deepEqual(library.errors, []);
  } finally {
    await library.context.close();
  }
});
