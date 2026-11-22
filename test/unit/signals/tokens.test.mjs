import assert from "node:assert/strict";
import test from "node:test";
import { compareText } from "../../../src/compare.js";
import { addInt32, INT32_MAX, INT32_MIN, isInt32 } from "../../../src/int32.js";
import { buildQualityTokens, createProfile, openProfile } from "../../../src/signal-profile.js";
import { addToTable, createTable } from "../../../src/signal-table.js";
import { assembleSignals } from "../../../src/signal-tree.js";
import {
  OperationToken,
  Quality,
  Signal,
  channelKey,
  isMetaToken,
  isOperationToken,
  isQualitySelectorToken,
  isQualityToken,
  isSignalToken,
} from "../../../src/index.js";
import { collectTokens, signalRow, throwsCode } from "./support.mjs";

const allowed = new Set(["normal", "rare"]);

test("TOK-1 TOK-2 обычный токен, ключ тройки и withQuality", () => {
  const chest = Signal.Logistic.wooden_chest;
  const same = chest.withQuality(Quality.NORMAL);
  const imported = openProfile("base").importSignal({ type: "item", name: "wooden-chest" });
  assert.equal(chest.kind, "signal");
  assert.equal(chest.type, "item");
  assert.equal(chest.name, "wooden-chest");
  assert.equal(chest.quality, "normal");
  assert.equal(chest.profile, "base");
  assert.equal(chest.metadata.publicPath, "Signal.Logistic.wooden_chest");
  assert.equal(chest.metadata.section, "Logistic");
  assert.equal(chest.metadata.group, "logistics");
  assert.equal(chest.metadata.prototypeId, "item/wooden-chest");
  assert.equal(chest.metadata.jsName, "wooden_chest");
  assert.equal(chest.metadata.source, "constant");
  assert.equal(chest.metadata.derived, false);
  assert.equal(chest.metadata.role, "ordinary");
  assert.notEqual(chest, same);
  assert.notEqual(chest, imported);
  assert.equal(same.quality, "normal");
  assert.equal(same.metadata.derived, true);
  assert.equal(same.metadata.source, "withQuality");
  assert.equal(same.metadata.jsName, "wooden_chest");
  assert.equal(same.metadata.group, "logistics");
  assert.equal(imported.metadata.jsName, null);
  assert.equal(imported.metadata.source, "import");
  assert.equal(imported.metadata.derived, false);
  assert.equal(imported.profile, "base");
  const key = JSON.stringify(["item", "wooden-chest", "normal"]);
  assert.equal(channelKey(chest), key);
  assert.equal(channelKey(same), key);
  assert.equal(channelKey(imported), key);
  assert.equal(key.includes("logistics"), false);
  assert.equal(key.includes("wooden_chest"), false);
  assert.equal(key.includes("Logistic"), false);
  assert.equal(Object.isFrozen(chest), true);
  assert.equal(Object.isFrozen(same), true);
  assert.equal(Object.isFrozen(imported), true);
  assert.equal(Object.isFrozen(chest.metadata), true);
  assert.throws(() => {
    chest.quality = "rare";
  }, TypeError);
  assert.throws(() => {
    chest.metadata.group = "other";
  }, TypeError);
  assert.equal(chest.quality, "normal");
  assert.equal(chest.metadata.group, "logistics");
  for (const quality of [Quality.UNCOMMON, Quality.RARE, Quality.EPIC, Quality.LEGENDARY]) {
    throwsCode(() => chest.withQuality(quality), "unavailable-quality");
  }
  assert.equal(chest.quality, "normal");
  throwsCode(() => chest.withQuality("rare"), "invalid-quality");
  throwsCode(() => chest.withQuality(chest), "invalid-quality");
  throwsCode(() => chest.withQuality(Signal.Meta.signal_each), "invalid-quality");
  throwsCode(() => chest.withQuality(new OperationToken("Arithmetic", "SUM")), "invalid-quality");
  throwsCode(() => chest.withQuality(null), "invalid-quality");
});

