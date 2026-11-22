/** Размер стака и вес предмета из снимка Factorio 2.1.24. Значения по умолчанию не подставляются. */

import baseItems from "../data/factorio/2.1.24/base/items.json" with { type: "json" };
import spaceItems from "../data/factorio/2.1.24/space-age/items.json" with { type: "json" };

function indexItems(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.name, Object.freeze({
      stackSize: item.stack_size,
      weight: Object.hasOwn(item, "weight") ? item.weight : null,
    }));
  }
  return map;
}

const TABLES = {
  base: indexItems(baseItems),
  "space-age": indexItems(spaceItems),
};

export function itemFacts(profile, name) {
  return TABLES[profile].get(name) ?? null;
}
