import assert from "node:assert/strict";
import test from "node:test";
import {
  collisionReport,
  compareRows,
  coverageOf,
  diffProfiles,
  diffVersions,
  iconKey,
  indexIcons,
  qualitiesDocument,
} from "../../../tools/signal-catalog/build.mjs";
import { barrelLink, finishBarrelLinks } from "../../../tools/signal-catalog/decisions.mjs";
import { canonicalJson } from "../../../tools/signal-catalog/format.mjs";
import { renderReview } from "../../../tools/signal-catalog/review.mjs";
import { RECIPE_HIDE_RULE } from "../../../tools/signal-catalog/expected.mjs";
import { mountSignals, readSignal } from "../../../tools/signal-catalog/tree.mjs";
import { build, expectCode, record, row, standardGroups } from "./support.mjs";

function ids(document) {
  return document.rows.map((item) => item.prototypeId);
}

test("CAT-02 CAT-05 CAT-08 обычный предмет, подпись и подтип", () => {
  const chest = record({
    name: "wooden-chest",
    prototypeType: "item",
    subgroup: "storage",
    label: { en: "Wooden chest", ru: "Деревянный сундук" },
    stack_size: 16,
  });
  const ammo = record({
    name: "firearm-magazine",
    prototypeType: "ammo",
    subgroup: "belt",
    stack_size: 0,
    weight: 10000,
  });
  const first = build([chest, ammo]);
  const renamed = build([
    { ...chest, label: { en: "Сундук", ru: "Chest" }, labelSource: { en: "other", ru: "other" } },
    ammo,
  ]);
  assert.equal(row(first, "item/wooden-chest").publicPath, "Signal.Logistic.wooden_chest");
  assert.equal(row(first, "item/wooden-chest").publicName, "wooden_chest");
  assert.equal(row(first, "item/wooden-chest").gameName, "wooden-chest");
  assert.equal(row(first, "item/wooden-chest").channel, true);
  assert.equal(row(renamed, "item/wooden-chest").publicPath, row(first, "item/wooden-chest").publicPath);
  assert.equal(row(first, "item/firearm-magazine").gameType, "item");
  assert.equal(row(first, "item/firearm-magazine").prototypeType, "ammo");
  assert.equal(row(first, "item/firearm-magazine").stackSize.value, 0);
  assert.equal(row(first, "item/firearm-magazine").weight.value, 10000);
  assert.equal(row(first, "item/wooden-chest").weight.status, "absent");
  assert.equal(Object.hasOwn(row(first, "item/wooden-chest"), "rocketCapacity"), false);
  assert.equal(row(first, "item/wooden-chest").defaultQuality.value, "normal");
  assert.equal(row(first, "item/wooden-chest").defaultQuality.level, "documentation");
  assert.equal(row(first, "item/wooden-chest").quality.applies, "unconfirmed");
});

test("CAT-03 CAT-06 коллизия не сливает типы и не добавляет суффикс", () => {
  const item = record({ name: "a-b", subgroup: "storage" });
  const alias = record({ name: "a_b", subgroup: "storage" });
  const collided = build([alias, item]);
  assert.equal(row(collided, "item/a-b").publicPath, null);
  assert.equal(row(collided, "item/a_b").publicPath, null);
  assert.equal(row(collided, "item/a-b").pathReason, "collision");
  assert.equal(row(collided, "item/a-b").candidatePath, "Signal.Logistic.a_b");
  assert.equal(ids(collided).length, 2);

  const wood = record({ name: "wooden-chest" });
  const recipe = record({
    type: "recipe",
    name: "wooden-chest",
    subgroup: "storage",
    hide_from_signal_gui: false,
    icon: wood.icon,
  });
  const entity = record({ type: "entity", name: "wooden-chest", subgroup: "storage" });
  const triple = build([entity, recipe, wood]);
  for (const id of ["item/wooden-chest", "recipe/wooden-chest", "entity/wooden-chest"]) {
    assert.equal(row(triple, id).publicPath, null);
    assert.equal(row(triple, id).gameName, "wooden-chest");
  }
  const report = collisionReport({ base: triple });
  assert.equal(report.profiles.base.length, 1);
  assert.deepEqual(
    report.profiles.base[0].records.map((itemRow) => itemRow.prototypeId).sort(),
    ["entity/wooden-chest", "item/wooden-chest", "recipe/wooden-chest"],
  );
});

test("CAT-04 служебное имя остаётся строкой без пути", () => {
  const keyword = build([record({ name: "default" })]);
  const service = build([record({ name: "__proto__" })]);
  const readonly = build([record({ name: "prototype" })]);
  const digit = build([record({ name: "1x2-remnants", type: "entity", subgroup: "generic-remnants" })]);
  assert.equal(row(keyword, "item/default").publicPath, "Signal.Logistic.default");
  assert.equal(row(keyword, "item/default").nameCheck.kind, "keyword");
  assert.equal(new Function("Signal", "return Signal.Logistic.default;")({ Logistic: { default: "ok" } }), "ok");
  assert.equal(collisionReport({ base: keyword }).keywords.base[0].publicPath, "Signal.Logistic.default");
  assert.equal(row(service, "item/__proto__").nameCheck.kind, "service-property");
  assert.equal(row(readonly, "item/prototype").pathReason, "js-property");
  assert.equal(row(digit, "entity/1x2-remnants").publicPath, "Signal.Environment.remnants_1x2");
  assert.equal(row(digit, "entity/1x2-remnants").gameName, "1x2-remnants");
  assert.equal(ids(digit).includes("entity/1x2-remnants"), true);
  const meta = build([record({ type: "virtual", name: "1bad", role: "logic-selector" })]);
  assert.equal(row(meta, "virtual/1bad").publicPath, null);
  assert.equal(row(meta, "virtual/1bad").rejectedPath, "Signal.Meta.1bad");
  assert.equal(row(meta, "virtual/1bad").pathReason, "js-property");
});

