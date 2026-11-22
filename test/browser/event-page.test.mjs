import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

const SPIN = `export class Spin extends EventCombinator {
  main() {
    const until = Date.now() + 5000;
    while (Date.now() < until) {}
    this.setOutput({
      red: true,
      green: false,
      signals: [{ signal: Signal.Signals.signal_A, constant: 7 }]
    });
  }
}
`;

const LATER = `export class Later extends EventCombinator {
  main() {
    return Promise.resolve(1);
  }
}
`;

const BAD_STATE = `export class BadState extends EventCombinator {
  main() {
    this.state = undefined;
  }
}
`;

const BOOM = `export class Boom extends EventCombinator {
  main() {
    throw new Error("разрыв");
  }
}
`;

const INFINITE = `export class Spin extends EventCombinator {
  main() {
    while (true) {}
  }
}
`;

const MARK = `export class Mark extends EventCombinator {
  main() {
    this.setOutput({
      red: true,
      green: false,
      signals: [{ signal: Signal.Signals.signal_A, constant: 4 }]
    });
  }
}
`;

const COUNTER = `export class Counter extends EventCombinator {
  init() {
    this.state.n = 0;
  }

  main() {
    this.state.n += 1;
    this.setOutput({
      red: true,
      green: false,
      signals: [{ signal: Signal.Signals.signal_A, constant: this.state.n }]
    });
  }
}
`;

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

