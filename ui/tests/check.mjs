import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { startServer } from "./server.mjs";

// Installed inside the Docker image; no host node_modules are needed.
const require = createRequire("/opt/ui-check/package.json");
const { chromium, firefox, webkit } = require("playwright");
const output = process.env.UI_ARTIFACTS ?? "/artifacts";
await mkdir(output, { recursive: true });
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const report = [];
let browser;

async function checkStructure(page) {
  const problem = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    const broken = [];
    for (const attribute of ["for", "aria-labelledby", "aria-describedby", "aria-controls"]) {
      document.querySelectorAll(`[${attribute}]`).forEach(element => {
        for (const id of element.getAttribute(attribute).split(/\s+/)) if (!document.getElementById(id)) broken.push(`${attribute}=${id}`);
      });
    }
    const fitted = document.querySelector(".fl-workspace--fit");
    const scroller = document.scrollingElement;
    let documentScrolls = false;
    if (fitted) {
      const before = scroller.scrollTop;
      scroller.scrollTop = before + 400;
      documentScrolls = scroller.scrollTop > before + 1;
      scroller.scrollTop = before;
    }
    const editor = fitted?.querySelector(".fl-editor");
    const editorBox = editor?.getBoundingClientRect();
    const editorClipped = editorBox
      ? editorBox.height < 48 || editorBox.top < -1 || editorBox.bottom > window.innerHeight + 1
      : false;
    const side = fitted?.querySelector(".fl-workspace__side");
    let sideScrolls = true;
    if (side && side.scrollHeight > side.clientHeight + 1) {
      side.scrollTop = 30;
      sideScrolls = side.scrollTop > 0;
      side.scrollTop = 0;
    }
    return {
      duplicates,
      broken,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      documentScrolls,
      editorClipped,
      sideScrolls,
    };
  });
  assert.deepEqual(problem, {
    duplicates: [],
    broken: [],
    overflow: false,
    documentScrolls: false,
    editorClipped: false,
    sideScrolls: true,
  });
}

async function checkAxe(page, name) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const results = await page.evaluate(async () => {
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
  });
  await writeFile(`${output}/${name}-axe.json`, JSON.stringify(results, null, 2));
  assert.deepEqual(results, [], `${name}: accessibility violations`);
}

