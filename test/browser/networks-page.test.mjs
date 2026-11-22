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

async function openNetworks() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/networks/`);
  await page.waitForFunction(() => document.querySelector("#revision")?.textContent === "1"
    && document.querySelector("#run-status")?.dataset.status === "editing");
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

test("создание, прогон, переименование, удаление и ошибка поля", { timeout: 60_000 }, async () => {
  const { page, errors } = await openNetworks();
  try {
    await chooseSelect(page, "port", "source.red_output");
    await page.locator("#network-query").fill("r");
    await page.locator("#network-results [data-choice='new']").click();
    await chooseSelect(page, "port", "reader.red_input");
    await page.locator("#network-query").fill("red_1");
    await page.locator("#network-results [data-choice='network'][data-name='red_1']").click();
    const outputId = await page.locator("[data-port='source.red_output']").getAttribute("data-network-id");
    const inputId = await page.locator("[data-port='reader.red_input']").getAttribute("data-network-id");
    assert.equal(outputId, inputId);
    assert.match(outputId, /^n/);
    assert.match(await page.locator("#document").inputValue(), /red_output: red_1/);
    assert.equal((await page.locator("#document").inputValue()).includes("red_new"), false);

    await page.locator("#launch").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.dataset.current === "true"
      && document.querySelector("#live-signals [data-value='5']"));
    await page.locator("#play").click();
    await page.waitForFunction(() => Number(document.querySelector("#tick-value")?.textContent) >= 1);
    const text = await page.locator("#document").inputValue();
    await page.locator("#document").fill(text.replace("signal signal_A 5", "signal signal_A 9"));
    await page.waitForFunction(() => document.querySelector("#tick-value")?.dataset.current === "false"
      && document.querySelector("#toolbar")?.dataset.playback === "paused"
      && document.querySelector("#live-signals")?.textContent?.includes("Нет текущего прогона"));
    assert.equal(await page.locator("#live-signals [data-value='5']").count(), 0);

    await chooseSelect(page, "network", "red_1");
    await page.locator("#rename").click();
    await page.locator("#rename-name").fill("red_main");
    await page.locator("#rename-confirm").click();
    await page.waitForFunction(() => document.querySelector("[data-port='source.red_output']")?.textContent?.includes("red_main"));
    assert.equal(await page.locator("[data-port='source.red_output']").getAttribute("data-network-id"), outputId);
    assert.equal(await page.locator("[data-port='reader.red_input']").getAttribute("data-network-id"), outputId);
    const renamed = await page.locator("#document").inputValue();
    assert.match(renamed, /"green_1"/);
    assert.match(renamed, /Имя в комментарии/);

    await page.locator("#remove").click();
    assert.equal(await page.locator("#remove-dialog").isVisible(), true);
    await page.locator("#remove-cancel").click();
    assert.equal(await page.locator("#document").inputValue(), renamed);
    await page.locator("#remove").click();
    await page.locator("#remove-confirm").click();
    await page.waitForFunction(() => document.querySelector("#network-list")?.textContent?.includes("Сетей нет"));
    assert.match(await page.locator("#document").inputValue(), /red_output: null/);

    await page.locator("#document").fill("wire reader {\n  red_input: green_9\n  green_input: \"red_1\"\n}\n");
    await page.waitForFunction(() => document.querySelector("[data-code='invalid-port']")
      && document.querySelector("[data-code='wrong-color']"));
    await chooseSelect(page, "port", "reader.green_input");
    assert.equal(await page.locator("#network-query").getAttribute("aria-invalid"), "true");
    assert.match(await page.locator("#network-error").textContent(), /строка/);
    assert.equal(await page.locator("#launch").isDisabled(), true);
    assert.match(await page.locator("#network-list").textContent(), /Сетей нет/);
    await page.locator("#network-query").focus();
    const outline = await page.locator("#network-query").evaluate((element) => getComputedStyle(element).outlineWidth);
    assert.notEqual(outline, "0px");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("клавиатура подсказки и прокрутка на ширинах 320–1440", { timeout: 60_000 }, async () => {
  const { page, errors } = await openNetworks();
  try {
    const long = `// ${"green_buffer_".repeat(180)}\nwire reader {\n  red_input: null\n}\n`;
    await page.locator("#document").fill(long);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => {
        const root = document.documentElement;
        const area = document.querySelector("#document");
        const table = document.querySelector("#signal-scroll");
        return {
          overflow: root.scrollWidth - root.clientWidth,
          editorScroll: area.scrollWidth > area.clientWidth,
          tableOverflow: getComputedStyle(table).overflow,
        };
      });
      assert.ok(metrics.overflow <= 1, `ширина ${width}: документ ${metrics.overflow}px`);
      assert.equal(metrics.editorScroll, true, `ширина ${width}`);
      assert.match(metrics.tableOverflow, /auto/);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await chooseSelect(page, "port", "reader.red_input");
    await page.locator("#network-query").focus();
    await page.keyboard.press("ArrowDown");
    const option = page.locator("#network-results button").first();
    assert.equal(await option.evaluate((element) => element === document.activeElement), true);
    const focused = await option.evaluate((element) => getComputedStyle(element).outlineStyle);
    assert.notEqual(focused, "none");
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#document").inputValue(), /red_input: red_1/);
    assert.equal((await page.locator("#document").inputValue()).includes("red_new"), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("поле сети завершает введённое имя по Esc и Tab", { timeout: 60_000 }, async () => {
  const { page, errors } = await openNetworks();
  try {
    await chooseSelect(page, "port", "reader.green_input");
    await page.locator("#network-query").fill("green_limi");
    assert.equal((await page.locator("#network-results").textContent()).includes("Создать"), false);
    assert.equal(await page.locator("#network-results [data-choice='new']").count(), 0);
    await page.locator("#network-query").press("Escape");
    assert.match(await page.locator("#document").inputValue(), /green_input: green_limi/);
    assert.equal((await page.locator("#document").inputValue()).includes("green_new"), false);
    await page.locator("#network-query").fill("green_limi");
    await page.locator("#network-query").press("Tab");
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), "network-query");
    const text = await page.locator("#document").inputValue();
    assert.equal(text.split("green_limi").length - 1, 1);

    await chooseSelect(page, "port", "reader.red_input");
    await page.locator("#network-query").fill("red_new");
    await page.locator("#network-query").press("Escape");
    const named = await page.locator("#document").inputValue();
    assert.equal(named.includes("red_new"), false);
    assert.match(named, /red_input: red_\d+/);
    await page.locator("#undo").click();
    assert.match(await page.locator("#document").inputValue(), /red_input: null/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
