/** Точечные правила публичных путей. Игровые prototype.name они не переписывают. */

export const BARREL_FILL = {
  subgroup: "fill-barrel",
  localeKey: "recipe-name.fill-barrel",
  leaf: "fill",
};

export const BARREL_EMPTY = {
  subgroup: "empty-barrel",
  localeKey: "recipe-name.empty-filled-barrel",
  leaf: "empty",
};

export const CAPTIVE_ENTITY_ID = "entity/captive-biter-spawner";
export const BIOLAB_ENTITY_ID = "entity/biolab";

export const OBSERVED_ASTEROID_ITEMS = new Set([
  "metallic-asteroid-chunk",
  "carbonic-asteroid-chunk",
  "oxide-asteroid-chunk",
  "promethium-asteroid-chunk",
]);

export function absentNesting() {
  return { status: "absent", leaf: null, parentPrototypeId: null, rule: null };
}

export function localeKeyOf(row) {
  const value = row.localisedName;
  if (!value || value.status !== "present" || !Array.isArray(value.value)) return null;
  return typeof value.value[0] === "string" ? value.value[0] : null;
}

export function barrelLink(row) {
  if (row.gameType !== "recipe" || row.role !== "ordinary") return null;
  const subgroup = row.subgroup?.status === "present" ? row.subgroup.id : null;
  const key = localeKeyOf(row);
  if (
    subgroup === BARREL_FILL.subgroup
    && key === BARREL_FILL.localeKey
    && row.gameName.endsWith("-barrel")
    && !row.gameName.startsWith("empty-")
  ) {
    return { leaf: BARREL_FILL.leaf, itemName: row.gameName };
  }
  if (
    subgroup === BARREL_EMPTY.subgroup
    && key === BARREL_EMPTY.localeKey
    && row.gameName.startsWith("empty-")
    && row.gameName.endsWith("-barrel")
  ) {
    const itemName = row.gameName.slice("empty-".length);
    if (!itemName.endsWith("-barrel")) return null;
    return { leaf: BARREL_EMPTY.leaf, itemName };
  }
  return null;
}

export function markBarrelActions(rows) {
  for (const row of rows) {
    const link = barrelLink(row);
    if (!link) continue;
    row.barrelLink = link;
    row.candidatePath = null;
    row.pathReason = "barrel-action-pending";
  }
}

export function excludeCaptiveEntity(rows) {
  for (const row of rows) {
    if (row.prototypeId !== CAPTIVE_ENTITY_ID || !row.candidatePath) continue;
    row.candidatePath = null;
    row.pathReason = "project-item-only";
  }
}

export function excludeBiolabEntity(rows) {
  for (const row of rows) {
    if (row.prototypeId !== BIOLAB_ENTITY_ID || !row.candidatePath) continue;
    row.candidatePath = null;
    row.pathReason = "chooser-observation-item-only";
  }
}

export function excludeObservedAsteroidChunks(rows) {
  const paired = new Set();
  for (const row of rows) {
    if (row.gameType === "item" && OBSERVED_ASTEROID_ITEMS.has(row.gameName)) paired.add(row.gameName);
  }
  for (const row of rows) {
    if (row.gameType !== "asteroid-chunk" || !paired.has(row.gameName) || !row.candidatePath) continue;
    row.candidatePath = null;
    row.pathReason = "chooser-blueprint-item";
  }
}

export function applyBarrelLinks(rows) {
  const byId = new Map(rows.map((row) => [row.prototypeId, row]));
  for (const row of rows) {
    if (!row.barrelLink) continue;
    const parent = byId.get(`item/${row.barrelLink.itemName}`);
    if (!parent || !parent.publicPath) {
      row.publicPath = null;
      row.candidatePath = null;
      row.pathReason = parent ? "barrel-parent-unavailable" : "barrel-parent-missing";
      row.nesting = absentNesting();
      continue;
    }
    row.candidatePath = `${parent.publicPath}.${row.barrelLink.leaf}`;
    row.publicSection = parent.publicSection;
    row.publicName = row.barrelLink.leaf;
    row.nesting = {
      status: "present",
      leaf: row.barrelLink.leaf,
      parentPrototypeId: parent.prototypeId,
      rule: "barrel-action",
    };
  }
}

export function finishBarrelLinks(rows) {
  for (const row of rows) {
    if (row.nesting?.status === "present" && row.publicPath === null) row.nesting = absentNesting();
    delete row.barrelLink;
  }
}
