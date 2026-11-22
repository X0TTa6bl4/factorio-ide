/** Примеры руководства: разбор и границы тиков, ошибочные фрагменты дают ожидаемый код. */

import assert from "node:assert/strict";
import test from "node:test";
import { createConfigurationEditor } from "../../../src/config-editor.js";
import { DOC_GROUPS, DOC_SAMPLES, docArticles } from "../../../pages/docs/content.js";
import { RELEASE_NOTE } from "../../../pages/release.js";

function signalAt(publication, network, signal) {
  const row = publication.networks.find((item) => item.name === network);
  assert.ok(row, network);
  const hit = row.signals.find((item) => item.name === signal);
  return hit ? hit.constant : null;
}

test("запускаемые примеры руководства дают записанные границы", async () => {
  for (const [id, sample] of Object.entries(DOC_SAMPLES)) {
    const editor = createConfigurationEditor({ text: sample.text });
    if (sample.diagnostic) {
      const launched = await editor.launch();
      assert.equal(launched.applied, false, id);
      assert.equal(editor.diagnostics.some((item) => item.code === sample.diagnostic), true, `${id}: ${editor.diagnostics.map((item) => item.code).join(",")}`);
      continue;
    }
    const launched = await editor.launch();
    assert.equal(launched.applied, true, `${id}: ${editor.diagnostics.map((item) => item.message).join("; ")}`);
    let tick = editor.publication().tick;
    for (;;) {
      for (const item of sample.expect.filter((entry) => entry.tick === tick)) {
        const actual = signalAt(editor.publication(), item.network, item.signal);
        if (item.absent) assert.equal(actual, null, `${id} граница ${tick} ${item.network} ${item.signal}`);
        else assert.equal(actual, item.value, `${id} граница ${tick} ${item.network} ${item.signal}`);
      }
      if (tick >= sample.steps) break;
      const stepped = await editor.step();
      assert.equal(stepped.applied, true, `${id} шаг ${tick}`);
      tick = stepped.tick;
    }
  }
});

test("якоря и примеры статей существуют, руководство не копирует Laravel", () => {
  const articles = docArticles();
  const ids = new Set(articles.flatMap((article) => [article.slug, `${article.slug}-also`, ...article.sections.map((section) => section.id)]));
  const targets = new Set();
  const walk = (value) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/data-doc-target="([^"]+)"/g)) targets.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.target === "string") targets.add(value.target);
    if (typeof value.sample === "string") assert.ok(DOC_SAMPLES[value.sample], value.sample);
    Object.values(value).forEach(walk);
  };
  walk(DOC_GROUPS);
  for (const target of targets) assert.equal(ids.has(target), true, target);
  const text = JSON.stringify(articles);
  assert.equal(text.includes(RELEASE_NOTE), true);
  assert.match(text, /Ctrl\+Alt\+L/);
  assert.match(text, /⌥⌘L/);
  assert.match(text, /Tab — отступ/);
  assert.doesNotMatch(text, /совместимо с Factorio/);
  assert.doesNotMatch(text, /Laravel|<\?php|ui\/index\.html/);
  assert.equal(articles.some((article) => article.slug === "compatibility"), true);
  assert.equal(articles.some((article) => article.slug === "editor"), true);
});