async function openEditor() {
  const page = await browser.newPage();
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}/factorio-ide/pages/event/`);
  await page.locator("#script-source").waitFor();
  return { page, errors };
}

async function openDetails(page, id) {
  const details = page.locator(id);
  if (await details.evaluate((node) => node.open)) return;
  await details.locator("summary").click();
}

async function setLimit(page, value) {
  await openDetails(page, "#event-settings");
  await page.locator("#timeout-ms").fill(String(value));
}

async function check(page) {
  await page.locator("#check").click();
  await page.waitForFunction(() => {
    const status = document.querySelector("#run-status")?.dataset.status;
    return status === "ready" || status === "failed" || status === "paused";
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

test("страница под /factorio-ide/ гоняет наследника в Worker", { timeout: 60_000 }, async () => {
  const { page, errors } = await openEditor();
  try {
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    assert.equal(resources.some((name) => name.includes("/src/event-worker.js")), false);
    await check(page);
    assert.equal(await page.locator("#run-status").getAttribute("data-status"), "ready");
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.equal(await page.locator("#class-name").textContent(), "Arrival");
    assert.equal(await page.locator("#shell-name").textContent(), "EventCombinator");
    assert.match(await page.locator("#red-body").textContent(), /Нет сигналов/);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "1");
    assert.match(await page.locator("#red-body").textContent(), /signal-A/);
    assert.match(await page.locator("#red-body").textContent(), /1/);
    assert.match(await page.locator("#device-state").textContent(), /"arrived": true/);
    const runId = await page.locator("#run-meta").textContent();
    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "0");
    assert.match(await page.locator("#device-state").textContent(), /"arrived": false/);
    assert.notEqual(await page.locator("#run-meta").textContent(), runId);
    const loaded = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    assert.equal(loaded.some((name) => name.includes("/factorio-ide/src/event-worker.js")), true);
    assert.equal(loaded.some((name) => name.includes("/factorio-ide/pages/event/page.js")), true);
    assert.equal(loaded.some((name) => name.includes("/api/")), false);
    const tick = await page.locator("#tick-value").textContent();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#tick-value").textContent(), tick);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("зависание, повторный шаг, правка и сброс не публикуют частичный тик", { timeout: 60_000 }, async () => {
  const { page, errors } = await openEditor();
  try {
    await setLimit(page, 5000);
    await page.locator("#script-source").fill(SPIN);
    await check(page);
    const busy = page.evaluate(async () => {
      window.__eventPage.step().catch(() => {});
      try {
        await window.__eventPage.step();
        return "ok";
      } catch (error) {
        return error.code;
      }
    });
    await page.locator("#ui-ping").click();
    assert.equal(await page.locator("#ui-alive").textContent(), "Интерфейс: alive");
    assert.equal(await busy, "step-busy");
    await page.locator("#script-source").fill(MARK);
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("изменён"));
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.doesNotMatch(await page.locator("#red-body").textContent(), /7/);
    await check(page);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "1");
    assert.match(await page.locator("#red-body").textContent(), /4/);
    assert.doesNotMatch(await page.locator("#red-body").textContent(), /7/);

    await setLimit(page, 5000);
    await page.locator("#script-source").fill(SPIN);
    await check(page);
    const before = await page.evaluate(() => window.__eventPage.view().runId);
    const spinning = page.evaluate(() => window.__eventPage.step().catch((error) => error.code));
    await page.locator("#reset").click();
    await page.waitForFunction(() => document.querySelector("#run-status").dataset.status === "ready");
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.doesNotMatch(await page.locator("#red-body").textContent(), /7/);
    const after = await page.evaluate(() => window.__eventPage.view().runId);
    assert.notEqual(after, before);
    await spinning;
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.doesNotMatch(await page.locator("#red-body").textContent(), /7/);
    assert.equal(await page.evaluate(() => window.__eventPage.view().runId), after);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("диагностика Promise, состояния, синтаксиса и исключения указывает блок и тик", { timeout: 60_000 }, async () => {
  const { page, errors } = await openEditor();
  try {
    await page.locator("#script-source").fill(LATER);
    await check(page);
    await page.locator("#step").click();
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("async-main"));
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.match(await page.locator("#diagnostic").textContent(), /блок /);
    assert.match(await page.locator("#diagnostic").textContent(), /тик 0/);

    await page.locator("#script-source").fill(BAD_STATE);
    await check(page);
    await page.locator("#step").click();
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("invalid-state"));
    assert.equal(await page.locator("#tick-value").textContent(), "0");

    await page.locator("#script-source").fill(BOOM);
    await check(page);
    await page.locator("#step").click();
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("разрыв"));
    assert.match(await page.locator("#diagnostic").textContent(), /script-error/);
    assert.match(await page.locator("#diagnostic").textContent(), /тик 0/);
    assert.match(await page.locator("#diagnostic").textContent(), /main/);

    await page.locator("#script-source").fill("export class Bad extends EventCombinator {\n  main(\n}\n");
    await page.locator("#check").click();
    await page.waitForFunction(() => document.querySelector("#run-status").dataset.status === "failed");
    assert.equal(await page.locator("#tick-value").textContent(), "—");
    assert.equal(await page.locator("#step").isDisabled(), true);
    assert.equal(await page.locator("#check").isDisabled(), false);

    await openDetails(page, "#event-settings");
    await page.locator("#state-json").fill("{");
    await page.locator("#script-source").fill(MARK);
    await page.locator("#check").click();
    await page.waitForFunction(() => (document.querySelector("#diagnostic")?.textContent ?? "").includes("invalid-state"));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("остановка и снимок восстанавливают границу без нового init", { timeout: 60_000 }, async () => {
  const { page, errors } = await openEditor();
  try {
    await page.locator("#script-source").fill(COUNTER);
    await check(page);
    await page.locator("#step").click();
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "2");
    await openDetails(page, "#event-state");
    await page.locator("#open-snapshot").click();
    await page.locator("#remember").click();
    await page.waitForFunction(() => (document.querySelector("#snapshot-summary")?.textContent ?? "").includes("тик 2"));
    await page.keyboard.press("Escape");
    const runId = await page.evaluate(() => window.__eventPage.view().runId);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "3");
    await page.locator("#stop").click();
    await page.waitForFunction(() => document.querySelector("#run-status").dataset.status === "paused");
    assert.equal(await page.locator("#tick-value").textContent(), "3");
    assert.equal(await page.evaluate(() => window.__eventPage.view().runId), runId);
    await page.locator("#open-snapshot").click();
    await page.locator("#restore").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "2");
    assert.equal(await page.evaluate(() => window.__eventPage.view().runId), runId);
    assert.match(await page.locator("#device-state").textContent(), /"n": 2/);
    await page.keyboard.press("Escape");
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "3");
    assert.match(await page.locator("#device-state").textContent(), /"n": 3/);
    await page.locator("#open-snapshot").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#snapshot-dialog").isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector("#open-snapshot")), true);
    await page.locator('[data-work-view="code"]').focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-work-view")), "networks");
    assert.equal(await page.locator('[data-work-view="networks"]').evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#networks-column").isHidden(), true);
    assert.equal(await page.locator('[data-work-view="networks"]').getAttribute("aria-expanded"), "false");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#networks-column").isHidden(), false);
    assert.equal(await page.locator("[role='tablist']").count(), 0);
    assert.notEqual(await page.locator("label[for='script-source']").textContent(), "");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("бесконечный цикл обрывается лимитом, интерфейс отвечает", { timeout: 60_000 }, async () => {
  const { page, errors } = await openEditor();
  try {
    await setLimit(page, 300);
    await page.locator("#script-source").fill(INFINITE);
    await check(page);
    const pending = page.evaluate(() => window.__eventPage.step().catch((error) => error.code));
    await page.locator("#ui-ping").click();
    assert.equal(await page.locator("#ui-alive").textContent(), "Интерфейс: alive");
    assert.equal(await pending, "timeout");
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.equal(await page.locator("#run-status").getAttribute("data-status"), "paused");
    assert.equal(await page.locator("#toolbar").getAttribute("aria-busy"), "false");
    assert.match(await page.locator("#diagnostic").textContent(), /timeout/);
    assert.match(await page.locator("#diagnostic").textContent(), /блок d1/);
    assert.match(await page.locator("#diagnostic").textContent(), /тик 0/);
    assert.doesNotMatch(await page.locator("#red-body").textContent(), /signal-A/);
    await page.locator("#script-source").fill(MARK);
    await check(page);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value").textContent === "1");
    assert.match(await page.locator("#red-body").textContent(), /4/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("узкие ширины не растягивают документ, обрыв Worker снимает занятость", { timeout: 60_000 }, async () => {
  const { page, errors } = await openEditor();
  try {
    await page.locator("#script-source").fill(`${MARK}\n// ${"x".repeat(400)}`);
    await check(page);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, `overflow at ${width}`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }

  const broken = await browser.newPage();
  const brokenErrors = [];
  broken.on("pageerror", (error) => brokenErrors.push(error.message));
  await broken.route("**/event-worker.js", (route) => route.abort());
  await broken.goto(`http://127.0.0.1:${port}/factorio-ide/pages/event/`);
  await openDetails(broken, "#event-settings");
  await broken.locator("#timeout-ms").fill("300");
  await broken.locator("#check").click();
  await broken.waitForFunction(() => {
    const status = document.querySelector("#run-status")?.dataset.status;
    return status === "failed" || status === "paused";
  }, null, { timeout: 10_000 });
  assert.notEqual(await broken.locator("#run-status").getAttribute("data-status"), "busy");
  assert.equal(await broken.locator("#check").isDisabled(), false);
  assert.equal(await broken.locator("#toolbar").getAttribute("aria-busy"), "false");
  assert.notEqual((await broken.locator("#diagnostic").textContent()).trim(), "");
  await broken.close();
  void brokenErrors;
});

