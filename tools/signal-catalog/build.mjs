import {
  absentNesting,
  applyBarrelLinks,
  excludeBiolabEntity,
  excludeCaptiveEntity,
  excludeObservedAsteroidChunks,
  finishBarrelLinks,
  markBarrelActions,
} from "./decisions.mjs";
import { CatalogError } from "./errors.mjs";
import { applyChooserReview, reviewMembership } from "./chooser-review.mjs";
import { ASTEROID_SIGNAL_NOTE, BIOLAB_SIGNAL_NOTE, EXPECTED, PROPOSAL, RECIPE_HIDE_RULE, SIGNAL_QUALITY_DEFAULT, TYPE_FILES } from "./expected.mjs";
import { compareText, stableValue } from "./format.mjs";
import { META_SECTION, joinPath, nameCheck, sectionForGroup } from "./names.mjs";

const SIGNAL_TYPES = new Set(Object.keys(TYPE_FILES));
const ICON_TYPES = new Set(["item", "fluid", "virtual"]);
const DIFF_FIELDS = [
  "role", "channel", "publicPath", "publicSection", "group", "subgroup", "prototypeOrder",
  "label", "localisedName", "hidden", "stackSize", "weight", "signalSelection",
  "recipeHideFromSignalGui", "hideFromSignalGui", "itemSignalAlias", "nesting", "icon",
];

function present(value) {
  return { status: "present", value };
}

function absent() {
  return { status: "absent", value: null };
}

function optionalString(record, key) {
  if (!Object.hasOwn(record, key) || record[key] === null) return absent();
  return present(record[key]);
}

function requireString(record, key, id) {
  if (typeof record[key] !== "string" || record[key].length === 0) {
    throw new CatalogError("bad-record", `${id}: поле ${key} должно быть непустой строкой`);
  }
}

function assertRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new CatalogError("bad-record", "Запись каталога должна быть объектом");
  }
  requireString(record, "type", record.id ?? "?");
  requireString(record, "name", record.id ?? record.type);
  requireString(record, "prototypeType", `${record.type}/${record.name}`);
  requireString(record, "role", `${record.type}/${record.name}`);
  const id = `${record.type}/${record.name}`;
  if (!SIGNAL_TYPES.has(record.type)) {
    throw new CatalogError("bad-record", `${id}: неизвестный тип сигнала ${record.type}`);
  }
  if (record.id !== id) throw new CatalogError("bad-record", `${record.id ?? id}: id не равен type/name`);
  if (typeof record.hidden !== "boolean" || typeof record.parameter !== "boolean") {
    throw new CatalogError("bad-record", `${id}: hidden и parameter должны быть boolean`);
  }
  if (!record.label || typeof record.label.en !== "string" || typeof record.label.ru !== "string") {
    throw new CatalogError("bad-record", `${id}: нужны label.en и label.ru`);
  }
  if (!record.labelSource || typeof record.labelSource.en !== "string" || typeof record.labelSource.ru !== "string") {
    throw new CatalogError("bad-record", `${id}: нужны labelSource.en и labelSource.ru`);
  }
  if (Object.hasOwn(record, "subgroup") && record.subgroup !== null && typeof record.subgroup !== "string") {
    throw new CatalogError("bad-record", `${id}: subgroup должна быть строкой`);
  }
  if (record.subgroup === "") throw new CatalogError("bad-record", `${id}: пустая subgroup`);
  if (Object.hasOwn(record, "order") && record.order !== null && typeof record.order !== "string") {
    throw new CatalogError("bad-record", `${id}: order должен быть строкой`);
  }
  if (Object.hasOwn(record, "hide_from_signal_gui") && typeof record.hide_from_signal_gui !== "boolean") {
    throw new CatalogError("bad-record", `${id}: hide_from_signal_gui должен быть boolean`);
  }
  if (Object.hasOwn(record, "hide_from_signal_gui") && record.type !== "recipe" && record.type !== "asteroid-chunk") {
    throw new CatalogError("bad-record", `${id}: hide_from_signal_gui допустим у recipe и asteroid-chunk`);
  }
  if (Object.hasOwn(record, "item_signal_alias")) {
    const alias = record.item_signal_alias;
    const allowed = record.type === "asteroid-chunk" && (alias === null || typeof alias === "string");
    if (!allowed) throw new CatalogError("bad-record", `${id}: item_signal_alias допустим только у asteroid-chunk`);
  }
  if (Object.hasOwn(record, "stack_size") && typeof record.stack_size !== "number") {
    throw new CatalogError("bad-record", `${id}: stack_size должен быть числом`);
  }
  if (Object.hasOwn(record, "weight") && typeof record.weight !== "number") {
    throw new CatalogError("bad-record", `${id}: weight должен быть числом`);
  }
  return id;
}

