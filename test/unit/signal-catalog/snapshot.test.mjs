import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../../../tools/signal-catalog/build.mjs";
import { main, provenanceFor } from "../../../tools/signal-catalog/cli.mjs";
import { TYPE_FILES } from "../../../tools/signal-catalog/expected.mjs";
import { loadGenerator, loadSnapshot } from "../../../tools/signal-catalog/load.mjs";
import { allFiles } from "../../../tools/signal-catalog/outputs.mjs";
import { renderReview } from "../../../tools/signal-catalog/review.mjs";
import { publicName } from "../../../tools/signal-catalog/names.mjs";
import { mountSignals, readSignal } from "../../../tools/signal-catalog/tree.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const snapshotArg = "data/factorio/2.1.24";
const reviewArg = "data/evidence/constant-combinator-review-2026-11-18/review.json";
const catalogDir = path.join(root, "data/signal-catalog/2.1.24");

function dot(publicPath) {
  const fn = new Function("Signal", `return ${publicPath};`);
  const parts = publicPath.split(".").slice(1);
  const root = {};
  let node = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    node[parts[index]] = {};
    node = node[parts[index]];
  }
  node[parts[parts.length - 1]] = "ok";
  return fn(root);
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== "object") return value;
  const copy = {};
  for (const key of Object.keys(value).reverse()) copy[key] = reverseKeys(value[key]);
  return copy;
}

function row(document, id) {
  return document.rows.find((item) => item.prototypeId === id);
}

let loaded;
let built;
let files;

test.before(async () => {
  loaded = await loadSnapshot(path.join(root, snapshotArg), snapshotArg, path.join(root, reviewArg), reviewArg);
  const generator = await loadGenerator(root);
  built = buildCatalog(loaded, provenanceFor(loaded, snapshotArg, generator));
  files = allFiles(built);
});

test("CAT-01 CAT-24 каждый исходный ID учтён один раз", () => {
  assert.equal(built.coverage.menuConfirmed, false);
  assert.equal(built.collisions.resolved, true);
  for (const profile of ["base", "space-age"]) {
    const input = loaded.profiles[profile].records.map((record) => record.id);
    const output = built.profiles[profile].rows.map((item) => item.prototypeId);
    assert.equal(output.length, input.length);
    assert.deepEqual(new Set(output), new Set(input));
    assert.equal(new Set(output).size, output.length);
    for (const type of Object.keys(TYPE_FILES)) {
      const count = output.filter((id) => id.startsWith(`${type}/`)).length;
      assert.equal(count, loaded.manifest.profiles[profile].counts[type], `${profile} ${type}`);
    }
  }
  assert.equal(built.profiles.base.rows.length, 1218);
  assert.equal(built.profiles["space-age"].rows.length, 2249);
  assert.deepEqual(built.coverage.profiles.base.excluded, {
    technical: 332,
    "subgroup-absent": 100,
    "not-selectable": 176,
    "blueprint-parameter": 40,
  });
  assert.deepEqual(built.coverage.profiles["space-age"].excluded, {
    technical: 933,
    "subgroup-absent": 127,
    "not-selectable": 251,
    "blueprint-parameter": 50,
    "chooser-blueprint-item": 4,
    "chooser-observation-item-only": 1,
    "project-item-only": 1,
    "chooser-review-removed": 185,
  });
  assert.equal(built.coverage.profiles.base.exported, 570);
  assert.equal(built.coverage.profiles["space-age"].exported, 697);
});

