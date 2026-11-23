/** Повторная приёмка workbench: сценарий 15–18, раскладка и регрессия 1–14. */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";
import { CONFIGURATION_EXAMPLE } from "../../src/config-editor.js";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

const media = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.cursor/tasks/0004-epic-_-ui-minimization-round/0013-task-_-minimization-acceptance-round2/media",
);
const WIDTHS = [320, 390, 768, 900, 901, 1440, 1920];
const HEIGHTS = [600, 900];
const EDITORS = ["/", "/pages/configure/", "/factorio-ide/", "/factorio-ide/pages/configure/"];
const PAGES = [
  ["/", "/pages/docs/index.html"],
  ["/pages/configure/", "/pages/docs/index.html"],
  ["/pages/event/", "/pages/docs/index.html"],
  ["/pages/debugger/", "/pages/docs/index.html"],
  ["/pages/circuit/", "/pages/docs/index.html"],
  ["/pages/networks/", "/pages/docs/index.html"],
  ["/pages/project/", "/pages/docs/index.html"],
  ["/pages/examples/", "/pages/docs/index.html"],
  ["/pages/docs/", "/pages/docs/index.html"],
];
const NAMED_INDEX = JSON.stringify({ records: [{ id: "p9", name: "Именованная" }] });
const NAMED_BODY = "named-scheme-body";

let server;
let browser;
let port;
const matrix = { editors: {}, gutter: {}, pages: [], zoom: null, pointers: {} };