export function iconKey(icon) {
  if (!icon || !Array.isArray(icon.layers) || icon.layers.length === 0) return null;
  return icon.layers.map((layer) => stableValue(layer)).join("|");
}

export function indexIcons(records) {
  const index = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object") {
      throw new CatalogError("bad-record", "Запись каталога должна быть объектом");
    }
    if (!ICON_TYPES.has(record.type) || record.hidden) continue;
    const key = iconKey(record.icon);
    if (!key) continue;
    const list = index.get(key) ?? [];
    list.push(record.id);
    index.set(key, list);
  }
  for (const list of index.values()) list.sort(compareText);
  return index;
}

function mapRole(record) {
  if (record.role === "logic-selector") return "meta";
  if (record.role === "quality-selector") return "quality-selector";
  if (record.role === "blueprint-parameter" || (record.role === "signal" && record.parameter)) {
    return "blueprint-parameter";
  }
  if (record.role === "internal" || (record.role === "signal" && record.hidden)) return "technical";
  if (record.role === "signal") return "ordinary";
  throw new CatalogError("unknown-role", `${record.id}: неизвестная роль ${record.role}`);
}

function selection(state, evidence, level, matched = [], source = null) {
  return { state, evidence, level, matchedPrototypeIds: matched, source };
}

function recipeSelection(record, icons) {
  if (Object.hasOwn(record, "hide_from_signal_gui")) {
    return selection(
      record.hide_from_signal_gui ? "hidden" : "selectable",
      "explicit-hide-from-signal-gui",
      "snapshot",
    );
  }
  const key = iconKey(record.icon);
  if (!key) {
    return selection("unconfirmed", "icon-not-comparable", "unconfirmed", [], RECIPE_HIDE_RULE.source);
  }
  const matched = icons.get(key) ?? [];
  if (matched.length > 0) {
    return selection("hidden", "prototype-docs-icon-match", "documentation", matched, RECIPE_HIDE_RULE.source);
  }
  return selection("selectable", "prototype-docs-no-icon-match", "documentation", [], RECIPE_HIDE_RULE.source);
}

function selectionFor(record, role, icons) {
  if (role === "meta" || role === "quality-selector" || role === "blueprint-parameter") {
    return selection("not-applicable", "role", "snapshot");
  }
  if (role === "technical") return selection("hidden", "snapshot-hidden", "snapshot");
  if (record.type === "recipe") return recipeSelection(record, icons);
  if (record.type === "asteroid-chunk" && record.hide_from_signal_gui === true) {
    return selection("hidden", "explicit-hide-from-signal-gui", "snapshot");
  }
  return selection("selectable", "snapshot-not-hidden", "snapshot");
}

function hideFromSignalGui(record) {
  if (record.type !== "asteroid-chunk") return { status: "not-applicable", value: null, level: "snapshot" };
  if (Object.hasOwn(record, "hide_from_signal_gui")) {
    return { status: "explicit", value: record.hide_from_signal_gui, level: "snapshot" };
  }
  return { status: "absent", value: null, level: "snapshot" };
}

function itemSignalAlias(record) {
  if (record.type !== "asteroid-chunk") return { status: "not-applicable", itemName: null, level: "snapshot" };
  if (typeof record.item_signal_alias === "string" && record.item_signal_alias.length > 0) {
    return { status: "present", itemName: record.item_signal_alias, level: "snapshot" };
  }
  return { status: "absent", itemName: null, level: "snapshot" };
}

function recipeHide(record) {
  if (record.type !== "recipe") return { status: "not-applicable", value: null, level: "snapshot", source: null };
  if (Object.hasOwn(record, "hide_from_signal_gui")) {
    return { status: "explicit", value: record.hide_from_signal_gui, level: "snapshot", source: "snapshot" };
  }
  return {
    status: "derived",
    value: null,
    level: "documentation",
    source: RECIPE_HIDE_RULE.source,
    applicationVersion: RECIPE_HIDE_RULE.applicationVersion,
  };
}

function defaultQuality(record, role) {
  if (record.type === "quality" || role === "meta" || role === "quality-selector" || role === "blueprint-parameter") {
    return { status: "not-applicable", value: null, source: "role", level: "snapshot" };
  }
  return {
    status: SIGNAL_QUALITY_DEFAULT.level,
    value: SIGNAL_QUALITY_DEFAULT.value,
    source: SIGNAL_QUALITY_DEFAULT.source,
    level: SIGNAL_QUALITY_DEFAULT.level,
  };
}

function labelSide(text, source) {
  return { text, source, status: source === "unresolved" ? "unresolved" : "snapshot" };
}

