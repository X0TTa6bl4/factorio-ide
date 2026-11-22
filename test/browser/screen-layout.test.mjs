/** Каркас экранов: нет внешней прокрутки документа и нативных select. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

const WIDTHS = [320, 390, 768, 1024, 1440];
const HEIGHTS = [600, 900];
const PAGES = [
  ["/", "#play"],
  ["/pages/configure/", "#play"],
  ["/pages/event/", "#check"],
  ["/pages/debugger/", "#play"],
  ["/pages/networks/", "#launch"],
  ["/pages/project/", "#save-project"],
  ["/pages/circuit/", "#step"],
  ["/pages/examples/", "#demos-title"],
  ["/ui/", ".fl-brand"],
  ["/ui/workspace.html", ".fl-brand"],
];

let server;
let browser;
let port;

test.before(async () => {
  server = await startServer({ host: "127.0.0.1", port: 0 });
  port = server.address().port;
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("экраны держатся в окне, выбор не нативный, справка честная", { timeout: 180_000 }, async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    for (const [pathname, command] of PAGES) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`http://127.0.0.1:${port}/factorio-ide${pathname}`);
      await page.waitForSelector(command);
      assert.equal(await page.locator("select").count(), 0, pathname);
      assert.equal(await page.locator(".fl-workspace__title, [data-release-note]").count(), 0, pathname);
      const about = page.getByRole("button", { name: "Совместимость" });
      if (await about.count()) {
        await about.first().click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        const text = await dialog.textContent();
        assert.match(text, /не заявлена/);
        assert.doesNotMatch(text, /совместимо с Factorio/);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector("dialog[open]"));
      }
      for (const width of WIDTHS) {
        for (const height of HEIGHTS) {
          await page.setViewportSize({ width, height });
          const fit = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            const rect = element.getBoundingClientRect();
            const scroller = document.scrollingElement;
            const before = scroller.scrollTop;
            scroller.scrollTop = before + 240;
            const documentScrolls = scroller.scrollTop > before + 1;
            scroller.scrollTop = before;
            return {
              wide: document.documentElement.scrollWidth > window.innerWidth + 1,
              tall: document.documentElement.scrollHeight > window.innerHeight + 1,
              documentScrolls,
              command: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight,
            };
          }, command);
          assert.equal(fit.wide, false, `${pathname} ${width}x${height} ширина`);
          assert.equal(fit.tall, false, `${pathname} ${width}x${height} высота`);
          assert.equal(fit.documentScrolls, false, `${pathname} ${width}x${height} скролл`);
          assert.equal(fit.command, true, `${pathname} ${width}x${height} команда`);
        }
      }
    }

    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/debugger/`);
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0"
      && document.querySelector("#speed .fl-selectbox__control")?.disabled === false);
    const speed = page.locator("#speed .fl-selectbox__control");
    await speed.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.querySelector("#speed .fl-selectbox__control")?.getAttribute("aria-expanded") === "true");
    const option = page.locator("#speed [role='option'][data-active='true']");
    await option.waitFor();
    const inside = await option.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
    });
    assert.equal(inside, true);
    await page.keyboard.press("Escape");
    assert.equal(await speed.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#import-file").count(), 0);
    await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/project/`);
    await page.waitForSelector("#import-file");
    assert.equal(await page.locator("#import-file").getAttribute("type"), "file");
    await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/examples/`);
    await page.waitForSelector("#demos-title");
    assert.equal(await page.locator(".fl-screen__drawers").count(), 1, "примеры сохраняют нижние панели");
    assert.equal(await page.locator(".fl-editor-inspector").count(), 0);
    for (const pathname of ["/", "/pages/configure/"]) {
      await page.goto(`http://127.0.0.1:${port}/factorio-ide${pathname}`);
      await page.waitForSelector("#play");
      assert.equal(await page.locator(".fl-screen__drawers").count(), 0, pathname);
      assert.deepEqual(
        (await page.locator(".fl-editor-inspector > section h2").allTextContents()).map((text) => text.trim()),
        ["Сети", "Диагностика"],
      );
      for (const [width, height] of [[320, 600], [390, 600], [768, 600], [1440, 900], [1920, 700]]) {
        await page.setViewportSize({ width, height });
        const diagnosticsToggle = page.locator("#diagnostics-toggle");
        if (await diagnosticsToggle.getAttribute("aria-expanded") !== "true") await diagnosticsToggle.click();
        const fit = await page.evaluate(() => {
          const scroller = document.scrollingElement;
          const before = scroller.scrollTop;
          scroller.scrollTop = before + 280;
          const documentScrolls = scroller.scrollTop > before + 1;
          scroller.scrollTop = before;
          const code = document.querySelector(".fl-editor-stage > .fl-panel").getBoundingClientRect();
          const inspector = document.querySelector(".fl-editor-inspector").getBoundingClientRect();
          const play = document.querySelector("#play").getBoundingClientRect();
          const signals = document.querySelector("#signal-scroll");
          const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
          return {
            documentScrolls,
            wide: document.documentElement.scrollWidth > window.innerWidth + 1,
            tall: document.documentElement.scrollHeight > window.innerHeight + 1,
            code: { x: code.x, y: code.y, width: code.width, height: code.height },
            inspector: { x: inspector.x, y: inspector.y, width: inspector.width, height: inspector.height },
            playVisible: play.width > 0 && play.height > 0 && play.top >= -1 && play.bottom <= window.innerHeight + 1,
            codeVisible: code.height > 24 && code.top < window.innerHeight && code.bottom > 0,
            signalsOverflow: getComputedStyle(signals).overflowY,
            codeOverflow: getComputedStyle(document.querySelector("#document")).overflowY,
            minInspector: root * 16,
          };
        });
        const label = `${pathname} ${width}x${height}`;
        assert.equal(fit.documentScrolls, false, label);
        assert.equal(fit.wide, false, label);
        assert.equal(fit.tall, false, label);
        assert.equal(fit.playVisible, true, label);
        assert.equal(fit.codeVisible, true, label);
        assert.equal(fit.signalsOverflow, "auto", label);
        assert.equal(fit.codeOverflow, "auto", label);
        if (width > 900) {
          assert.ok(fit.inspector.x >= fit.code.x + fit.code.width - 8, label);
          assert.ok(fit.code.width > fit.inspector.width * 1.5, label);
          assert.ok(fit.inspector.width + 1 >= fit.minInspector, label);
        } else {
          assert.ok(fit.inspector.y >= fit.code.y + fit.code.height - 8, label);
          const ratio = fit.code.height / fit.inspector.height;
          assert.ok(ratio > 1.3 && ratio < 2.1, `${label} ${ratio}`);
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
