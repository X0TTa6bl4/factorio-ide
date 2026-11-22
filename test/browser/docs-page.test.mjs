/** Руководство: переход со страниц, якоря, история, мобильная панель, копирование и черновик. */

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

const SCREENS = [
  ["/", "#play"],
  ["/pages/configure/", "#play"],
  ["/pages/event/", "#check"],
  ["/pages/project/", "#save-project"],
  ["/pages/circuit/", "#step"],
  ["/pages/debugger/", "#play"],
  ["/pages/networks/", "#launch"],
  ["/pages/examples/", "#demos-title"],
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

function origin(prefix) {
  return `http://127.0.0.1:${port}${prefix}`;
}

async function openPage(prefix, pathname) {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin(prefix)}${pathname}`);
  return { context, page, errors };
}

test("с каждого рабочего экрана открывается руководство", { timeout: 180_000 }, async () => {
  for (const prefix of ["", "/factorio-ide"]) {
    for (const [pathname, ready] of SCREENS) {
      const { context, page, errors } = await openPage(prefix, pathname);
      try {
        await page.waitForSelector(ready);
        assert.equal(await page.locator(".fl-more").count(), 0, pathname);
        assert.equal(await page.getByRole("button", { name: "Совместимость" }).count(), 0, pathname);
        const docs = page.getByRole("link", { name: "Документация" });
        assert.equal(await docs.count(), 1, pathname);
        await docs.click();
        await page.waitForSelector("h1");
        assert.match(page.url(), /\/pages\/docs\/index\.html$/);
        if (prefix) assert.match(page.url(), /\/factorio-ide\/pages\/docs\//);
        assert.equal(await page.locator("h1").first().textContent(), "Что делает f logic");
        assert.equal(await page.locator("a[aria-current='page']").first().textContent(), "Документация");
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await context.close();
      }
    }
  }
});

test("якорь, перезагрузка, история и неизвестный адрес", { timeout: 120_000 }, async () => {
  for (const prefix of ["", "/factorio-ide"]) {
    const { context, page, errors } = await openPage(prefix, "/pages/docs/index.html#networks-reading");
    try {
      const heading = page.locator("#networks-reading");
      await heading.waitFor();
      assert.equal(await heading.textContent(), "Суммирование и чтение");
      assert.equal(await page.locator("a[data-doc-target='networks'][aria-current='page']").count(), 1);
      assert.equal(await page.locator("[data-doc-toc] a[aria-current='location']").getAttribute("data-doc-target"), "networks-reading");
      await page.reload();
      await heading.waitFor();
      assert.equal(page.url().includes("#networks-reading"), true);
      await page.locator("a[data-doc-target='editor']").first().click();
      await page.waitForFunction(() => location.hash === "#editor");
      await page.goBack();
      await page.waitForFunction(() => location.hash === "#networks-reading");
      await heading.waitFor();
      await page.goForward();
      await page.waitForFunction(() => location.hash === "#editor");
      await page.goto(`${origin(prefix)}/pages/docs/index.html#net-razdela`);
      await page.getByRole("heading", { name: "Раздел не найден" }).waitFor();
      const home = page.locator("[data-doc-missing] a[data-doc-target='start']");
      await home.click();
      await page.waitForFunction(() => location.hash === "#start");
      assert.equal(await page.locator("h1").first().textContent(), "Что делает f logic");
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  }
});