test("CAT-03 CAT-04 перенос размера не затирает существующий путь", () => {
  const document = build([
    record({ name: "1x2-remnants", type: "entity", subgroup: "generic-remnants" }),
    record({ name: "remnants-1x2", type: "entity", subgroup: "generic-remnants" }),
  ]);
  for (const id of ["entity/1x2-remnants", "entity/remnants-1x2"]) {
    assert.equal(row(document, id).publicPath, null);
    assert.equal(row(document, id).pathReason, "collision");
  }
});

test("CAT-09 мета, качество и параметр не становятся обычным каналом", () => {
  const rows = build([
    record({ type: "virtual", name: "signal-each", role: "logic-selector", subgroup: "virtual-signal-special", hidden: true }),
    record({ type: "virtual", name: "signal-everything", role: "logic-selector", subgroup: "virtual-signal-special" }),
    record({ type: "virtual", name: "signal-anything", role: "logic-selector", subgroup: "virtual-signal-special" }),
    record({ type: "virtual", name: "signal-any-quality", role: "quality-selector", subgroup: "qualities" }),
    record({ type: "item", name: "parameter-0", role: "blueprint-parameter", subgroup: "storage" }),
    record({ type: "recipe", name: "parameter-1", parameter: true, subgroup: "barrel" }),
  ]);
  assert.equal(row(rows, "virtual/signal-each").publicPath, "Signal.Meta.signal_each");
  assert.equal(row(rows, "virtual/signal-each").channel, false);
  assert.equal(row(rows, "virtual/signal-each").role, "meta");
  assert.equal(row(rows, "virtual/signal-each").defaultQuality.status, "not-applicable");
  assert.equal(row(rows, "virtual/signal-any-quality").role, "quality-selector");
  assert.equal(row(rows, "virtual/signal-any-quality").channel, false);
  assert.equal(row(rows, "virtual/signal-any-quality").publicPath, "Signal.Unsorted.signal_any_quality");
  assert.equal(row(rows, "item/parameter-0").pathReason, "blueprint-parameter");
  assert.equal(row(rows, "recipe/parameter-1").publicPath, null);
  assert.equal(row(rows, "recipe/parameter-1").role, "blueprint-parameter");
});

test("CAT-10 отсутствующая группа учитывается и не становится Unsorted", () => {
  const plain = record({ name: "accumulator" });
  delete plain.subgroup;
  const absent = build([plain, record({ name: "null-sub", subgroup: null })]);
  assert.equal(row(absent, "item/null-sub").pathReason, "subgroup-absent");
  assert.equal(row(absent, "item/accumulator").pathReason, "subgroup-absent");
  assert.equal(row(absent, "item/accumulator").publicSection, null);
  assert.equal(row(absent, "item/accumulator").publicPath, null);
  const tiles = build([record({ name: "stone-path", subgroup: "nauvis-tiles" })]);
  assert.equal(row(tiles, "item/stone-path").pathReason, "section-unsupported");
  assert.notEqual(row(tiles, "item/stone-path").publicPath, "Signal.Unsorted.stone_path");
  expectCode(() => build([record({ subgroup: "missing-sub" })]), "unknown-subgroup");
  expectCode(() => build([record({ subgroup: "" })]), "bad-record");
});

test("CAT-11 порядок входа и пустой order не меняют путь", () => {
  const first = record({ name: "alpha", order: "", subgroup: "storage" });
  const second = record({ name: "beta", order: "b", subgroup: "belt" });
  const third = record({ type: "entity", name: "zzz", order: "", subgroup: "storage" });
  const forward = build([first, second, third]);
  const backward = build([third, second, first]);
  assert.equal(canonicalJson(forward), canonicalJson(backward));
  assert.deepEqual(ids(forward), ["entity/zzz", "item/alpha", "item/beta"]);
  assert.equal(row(build([record({ name: "null-order", order: null })]), "item/null-order").prototypeOrder.status, "absent");
  const tied = compareRows(
    { group: { order: "a" }, subgroup: { order: "a" }, prototypeOrder: { value: "a" }, gameType: "item", gameName: "a", prototypeId: "item/a" },
    { group: { order: "a" }, subgroup: { order: "a" }, prototypeOrder: { value: "a" }, gameType: "item", gameName: "a", prototypeId: "item/a" },
  );
  assert.equal(tied, 0);
  assert.equal(compareRows(
    { group: { order: null }, subgroup: { order: "b" }, prototypeOrder: { value: null }, gameType: "item", gameName: "b", prototypeId: "item/b" },
    { group: { order: "a" }, subgroup: { order: "a" }, prototypeOrder: { value: "a" }, gameType: "fluid", gameName: "a", prototypeId: "fluid/a" },
  ) < 0, true);
});