try {
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  for (const pathname of ["/ui/", "/factorio-ide/ui/"]) {
    for (const file of ["index.html", "workspace.html"]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.goto(`${base}${pathname}${file}`);
      await page.waitForFunction(() => document.documentElement.dataset.uiReady);
      assert.equal(await page.locator("html").getAttribute("data-ui-ready"), "true");
      for (const width of [320, 390, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await checkStructure(page);
        report.push(`${pathname}${file} @ ${width}: layout OK`);
        if (pathname.includes("factorio") && [390, 1440].includes(width)) {
          const name = file.replace(".html", "");
          await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
          if (width === 1440) await page.screenshot({ path: `${output}/${name}-preview.png` });
          await checkAxe(page, `${name}-${width}`);
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/factorio-ide/ui/`);
  await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true");
  assert.equal(await page.locator("[data-loaded='true']").count(), 26);
  for (const name of ["tooltip", "buttons", "suggest", "network-picker", "code-editor", "editor-inspector"]) {
    await page.locator(`[data-ui="${name}"]`).screenshot({ path: `${output}/${name}.png` });
  }
  await page.getByRole("button", { name: "Тип операнда" }).click();
  await page.getByRole("option", { name: "Константа", exact: true }).click();
  assert.equal(await page.locator("[data-operand-constant]").isVisible(), true);
  assert.equal(await page.locator("[data-operand-signal]").isVisible(), false);
  await page.getByRole("button", { name: "Тип операнда" }).click();
  await page.getByRole("option", { name: "Не задан · null", exact: true }).click();
  assert.equal(await page.locator("[data-operand-null]").isVisible(), true);
  await page.getByRole("button", { name: "Количество" }).click();
  await page.getByRole("option", { name: "Копировать со входа", exact: true }).click();
  assert.equal(await page.locator("[data-output-copy]").isVisible(), true);
  assert.equal(await page.locator("[data-output-fixed]").isVisible(), false);
  await page.locator("[data-network-query]").fill("green_buffer");
  assert.equal(await page.locator("[data-network-name]:visible").count(), 1);
  await page.locator("[data-network-query]").press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("[data-network-query]").inputValue(), "green_buffer1");
  await page.locator("[data-network-query]").fill("green_t");
  assert.deepEqual(await page.locator("[data-network-name]:visible").evaluateAll(nodes => nodes.map(node => node.dataset.networkName)), ["green_t", "green_ta", "green_test"]);
  await page.locator("[data-network-query]").press("Escape");
  assert.equal(await page.locator("[data-network-results]").isHidden(), true);
  assert.equal(await page.locator("[data-network-query]").inputValue(), "green_t");
  await page.locator("[data-network-query]").fill("green_n");
  assert.deepEqual(await page.locator("[data-network-name]:visible").evaluateAll(nodes => nodes.map(node => node.dataset.networkName)), ["green_new"]);
  await page.locator("[data-network-query]").fill("green_limi");
  assert.equal(await page.locator("[data-network-name]:visible").count(), 0);
  assert.equal(await page.locator("[data-network-name]").filter({ hasText: "Создать" }).count(), 0);
  await page.locator("[data-network-query]").press("Tab");
  assert.equal(await page.locator("[data-network-query]").inputValue(), "green_limi");
  assert.equal(await page.locator("[data-network-results]").isHidden(), true);
  assert.equal(await page.locator("[data-network-query]").evaluate(node => node === document.activeElement), false);
  await page.locator("[data-network-query]").fill("green_x");
  await page.locator("#foundation").click({ position: { x: 12, y: 12 } });
  assert.equal(await page.locator("[data-network-results]").isHidden(), true);
  assert.equal(await page.locator("[data-network-query]").inputValue(), "green_x");
  await page.locator("[data-signal-query]").fill("уголь");
  assert.equal(await page.locator("[data-signal-name]:visible").count(), 1);
  await page.locator("[data-signal-name]:visible").click();
  assert.match(await page.locator("[data-signal-selection]").textContent(), /Уголь/);
  await page.locator("[data-signal-query]").fill("no_such_signal");
  assert.equal(await page.locator("[data-signal-empty]").isVisible(), true);
  const tabs = page.getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
  await page.keyboard.press("Home");
  const editor = page.locator(".fl-editor");
  const area = editor.locator("textarea");
  await area.scrollIntoViewIfNeeded();
  const beforeClick = await area.boundingBox();
  await area.click({ position: { x: 24, y: 24 } });
  const afterClick = await area.boundingBox();
  assert.equal(beforeClick.x, afterClick.x);
  assert.equal(beforeClick.y, afterClick.y);
  assert.equal(beforeClick.width, afterClick.width);
  assert.equal(beforeClick.height, afterClick.height);
  assert.equal(await editor.getAttribute("data-focus-source"), "pointer");
  await area.fill("// example");
  assert.match(await page.locator("[data-edit-status]").textContent(), /Изменено/);
  assert.equal(await area.evaluate(node => {
    node.setSelectionRange(0, 5);
    return node.value.slice(node.selectionStart, node.selectionEnd);
  }), "// ex");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await area.evaluate(node => node === document.activeElement), true);
  assert.equal(await editor.getAttribute("data-focus-source"), "keyboard");
  await editor.evaluate(node => {
    const field = node.querySelector("textarea");
    const gutter = node.querySelector(".fl-editor__gutter");
    for (const item of [field, gutter]) {
      item.style.minHeight = "0";
      item.style.height = "120px";
      item.style.maxHeight = "120px";
    }
    field.value = `${"// line\n".repeat(40)}end`;
    gutter.replaceChildren();
    for (let index = 0; index < 40; index += 1) {
      gutter.append(document.createTextNode(String(index + 1).padStart(2, "0")), document.createElement("br"));
    }
    field.dispatchEvent(new Event("input"));
    field.scrollTop = 80;
  });
  assert.ok(await area.evaluate(node => node.scrollTop > 0));
  assert.equal(await editor.locator(".fl-editor__gutter").evaluate(node => node.scrollTop), await area.evaluate(node => node.scrollTop));
  await page.getByRole("button", { name: "t10", exact: true }).click();
  assert.match(await page.locator("[data-timeline-status]").textContent(), /t10/);
  const trigger = page.locator('[data-ui="dialog"] [data-open-dialog]');
  await trigger.click();
  assert.equal(await page.getByRole("dialog").isVisible(), true);
  await checkAxe(page, "dialog");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  await trigger.click();
  await page.getByRole("button", { name: "Создать · демо", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-dialog-feedback]").textContent.includes("green_buffer1"));
  assert.match(await page.locator("[data-dialog-feedback]").textContent(), /green_buffer1/);
  const network = page.getByRole("button", { name: "Сеть примера" });
  await network.evaluate(node => {
    const input = node.closest("[data-select]").querySelector("[data-select-value]");
    input.dataset.changed = "0";
    input.addEventListener("change", () => {
      input.dataset.changed = String(Number(input.dataset.changed) + 1);
    });
  });
  await network.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.match(await network.textContent(), /green_20/);
  assert.equal(await network.evaluate(node => node.closest("[data-select]").querySelector("[data-select-value]").dataset.changed), "1");
  assert.equal(await network.evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  assert.equal(await network.getAttribute("aria-expanded"), "false");
  assert.match(await network.textContent(), /green_20/);
  assert.equal(await network.evaluate(node => node === document.activeElement), true);
  await network.click();
  await page.keyboard.press("Tab");
  assert.equal(await network.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.querySelector("[data-select][data-open='true']") === null), true);
  const catalogSelect = page.getByRole("button", { name: "Каталог сигналов" });
  const beforeMenu = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await catalogSelect.click();
  const list = page.locator("[data-select][data-open='true'] .fl-selectbox__list");
  assert.equal(await list.evaluate(node => node.scrollHeight > node.clientHeight + 1), true);
  const openMenu = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  assert.ok(openMenu.w <= beforeMenu.w + 1);
  assert.ok(openMenu.h <= beforeMenu.h + 1);
  await page.getByRole("searchbox", { name: "Поиск в списке" }).fill("нет такого");
  assert.equal(await page.locator("[data-select][data-open='true'] .fl-selectbox__empty").isVisible(), true);
  await page.getByRole("searchbox", { name: "Поиск в списке" }).fill("жел");
  const openSelect = page.locator("[data-select][data-open='true']");
  assert.equal(await openSelect.getByRole("option", { name: "Железная плита", exact: true }).isVisible(), true);
  assert.equal(await openSelect.getByRole("option", { name: "Уголь", exact: true }).isVisible(), false);
  await page.keyboard.press("Enter");
  assert.match(await catalogSelect.textContent(), /Желез/);
  await catalogSelect.evaluate(node => node.scrollIntoView({ block: "end", inline: "nearest" }));
  await catalogSelect.click();
  const anchored = page.locator("[data-select][data-open='true'] .fl-selectbox__popover");
  const menuBox = await anchored.boundingBox();
  const menuViewport = page.viewportSize();
  assert.ok(menuBox.x >= -1 && menuBox.y >= -1);
  assert.ok(menuBox.x + menuBox.width <= menuViewport.width + 1);
  assert.ok(menuBox.y + menuBox.height <= menuViewport.height + 1);
  assert.equal(await page.getByRole("searchbox", { name: "Поиск в списке" }).evaluate(node => node === document.activeElement), true);
  await page.locator("#foundation").click({ position: { x: 12, y: 12 } });
  assert.equal(await catalogSelect.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.closest(".fl-selectbox__popover") == null), true);
  const hints = page.getByRole("button", { name: "Подсказки", exact: true });
  const beforeSuggest = await page.evaluate(() => document.documentElement.scrollHeight);
  await hints.click();
  const suggest = page.locator("[data-suggest='popup']");
  assert.equal(await suggest.evaluate(node => node.scrollHeight > node.clientHeight + 1), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight) <= beforeSuggest + 1);
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.match(await page.locator("[data-suggest-status]").textContent(), /Выбрано: Constant/);
  assert.equal(await suggest.isVisible(), false);
  assert.equal(await hints.evaluate(node => node === document.activeElement), true);
  const toggle = page.getByRole("button", { name: "Панель с содержимым", exact: true });
  const inside = page.getByRole("button", { name: "Внутри панели", exact: true });
  await inside.focus();
  await toggle.evaluate(node => node.click());
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await inside.isVisible(), false);
  assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
  const gt = page.locator("[aria-label='Операции Decider'] [data-value='Decider.Operation.GT']");
  assert.equal((await gt.locator(".fl-muted").textContent()).trim(), ">");
  assert.doesNotMatch(await gt.innerText(), /Operation/);
  const segment = page.locator("[aria-label='Сегменты Signal.Logistic'] [data-value='Signal.Logistic.wooden_chest']");
  assert.equal((await segment.innerText()).trim(), "wooden_chest");
  assert.doesNotMatch(await page.locator("[aria-label='Разделы Signal']").innerText(), /Signal\./);
  assert.deepEqual(await page.locator("[aria-label='Параметры пустого объекта'] [role='option']").evaluateAll(nodes => nodes.map(node => node.dataset.value)), ["red_input", "green_input", "red_output", "green_output", "left_operand", "right_operand", "operation", "return"]);
  assert.match(await page.locator("[aria-label='Каркас многострочного объекта']").innerText(), /Arithmetic\(\{/);
  assert.match(await page.locator("[id$='editor-keys']").innerText(), /Tab/);
  const undo = page.locator("[data-ui='buttons']").getByRole("button", { name: "Отменить правку", exact: true });
  await undo.hover();
  const undoTip = page.locator(`[id="${await undo.getAttribute("aria-describedby")}"]`);
  assert.equal(await undoTip.getAttribute("role"), "tooltip");
  assert.equal(await undoTip.getAttribute("data-open"), "true");
  assert.match(await undoTip.textContent(), /Отменить правку/);
  const undoBox = await undoTip.boundingBox();
  const tipViewport = page.viewportSize();
  assert.ok(undoBox.x >= -1 && undoBox.y >= -1);
  assert.ok(undoBox.x + undoBox.width <= tipViewport.width + 1);
  assert.ok(undoBox.y + undoBox.height <= tipViewport.height + 1);
  await undo.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  assert.equal(await undoTip.getAttribute("data-open"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await undoTip.getAttribute("data-open"), null);
  assert.equal(await undo.evaluate(node => node === document.activeElement), true);
  const disabledRedo = page.locator("[data-ui='buttons']").getByRole("button", { name: "Повторить правку", exact: true, disabled: true });
  assert.equal(await disabledRedo.getAttribute("aria-label"), "Повторить правку");
  await page.locator("[data-ui='buttons'] [data-tooltip]:has(button:disabled)").hover();
  const disabledTip = page.locator(`[id="${await disabledRedo.getAttribute("aria-describedby")}"]`);
  assert.equal(await disabledTip.getAttribute("data-open"), "true");
  assert.match(await disabledTip.textContent(), /Повторить правку/);
  const longTipButton = page.locator("[data-ui='buttons']").getByRole("button", { name: "Длинное описание правки", exact: true });
  await longTipButton.evaluate(node => node.scrollIntoView({ block: "end", inline: "nearest" }));
  await longTipButton.hover();
  const longTip = page.locator(`[id="${await longTipButton.getAttribute("aria-describedby")}"]`);
  const longBox = await longTip.boundingBox();
  assert.ok(longBox.width > 40 && longBox.height > 16);
  assert.ok(longBox.x >= -1 && longBox.y >= -1);
  assert.ok(longBox.x + longBox.width <= tipViewport.width + 1);
  assert.ok(longBox.y + longBox.height <= tipViewport.height + 1);
  const inspector = page.locator("[data-ui='editor-inspector']");
  assert.deepEqual((await inspector.locator("h2").allTextContents()).map(text => text.trim()), ["Сети", "Диагностика"]);
  const diagnostics = inspector.getByRole("button", { name: "Диагностика", exact: true });
  const insideDiagnostics = inspector.getByRole("button", { name: "Внутри диагностики", exact: true });
  assert.equal(await diagnostics.getAttribute("aria-expanded"), "false");
  assert.equal(await insideDiagnostics.isVisible(), false);
  await diagnostics.click();
  assert.equal(await diagnostics.getAttribute("aria-expanded"), "true");
  assert.equal(await inspector.locator(".fl-signal-scroll").evaluate(node => node.scrollHeight > node.clientHeight + 1), true);
  assert.equal(await page.evaluate(() => {
    const scroller = document.scrollingElement;
    const before = scroller.scrollTop;
    scroller.scrollTop = before + 400;
    const moved = scroller.scrollTop > before + 1;
    scroller.scrollTop = before;
    return moved;
  }), false);
  await insideDiagnostics.focus();
  await diagnostics.evaluate(node => node.click());
  assert.equal(await diagnostics.getAttribute("aria-expanded"), "false");
  assert.equal(await insideDiagnostics.isVisible(), false);
  assert.equal(await diagnostics.evaluate(node => node === document.activeElement), true);
  const collapsed = page.getByRole("button", { name: "Свёрнутая панель", exact: true });
  await collapsed.focus();
  await page.keyboard.press("Enter");
  assert.equal(await collapsed.getAttribute("aria-expanded"), "true");
  await page.keyboard.press(" ");
  assert.equal(await collapsed.getAttribute("aria-expanded"), "false");
  const disabledSelect = page.getByRole("button", { name: "Скорость просмотра" });
  assert.equal(await disabledSelect.isDisabled(), true);
  await disabledSelect.click({ force: true });
  assert.equal(await disabledSelect.getAttribute("aria-expanded"), "false");
  await page.locator('[data-ui="buttons"] .fl-source summary').click();
  assert.equal(await page.locator('[data-ui="buttons"] .fl-source code').isVisible(), true);
  await page.locator('[data-ui="buttons"] .fl-source').evaluate(element => { element.open = false; });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200%; } body { font-size: 28px; }" });
  await checkStructure(page);
  report.push("Chromium: component interactions, keyboard, modal focus, source, 200% text OK");
  await page.close();
  for (const [width, height] of [[320, 600], [390, 600], [768, 600], [1024, 600], [1440, 600], [1440, 900]]) {
    const fitted = await browser.newPage({ viewport: { width, height } });
    await fitted.goto(`${base}/factorio-ide/ui/workspace.html`);
    await fitted.waitForFunction(() => document.documentElement.dataset.uiReady === "true");
    await checkStructure(fitted);
    const launch = await fitted.getByRole("button", { name: "Запустить" }).boundingBox();
    assert.ok(launch.y >= -1 && launch.y + launch.height <= height + 1, `launch clipped at ${width}x${height}`);
    const codeBox = await fitted.locator(".fl-editor-stage .fl-editor").boundingBox();
    const inspectorBox = await fitted.locator(".fl-editor-inspector").boundingBox();
    if (width <= 900) assert.ok(inspectorBox.y >= codeBox.y + codeBox.height - 8, `inspector not below code at ${width}x${height}`);
    else assert.ok(inspectorBox.x >= codeBox.x + codeBox.width - 8, `inspector not right of code at ${width}x${height}`);
    if ((width === 1440 && height === 900) || (width === 390 && height === 600)) {
      await fitted.screenshot({ path: `${output}/workspace-inspector-${width}x${height}.png` });
    }
    report.push(`workspace fit ${width}x${height} OK`);
    await fitted.close();
  }
  await browser.close();
  browser = undefined;

  for (const [name, engine] of [["Firefox", firefox], ["WebKit", webkit]]) {
    browser = await engine.launch();
    for (const file of ["index.html", "workspace.html"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
      await page.goto(`${base}/factorio-ide/ui/${file}`);
      await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true");
      await checkStructure(page);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await checkStructure(page);
      report.push(`${name}: ${file}, 390/1440 layout OK`);
      await page.close();
    }
    await browser.close();
    browser = undefined;
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(report.join("\n"));
  console.log("UI checks passed; screenshots and axe reports in " + output);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
