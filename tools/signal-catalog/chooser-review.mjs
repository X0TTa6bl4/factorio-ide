import { CatalogError } from "./errors.mjs";
import { joinPath, SECTIONS } from "./names.mjs";

export function reviewMembership(review, gameVersion, profile) {
  if (!review || review.schemaVersion !== 1 || review.gameVersion !== gameVersion || review.profile !== profile) {
    throw new CatalogError("provenance", "Сверка chooser не соответствует версии и профилю каталога");
  }
  if (typeof review.source !== "string" || !review.source || !Array.isArray(review.sections) || review.sections.length !== SECTIONS.length) {
    throw new CatalogError("schema", "Сверка chooser должна содержать источник и десять вкладок");
  }
  const tabs = new Set();
  const membership = new Map();
  for (const tab of review.sections) {
    if (!tab || !Number.isInteger(tab.index) || tab.index < 1 || tab.index > SECTIONS.length || tabs.has(tab.index)
      || SECTIONS[tab.index - 1].section !== tab.section || !Array.isArray(tab.prototypeIds)) {
      throw new CatalogError("schema", "Повторная или неверная вкладка сверки chooser");
    }
    tabs.add(tab.index);
    for (const id of tab.prototypeIds) {
      if (typeof id !== "string" || !id.includes("/") || membership.has(id)) {
        throw new CatalogError("schema", `Повторный или неверный ID в сверке chooser: ${id}`);
      }
      membership.set(id, tab.section);
    }
  }
  return membership;
}

export function applyChooserReview(rows, review, gameVersion, profile) {
  const membership = reviewMembership(review, gameVersion, profile);
  const byId = new Map(rows.map(row => [row.prototypeId, row]));
  for (const [id, section] of membership) {
    const row = byId.get(id);
    if (!row) throw new CatalogError("provenance", `Сигнала ${id} из сверки нет в исходном профиле`);
    if (row.role !== "ordinary" || !row.nameCheck.ok || row.pathReason === "collision") {
      throw new CatalogError("schema", `Нельзя экспортировать ${id} как обычный сигнал по этой сверке`);
    }
    if (row.publicSection && row.publicSection !== section) {
      throw new CatalogError("provenance", `${id}: вкладка сверки отличается от раздела каталога`);
    }
    if (row.nesting.status === "present" && !membership.has(row.nesting.parentPrototypeId)) {
      throw new CatalogError("schema", `${id}: в сверке отсутствует основной предмет вложенного пути`);
    }
  }
  for (const row of rows) {
    const section = membership.get(row.prototypeId);
    if (section) {
      row.publicSection = section;
      row.candidatePath = row.nesting.status === "present" ? row.publicPath : joinPath(section, row.publicName);
      row.chooserReview = { state: "included", source: review.source, level: "user-reviewed-blueprint", section };
      row.sources.chooserReview = review.source;
    } else if (row.role === "ordinary" && row.publicPath) {
      row.publicPath = null;
      row.candidatePath = null;
      row.channel = false;
      row.pathReason = "chooser-review-removed";
      row.chooserReview = { state: "excluded", source: review.source, level: "user-reviewed-blueprint" };
      row.sources.chooserReview = review.source;
    }
  }
  return { status: "user-reviewed-blueprint", source: review.source, sourceSha256: review.sourceSha256 ?? null, signals: membership.size, fullGuiCoverage: "not-recorded" };
}