test("CAT-12 CAT-13 сложная подпись не становится выдуманным переводом", () => {
  const nested = ["item-name.filled-barrel", ["fluid-name.water"]];
  const document = build([record({
    name: "water-barrel",
    subgroup: "barrel",
    label: { en: "water-barrel", ru: "water-barrel" },
    labelSource: { en: "unresolved", ru: "unresolved" },
    localised_name: nested,
  })]);
  const line = row(document, "item/water-barrel");
  assert.equal(line.label.en.status, "unresolved");
  assert.equal(line.label.ru.status, "unresolved");
  assert.equal(line.label.en.text, "water-barrel");
  assert.deepEqual(line.localisedName.value, nested);
  assert.equal(line.sources.label, "snapshot");
  assert.equal(line.publicPath, "Signal.Intermediate.water_barrel");
  const translated = build([record({
    label: { en: "Wood", ru: "Древесина" },
    labelSource: { en: "item-name.wood", ru: "item-name.wood" },
  })]);
  assert.equal(row(translated, "item/wood").label.ru.status, "snapshot");
});

test("CAT-14 качество сигнала не размножает строки", () => {
  const document = build([
    record({ type: "quality", name: "normal", role: "signal", subgroup: "qualities", level: 0, next: "rare", next_probability: 0 }),
    record({ type: "quality", name: "legendary", role: "signal", subgroup: "qualities", level: 5 }),
    record({ type: "quality", name: "quality-unknown", role: "internal", hidden: true, level: 0 }),
    record({ name: "iron-plate", subgroup: "storage" }),
  ]);
  assert.equal(document.rows.length, 4);
  const table = qualitiesDocument(document);
  assert.deepEqual(table.observedOrdinaryLevels, [0, 5]);
  assert.deepEqual(table.missingLevels, [1, 2, 3, 4]);
  assert.equal(table.entries.length, 3);
  assert.equal(row(document, "quality/normal").quality.asSignalType, true);
  assert.equal(row(document, "quality/normal").quality.nextProbability.value, 0);
  assert.equal(row(document, "quality/legendary").quality.next.status, "absent");
  assert.equal(row(document, "quality/quality-unknown").role, "technical");
  assert.equal(row(document, "item/iron-plate").quality.asSignalType, false);
  const single = qualitiesDocument(build([record({ type: "quality", name: "normal", subgroup: "qualities", level: 0 })]));
  assert.deepEqual(single.missingLevels, []);
  const unnamed = record({ type: "quality", name: "odd", subgroup: "qualities" });
  delete unnamed.order;
  const noLevel = qualitiesDocument(build([
    record({ type: "quality", name: "beta", subgroup: "qualities", level: 2 }),
    unnamed,
  ]));
  assert.equal(noLevel.entries.at(-1).gameName, "odd");
  assert.deepEqual(noLevel.missingLevels, []);
});

test("CAT-15 отсутствующее hide_from_signal_gui не становится false", () => {
  const item = record({ name: "wood", icon: { source: "icons", layers: [{ icon_size: 64, icon: "__base__/graphics/icons/wood.png" }] } });
  const recipe = record({
    type: "recipe",
    name: "wood",
    subgroup: "barrel",
    icon: { source: "main-product", layers: [{ icon: "__base__/graphics/icons/wood.png", icon_size: 64 }] },
  });
  const matched = build([recipe, item]);
  const hidden = row(matched, "recipe/wood");
  assert.equal(hidden.signalSelection.state, "hidden");
  assert.equal(hidden.signalSelection.evidence, "prototype-docs-icon-match");
  assert.equal(hidden.signalSelection.source, RECIPE_HIDE_RULE.source);
  assert.equal(hidden.recipeHideFromSignalGui.status, "derived");
  assert.equal(hidden.recipeHideFromSignalGui.value, null);
  assert.equal(hidden.pathReason, "not-selectable");
  assert.deepEqual(hidden.signalSelection.matchedPrototypeIds, ["item/wood"]);

  const shown = record({
    type: "recipe",
    name: "wood",
    subgroup: "barrel",
    hide_from_signal_gui: false,
    icon: item.icon,
  });
  const explicit = build([shown, item]);
  assert.equal(row(explicit, "recipe/wood").recipeHideFromSignalGui.value, false);
  assert.equal(row(explicit, "recipe/wood").signalSelection.state, "selectable");
  assert.equal(row(explicit, "recipe/wood").publicPath, "Signal.Intermediate.wood");
  assert.equal(row(explicit, "item/wood").publicPath, "Signal.Logistic.wood");

  const forced = build([record({
    type: "recipe",
    name: "pentapod-egg",
    subgroup: "barrel",
    hide_from_signal_gui: true,
  })]);
  assert.equal(row(forced, "recipe/pentapod-egg").signalSelection.state, "hidden");
  assert.equal(row(forced, "recipe/pentapod-egg").role, "ordinary");
});

