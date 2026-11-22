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

const WIDTHS = [320, 390, 768, 1024, 1440];

function track(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function openConfigure(width = 1280, pathname = "/factorio-ide/pages/configure/", platform = "") {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  if (platform) {
    await context.addInitScript((kind) => {
      const mac = kind === "mac";
      const platformName = mac ? "MacIntel" : "Win32";
      const agent = mac
        ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => platformName });
      Object.defineProperty(Navigator.prototype, "userAgent", { configurable: true, get: () => agent });
      Object.defineProperty(Navigator.prototype, "userAgentData", {
        configurable: true,
        get: () => ({ platform: mac ? "macOS" : "Windows" }),
      });
    }, platform);
  }
  const page = await context.newPage();
  const errors = track(page);
  await page.goto(`http://127.0.0.1:${port}${pathname}`);
  await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Разбор выполнен"
    && document.querySelector("#toolbar")?.dataset.playback === "paused"
    && document.querySelector("#tick-value")?.textContent === "—");
  return { page, context, errors };
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

test("запуск, шаг и отказ ошибочной схемы", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure();
  try {
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0"
      && document.querySelector("#live-signals [data-value='3']"));
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#live-signals [data-network='green_1'][data-value='5']"));

    const current = await page.locator("#document").inputValue();
    await page.locator("#document").fill(current.replace("constant: 2", "constant: 1.5"));
    await page.waitForFunction(() => document.querySelector("#diagnostics [data-code='invalid-constant']")?.dataset.expected === "int32");
    assert.equal(await page.locator("#play").isDisabled(), true);
    assert.equal(await page.locator("#tick-value").textContent(), "—");
    assert.equal(await page.locator("#signal-panel").getAttribute("data-run"), "stale");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("редактор подсвечивает слова конфигурации и пути сигналов", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure();
  try {
    const words = await page.locator(".fl-editor__paint .kw").allTextContents();
    const types = await page.locator(".fl-editor__paint .type").allTextContents();
    const paths = await page.locator(".fl-editor__paint .path").allTextContents();
    assert.ok(types.includes("Constant"));
    assert.ok(types.includes("Arithmetic"));
    assert.ok(words.includes("new"));
    assert.ok(paths.includes("wooden_chest"));
    const keyword = await page.locator(".fl-editor__paint .kw").first().evaluate((node) => getComputedStyle(node).color);
    const field = await page.locator("#document").evaluate((node) => getComputedStyle(node).color);
    assert.notEqual(keyword, field);
    assert.match(await page.locator("#document").inputValue(), /Constant\(\{/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("код и таблица не растягивают документ на контрольных ширинах", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure(1440);
  try {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        editor: getComputedStyle(document.querySelector("#document")).overflowY,
        table: getComputedStyle(document.querySelector("#signal-scroll")).overflow,
      }));
      assert.ok(metrics.document <= 1, `ширина ${width}: документ ${metrics.document}`);
      assert.equal(metrics.editor, "auto");
      assert.equal(metrics.table, "auto");
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("инспектор справа прокручивает секции и не забирает фокус", { timeout: 90_000 }, async () => {
  const networks = Array.from({ length: 24 }, (_, index) => `constant item_${index} = new Constant({
  enabled: true,
  red_output: red_${index},
  signals: [{ signal: Signal.Signals.signal_A, constant: ${index + 1} }]
})`).join("\n");
  for (const pathname of ["/", "/pages/configure/"]) {
    const { page, context, errors } = await openConfigure(1440, pathname);
    try {
      assert.equal(await page.locator(".fl-screen__drawers").count(), 0);
      assert.equal(await page.locator(".fl-editor-inspector").count(), 1);
      const ids = ["signal-panel", "diagnostics-panel", "diagnostics-toggle"];
      assert.equal(await page.locator("#devices-panel, #forms-panel").count(), 0);
      for (const id of ids) assert.equal(await page.locator(`[id="${id}"]`).count(), 1, `${pathname} ${id}`);
      const dupes = await page.evaluate(() => {
        const found = [...document.querySelectorAll("[id]")].map((node) => node.id);
        return found.filter((id, index) => found.indexOf(id) !== index);
      });
      assert.deepEqual(dupes, []);
      await page.locator("#document").fill(networks);
      await page.locator("#step").click();
      await page.waitForFunction(() => document.querySelectorAll("#live-signals tr[data-network]").length >= 20);

      await page.setViewportSize({ width: 390, height: 600 });
      if (await page.locator("#diagnostics-toggle").getAttribute("aria-expanded") === "true") {
        await page.locator("#diagnostics-toggle").click();
      }
      await page.evaluate(() => { document.querySelector(".fl-editor-inspector").scrollTop = 0; });
      await page.locator("#document").fill(networks.replace("constant: 1 }", "constant: 1.5 }"));
      await page.waitForFunction(() => document.querySelector("#error-jump") && !document.querySelector("#error-jump").hidden);
      await page.locator("#error-jump").click();
      const jumped = await page.evaluate(() => {
        const area = document.querySelector("#document");
        const section = document.querySelector("#diagnostics-panel").closest("section");
        const frame = document.querySelector(".fl-editor-inspector").getBoundingClientRect();
        const box = section.getBoundingClientRect();
        return {
          selected: area.value.slice(area.selectionStart, area.selectionEnd),
          seen: box.top < frame.bottom - 1 && box.bottom > frame.top + 1,
          focus: document.activeElement === area,
        };
      });
      assert.match(jumped.selected, /1\.5/);
      assert.equal(jumped.seen, true, pathname);
      assert.equal(jumped.focus, true, pathname);

      await page.locator("#signal-filter").focus();
      await page.locator("#signal-filter").fill("red_3");
      assert.equal(await page.evaluate(() => document.activeElement.id), "signal-filter");

      const metrics = await page.evaluate(() => {
        const scroller = document.scrollingElement;
        const before = scroller.scrollTop;
        scroller.scrollTop = before + 300;
        const documentScrolls = scroller.scrollTop > before + 1;
        scroller.scrollTop = before;
        const table = document.querySelector("#signal-scroll");
        const area = document.querySelector("#document");
        return {
          documentScrolls,
          tableScrolls: table.scrollHeight > table.clientHeight + 1,
          codeScrolls: area.scrollHeight > area.clientHeight + 1,
        };
      });
      assert.equal(metrics.documentScrolls, false, pathname);
      assert.equal(metrics.tableScrolls, true, pathname);
      assert.equal(metrics.codeScrolls, true, pathname);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test("станция публикует присутствие и снимает его на следующем шаге", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure();
  try {
    await page.locator("#document").fill(`wire red_stop {}
wire red_go {}
constant go = new Constant({
  enabled: true,
  red_output: red_go,
  signals: [{ signal: Signal.Signals.signal_D, constant: 1 }]
})
station stop = new Station({
  depart: Signal.Signals.signal_D,
  red_input: red_go,
  red_output: red_stop
})
train loco = new Train({
  route: [stop],
  transit: 1,
  at: 0
})`);
    await page.locator("#step").click();
    await page.waitForFunction(() => document.querySelector("#live-signals [data-network='red_stop'][data-signal='signal-T']")?.dataset.value === "1");
    await page.locator("#step").click();
    await page.waitForFunction(() => !document.querySelector("#live-signals [data-network='red_stop'][data-signal='signal-T']"));
    assert.equal(await page.locator("#tick-value").textContent(), "1");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("корень показывает редактор, прогон и две сети одного сигнала", { timeout: 60_000 }, async () => {
  for (const pathname of ["/", "/factorio-ide/"]) {
    const { page, context, errors } = await openConfigure(1280, pathname);
    try {
      assert.equal(await page.locator("#demo-rows").count(), 0);
      assert.equal(await page.locator("#forms-panel, #devices-panel").count(), 0);
      assert.equal(await page.locator("#diagnostics-panel").isHidden(), true);
      assert.equal(await page.locator("#open-events").textContent(), "Событийные комбинаторы");
      const widths = await page.evaluate(() => ({
        code: document.querySelector("#document").closest("section").getBoundingClientRect().width,
        signals: document.querySelector("#signal-panel").getBoundingClientRect().width,
      }));
      assert.ok(widths.code > widths.signals, `${pathname}: код ${widths.code}, сети ${widths.signals}`);

      await chooseSelect(page, "speed", "100");
      await page.locator("#play").click();
      await page.waitForFunction(() => Number(document.querySelector("#tick-value")?.textContent) >= 2);
      await page.locator("#play").click();
      await page.waitForFunction(() => document.querySelector("#toolbar")?.getAttribute("aria-busy") === "false"
        && document.querySelector("#back")?.disabled === false
        && document.querySelector("#play-label")?.textContent === "Запустить");
      const paused = await page.locator("#tick-value").textContent();
      await page.waitForTimeout(350);
      assert.equal(await page.locator("#tick-value").textContent(), paused);
      const text = await page.locator("#document").inputValue();
      await page.locator("#back").click();
      await page.waitForFunction((current) => document.querySelector("#tick-value")?.textContent !== current, paused);
      assert.equal(await page.locator("#document").inputValue(), text);
      await page.locator("#reset").click();
      await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0"
        && document.querySelector("#tick-value")?.dataset.current === "true");

      await page.locator("#document").fill(`Constant({
        enabled: true,
        red_output: red_a,
        signals: [{ signal: Signal.Signals.signal_A, constant: 1 }]
      })
      Constant({
        enabled: true,
        green_output: green_b,
        signals: [{ signal: Signal.Signals.signal_A, constant: 4 }]
      })
      Arithmetic({
        red_input: red_a,
        green_input: green_empty,
        left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
        right_operand: { constant: 0 },
        operation: Arithmetic.Operation.SUM,
        return: Signal.Signals.signal_A
      })`);
      await page.locator("#step").click();
      await page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0");
      const red = page.locator("#live-signals tr[data-network='red_a'][data-signal='signal-A']");
      const green = page.locator("#live-signals tr[data-network='green_b'][data-signal='signal-A']");
      assert.equal(await red.getAttribute("data-value"), "1");
      assert.equal(await red.getAttribute("data-color"), "red");
      assert.equal(await green.getAttribute("data-value"), "4");
      assert.equal(await green.getAttribute("data-color"), "green");
      assert.notEqual(await red.textContent(), await green.textContent());
      const empty = page.locator("#live-signals tr[data-network='green_empty']");
      assert.equal(await empty.getAttribute("data-empty"), "true");
      assert.equal(await empty.getAttribute("data-value"), null);
      await page.locator("#signal-filter").fill("green_b");
      await page.waitForFunction(() => document.querySelectorAll("#live-signals tr[data-network='red_a']").length === 0
        && document.querySelector("#live-signals tr[data-network='green_b']"));

      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test("ошибка открывает место в тексте, черновик возвращается со страницы событий", { timeout: 60_000 }, async () => {
  const broken = await openConfigure(1280, "/factorio-ide/");
  try {
    await broken.page.locator("#step").click();
    await broken.page.waitForFunction(() => document.querySelector("#tick-value")?.textContent === "0");
    await broken.page.locator("#document").fill(await broken.page.locator("#document").inputValue().then((text) => text.replace("constant: 2", "constant: 1.5")));
    await broken.page.waitForFunction(() => document.querySelector("#error-jump") && !document.querySelector("#error-jump").hidden);
    await broken.page.locator("#error-jump").click();
    assert.equal(await broken.page.locator("#diagnostics-panel").isHidden(), false);
    const jumped = await broken.page.evaluate(() => {
      const area = document.querySelector("#document");
      const panel = document.querySelector("#diagnostics-panel");
      const section = panel.closest("section");
      const frame = document.querySelector(".fl-editor-inspector").getBoundingClientRect();
      const box = section.getBoundingClientRect();
      return {
        selected: area.value.slice(area.selectionStart, area.selectionEnd),
        inside: document.querySelector(".fl-editor-inspector")?.contains(panel) === true,
        seen: box.bottom > frame.top + 1 && box.top < frame.bottom - 1,
        focus: document.activeElement === area,
      };
    });
    assert.match(jumped.selected, /1\.5/);
    assert.equal(jumped.inside, true);
    assert.equal(jumped.seen, true);
    assert.equal(jumped.focus, true);
    assert.equal(await broken.page.locator("#play").isDisabled(), true);
    assert.deepEqual(broken.errors, []);
  } finally {
    await broken.context.close();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = track(page);
  try {
    await page.goto(`http://127.0.0.1:${port}/factorio-ide/`);
    await page.waitForSelector("#document");
    await page.locator("#document").fill("Arithmetic({ left_operand: { red: true, green: false, signal: Signal.Signals.signal_Z } })");
    await page.locator("#open-events").click();
    await page.waitForSelector("#open-editor");
    await page.locator("#open-editor").click();
    await page.waitForFunction(() => (document.querySelector("#document")?.value ?? "").includes("signal_Z"));
    assert.match(page.url(), /\/factorio-ide\/(?:index\.html)?\?draft=1$/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("набор в незаконченном тексте принимает подсказку у каретки", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure();
  const area = page.locator("#document");
  const menu = page.locator("[data-suggest='caret']");
  try {
    await area.fill("");
    await area.pressSequentially("Arith", { delay: 15 });
    await menu.waitFor({ state: "visible" });
    const opened = await menu.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(opened.x >= -1 && opened.y >= -1);
    assert.ok(opened.x + opened.width <= viewport.width + 1);
    assert.ok(opened.y + opened.height <= viewport.height + 1);
    await page.keyboard.press("Enter");
    assert.equal(await area.inputValue(), "Arithmetic({\n\t\n})");
    assert.equal(await area.evaluate((node) => node.selectionStart), "Arithmetic({\n\t".length);
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-value='red_input']"));
    await page.keyboard.press("Escape");

    await area.fill("");
    await area.pressSequentially("Arithmetic({ red_input: red_", { delay: 10 });
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-active='true']")?.textContent?.includes("red_new"));
    await page.keyboard.press("Enter");
    assert.match(await area.inputValue(), /red_input: red_\d+/);
    assert.equal((await area.inputValue()).includes("red_new"), false);

    await area.fill("");
    await area.pressSequentially("return: Signal.Logistic.wood", { delay: 10 });
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-active='true']")?.textContent?.includes("wooden_chest"));
    await page.keyboard.press("Enter");
    assert.match(await area.inputValue(), /return: Signal\.Logistic\.wooden_chest$/);

    await area.fill("");
    await area.pressSequentially("operation: Arithmetic.Operation.", { delay: 10 });
    await page.waitForFunction(() => {
      const active = document.querySelector("[data-suggest='caret'] [data-active='true']");
      const sign = active?.querySelector(".fl-muted")?.textContent ?? "";
      const value = active?.dataset.value ?? "";
      return value.startsWith("Arithmetic.Operation.")
        && sign !== ""
        && sign !== "Operation"
        && !active.textContent.startsWith("Arithmetic.");
    });
    const beforeUndo = await area.inputValue();
    await page.keyboard.press("Enter");
    assert.match(await area.inputValue(), /operation: Arithmetic\.Operation\.[A-Z0-9_]+$/);
    assert.equal((await area.inputValue()).includes("Decider.Operation"), false);
    await page.locator("#undo").click();
    assert.equal(await area.inputValue(), beforeUndo);

    await area.fill("Arithmetic({ return: Signal.Logistic.woo, green_output: green_1 })");
    await area.evaluate((node) => {
      const caret = node.value.indexOf("woo") + 3;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
    await page.keyboard.type("d");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-active='true']")?.textContent?.includes("wooden_chest"));
    await menu.locator("[role='option']", { hasText: "wooden_chest" }).click();
    const completed = await area.inputValue();
    const marker = "return: Signal.Logistic.wooden_chest,\n";
    assert.equal(completed.includes(marker), true);
    assert.equal(completed.split("green_output").length, 2);
    assert.match(completed, /green_output: green_1 \}/);
    const caret = await area.evaluate((node) => node.selectionStart);
    assert.equal(completed.slice(caret), "\ngreen_output: green_1 })");

    await area.fill(`${"// row\n".repeat(40)}Arit`);
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
      node.scrollTop = node.scrollHeight;
    });
    await page.keyboard.type("h");
    await menu.waitFor({ state: "visible" });
    const edge = await menu.boundingBox();
    const size = page.viewportSize();
    assert.ok(edge.y >= -1 && edge.y + edge.height <= size.height + 1);
    await area.evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.waitForFunction(() => !document.querySelector("[data-suggest='caret']").matches(":popover-open"));
    await area.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret']").matches(":popover-open"));

    await area.fill("Arith");
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.press("Control+Space");
    await menu.waitFor({ state: "visible" });
    await area.evaluate((node) => node.setSelectionRange(0, 0));
    await page.waitForFunction(() => !document.querySelector("[data-suggest='caret']").matches(":popover-open"));
    await page.keyboard.press("Enter");
    assert.equal((await area.inputValue()).includes("Arithmetic"), false);

    await area.fill("red_input: red_");
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.press("Control+Space");
    await menu.waitFor({ state: "visible" });
    await page.evaluate(() => {
      const node = document.querySelector("#document");
      node.value = "green_input: g";
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.press("Enter");
    const stale = await area.inputValue();
    assert.equal(stale.includes("red_new"), false);
    assert.equal(stale.includes("green_new"), false);
    assert.equal(stale.includes("Arithmetic"), false);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("каретка обновляет путь и знаки при вводе и удалении", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure();
  const area = page.locator("#document");
  const menu = page.locator("[data-suggest='caret']");
  try {
    await area.fill("");
    await area.pressSequentially("return: Signal.", { delay: 10 });
    await menu.waitFor({ state: "visible" });
    const group = menu.locator("[data-value='Signal.Logistic']");
    assert.equal(await group.textContent(), "Logistic");
    const captions = await menu.locator("[role='option']").evaluateAll((nodes) => nodes.map((node) => ({
      value: node.dataset.value,
      text: node.textContent,
    })));
    assert.equal(captions.every((item) => item.text !== item.value && !item.text.startsWith("Signal.")), true);
    await group.click();
    assert.equal(await area.inputValue(), "return: Signal.Logistic.");
    await page.keyboard.type("wood");
    const chest = menu.locator("[data-value='Signal.Logistic.wooden_chest']");
    await chest.waitFor({ state: "visible" });
    assert.equal(await chest.textContent(), "wooden_chest");
    await page.keyboard.press("Escape");
    assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), false);

    await area.fill("return: Signal.Logistic");
    await area.evaluate((node) => {
      const token = "Logistic";
      const start = node.value.lastIndexOf(token);
      node.focus();
      node.setSelectionRange(start, start + token.length);
    });
    await page.keyboard.press("Backspace");
    assert.equal(await area.inputValue(), "return: Signal.");
    await menu.waitFor({ state: "visible" });
    assert.equal(await menu.locator("[data-value='Signal.Logistic']").textContent(), "Logistic");

    await area.fill("return: Signal.L");
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length - 1, node.value.length - 1);
    });
    await page.keyboard.press("Delete");
    assert.equal(await area.inputValue(), "return: Signal.");
    await menu.waitFor({ state: "visible" });
    assert.equal(await menu.locator("[data-value='Signal.Logistic']").textContent(), "Logistic");

    await area.fill("");
    await area.pressSequentially("Arithmetic({ operation:", { delay: 5 });
    await menu.waitFor({ state: "visible" });
    const sum = menu.locator("[data-value='Arithmetic.Operation.SUM']");
    assert.equal(await sum.textContent(), "SUM +");
    assert.equal(await sum.locator(".fl-muted").textContent(), "+");
    const signs = await menu.locator(".fl-muted").allTextContents();
    assert.equal(signs.includes("Operation"), false);

    await area.fill("");
    await area.pressSequentially("// Signal.", { delay: 5 });
    assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), false);
    await area.fill("");
    await area.pressSequentially("\"Signal.", { delay: 5 });
    assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), false);

    await area.fill("Arith");
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.press("Control+Space");
    await menu.waitFor({ state: "visible" });
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
    assert.equal(await area.inputValue(), "Arith");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("сетевое имя завершается по Esc, Tab и клику без чужой подсказки", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure();
  const area = page.locator("#document");
  const menu = page.locator("[data-suggest='caret']");
  const caretAt = (token) => area.evaluate((node, name) => {
    const start = node.value.lastIndexOf(name);
    node.focus();
    node.setSelectionRange(start + name.length, start + name.length);
  }, token);
  try {
    await area.fill(`${"\n".repeat(30)}Arithmetic({ red_input: `);
    await caretAt("red_input: ");
    await area.pressSequentially("red_", { delay: 15 });
    await menu.waitFor({ state: "visible" });
    await area.evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.waitForFunction(() => {
      const node = document.querySelector("[data-suggest='caret']");
      return node?.dataset.closeReason === "scroll" && !node.matches(":popover-open");
    });
    assert.match(await area.inputValue(), /red_input: red_$/);
    assert.equal((await area.inputValue()).includes("red_new"), false);

    await area.evaluate((node) => node.setSelectionRange(0, 0));
    await area.fill("Arithmetic({ red_input: red_zz");
    await caretAt("red_zz");
    assert.equal(await menu.evaluate((node) => node.matches(":popover-open")), false);
    await page.keyboard.press("Escape");
    assert.equal(await menu.evaluate((node) => node.dataset.closeReason), "escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Space");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-value='red_zz']"));
    assert.equal(await menu.locator("[data-value='red_new']").count(), 0);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-suggest='caret']")?.matches(":popover-open"));
    await area.evaluate((node) => node.setSelectionRange(0, 0));
    await page.locator("#undo").click();
    await caretAt("red_zz");
    await page.keyboard.press("Control+Space");
    await page.waitForFunction(() => {
      const node = document.querySelector("[data-suggest='caret']");
      const values = [...(node?.querySelectorAll("[role='option']") ?? [])].map((item) => item.dataset.value);
      return !node?.matches(":popover-open") || !values.includes("red_zz");
    });

    await area.evaluate((node) => node.setSelectionRange(0, 0));
    await area.fill("Arithmetic({ red_input: red_limi");
    await caretAt("red_limi");
    await page.keyboard.press("Tab");
    assert.match(await area.inputValue(), /red_limi\t$/);
    assert.equal((await area.inputValue()).includes("red_new"), false);
    await page.locator("#undo").click();
    assert.equal(await area.inputValue(), "Arithmetic({ red_input: red_limi");

    await caretAt("red_limi");
    const box = await area.boundingBox();
    await page.mouse.click(box.x + 12, box.y + 12);
    await page.mouse.click(box.x + 18, box.y + 16);
    await caretAt("red_limi");
    await page.keyboard.press("Control+Space");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-value='red_limi']"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-suggest='caret']")?.matches(":popover-open"));
    await area.evaluate((node) => node.setSelectionRange(0, 0));
    await page.locator("#undo").click();
    await caretAt("red_limi");
    await page.keyboard.press("Control+Space");
    await page.waitForFunction(() => {
      const node = document.querySelector("[data-suggest='caret']");
      const values = [...(node?.querySelectorAll("[role='option']") ?? [])].map((item) => item.dataset.value);
      return !node?.matches(":popover-open") || !values.includes("red_limi");
    });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("структурная вставка ведёт от класса к полю, значению и вложенности", { timeout: 90_000 }, async () => {
  const { page, context, errors } = await openConfigure();
  const area = page.locator("#document");
  const menu = page.locator("[data-suggest='caret']");
  const caretOf = () => area.evaluate((node) => node.selectionStart);
  const valuesOf = () => menu.locator("[role='option']").evaluateAll((nodes) => nodes.map((node) => node.dataset.value));
  try {
    for (const name of ["Arithmetic", "Constant", "Decider", "Selector"]) {
      await area.fill("");
      await area.pressSequentially(name.slice(0, 4), { delay: 10 });
      await menu.waitFor({ state: "visible" });
      await page.keyboard.press("Enter");
      assert.equal(await area.inputValue(), `${name}({\n\t\n})`);
      assert.equal(await caretOf(), `${name}({\n\t`.length);
      await page.waitForFunction((field) => {
        const node = document.querySelector("[data-suggest='caret']");
        return node?.matches(":popover-open") && node.querySelector(`[data-value='${field}']`);
      }, name === "Constant" ? "enabled" : "red_input");
      await page.keyboard.press("Escape");
    }

    await area.fill("Arit");
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.press("Control+Space");
    await menu.waitFor({ state: "visible" });
    await page.keyboard.press("Tab");
    assert.equal(await area.inputValue(), "Arit\t");

    await area.fill("");
    await area.pressSequentially("Arit", { delay: 10 });
    await menu.waitFor({ state: "visible" });
    await page.keyboard.press("Enter");
    const scaffold = "Arithmetic({\n\t\n})";
    const atFields = await caretOf();
    assert.equal(await area.inputValue(), scaffold);
    await page.locator("#undo").click();
    assert.equal(await area.inputValue(), "Arit");
    assert.equal(await caretOf(), 4);
    await page.locator("#redo").click();
    assert.equal(await area.inputValue(), scaffold);
    assert.equal(await caretOf(), atFields);
    await area.focus();
    await page.keyboard.press("Control+Space");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-value='red_input']"));

    await menu.locator("[data-value='red_input']").click();
    assert.equal(await area.inputValue(), "Arithmetic({\n\tred_input: ,\n})");
    const slot = await caretOf();
    assert.equal((await area.inputValue())[slot], ",");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-value='red_new']"));
    await menu.locator("[data-value='null']").click();
    assert.equal(await area.inputValue(), "Arithmetic({\n\tred_input: null,\n\t\n})");
    const fields = await valuesOf();
    assert.equal(fields.includes("red_input"), false);
    assert.equal(fields.includes("return"), true);

    await menu.locator("[data-value='return']").click();
    assert.match(await area.inputValue(), /return: ,/);
    await page.keyboard.type("Signal.");
    await menu.locator("[data-value='Signal.Logistic']").click();
    const dotted = await area.inputValue();
    assert.match(dotted, /return: Signal\.Logistic\.,/);
    assert.equal(dotted.includes("wooden_chest"), false);
    await page.keyboard.type("wood");
    const beforeLeaf = await area.inputValue();
    const beforeCaret = await caretOf();
    await menu.locator("[data-value='Signal.Logistic.wooden_chest']").click();
    const leafText = await area.inputValue();
    const leafCaret = await caretOf();
    assert.match(leafText, /return: Signal\.Logistic\.wooden_chest,/);
    assert.equal(leafText.includes("return: Signal.Logistic.wooden_chest,\n\t"), true);
    const afterLeaf = await valuesOf();
    assert.equal(afterLeaf.includes("return"), false);
    assert.equal(afterLeaf.includes("red_input"), false);
    assert.equal(afterLeaf.includes("left_operand"), true);
    await page.locator("#undo").click();
    assert.equal(await area.inputValue(), beforeLeaf);
    assert.equal(await caretOf(), beforeCaret);
    await page.locator("#redo").click();
    assert.equal(await area.inputValue(), leafText);
    assert.equal(await caretOf(), leafCaret);

    await area.focus();
    await page.keyboard.press("Control+Space");
    await menu.locator("[data-value='left_operand']").waitFor({ state: "visible" });
    await menu.locator("[data-value='left_operand']").click();
    assert.match(await area.inputValue(), /left_operand: ,/);
    await page.keyboard.type("{");
    await page.waitForFunction(() => document.querySelector("[data-suggest='caret'] [data-value='red']"));
    assert.match(await area.inputValue(), /left_operand: \{\n\t\t\n\t\},/);
    await menu.locator("[data-value='red']").click();
    assert.match(await area.inputValue(), /red: ,/);
    await menu.locator("[data-value='true']").click();
    const inside = await area.inputValue();
    assert.match(inside, /red: true,/);
    assert.match(inside, /left_operand: \{/);
    const inner = await valuesOf();
    assert.equal(inner.includes("green"), true);
    assert.equal(inner.includes("signal"), true);
    assert.equal(inner.includes("red"), false);
    assert.equal(inner.includes("red_input"), false);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("форматирование, Tab и история действуют только в документе", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure();
  const area = page.locator("#document");
  const menu = page.locator("[data-suggest='caret']");
  const source = `${"// row\n".repeat(40)}Arithmetic({ return: Signal.Logistic.wooden_chest, red_input: red_1, green_output: green_1, left_operand: { red: true, green: true, signal: Signal.Logistic.wooden_chest }, right_operand: { constant: 2 }, operation: Arithmetic.Operation.SUM })`;
  try {
    assert.match(await page.locator("#document-hint").innerText(), /Tab — отступ, Enter — выбрать подсказку/);
    assert.match(await page.locator("#document-hint").innerText(), /Ctrl\+Alt\+L/);
    const untouched = await area.inputValue();
    await page.locator("#signal-filter").focus();
    await page.keyboard.press("Control+Alt+l");
    assert.equal(await area.inputValue(), untouched);

    await area.fill(source);
    await area.evaluate((node) => {
      const at = node.value.indexOf("return");
      node.focus();
      node.setSelectionRange(at, at + 6);
    });
    await area.press("Meta+Alt+l");
    assert.equal(await area.inputValue(), source);
    const before = await area.evaluate((node) => {
      node.scrollTop = 80;
      const at = node.selectionStart;
      return {
        scroll: node.scrollTop,
        line: node.value.slice(0, at).split("\n").length,
        height: Number.parseFloat(getComputedStyle(node).lineHeight) || 22,
      };
    });
    await area.press("Control+Alt+l");
    const formatted = await area.inputValue();
    assert.match(formatted, /\tred_input: red_1,\n\t/);
    assert.equal(formatted.indexOf("red_input") < formatted.indexOf("return"), true);
    assert.equal(await area.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd)), "return");
    const after = await area.evaluate((node) => ({
      scroll: node.scrollTop,
      line: node.value.slice(0, node.selectionStart).split("\n").length,
      max: Math.max(0, node.scrollHeight - node.clientHeight),
    }));
    assert.ok(before.scroll > 0);
    const expected = Math.min(after.max, Math.max(0, before.scroll + (after.line - before.line) * before.height));
    assert.ok(Math.abs(after.scroll - expected) < 1);
    await page.locator("#undo").click();
    assert.equal(await area.inputValue(), source);
    assert.equal(await area.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd)), "return");
    await page.locator("#redo").click();
    assert.equal(await area.inputValue(), formatted);

    await area.fill("Constant({ enabled: true })");
    await area.evaluate((node) => {
      const at = node.value.indexOf("true");
      node.focus();
      node.setSelectionRange(at, at + 4);
    });
    await page.keyboard.press("Tab");
    assert.equal(await area.inputValue(), "Constant({ enabled: \t })");
    assert.equal((await page.locator("#gutter").innerText()).includes("02"), false);
    await page.locator("#undo").click();
    assert.equal(await area.inputValue(), "Constant({ enabled: true })");
    assert.equal(await area.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd)), "true");

    await area.fill("Arithmetic({\n\t");
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.press("Control+Space");
    await menu.waitFor({ state: "visible" });
    await page.keyboard.press("Tab");
    assert.equal(await area.inputValue(), "Arithmetic({\n\t\t");
    assert.equal((await area.inputValue()).includes("red_input"), false);
    await area.press("Shift+Tab");
    assert.equal(await area.evaluate((node) => node === document.activeElement), false);
    assert.equal(await area.inputValue(), "Arithmetic({\n\t\t");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("компактное форматирование, каретка и маркер на обоих адресах", { timeout: 90_000 }, async () => {
  const source = "Constant({ enabled: true, signals: [{ signal: Signal.Signals.signal_B, constant: 2 }, { signal: Signal.Signals.signal_A, constant: 1 }] })";
  const expected = `Constant({
	enabled: true,
	signals: [
		{ signal: Signal.Signals.signal_B, constant: 2 },
		{ signal: Signal.Signals.signal_A, constant: 1 }
	]
})
`;
  const typo = "Decider({ when_true: [{ constant: 1, signal: SSignal.Signals.signal_A }], red_input: red_1 })";
  for (const pathname of ["/factorio-ide/", "/factorio-ide/pages/configure/"]) {
    const opened = await openConfigure(1280, pathname);
    const area = opened.page.locator("#document");
    try {
      await area.fill(source);
      await area.evaluate((node) => {
        const at = node.value.indexOf("signal_B");
        node.focus();
        node.setSelectionRange(at, at + "signal_B".length);
      });
      await area.press("Control+Alt+l");
      assert.equal(await area.inputValue(), expected, pathname);
      assert.equal(await area.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd)), "signal_B");
      await opened.page.locator("#undo").click();
      assert.equal(await area.inputValue(), source);
      assert.equal(await area.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd)), "signal_B");
      await opened.page.locator("#redo").click();
      assert.equal(await area.inputValue(), expected);

      await area.fill(typo);
      await opened.page.waitForFunction(() => [...document.querySelectorAll(".fl-editor__paint .err")].some((node) => node.textContent === "SSignal"));
      await area.press("Control+Alt+l");
      await opened.page.waitForFunction(() => {
        const text = document.querySelector("#document")?.value ?? "";
        return text.includes("when_true: [{ signal: SSignal.Signals.signal_A, constant: 1 }]")
          && [...document.querySelectorAll(".fl-editor__paint .err")].some((node) => node.textContent === "SSignal");
      });
      const metrics = await markMetrics(opened.page, "SSignal");
      assert.ok(metrics.dx <= 2, `${pathname}: dx ${metrics.dx}`);
      assert.ok(metrics.dy <= 2, `${pathname}: dy ${metrics.dy}`);
      assert.deepEqual(opened.errors, []);
    } finally {
      await opened.context.close();
    }
  }
});

async function assertHistoryChrome(page, labels) {
  for (const [id, label, tip] of [
    ["undo", "Отменить правку", labels.undo],
    ["redo", "Повторить правку", labels.redo],
  ]) {
    const button = page.locator(`#${id}`);
    assert.equal(await button.getAttribute("aria-label"), label);
    assert.equal((await button.innerText()).trim(), "");
    assert.equal(await button.locator("svg").getAttribute("aria-hidden"), "true");
    assert.equal(await button.evaluate((node) => node.classList.contains("fl-button--icon")), true);
    assert.equal(await button.getAttribute("aria-describedby"), `${id}-tip`);
    const described = page.locator(`#${id}-tip`);
    assert.equal(await described.getAttribute("role"), "tooltip");
    assert.equal((await described.textContent()).trim(), tip);
    assert.equal(await button.isDisabled(), true);
  }
  const order = await page.locator("#toolbar .fl-toolbar__actions button").evaluateAll((nodes) => nodes.map((node) => node.id));
  const reset = order.indexOf("reset");
  assert.equal(order[reset + 1], "undo");
  assert.equal(order[reset + 2], "redo");
}

test("иконки отмены и повтора, tooltip и область хоткеев", { timeout: 90_000 }, async () => {
  for (const pathname of ["/", "/factorio-ide/pages/configure/"]) {
    const opened = await openConfigure(1280, pathname);
    try {
      await assertHistoryChrome(opened.page, {
        undo: "Отменить правку · Ctrl+Z",
        redo: "Повторить правку · Ctrl+Y",
      });
      assert.deepEqual(opened.errors, []);
    } finally {
      await opened.context.close();
    }
  }

  const { page, context, errors } = await openConfigure();
  const area = page.locator("#document");
  try {
    const toolbarBefore = await page.locator("#toolbar").boundingBox();
    await page.locator("#redo").locator("xpath=ancestor::*[@data-tooltip][1]").hover();
    await page.waitForFunction(() => document.querySelector("#redo-tip")?.dataset.open === "true");
    assert.match(await page.locator("#redo-tip").innerText(), /Повторить правку · Ctrl\+Y/);
    const toolbarAfter = await page.locator("#toolbar").boundingBox();
    assert.equal(toolbarAfter.height, toolbarBefore.height);
    assert.equal(toolbarAfter.width, toolbarBefore.width);

    await area.focus();
    await area.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
    const original = await area.inputValue();
    await page.keyboard.type("A");
    const mid = `${original}A`;
    assert.equal(await area.inputValue(), mid);
    await page.keyboard.type("B");
    assert.equal(await page.locator("#undo").isDisabled(), false);
    assert.equal(await page.locator("#redo").isDisabled(), true);
    await page.keyboard.press("Control+Alt+z");
    await page.keyboard.press("Control+Meta+z");
    await page.keyboard.press("Control+Shift+y");
    await area.evaluate((node) => {
      node.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }));
    });
    assert.equal(await area.inputValue(), `${original}AB`);

    await page.keyboard.press("Control+z");
    assert.equal(await area.inputValue(), mid);
    assert.deepEqual(await area.evaluate((node) => [node.selectionStart, node.selectionEnd]), [mid.length, mid.length]);
    await page.keyboard.press("Control+z");
    assert.equal(await area.inputValue(), original);
    assert.equal(await page.locator("#undo").isDisabled(), true);
    assert.equal(await page.locator("#redo").isDisabled(), false);
    await page.keyboard.press("Control+z");
    assert.equal(await area.inputValue(), original);
    await page.keyboard.press("Control+y");
    assert.equal(await area.inputValue(), mid);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+Shift+z");
    assert.equal(await area.inputValue(), mid);
    await page.keyboard.type("C");
    assert.equal(await area.inputValue(), `${mid}C`);
    assert.equal(await page.locator("#redo").isDisabled(), true);
    await page.keyboard.press("Control+y");
    assert.equal(await area.inputValue(), `${mid}C`);
    await page.locator("#undo").click();
    assert.equal(await area.inputValue(), mid);
    await page.keyboard.press("Control+y");
    assert.equal(await area.inputValue(), `${mid}C`);

    await page.locator("#undo").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "undo");
    assert.equal(await page.locator("#undo").evaluate((node) => node.matches(":focus-visible")), true);
    assert.equal(await page.locator("#undo-tip").getAttribute("data-open"), "true");
    const tipBox = await page.locator("#undo-tip").boundingBox();
    const viewport = page.viewportSize();
    assert.ok(tipBox.x >= 0 && tipBox.y >= 0);
    assert.ok(tipBox.x + tipBox.width <= viewport.width + 1);
    assert.ok(tipBox.y + tipBox.height <= viewport.height + 1);
    const toolbarOpen = await page.locator("#toolbar").boundingBox();
    assert.equal(toolbarOpen.height, toolbarBefore.height);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#undo-tip").getAttribute("data-open"), null);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "undo");

    const kept = await area.inputValue();
    const filter = page.locator("#signal-filter");
    await filter.click();
    await page.keyboard.type("zz");
    assert.equal(await filter.inputValue(), "zz");
    await page.keyboard.press("Control+z");
    assert.notEqual(await filter.inputValue(), "zz");
    assert.equal(await area.inputValue(), kept);

    await page.locator("#toolbar").click();
    await page.keyboard.press("Control+z");
    assert.equal(await area.inputValue(), mid);

    const valid = "Constant({ enabled: true, signals: [{ signal: Signal.Logistic.wooden_chest, constant: 1 }] })";
    await area.fill(valid);
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Разбор выполнен");
    await area.fill(valid.replace("constant: 1", "constant: 1.5"));
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Есть диагностика");
    await page.keyboard.press("Control+z");
    assert.equal(await area.inputValue(), valid);
    await page.waitForFunction(() => document.querySelector("#document-state")?.textContent === "Разбор выполнен");
    await page.keyboard.press("Control+y");
    assert.match(await area.inputValue(), /constant: 1\.5/);
    assert.equal(await page.locator("#document-state").textContent(), "Есть диагностика");

    const source = "Arithmetic({ return: Signal.Logistic.wooden_chest, red_input: red_1 })";
    await area.fill(source);
    await area.evaluate((node) => {
      const at = node.value.indexOf("return");
      node.focus();
      node.setSelectionRange(at, at + "return".length);
    });
    await area.press("Control+Alt+l");
    const formatted = await area.inputValue();
    assert.notEqual(formatted, source);
    await page.keyboard.press("Control+z");
    assert.equal(await area.inputValue(), source);
    assert.equal(await area.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd)), "return");
    await page.locator("#redo").click();
    assert.equal(await area.inputValue(), formatted);

    await area.fill("Arithmetic({ red_input: red_limi");
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.press("Tab");
    assert.match(await area.inputValue(), /red_limi\t/);
    await page.keyboard.press("Control+z");
    assert.equal(await area.inputValue(), "Arithmetic({ red_input: red_limi");
    await page.keyboard.press("Control+Shift+z");
    assert.match(await area.inputValue(), /red_limi\t/);

    await area.fill("Arithmetic({\n\t");
    await area.evaluate((node) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.press("Control+Space");
    await page.locator("[data-suggest='caret'] [data-value='red_input']").click();
    const inserted = await area.inputValue();
    assert.match(inserted, /red_input: ,/);
    await page.keyboard.press("Control+z");
    assert.equal(await area.inputValue(), "Arithmetic({\n\t");
    await page.keyboard.press("Control+y");
    assert.equal(await area.inputValue(), inserted);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  const mac = await openConfigure(1280, "/factorio-ide/pages/configure/", "mac");
  try {
    await assertHistoryChrome(mac.page, {
      undo: "Отменить правку · ⌘Z",
      redo: "Повторить правку · ⇧⌘Z",
    });
    const macArea = mac.page.locator("#document");
    await macArea.focus();
    await macArea.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
    const macOriginal = await macArea.inputValue();
    await mac.page.keyboard.type("Q");
    await mac.page.keyboard.press("Control+z");
    await mac.page.keyboard.press("Control+y");
    await mac.page.keyboard.press("Control+Shift+z");
    assert.equal(await macArea.inputValue(), `${macOriginal}Q`);
    await mac.page.keyboard.press("Meta+z");
    assert.equal(await macArea.inputValue(), macOriginal);
    await mac.page.keyboard.press("Shift+Meta+z");
    assert.equal(await macArea.inputValue(), `${macOriginal}Q`);
    assert.deepEqual(mac.errors, []);
  } finally {
    await mac.context.close();
  }

  const windows = await openConfigure(1280, "/factorio-ide/pages/configure/", "windows");
  try {
    await assertHistoryChrome(windows.page, {
      undo: "Отменить правку · Ctrl+Z",
      redo: "Повторить правку · Ctrl+Y",
    });
    assert.deepEqual(windows.errors, []);
  } finally {
    await windows.context.close();
  }
});

