import { buildProfile } from "../../../tools/signal-catalog/build.mjs";

export function standardGroups() {
  return {
    groups: [
      { name: "logistics", order: "a" },
      { name: "production", order: "b" },
      { name: "intermediate-products", order: "c" },
      { name: "space", order: "d" },
      { name: "combat", order: "e" },
      { name: "fluids", order: "f" },
      { name: "signals", order: "g" },
      { name: "enemies", order: "h" },
      { name: "environment", order: "i" },
      { name: "other", order: "z" },
      { name: "tiles", order: "zz" },
    ],
    subgroups: [
      { name: "storage", group: "logistics", order: "a" },
      { name: "belt", group: "logistics", order: "b" },
      { name: "production-machine", group: "production", order: "a" },
      { name: "barrel", group: "intermediate-products", order: "d" },
      { name: "fill-barrel", group: "intermediate-products", order: "e" },
      { name: "empty-barrel", group: "intermediate-products", order: "f" },
      { name: "space-material", group: "space", order: "a" },
      { name: "space-crushing", group: "space", order: "b" },
      { name: "fluid", group: "fluids", order: "a" },
      { name: "virtual-signal-special", group: "signals", order: "a" },
      { name: "enemies", group: "enemies", order: "a" },
      { name: "generic-remnants", group: "environment", order: "a" },
      { name: "qualities", group: "other", order: "b" },
      { name: "nauvis-tiles", group: "tiles", order: "a" },
    ],
  };
}

export function record(overrides = {}) {
  const type = overrides.type ?? "item";
  const name = overrides.name ?? "wood";
  return {
    id: overrides.id ?? `${type}/${name}`,
    type,
    name,
    prototypeType: overrides.prototypeType ?? type,
    role: "signal",
    hidden: false,
    parameter: false,
    label: { en: "Wood", ru: "Древесина" },
    labelSource: { en: `item-name.${name}`, ru: `item-name.${name}` },
    subgroup: "storage",
    order: "m",
    icon: {
      source: "icon",
      layers: [{ icon: `__base__/graphics/icons/${name}.png`, icon_size: 64 }],
    },
    ...overrides,
  };
}

export function source(records, extra = {}) {
  return {
    gameVersion: extra.gameVersion ?? "2.1.24",
    profile: extra.profile ?? "base",
    groups: extra.groups ?? standardGroups(),
    records,
    missingIcons: extra.missingIcons ?? [],
    recordSource: "fixture",
    groupsSource: "fixture/groups.json",
  };
}

export function build(records, extra) {
  return buildProfile(source(records, extra));
}

export function row(document, id) {
  const found = document.rows.find((item) => item.prototypeId === id);
  if (!found) throw new Error(`нет строки ${id}`);
  return found;
}

export function expectCode(fn, code) {
  try {
    fn();
  } catch (error) {
    if (error?.code !== code) {
      throw new Error(`${error?.code ?? error?.name}: ${error?.message}; ожидался ${code}`);
    }
    return;
  }
  throw new Error(`ожидался код ${code}`);
}