test("CAT-16 CAT-17 скрытая запись и отсутствующая иконка остаются в учёте", () => {
  const visible = record({ name: "iron-plate" });
  const hidden = record({ name: "loader", hidden: true, role: "signal" });
  const internal = record({ name: "item-unknown", role: "internal", hidden: false });
  const bare = record({ name: "steam", type: "fluid", subgroup: "fluid", icon: null });
  const layered = record({
    name: "water-barrel",
    subgroup: "barrel",
    icon: {
      source: "icons",
      layers: [
        { icon: "__base__/graphics/icons/empty.png", icon_size: 64 },
        { icon: "__base__/graphics/icons/mask.png", icon_size: 64, tint: { r: 1, g: 0 } },
      ],
    },
  });
  const document = build(
    [hidden, internal, bare, layered, visible],
    { missingIcons: ["__base__/graphics/icons/iron-plate.png", "__base__/graphics/icons/empty.png"] },
  );
  assert.equal(document.rows.length, 5);
  assert.equal(row(document, "item/loader").role, "technical");
  assert.equal(row(document, "item/loader").pathReason, "technical");
  assert.equal(row(document, "item/item-unknown").role, "technical");
  assert.equal(row(document, "fluid/steam").icon.status, "absent");
  assert.equal(row(document, "fluid/steam").publicPath, "Signal.Fluids.steam");
  assert.equal(row(document, "item/iron-plate").icon.png, "missing");
  assert.equal(row(document, "item/water-barrel").icon.png, "not-listed");
  assert.equal(row(document, "item/water-barrel").icon.layers[1].tint.r, 1);
  const partial = record({
    name: "mask-only",
    icon: { source: "icons", layers: [{ tint: { a: 1 } }, { icon: "__base__/graphics/icons/mask.png" }] },
  });
  assert.equal(row(build([partial]), "item/mask-only").icon.png, "not-listed");
  assert.equal(iconKey(null), null);
  assert.equal(iconKey({ layers: [] }), null);
});

test("совпадение иконки рецепта смотрит только item, fluid и virtual", () => {
  const entity = record({ type: "entity", name: "biter", subgroup: "enemies" });
  const recipe = record({ type: "recipe", name: "biter-egg", subgroup: "barrel", icon: entity.icon });
  const fluid = record({ type: "fluid", name: "steam", subgroup: "fluid" });
  const other = record({ type: "fluid", name: "water", subgroup: "fluid", icon: fluid.icon });
  const document = build([other, recipe, entity, fluid]);
  assert.equal(row(document, "recipe/biter-egg").signalSelection.state, "selectable");
  const same = record({ type: "recipe", name: "boiled", subgroup: "barrel", icon: fluid.icon });
  const matched = build([same, other, fluid]);
  assert.deepEqual(row(matched, "recipe/boiled").signalSelection.matchedPrototypeIds, ["fluid/steam", "fluid/water"]);
  const noIcon = record({ type: "recipe", name: "blank", subgroup: "barrel", icon: { layers: [], source: "icon" } });
  assert.equal(row(build([noIcon]), "recipe/blank").pathReason, "signal-selection-unconfirmed");
  const indexed = indexIcons([other, fluid, entity]);
  assert.deepEqual([...indexed.values()][0], ["fluid/steam", "fluid/water"]);
});

test("скрытый предмет не скрывает recipe-сигнал с той же иконкой", () => {
  const item = record({ name: "rocket-part", hidden: true, role: "internal" });
  const recipe = record({ type: "recipe", name: "rocket-part", icon: item.icon });
  const document = build([item, recipe]);
  assert.equal(row(document, "item/rocket-part").publicPath, null);
  assert.equal(row(document, "recipe/rocket-part").signalSelection.state, "selectable");
  assert.equal(row(document, "recipe/rocket-part").publicPath, "Signal.Logistic.rocket_part");
  assert.deepEqual([...indexIcons([item]).values()], []);
  const visibleItem = { ...item, hidden: false, role: "signal" };
  assert.equal(row(build([visibleItem, recipe]), "recipe/rocket-part").signalSelection.state, "hidden");
});

test("рецепт наследует subgroup/order главного продукта, сохраняя явные настройки", () => {
  const item = record({ name: "part", hidden: true, order: "part-order" });
  const fluid = record({ type: "fluid", name: "steam", subgroup: "fluid", order: "fluid-order" });
  const recipe = record({ type: "recipe", name: "make-part", subgroup: undefined, order: undefined, results: [{ name: "part" }] });
  delete recipe.subgroup;
  delete recipe.order;
  const result = build([item, recipe]);
  const inherited = row(result, "recipe/make-part");
  assert.equal(inherited.subgroup.id, "storage");
  assert.equal(inherited.prototypeOrder.value, "part-order");
  assert.deepEqual(inherited.sources.recipeDefaults.fields, ["subgroup", "order"]);
  assert.equal(recipe.subgroup, undefined);
  assert.equal(recipe.order, undefined);
  const explicit = { ...recipe, subgroup: "barrel", order: "" };
  assert.equal(row(build([item, explicit]), "recipe/make-part").subgroup.id, "barrel");
  assert.equal(row(build([item, explicit]), "recipe/make-part").prototypeOrder.value, "");
  const main = { ...recipe, main_product: "steam", results: [{ name: "part" }, { type: "fluid", name: "steam" }] };
  assert.equal(row(build([item, fluid, main]), "recipe/make-part").subgroup.id, "fluid");
  const disabled = { ...main, main_product: "" };
  assert.equal(row(build([item, fluid, disabled]), "recipe/make-part").subgroup.status, "absent");
  const ambiguous = { ...main, main_product: undefined };
  assert.equal(row(build([item, fluid, ambiguous]), "recipe/make-part").subgroup.status, "absent");
  assert.equal(row(build([recipe]), "recipe/make-part").subgroup.status, "absent");
});

