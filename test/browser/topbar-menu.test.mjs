/** Меню шапки: документация, очистка черновика, клавиатура и узкая ширина. */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";
import { CONFIGURATION_EXAMPLE } from "../../src/config-editor.js";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

const SHOTS = ".cursor/tasks/0004-epic-_-ui-minimization-round/0012-task-_-topbar-overflow-menu/media";
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

let server;
let browser;
let port;

test.before(async () => {
  server = await startServer({ host: "127.0.0.1", port: 0 });
  port = server.address().port;
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  await mkdir(SHOTS, { recursive: true });
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

function origin(prefix) {
  return `http://127.0.0.1:${port}${prefix}`;
}

async function openPage(prefix, pathname, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin(prefix)}${pathname}`);
  await page.locator("[data-topbar-menu]").waitFor();
  return { context, page, errors };
}

async function openMenu(page) {
  const menu = page.getByRole("button", { name: "Меню" });
  await menu.click();
  await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open === true);
  return menu;
}

test("на девяти адресах одно меню и относительная ссылка", { timeout: 180_000 }, async () => {
  for (const prefix of ["", "/factorio-ide"]) {
    for (const [pathname, docsPath] of PAGES) {
      const { context, page, errors } = await openPage(prefix, pathname);
      try {
        assert.equal(await page.locator(".fl-topbar__docs").count(), 0, pathname);
        assert.equal(await page.locator("#new-draft").count(), 0, pathname);
        assert.equal(await page.getByRole("button", { name: "Новый черновик" }).count(), 0, pathname);
        assert.equal(await page.getByRole("button", { name: "Меню" }).count(), 1, pathname);
        assert.equal(await page.locator("[data-topbar-menu] [data-select]").count(), 0, pathname);
        const resolved = await page.locator("[data-topbar-menu] a").evaluate((node) => new URL(node.getAttribute("href"), location.href).pathname);
        assert.equal(resolved, `${prefix}${docsPath}`, pathname);
        await openMenu(page);
        assert.equal(await page.getByRole("link", { name: "Документация" }).count(), 1, pathname);
        assert.equal(await page.getByRole("button", { name: "Очистить проект" }).count(), 1, pathname);
        const iconHidden = await page.locator("[data-topbar-menu] summary svg").getAttribute("aria-hidden");
        assert.equal(iconHidden, "true", pathname);
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await context.close();
      }
    }
  }
});

test("клавиатура, клик снаружи, resize и меню на узкой ширине", { timeout: 120_000 }, async () => {
  const { context, page, errors } = await openPage("", "/", { width: 1440, height: 900 });
  try {
    await page.waitForFunction(() => document.querySelector("#document"));
    const summary = page.locator("[data-topbar-menu] summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open === true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open !== true);
    assert.equal(await summary.evaluate((node) => document.activeElement === node), true);

    await openMenu(page);
    await page.locator("#main").click({ position: { x: 12, y: 12 } });
    await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open !== true);

    await summary.focus();
    await page.setViewportSize({ width: 390, height: 700 });
    assert.equal(await summary.evaluate((node) => document.activeElement === node), true);
    const summaryBox = await summary.boundingBox();
    assert.ok(summaryBox.width >= 32 && summaryBox.height >= 32);
    assert.ok(summaryBox.x >= -1 && summaryBox.x + summaryBox.width <= 391);

    for (const [width, height, name] of [[320, 700, "menu-320.png"], [390, 800, "menu-390.png"], [1440, 900, "menu-1440.png"]]) {
      await page.setViewportSize({ width, height });
      await openMenu(page);
      const box = await page.locator("[data-topbar-menu] .fl-menu__items").boundingBox();
      assert.ok(box.x >= -1, name);
      assert.ok(box.y >= -1, name);
      assert.ok(box.x + box.width <= width + 1, name);
      assert.ok(box.y + box.height <= height + 1, name);
      await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: false });
      await page.keyboard.press("Escape");
    }
    assert.equal(errors.length, 0, errors.join("\n"));
  } finally {
    await context.close();
  }
});

test("касание открывает и закрывает меню", { timeout: 60_000 }, async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${origin("")}/pages/docs/`);
    await page.locator("#start").waitFor();
    await page.locator("[data-topbar-menu] summary").tap();
    await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open === true);
    await page.touchscreen.tap(24, 640);
    await page.locator("#start").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-topbar-menu]")?.open !== true);
    assert.equal(await page.locator("[data-topbar-menu] a").getAttribute("aria-current"), "page");
    assert.equal(errors.length, 0, errors.join("\n"));
  } finally {
    await context.close();
  }
});

