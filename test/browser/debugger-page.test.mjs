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

async function openDebugger() {
  const page = await browser.newPage();
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/debugger/`);
  await page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "paused"
    && document.querySelector("#tick-value")?.textContent === "0");
  return { page, errors };
}

async function choose(page, scheme) {
  await chooseSelect(page, "scheme", scheme);
  await page.waitForFunction((id) => document.querySelector("#scheme")?.value === id
    && document.querySelector("#run-status")?.dataset.status === "paused"
    && document.querySelector("#toolbar")?.getAttribute("aria-busy") === "false", scheme);
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

test("автозапуск и ручные шаги совпадают, пауза и смена скорости не добавляют тик", { timeout: 60_000 }, async () => {
  const { page, errors } = await openDebugger();
  try {
    assert.equal(await page.getByRole("link", { name: "Документация" }).count(), 1);
    await choose(page, "counter");
    await chooseSelect(page, "speed", "10");
    await page.locator("#play").click();
    await page.waitForFunction(() => Number(document.querySelector("#tick-value")?.textContent) >= 4);
    await page.locator("#play").click();
    await page.waitForFunction(() => document.querySelector("#toolbar")?.dataset.playback === "paused"
      && document.querySelector("#toolbar")?.getAttribute("aria-busy") === "false");
    const tick = await page.locator("#tick-value").textContent();
    assert.equal(await page.locator("#tick-value").getAttribute("data-steps"), tick);
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), tick);

    await chooseSelect(page, "speed", "1");
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#tick-value").textContent(), tick);
    await page.locator("#step").click();
    await page.waitForFunction((current) => document.querySelector("#tick-value")?.textContent === String(Number(current) + 1), tick);
    const next = String(Number(tick) + 1);
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), next);

    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0"
      && document.querySelector("#network-body")?.textContent?.includes("Нет сигналов"));
    for (let index = 1; index <= Number(next); index += 1) {
      await page.locator("#step").click();
      await page.waitForFunction((expected) => document.querySelector("#tick-value")?.textContent === expected, String(index));
    }
    assert.equal(await page.locator("#tick-value").getAttribute("data-steps"), next);
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), next);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("reset возвращает границу 0 и повторяется", { timeout: 60_000 }, async () => {
  const { page, errors } = await openDebugger();
  try {
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "7");
    assert.equal(await page.locator("#network-body tr[data-signal='signal-B']").getAttribute("data-value"), "3");
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#network-body tr[data-signal='signal-A']")?.dataset.change === "gone");
    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0"
      && document.querySelector("#network-body tr[data-signal='signal-A']")?.dataset.value === "7");
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#network-body tr[data-signal='signal-A']")?.dataset.change === "gone");
    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0"
      && document.querySelector("#network-body tr[data-signal='signal-A']")?.dataset.change === "baseline");
    assert.equal(await page.locator("#network-body tr[data-signal='signal-B']").getAttribute("data-value"), "3");
    assert.equal(await page.locator("#tick-value").getAttribute("data-steps"), "0");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("ошибка расчёта и неверная конфигурация не продолжают выполнение", { timeout: 60_000 }, async () => {
  const { page, errors } = await openDebugger();
  try {
    await choose(page, "fault");
    assert.match(await page.locator("#network-body").textContent(), /signal-A/);
    await page.locator("#step").click();
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("unsupported-case"));
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.equal(await page.locator("#play").isDisabled(), true);
    assert.equal(await page.locator("#step").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__debuggerPage.play()), false);
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.match(await page.locator("#network-body").textContent(), /signal-A/);

    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "paused"
      && !(document.querySelector("#diagnostic")?.textContent ?? "").includes("unsupported-case"));
    await page.locator("#play").click();
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("Неподдержанный режим"));
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.equal(await page.locator("#tick-value").getAttribute("data-steps"), "0");
    await page.waitForTimeout(350);
    assert.equal(await page.locator("#tick-value").textContent(), "0");

    await chooseSelect(page, "scheme", "invalid");
    await page.waitForFunction(() => document.querySelector("#scheme")?.value === "invalid"
      && document.querySelector("#run-status")?.dataset.status === "failed"
      && (document.querySelector("#diagnostic")?.textContent ?? "").includes("invalid-operand"));
    assert.equal(await page.locator("#tick-value").textContent(), "—");
    assert.equal(await page.locator("#device-count").textContent(), "0");
    assert.equal(await page.locator("#play").isDisabled(), true);
    assert.equal(await page.locator("#step").isDisabled(), true);
    assert.match(await page.locator("#diagnostic").textContent(), /Неверная конфигурация/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("агрегат и собственный выход различаются, исчезновение видно в таблице", { timeout: 60_000 }, async () => {
  const { page, errors } = await openDebugger();
  try {
    assert.equal(await page.locator("#device-count").textContent(), "3");
    assert.match(await page.locator("#device-card").textContent(), /red_bus/);
    assert.equal(await page.locator("#own-body tr[data-signal='red:signal-A']").getAttribute("data-value"), "5");
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "7");
    await page.locator("#device-list button").nth(1).click();
    assert.equal(await page.locator("#device-list button").nth(1).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#own-body tr[data-signal='red:signal-A']").getAttribute("data-value"), "2");
    assert.equal(await page.locator("#own-body tr[data-signal='red:signal-B']").getAttribute("data-value"), "3");
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "7");
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#network-body tr[data-signal='signal-A']")?.dataset.change === "gone");
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A'] td").nth(2).textContent(), "исчез");
    assert.equal(await page.locator("#network-body tr[data-signal='signal-B']").getAttribute("data-value"), "3");
    assert.equal(await page.locator("#own-body tr[data-signal='red:signal-A']").getAttribute("data-value"), "2");
    await page.locator("#play").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "step");
    assert.equal(await page.locator("#step").evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
    const speedName = await page.locator("#speed .fl-selectbox__control").evaluate((element) => element.getAttribute("aria-labelledby").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
    const schemeLabel = await page.locator("#scheme-label").textContent();
    assert.match(speedName, /Скорость/);
    assert.match(schemeLabel, /Схема/);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const fit = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        table: getComputedStyle(document.querySelector(".fl-table-wrap")).overflow,
      }));
      assert.equal(fit.overflow, false, `overflow at ${width}`);
      assert.equal(fit.table, "auto", `table overflow at ${width}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("шаг назад восстанавливает границу, новая ветка не возвращает отброшенный тик", { timeout: 60_000 }, async () => {
  const { page, errors } = await openDebugger();
  try {
    await choose(page, "counter");
    assert.equal(await page.locator("#back").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__debuggerPage.back()), false);
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("history-exhausted"));
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.match(await page.locator("#network-body").textContent(), /Нет сигналов/);

    for (let index = 1; index <= 3; index += 1) {
      await page.locator("#step").click();
      await page.waitForFunction((expected) => document.querySelector("#tick-value")?.textContent === expected, String(index));
    }
    assert.equal(await page.locator("#timeline button").count(), 4);
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "3");
    await page.locator("#timeline button[aria-pressed='true']").focus();
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "2"
      && (document.querySelector("#timeline-status")?.textContent ?? "").includes("Граница t2"));
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "2");
    assert.equal(await page.locator("#timeline").getByRole("button", { name: "t03", exact: true }).count(), 0);
    await page.locator("#back").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "1");
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "1");
    assert.equal(await page.locator("#tick-value").getAttribute("data-steps"), "1");
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "2");
    assert.equal(await page.locator("#timeline").getByRole("button", { name: "t03", exact: true }).count(), 0);
    assert.equal(await page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "2");

    await page.locator("#timeline button").first().focus();
    await page.keyboard.press("End");
    await page.waitForFunction(() => document.querySelector("#toolbar")?.getAttribute("aria-busy") === "false"
      && document.querySelector("#timeline button[aria-pressed='true']")?.textContent === "t02");
    await page.locator("#timeline button[aria-pressed='true']").focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0"
      && document.querySelector("#toolbar")?.getAttribute("aria-busy") === "false"
      && (document.querySelector("#network-body")?.textContent ?? "").includes("Нет сигналов"));

    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0"
      && document.querySelector("#timeline button")?.textContent === "t00"
      && document.querySelectorAll("#timeline button").length === 1);
    assert.equal(await page.locator("#back").isDisabled(), true);

    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const fit = await page.evaluate(() => {
        const scale = document.querySelector("#timeline");
        const table = document.querySelector(".fl-table-wrap");
        const box = scale.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          timeline: getComputedStyle(scale).overflowX,
          table: getComputedStyle(table).overflow,
          inside: box.right <= document.documentElement.clientWidth + 1 && box.left >= -1,
        };
      });
      assert.equal(fit.overflow, false, `overflow at ${width}`);
      assert.equal(fit.timeline, "auto", `timeline overflow at ${width}`);
      assert.equal(fit.table, "auto", `table overflow at ${width}`);
      assert.equal(fit.inside, true, `timeline escapes at ${width}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