test("разные разделы одного имени не конфликтуют, мета не требует подгруппы", () => {
  const meta = record({ type: "virtual", name: "signal-A", role: "logic-selector" });
  delete meta.subgroup;
  const item = record({ name: "signal-A", subgroup: "storage" });
  const document = build([item, meta]);
  assert.equal(row(document, "virtual/signal-A").publicPath, "Signal.Meta.signal_A");
  assert.equal(row(document, "item/signal-A").publicPath, "Signal.Logistic.signal_A");
  const space = build([record({ type: "asteroid-chunk", name: "metallic-asteroid-chunk", subgroup: "space-material" })]);
  assert.equal(row(space, "asteroid-chunk/metallic-asteroid-chunk").publicPath, "Signal.Space.metallic_asteroid_chunk");
});

test("покрытие, diff профилей и версий объясняют потери", () => {
  const base = build([
    record({ name: "wood" }),
    record({ name: "satellite" }),
  ]);
  const space = build([
    record({ name: "wood", stack_size: 50 }),
    record({ name: "iron-plate", subgroup: "belt" }),
  ], { profile: "space-age" });
  const diff = diffProfiles(base, space);
  assert.deepEqual(diff.removed, ["item/satellite"]);
  assert.deepEqual(diff.added, ["item/iron-plate"]);
  assert.equal(diff.changed[0].prototypeId, "item/wood");
  assert.equal(diff.changed[0].fields.includes("stackSize"), true);
  assert.throws(() => coverageOf(base, 1), (error) => error.code === "count");
  assert.throws(() => coverageOf({ rows: [{ prototypeId: "item/a" }, { prototypeId: "item/a" }] }, 2), (error) => error.code === "duplicate-id");
  const moved = diffVersions(
    { gameVersion: "2.1.23", rows: [{ prototypeId: "item/wood", publicPath: "Signal.Logistic.wood" }, { prototypeId: "item/old", publicPath: "Signal.Logistic.old" }] },
    { gameVersion: "2.1.24", rows: [{ prototypeId: "item/wood", publicPath: "Signal.Intermediate.wood" }, { prototypeId: "item/new", publicPath: "Signal.Logistic.old" }] },
  );
  assert.equal(moved.status, "compared");
  assert.deepEqual(moved.added, ["item/new"]);
  assert.deepEqual(moved.removed, ["item/old"]);
  assert.equal(moved.moved[0].prototypeId, "item/wood");
  assert.equal(moved.reassigned[0].publicPath, "Signal.Logistic.old");
  const baseline = diffVersions(null, base);
  assert.equal(baseline.status, "baseline");
  assert.equal(baseline.reassigned.length, 0);
});

function actionRecipe(name, subgroup, key) {
  return record({
    type: "recipe",
    name,
    subgroup,
    hide_from_signal_gui: false,
    localised_name: [key, ["fluid-name.water"]],
    label: { en: name, ru: name },
    labelSource: { en: key, ru: key },
  });
}