test("отмена сохраняет черновик, настройки, историю и прогон", { timeout: 120_000 }, async () => {
  const { context, page, errors } = await openPage("", "/");
  try {
    await page.waitForFunction(() => document.querySelector("#play") && !document.querySelector("#play").disabled);
    await page.locator("#play").click();
    await page.waitForFunction(() => Number(document.querySelector("#tick-value")?.textContent) >= 1);
    await page.locator("#play").click();
    await page.waitForFunction(() => document.querySelector("#play")?.getAttribute("aria-pressed") === "false");
    const tick = await page.locator("#tick-value").textContent();
    await page.locator("[data-work-view='events']").click();
    await page.locator("#event-settings").evaluate((node) => {
      node.open = true;
    });
    await page.locator("#event-every-tick").uncheck();
    await page.locator("#event-state-json").fill('{"kept":1}');
    await openMenu(page);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Очистить проект" }).click();
    assert.equal(await page.locator("#event-every-tick").isChecked(), false);
    assert.equal(await page.locator("#event-state-json").inputValue(), '{"kept":1}');
    assert.equal(await page.locator("#tick-value").textContent(), tick);
    await page.locator("[data-work-view='code']").click();
    await page.locator("#document").fill("alpha draft");
    await page.waitForFunction(() => document.querySelector("#undo") && !document.querySelector("#undo").disabled);
    await openMenu(page);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Очистить проект" }).click();
    assert.equal(await page.locator("#document").inputValue(), "alpha draft");
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelector("#document").value.includes("wooden_chest"));
    assert.equal(errors.length, 0, errors.join("\n"));
  } finally {
    await context.close();
  }
});

test("подтверждение очищает оба режима, останавливает прогон и не возвращает текст", { timeout: 180_000 }, async () => {
  for (const pathname of ["/", "/pages/configure/", "/factorio-ide/pages/configure/"]) {
    const { context, page, errors } = await openPage("", pathname.startsWith("/factorio-ide") ? "/factorio-ide/pages/configure/" : pathname);
    try {
      await page.waitForFunction(() => document.querySelector("#play") && !document.querySelector("#play").disabled);
      await page.evaluate(() => localStorage.setItem("f-logic.projects.v1", "{\"kept\":1}"));
      await page.locator("[data-work-view='events']").click();
      await page.locator("#event-check").click();
      await page.waitForFunction(() => document.querySelector("#event-run-status")?.dataset.status === "ready");
      await page.locator("#event-source").fill("export class Arrival extends EventCombinator {\n  main() { this.state.replaced = true; }\n}\n");
      await page.locator("#event-settings").evaluate((node) => {
        node.open = true;
      });
      await page.locator("#event-every-tick").uncheck();
      await page.locator("[data-work-view='code']").click();
      await page.locator("#document").fill("temporary draft");
      await page.waitForFunction(() => document.querySelector("#document").value === "temporary draft");
      await openMenu(page);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Очистить проект" }).click();
      await page.waitForFunction(() => document.querySelector("#document").value.includes("wooden_chest"));
      assert.equal(await page.locator("#document").inputValue(), CONFIGURATION_EXAMPLE);
      await page.locator("[data-work-view='events']").click();
      assert.match(await page.locator("#event-source").inputValue(), /arrived = false/);
      assert.equal(await page.locator("#event-every-tick").isChecked(), true);
      assert.equal(await page.locator("#event-state-json").inputValue(), "{}");
      assert.equal(await page.locator("#event-run-status").getAttribute("data-status"), "idle");
      assert.equal(await page.locator("#event-tick").textContent(), "—");
      assert.equal(await page.locator("#undo").isDisabled(), true);
      assert.equal(await page.evaluate(() => localStorage.getItem("f-logic.projects.v1")), "{\"kept\":1}");
      assert.equal(await page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), CONFIGURATION_EXAMPLE);
      await openMenu(page);
      await page.getByRole("link", { name: "Документация" }).click();
      await page.waitForSelector("h1");
      assert.equal(await page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), CONFIGURATION_EXAMPLE);
      await page.goBack();
      await page.waitForSelector("#document");
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#document")?.value.includes("wooden_chest"));
      assert.equal(await page.locator("#document").inputValue(), CONFIGURATION_EXAMPLE);
      assert.doesNotMatch(await page.locator("#document").inputValue(), /temporary draft/);
      assert.equal(errors.length, 0, errors.join("\n"));
    } finally {
      await context.close();
    }
  }
});