function numericField(record, key) {
  if (!Object.hasOwn(record, key)) return absent();
  return present(record[key]);
}

function qualityOf(record, role) {
  if (record.type === "quality") {
    return {
      asSignalType: true,
      applies: "not-applicable",
      status: "not-applicable",
      source: "quality-prototype",
      level: Object.hasOwn(record, "level") ? present(record.level) : absent(),
      next: Object.hasOwn(record, "next") ? present(record.next) : absent(),
      nextProbability: Object.hasOwn(record, "next_probability") ? present(record.next_probability) : absent(),
    };
  }
  const special = role === "meta" || role === "quality-selector";
  return {
    asSignalType: false,
    applies: special ? "not-applicable" : "unconfirmed",
    status: special ? "not-applicable" : "unconfirmed",
    source: special ? "role" : "not-in-snapshot",
    level: absent(),
    next: absent(),
    nextProbability: absent(),
  };
}

function iconOf(record, missingIcons) {
  const icon = record.icon;
  if (!icon || !Array.isArray(icon.layers) || icon.layers.length === 0) {
    return { status: "absent", png: "absent", source: null, layers: [] };
  }
  const layers = icon.layers.map((layer) => structuredClone(layer));
  const paths = layers.map((layer) => layer.icon).filter((item) => typeof item === "string");
  let png = "not-listed";
  if (paths.length === layers.length && paths.every((item) => missingIcons.has(item))) png = "missing";
  return { status: "described", png, source: icon.source ?? null, layers };
}

function indexGroups(groups) {
  if (!groups || !Array.isArray(groups.groups) || !Array.isArray(groups.subgroups)) {
    throw new CatalogError("bad-record", "groups.json должен содержать groups и subgroups");
  }
  const byGroup = new Map();
  for (const group of groups.groups) {
    if (!group || typeof group.name !== "string") throw new CatalogError("bad-record", "У группы нет name");
    if (byGroup.has(group.name)) throw new CatalogError("duplicate-group", `Повтор группы ${group.name}`);
    if (Object.hasOwn(group, "order") && typeof group.order !== "string") {
      throw new CatalogError("bad-record", `Порядок группы ${group.name} должен быть строкой`);
    }
    byGroup.set(group.name, group);
  }
  const bySubgroup = new Map();
  for (const subgroup of groups.subgroups) {
    if (!subgroup || typeof subgroup.name !== "string" || typeof subgroup.group !== "string") {
      throw new CatalogError("bad-record", "У подгруппы нет name или group");
    }
    if (bySubgroup.has(subgroup.name)) {
      throw new CatalogError("duplicate-subgroup", `Повтор подгруппы ${subgroup.name}`);
    }
    if (!byGroup.has(subgroup.group)) {
      throw new CatalogError("unknown-group", `Подгруппа ${subgroup.name} ссылается на неизвестную группу ${subgroup.group}`);
    }
    if (Object.hasOwn(subgroup, "order") && typeof subgroup.order !== "string") {
      throw new CatalogError("bad-record", `Порядок подгруппы ${subgroup.name} должен быть строкой`);
    }
    bySubgroup.set(subgroup.name, subgroup);
  }
  return { byGroup, bySubgroup };
}

function placement(record, groups) {
  if (!Object.hasOwn(record, "subgroup") || record.subgroup === null) {
    return { group: absent(), subgroup: absent(), section: null };
  }
  const subgroup = groups.bySubgroup.get(record.subgroup);
  if (!subgroup) {
    throw new CatalogError("unknown-subgroup", `${record.id}: неизвестная подгруппа ${record.subgroup}`);
  }
  const group = groups.byGroup.get(subgroup.group);
  return {
    group: { status: "present", id: group.name, order: group.order ?? null },
    subgroup: { status: "present", id: subgroup.name, order: subgroup.order ?? null },
    section: sectionForGroup(group.name),
  };
}

function recipeDefaults(record, byId) {
  if (record.type !== "recipe" || record.main_product === "" || !Array.isArray(record.results)) {
    return { record, fields: [] };
  }
  const product = record.main_product
    ? record.results.find(result => result?.name === record.main_product)
    : record.results.length === 1 ? record.results[0] : null;
  const parent = product && byId.get(`${product.type ?? "item"}/${product.name}`);
  if (!parent) return { record, fields: [] };
  const effective = { ...record };
  const fields = [];
  for (const field of ["subgroup", "order"]) {
    if (effective[field] == null && typeof parent[field] === "string") {
      effective[field] = parent[field];
      fields.push(field);
    }
  }
  return { record: effective, fields, prototypeId: parent.id };
}

function sortText(value) {
  return value ?? "";
}