test("CAT-25 CAT-26 вложенные бочки не дублируют плоский рецепт", () => {
  const item = record({ name: "water-barrel", subgroup: "barrel", localised_name: ["item-name.filled-barrel", ["fluid-name.water"]] });
  const cold = record({ name: "fluoroketone-cold-barrel", subgroup: "barrel" });
  const fill = actionRecipe("water-barrel", "fill-barrel", "recipe-name.fill-barrel");
  const empty = actionRecipe("empty-water-barrel", "empty-barrel", "recipe-name.empty-filled-barrel");
  const coldFill = actionRecipe("fluoroketone-cold-barrel", "fill-barrel", "recipe-name.fill-barrel");
  const coldEmpty = actionRecipe("empty-fluoroketone-cold-barrel", "empty-barrel", "recipe-name.empty-filled-barrel");
  const craft = record({ type: "recipe", name: "barrel", subgroup: "barrel", icon: item.icon });
  const barrelItem = record({ name: "barrel", subgroup: "barrel" });
  const recycling = record({
    type: "recipe",
    name: "water-barrel-recycling",
    subgroup: "fill-barrel",
    hidden: true,
    localised_name: ["recipe-name.recycling"],
  });
  const odd = actionRecipe("water-barrel", "fill-barrel", "recipe-name.recycling");
  const document = build([coldEmpty, empty, recycling, craft, coldFill, fill, cold, barrelItem, item]);
  assert.equal(row(document, "item/water-barrel").publicPath, "Signal.Intermediate.water_barrel");
  assert.equal(row(document, "recipe/water-barrel").publicPath, "Signal.Intermediate.water_barrel.fill");
  assert.equal(row(document, "recipe/water-barrel").publicName, "fill");
  assert.equal(row(document, "recipe/empty-water-barrel").publicPath, "Signal.Intermediate.water_barrel.empty");
  assert.equal(row(document, "recipe/empty-water-barrel").gameName, "empty-water-barrel");
  assert.equal(row(document, "item/fluoroketone-cold-barrel").publicPath, "Signal.Intermediate.fluoroketone_cold_barrel");
  assert.equal(row(document, "recipe/fluoroketone-cold-barrel").publicPath, "Signal.Intermediate.fluoroketone_cold_barrel.fill");
  assert.equal(row(document, "recipe/empty-fluoroketone-cold-barrel").publicName, "empty");
  assert.equal(row(document, "item/barrel").publicPath, "Signal.Intermediate.barrel");
  assert.equal(row(document, "recipe/barrel").pathReason, "not-selectable");
  assert.equal(row(document, "recipe/barrel").nesting.status, "absent");
  assert.equal(row(document, "recipe/water-barrel-recycling").pathReason, "technical");
  assert.equal(row(document, "recipe/water-barrel-recycling").publicPath, null);
  const paths = {};
  for (const line of document.rows) {
    if (!line.publicPath) continue;
    assert.equal(paths[line.publicPath], undefined);
    paths[line.publicPath] = line;
  }
  assert.equal(Object.hasOwn(paths, "Signal.Intermediate.empty_water_barrel"), false);
  assert.equal(Object.hasOwn(paths, "Signal.Intermediate.water_barrel"), true);
  const tree = mountSignals(Object.fromEntries(Object.entries(paths).map(([key, line]) => [key, {
    prototypeId: line.prototypeId,
    gameType: line.gameType,
    gameName: line.gameName,
    role: line.role,
    channel: line.channel,
  }])));
  assert.equal(readSignal(tree, "Signal.Intermediate.water_barrel").prototypeId, "item/water-barrel");
  assert.equal(readSignal(tree, "Signal.Intermediate.water_barrel.fill").gameType, "recipe");
  assert.equal(readSignal(tree, "Signal.Intermediate.water_barrel.empty").prototypeId, "recipe/empty-water-barrel");
  assert.equal(Object.hasOwn(row(document, "item/water-barrel"), "fill"), false);
  const orphan = build([actionRecipe("steam-barrel", "fill-barrel", "recipe-name.fill-barrel")]);
  assert.equal(row(orphan, "recipe/steam-barrel").pathReason, "barrel-parent-missing");
  assert.equal(row(orphan, "recipe/steam-barrel").publicPath, null);
  const hiddenItem = record({ name: "water-barrel", subgroup: "barrel", hidden: true });
  const blocked = build([hiddenItem, fill]);
  assert.equal(row(blocked, "item/water-barrel").pathReason, "technical");
  assert.equal(row(blocked, "recipe/water-barrel").pathReason, "barrel-parent-unavailable");
  const collided = build([item, odd]);
  assert.equal(row(collided, "item/water-barrel").publicPath, null);
  assert.equal(row(collided, "recipe/water-barrel").pathReason, "collision");
  assert.equal(barrelLink({
    gameType: "recipe",
    role: "ordinary",
    gameName: "empty-barrel",
    subgroup: { status: "present", id: "empty-barrel" },
    localisedName: { status: "present", value: ["recipe-name.empty-filled-barrel"] },
  }), null);
  assert.equal(barrelLink({
    gameType: "item",
    role: "ordinary",
    gameName: "water-barrel",
    subgroup: { status: "present", id: "barrel" },
    localisedName: { status: "absent", value: null },
  }), null);
  assert.equal(barrelLink({
    gameType: "recipe",
    role: "ordinary",
    gameName: "water-barrel",
    subgroup: { status: "present", id: "fill-barrel" },
    localisedName: { status: "present", value: [1] },
  }), null);
  assert.equal(barrelLink({
    gameType: "recipe",
    role: "ordinary",
    gameName: "water-barrel",
    subgroup: { status: "absent", id: null },
    localisedName: { status: "absent", value: null },
  }), null);
  const linked = [
    { nesting: { status: "present", leaf: "fill" }, publicPath: null, barrelLink: { leaf: "fill" } },
    { nesting: { status: "present", leaf: "empty" }, publicPath: "Signal.Intermediate.water_barrel.empty" },
    { publicPath: "Signal.Intermediate.barrel" },
  ];
  finishBarrelLinks(linked);
  assert.equal(linked[0].nesting.status, "absent");
  assert.equal(linked[0].barrelLink, undefined);
  assert.equal(linked[1].nesting.leaf, "empty");
  const denied = build([record({ name: "prototype" })]);
  const access = collisionReport({ base: denied });
  assert.equal(access.propertyAccess.base[0].kind, "readonly-static");
  assert.equal(access.propertyAccess.base[0].rejectedPath, "Signal.Logistic.prototype");
  assert.equal(access.propertyAccess.base[0].prototypeId, "item/prototype");
});