test("TOK-2 TOK-4 профиль space-age проверяет качество и не подменяет base", () => {
  const space = openProfile("space-age");
  assert.equal(openProfile("space-age"), space);
  assert.equal(Signal, openProfile("base").tree);
  assert.equal(openProfile("base").gameVersion, "2.1.24");
  assert.equal(space.gameVersion, "2.1.24");
  const iron = space.tree.Intermediate.iron_plate;
  const rare = iron.withQuality(Quality.RARE);
  const imported = space.importSignal({ type: "item", name: "iron-plate", quality: "rare" });
  assert.equal(iron.quality, "normal");
  assert.equal(rare.quality, "rare");
  assert.equal(rare.profile, "space-age");
  assert.equal(imported.quality, "rare");
  assert.equal(channelKey(rare), channelKey(imported));
  assert.notEqual(channelKey(rare), channelKey(iron));
  assert.equal(channelKey(rare), JSON.stringify(["item", "iron-plate", "rare"]));
  for (const quality of [Quality.NORMAL, Quality.UNCOMMON, Quality.RARE, Quality.EPIC, Quality.LEGENDARY]) {
    const token = iron.withQuality(quality);
    assert.equal(token.quality, quality.name);
    assert.equal(token.metadata.derived, true);
  }
  assert.equal(Quality.NORMAL.kind, "quality");
  assert.equal(Quality.NORMAL.name, "normal");
  assert.deepEqual(
    [Quality.NORMAL, Quality.UNCOMMON, Quality.RARE, Quality.EPIC, Quality.LEGENDARY].map((item) => [item.name, item.level]),
    [["normal", 0], ["uncommon", 1], ["rare", 2], ["epic", 3], ["legendary", 5]],
  );
  assert.equal(isQualityToken(Quality.LEGENDARY), true);
  assert.equal(isQualityToken(iron), false);
  assert.equal(Object.isFrozen(Quality), true);
  assert.equal(Object.isFrozen(Quality.EPIC), true);
  assert.equal(Signal.Combat.railgun, undefined);
  assert.equal(space.tree.Combat.railgun.name, "railgun");
  assert.equal(space.tree.Combat.railgun.profile, "space-age");
  throwsCode(() => openProfile("base").importSignal({ type: "item", name: "railgun" }), "unknown-signal");
  throwsCode(() => space.importSignal({ type: "item", name: "not-a-real-signal", quality: "rare" }), "unknown-signal");
});

test("TOK-3 метасигнал, операция и произвольный объект не являются каналом", () => {
  const each = Signal.Meta.signal_each;
  const everything = Signal.Meta.signal_everything;
  const anything = Signal.Meta.signal_anything;
  assert.deepEqual([each.name, everything.name, anything.name], ["each", "everything", "anything"]);
  assert.equal(each.kind, "meta");
  assert.equal(each.profile, "base");
  assert.equal(each.metadata.gameName, "signal-each");
  assert.equal(each.metadata.group, null);
  assert.equal(each.metadata.section, "Meta");
  assert.equal(each.type, undefined);
  assert.equal(isMetaToken(each), true);
  assert.equal(isSignalToken(each), false);
  assert.equal(Object.isFrozen(each), true);
  throwsCode(() => channelKey(each), "meta-signal");
  throwsCode(() => openProfile("base").importSignal({ type: "virtual", name: "signal-each" }), "meta-signal");
  const operation = new OperationToken("Arithmetic", "SUM");
  assert.equal(operation.kind, "operation");
  assert.equal(operation.owner, "Arithmetic");
  assert.equal(operation.name, "SUM");
  assert.equal(isOperationToken(operation), true);
  assert.equal(isOperationToken({ kind: "operation", owner: "Arithmetic", name: "SUM" }), false);
  assert.equal(Object.isFrozen(operation), true);
  assert.throws(() => {
    operation.name = "SUB";
  }, TypeError);
  throwsCode(() => channelKey(operation), "invalid-signal");
  throwsCode(() => channelKey(Quality.NORMAL), "invalid-signal");
  throwsCode(() => channelKey({ kind: "signal", type: "item", name: "wooden-chest", quality: "normal" }), "invalid-signal");
  throwsCode(() => new OperationToken("", "SUM"), "invalid-operation");
  throwsCode(() => new OperationToken(1, "SUM"), "invalid-operation");
  throwsCode(() => new OperationToken("Arithmetic", ""), "invalid-operation");
  throwsCode(() => new OperationToken("Arithmetic", 1), "invalid-operation");
});