test("CAT-02 CAT-06 CAT-09 контрольные имена и разные типы wooden-chest", () => {
  for (const profile of ["base", "space-age"]) {
    const document = built.profiles[profile];
    const chest = row(document, "item/wooden-chest");
    assert.equal(chest.publicPath, "Signal.Logistic.wooden_chest");
    assert.equal(chest.gameType, "item");
    assert.equal(chest.gameName, "wooden-chest");
    assert.equal(chest.channel, true);
    assert.equal(chest.label.en.text, "Wooden chest");
    assert.equal(chest.label.ru.text, "Деревянный сундук");
    assert.equal(chest.icon.png, "missing");
    assert.equal(chest.stackSize.status, "present");
    assert.equal(Object.hasOwn(chest, "rocketCapacity"), false);
    const recipe = row(document, "recipe/wooden-chest");
    const entity = row(document, "entity/wooden-chest");
    assert.equal(recipe.publicPath, null);
    assert.equal(recipe.recipeHideFromSignalGui.value, null);
    assert.equal(recipe.signalSelection.state, "hidden");
    assert.equal(entity.publicPath, null);
    assert.equal(entity.pathReason, "subgroup-absent");
    assert.notEqual(recipe.prototypeId, chest.prototypeId);
    const letter = row(document, "virtual/signal-A");
    assert.equal(letter.publicPath, "Signal.Signals.signal_A");
    assert.equal(letter.gameName, "signal-A");
    for (const name of ["signal-each", "signal-everything", "signal-anything"]) {
      const meta = row(document, `virtual/${name}`);
      assert.equal(meta.publicPath, `Signal.Meta.${name.replaceAll("-", "_")}`);
      assert.equal(meta.channel, false);
      assert.equal(meta.role, "meta");
    }
    const remnants = row(document, "entity/1x2-remnants");
    assert.equal(remnants.publicPath, profile === "base" ? "Signal.Environment.remnants_1x2" : null);
    if (profile === "space-age") assert.equal(remnants.pathReason, "chooser-review-removed");
    assert.equal(remnants.gameName, "1x2-remnants");
    assert.equal(remnants.nameCheck.kind, "identifier");
    assert.equal(row(document, "item/loader").role, "technical");
    assert.equal(row(document, "item/parameter-0").role, "blueprint-parameter");
    assert.equal(row(document, "item/firearm-magazine").weight.value, 10000);
  }
  assert.equal(row(built.profiles.base, "virtual/signal-any-quality"), undefined);
  const anyQuality = row(built.profiles["space-age"], "virtual/signal-any-quality");
  assert.equal(anyQuality.role, "quality-selector");
  assert.equal(anyQuality.channel, false);
  assert.equal(anyQuality.publicPath, "Signal.Unsorted.signal_any_quality");
  assert.equal(row(built.profiles.base, "quality/normal").role, "technical");
  assert.equal(row(built.profiles["space-age"], "quality/normal").publicPath, "Signal.Unsorted.normal");
  assert.equal(row(built.profiles["space-age"], "quality/legendary").publicPath, "Signal.Unsorted.legendary");
});

test("CAT-03 CAT-07 CAT-20 CAT-21 пути однозначны, профили не склеены", () => {
  assert.deepEqual(built.profileDiff.removed, ["item/satellite", "recipe/satellite"]);
  assert.equal(built.profileDiff.added.length, 1033);
  assert.equal(built.profileDiff.changed.length > 0, true);
  const changedIds = new Set(built.profileDiff.changed.map((item) => item.prototypeId));
  for (const id of built.profileDiff.removed) assert.equal(changedIds.has(id), false);
  for (const id of built.profileDiff.added) assert.equal(changedIds.has(id), false);
  const sample = built.profileDiff.changed[0];
  const fieldName = sample.fields[0];
  assert.notEqual(
    JSON.stringify(row(built.profiles.base, sample.prototypeId)[fieldName]),
    JSON.stringify(row(built.profiles["space-age"], sample.prototypeId)[fieldName]),
  );
  for (const profile of ["base", "space-age"]) {
    const seen = new Map();
    for (const item of built.profiles[profile].rows) {
      if (!item.publicPath) continue;
      assert.equal(seen.has(item.publicPath), false, item.publicPath);
      seen.set(item.publicPath, item.prototypeId);
      assert.equal(dot(item.publicPath), "ok");
      assert.equal(item.publicPath.includes("$"), false);
      assert.equal(item.channel, item.role === "ordinary");
    }
    const paths = JSON.parse(files[`${profile}-paths.json`]).paths;
    assert.equal(Object.keys(paths).length, seen.size);
    const tree = mountSignals(paths);
    for (const [publicPath, target] of Object.entries(paths)) {
      assert.equal(seen.get(publicPath), target.prototypeId);
      assert.equal(target.gameType, publicPath && row(built.profiles[profile], target.prototypeId).gameType);
      assert.equal(target.gameName, row(built.profiles[profile], target.prototypeId).gameName);
      assert.equal(readSignal(tree, publicPath).prototypeId, target.prototypeId);
      assert.equal(publicPath.split(".").length >= 3, true);
    }
    for (const collision of built.collisions.profiles[profile]) {
      assert.equal(collision.records.length > 1, true);
      for (const record of collision.records) {
        assert.equal(row(built.profiles[profile], record.prototypeId).publicPath, null);
      }
    }
  }
  assert.deepEqual(built.collisions.profiles.base.map((item) => item.candidatePath), []);
  assert.deepEqual(built.collisions.profiles["space-age"].map((item) => item.candidatePath), []);
  for (const id of ["item/wooden-chest", "virtual/signal-A", "item/iron-plate"]) {
    const left = row(built.profiles.base, id);
    const right = row(built.profiles["space-age"], id);
    if (left.publicPath && right.publicPath) assert.equal(left.publicPath, right.publicPath);
  }
});

