import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { smokeValue } from "../../dev/smoke/app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("smoke-модуль возвращает маркер", () => {
  assert.equal(smokeValue(), "f-logic-smoke-ok");
});

test("статические страницы не требуют Node, Playwright и прикладного сервера", async () => {
  for (const relative of ["dev/smoke/index.html", "ui/index.html"]) {
    const html = await readFile(path.join(root, relative), "utf8");
    assert.match(html, /type="module"/);
    assert.doesNotMatch(html, /playwright/i);
    assert.doesNotMatch(html, /node_modules/);
    assert.doesNotMatch(html, /localhost:\d+/);
  }
  const css = await readFile(path.join(root, "dev/smoke/app.css"), "utf8");
  assert.match(css, /#status/);
});