test("CAT-27 CAT-28 предмет улья и пары астероида", () => {
  const item = record({ name: "captive-biter-spawner", subgroup: "production-machine" });
  const entity = record({ type: "entity", name: "captive-biter-spawner", subgroup: "enemies" });
  const kept = build([entity, item]);
  assert.equal(row(kept, "item/captive-biter-spawner").publicPath, "Signal.Production.captive_biter_spawner");
  assert.equal(row(kept, "entity/captive-biter-spawner").publicPath, null);
  assert.equal(row(kept, "entity/captive-biter-spawner").pathReason, "project-item-only");
  assert.equal(row(kept, "entity/captive-biter-spawner").publicSection, "Enemies");
  assert.equal(row(kept, "entity/captive-biter-spawner").signalSelection.state, "selectable");
  const biolabItem = record({ name: "biolab", subgroup: "production-machine" });
  const biolabEntity = record({ type: "entity", name: "biolab", subgroup: "production-machine" });
  const biolab = build([biolabEntity, biolabItem]);
  assert.equal(row(biolab, "item/biolab").publicPath, "Signal.Production.biolab");
  assert.equal(row(biolab, "item/biolab").gameType, "item");
  assert.equal(row(biolab, "entity/biolab").publicPath, null);
  assert.equal(row(biolab, "entity/biolab").pathReason, "chooser-observation-item-only");
  assert.equal(row(biolab, "entity/biolab").signalSelection.state, "selectable");
  assert.equal(biolab.rows.length, 2);
  const entityOnly = build([biolabEntity]);
  assert.equal(row(entityOnly, "entity/biolab").publicPath, null);
  assert.equal(row(entityOnly, "entity/biolab").pathReason, "chooser-observation-item-only");
  const crush = record({ type: "recipe", name: "metallic-asteroid-crushing", subgroup: "space-crushing" });
  const observed = ["metallic", "carbonic", "oxide", "promethium"].flatMap((name) => [
    record({ type: "asteroid-chunk", name: `${name}-asteroid-chunk`, subgroup: "space-material" }),
    record({ name: `${name}-asteroid-chunk`, subgroup: "space-material" }),
  ]);
  const open = build([...observed, crush]);
  for (const name of ["metallic", "carbonic", "oxide", "promethium"]) {
    const item = row(open, `item/${name}-asteroid-chunk`);
    const chunk = row(open, `asteroid-chunk/${name}-asteroid-chunk`);
    assert.equal(item.publicPath, `Signal.Space.${name}_asteroid_chunk`);
    assert.equal(item.pathReason, null);
    assert.equal(item.gameType, "item");
    assert.equal(chunk.publicPath, null);
    assert.equal(chunk.pathReason, "chooser-blueprint-item");
    assert.equal(chunk.signalSelection.state, "selectable");
    assert.equal(chunk.hideFromSignalGui.status, "absent");
    assert.equal(chunk.hideFromSignalGui.value, null);
    assert.equal(chunk.itemSignalAlias.status, "absent");
    assert.equal(chunk.itemSignalAlias.itemName, null);
    assert.notEqual(item.prototypeId, chunk.prototypeId);
  }
  assert.equal(row(open, "recipe/metallic-asteroid-crushing").publicPath, "Signal.Space.metallic_asteroid_crushing");
  assert.equal(row(open, "recipe/metallic-asteroid-crushing").gameType, "recipe");
  assert.equal(row(open, "recipe/metallic-asteroid-crushing").nesting.status, "absent");
  const unrelated = build([
    record({ name: "other-chunk", subgroup: "space-material" }),
    record({ type: "asteroid-chunk", name: "other-chunk", subgroup: "space-material" }),
  ]);
  assert.equal(row(unrelated, "item/other-chunk").pathReason, "collision");
  assert.equal(row(unrelated, "asteroid-chunk/other-chunk").pathReason, "collision");
  const metal = record({ name: "metallic-asteroid-chunk", subgroup: "space-material" });
  const hidden = build([
    metal,
    crush,
    record({ type: "asteroid-chunk", name: "metallic-asteroid-chunk", subgroup: "space-material", hide_from_signal_gui: true, item_signal_alias: "metallic-asteroid-chunk" }),
  ]);
  assert.equal(row(hidden, "item/metallic-asteroid-chunk").publicPath, "Signal.Space.metallic_asteroid_chunk");
  assert.equal(row(hidden, "asteroid-chunk/metallic-asteroid-chunk").publicPath, null);
  assert.equal(row(hidden, "asteroid-chunk/metallic-asteroid-chunk").pathReason, "asteroid-item-alias");
  assert.equal(row(hidden, "recipe/metallic-asteroid-crushing").publicPath, "Signal.Space.metallic_asteroid_crushing");
  assert.notEqual(
    row(hidden, "recipe/metallic-asteroid-crushing").prototypeId,
    row(hidden, "item/metallic-asteroid-chunk").prototypeId,
  );
  assert.equal(row(hidden, "asteroid-chunk/metallic-asteroid-chunk").signalSelection.state, "hidden");
  assert.equal(row(hidden, "asteroid-chunk/metallic-asteroid-chunk").itemSignalAlias.itemName, "metallic-asteroid-chunk");
  const onlyHide = build([
    metal,
    record({ type: "asteroid-chunk", name: "metallic-asteroid-chunk", subgroup: "space-material", hide_from_signal_gui: true }),
  ]);
  assert.equal(row(onlyHide, "asteroid-chunk/metallic-asteroid-chunk").pathReason, "not-selectable");
  assert.equal(row(onlyHide, "item/metallic-asteroid-chunk").publicPath, "Signal.Space.metallic_asteroid_chunk");
  const aliasOnly = build([
    metal,
    record({ type: "asteroid-chunk", name: "metallic-asteroid-chunk", subgroup: "space-material", item_signal_alias: "other-chunk" }),
  ]);
  assert.equal(row(aliasOnly, "asteroid-chunk/metallic-asteroid-chunk").pathReason, "asteroid-item-alias");
  assert.equal(row(aliasOnly, "asteroid-chunk/metallic-asteroid-chunk").itemSignalAlias.itemName, "other-chunk");
  assert.equal(row(aliasOnly, "item/metallic-asteroid-chunk").publicPath, "Signal.Space.metallic_asteroid_chunk");
  const shown = build([
    record({ type: "asteroid-chunk", name: "oxide-asteroid-chunk", subgroup: "space-material", hide_from_signal_gui: false }),
  ]);
  assert.equal(row(shown, "asteroid-chunk/oxide-asteroid-chunk").publicPath, "Signal.Space.oxide_asteroid_chunk");
  assert.equal(row(shown, "asteroid-chunk/oxide-asteroid-chunk").hideFromSignalGui.value, false);
  const shownPair = build([
    record({ name: "oxide-asteroid-chunk", subgroup: "space-material" }),
    record({ type: "asteroid-chunk", name: "oxide-asteroid-chunk", subgroup: "space-material", hide_from_signal_gui: false }),
  ]);
  assert.equal(row(shownPair, "item/oxide-asteroid-chunk").publicPath, "Signal.Space.oxide_asteroid_chunk");
  assert.equal(row(shownPair, "asteroid-chunk/oxide-asteroid-chunk").publicPath, null);
  assert.equal(row(shownPair, "asteroid-chunk/oxide-asteroid-chunk").pathReason, "chooser-blueprint-item");
  assert.equal(row(shownPair, "asteroid-chunk/oxide-asteroid-chunk").hideFromSignalGui.value, false);
  assert.equal(row(shownPair, "asteroid-chunk/oxide-asteroid-chunk").signalSelection.state, "selectable");
  expectCode(() => build([record({ item_signal_alias: "x" })]), "bad-record");
  expectCode(() => build([record({ hide_from_signal_gui: false })]), "bad-record");
  expectCode(() => build([record({ type: "asteroid-chunk", name: "chunk", subgroup: "space-material", item_signal_alias: 1 })]), "bad-record");
  const blankAlias = build([
    record({ type: "asteroid-chunk", name: "chunk", subgroup: "space-material", item_signal_alias: "" }),
  ]);
  assert.equal(row(blankAlias, "asteroid-chunk/chunk").itemSignalAlias.status, "absent");
  assert.equal(row(blankAlias, "asteroid-chunk/chunk").publicPath, "Signal.Space.chunk");
});