export function compareRows(left, right) {
  const keys = [
    [sortText(left.group.order), sortText(right.group.order)],
    [sortText(left.subgroup.order), sortText(right.subgroup.order)],
    [sortText(left.prototypeOrder.value), sortText(right.prototypeOrder.value)],
    [left.gameType, right.gameType],
    [left.gameName, right.gameName],
  ];
  for (const [a, b] of keys) {
    const diff = compareText(a, b);
    if (diff !== 0) return diff;
  }
  return compareText(left.prototypeId, right.prototypeId);
}

function assignPaths(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row.candidatePath) continue;
    const list = grouped.get(row.candidatePath) ?? [];
    list.push(row);
    grouped.set(row.candidatePath, list);
  }
  for (const list of grouped.values()) {
    if (list.length === 1) {
      list[0].publicPath = list[0].candidatePath;
      list[0].pathReason = null;
      list[0].channel = list[0].role === "ordinary";
      continue;
    }
    list.sort((left, right) => compareText(left.prototypeId, right.prototypeId));
    for (const row of list) {
      row.publicPath = null;
      row.pathReason = "collision";
      row.channel = false;
    }
  }
}

export function buildProfile(source) {
  if (!source || !Array.isArray(source.records)) {
    throw new CatalogError("not-array", "Список записей профиля должен быть массивом");
  }
  const groups = indexGroups(source.groups);
  const icons = indexIcons(source.records);
  const missingIcons = new Set(source.missingIcons ?? []);
  const byId = new Map(source.records.map(record => [record.id, record]));
  const seen = new Set();
  const rows = [];
  for (const original of source.records) {
    const id = assertRecord(original);
    const inherited = recipeDefaults(original, byId);
    const record = inherited.record;
    if (seen.has(id)) throw new CatalogError("duplicate-id", `Повтор идентификатора ${id}`);
    seen.add(id);
    const role = mapRole(record);
    const place = placement(record, groups);
    const signalSelection = selectionFor(record, role, icons);
    const alias = itemSignalAlias(record);
    const checked = nameCheck(record.name);
    const prototypeOrder = optionalString(record, "order");
    let publicSection = null;
    let candidatePath = null;
    let rejectedPath = null;
    let pathReason = null;
    if (role === "meta") {
      publicSection = META_SECTION;
      if (checked.ok) candidatePath = joinPath(META_SECTION, checked.publicName);
      else {
        pathReason = "js-property";
        rejectedPath = joinPath(META_SECTION, checked.publicName);
      }
    } else if (role === "blueprint-parameter") {
      pathReason = "blueprint-parameter";
    } else if (role === "technical") {
      pathReason = "technical";
    } else if (alias.status === "present") {
      pathReason = "asteroid-item-alias";
      publicSection = place.section;
    } else if (signalSelection.state === "hidden") {
      pathReason = "not-selectable";
    } else if (signalSelection.state === "unconfirmed") {
      pathReason = "signal-selection-unconfirmed";
    } else if (place.subgroup.status !== "present") {
      pathReason = "subgroup-absent";
    } else if (!place.section) {
      pathReason = "section-unsupported";
      publicSection = null;
    } else if (!checked.ok) {
      publicSection = place.section;
      pathReason = "js-property";
      rejectedPath = joinPath(place.section, checked.publicName);
    } else {
      publicSection = place.section;
      candidatePath = joinPath(place.section, checked.publicName);
    }
    rows.push({
      gameVersion: source.gameVersion,
      profile: source.profile,
      gameType: record.type,
      gameName: record.name,
      prototypeId: id,
      prototypeType: record.prototypeType,
      role,
      channel: false,
      publicSection,
      publicName: checked.publicName,
      publicPath: null,
      pathReason,
      candidatePath,
      rejectedPath,
      nameCheck: { ok: checked.ok, kind: checked.kind },
      group: place.group.status === "present" ? place.group : { status: "absent", id: null, order: null },
      subgroup: place.subgroup.status === "present" ? place.subgroup : { status: "absent", id: null, order: null },
      prototypeOrder,
      label: {
        en: labelSide(record.label.en, record.labelSource.en),
        ru: labelSide(record.label.ru, record.labelSource.ru),
      },
      localisedName: Object.hasOwn(record, "localised_name")
        ? present(structuredClone(record.localised_name))
        : absent(),
      quality: qualityOf(record, role),
      defaultQuality: defaultQuality(record, role),
      hidden: { value: record.hidden, source: "snapshot" },
      parameter: { value: record.parameter, source: "snapshot" },
      signalSelection,
      recipeHideFromSignalGui: recipeHide(record),
      hideFromSignalGui: hideFromSignalGui(record),
      itemSignalAlias: alias,
      nesting: absentNesting(),
      icon: iconOf(record, missingIcons),
      stackSize: numericField(record, "stack_size"),
      weight: numericField(record, "weight"),
      sources: {
        record: source.recordSource,
        groups: source.groupsSource,
        label: "snapshot",
        signalSelection: signalSelection.evidence,
        iconPng: "manifest.iconFiles",
        ...(inherited.fields.length ? { recipeDefaults: {
          prototypeId: inherited.prototypeId,
          fields: inherited.fields,
          source: "https://lua-api.factorio.com/2.1.24/prototypes/RecipePrototype.html#main_product",
          runtimeEvidence: RECIPE_HIDE_RULE.runtimeEvidence,
        } } : {}),
      },
    });
  }
  markBarrelActions(rows);
  excludeCaptiveEntity(rows);
  excludeBiolabEntity(rows);
  excludeObservedAsteroidChunks(rows);
  assignPaths(rows);
  applyBarrelLinks(rows);
  assignPaths(rows);
  finishBarrelLinks(rows);
  let chooserReview;
  if (source.chooserReview) {
    chooserReview = applyChooserReview(rows, source.chooserReview, source.gameVersion, source.profile);
    assignPaths(rows);
  }
  rows.sort(compareRows);
  return {
    schemaVersion: 1,
    gameVersion: source.gameVersion,
    profile: source.profile,
    ...(chooserReview ? { chooserReview } : {}),
    rows,
  };
}

