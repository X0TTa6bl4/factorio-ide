import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertSpecialSignals, buildProfile } from "../../../tools/signal-catalog/build.mjs";
import { exitCodeFor, isDirectRun, main, parseArgs, provenanceFor } from "../../../tools/signal-catalog/cli.mjs";
import { CatalogError } from "../../../tools/signal-catalog/errors.mjs";
import { PROFILES, TYPE_FILES } from "../../../tools/signal-catalog/expected.mjs";
import { loadGenerator, loadSnapshot } from "../../../tools/signal-catalog/load.mjs";
import { publishDirectory } from "../../../tools/signal-catalog/publish.mjs";
import { renderReview } from "../../../tools/signal-catalog/review.mjs";
import { expectCode, record, standardGroups } from "./support.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function broken(overrides) {
  return () => buildProfile({
    gameVersion: "2.1.24",
    profile: "base",
    groups: standardGroups(),
    records: [record(overrides)],
    missingIcons: [],
    recordSource: "fixture",
    groupsSource: "fixture",
  });
}

test("CAT-23 схема записи и групп отвергает повреждённый вход", () => {
  expectCode(() => buildProfile({ records: null, groups: standardGroups() }), "not-array");
  expectCode(() => buildProfile({ records: [null], groups: standardGroups() }), "bad-record");
  expectCode(() => buildProfile({ records: [[]], groups: standardGroups() }), "bad-record");
  for (const key of ["type", "name", "prototypeType", "role"]) {
    const value = record();
    delete value[key];
    expectCode(() => buildProfile({ records: [value], groups: standardGroups(), gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "bad-record");
  }
  expectCode(broken({ type: "tile", id: "tile/stone" }), "bad-record");
  expectCode(broken({ id: "item/other" }), "bad-record");
  expectCode(broken({ hidden: "yes" }), "bad-record");
  expectCode(broken({ parameter: "yes" }), "bad-record");
  expectCode(broken({ label: null }), "bad-record");
  expectCode(broken({ label: { en: 1, ru: "a" } }), "bad-record");
  expectCode(broken({ labelSource: { en: "a" } }), "bad-record");
  expectCode(broken({ subgroup: 1 }), "bad-record");
  expectCode(broken({ order: 1 }), "bad-record");
  expectCode(broken({ hide_from_signal_gui: "no" }), "bad-record");
  expectCode(broken({ hide_from_signal_gui: true }), "bad-record");
  expectCode(broken({ type: "recipe", id: "recipe/wood", hide_from_signal_gui: "no" }), "bad-record");
  expectCode(broken({ stack_size: "1" }), "bad-record");
  expectCode(broken({ weight: "1" }), "bad-record");
  expectCode(broken({ role: "custom" }), "unknown-role");
  const duplicate = record();
  expectCode(() => buildProfile({ records: [duplicate, { ...duplicate }], groups: standardGroups(), gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "duplicate-id");
  expectCode(() => buildProfile({ records: [], groups: null, gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "bad-record");
  const groups = standardGroups();
  expectCode(() => buildProfile({ records: [], groups: { groups: [{ name: "logistics" }, { name: "logistics" }], subgroups: [] }, gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "duplicate-group");
  expectCode(() => buildProfile({ records: [], groups: { groups: [{}], subgroups: [] }, gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "bad-record");
  expectCode(() => buildProfile({ records: [], groups: { groups: [{ name: "logistics", order: 1 }], subgroups: [] }, gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "bad-record");
  expectCode(() => buildProfile({ records: [], groups: { groups: [{ name: "logistics" }], subgroups: [{}] }, gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "bad-record");
  expectCode(() => buildProfile({ records: [], groups: { groups: [{ name: "logistics" }], subgroups: [{ name: "storage", group: "missing" }] }, gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "unknown-group");
  expectCode(() => buildProfile({ records: [], groups: { groups: [{ name: "logistics" }], subgroups: [{ name: "storage", group: "logistics" }, { name: "storage", group: "logistics" }] }, gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "duplicate-subgroup");
  expectCode(() => buildProfile({ records: [], groups: { groups: [{ name: "logistics" }], subgroups: [{ name: "storage", group: "logistics", order: 1 }] }, gameVersion: "2.1.24", profile: "base", missingIcons: [], recordSource: "f", groupsSource: "f" }), "bad-record");
  assert.equal(groups.groups.length > 0, true);
});

test("служебные сигналы сверяются с отдельным списком", () => {
  const documents = {
    base: { rows: [{ prototypeId: "virtual/signal-each", role: "meta", gameName: "signal-each" }] },
    "space-age": { rows: [{ prototypeId: "virtual/signal-any-quality", role: "quality-selector", gameName: "signal-any-quality" }] },
  };
  assertSpecialSignals(documents, undefined);
  assertSpecialSignals(documents, [
    { id: "virtual/signal-each", name: "signal-each", kind: "logic-selector", profiles: ["base"] },
    { id: "virtual/signal-any-quality", name: "signal-any-quality", kind: "quality-selector", profiles: ["space-age"] },
  ]);
  expectCode(() => assertSpecialSignals(documents, {}), "schema");
  expectCode(() => assertSpecialSignals(documents, [{}]), "schema");
  expectCode(() => assertSpecialSignals(documents, [{ id: "virtual/signal-each", name: "signal-each", kind: "other", profiles: ["base"] }]), "schema");
  expectCode(() => assertSpecialSignals(documents, [{ id: "missing", name: "missing", kind: "logic-selector", profiles: ["nope"] }]), "provenance");
  expectCode(() => assertSpecialSignals(documents, [{ id: "missing", name: "missing", kind: "logic-selector", profiles: ["base"] }]), "provenance");
  expectCode(() => assertSpecialSignals(documents, [{ id: "virtual/signal-each", name: "signal-each", kind: "quality-selector", profiles: ["base"] }]), "provenance");
  expectCode(() => assertSpecialSignals(documents, [{ id: "virtual/signal-each", name: "other", kind: "logic-selector", profiles: ["base"] }]), "provenance");
});

test("пустой корректный профиль даёт ноль строк", () => {
  const document = buildProfile({
    gameVersion: "2.1.24",
    profile: "base",
    groups: standardGroups(),
    records: [],
    recordSource: "fixture",
    groupsSource: "fixture",
  });
  assert.equal(document.rows.length, 0);
});

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "signal-catalog-"));
}

async function writeTree(dir, files) {
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

function emptySnapshot(manifest = "{}") {
  const files = {
    "manifest.json": manifest,
    "special-signals.json": "[]",
  };
  for (const profile of PROFILES) {
    files[`${profile}/groups.json`] = "{}";
    for (const fileName of Object.values(TYPE_FILES)) files[`${profile}/${fileName}`] = "[]";
  }
  return files;
}

test("загрузчик отвергает пропуски, порчу и чужой тип", async () => {
  const dir = await tempDir();
  const asDirectory = await tempDir();
  try {
    await assert.rejects(loadSnapshot(dir), (error) => error.code === "schema");
    await writeTree(dir, { "manifest.json": "{}", "special-signals.json": "{}" });
    await assert.rejects(loadSnapshot(dir), (error) => error.code === "schema");
    await writeTree(dir, emptySnapshot());
    const loaded = await loadSnapshot(dir);
    assert.deepEqual(loaded.missingIcons, []);
    await writeTree(dir, emptySnapshot(JSON.stringify({ iconFiles: { missing: 1 } })));
    await assert.rejects(loadSnapshot(dir), (error) => error.code === "schema");
    const wrong = emptySnapshot();
    wrong["base/items.json"] = "{}";
    await writeTree(dir, wrong);
    await assert.rejects(loadSnapshot(dir), (error) => error.code === "schema");
    wrong["base/items.json"] = "{";
    await writeTree(dir, wrong);
    await assert.rejects(loadSnapshot(dir), (error) => error.code === "schema");
    wrong["base/items.json"] = "null";
    await writeTree(dir, wrong);
    await assert.rejects(loadSnapshot(dir), (error) => error.code === "schema");
    wrong["base/items.json"] = JSON.stringify([null]);
    await writeTree(dir, wrong);
    await assert.rejects(loadSnapshot(dir), (error) => error.code === "bad-record");
    wrong["base/items.json"] = JSON.stringify([{ type: "fluid", name: "steam" }]);
    await writeTree(dir, wrong);
    await assert.rejects(loadSnapshot(dir), (error) => error.code === "bad-record");
    await mkdir(path.join(asDirectory, "manifest.json"));
    await assert.rejects(loadSnapshot(asDirectory), (error) => error.code === "EISDIR");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(asDirectory, { recursive: true, force: true });
  }
  await assert.rejects(loadGenerator(dir), (error) => error.code === "schema");
  await assert.rejects(loadGenerator(root, ["tools/signal-catalog"]), (error) => error.code === "EISDIR");
});

test("CAT-23 публикация не затирает прежний результат при ошибке", async () => {
  assert.throws(() => parseArgs([]), (error) => error.code === "usage");
  assert.throws(() => parseArgs(["--snapshot"]), (error) => error.code === "usage");
  assert.throws(() => parseArgs(["--out"]), (error) => error.code === "usage");
  assert.throws(() => parseArgs(["--snapshot", "a", "--snapshot", "b"]), (error) => error.code === "usage");
  assert.throws(() => parseArgs(["--out", "a", "--out", "b"]), (error) => error.code === "usage");
  assert.throws(() => parseArgs(["--weird"]), (error) => error.code === "usage");
  assert.deepEqual(parseArgs(["--out", "out", "--snapshot", "snap"]), { out: "out", snapshot: "snap" });
  assert.equal(isDirectRun(import.meta.url, undefined), false);
  assert.equal(isDirectRun(import.meta.url, fileURLToPath(import.meta.url)), true);
  assert.equal(exitCodeFor(null), 0);
  assert.equal(exitCodeFor(new CatalogError("usage", "x")), 2);
  assert.equal(exitCodeFor(new CatalogError("schema", "x")), 1);
  assert.equal(exitCodeFor(new Error("x")), 1);

  const parent = await tempDir();
  const out = path.join(parent, "catalog");
  const missing = path.join(parent, "missing");
  try {
    await mkdir(out);
    await writeFile(path.join(out, "marker.txt"), "keep\n");
    await assert.rejects(main(["--snapshot", path.join(parent, "nope"), "--out", out], root), (error) => error.code === "schema");
    assert.equal(await readFile(path.join(out, "marker.txt"), "utf8"), "keep\n");
    await assert.rejects(main(["--snapshot", path.join(parent, "nope"), "--out", missing], root));
    await assert.rejects(readFile(missing));
    await assert.rejects(publishDirectory(out, {}), (error) => error.code === "schema");
    await assert.rejects(publishDirectory(out, []), (error) => error.code === "schema");
    await assert.rejects(publishDirectory(out, null), (error) => error.code === "schema");
    await assert.rejects(publishDirectory(out, { "nested/file.json": "{}\n" }), (error) => error.code === "schema");
    await assert.rejects(publishDirectory(out, { ".hidden.json": "{}\n" }), (error) => error.code === "schema");
    assert.equal(await readFile(path.join(out, "marker.txt"), "utf8"), "keep\n");
    await publishDirectory(out, { "ok.json": "{\"a\":1}\n" });
    assert.equal(await readFile(path.join(out, "ok.json"), "utf8"), "{\"a\":1}\n");
    await assert.rejects(readFile(path.join(out, "marker.txt")));
    await writeFile(path.join(out, "stale.json"), "old\n");
    await publishDirectory(out, { "ok.json": "{\"a\":2}\n" });
    assert.equal(await readFile(path.join(out, "ok.json"), "utf8"), "{\"a\":2}\n");
    await assert.rejects(readFile(path.join(out, "stale.json")));
    const fresh = path.join(parent, "fresh");
    await publishDirectory(fresh, { "ok.json": "{\"a\":1}\n" });
    assert.equal(await readFile(path.join(fresh, "ok.json"), "utf8"), "{\"a\":1}\n");
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    await assert.rejects(publishDirectory(out, { "ok.json": "{\"a\":3}\n" }, {
      mkdir, mkdtemp, writeFile, rm,
      rename: async () => { throw busy; },
    }), (error) => error.code === "EBUSY");
    assert.equal(await readFile(path.join(out, "ok.json"), "utf8"), "{\"a\":2}\n");
    let renames = 0;
    await assert.rejects(publishDirectory(out, { "ok.json": "{\"a\":3}\n" }, {
      mkdir, mkdtemp, writeFile, rm,
      rename: async (from, to) => {
        renames += 1;
        if (renames === 2) throw busy;
        return rename(from, to);
      },
    }), (error) => error.code === "EBUSY");
    assert.equal(await readFile(path.join(out, "ok.json"), "utf8"), "{\"a\":2}\n");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("пустое ревью и неполный manifest не подставляют факты", () => {
  const text = renderReview({
    coverage: {
      gameVersion: "2.1.24",
      profiles: {
        base: { rows: 0, input: 0, exported: 0, excluded: {}, unresolvedLabels: { en: 0, ru: 0 } },
        "space-age": { rows: 0, input: 0, exported: 0, excluded: {}, unresolvedLabels: { en: 0, ru: 0 } },
      },
    },
    collisions: { resolved: false, proposal: "нет правила", profiles: { base: [], "space-age": [] }, propertyAccess: { base: [], "space-age": [] } },
    profileDiff: { removed: [], added: [], changed: [] },
    versionDiff: { explanation: "baseline" },
    profiles: {
      base: { rows: [] },
      "space-age": { rows: [] },
    },
  });
  assert.match(text, /нет/);
  assert.match(text, /Удалены в Space Age: нет/);
  const named = renderReview({
    coverage: {
      gameVersion: "2.1.24",
      profiles: {
        base: { rows: 0, input: 0, exported: 0, excluded: {}, unresolvedLabels: { en: 0, ru: 0 } },
        "space-age": { rows: 0, input: 0, exported: 0, excluded: {}, unresolvedLabels: { en: 0, ru: 0 } },
      },
    },
    collisions: {
      resolved: false,
      proposal: "нет правила",
      profiles: {
        base: [{
          candidatePath: "Signal.Space.other_chunk",
          records: [
            { prototypeId: "asteroid-chunk/other-chunk" },
            { prototypeId: "item/other-chunk" },
          ],
        }],
        "space-age": [],
      },
      propertyAccess: {
        base: [{ prototypeId: "item/prototype", rejectedPath: "Signal.Logistic.prototype", kind: "readonly-static" }],
        "space-age": [],
      },
      signals: {
        asteroidNote: "alias не подтверждён",
        biolabNote: "biolab не назначен",
        asteroids: {
          "space-age": [
            {
              name: "chunk",
              left: { prototypeId: "item/chunk", publicPath: "Signal.Space.chunk", pathReason: null },
              right: null,
            },
            {
              name: "other",
              left: null,
              right: { prototypeId: "asteroid-chunk/other", publicPath: null, pathReason: "collision" },
            },
            {
              name: "fallback",
              left: { prototypeId: "item/fallback", publicPath: null, pathReason: "collision" },
              right: {
                prototypeId: "asteroid-chunk/fallback",
                publicPath: "Signal.Space.fallback",
                pathReason: null,
                hideFromSignalGui: { status: "explicit" },
                itemSignalAlias: { status: "present" },
              },
            },
          ],
        },
        biolab: {
          base: {
            name: "biolab",
            left: { prototypeId: "item/biolab", publicPath: null, pathReason: "collision" },
            right: null,
          },
          "space-age": null,
        },
      },
    },
    profileDiff: { removed: [], added: [], changed: [] },
    versionDiff: { explanation: "baseline" },
    profiles: { base: { rows: [] }, "space-age": { rows: [] } },
  });
  assert.match(named, /Signal\.Logistic\.prototype/);
  assert.match(named, /Signal\.Space\.other_chunk/);
  assert.match(named, /asteroid-chunk\/other-chunk, item\/other-chunk/);
  assert.match(named, /item\/fallback → collision/);
  assert.match(named, /asteroid-chunk\/fallback → Signal\.Space\.fallback/);
  assert.match(named, /item\/biolab → collision/);
  assert.match(named, /нет item/);
  assert.match(named, /нет asteroid-chunk/);
  assert.match(named, /нет entity/);
  assert.match(named, /Signal\.Space\.chunk/);
  assert.match(named, /hide нет/);
  const provenance = provenanceFor({
    manifest: {
      gameVersion: "2.1.24",
      archiveSha256: "a",
      builderSha256: "b",
      loaderSha256: "c",
      engineValidation: false,
    },
    inputs: [],
  }, "data/factorio/2.1.24", []);
  assert.equal(provenance.snapshot.extraction, null);
  assert.equal(provenance.snapshot.iconFilesCopied, null);
  assert.equal(provenance.snapshot.iconFilesReferenced, null);
});
