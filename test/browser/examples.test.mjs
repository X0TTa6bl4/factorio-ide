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

async function openIndex(pathname) {
  const page = await browser.newPage();
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}${pathname}`);
  await page.waitForFunction(() => document.querySelector("#demo-status")?.dataset.state === "ready");
  return { page, errors };
}

async function openDebugger(scheme) {
  const page = await browser.newPage();
  const errors = track(page);
  const query = scheme ? `?scheme=${scheme}` : "";
  await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/debugger/${query}`);
  await page.waitForFunction(() => {
    const status = document.querySelector("#run-status")?.dataset.status;
    return status === "paused" || status === "failed";
  });
  return { page, errors };
}

async function stepTo(page, tick) {
  await page.locator("#step").click();
  await page.waitForFunction((expected) => document.querySelector("#tick-value")?.textContent === expected
    && document.querySelector("#toolbar")?.getAttribute("aria-busy") === "false", String(tick));
}

async function noDocumentOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
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

test("примеры открываются со своей страницы и под /factorio-ide/", { timeout: 60_000 }, async () => {
  for (const pathname of ["/pages/examples/", "/factorio-ide/pages/examples/"]) {
    const { page, errors } = await openIndex(pathname);
    try {
      assert.equal(await page.getByRole("button", { name: "Совместимость" }).count(), 0);
      assert.equal(await page.locator(".fl-more").count(), 0);
      assert.equal(await page.getByRole("link", { name: "Документация" }).count(), 1);
      assert.equal(await page.locator("#demo-rows tr").count(), 8);
      const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
      assert.equal(resources.some((name) => name.includes("/pages/examples/page.js")), true);
      assert.equal(resources.some((name) => name.includes("/ui/styles/tokens.css")), true);
      assert.equal(resources.some((name) => name.includes("/src/index.js")), true);
      await page.locator("a[href$='scheme=decider']").click();
      await page.waitForFunction(() => document.querySelector("#scheme")?.value === "decider"
        && document.querySelector("#tick-value")?.textContent === "0");
      assert.match(page.url(), /\/pages\/debugger\/index\.html\?scheme=decider$/);
      if (pathname.includes("factorio-ide")) assert.match(page.url(), /\/factorio-ide\/pages\/debugger\//);
      assert.equal(await page.locator("#network").evaluate((element) => element.value), "green_gate");
      assert.match(await page.locator("#network-body").textContent(), /Нет сигналов/);
      await stepTo(page, 1);
      assert.equal(await page.locator("#network-body tr[data-signal='signal-B']").getAttribute("data-value"), "1");
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});

test("видимые тики схем совпадают с подписями", { timeout: 60_000 }, async () => {
  const sources = await openDebugger();
  try {
    assert.match(await sources.page.locator("#scheme-expect").textContent(), /signal-A = 7/);
    assert.equal(await sources.page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "7");
    assert.equal(await sources.page.locator("#network-body tr[data-signal='signal-B']").getAttribute("data-value"), "3");
    await stepTo(sources.page, 1);
    assert.equal(await sources.page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-change"), "gone");
    assert.equal(await sources.page.locator("#network-body tr[data-signal='signal-B']").getAttribute("data-value"), "3");
    assert.deepEqual(sources.errors, []);
  } finally {
    await sources.page.close();
  }

  const counter = await openDebugger("counter");
  try {
    await stepTo(counter.page, 1);
    await stepTo(counter.page, 2);
    await stepTo(counter.page, 3);
    assert.equal(await counter.page.locator("#network-body tr[data-signal='signal-A']").getAttribute("data-value"), "3");
    assert.deepEqual(counter.errors, []);
  } finally {
    await counter.page.close();
  }

  const selector = await openDebugger("selector");
  try {
    assert.equal(await selector.page.locator("#network").evaluate((element) => element.value), "red_count");
    assert.match(await selector.page.locator("#network-body").textContent(), /Нет сигналов/);
    await stepTo(selector.page, 1);
    assert.equal(await selector.page.locator("#network-body tr[data-signal='signal-C']").getAttribute("data-value"), "2");
    assert.deepEqual(selector.errors, []);
  } finally {
    await selector.page.close();
  }
});

test("ошибка ресурса и неподдержанный режим не выглядят совместимостью", { timeout: 60_000 }, async () => {
  const missing = await openIndex("/factorio-ide/pages/examples/");
  try {
    await missing.page.locator("#probe-missing").click();
    await missing.page.waitForFunction(() => (document.querySelector("#missing-diagnostic")?.textContent ?? "").includes("404"));
    const text = await missing.page.locator("#missing-diagnostic").textContent();
    assert.match(text, /Ресурс не найден: 404/);
    assert.match(text, /не совместимость с Factorio/);
    assert.equal(missing.errors.some((item) => item.startsWith("404 ") && item.includes("/pages/examples/absent.js")), true);
    assert.deepEqual(missing.errors.filter((item) => !item.includes("/pages/examples/absent.js")), []);
  } finally {
    await missing.page.close();
  }

  const unsupported = await openDebugger("unsupported");
  try {
    assert.match(await unsupported.page.locator("#diagnostic").textContent(), /unsupported-case/);
    assert.match(await unsupported.page.locator("#scheme-expect").textContent(), /не заявление совместимости/);
    assert.equal(await unsupported.page.locator("#tick-value").textContent(), "—");
    assert.equal(await unsupported.page.locator("#play").isDisabled(), true);
    assert.equal(await unsupported.page.getByRole("button", { name: "Совместимость" }).count(), 0);
    assert.deepEqual(unsupported.errors, []);
  } finally {
    await unsupported.page.close();
  }

  const unknown = await openDebugger("absent");
  try {
    assert.match(await unknown.page.locator("#diagnostic").textContent(), /unknown-scheme/);
    assert.equal(await unknown.page.locator("#tick-value").textContent(), "—");
    assert.deepEqual(unknown.errors, []);
  } finally {
    await unknown.page.close();
  }
});

test("сценарий Arrival публикует signal-A на границе 1", { timeout: 60_000 }, async () => {
  const page = await browser.newPage();
  const errors = track(page);
  try {
    await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/event/`);
    await page.waitForFunction(() => (document.querySelector("#demo-expect")?.textContent ?? "").includes("signal-A = 1"));
    assert.equal(await page.getByRole("link", { name: "Документация" }).count(), 1);
    await page.locator("#check").click();
    await page.waitForFunction(() => document.querySelector("#run-status")?.dataset.status === "ready");
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.match(await page.locator("#red-body").textContent(), /Нет сигналов/);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "1");
    assert.match(await page.locator("#red-body").textContent(), /signal-A/);
    assert.match(await page.locator("#device-state").textContent(), /"arrived": true/);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "2");
    assert.match(await page.locator("#red-body").textContent(), /signal-A1/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("клавиатура, фокус и ширины не растягивают документ", { timeout: 60_000 }, async () => {
  const { page, errors } = await openIndex("/factorio-ide/pages/examples/");
  try {
    assert.match(await page.locator("#probe-missing").textContent(), /Проверить отсутствующий модуль/);
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return {
        className: element.className,
        outline: style.outlineStyle,
        width: style.outlineWidth,
      };
    });
    assert.match(focus.className, /fl-skip/);
    assert.notEqual(focus.outline, "none");
    assert.notEqual(focus.width, "0px");

    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await noDocumentOverflow(page), true, `index ${width}`);
      const code = await page.locator("#sample-code").evaluate((element) => ({
        scrolls: element.scrollWidth > element.clientWidth + 1,
        clipped: element.scrollWidth > document.documentElement.clientWidth + 1
          && element.clientWidth <= document.documentElement.clientWidth,
      }));
      assert.equal(code.scrolls, true, `code ${width}`);
      assert.equal(code.clipped, true, `code panel ${width}`);
    }

    await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/debugger/`);
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0");
    const schemeLabel = await page.locator("#scheme-label").textContent();
    assert.match(schemeLabel, /Схема/);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await noDocumentOverflow(page), true, `debugger ${width}`);
      const table = await page.locator("#network-body").evaluate((element) => {
        const wrap = element.closest(".fl-table-wrap");
        return wrap.scrollWidth <= document.documentElement.clientWidth + 1
          || wrap.clientWidth < wrap.scrollWidth;
      });
      assert.equal(table, true, `table ${width}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