export function qualitiesDocument(profileDocument) {
  const entries = profileDocument.rows
    .filter((row) => row.gameType === "quality")
    .map((row) => ({
      prototypeId: row.prototypeId,
      gameName: row.gameName,
      role: row.role,
      publicPath: row.publicPath,
      pathReason: row.pathReason,
      hidden: row.hidden.value,
      level: row.quality.level,
      next: row.quality.next,
      nextProbability: row.quality.nextProbability,
      label: row.label,
    }))
    .sort((left, right) => {
      const leftLevel = left.level.status === "present" ? left.level.value : Number.POSITIVE_INFINITY;
      const rightLevel = right.level.status === "present" ? right.level.value : Number.POSITIVE_INFINITY;
      if (leftLevel !== rightLevel) return leftLevel - rightLevel;
      return compareText(left.gameName, right.gameName);
    });
  const levels = entries
    .filter((entry) => entry.role === "ordinary" && entry.level.status === "present")
    .map((entry) => entry.level.value);
  const unique = [...new Set(levels)].sort((left, right) => left - right);
  const missingLevels = [];
  if (unique.length > 1) {
    for (let level = unique[0]; level <= unique[unique.length - 1]; level += 1) {
      if (!unique.includes(level)) missingLevels.push(level);
    }
  }
  return {
    schemaVersion: 1,
    gameVersion: profileDocument.gameVersion,
    profile: profileDocument.profile,
    note: "Таблица модификаторов качества. Строки сигналов на эти уровни не размножаются. Применимость качества к каналу в строке сигнала остаётся unconfirmed, если снимок её не содержит.",
    entries,
    observedOrdinaryLevels: unique,
    missingLevels,
  };
}

export function pathsDocument(profileDocument) {
  const paths = {};
  const exported = profileDocument.rows.filter((row) => row.publicPath);
  exported.sort((left, right) => compareText(left.publicPath, right.publicPath));
  for (const row of exported) {
    paths[row.publicPath] = {
      prototypeId: row.prototypeId,
      gameType: row.gameType,
      gameName: row.gameName,
      role: row.role,
      channel: row.channel,
    };
  }
  return { schemaVersion: 1, gameVersion: profileDocument.gameVersion, profile: profileDocument.profile, paths };
}

export function coverageOf(profileDocument, inputCount) {
  if (profileDocument.rows.length !== inputCount) {
    throw new CatalogError("count", `${profileDocument.profile}: строк ${profileDocument.rows.length}, ожидалось ${inputCount}`);
  }
  const ids = new Set(profileDocument.rows.map((row) => row.prototypeId));
  if (ids.size !== profileDocument.rows.length) {
    throw new CatalogError("duplicate-id", `${profileDocument.profile}: учётные строки повторяют id`);
  }
  const excluded = {};
  let exported = 0;
  const unresolvedLabels = { en: 0, ru: 0 };
  for (const row of profileDocument.rows) {
    if (row.publicPath) exported += 1;
    else excluded[row.pathReason] = (excluded[row.pathReason] ?? 0) + 1;
    if (row.label.en.status === "unresolved") unresolvedLabels.en += 1;
    if (row.label.ru.status === "unresolved") unresolvedLabels.ru += 1;
  }
  return {
    input: inputCount,
    rows: profileDocument.rows.length,
    exported,
    excluded,
    unresolvedLabels,
    menuConfirmed: false,
  };
}