test("CAT-12 CAT-13 CAT-14 CAT-16 CAT-17 подписи, качество и иконки не подменены", () => {
  for (const profile of ["base", "space-age"]) {
    const unresolved = built.profiles[profile].rows.filter((item) => item.label.en.status === "unresolved");
    assert.equal(unresolved.length, built.coverage.profiles[profile].unresolvedLabels.en);
    assert.equal(unresolved.length > 0, true);
    assert.equal(unresolved[0].label.en.source, "unresolved");
    assert.equal(unresolved[0].sources.label, "snapshot");
    const qualities = built.profiles[profile].rows.filter((item) => item.gameType === "quality");
    assert.equal(qualities.length, loaded.manifest.profiles[profile].counts.quality);
    const table = JSON.parse(files[`${profile}-qualities.json`]);
    assert.equal(table.entries.length, qualities.length);
  }
  assert.deepEqual(JSON.parse(files["space-age-qualities.json"]).missingLevels, [4]);
  assert.deepEqual(JSON.parse(files["space-age-qualities.json"]).observedOrdinaryLevels, [0, 1, 2, 3, 5]);
  assert.deepEqual(JSON.parse(files["base-qualities.json"]).observedOrdinaryLevels, []);
  const barrel = row(built.profiles.base, "item/water-barrel");
  assert.equal(barrel.localisedName.status, "present");
  assert.equal(Array.isArray(barrel.localisedName.value), true);
  assert.equal(barrel.publicPath, "Signal.Intermediate.water_barrel");
  assert.equal(row(built.profiles.base, "recipe/water-barrel").publicPath, "Signal.Intermediate.water_barrel.fill");
  assert.equal(row(built.profiles.base, "recipe/water-barrel").recipeHideFromSignalGui.value, false);
  const plain = built.profiles.base.rows.find((item) => item.icon.status === "absent");
  assert.equal(plain === undefined, false);
  assert.equal(built.profiles.base.rows.includes(plain), true);
});