test("полный каталог base и space-age, восемь типов не сводятся к предметам", () => {
  const baseTokens = collectTokens(Signal, (token) => isSignalToken(token) || isMetaToken(token) || isQualitySelectorToken(token));
  const spaceTokens = collectTokens(openProfile("space-age").tree, (token) => isSignalToken(token) || isMetaToken(token) || isQualitySelectorToken(token));
  assert.equal(baseTokens.length, 570);
  assert.equal(spaceTokens.length, 697);
  assert.equal(baseTokens.filter(isMetaToken).length, 3);
  assert.equal(spaceTokens.filter(isMetaToken).length, 3);
  assert.equal(baseTokens.filter(isSignalToken).every((token) => token.quality === "normal"), true);
  assert.equal(Signal.Intermediate.iron_plate.type, "item");
  assert.equal(Signal.Fluids.crude_oil.type, "fluid");
  assert.equal(Signal.Fluids.crude_oil.name, "crude-oil");
  assert.equal(Signal.Combat.defender.type, "entity");
  assert.equal(Signal.Intermediate.water_barrel.type, "item");
  assert.equal(Signal.Intermediate.water_barrel.name, "water-barrel");
  assert.equal(Signal.Intermediate.water_barrel.fill.type, "recipe");
  assert.equal(Signal.Intermediate.water_barrel.fill.name, "water-barrel");
  assert.equal(Signal.Intermediate.water_barrel.empty.name, "empty-water-barrel");
  assert.equal(Signal.Signals.signal_A.type, "virtual");
  assert.equal(Signal.Signals.signal_A.name, "signal-A");
  assert.notEqual(channelKey(Signal.Intermediate.water_barrel), channelKey(Signal.Intermediate.water_barrel.fill));
  assert.equal(Object.isFrozen(Signal.Intermediate), true);
  assert.equal(Object.isFrozen(Signal.Intermediate.water_barrel), true);
  assert.throws(() => {
    Signal.Intermediate.water_barrel.fill = null;
  }, TypeError);
  const space = openProfile("space-age").tree;
  assert.equal(space.Space.aquilo.type, "space-location");
  assert.equal(space.Space.aquilo.name, "aquilo");
  assert.equal(space.Unsorted.epic.type, "quality");
  assert.equal(space.Unsorted.epic.name, "epic");
  assert.equal(space.Unsorted.epic.quality, "normal");
  const anyQuality = space.Unsorted.signal_any_quality;
  assert.equal(anyQuality.kind, "quality-selector");
  assert.equal(anyQuality.name, "signal-any-quality");
  assert.equal(anyQuality.profile, "space-age");
  assert.equal(anyQuality.metadata.group, "other");
  assert.equal(isQualitySelectorToken(anyQuality), true);
  assert.equal(isSignalToken(anyQuality), false);
  assert.equal(Object.isFrozen(anyQuality), true);
  throwsCode(() => channelKey(anyQuality), "invalid-signal");
  throwsCode(() => openProfile("space-age").importSignal({ type: "virtual", name: "signal-any-quality" }), "invalid-signal");
  assert.equal(Object.hasOwn(Signal, "Space"), false);
  assert.equal(baseTokens.some((token) => isSignalToken(token) && token.type === "asteroid-chunk"), false);
});

