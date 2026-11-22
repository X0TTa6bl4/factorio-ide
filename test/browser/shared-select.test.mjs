/** Общий data-select на рабочих страницах: значение, поиск, клавиатура, disabled и ошибка. */

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

async function open(pathname, width = 1280, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}/factorio-ide${pathname}`);
  return { page, errors };
}

async function speedContract(page) {
  return page.evaluate(() => {
    const box = document.querySelector("#speed");
    const options = [...box.querySelectorAll("[role='option']")].map((item) => ({
      value: item.dataset.value,
      label: item.textContent,
    }));
    const title = box.querySelector(".fl-selectbox__title");
    return {
      value: box.value,
      label: document.querySelector("#speed-label")?.textContent ?? "",
      name: (box.querySelector(".fl-selectbox__control")?.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim(),
      shown: box.querySelector(".fl-selectbox__value")?.textContent ?? "",
      options,
      title: title?.textContent?.trim() ?? "",
      search: box.querySelector("[data-select-filter]") !== null,
      native: document.querySelectorAll("select").length,
    };
  });
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

test("оба редактора показывают число скорости и заголовок меню", { timeout: 60_000 }, async () => {
  const seen = [];
  for (const pathname of ["/", "/pages/configure/"]) {
    const { page, errors } = await open(pathname);
    try {
      await page.waitForSelector("#speed .fl-selectbox__control");
      const beforeText = await page.locator("#document").inputValue();
      const before = await speedContract(page);
      assert.equal(before.native, 0, pathname);
      assert.equal(before.label, "Скорость", pathname);
      assert.equal(before.name, "Скорость 1", pathname);
      const speedLabel = await page.locator("#speed-label").boundingBox();
      assert.ok(speedLabel && speedLabel.width <= 1 && speedLabel.height <= 1, pathname);
      assert.equal(before.title, "Скорость", pathname);
      assert.equal(before.search, false, pathname);
      assert.equal(before.value, "1");
      assert.equal(before.shown, "1");
      assert.deepEqual(before.options, [
        { value: "1", label: "1 тик/с" },
        { value: "2", label: "2 тик/с" },
        { value: "4", label: "4 тик/с" },
        { value: "10", label: "10 тик/с" },
      ]);
      const button = page.locator("#speed .fl-selectbox__control");
      await button.focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(() => document.querySelector("#speed .fl-selectbox__control")?.getAttribute("aria-expanded") === "true");
      const menuTitle = await page.locator("#speed .fl-selectbox__title").boundingBox();
      const menu = await page.locator("#speed .fl-selectbox__popover").boundingBox();
      assert.ok(menuTitle && menuTitle.height > 8);
      assert.ok(menu && menu.width <= 145);
      await page.keyboard.press("Escape");
      assert.equal(await button.getAttribute("aria-expanded"), "false");
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector("#speed .fl-selectbox__control")), true);
      assert.equal(await button.evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");
      assert.equal(await button.getAttribute("aria-expanded"), "false");
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector("#speed .fl-selectbox__control")), false);
      await chooseSelect(page, "speed", "10");
      assert.equal(await page.locator("#speed").evaluate((element) => element.value), "10");
      assert.equal(await page.locator("#speed .fl-selectbox__value").textContent(), "10");
      assert.equal(await page.locator("#document").inputValue(), beforeText);
      assert.equal(await page.locator("[data-suggest='caret']").count(), 1);
      assert.equal(await page.locator("[data-suggest='caret']").evaluate((element) => element.closest("[data-select]") === null), true);
      seen.push(before.options);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  assert.deepEqual(seen[0], seen[1]);
});

test("схема отладчика ищется, сеть остаётся тем же списком, меню помещается в телефон", { timeout: 60_000 }, async () => {
  const { page, errors } = await open("/pages/debugger/", 320, 700);
  try {
    await page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "paused"
      && document.querySelector("#scheme .fl-selectbox__control")?.disabled === false);
    assert.equal(await page.locator("#scheme .fl-selectbox__title").count(), 0);
    assert.equal(await page.locator("#network .fl-selectbox__title").count(), 0);
    assert.equal(await page.locator("#speed [data-select-filter]").count(), 0);
    const scheme = page.locator("#scheme .fl-selectbox__control");
    await scheme.click();
    const filter = page.locator("#scheme [data-select-filter]");
    await filter.waitFor();
    const box = await page.locator("#scheme .fl-selectbox__popover").boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 321);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.equal(wide, true);
    await filter.fill("zzz");
    await page.waitForFunction(() => document.querySelector("#scheme .fl-selectbox__empty")?.hidden === false);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#scheme").evaluate((element) => element.value), "sources");
    await filter.fill("счётч");
    await page.waitForFunction(() => {
      const visible = [...document.querySelectorAll("#scheme [role='option']")].filter((item) => !item.hidden);
      return visible.length === 1 && visible[0].dataset.value === "counter";
    });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#scheme")?.value === "counter"
      && document.querySelector("#toolbar")?.getAttribute("aria-busy") === "false");
    assert.equal(await page.locator("#network [data-select-filter]").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("отключённая скорость контура не открывается, сценарий меняется", { timeout: 60_000 }, async () => {
  const { page, errors } = await open("/pages/circuit/");
  try {
    await page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "ready");
    const speed = page.locator("#speed .fl-selectbox__control");
    assert.equal(await speed.isDisabled(), true);
    assert.equal(await speed.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#speed .fl-selectbox__title").textContent(), "Скорость");
    assert.equal(await page.locator("#speed").evaluate((element) => element.value), "1");
    assert.equal(await page.locator("#speed .fl-selectbox__value").textContent(), "1");
    await chooseSelect(page, "preset", "spin");
    await page.waitForFunction(() => document.querySelector("#preset")?.value === "spin"
      && document.querySelector("#preset-active")?.textContent === "spin");
    assert.equal(await page.locator("#speed").evaluate((element) => element.value), "1");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("ошибка порта видна на выборе, поиск имени сети остаётся отдельным", { timeout: 60_000 }, async () => {
  const { page, errors } = await open("/pages/networks/");
  try {
    await page.waitForFunction(() => document.querySelector("#revision")?.textContent === "1");
    assert.equal(await page.locator("#port .fl-selectbox__control").getAttribute("aria-invalid"), null);
    assert.equal(await page.locator("#port [data-select-filter]").count(), 0);
    assert.equal(await page.locator("#network-results").evaluate((element) => element.closest("[data-select]") === null), true);
    await page.locator("#document").fill("wire reader {\n  red_input: green_9\n  green_input: \"red_1\"\n}\n");
    await page.waitForFunction(() => document.querySelector("[data-code='invalid-port']"));
    await chooseSelect(page, "port", "reader.green_input");
    const button = page.locator("#port .fl-selectbox__control");
    assert.equal(await button.getAttribute("aria-invalid"), "true");
    assert.equal(await button.getAttribute("aria-describedby"), "network-error");
    assert.match(await page.locator("#network-error").textContent(), /строка/);
    assert.equal(await page.locator("#network-error").isVisible(), true);
    assert.equal(await page.locator("#network [data-select-filter]").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("выбор события схемы меняет текст и не рисует пустой заголовок", { timeout: 60_000 }, async () => {
  const { page, errors } = await open("/pages/project/");
  try {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#event-device")?.value === "d7");
    const before = await page.locator("#event-source").inputValue();
    assert.match(before, /\+/);
    assert.equal(await page.locator("#event-device .fl-selectbox__title").count(), 0);
    await chooseSelect(page, "event-device", "d8");
    await page.waitForFunction(() => document.querySelector("#event-device")?.value === "d8");
    assert.notEqual(await page.locator("#event-source").inputValue(), before);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("касание открывает скорость на узком экране", { timeout: 60_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true });
  const errors = track(page);
  try {
    await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/debugger/`);
    await page.waitForFunction(() => document.querySelector("#speed .fl-selectbox__control")?.disabled === false);
    await page.locator("#speed .fl-selectbox__control").tap();
    await page.waitForFunction(() => document.querySelector("#speed .fl-selectbox__control")?.getAttribute("aria-expanded") === "true");
    const inside = await page.locator("#speed .fl-selectbox__popover").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight + 1 && rect.right <= window.innerWidth + 1;
    });
    assert.equal(inside, true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#speed .fl-selectbox__control").getAttribute("aria-expanded"), "false");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