test("CAT-25 CAT-26 CAT-27 CAT-28 бочки, улей, астероиды и биолаборатория", () => {
  const baseFluids = ["water", "crude-oil", "petroleum-gas", "light-oil", "heavy-oil", "lubricant", "sulfuric-acid"];
  const spaceFluids = [...baseFluids, "fluoroketone-hot", "fluoroketone-cold"];
  for (const [profile, fluids] of [["base", baseFluids], ["space-age", spaceFluids]]) {
    const document = built.profiles[profile];
    const paths = new Set(document.rows.filter((item) => item.publicPath).map((item) => item.publicPath));
    assert.equal(row(document, "item/barrel").publicPath, "Signal.Intermediate.barrel");
    assert.equal(row(document, "item/barrel").gameType, "item");
    assert.equal(row(document, "recipe/barrel").pathReason, "not-selectable");
    assert.equal(row(document, "recipe/barrel").nesting.status, "absent");
    assert.equal(fluids.length, profile === "base" ? 7 : 9);
    for (const fluid of fluids) {
      const itemName = `${fluid}-barrel`;
      const stem = itemName.replaceAll("-", "_");
      const item = row(document, `item/${itemName}`);
      const fill = row(document, `recipe/${itemName}`);
      const empty = row(document, `recipe/empty-${itemName}`);
      assert.equal(item.publicPath, `Signal.Intermediate.${stem}`);
      assert.equal(item.nesting.status, "absent");
      assert.equal(fill.publicPath, `${item.publicPath}.fill`);
      assert.equal(fill.publicName, "fill");
      assert.equal(fill.gameName, itemName);
      assert.equal(fill.gameType, "recipe");
      assert.equal(fill.channel, true);
      assert.equal(fill.nesting.rule, "barrel-action");
      assert.equal(fill.nesting.parentPrototypeId, item.prototypeId);
      assert.equal(publicName(fill.gameName), stem);
      assert.notEqual(fill.publicName, publicName(fill.gameName));
      assert.equal(empty.publicPath, `${item.publicPath}.empty`);
      assert.equal(empty.publicName, "empty");
      assert.equal(empty.gameName, `empty-${itemName}`);
      assert.equal(empty.nesting.parentPrototypeId, item.prototypeId);
      assert.notEqual(fill.prototypeId, item.prototypeId);
      assert.notEqual(empty.prototypeId, fill.prototypeId);
      assert.equal(paths.has(`Signal.Intermediate.empty_${stem}`), false);
      assert.equal(fill.label.en.text.startsWith("Fill "), true);
      assert.equal(empty.label.en.text.startsWith("Empty "), true);
      assert.match(fill.label.ru.text, /^Наполнить /);
      assert.match(empty.label.ru.text, /^Опустошить /);
    }
  }
  const recycling = row(built.profiles["space-age"], "recipe/water-barrel-recycling");
  assert.equal(recycling.role, "technical");
  assert.equal(recycling.publicPath, null);
  assert.equal(recycling.nesting.status, "absent");
  const spawner = row(built.profiles["space-age"], "item/captive-biter-spawner");
  const spawnerEntity = row(built.profiles["space-age"], "entity/captive-biter-spawner");
  assert.equal(spawner.publicPath, "Signal.Production.captive_biter_spawner");
  assert.equal(spawner.publicSection, "Production");
  assert.equal(spawnerEntity.publicPath, null);
  assert.equal(spawnerEntity.pathReason, "project-item-only");
  assert.equal(spawnerEntity.publicSection, "Production");
  assert.equal(spawnerEntity.signalSelection.state, "selectable");
  assert.equal(spawnerEntity.signalSelection.evidence, "snapshot-not-hidden");
  for (const name of ["metallic", "carbonic", "oxide", "promethium"]) {
    const item = row(built.profiles["space-age"], `item/${name}-asteroid-chunk`);
    const chunk = row(built.profiles["space-age"], `asteroid-chunk/${name}-asteroid-chunk`);
    assert.equal(item.publicPath, `Signal.Space.${name}_asteroid_chunk`);
    assert.equal(item.gameType, "item");
    assert.equal(item.gameName, `${name}-asteroid-chunk`);
    assert.equal(item.pathReason, null);
    assert.equal(chunk.publicPath, null);
    assert.equal(chunk.pathReason, "chooser-blueprint-item");
    assert.equal(chunk.signalSelection.state, "selectable");
    assert.equal(chunk.signalSelection.evidence, "snapshot-not-hidden");
    assert.equal(chunk.hidden.value, false);
    assert.equal(item.hidden.value, false);
    assert.equal(chunk.hideFromSignalGui.status, "absent");
    assert.equal(chunk.hideFromSignalGui.value, null);
    assert.equal(chunk.itemSignalAlias.status, "absent");
    assert.equal(chunk.itemSignalAlias.itemName, null);
    assert.notEqual(item.prototypeId, chunk.prototypeId);
  }
  const biolab = row(built.profiles["space-age"], "item/biolab");
  const biolabEntity = row(built.profiles["space-age"], "entity/biolab");
  assert.equal(biolab.publicPath, "Signal.Production.biolab");
  assert.equal(biolab.gameType, "item");
  assert.equal(biolab.gameName, "biolab");
  assert.equal(biolabEntity.publicPath, null);
  assert.equal(biolabEntity.pathReason, "chooser-observation-item-only");
  assert.equal(biolabEntity.signalSelection.state, "selectable");
  assert.equal(biolabEntity.signalSelection.evidence, "snapshot-not-hidden");
  assert.equal(biolab.hidden.value, false);
  assert.equal(biolabEntity.hidden.value, false);
  const operations = [
    "metallic-asteroid-crushing",
    "metallic-asteroid-reprocessing",
    "advanced-metallic-asteroid-crushing",
    "carbonic-asteroid-crushing",
    "carbonic-asteroid-reprocessing",
    "advanced-carbonic-asteroid-crushing",
    "oxide-asteroid-crushing",
    "oxide-asteroid-reprocessing",
    "advanced-oxide-asteroid-crushing",
  ];
  for (const name of operations) {
    const recipe = row(built.profiles["space-age"], `recipe/${name}`);
    assert.equal(recipe.publicPath, `Signal.Space.${name.replaceAll("-", "_")}`);
    assert.equal(recipe.gameType, "recipe");
    assert.equal(recipe.nesting.status, "absent");
    assert.equal(recipe.publicPath.endsWith("_asteroid_chunk"), false);
  }
  for (const name of ["promethium-asteroid-crushing", "promethium-asteroid-reprocessing", "advanced-promethium-asteroid-crushing"]) {
    assert.equal(built.profiles["space-age"].rows.some((item) => item.prototypeId === `recipe/${name}`), false);
  }
  assert.equal(built.collisions.signals.menuConfirmed, false);
  assert.match(built.collisions.signals.asteroidNote, /chooser-blueprint-item/);
  assert.match(built.collisions.signals.asteroidNote, /item_signal_alias/);
  assert.match(built.collisions.signals.biolabNote, /chooser-observation-item-only/);
  assert.equal(built.collisions.signals.asteroids.base.length, 0);
  assert.equal(built.collisions.signals.asteroids["space-age"].length, 4);
  assert.equal(built.collisions.signals.biolab.base, null);
  assert.equal(built.collisions.signals.biolab["space-age"].name, "biolab");
  const tree = mountSignals(JSON.parse(files["base-paths.json"]).paths);
  const item = readSignal(tree, "Signal.Intermediate.water_barrel");
  const fill = readSignal(tree, "Signal.Intermediate.water_barrel.fill");
  const empty = readSignal(tree, "Signal.Intermediate.water_barrel.empty");
  assert.equal(item.prototypeId, "item/water-barrel");
  assert.equal(fill.prototypeId, "recipe/water-barrel");
  assert.equal(empty.prototypeId, "recipe/empty-water-barrel");
  assert.equal(item.gameType, "item");
  assert.equal(fill.gameType, "recipe");
  assert.notEqual(item.prototypeId, fill.prototypeId);
});