function rowMap(document) {
  return new Map(document.rows.map((row) => [row.prototypeId, row]));
}

export function diffProfiles(base, spaceAge) {
  const left = rowMap(base);
  const right = rowMap(spaceAge);
  const removed = [...left.keys()].filter((id) => !right.has(id)).sort(compareText);
  const added = [...right.keys()].filter((id) => !left.has(id)).sort(compareText);
  const changed = [];
  for (const id of [...left.keys()].filter((item) => right.has(item)).sort(compareText)) {
    const fields = DIFF_FIELDS.filter((fieldName) => stableValue(left.get(id)[fieldName]) !== stableValue(right.get(id)[fieldName]));
    if (fields.length > 0) changed.push({ prototypeId: id, fields });
  }
  return {
    schemaVersion: 1,
    gameVersion: base.gameVersion,
    note: "base и Space Age — самостоятельные профили. Общие ID не склеиваются: отличия свойств перечислены отдельно.",
    removed,
    added,
    changed,
  };
}

export function diffVersions(previous, next) {
  if (!previous) {
    return {
      schemaVersion: 1,
      gameVersion: next.gameVersion,
      previous: null,
      status: "baseline",
      added: [],
      removed: [],
      moved: [],
      reassigned: [],
      explanation: "Предыдущей таблицы signal-catalog нет. Этот выпуск — baseline 2.1.24. Следующая версия должна показать добавления, удаления и смену пути; старый publicPath нельзя отдать другому prototypeId.",
    };
  }
  const pathsOf = (document) => {
    const map = new Map();
    for (const row of document.rows) {
      if (!row.publicPath) continue;
      map.set(row.publicPath, row.prototypeId);
    }
    return map;
  };
  const before = new Map(previous.rows.map((row) => [row.prototypeId, row.publicPath]));
  const after = new Map(next.rows.map((row) => [row.prototypeId, row.publicPath]));
  const added = [...after.keys()].filter((id) => !before.has(id)).sort(compareText);
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort(compareText);
  const moved = [];
  for (const id of [...before.keys()].filter((item) => after.has(item)).sort(compareText)) {
    if (before.get(id) !== after.get(id)) moved.push({ prototypeId: id, previousPath: before.get(id), nextPath: after.get(id) });
  }
  const previousPaths = pathsOf(previous);
  const nextPaths = pathsOf(next);
  const reassigned = [];
  for (const [publicPath, prototypeId] of [...nextPaths.entries()].sort((left, right) => compareText(left[0], right[0]))) {
    if (previousPaths.has(publicPath) && previousPaths.get(publicPath) !== prototypeId) {
      reassigned.push({ publicPath, previousId: previousPaths.get(publicPath), nextId: prototypeId });
    }
  }
  return {
    schemaVersion: 1,
    gameVersion: next.gameVersion,
    previous: previous.gameVersion,
    status: "compared",
    added,
    removed,
    moved,
    reassigned,
    explanation: "reassigned означает, что прежний publicPath теперь указывает на другой prototypeId.",
  };
}

const ASTEROID_NAMES = [
  "metallic-asteroid-chunk",
  "carbonic-asteroid-chunk",
  "oxide-asteroid-chunk",
  "promethium-asteroid-chunk",
];

function signalBrief(row) {
  if (!row) return null;
  return {
    prototypeId: row.prototypeId,
    publicPath: row.publicPath,
    pathReason: row.pathReason,
    hidden: row.hidden.value,
    subgroup: row.subgroup.id,
    signalSelection: row.signalSelection.state,
    hideFromSignalGui: row.hideFromSignalGui,
    itemSignalAlias: row.itemSignalAlias,
  };
}

function pairBrief(document, name, leftType, rightType) {
  return {
    name,
    left: signalBrief(document.rows.find((row) => row.prototypeId === `${leftType}/${name}`)),
    right: signalBrief(document.rows.find((row) => row.prototypeId === `${rightType}/${name}`)),
  };
}

function signalEvidence(documents) {
  const asteroids = {};
  const biolab = {};
  for (const [profile, document] of Object.entries(documents)) {
    asteroids[profile] = ASTEROID_NAMES
      .map((name) => pairBrief(document, name, "item", "asteroid-chunk"))
      .filter((pair) => pair.left || pair.right);
    const pair = pairBrief(document, "biolab", "item", "entity");
    biolab[profile] = pair.left || pair.right ? pair : null;
  }
  return {
    asteroids,
    biolab,
    asteroidNote: ASTEROID_SIGNAL_NOTE,
    biolabNote: BIOLAB_SIGNAL_NOTE,
    menuConfirmed: false,
  };
}