test("вторичная страница очищает черновик редактора и не свой стенд", { timeout: 120_000 }, async () => {
  const eventPage = await openPage("", "/pages/event/");
  try {
    await eventPage.page.locator("#script-source").fill("local-stand-marker");
    await eventPage.page.evaluate(() => sessionStorage.setItem("f-logic.editor-draft.v1", "custom-draft-text"));
    await openMenu(eventPage.page);
    eventPage.page.once("dialog", (dialog) => dialog.dismiss());
    await eventPage.page.getByRole("button", { name: "Очистить проект" }).click();
    assert.equal(await eventPage.page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), "custom-draft-text");
    assert.equal(await eventPage.page.locator("#script-source").inputValue(), "local-stand-marker");
    await openMenu(eventPage.page);
    eventPage.page.once("dialog", (dialog) => dialog.accept());
    await eventPage.page.getByRole("button", { name: "Очистить проект" }).click();
    assert.equal(eventPage.page.url().includes("/pages/event/"), true);
    assert.equal(await eventPage.page.locator("#script-source").inputValue(), "local-stand-marker");
    assert.equal(await eventPage.page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), CONFIGURATION_EXAMPLE);
    assert.equal(eventPage.errors.length, 0, eventPage.errors.join("\n"));
  } finally {
    await eventPage.context.close();
  }

  const project = await openPage("", "/pages/project/");
  try {
    await project.page.evaluate(() => {
      localStorage.setItem("f-logic.projects.v1", "{\"named\":1}");
      sessionStorage.setItem("f-logic.editor-draft.v1", "custom-draft-text");
    });
    await openMenu(project.page);
    project.page.once("dialog", (dialog) => dialog.accept());
    await project.page.getByRole("button", { name: "Очистить проект" }).click();
    assert.equal(project.page.url().includes("/pages/project/"), true);
    assert.equal(await project.page.evaluate(() => localStorage.getItem("f-logic.projects.v1")), "{\"named\":1}");
    assert.equal(await project.page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), CONFIGURATION_EXAMPLE);
    assert.equal(project.errors.length, 0, project.errors.join("\n"));
  } finally {
    await project.context.close();
  }

  const networks = await openPage("", "/pages/networks/");
  try {
    await networks.page.locator("#document").fill("network-local-text");
    await networks.page.evaluate(() => sessionStorage.setItem("f-logic.editor-draft.v1", "custom-draft-text"));
    await openMenu(networks.page);
    networks.page.once("dialog", (dialog) => dialog.accept());
    await networks.page.getByRole("button", { name: "Очистить проект" }).click();
    assert.equal(await networks.page.locator("#document").inputValue(), "network-local-text");
    assert.equal(await networks.page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), CONFIGURATION_EXAMPLE);
    assert.equal(networks.errors.length, 0, networks.errors.join("\n"));
  } finally {
    await networks.context.close();
  }

  const editor = await openPage("", "/");
  try {
    await editor.page.waitForSelector("#document");
    assert.equal(await editor.page.locator("#document").inputValue(), CONFIGURATION_EXAMPLE);
    await editor.page.reload();
    await editor.page.waitForFunction(() => document.querySelector("#document")?.value.includes("wooden_chest"));
    assert.doesNotMatch(await editor.page.locator("#document").inputValue(), /custom-draft-text/);
    assert.equal(editor.errors.length, 0, editor.errors.join("\n"));
  } finally {
    await editor.context.close();
  }
});

test("сбой записи хранилища не показывает успешную очистку", { timeout: 60_000 }, async () => {
  const { context, page, errors } = await openPage("", "/pages/configure/");
  try {
    await page.waitForSelector("#document");
    await page.locator("#document").fill("temporary draft");
    await page.waitForFunction(() => sessionStorage.getItem("f-logic.editor-draft.v1") === "temporary draft");
    await page.evaluate(() => {
      sessionStorage.setItem = () => {
        throw new DOMException("quota", "QuotaExceededError");
      };
    });
    const messages = [];
    page.on("dialog", async (dialog) => {
      messages.push(`${dialog.type()}:${dialog.message()}`);
      await dialog.accept();
    });
    await openMenu(page);
    await page.getByRole("button", { name: "Очистить проект" }).click();
    assert.equal(messages.length, 2);
    assert.match(messages[0], /^confirm:Очистить рабочий черновик/);
    assert.match(messages[1], /Не удалось записать черновик/);
    assert.equal(await page.locator("#document").inputValue(), "temporary draft");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("f-logic.editor-draft.v1")), "temporary draft");
    assert.equal(errors.length, 0, errors.join("\n"));
  } finally {
    await context.close();
  }
});
