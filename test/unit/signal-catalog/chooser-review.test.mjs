import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { buildProfile } from "../../../tools/signal-catalog/build.mjs";
import { reviewMembership } from "../../../tools/signal-catalog/chooser-review.mjs";
import { parseArgs } from "../../../tools/signal-catalog/cli.mjs";
import { SECTIONS } from "../../../tools/signal-catalog/names.mjs";
import { expectCode, record, row, source } from "./support.mjs";

function review(entries = {}) {
  return {
    schemaVersion: 1, gameVersion: "2.1.24", profile: "base", source: "fixture/returned.blueprint.txt",
    sections: SECTIONS.map((section, index) => ({ index: index + 1, section: section.section, prototypeIds: entries[section.section] ?? [] })),
  };
}

function build(records, checked) {
  return buildProfile({ ...source(records), chooserReview: checked });
}

test("сверка: удаление публичного пути сохраняет сырую запись, добавление не выдумывает группу", () => {
  const kept = record({ name: "wooden-chest" });
  const removed = record({ type: "entity", name: "1x2-remnants", subgroup: "generic-remnants" });
  const added = record({ type: "entity", name: "entity-ghost" });
  delete added.subgroup;
  const document = build([removed, kept, added], review({ Logistic: [kept.id], Unsorted: [added.id] }));
  assert.equal(document.rows.length, 3);
  assert.equal(row(document, removed.id).publicPath, null);
  assert.equal(row(document, removed.id).hidden.value, false);
  assert.equal(row(document, removed.id).pathReason, "chooser-review-removed");
  assert.equal(row(document, removed.id).channel, false);
  assert.equal(row(document, kept.id).publicPath, "Signal.Logistic.wooden_chest");
  assert.equal(row(document, added.id).publicPath, "Signal.Unsorted.entity_ghost");
  assert.equal(row(document, added.id).group.status, "absent");
  assert.equal(row(document, added.id).chooserReview.state, "included");
  assert.equal(document.chooserReview.signals, 2);
  assert.equal(document.chooserReview.fullGuiCoverage, "not-recorded");
});

test("сверка не теряет вложенные пути рецептов бочек", () => {
  const item = record({ name: "water-barrel", subgroup: "barrel" });
  const recipe = record({ type: "recipe", name: "water-barrel", subgroup: "fill-barrel", hide_from_signal_gui: false, localised_name: ["recipe-name.fill-barrel"] });
  const checked = review({ Intermediate: [item.id, recipe.id] });
  assert.equal(row(build([item, recipe], checked), recipe.id).publicPath, "Signal.Intermediate.water_barrel.fill");
  expectCode(() => build([item, recipe], review({ Intermediate: [recipe.id] })), "schema");
});

test("сверка отвергает чужую версию, неполные вкладки, дубли и неизвестные ключи", () => {
  const valid = review();
  const check = value => reviewMembership(value, "2.1.24", "base");
  expectCode(() => check(null), "provenance");
  expectCode(() => check({ ...valid, gameVersion: "2.1.25" }), "provenance");
  expectCode(() => check({ ...valid, profile: "space-age" }), "provenance");
  expectCode(() => check({ ...valid, source: "" }), "schema");
  expectCode(() => check({ ...valid, sections: [] }), "schema");
  const duplicateTab = review();
  duplicateTab.sections[1] = duplicateTab.sections[0];
  expectCode(() => check(duplicateTab), "schema");
  const wrongIndex = review();
  wrongIndex.sections[0].index = 0;
  expectCode(() => check(wrongIndex), "schema");
  const wrongName = review();
  wrongName.sections[0].section = "Unsorted";
  expectCode(() => check(wrongName), "schema");
  expectCode(() => check(review({ Logistic: ["item/wood", "item/wood"] })), "schema");
  expectCode(() => check(review({ Logistic: ["bad-key"] })), "schema");
  expectCode(() => build([], review({ Logistic: ["item/unknown"] })), "provenance");
  expectCode(() => build([record({ name: "wood" })], review({ Unsorted: ["item/wood"] })), "provenance");
  expectCode(() => build([record({ type: "virtual", name: "signal-each", role: "logic-selector" })], review({ Signals: ["virtual/signal-each"] })), "schema");
  const a = record({ name: "a-b" }), b = record({ name: "a_b" });
  expectCode(() => build([a, b], review({ Logistic: [a.id] })), "schema");
});

test("CLI принимает явную сверку и отвергает повтор/пропущенное значение", () => {
  assert.deepEqual(parseArgs(["--snapshot", "snap", "--out", "out", "--chooser-review", "review.json"]), { snapshot: "snap", out: "out", review: "review.json" });
  expectCode(() => parseArgs(["--snapshot", "snap", "--out", "out", "--chooser-review"]), "usage");
  expectCode(() => parseArgs(["--chooser-review", "one", "--chooser-review", "two"]), "usage");
});

test("пользовательский экспорт: 693 игровых ключа, 185 удалений, 5 добавлений, десять групп", async () => {
  const dir = new URL("../../../data/evidence/constant-combinator-review-2026-11-18/", import.meta.url);
  const bytes = await readFile(new URL("returned.blueprint.txt", dir));
  const checked = JSON.parse(await readFile(new URL("review.json", dir), "utf8"));
  const diff = JSON.parse(await readFile(new URL("diff.json", dir), "utf8"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), checked.sourceSha256);
  const decoded = JSON.parse(inflateSync(Buffer.from(bytes.toString().trim().slice(1), "base64")));
  assert.equal(decoded.blueprint.entities.length, 1);
  assert.equal(decoded.blueprint.version, 562954249961473);
  const tabs = decoded.blueprint.entities[0].control_behavior.sections.sections;
  assert.equal(tabs.length, 10);
  const expected = new Set(tabs.flatMap(tab => tab.filters.map(filter => `${filter.type ?? "item"}/${filter.name}`)));
  assert.equal(expected.size, 693);
  assert.deepEqual(new Set(reviewMembership(checked, "2.1.24", "space-age").keys()), expected);
  assert.equal(diff.added.length, 5);
  assert.equal(diff.removed.length, 185);
  assert.equal(diff.sections[8].after, 79);
  assert.equal(diff.sections[9].after, 20);
  const catalog = JSON.parse(await readFile(new URL("../../../data/signal-catalog/2.1.24/space-age.json", import.meta.url), "utf8"));
  const exported = catalog.rows.filter(row => row.publicPath && row.role === "ordinary");
  assert.deepEqual(new Set(exported.map(row => row.prototypeId)), expected);
  for (const section of checked.sections) {
    assert.deepEqual(new Set(exported.filter(row => row.publicSection === section.section).map(row => row.prototypeId)), new Set(section.prototypeIds));
  }
});
