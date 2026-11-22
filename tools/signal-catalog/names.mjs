/** Имя Signal.* из prototype.name: ведущий цифровой блок в конец, дефис на подчёркивание. */

import { CatalogError } from "./errors.mjs";

export const SECTIONS = [
  { group: "logistics", section: "Logistic" },
  { group: "production", section: "Production" },
  { group: "intermediate-products", section: "Intermediate" },
  { group: "space", section: "Space" },
  { group: "combat", section: "Combat" },
  { group: "fluids", section: "Fluids" },
  { group: "signals", section: "Signals" },
  { group: "enemies", section: "Enemies" },
  { group: "environment", section: "Environment" },
  { group: "other", section: "Unsorted" },
];

export const META_SECTION = "Meta";

const SECTION_BY_GROUP = new Map(SECTIONS.map((item) => [item.group, item.section]));

const IDENTIFIER = /^[$_\p{ID_Start}][$_\p{ID_Continue}]*$/u;

const READONLY_STATIC = new Set(["prototype", "name", "length"]);

const KEYWORDS = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function",
  "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null",
  "package", "private", "protected", "public", "return", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

export function sectionForGroup(groupId) {
  return SECTION_BY_GROUP.get(groupId) ?? null;
}

export function publicName(gameName) {
  if (typeof gameName !== "string" || gameName.length === 0) {
    throw new CatalogError("bad-record", "У прототипа пустое имя");
  }
  // Сохраняем размер целиком: 1x2-remnants → remnants_1x2.
  // Блок отделяется дефисом; неоднозначное 1bad не переименовываем.
  const reordered = gameName.replace(/^(\d[^-]*)-(.+)$/, "$2-$1");
  return reordered.replaceAll("-", "_");
}

export function nameCheck(gameName) {
  const normalized = publicName(gameName);
  if (normalized === "__proto__") return { ok: false, kind: "service-property", publicName: normalized };
  if (!IDENTIFIER.test(normalized)) return { ok: false, kind: "invalid-identifier", publicName: normalized };
  if (READONLY_STATIC.has(normalized)) return { ok: false, kind: "readonly-static", publicName: normalized };
  if (KEYWORDS.has(normalized)) return { ok: true, kind: "keyword", publicName: normalized };
  return { ok: true, kind: "identifier", publicName: normalized };
}

export function joinPath(section, normalized) {
  return `Signal.${section}.${normalized}`;
}
