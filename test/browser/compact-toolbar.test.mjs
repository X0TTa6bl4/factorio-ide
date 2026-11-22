/** Компактный пульт: иконки, фиксированный play/pause, число скорости и тик. */

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

async function open(pathname, width = 1280, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}/factorio-ide${pathname}`);
  return { page, errors };
}

async function controlBox(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      label: element.getAttribute("aria-label"),
      pressed: element.getAttribute("aria-pressed"),
      disabled: element.disabled,
      path: element.querySelector("path")?.getAttribute("d") ?? "",
    };
  });
}

async function clipped(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return Boolean(box && box.width <= 1 && box.height <= 1);
}

async function narrowFit(page, selectors) {
  await page.setViewportSize({ width: 320, height: 700 });
  return page.evaluate((items) => {
    const tools = document.querySelector(".fl-screen__tools");
    return {
      pageWide: document.documentElement.scrollWidth > window.innerWidth + 1,
      toolsWide: tools.scrollWidth > tools.clientWidth + 1,
      buttons: items.map((selector) => {
        const element = document.querySelector(selector);
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.left >= -1 && rect.right <= window.innerWidth + 1;
      }),
    };
  }, selectors);
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

test("редактор держит размер play/pause и не показывает подписи пульта", { timeout: 90_000 }, async () => {
  for (const pathname of ["/", "/pages/configure/"]) {
    const { page, errors } = await open(pathname);
    try {
      await page.waitForFunction(() => document.querySelector("#play") && !document.querySelector("#play").disabled);
      assert.equal((await page.locator("h1").textContent()).trim(), "Редактор");
      assert.equal(await page.locator("h1").evaluate((element) => element.classList.contains("fl-sr")), true);
      assert.equal(await page.locator(".fl-screen-name").count(), 0);
      assert.equal(await page.locator("#toolbar #new-draft").count(), 0);
      assert.equal(await page.locator("#new-draft").count(), 1);
      const back = await controlBox(page, "#back");
      assert.equal(back.disabled, true);
      assert.equal(back.label, "Шаг назад");
      assert.equal(back.width, 40);
      assert.equal((await controlBox(page, "#step")).label, "Шаг");
      assert.equal((await controlBox(page, "#reset")).label, "Сброс");
      assert.equal(await clipped(page, "#tick-name"), true);
      assert.equal(await clipped(page, "#speed-label"), true);
      assert.equal(await page.locator("#tick-value").getAttribute("aria-labelledby"), "tick-name tick-value");
      const before = await controlBox(page, "#play");
      assert.equal(before.width, 40);
      assert.equal(before.height, 40);
      assert.equal(before.label, "Запустить");
      assert.equal(before.pressed, "false");
      await page.locator("#play").focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "step");
      await page.locator("#play").click();
      await page.waitForFunction(() => document.querySelector("#play")?.getAttribute("aria-pressed") === "true");
      const running = await controlBox(page, "#play");
      assert.equal(running.width, 40);
      assert.equal(running.height, 40);
      assert.equal(running.label, "Приостановить");
      assert.notEqual(running.path, before.path);
      assert.equal(await page.locator("#playback-status").textContent(), "Запущено");
      await page.waitForFunction(() => Number(document.querySelector("#tick-value")?.textContent) >= 1);
      await page.locator("#play").click();
      await page.waitForFunction(() => document.querySelector("#play")?.getAttribute("aria-label") === "Запустить"
        && document.querySelector("#toolbar")?.getAttribute("aria-busy") === "false");
      const paused = await controlBox(page, "#play");
      assert.equal(paused.width, before.width);
      assert.equal(paused.height, before.height);
      assert.equal(paused.path, before.path);
      assert.equal(await page.locator("#back").isDisabled(), false);
      const fit = await narrowFit(page, ["#play", "#step", "#back", "#reset", "#speed"]);
      assert.equal(fit.pageWide, false, pathname);
      assert.equal(fit.toolsWide, false, pathname);
      assert.deepEqual(fit.buttons, [true, true, true, true, true]);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});

test("отладчик, контур и сети оставляют только поддержанные действия", { timeout: 90_000 }, async () => {
  const debuggerPage = await open("/pages/debugger/");
  try {
    await debuggerPage.page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0");
    assert.equal(await debuggerPage.page.locator("h1.fl-screen-name").textContent(), "Отладчик");
    assert.ok((await debuggerPage.page.locator("h1").boundingBox()).height > 8);
    const play = await controlBox(debuggerPage.page, "#play");
    assert.equal(play.width, 40);
    assert.equal(play.height, 40);
    assert.equal(play.label, "Запустить");
    assert.equal((await controlBox(debuggerPage.page, "#back")).disabled, true);
    assert.equal(await debuggerPage.page.locator("#speed .fl-selectbox__value").textContent(), "1");
    assert.equal(await debuggerPage.page.locator("#run-status-text").isVisible(), true);
    await debuggerPage.page.locator("#play").click();
    await debuggerPage.page.waitForFunction(() => document.querySelector("#play")?.getAttribute("aria-pressed") === "true");
    const running = await controlBox(debuggerPage.page, "#play");
    assert.equal(running.width, 40);
    assert.equal(running.height, 40);
    assert.equal(running.label, "Приостановить");
    await debuggerPage.page.locator("#play").click();
    await debuggerPage.page.waitForFunction(() => document.querySelector("#toolbar")?.dataset.playback === "paused");
    const fit = await narrowFit(debuggerPage.page, ["#play", "#step", "#back", "#reset", "#speed"]);
    assert.equal(fit.pageWide, false);
    assert.equal(fit.toolsWide, false);
    assert.deepEqual(fit.buttons, [true, true, true, true, true]);
    assert.deepEqual(debuggerPage.errors, []);
  } finally {
    await debuggerPage.page.close();
  }

  const circuit = await open("/pages/circuit/");
  try {
    await circuit.page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "ready");
    assert.equal(await circuit.page.locator("h1").textContent(), "Контур");
    assert.equal(await circuit.page.locator("#back").count(), 0);
    const run = await controlBox(circuit.page, "#run");
    assert.equal(run.disabled, true);
    assert.equal(run.label, "Запустить");
    assert.equal(run.width, 40);
    assert.equal((await controlBox(circuit.page, "#step")).label, "Шаг");
    assert.equal((await controlBox(circuit.page, "#reset")).label, "Сброс");
    assert.equal(await circuit.page.locator("#speed .fl-selectbox__control").isDisabled(), true);
    assert.equal(await circuit.page.locator("#speed .fl-selectbox__value").textContent(), "1");
    assert.equal(await circuit.page.locator("#run-status-text").textContent(), "Готово");
    const fit = await narrowFit(circuit.page, ["#run", "#step", "#reset", "#speed"]);
    assert.equal(fit.pageWide, false);
    assert.equal(fit.toolsWide, false);
    assert.deepEqual(fit.buttons, [true, true, true, true]);
    assert.deepEqual(circuit.errors, []);
  } finally {
    await circuit.page.close();
  }

  const networks = await open("/pages/networks/");
  try {
    await networks.page.waitForFunction(() => document.querySelector("#revision")?.textContent === "1");
    assert.equal(await networks.page.locator("h1").textContent(), "Сети");
    assert.equal(await networks.page.locator("#back").count(), 0);
    assert.equal(await networks.page.locator("#speed").count(), 0);
    const play = await controlBox(networks.page, "#play");
    assert.equal(play.label, "Просмотр");
    assert.equal(play.width, 40);
    assert.equal(await networks.page.locator("#launch").textContent(), "Запустить");
    assert.equal(await clipped(networks.page, "#tick-name"), true);
    const fit = await narrowFit(networks.page, ["#play", "#step", "#reset"]);
    assert.equal(fit.pageWide, false);
    assert.equal(fit.toolsWide, false);
    assert.deepEqual(fit.buttons, [true, true, true]);
    assert.deepEqual(networks.errors, []);
  } finally {
    await networks.page.close();
  }
});
