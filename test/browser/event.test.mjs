import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startServer } from "../../dev/server.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

test("браузер исполняет сценарий в настоящем Worker и прерывает зависание", { timeout: 60_000 }, async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const port = server.address().port;
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/test/browser/event/`);
    await page.waitForFunction(() => {
      const text = document.querySelector("#status")?.textContent ?? "";
      return text.startsWith("2,5,5,2") || text.startsWith("fail:");
    });
    assert.equal(await page.locator("#status").textContent(), "2,5,5,2|async-main|timeout:0:alive");
    assert.equal(await page.locator("#alive").textContent(), "alive");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
