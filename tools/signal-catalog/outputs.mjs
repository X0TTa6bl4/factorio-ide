import { pathsDocument, qualitiesDocument } from "./build.mjs";
import { PROPOSAL, RECIPE_HIDE_RULE, SIGNAL_QUALITY_DEFAULT } from "./expected.mjs";
import { canonicalJson, compareText } from "./format.mjs";
import { sha256 } from "./hash.mjs";
import { renderReview } from "./review.mjs";

export function contentFiles(built) {
  const files = {
    "coverage.json": canonicalJson(built.coverage),
    "collisions.json": canonicalJson(built.collisions),
    "profile-diff.json": canonicalJson(built.profileDiff),
    "version-diff.json": canonicalJson(built.versionDiff),
    "review.md": renderReview(built),
  };
  for (const profile of Object.keys(built.profiles).sort(compareText)) {
    const document = built.profiles[profile];
    files[`${profile}.json`] = canonicalJson(document);
    files[`${profile}-paths.json`] = canonicalJson(pathsDocument(document));
    files[`${profile}-qualities.json`] = canonicalJson(qualitiesDocument(document));
  }
  return files;
}

export function manifestDocument(built) {
  return {
    schemaVersion: 1,
    gameVersion: built.coverage.gameVersion,
    menuConfirmed: false,
    collisionsResolved: built.collisions.resolved,
    namingRule: built.collisions.namingRule,
    proposal: PROPOSAL,
    blocking: built.collisions.blocking,
    snapshot: built.provenance.snapshot,
    inputs: built.provenance.inputs,
    generator: built.provenance.generator,
    evidence: {
      recipeHideFromSignalGui: RECIPE_HIDE_RULE,
      signalQualityDefault: SIGNAL_QUALITY_DEFAULT,
      signalMenu: built.profiles["space-age"].chooserReview ?? "unconfirmed",
      barrelActions: "Предмет бочки — основной путь. .fill и .empty — вложенные токены recipe по решению проекта. Крафт не выполняется.",
      captiveBiterSpawner: "Публичный путь только у предмета. Сущность сохранена с project-item-only.",
      biolab: "Публичный путь только у item/biolab. entity/biolab сохранена с chooser-observation-item-only. Версия наблюдения не указана, menuConfirmed не выставляется.",
      asteroidSignals: "Путь четырёх кусков назначен предмету по blueprint постоянного комбинатора 2.1.24. asteroid-chunk сохранён с chooser-blueprint-item. hide_from_signal_gui и item_signal_alias в снимке отсутствуют и не подставлены. Полное меню не подтверждено.",
      locale: "Подписи взяты из снимка. request_translation не вызывался. unresolved не является переводом.",
      iconPng: "Пути слоёв сохранены. PNG headless-снимка отсутствуют.",
      sort: "Порядок строк — UTF-16-сравнение строк порядка группы, подгруппы, прототипа, типа и имени. Локаль машины на publicPath не влияет.",
    },
    coverage: built.coverage.profiles,
  };
}

export function allFiles(built) {
  const files = contentFiles(built);
  const outputs = Object.keys(files).sort(compareText).map((name) => ({ name, sha256: sha256(files[name]) }));
  const manifest = manifestDocument(built);
  manifest.outputs = outputs;
  files["manifest.json"] = canonicalJson(manifest);
  return files;
}