const SIGNAL_TYPO = `${"\n".repeat(24)}Constant({
	enabled: true,
	red_output: red_1,
	signals: [{ signal: Signal.Signals.signal_A, constant: 1 }]
})
Decider({
	red_input: red_1,
	red_output: red_1,
	conditions: [{
		left_operand: { red: true, green: false, signal: Signal.Signals.signal_A },
		right_operand: { constant: 59 },
		operation: Decider.Operation.LTE
	}],
	when_true: [{ signal: ${"\t".repeat(36)}SSignal.Signals.signal_A, constant: 1 }]
})`;

async function markMetrics(page, token) {
  return page.evaluate((token) => {
    const area = document.querySelector("#document");
    const mark = [...document.querySelectorAll(".fl-editor__paint .err")].find((node) => node.textContent === token);
    const start = area.value.indexOf(token);
    area.scrollTop = 220;
    area.scrollLeft = 48;
    area.dispatchEvent(new Event("scroll"));
    const host = document.createElement("div");
    const style = getComputedStyle(area);
    const box = area.getBoundingClientRect();
    host.style.position = "fixed";
    host.style.left = `${box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)}px`;
    host.style.top = `${box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)}px`;
    host.style.visibility = "hidden";
    host.style.whiteSpace = "pre";
    host.style.font = style.font;
    host.style.lineHeight = style.lineHeight;
    host.style.tabSize = style.tabSize;
    const probe = document.createElement("span");
    probe.textContent = token;
    host.append(document.createTextNode(area.value.slice(0, start)), probe);
    document.body.append(host);
    const expected = probe.getBoundingClientRect();
    const actual = mark.getBoundingClientRect();
    const paint = document.querySelector(".fl-editor__paint");
    const paintStyle = getComputedStyle(paint);
    host.remove();
    return {
      dx: Math.abs(actual.left - (expected.left - area.scrollLeft)),
      dy: Math.abs(actual.top - (expected.top - area.scrollTop)),
      transform: paint.style.transform,
      scrollTop: area.scrollTop,
      scrollLeft: area.scrollLeft,
      tab: style.tabSize,
      paintTab: paintStyle.tabSize,
      pointer: paintStyle.pointerEvents,
      decoration: getComputedStyle(mark).textDecorationStyle,
      color: getComputedStyle(mark).textDecorationColor,
    };
  }, token);
}

