import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildCatalog } from "../../../tools/signal-catalog/build.mjs";
import { loadSnapshot } from "../../../tools/signal-catalog/load.mjs";

const root = new URL("../../../", import.meta.url);
const loaded = await loadSnapshot(fileURLToPath(new URL("data/factorio/2.1.24/", root)), "data/factorio/2.1.24");
const built = buildCatalog(loaded, { snapshot: {}, inputs: [], generator: [] });
const evidenceDir = new URL("data/evidence/runtime-2.1.24-2026-11-18/", root);
const manifest = JSON.parse(await readFile(new URL("manifest.json", evidenceDir), "utf8"));

test("runtime-свидетельство: версия, архив, файлы и исходники probe зафиксированы", async () => {
  assert.equal(manifest.gameVersion, loaded.manifest.gameVersion);
  assert.equal(manifest.archiveSha256, loaded.manifest.archiveSha256);
  assert.equal(manifest.menuConfirmed, false);
  for (const entry of manifest.outputs) {
    const bytes = await readFile(new URL(entry.path, evidenceDir));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path);
  }
  for (const entry of manifest.probeSources) {
    const bytes = await readFile(new URL(entry.path, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.path);
  }
});

for (const profile of ["base", "space-age"]) {
  const runtime = JSON.parse(await readFile(new URL(`data/evidence/runtime-2.1.24-2026-11-18/${profile}.json`, root), "utf8"));
  const byId = new Map(runtime.rows.map(row => [row.id, row]));
  const document = built.profiles[profile];

  test(`runtime 2.1.24 ${profile}: исходное множество и официальный профиль совпадают`, () => {
    assert.equal(runtime.activeMods.base, "2.1.24");
    assert.equal(runtime.activeMods["f-logic-catalog-probe"], "0.1.0");
    const official = Object.keys(runtime.activeMods).filter(name => name !== "f-logic-catalog-probe").sort();
    assert.deepEqual(official, profile === "base" ? ["base"] : ["base", "elevated-rails", "quality", "recycler", "space-age"].sort());
    assert.equal(byId.size, runtime.rows.length);
    assert.deepEqual([...byId.keys()].sort(), document.rows.map(row => row.prototypeId).sort());
  });

  test(`runtime 2.1.24 ${profile}: видимость обычных рецептов, включая rocket-part`, () => {
    for (const row of document.rows.filter(row => row.gameType === "recipe" && row.role === "ordinary")) {
      const actual = byId.get(row.prototypeId).hideFromSignalGui;
      assert.equal(actual.status, "present", row.prototypeId);
      assert.equal(row.signalSelection.state, actual.value ? "hidden" : "selectable", row.prototypeId);
    }
    const rocket = byId.get("recipe/rocket-part");
    assert.equal(rocket.hideFromSignalGui.value, false);
    assert.equal(rocket.group.value, profile === "base" ? "intermediate-products" : "space");
    assert.equal(rocket.subgroup.value, profile === "base" ? "intermediate-product" : "space-interactors");
    const rocketRow = document.rows.find(row => row.prototypeId === "recipe/rocket-part");
    assert.equal(rocketRow.publicPath, profile === "base" ? "Signal.Intermediate.rocket_part" : "Signal.Space.rocket_part");
    for (const row of document.rows.filter(row => row.sources.recipeDefaults)) {
      const actual = byId.get(row.prototypeId);
      for (const field of row.sources.recipeDefaults.fields) {
        const value = field === "subgroup" ? row.subgroup.id : row.prototypeOrder.value;
        assert.equal(value, actual[field].value, `${row.prototypeId}.${field}`);
      }
    }
  });

  if (profile === "space-age") {
    test("runtime 2.1.24: четыре asteroid-chunk скрыты из меню и имеют предметный alias", () => {
      for (const name of ["metallic", "carbonic", "oxide", "promethium"]) {
        const gameName = `${name}-asteroid-chunk`;
        const chunk = byId.get(`asteroid-chunk/${gameName}`);
        assert.deepEqual(chunk.hideFromSignalGui, { status: "present", value: true });
        assert.deepEqual(chunk.itemSignalAlias, { status: "present", value: gameName });
        assert.equal(document.rows.find(row => row.prototypeId === `item/${gameName}`).publicPath, `Signal.Space.${name}_asteroid_chunk`);
      }
    });
    test("runtime: выбор сущности на карте не равен выбору сигнала в chooser", () => {
      assert.equal(byId.get("entity/cliff").selectableInGame.value, false);
      assert.equal(byId.get("entity/lightning-rod-remnants").selectableInGame.value, true);
      assert.equal(byId.get("entity/demolisher-ash-sticker").hidden.value, true);
    });
  }
}