test("compareText и int32", () => {
  assert.equal(compareText("a", "b"), -1);
  assert.equal(compareText("b", "a"), 1);
  assert.equal(compareText("a", "a"), 0);
  assert.equal(isInt32(0), true);
  assert.equal(isInt32(INT32_MAX), true);
  assert.equal(isInt32(INT32_MIN), true);
  assert.equal(isInt32(-0), true);
  assert.equal(isInt32("1"), false);
  assert.equal(isInt32(1.5), false);
  assert.equal(isInt32(INT32_MAX + 1), false);
  assert.equal(isInt32(INT32_MIN - 1), false);
  assert.equal(addInt32(INT32_MAX, 1), INT32_MIN);
  assert.equal(addInt32(INT32_MIN, -1), INT32_MAX);
  assert.equal(addInt32(-3, 1), -2);
  assert.equal(addInt32(0, -0), 0);
  throwsCode(() => addToTable(createTable(), Signal.Signals.signal_A, 1.5), "invalid-constant");
});

test("сборка дерева отклоняет повреждённый индекс", () => {
  const chest = ["Signal.Logistic.wooden_chest", signalRow("item", "wooden-chest")];
  const each = ["Signal.Meta.signal_each", signalRow("virtual", "signal-each", { role: "meta", channel: false })];
  const { tree, index, special } = assembleSignals("base", [
    chest,
    ["Signal.Intermediate.water_barrel", signalRow("item", "water-barrel")],
    ["Signal.Intermediate.water_barrel.fill", signalRow("recipe", "water-barrel")],
    ["Signal.Logistic.belt", signalRow("item", "belt")],
    each,
  ], allowed);
  assert.equal(tree.Logistic.wooden_chest.name, "wooden-chest");
  assert.equal(tree.Intermediate.water_barrel.fill.type, "recipe");
  assert.equal(index.has("item/wooden-chest"), true);
  assert.equal(special.get("virtual/signal-each"), "meta");
  assert.equal(Object.isFrozen(tree.Logistic.wooden_chest), true);

  throwsCode(() => assembleSignals("base", [chest, chest], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [chest, ["Signal.Logistic.other", signalRow("item", "wooden-chest")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [each, ["Signal.Signals.signal_each", signalRow("virtual", "signal-each", { role: "meta", channel: false })]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [
    ["Signal.Signals.signal_each", signalRow("virtual", "signal-each")],
    each,
  ], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [each, ["Signal.Logistic.each", signalRow("virtual", "signal-each")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Nope.a", signalRow("item", "a")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Meta.signal_nope", signalRow("virtual", "signal-nope", { role: "meta", channel: false })]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.hidden", signalRow("item", "hidden", { channel: false })]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.bad", signalRow("item", "bad", { role: "technical" })]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.bad", signalRow("item", "bad", { channel: "yes" })]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.bad", null]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.bad", []]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.bad", "x"]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [[1, signalRow("item", "a")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["", signalRow("item", "a")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Nope.A.b", signalRow("item", "a")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Only", signalRow("item", "a")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal..a", signalRow("item", "a")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.", signalRow("item", "a")]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.bad", { channel: true, gameType: 1, gameName: "bad", prototypeId: "item/bad", role: "ordinary" }]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.bad", { channel: true, gameType: "item", gameName: "", prototypeId: "item/bad", role: "ordinary" }]], allowed), "invalid-catalog");
  throwsCode(() => assembleSignals("base", [["Signal.Logistic.missing.child", signalRow("item", "child")]], allowed), "invalid-catalog");
  const empty = assembleSignals("base", [], allowed);
  assert.deepEqual(Object.keys(empty.tree), []);
});

test("createProfile и качества отклоняют неполный каталог", () => {
  const qualities = {
    entries: [
      { gameName: "normal", role: "technical", level: { value: 0 } },
      { gameName: "uncommon", role: "ordinary", level: { value: 1 } },
      { gameName: "rare", role: "ordinary", level: { value: 2 } },
      { gameName: "epic", role: "ordinary", level: { value: 3 } },
      { gameName: "legendary", role: "ordinary", level: { value: 5 } },
      { gameName: "quality-unknown", role: "technical", level: { value: 0 } },
    ],
  };
  const profile = createProfile("custom", { gameVersion: "2.1.24", paths: {} }, qualities);
  assert.equal(profile.name, "custom");
  assert.equal(profile.gameVersion, "2.1.24");
  throwsCode(() => profile.importSignal({ type: "item", name: "wooden-chest" }), "unknown-signal");
  const tokens = buildQualityTokens(qualities);
  assert.equal(tokens.NORMAL.level, 0);
  assert.equal(tokens.LEGENDARY.level, 5);
  throwsCode(() => createProfile("", { gameVersion: "2.1.24", paths: {} }, qualities), "invalid-profile");
  throwsCode(() => createProfile(1, { gameVersion: "2.1.24", paths: {} }, qualities), "invalid-profile");
  throwsCode(() => createProfile("custom", null, qualities), "invalid-catalog");
  throwsCode(() => createProfile("custom", "x", qualities), "invalid-catalog");
  throwsCode(() => createProfile("custom", {}, qualities), "invalid-catalog");
  throwsCode(() => createProfile("custom", { gameVersion: 1, paths: {} }, qualities), "invalid-catalog");
  throwsCode(() => createProfile("custom", { gameVersion: "2.1.24" }, qualities), "invalid-catalog");
  throwsCode(() => createProfile("custom", { gameVersion: "2.1.24", paths: "x" }, qualities), "invalid-catalog");
  throwsCode(() => createProfile("custom", { gameVersion: "2.1.24", paths: [] }, qualities), "invalid-catalog");
  throwsCode(() => createProfile("custom", { gameVersion: "2.1.24", paths: {} }, null), "invalid-catalog");
  throwsCode(() => createProfile("custom", { gameVersion: "2.1.24", paths: {} }, {}), "invalid-catalog");
  throwsCode(() => openProfile("mod"), "invalid-profile");
  throwsCode(() => buildQualityTokens(null), "invalid-catalog");
  throwsCode(() => buildQualityTokens({}), "invalid-catalog");
  throwsCode(() => buildQualityTokens({ entries: [] }), "invalid-catalog");
  throwsCode(() => buildQualityTokens({ entries: [{ gameName: "normal", role: "ordinary" }] }), "invalid-catalog");
  throwsCode(() => buildQualityTokens({
    entries: [{ gameName: "normal", role: "ordinary", level: { value: 1.5 } }],
  }), "invalid-catalog");
});

test("импорт ключа проверяет форму и качество", () => {
  const profile = openProfile("base");
  const imported = profile.importSignal({ type: "item", name: "wooden-chest", quality: "normal" });
  assert.equal(imported.quality, "normal");
  const again = imported.withQuality(Quality.NORMAL);
  assert.equal(again.metadata.jsName, null);
  assert.equal(again.metadata.derived, true);
  throwsCode(() => profile.importSignal(null), "invalid-signal");
  throwsCode(() => profile.importSignal("item"), "invalid-signal");
  throwsCode(() => profile.importSignal([]), "invalid-signal");
  throwsCode(() => profile.importSignal({ type: "item", name: "wooden-chest", note: true }), "invalid-signal");
  throwsCode(() => profile.importSignal({ type: 1, name: "wooden-chest" }), "invalid-signal");
  throwsCode(() => profile.importSignal({ type: "", name: "wooden-chest" }), "invalid-signal");
  throwsCode(() => profile.importSignal({ type: "item", name: 1 }), "invalid-signal");
  throwsCode(() => profile.importSignal({ type: "item", name: "" }), "invalid-signal");
  throwsCode(() => profile.importSignal({ type: "item", name: "wooden-chest", quality: 1 }), "invalid-quality");
  throwsCode(() => profile.importSignal({ type: "item", name: "wooden-chest", quality: "" }), "invalid-quality");
  throwsCode(() => profile.importSignal({ type: "item", name: "wooden-chest", quality: "rare" }), "unavailable-quality");
  throwsCode(() => profile.importSignal({ type: "item", name: "missing" }), "unknown-signal");
});