test("мобильная панель, копирование, черновик и ширина", { timeout: 180_000 }, async () => {
  const { context, page, errors } = await openPage("", "/pages/docs/index.html#quick-start");
  try {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator("#quick-start").waitFor();
    const menu = page.locator("[data-doc-menu]");
    await menu.click();
    const dialog = page.locator("[data-doc-dialog]");
    await page.waitForFunction(() => document.querySelector("[data-doc-dialog]")?.open === true);
    const focused = await page.evaluate(() => document.querySelector("[data-doc-dialog]")?.contains(document.activeElement));
    assert.equal(focused, true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("[data-doc-dialog]")?.open !== true);
    assert.equal(await menu.evaluate((node) => document.activeElement === node), true);
    await menu.click();
    await dialog.locator("a[data-doc-target='decider']").click();
    await page.waitForFunction(() => location.hash === "#decider" && document.querySelector("[data-doc-dialog]")?.open !== true);
    assert.equal(await page.locator("#decider").evaluate((node) => document.activeElement === node), true);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin("")}/pages/docs/index.html#quick-start`);
    await page.locator("[data-doc-code]").first().waitFor();
    await page.locator("[data-doc-copy]").first().click();
    await page.waitForFunction(() => document.querySelector("[data-doc-copy-status]")?.textContent === "Код скопирован");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /Constant\(\{/);
    assert.match(copied, /wire red_1 \{\}/);
    assert.doesNotMatch(copied, /Копировать/);

    await page.evaluate(() => sessionStorage.setItem("f-logic.editor-draft.v1", "keep-draft"));
    await page.locator("a[data-doc-target='signals']").first().click();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), "keep-draft");

    const shots = [
      [1440, 900, "guide-desktop.png"],
      [768, 900, "guide-tablet.png"],
      [1024, 900, "guide-medium.png"],
    ];
    for (const [width, height, name] of shots) {
      await page.setViewportSize({ width, height });
      const fit = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      assert.equal(fit, true, String(width));
      await page.screenshot({
        path: ".cursor/tasks/0004-epic-_-ui-minimization-round/0001-task-_-user-documentation/media/" + name,
        fullPage: false,
      });
    }
    await page.setViewportSize({ width: 390, height: 800 });
    await page.screenshot({
      path: ".cursor/tasks/0004-epic-_-ui-minimization-round/0001-task-_-user-documentation/media/guide-mobile.png",
      fullPage: false,
    });
    await menu.click();
    await page.waitForFunction(() => document.querySelector("[data-doc-dialog]")?.open === true);
    await page.screenshot({
      path: ".cursor/tasks/0004-epic-_-ui-minimization-round/0001-task-_-user-documentation/media/guide-mobile-nav.png",
      fullPage: false,
    });
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    const zoomed = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.equal(zoomed, true);
    const columns = await page.evaluate(() => getComputedStyle(document.querySelector(".fl-docs__layout")).gridTemplateColumns);
    assert.match(columns, /240px/);

    const hrefs = await page.$$eval("a[href]", (nodes) => [...new Set(nodes.map((node) => node.getAttribute("href")).filter((href) => href && !href.startsWith("#") && !href.startsWith("http")))]);
    for (const href of hrefs) {
      const response = await page.request.get(new URL(href, page.url()).href);
      assert.equal(response.status(), 200, href);
    }
    assert.equal(errors.length, 0, errors.join("\n"));
  } finally {
    await context.close();
  }
});

test("новый черновик остаётся в заголовке кода и спрашивает подтверждение", { timeout: 120_000 }, async () => {
  for (const pathname of ["/", "/factorio-ide/pages/configure/"]) {
    const { context, page, errors } = await openPage("", pathname.startsWith("/factorio-ide") ? "/factorio-ide/pages/configure/" : "/");
    try {
      await page.waitForSelector("#document");
      assert.equal(await page.locator("#toolbar #new-draft").count(), 0);
      assert.equal(await page.locator("#new-draft").count(), 1);
      assert.equal(await page.locator("#new-draft").evaluate((node) => node.closest("[aria-label='Действия документа']") !== null), true);
      await page.locator("#document").fill("temporary draft");
      await page.waitForFunction(() => document.querySelector("#document").value === "temporary draft");
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.locator("#new-draft").click();
      assert.equal(await page.locator("#document").inputValue(), "temporary draft");
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#new-draft").click();
      await page.waitForFunction(() => document.querySelector("#document").value.includes("wooden_chest"));
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  }
});