function track(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function openAt(pathname, width, height, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: options.touch === true,
  });
  const page = await context.newPage();
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}${pathname}`);
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
    const broken = [];
    for (const attr of ["aria-controls", "aria-labelledby", "aria-describedby"]) {
      for (const node of document.querySelectorAll(`[${attr}]`)) {
        for (const id of node.getAttribute(attr).split(/\s+/)) {
          if (id && !document.getElementById(id)) broken.push(`${attr}:${id}`);
        }
      }
    }
    return {
      wide: document.documentElement.scrollWidth > window.innerWidth + 1,
      tall: document.documentElement.scrollHeight > window.innerHeight + 1,
      documentScrolls,
      duplicates,
      broken,
    };
  });
}

function assertFrame(fit, label) {
  assert.equal(fit.wide, false, `${label} ширина`);
  assert.equal(fit.tall, false, `${label} высота`);
  assert.equal(fit.documentScrolls, false, `${label} прокрутка`);
  assert.deepEqual(fit.duplicates, [], `${label} id`);
  assert.deepEqual(fit.broken, [], `${label} aria`);
}

async function visibleControls(page) {
  return page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll("#code-panel > .fl-panel__head [data-work-view], #undo, #redo, #play, [data-topbar-menu] summary"),
    ];
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        name: node.getAttribute("data-work-view") || node.id || node.getAttribute("aria-label") || "control",
        seen: style.display !== "none" && style.visibility !== "hidden" && rect.width > 8 && rect.height > 8,
        inside: rect.top >= -1 && rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
      };
    });
  });
}

function assertVisible(controls, label) {
  for (const control of controls) {
    assert.equal(control.seen, true, `${label} ${control.name}`);
    assert.equal(control.inside, true, `${label} ${control.name} ${JSON.stringify(control)}`);
  }
}

async function measureGutter(page, selector) {
  return page.evaluate((gutterSelector) => {
    const gutter = document.querySelector(gutterSelector);
    const area = gutter.parentElement.querySelector("textarea");
    const box = gutter.getBoundingClientRect();
    const text = gutter.firstChild;
    const parts = gutter.textContent.split("\n");
    const range = document.createRange();
    let extra = 0;
    let clipped = 0;
    if (text?.nodeType === Node.TEXT_NODE) {
      let cursor = 0;
      for (const line of parts) {
        if (line) {
          range.setStart(text, cursor);
          range.setEnd(text, cursor + line.length);
          const rects = [...range.getClientRects()].filter((item) => item.width > 0.5);
          if (rects.length > 1) extra += 1;
          for (const item of rects) {
            if (item.right > box.right + 1 || item.left < box.left - 1) clipped += 1;
          }
        }
        cursor += line.length + 1;
      }
    }
    return {
      gutter: box.width,
      extra,
      clipped,
      scroll: gutter.scrollWidth,
      client: gutter.clientWidth,
      lines: parts.length,
      area: area.getBoundingClientRect().width,
    };
  }, selector);
}

async function writeLines(page, selector, count) {
  await page.evaluate(({ selector, count }) => {
    const area = document.querySelector(selector);
    area.focus();
    area.value = Array.from({ length: count }, (_, index) => `const line${index + 1} = ${index + 1};`).join("\n");
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
  }, { selector, count });
  await page.waitForFunction(({ selector, count }) => {
    const area = document.querySelector(selector);
    const gutter = area.closest(".fl-editor")?.querySelector(".fl-editor__gutter");
    return gutter?.textContent.split("\n").length === count;
  }, { selector, count });
}

async function openMenu(page) {
  await page.getByRole("button", { name: "Меню" }).click();
  await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open === true);
}

test.before(async () => {
  mkdirSync(media, { recursive: true });
  server = await startServer({ host: "127.0.0.1", port: 0 });
  port = server.address().port;
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
});

test.after(async () => {
  writeFileSync(path.join(media, "matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`);
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("сквозной сценарий workbench на обоих адресах", { timeout: 420_000 }, async () => {
  for (const pathname of EDITORS) {
    const { context, page, errors } = await openAt(pathname, 1440, 900);
    try {
      await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");
      const address = new URL(page.url()).pathname;
      await page.evaluate(({ index, body }) => {
        localStorage.setItem("f-logic.projects.v1", index);
        localStorage.setItem("f-logic.project.v1.p9", body);
      }, { index: NAMED_INDEX, body: NAMED_BODY });

      const head = await page.evaluate(() => {
        const panel = document.querySelector("#code-panel");
        const buttons = [...panel.querySelectorAll(":scope > .fl-panel__head [data-work-view]")];
        const stage = document.querySelector("[data-workbench]");
        return {
          inside: panel.querySelector(":scope > .fl-panel__head") !== null,
          separate: stage.firstElementChild?.classList.contains("fl-panel__head") !== true,
          tags: buttons.map((node) => node.tagName),
          labels: buttons.map((node) => node.textContent.trim()),
          classes: buttons.map((node) => node.className),
          openEvents: document.querySelector("#open-events") !== null,
          newDraft: document.querySelector("#new-draft") !== null,
          tables: document.querySelectorAll("#live-signals").length,
        };
      });
      assert.equal(head.inside, true, pathname);
      assert.equal(head.separate, true, pathname);
      assert.deepEqual(head.tags, ["BUTTON", "BUTTON", "BUTTON"]);
      assert.deepEqual(head.labels, ["Код", "Сети", "События"]);
      assert.equal(new Set(head.classes).size, 1, pathname);
      assert.equal(head.openEvents, false, pathname);
      assert.equal(head.newDraft, false, pathname);
      assert.equal(head.tables, 1, pathname);
      assert.equal(await page.getByRole("button", { name: "Новый черновик" }).count(), 0);
      assertVisible(await visibleControls(page), `${pathname} старт`);

      const original = await page.locator("#document").inputValue();
      const edited = original.replace("constant: 3", "constant: 9");
      assert.notEqual(edited, original);
      await page.locator("#document").fill(edited);
      await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");

      await page.locator("[data-work-view='events']").click();
      assert.equal(new URL(page.url()).pathname, address, pathname);
      assert.equal(await page.locator("#events-view").isHidden(), false);
      assert.equal(await page.locator("#scheme-view").isHidden(), true);
      assertVisible(await visibleControls(page), `${pathname} события`);
      const script = await page.locator("#event-source").inputValue();
      await page.locator("#event-source").fill(`${script}\n// round2`);
      await page.locator("#event-check").click();
      await page.waitForFunction(() => document.querySelector("#event-run-status")?.dataset.status === "ready");
      await page.locator("#event-step").click();
      await page.waitForFunction(() => document.querySelector("#event-tick")?.textContent === "1");
      assert.equal(await page.locator("#live-signals").count(), 1);
      assert.equal(await page.locator("#signal-mode").textContent(), "События");
      assert.equal(await page.locator("#signal-panel").getAttribute("data-source"), "events");
      assert.match(await page.locator("#live-signals").textContent(), /signal-A/);
      const eventTick = await page.locator("#event-tick").textContent();

      await page.locator("[data-work-view='code']").click();
      assert.equal(new URL(page.url()).pathname, address, pathname);
      assert.equal(await page.locator("#signal-mode").textContent(), "Схема");
      assert.equal(await page.locator("#signal-panel").getAttribute("data-source"), "scheme");
      assert.equal(await page.locator("#document").inputValue(), edited);
      assert.equal(await page.locator("#event-tick").textContent(), eventTick);
      await page.locator("#undo").click();
      await page.waitForFunction(() => document.querySelector("#document").value.includes("constant: 3"));
      assert.match(await page.locator("#event-source").inputValue(), /\/\/ round2/);
      await page.locator("#redo").click();
      await page.waitForFunction(() => document.querySelector("#document").value.includes("constant: 9"));

      const broken = edited.replace("Signal.Logistic.wooden_chest", "Signal.Logistic.not_real_round2");
      await page.locator("#document").fill(broken);
      await page.waitForFunction(() => {
        const jump = document.querySelector("#status-jump");
        return jump && jump.hidden === false;
      });
      await page.locator("#status-jump").click();
      await page.waitForFunction(() => {
        const node = document.querySelector("#document");
        const gutter = document.querySelector("#gutter");
        const selected = node.value.slice(node.selectionStart, node.selectionEnd);
        return document.activeElement === node
          && selected.includes("not_real_round2")
          && gutter.scrollTop === node.scrollTop
          && gutter.scrollLeft === 0;
      }, null, { timeout: 2000 });

      await page.setViewportSize({ width: 901, height: 900 });
      await page.waitForFunction(() => document.querySelector("#networks-column").hidden === false
        && document.querySelector("#code-panel").hidden === false);
      assertVisible(await visibleControls(page), `${pathname} 901`);
      await page.setViewportSize({ width: 900, height: 600 });
      await page.waitForFunction(() => document.querySelector("#networks-column").hidden === true
        && document.querySelector("#code-panel").hidden === false
        && document.activeElement?.id === "document");
      assertVisible(await visibleControls(page), `${pathname} 900`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => document.querySelector("#networks-column").hidden === false);
      assert.equal(await page.locator("#document").inputValue(), broken);
      assert.match(await page.locator("#event-source").inputValue(), /\/\/ round2/);
      assert.equal(await page.locator("#event-tick").textContent(), eventTick);

      await openMenu(page);
      await page.getByRole("link", { name: "Документация" }).click();
      await page.waitForSelector("#start, h1");
      assert.match(page.url(), /\/pages\/docs\//);
      assert.match(await page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), /not_real_round2/);
      await page.goBack();
      await page.waitForFunction(() => document.querySelector("#document")?.value.includes("not_real_round2"));
      assert.equal((await page.locator("#event-source").inputValue()).includes("// round2"), false);

      await openMenu(page);
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.getByRole("button", { name: "Очистить проект" }).click();
      assert.match(await page.locator("#document").inputValue(), /not_real_round2/);
      assert.equal(await page.evaluate(() => localStorage.getItem("f-logic.projects.v1")), NAMED_INDEX);
      assert.equal(await page.evaluate(() => localStorage.getItem("f-logic.project.v1.p9")), NAMED_BODY);

      await openMenu(page);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Очистить проект" }).click();
      await page.waitForFunction(() => document.querySelector("#document")?.value.includes("wooden_chest"));
      assert.equal(await page.locator("#document").inputValue(), CONFIGURATION_EXAMPLE);
      await page.locator("[data-work-view='events']").click();
      assert.equal((await page.locator("#event-source").inputValue()).includes("// round2"), false);
      assert.equal(await page.locator("#event-run-status").getAttribute("data-status"), "idle");
      assert.equal(await page.evaluate(() => localStorage.getItem("f-logic.projects.v1")), NAMED_INDEX);
      assert.equal(await page.evaluate(() => localStorage.getItem("f-logic.project.v1.p9")), NAMED_BODY);
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#document")?.value.includes("wooden_chest"));
      assert.equal(await page.locator("#document").inputValue(), CONFIGURATION_EXAMPLE);
      assert.doesNotMatch(await page.locator("#document").inputValue(), /not_real_round2/);
      assert.equal(await page.evaluate(() => localStorage.getItem("f-logic.projects.v1")), NAMED_INDEX);
      assert.equal(await page.evaluate(() => localStorage.getItem("f-logic.project.v1.p9")), NAMED_BODY);
      assert.deepEqual(errors, []);
      matrix.editors[pathname] = "scenario-ok";
    } finally {
      await context.close();
    }
  }
});