test("ошибка запуска подчёркивается и уходит после исправления", { timeout: 90_000 }, async () => {
  for (const pathname of ["/factorio-ide/", "/factorio-ide/pages/configure/"]) {
    const opened = await openConfigure(1440, pathname);
    try {
      await opened.context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await opened.context.addInitScript((text) => {
        sessionStorage.setItem("f-logic.editor-draft.v1", text);
      }, SIGNAL_TYPO);
      await opened.page.reload();
      await opened.page.waitForFunction(() => document.querySelector("#document")?.value.includes("SSignal.Signals.signal_A")
        && [...document.querySelectorAll(".fl-editor__paint .err")].some((node) => node.textContent === "SSignal"));
      assert.match(await opened.page.locator("#diagnostics").innerText(), /Неизвестный путь/);
      assert.match(await opened.page.locator("#diagnostics").innerText(), /SSignal\.Signals\.signal_A/);
      assert.equal(await opened.page.locator("#play").isDisabled(), true);
      await opened.page.locator("#diagnostics-toggle").focus();
      await opened.page.keyboard.press("Enter");
      const jump = opened.page.locator("#diagnostics [data-jump='true']").first();
      await jump.focus();
      await opened.page.keyboard.press("Enter");
      const selected = await opened.page.locator("#document").evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd));
      assert.equal(selected, "SSignal.Signals.signal_A");
      assert.equal(await opened.page.evaluate(() => document.activeElement?.id), "document");

      await opened.page.setViewportSize({ width: 390, height: 800 });
      const narrow = await opened.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(narrow <= 1, `${pathname}: документ ${narrow}`);
      assert.equal(await opened.page.locator(".fl-editor__paint .err").filter({ hasText: "SSignal" }).count(), 1);
      await opened.page.setViewportSize({ width: 1440, height: 900 });

      const metrics = await markMetrics(opened.page, "SSignal");
      assert.ok(metrics.dx <= 2, `${pathname}: dx ${metrics.dx}`);
      assert.ok(metrics.dy <= 2, `${pathname}: dy ${metrics.dy}`);
      assert.equal(metrics.tab, "2");
      assert.equal(metrics.paintTab, "2");
      assert.equal(metrics.pointer, "none");
      assert.equal(metrics.decoration, "wavy");
      assert.equal(metrics.transform, `translate(${-metrics.scrollLeft}px, ${-metrics.scrollTop}px)`);
      assert.deepEqual(opened.errors, []);
    } finally {
      await opened.context.close();
    }
  }

  const { page, context, errors } = await openConfigure(1280, "/factorio-ide/");
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await context.addInitScript((text) => {
      sessionStorage.setItem("f-logic.editor-draft.v1", text);
    }, SIGNAL_TYPO);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#document")?.value.includes("SSignal"));
    const fixed = SIGNAL_TYPO.replaceAll("SSignal", "Signal");
    await page.locator("#document").fill(fixed);
    await page.waitForFunction(() => document.querySelector("#play") && !document.querySelector("#play").disabled
      && ![...document.querySelectorAll(".fl-editor__paint .err")].some((node) => node.textContent.includes("SSignal")));
    await page.locator("#undo").click();
    await page.waitForFunction(() => [...document.querySelectorAll(".fl-editor__paint .err")].some((node) => node.textContent === "SSignal")
      && document.querySelector("#play")?.disabled);
    await page.locator("#redo").click();
    await page.waitForFunction(() => document.querySelector("#play") && !document.querySelector("#play").disabled);

    const many = `Arithmetic({
  red_input: blue_1,
  left_operand: { red: true, signal: Signal.Signals.signal_A },
  right_operand: { constant: "5" },
  operation: Arithmetic.Operation.SUM,
  return: Signal.Signals.signal_A
})
`;
    await page.locator("#document").evaluate((node, text) => {
      node.focus();
      node.setRangeText(text, 0, node.value.length, "end");
      node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text }));
    }, many);
    await page.waitForFunction(() => {
      const marks = [...document.querySelectorAll(".fl-editor__paint .err")].map((node) => node.textContent);
      return marks.includes("blue_1") && marks.includes("\"5\"") && marks.includes("red") && marks.includes("true");
    });
    assert.equal(await page.locator("#play").isDisabled(), true);
    await page.locator("#document").fill("Arithmetic({ red_input:");
    await page.locator("#document").press("Control+Alt+l");
    await page.waitForFunction(() => document.querySelector(".fl-editor__paint .err-point")
      && ![...document.querySelectorAll(".fl-editor__paint .err")].some((node) => node.textContent === "blue_1"));
    assert.equal(await page.locator("#document").inputValue(), "Arithmetic({ red_input:");
    await page.locator("#diagnostics-toggle").focus();
    await page.keyboard.press("Enter");
    await page.locator("#diagnostics [data-jump='true']").first().focus();
    await page.keyboard.press("Enter");
    const caret = await page.locator("#document").evaluate((node) => ({
      start: node.selectionStart,
      end: node.selectionEnd,
      length: node.value.length,
      active: document.activeElement?.id,
    }));
    assert.equal(caret.start, caret.length);
    assert.equal(caret.end, caret.length);
    assert.equal(caret.active, "document");
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test("подсказка форматирования есть и на корневой странице", { timeout: 60_000 }, async () => {
  const { page, context, errors } = await openConfigure(1280, "/factorio-ide/");
  try {
    assert.match(await page.locator("#document-hint").innerText(), /Tab — отступ, Enter — выбрать подсказку/);
    assert.match(await page.locator("#document-hint").innerText(), /⌥⌘L/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
