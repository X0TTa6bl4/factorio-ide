/**
 * Обзор снимка 2.1.24 для меню сигналов постоянного комбинатора.
 * Не назначает publicPath и не подтверждает chooser.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { iconKey } from "../../../../../tools/signal-catalog/build.mjs";
import { joinPath, publicName, sectionForGroup } from "../../../../../tools/signal-catalog/names.mjs";

const root = new URL("../../../../../data/factorio/2.1.24/", import.meta.url);
const typeFiles = {
  item: "items.json",
  fluid: "fluids.json",
  virtual: "virtual-signals.json",
  entity: "entities.json",
  recipe: "recipes.json",
  "space-location": "space-locations.json",
  "asteroid-chunk": "asteroid-chunks.json",
  quality: "qualities.json",
};

function loadJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function iconBrief(record) {
  const layers = record.icon?.layers;
  if (!Array.isArray(layers)) return null;
  return layers.map((layer) => layer.icon ?? null);
}

function loadProfile(profile) {
  const dir = new URL(`${profile}/`, root);
  const groupsDoc = loadJson(new URL("groups.json", dir));
  const subgroups = new Map(groupsDoc.subgroups.map((entry) => [entry.name, entry]));
  const records = [];
  for (const file of Object.values(typeFiles)) {
    records.push(...loadJson(new URL(file, dir)));
  }
  return { groupsDoc, subgroups, records };
}

function tally(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = keyFn(record);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function brief(record, subgroups) {
  const subgroup = subgroups.get(record.subgroup);
  return {
    id: record.id,
    prototypeType: record.prototypeType,
    role: record.role,
    hidden: record.hidden,
    parameter: record.parameter,
    subgroup: record.subgroup ?? null,
    group: subgroup?.group ?? null,
    section: subgroup ? sectionForGroup(subgroup.group) : null,
    order: record.order ?? null,
    labelEn: record.label?.en ?? null,
    labelRu: record.label?.ru ?? null,
    hideFromSignalGui: Object.hasOwn(record, "hide_from_signal_gui") ? record.hide_from_signal_gui : null,
    factoriopediaAlternative: record.factoriopedia_alternative ?? null,
    placeResult: record.place_result ?? null,
    icons: iconBrief(record),
  };
}

function recipeDerived(record, iconIndex) {
  if (record.type !== "recipe" || Object.hasOwn(record, "hide_from_signal_gui")) return null;
  const key = iconKey(record.icon);
  if (!key) return { state: "unconfirmed", matched: [] };
  const matched = iconIndex.get(key) ?? [];
  if (record.hidden || matched.length > 0) return { state: "hidden-by-docs", matched };
  return { state: "selectable-by-docs", matched: [] };
}

function survey(profile) {
  const { groupsDoc, subgroups, records } = loadProfile(profile);
  const iconIndex = new Map();
  for (const record of records) {
    if (!["item", "fluid", "virtual"].includes(record.type)) continue;
    const key = iconKey(record.icon);
    if (!key) continue;
    const list = iconIndex.get(key) ?? [];
    list.push(record.id);
    iconIndex.set(key, list);
  }
  for (const list of iconIndex.values()) list.sort();

  const byName = new Map();
  for (const record of records) {
    const list = byName.get(record.name) ?? [];
    list.push(record);
    byName.set(record.name, list);
  }

  const sameName = [];
  for (const [name, list] of byName) {
    const types = new Set(list.map((record) => record.type));
    if (list.length < 2 || types.size < 2) continue;
    const rows = list.map((record) => {
      const row = brief(record, subgroups);
      row.publicName = publicName(record.name);
      row.candidatePath = row.section ? joinPath(row.section, row.publicName) : null;
      row.recipeDocs = recipeDerived(record, iconIndex);
      row.iconKey = iconKey(record.icon);
      return row;
    });
    rows.sort((left, right) => left.id.localeCompare(right.id));
    const iconKeys = new Set(rows.map((row) => row.iconKey).filter(Boolean));
    sameName.push({
      name,
      types: [...types].sort(),
      sameIcon: iconKeys.size === 1,
      records: rows.map(({ iconKey: _iconKey, ...row }) => row),
    });
  }
  sameName.sort((left, right) => left.name.localeCompare(right.name));

  const recipeDocs = { hidden: 0, selectable: 0, unconfirmed: 0, explicitTrue: 0, explicitFalse: 0 };
  const recipeExplicitFalse = [];
  const recipeDocsSelectable = [];
  for (const record of records) {
    if (record.type !== "recipe") continue;
    if (Object.hasOwn(record, "hide_from_signal_gui")) {
      if (record.hide_from_signal_gui) recipeDocs.explicitTrue += 1;
      else {
        recipeDocs.explicitFalse += 1;
        recipeExplicitFalse.push(record.id);
      }
      continue;
    }
    const derived = recipeDerived(record, iconIndex);
    if (derived.state === "hidden-by-docs") recipeDocs.hidden += 1;
    else if (derived.state === "selectable-by-docs") {
      recipeDocs.selectable += 1;
      if (!record.hidden && !record.parameter && record.role === "signal" && record.subgroup) {
        recipeDocsSelectable.push(record.id);
      }
    } else recipeDocs.unconfirmed += 1;
  }

  const grouped = {};
  for (const record of records) {
    if (record.hidden || record.parameter || record.role !== "signal" || !record.subgroup) continue;
    const subgroup = subgroups.get(record.subgroup);
    const group = subgroup?.group ?? "missing-subgroup-def";
    const section = sectionForGroup(group);
    const bucket = grouped[group] ?? { section, order: groupsDoc.groups.find((entry) => entry.name === group)?.order ?? null, types: {} };
    bucket.types[record.type] = (bucket.types[record.type] ?? 0) + 1;
    grouped[group] = bucket;
  }

  const focusNames = [
    "biolab",
    "captive-biter-spawner",
    "wooden-chest",
    "constant-combinator",
    "metallic-asteroid-chunk",
    "carbonic-asteroid-chunk",
    "oxide-asteroid-chunk",
    "promethium-asteroid-chunk",
    "water-barrel",
    "empty-water-barrel",
    "barrel",
    "signal-each",
    "signal-everything",
    "signal-anything",
    "signal-any-quality",
  ];

  return {
    input: records.length,
    byType: tally(records, (record) => record.type),
    byRole: tally(records, (record) => record.role),
    hiddenTrue: records.filter((record) => record.hidden).length,
    parameterTrue: records.filter((record) => record.parameter).length,
    subgroupPresent: records.filter((record) => record.subgroup).length,
    subgroupAbsent: records.filter((record) => !record.subgroup).length,
    hideKeyPresent: records.filter((record) => Object.hasOwn(record, "hide_from_signal_gui")).length,
    factoriopediaAlternativePresent: records.filter((record) => Object.hasOwn(record, "factoriopedia_alternative")).length,
    hiddenInFactoriopediaPresent: records.filter((record) => Object.hasOwn(record, "hidden_in_factoriopedia")).length,
    groups: groupsDoc.groups.map((group) => ({ name: group.name, order: group.order, section: sectionForGroup(group.name) })),
    groupedNotHidden: grouped,
    recipeDocs,
    recipeExplicitFalse,
    recipeDocsSelectable,
    sameNameCount: sameName.length,
    groupedPairs: sameName.flatMap((entry) => {
      const visible = entry.records.filter((row) => row.hidden === false && row.parameter === false && row.role === "signal" && row.subgroup);
      if (visible.length < 2) return [];
      const generatorVisible = visible.filter((row) => {
        if (row.recipeDocs?.state === "hidden-by-docs") return false;
        if (row.hideFromSignalGui === true) return false;
        return true;
      });
      return [{
        name: entry.name,
        sameIcon: entry.sameIcon,
        sections: [...new Set(visible.map((row) => row.section))],
        generatorCandidateIds: generatorVisible.map((row) => row.id),
        records: visible.map((row) => ({
          id: row.id,
          subgroup: row.subgroup,
          group: row.group,
          section: row.section,
          order: row.order,
          hideFromSignalGui: row.hideFromSignalGui,
          recipeDocs: row.recipeDocs?.state ?? null,
          labelEn: row.labelEn,
          labelRu: row.labelRu,
        })),
      }];
    }),
    focus: focusNames.flatMap((name) => sameName.filter((entry) => entry.name === name).concat(
      byName.has(name) && !sameName.some((entry) => entry.name === name)
        ? [{ name, types: [byName.get(name)[0].type], sameIcon: true, records: byName.get(name).map((record) => brief(record, subgroups)) }]
        : [],
    )),
    qualities: records.filter((record) => record.type === "quality").map((record) => brief(record, subgroups)),
    spaceLocations: records.filter((record) => record.type === "space-location").map((record) => brief(record, subgroups)),
    asteroidChunks: records.filter((record) => record.type === "asteroid-chunk").map((record) => brief(record, subgroups)),
    asteroidEntities: records
      .filter((record) => record.type === "entity" && record.prototypeType === "asteroid")
      .map((record) => brief(record, subgroups)),
  };
}

const report = {
  menuConfirmed: false,
  gameVersion: "2.1.24",
  extraction: "official-lua-data-stages",
  note: "Счётчики описывают data stage снимка. Они не являются составом меню постоянного комбинатора.",
  profiles: {
    base: survey("base"),
    "space-age": survey("space-age"),
  },
};

const out = new URL("./constant-combinator-menu.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

function pairLine(entry) {
  return {
    name: entry.name,
    sameIcon: entry.sameIcon,
    sections: entry.sections,
    generator: entry.generatorCandidateIds,
    rows: entry.records.map((row) => `${row.id} group=${row.group} hide=${row.hideFromSignalGui} docs=${row.recipeDocs}`),
  };
}

for (const profile of ["base", "space-age"]) {
  const data = report.profiles[profile];
  const collisions = data.groupedPairs.filter((entry) => entry.generatorCandidateIds.length >= 2);
  const single = data.groupedPairs.filter((entry) => entry.generatorCandidateIds.length < 2);
  console.log(`\n## ${profile} collisions ${collisions.length} / grouped-pairs ${data.groupedPairs.length}`);
  for (const entry of collisions) console.log(JSON.stringify(pairLine(entry)));
  console.log(`-- generator keeps one --`);
  for (const entry of single) console.log(JSON.stringify(pairLine(entry)));
  const explicitTrue = data.recipeExplicitFalse ? null : null;
  console.log("explicit false", data.recipeExplicitFalse);
}