test("CAT-18 CAT-19 CAT-22 происхождение, перестановка входов и baseline", async () => {
  assert.equal(built.versionDiff.status, "baseline");
  assert.equal(built.versionDiff.reassigned.length, 0);
  assert.match(built.versionDiff.explanation, /2\.1\.24/);
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.menuConfirmed, false);
  assert.equal(manifest.collisionsResolved, true);
  assert.equal(manifest.snapshot.archiveSha256, loaded.manifest.archiveSha256);
  assert.equal(manifest.outputs.some((item) => item.name === "manifest.json"), false);
  const itemsHash = createHash("sha256").update(await readFile(path.join(root, snapshotArg, "base/items.json"))).digest("hex");
  assert.equal(manifest.inputs.find((item) => item.path.endsWith("base/items.json")).sha256, itemsHash);
  const review = renderReview({
    coverage: JSON.parse(files["coverage.json"]),
    collisions: JSON.parse(files["collisions.json"]),
    profileDiff: JSON.parse(files["profile-diff.json"]),
    versionDiff: JSON.parse(files["version-diff.json"]),
    profiles: {
      base: JSON.parse(files["base.json"]),
      "space-age": JSON.parse(files["space-age.json"]),
    },
  });
  assert.equal(review, files["review.md"]);

  const shuffled = {
    ...loaded,
    profiles: Object.fromEntries(["base", "space-age"].map((profile) => [profile, {
      groups: {
        groups: loaded.profiles[profile].groups.groups.slice().reverse(),
        subgroups: loaded.profiles[profile].groups.subgroups.slice().reverse(),
      },
      records: loaded.profiles[profile].records.map(reverseKeys).reverse(),
    }])),
  };
  const again = allFiles(buildCatalog(shuffled, built.provenance));
  for (const name of Object.keys(files)) assert.equal(again[name], files[name], name);

  const cases = [
    [(copy) => { copy.gameVersion = "2.1.25"; }, "provenance"],
    [(copy) => { copy.archiveSha256 = "0"; }, "provenance"],
    [(copy) => { copy.builderSha256 = "0"; }, "provenance"],
    [(copy) => { copy.loaderSha256 = "0"; }, "provenance"],
    [(copy) => { delete copy.profiles.base.counts; }, "provenance"],
    [(copy) => { copy.profiles.base.counts.item += 1; }, "count"],
    [(copy) => { copy.profiles.base.counts.item += 1; copy.profiles.base.counts.fluid -= 1; }, "count"],
    [(copy) => { copy.spaceAgeAddedIds = copy.spaceAgeAddedIds.slice(1); }, "provenance"],
  ];
  for (const [patch, code] of cases) {
    const manifestCopy = structuredClone(loaded.manifest);
    patch(manifestCopy);
    assert.throws(() => buildCatalog({ ...loaded, manifest: manifestCopy }, built.provenance), (error) => error.code === code);
  }
  const extra = loaded.profiles.base.records.concat([{ type: "tile", name: "stone" }]);
  assert.throws(() => buildCatalog({
    ...loaded,
    profiles: {
      ...loaded.profiles,
      base: { ...loaded.profiles.base, records: extra },
    },
  }, built.provenance), (error) => error.code === "bad-record");
  const addedItem = loaded.manifest.spaceAgeAddedIds.find((id) => id.startsWith("item/"));
  const satellite = loaded.profiles.base.records.find((record) => record.id === "item/satellite");
  const swapped = loaded.profiles["space-age"].records
    .filter((record) => record.id !== addedItem)
    .concat(satellite);
  assert.throws(() => buildCatalog({
    ...loaded,
    profiles: {
      ...loaded.profiles,
      "space-age": { ...loaded.profiles["space-age"], records: swapped },
    },
  }, built.provenance), (error) => error.code === "provenance");
});

test("готовые файлы и CLI совпадают с этой сборкой", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "signal-catalog-cli-"));
  try {
    await main(["--snapshot", snapshotArg, "--out", path.join(parent, "out"), "--chooser-review", reviewArg], root);
    for (const name of Object.keys(files)) {
      assert.equal(await readFile(path.join(parent, "out", name), "utf8"), files[name], name);
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
  const names = await readdir(catalogDir);
  assert.deepEqual(names.filter((name) => !name.startsWith(".")).sort(), Object.keys(files).sort());
  for (const name of Object.keys(files)) {
    assert.equal(await readFile(path.join(catalogDir, name), "utf8"), files[name], name);
  }
});