test("CAT-20 индекс читает путь любой глубины", () => {
  const token = (prototypeId, gameType) => ({ prototypeId, gameType, gameName: prototypeId, role: "ordinary", channel: true });
  const paths = {
    "Signal.Space.chunk.tail.leaf": token("recipe/tail", "recipe"),
    "Signal.Intermediate.water_barrel": token("item/water-barrel", "item"),
    "Signal.Intermediate.water_barrel.fill": token("recipe/water-barrel", "recipe"),
  };
  const forward = mountSignals(paths);
  const backward = mountSignals(Object.fromEntries(Object.entries(paths).reverse()));
  assert.equal(readSignal(forward, "Signal.Intermediate.water_barrel").prototypeId, "item/water-barrel");
  assert.equal(readSignal(forward, "Signal.Intermediate.water_barrel.fill").prototypeId, "recipe/water-barrel");
  assert.equal(readSignal(forward, "Signal.Space.chunk.tail.leaf").prototypeId, "recipe/tail");
  assert.equal(readSignal(backward, "Signal.Space.chunk.tail.leaf").gameType, "recipe");
  assert.equal(readSignal(forward, "Signal.Space.chunk.tail"), null);
  expectCode(() => readSignal(forward, "Signal.Space"), "schema");
  expectCode(() => readSignal(forward, ""), "schema");
  expectCode(() => readSignal(forward, null), "schema");
  assert.equal(readSignal({ Space: null }, "Signal.Space.chunk"), null);
  assert.equal(readSignal({ Space: { chunk: "x" } }, "Signal.Space.chunk.leaf"), null);
  expectCode(() => mountSignals(null), "schema");
  expectCode(() => mountSignals({ "Signal.Only": token("item/x", "item") }), "schema");
  expectCode(() => mountSignals({ "Group.A.b": token("item/x", "item") }), "schema");
  expectCode(() => mountSignals({ "Signal.A.": token("item/x", "item") }), "schema");
  expectCode(() => mountSignals({ "Signal.A.b": { gameType: "item" } }), "schema");
  expectCode(() => mountSignals([
    { publicPath: "Signal.Logistic.wood", ...token("item/wood", "item") },
    { publicPath: "Signal.Logistic.wood", ...token("recipe/wood", "recipe") },
  ]), "collision");
  const same = mountSignals([
    { publicPath: "Signal.Logistic.wood", ...token("item/wood", "item") },
    { publicPath: "Signal.Logistic.wood", ...token("item/wood", "item"), channel: false },
  ]);
  assert.equal(readSignal(same, "Signal.Logistic.wood").channel, false);
});

test("ключ иконки сохраняет порядок слоёв и не зависит от порядка полей", () => {
  const left = iconKey({ layers: [{ icon: "a", icon_size: 1 }, { icon: "b" }] });
  const right = iconKey({ layers: [{ icon_size: 1, icon: "a" }, { icon: "b" }] });
  const reversed = iconKey({ layers: [{ icon: "b" }, { icon: "a", icon_size: 1 }] });
  assert.equal(left, right);
  assert.notEqual(left, reversed);
  assert.deepEqual(standardGroups().groups.map((group) => group.name).includes("tiles"), true);
});