export function collisionReport(documents) {
  const profiles = {};
  const propertyAccess = {};
  const keywords = {};
  for (const [profile, document] of Object.entries(documents)) {
    const grouped = new Map();
    for (const row of document.rows) {
      if (row.pathReason !== "collision") continue;
      const list = grouped.get(row.candidatePath) ?? [];
      list.push({
        prototypeId: row.prototypeId,
        gameType: row.gameType,
        gameName: row.gameName,
        hidden: row.hidden.value,
        signalSelection: row.signalSelection.state,
        hideFromSignalGui: row.hideFromSignalGui,
        itemSignalAlias: row.itemSignalAlias,
      });
      grouped.set(row.candidatePath, list);
    }
    profiles[profile] = [...grouped.entries()]
      .sort((left, right) => compareText(left[0], right[0]))
      .map(([candidatePath, records]) => ({ candidatePath, records }));
    propertyAccess[profile] = document.rows
      .filter((row) => row.pathReason === "js-property")
      .map((row) => ({
        prototypeId: row.prototypeId,
        publicName: row.publicName,
        rejectedPath: row.rejectedPath,
        kind: row.nameCheck.kind,
      }));
    keywords[profile] = document.rows
      .filter((row) => row.nameCheck.kind === "keyword")
      .map((row) => ({
        prototypeId: row.prototypeId,
        publicName: row.publicName,
        rejectedPath: row.rejectedPath,
        publicPath: row.publicPath,
      }));
  }
  const blocking = {};
  for (const profile of Object.keys(profiles)) {
    blocking[profile] = {
      collisionPaths: profiles[profile].length,
      collisionRows: profiles[profile].reduce((sum, item) => sum + item.records.length, 0),
      propertyRows: propertyAccess[profile].length,
    };
  }
  const collisionRowCount = Object.values(blocking).reduce((sum, item) => sum + item.collisionRows, 0);
  return {
    schemaVersion: 1,
    gameVersion: EXPECTED.gameVersion,
    resolved: collisionRowCount === 0,
    appliedRules: [
      "Ведущий цифровой блок до дефиса переносится в конец перед заменой дефисов.",
      "Предмет бочки сохраняет путь. Рецепты fill-barrel и empty-barrel с ключами recipe-name.fill-barrel и recipe-name.empty-filled-barrel становятся .fill и .empty этого предмета. Плоский путь тем же рецептам не назначается.",
      "entity/captive-biter-spawner не экспортируется. Причина project-item-only — решение проекта, не флаг скрытия и не вкладка врагов.",
      "entity/biolab не экспортируется. Причина chooser-observation-item-only — наблюдение пользователя, что отдельного entity-сигнала в меню нет. Версия наблюдения не указана, это не runtime-флаг.",
      "Четыре пары item/asteroid-chunk из blueprint постоянного комбинатора: путь получает предмет, asteroid-chunk остаётся с причиной chooser-blueprint-item. hide_from_signal_gui и item_signal_alias из снимка не подставляются.",
    ],
    namingRule: "prototype.name: ведущий цифровой блок до дефиса переносится в конец, затем '-' → '_'. Рецепты бочек получают .fill/.empty предмета. entity/captive-biter-spawner, entity/biolab и четыре asteroid-chunk из blueprint остаются без пути.",
    proposal: PROPOSAL,
    signals: signalEvidence(documents),
    blocking,
    profiles,
    propertyAccess,
    keywords,
  };
}

function assertProvenance(manifest) {
  if (manifest.gameVersion !== EXPECTED.gameVersion) {
    throw new CatalogError("provenance", `Версия снимка ${manifest.gameVersion} не равна закреплённой ${EXPECTED.gameVersion}`);
  }
  if (manifest.archiveSha256 !== EXPECTED.archiveSha256) {
    throw new CatalogError("provenance", "SHA-256 архива не совпадает с закреплённым снимком 2.1.24");
  }
  if (manifest.builderSha256 !== EXPECTED.builderSha256 || manifest.loaderSha256 !== EXPECTED.loaderSha256) {
    throw new CatalogError("provenance", "SHA-256 сборщика или загрузчика не совпадает с закреплённым снимком");
  }
  for (const profile of Object.keys(EXPECTED.counts)) {
    const counts = manifest.profiles?.[profile]?.counts;
    if (!counts) throw new CatalogError("provenance", `В manifest нет количеств профиля ${profile}`);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (total !== EXPECTED.counts[profile]) {
      throw new CatalogError("count", `${profile}: manifest сообщает ${total}, закреплено ${EXPECTED.counts[profile]}`);
    }
  }
}

