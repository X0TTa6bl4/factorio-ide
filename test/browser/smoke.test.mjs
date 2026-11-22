import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { startServer } from "../../dev/server.mjs";

const require = createRequire(process.env.F_LOGIC_DEV_PACKAGE ?? "/opt/f-logic-dev/package.json");
const { chromium } = require("playwright");

test("headless Chromium исполняет ES-модуль и открывает статическую библиотеку", { timeout: 60_000 }, async () => {
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

    await page.goto(`http://127.0.0.1:${port}/dev/smoke/`);
    await page.waitForFunction(() => document.querySelector("#status")?.textContent === "f-logic-smoke-ok");
    assert.equal(await page.locator("#status").textContent(), "f-logic-smoke-ok");

    await page.goto(`http://127.0.0.1:${port}/ui/`);
    await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