test("раскладка, gutter, меню, масштаб и указатели", { timeout: 420_000 }, async () => {
  const { context, page, errors } = await openAt("/", 1440, 900);
  try {
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");
    assert.equal(await page.locator("#document-hint").count(), 0);
    assert.equal(await page.locator(".fl-more").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Совместимость" }).count(), 0);
    assert.equal(await page.locator(".fl-topbar__docs").count(), 0);
    assert.equal(await page.locator("#toolbar #undo, #toolbar #redo").count(), 0);
    assert.equal(await page.locator(".fl-work-edit #undo").count(), 1);
    assert.equal(await page.locator("h1").evaluate((node) => node.classList.contains("fl-sr")), true);
    assert.equal((await page.locator("#play").innerText()).trim(), "");
    assert.equal(Math.round((await page.locator("#play").boundingBox()).width), 40);
    assert.equal(await page.locator("#speed .fl-selectbox__control").innerText(), "1");
    assert.equal((await page.locator("#step").innerText()).trim(), "");
    assert.equal(await page.locator("#step").getAttribute("aria-label"), "Шаг");
    assert.equal(await page.locator("#back").getAttribute("aria-label"), "Шаг назад");
    assert.equal(await page.locator("#reset").getAttribute("aria-label"), "Сброс");
    const undo = await page.locator("#undo").boundingBox();
    assert.equal(Math.round(undo.width), 32);

    const codeButton = page.locator("[data-work-view='code']");
    await codeButton.focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-work-view")), "networks");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-work-view")), "events");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#events-view").hidden === false);
    assert.equal(new URL(page.url()).pathname, "/");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#scheme-view").hidden === false);
    const summary = page.locator("[data-topbar-menu] summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open === true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open !== true);
    assert.equal(await summary.evaluate((node) => document.activeElement === node), true);

    for (const width of WIDTHS) {
      for (const height of HEIGHTS) {
        await page.setViewportSize({ width, height });
        const fit = await frame(page);
        assertFrame(fit, `/ ${width}x${height}`);
        assertVisible(await visibleControls(page), `/ ${width}x${height}`);
      }
    }
    const shots = [
      [320, 600, "workbench-320.png"],
      [390, 900, "workbench-390.png"],
      [768, 900, "workbench-768.png"],
      [900, 600, "workbench-900.png"],
      [901, 900, "workbench-901.png"],
      [1440, 900, "workbench-1440.png"],
      [1920, 900, "workbench-1920.png"],
    ];
    for (const [width, height, name] of shots) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(media, name) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("[data-work-view='events']").click();
    await page.waitForSelector("#event-source");
    await page.screenshot({ path: path.join(media, "workbench-events-1440.png") });
    await page.locator("[data-work-view='code']").click();

    await page.setViewportSize({ width: 1440, height: 900 });
    await writeLines(page, "#document", 40);
    for (const width of [901, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const shape = await measureGutter(page, "#gutter");
      assert.equal(shape.extra, 0, JSON.stringify(shape));
      assert.equal(shape.clipped, 0, JSON.stringify(shape));
      assert.ok(shape.scroll <= shape.client + 1, JSON.stringify(shape));
      assert.ok(shape.gutter < 40, JSON.stringify(shape));
      matrix.gutter[width] = shape.gutter;
    }
    assert.ok(Math.abs(matrix.gutter[1440] - matrix.gutter[1920]) < 1, JSON.stringify(matrix.gutter));
    const point = await page.locator("#gutter").boundingBox();
    await page.mouse.move(point.x + point.width / 2, point.y + 24);
    await page.mouse.wheel(0, 240);
    const scrolled = await page.locator("#document").evaluate((node) => ({
      top: node.scrollTop,
      gutter: document.querySelector("#gutter").scrollTop,
      left: document.querySelector("#gutter").scrollLeft,
    }));
    assert.ok(scrolled.top > 10, JSON.stringify(scrolled));
    assert.equal(scrolled.gutter, scrolled.top);
    assert.equal(scrolled.left, 0);
    await page.screenshot({ path: path.join(media, "gutter-1440.png") });
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.screenshot({ path: path.join(media, "gutter-1920.png") });

    await page.setViewportSize({ width: 320, height: 700 });
    await openMenu(page);
    const menuBox = await page.locator("[data-topbar-menu] .fl-menu__items").boundingBox();
    assert.ok(menuBox.x >= -1 && menuBox.x + menuBox.width <= 321);
    await page.screenshot({ path: path.join(media, "menu-320.png") });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMenu(page);
    await page.screenshot({ path: path.join(media, "menu-1440.png") });
    await page.keyboard.press("Escape");

    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await page.setViewportSize({ width: 390, height: 800 });
    const zoomed = await frame(page);
    assert.equal(zoomed.wide, false, "масштаб 200%");
    assert.equal(zoomed.documentScrolls, false, "масштаб 200%");
    assertVisible(await visibleControls(page), "масштаб 200%");
    matrix.zoom = { wide: zoomed.wide, documentScrolls: zoomed.documentScrolls };
    await page.screenshot({ path: path.join(media, "workbench-text-200-390.png") });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true });
  const touch = await touchContext.newPage();
  const touchErrors = track(touch);
  try {
    await touch.goto(`http://127.0.0.1:${port}/pages/configure/`);
    await touch.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Код проверен");
    assert.equal(await touch.evaluate(() => matchMedia("(pointer: coarse)").matches), true);
    const undo = await touch.locator("#undo").boundingBox();
    assert.equal(Math.round(undo.width), 36);
    assert.ok(Math.round(undo.height) >= 40);
    await touch.locator("[data-work-view='events']").tap();
    await touch.waitForFunction(() => document.querySelector("#events-view").hidden === false);
    assert.equal(new URL(touch.url()).pathname, "/pages/configure/");
    await touch.locator("[data-topbar-menu] summary").tap();
    await touch.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open === true);
    matrix.pointers.touch = { undo: Math.round(undo.width), events: true };
    await touch.screenshot({ path: path.join(media, "workbench-touch-390.png") });
    assert.deepEqual(touchErrors, []);
  } finally {
    await touchContext.close();
  }

  for (const prefix of ["", "/factorio-ide"]) {
    for (const [pathname, docsPath] of PAGES) {
      const opened = await openAt(`${prefix}${pathname}`, 1280, 800);
      try {
        await opened.page.locator("[data-topbar-menu]").waitFor();
        assert.equal(await opened.page.locator(".fl-topbar__docs").count(), 0, pathname);
        assert.equal(await opened.page.locator("#new-draft").count(), 0, pathname);
        assert.equal(await opened.page.getByRole("button", { name: "Новый черновик" }).count(), 0, pathname);
        assert.equal(await opened.page.getByRole("button", { name: "Меню" }).count(), 1, pathname);
        const resolved = await opened.page.locator("[data-topbar-menu] a").evaluate((node) => new URL(node.getAttribute("href"), location.href).pathname);
        assert.equal(resolved, `${prefix}${docsPath}`, `${prefix}${pathname}`);
        if (pathname === "/pages/docs/" || pathname === "/") {
          const fit = await frame(opened.page);
          if (pathname === "/") assertFrame(fit, `${prefix}${pathname}`);
          else assert.equal(fit.wide, false, `${prefix}${pathname}`);
        }
        matrix.pages.push(`${prefix}${pathname}`);
        assert.deepEqual(opened.errors, []);
      } finally {
        await opened.context.close();
      }
    }
  }

  for (const pathname of ["/pages/event/", "/factorio-ide/pages/event/"]) {
    const opened = await openAt(pathname, 1440, 900);
    try {
      await opened.page.waitForSelector("#check");
      assert.equal(await opened.page.locator("#play, #speed, #back").count(), 0);
      assert.equal((await opened.page.locator("#check").innerText()).trim(), "Проверить");
      assert.equal((await opened.page.locator("#stop").innerText()).trim(), "Остановить");
      await writeLines(opened.page, "#script-source", 40);
      const shape = await measureGutter(opened.page, "#code-gutter");
      assert.equal(shape.extra, 0, JSON.stringify(shape));
      assert.equal(shape.clipped, 0, JSON.stringify(shape));
      assert.ok(shape.gutter < 40, JSON.stringify(shape));
      const fit = await frame(opened.page);
      assertFrame(fit, pathname);
      matrix.gutter[pathname] = shape.gutter;
      assert.deepEqual(opened.errors, []);
    } finally {
      await opened.context.close();
    }
  }
});