test("два блока в одном Worker не публикуют частичный тик", { timeout: 60_000 }, async () => {
  const page = await browser.newPage();
  const errors = track(page);
  try {
    await page.goto(`http://127.0.0.1:${port}/factorio-ide/test/browser/event/partial.html`);
    await page.waitForFunction(() => {
      const text = document.querySelector("#status")?.textContent ?? "";
      return text.startsWith("tick:") || text.startsWith("no-timeout") || text.startsWith("fail");
    });
    assert.equal(
      await page.locator("#status").textContent(),
      "tick:0|signal:2|state:1|wakes:5|code:timeout|alive:alive",
    );
    assert.equal(await page.locator("#alive").textContent(), "alive");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("сценарий дополняет поддержанный API у каретки", { timeout: 60_000 }, async () => {
  const { page, errors } = await openEditor();
  try {
    const area = page.locator("#script-source");
    const menu = page.locator("[data-suggest='caret']");
    await area.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\nthis.pul");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-active='true']")?.textContent?.includes("this.pulse"));
    await page.keyboard.press("Enter");
    assert.match(await area.inputValue(), /this\.pulse$/);
    assert.equal((await area.inputValue()).includes("Arithmetic"), false);
    await page.keyboard.press("Control+z");
    assert.equal((await area.inputValue()).includes("this.pulse"), false);

    await page.keyboard.type("\n// this.set");
    assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), false);
    await page.keyboard.press("Control+Space");
    assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), false);
    await page.keyboard.type("\nArith");
    const options = await page.locator("[data-suggest='caret'] [role='option']").allTextContents();
    assert.equal(options.some((item) => item.includes("Arithmetic")), false);

    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("this.pul");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret']")?.matches(":popover-open"));
    await page.keyboard.press("Escape");
    assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), false);
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-active='true']")?.textContent?.includes("this.pulse"));
    await area.evaluate((node) => {
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    await page.waitForFunction(() => !document.querySelector("[data-suggest='caret']").matches(":popover-open"));
    await area.evaluate((node) => {
      node.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: "я",
        isComposing: true,
      }));
    });
    assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), false);
    await area.evaluate((node) => {
      node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "я" }));
    });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("номера строк сценария прокручиваются вместе с кодом", { timeout: 60_000 }, async () => {
  const source = [
    "export class ScrollProbe extends EventCombinator {",
    "  main() {",
    ...Array.from({ length: 70 }, (_, index) => `    // row ${index + 1}${index === 20 ? ` ${"x".repeat(220)}` : ""}`),
    "  }",
    "}",
  ].join("\n");
  const { page, errors } = await openEditor();
  try {
    await page.setViewportSize({ width: 390, height: 800 });
    const area = page.locator("#script-source");
    const gutter = page.locator("#code-gutter");
    await area.fill(source);
    await area.evaluate((node) => {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    });
    await page.waitForFunction(() => {
      const field = document.querySelector("#script-source");
      const numbers = document.querySelector("#code-gutter");
      return field.scrollTop < 1 && Math.abs(field.scrollTop - numbers.scrollTop) < 1;
    });
    const read = () => page.evaluate(() => {
      const field = document.querySelector("#script-source");
      const numbers = document.querySelector("#code-gutter");
      const paint = document.querySelector(".fl-editor__paint");
      const topOf = (root, line) => {
        const text = root?.textContent ?? "";
        let offset = 0;
        for (let index = 1; index < line; index += 1) {
          const next = text.indexOf("\n", offset);
          if (next < 0) return null;
          offset = next + 1;
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let consumed = 0;
        let node = walker.nextNode();
        while (node) {
          const end = consumed + node.textContent.length;
          if (offset >= consumed && offset < end) {
            const range = document.createRange();
            const local = offset - consumed;
            range.setStart(node, local);
            range.setEnd(node, Math.min(node.textContent.length, local + 1));
            return range.getBoundingClientRect().top;
          }
          consumed = end;
          node = walker.nextNode();
        }
        return null;
      };
      const numberTop = topOf(numbers, 6);
      const paintTop = topOf(paint, 6);
      return {
        overflow: getComputedStyle(numbers).overflowY,
        scrollTop: field.scrollTop,
        gutterTop: numbers.scrollTop,
        scrollLeft: field.scrollLeft,
        gutterLeft: numbers.scrollLeft,
        transform: paint?.style.transform ?? "",
        dy: numberTop === null || paintTop === null ? null : Math.abs(numberTop - paintTop),
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const assertSync = (state, label) => {
      assert.equal(state.overflow, "hidden", label);
      assert.ok(Math.abs(state.scrollTop - state.gutterTop) < 1, `${label} ${state.scrollTop}/${state.gutterTop}`);
      assert.equal(state.gutterLeft, 0, label);
      assert.equal(state.transform, `translate(${-state.scrollLeft}px, ${-state.scrollTop}px)`, label);
      assert.ok(state.dy !== null && state.dy <= 2, `${label} dy ${state.dy}`);
      assert.ok(state.documentOverflow <= 1, `${label} document ${state.documentOverflow}`);
    };
    const initial = await read();
    assert.equal(initial.scrollTop, 0);
    assertSync(initial, "start");
    const box = await gutter.boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + Math.min(28, box.height / 2) };
    assert.equal(await page.evaluate((hit) => document.elementFromPoint(hit.x, hit.y)?.id, point), "code-gutter");
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 140);
    await page.waitForFunction(() => {
      const field = document.querySelector("#script-source");
      const numbers = document.querySelector("#code-gutter");
      return field.scrollTop > 1 && Math.abs(field.scrollTop - numbers.scrollTop) < 1;
    });
    assertSync(await read(), "wheel");
    await page.mouse.wheel(100, 0);
    await page.waitForFunction(() => {
      const field = document.querySelector("#script-source");
      const numbers = document.querySelector("#code-gutter");
      return field.scrollLeft > 1 && numbers.scrollLeft === 0 && Math.abs(field.scrollTop - numbers.scrollTop) < 1;
    });
    const wide = await read();
    assert.equal(wide.gutterLeft, 0);
    assertSync(wide, "x");
    await gutter.dispatchEvent("pointerdown", {
      pointerType: "touch", pointerId: 1, button: 0, clientX: point.x, clientY: point.y, bubbles: true,
    });
    await gutter.dispatchEvent("pointermove", {
      pointerType: "touch", pointerId: 1, button: 0, clientX: point.x + 50, clientY: point.y + 60, bubbles: true,
    });
    await gutter.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 1, button: 0, bubbles: true });
    const touched = await read();
    assert.ok(touched.scrollTop < wide.scrollTop - 1);
    assert.ok(touched.scrollLeft < wide.scrollLeft);
    assertSync(touched, "touch");
    const areaBox = await area.boundingBox();
    await area.click({ position: { x: 20, y: 24 } });
    const beforeKey = (await read()).scrollTop;
    await page.keyboard.press("PageDown");
    await page.waitForFunction((previous) => {
      const field = document.querySelector("#script-source");
      const numbers = document.querySelector("#code-gutter");
      return field.scrollTop > previous && Math.abs(field.scrollTop - numbers.scrollTop) < 1;
    }, beforeKey);
    const keyed = await read();
    assert.ok(keyed.scrollTop > beforeKey, `key ${beforeKey}->${keyed.scrollTop} box ${areaBox?.y}`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "script-source");
    assertSync(keyed, "key");
    const beforePaste = await area.inputValue();
    await area.evaluate((node) => {
      const extra = `\n${"// pasted\n".repeat(20)}`;
      node.setRangeText(extra, node.value.length, node.value.length, "end");
      node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    });
    await page.waitForFunction(() => document.querySelector("#code-gutter").textContent.includes("\n80"));
    assertSync(await read(), "paste");
    await area.fill(beforePaste);
    await area.focus();
    await page.keyboard.type("Z");
    await page.keyboard.press("Control+z");
    await page.waitForFunction((text) => document.querySelector("#script-source").value === text, beforePaste);
    assertSync(await read(), "undo");
    await area.evaluate((node) => { node.scrollTop = 220; });
    await page.waitForFunction(() => {
      const field = document.querySelector("#script-source");
      const numbers = document.querySelector("#code-gutter");
      return field.scrollTop > 100 && Math.abs(field.scrollTop - numbers.scrollTop) < 1;
    });
    const programmed = await read();
    assert.ok(programmed.scrollTop > 100);
    assertSync(programmed, "program");
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    assertSync(await read(), "resize");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("телефон открывает настройки, сети и причину из рабочей области", { timeout: 60_000 }, async () => {
  const { page, errors } = await openEditor();
  try {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForFunction(() => document.querySelector("#networks-column").hidden === true
      && document.querySelector("#code-panel").hidden === false);
    const phone = await page.evaluate(() => {
      const code = document.querySelector("#script-source").getBoundingClientRect();
      const scroller = document.scrollingElement;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + 200;
      const documentScrolls = scroller.scrollTop > before + 1;
      scroller.scrollTop = before;
      return {
        codeVisible: code.height > 80 && code.top < window.innerHeight && code.bottom > 0,
        toolChildren: [...document.querySelector(".fl-screen__tools").children].map((node) => node.id),
        stray: document.querySelectorAll(".fl-pane-switch, .fl-workspace__bottom, [role='tablist'], #play, #back, #speed").length,
        check: document.querySelector("#check").textContent.trim(),
        stop: document.querySelector("#stop").textContent.trim(),
        step: document.querySelector("#step").getAttribute("aria-label"),
        reset: document.querySelector("#reset").getAttribute("aria-label"),
        stepText: document.querySelector("#step").textContent.trim(),
        settingsOpen: document.querySelector("#event-settings").open,
        stateOpen: document.querySelector("#event-state").open,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        tall: document.documentElement.scrollHeight > window.innerHeight + 1,
        documentScrolls,
      };
    });
    assert.equal(phone.codeVisible, true);
    assert.deepEqual(phone.toolChildren, ["toolbar"]);
    assert.equal(phone.stray, 0);
    assert.equal(phone.check, "Проверить");
    assert.equal(phone.stop, "Остановить");
    assert.equal(phone.step, "Шаг");
    assert.equal(phone.reset, "Сброс");
    assert.equal(phone.stepText, "");
    assert.equal(phone.settingsOpen, false);
    assert.equal(phone.stateOpen, false);
    assert.equal(phone.overflow, false);
    assert.equal(phone.tall, false);
    assert.equal(phone.documentScrolls, false);

    await openDetails(page, "#event-settings");
    await page.locator("#timeout-ms").fill("2500");
    await page.locator("#every-tick").uncheck();
    await page.locator("#state-json").fill('{"kept":1}');
    await page.locator('[data-work-view="networks"]').click();
    await page.waitForFunction(() => document.querySelector("#networks-column").hidden === false
      && document.querySelector("#code-panel").hidden === true);
    assert.equal(await page.locator("#red-body").count(), 1);
    assert.equal(await page.locator("#green-body").count(), 1);
    await page.locator("#networks-column .fl-table-wrap").first().focus();
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.waitForFunction(() => document.querySelector("#code-panel").hidden === false
      && document.querySelector("#networks-column").hidden === false);
    assert.equal(await page.locator("#timeout-ms").inputValue(), "2500");
    assert.equal(await page.locator("#every-tick").isChecked(), false);
    assert.equal(await page.locator("#state-json").inputValue(), '{"kept":1}');
    const wide = await page.evaluate(() => {
      const code = document.querySelector("#code-panel").getBoundingClientRect();
      const networks = document.querySelector("#networks-column").getBoundingClientRect();
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return {
        networksRight: networks.x >= code.x + code.width - 8,
        codeWider: code.width > networks.width * 1.5,
        minNetworks: networks.width + 1 >= root * 16,
        tables: document.querySelectorAll("#red-body").length,
      };
    });
    assert.equal(wide.networksRight, true);
    assert.equal(wide.codeWider, true);
    assert.equal(wide.minNetworks, true);
    assert.equal(wide.tables, 1);

    await page.setViewportSize({ width: 390, height: 700 });
    await page.waitForFunction(() => document.querySelector("#networks-column").hidden === false
      && document.querySelector("#code-panel").hidden === true);
    await page.locator('[data-work-view="code"]').click();
    await page.locator("#every-tick").check();
    await page.locator("#state-json").fill("{}");
    await page.locator("#script-source").fill(BOOM);
    await check(page);
    await page.locator("#step").click();
    await page.waitForFunction(() => (document.querySelector("#edit-status")?.textContent ?? "").includes("разрыв"));
    assert.equal(await page.locator("#tick-value").textContent(), "0");
    assert.equal(await page.locator("#stop").isDisabled(), false);
    const summary = await page.locator("#edit-status").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.height > 8 && rect.width > 40 && style.overflow !== "hidden" && rect.right <= window.innerWidth + 1;
    });
    assert.equal(summary, true);
    await page.locator("#diagnostic-toggle").click();
    const full = await page.locator("#diagnostic").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        text: node.textContent,
        visible: node.hidden === false && rect.height > 24 && rect.top < window.innerHeight && rect.bottom > 0,
        readable: node.scrollHeight >= node.clientHeight && node.clientHeight > 24,
      };
    });
    assert.match(full.text, /script-error/);
    assert.match(full.text, /тик 0/);
    assert.equal(full.visible, true);
    assert.equal(full.readable, true);
    await page.locator("#diagnostic-toggle").focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#diagnostic").isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "diagnostic-toggle");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