function assertTypeCounts(profile, records, counts) {
  const actual = {};
  for (const type of Object.keys(TYPE_FILES)) actual[type] = 0;
  for (const record of records) {
    if (!Object.hasOwn(actual, record.type)) {
      throw new CatalogError("bad-record", `${profile}: посторонний тип ${record.type}`);
    }
    actual[record.type] += 1;
  }
  for (const type of Object.keys(TYPE_FILES)) {
    if (actual[type] !== counts[type]) {
      throw new CatalogError("count", `${profile}: ${type} ${actual[type]}, manifest ${counts[type]}`);
    }
  }
}

export function assertSpecialSignals(documents, specialSignals) {
  if (specialSignals === undefined) return;
  if (!Array.isArray(specialSignals)) {
    throw new CatalogError("schema", "special-signals должен быть массивом");
  }
  for (const entry of specialSignals) {
    if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string" || !Array.isArray(entry.profiles)) {
      throw new CatalogError("schema", "Запись special-signals повреждена");
    }
    const expectedRole = entry.kind === "logic-selector"
      ? "meta"
      : entry.kind === "quality-selector"
        ? "quality-selector"
        : null;
    if (!expectedRole) throw new CatalogError("schema", `${entry.id}: неизвестный kind ${entry.kind}`);
    for (const profile of [...entry.profiles].sort(compareText)) {
      const document = documents[profile];
      if (!document) throw new CatalogError("provenance", `${entry.id}: нет профиля ${profile}`);
      const row = document.rows.find((item) => item.prototypeId === entry.id);
      if (!row) throw new CatalogError("provenance", `${profile}: нет ${entry.id} из special-signals`);
      if (row.role !== expectedRole) {
        throw new CatalogError("provenance", `${entry.id}: роль ${row.role}, в special-signals ${entry.kind}`);
      }
      if (row.gameName !== entry.name) {
        throw new CatalogError("provenance", `${entry.id}: имя ${row.gameName} не равно ${entry.name}`);
      }
    }
  }
}

export function buildCatalog(loaded, provenance) {
  assertProvenance(loaded.manifest);
  if (loaded.chooserReview) {
    if (!Object.hasOwn(loaded.profiles, loaded.chooserReview.profile)) throw new CatalogError("provenance", "Неизвестный профиль сверки chooser");
    reviewMembership(loaded.chooserReview, loaded.manifest.gameVersion, loaded.chooserReview.profile);
  }
  const profiles = {};
  for (const profile of ["base", "space-age"]) {
    const pack = loaded.profiles[profile];
    assertTypeCounts(profile, pack.records, loaded.manifest.profiles[profile].counts);
    profiles[profile] = buildProfile({
      gameVersion: loaded.manifest.gameVersion,
      profile,
      groups: pack.groups,
      records: pack.records,
      missingIcons: loaded.missingIcons,
      recordSource: `data/factorio/${loaded.manifest.gameVersion}/${profile}`,
      groupsSource: `data/factorio/${loaded.manifest.gameVersion}/${profile}/groups.json`,
      chooserReview: loaded.chooserReview?.profile === profile ? loaded.chooserReview : null,
    });
    coverageOf(profiles[profile], EXPECTED.counts[profile]);
  }
  const profileDiff = diffProfiles(profiles.base, profiles["space-age"]);
  if (stableValue(profileDiff.removed) !== stableValue(EXPECTED.removed)) {
    throw new CatalogError("provenance", `Удаления Space Age ${profileDiff.removed.join(", ")} не совпадают с закреплённым списком`);
  }
  const added = new Set(loaded.manifest.spaceAgeAddedIds ?? []);
  if (added.size !== profileDiff.added.length || profileDiff.added.some((id) => !added.has(id))) {
    throw new CatalogError("provenance", "Список добавлений Space Age не совпадает с manifest.spaceAgeAddedIds");
  }
  assertSpecialSignals(profiles, loaded.specialSignals);
  const coverage = {
    schemaVersion: 1,
    gameVersion: loaded.manifest.gameVersion,
    menuConfirmed: false,
    note: "Число учётных строк — это сырые прототипы, включая скрытые и технические. Оно не равно числу экспортированных путей и не подтверждает состав игрового меню.",
    profiles: {
      base: coverageOf(profiles.base, EXPECTED.counts.base),
      "space-age": coverageOf(profiles["space-age"], EXPECTED.counts["space-age"]),
    },
  };
  return {
    profiles,
    coverage,
    collisions: collisionReport(profiles),
    profileDiff,
    versionDiff: diffVersions(null, profiles.base),
    provenance,
    manifest: loaded.manifest,
  };
}
