import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildCatalog } from "./build.mjs";
import { CatalogError } from "./errors.mjs";
import { loadGenerator, loadSnapshot } from "./load.mjs";
import { allFiles } from "./outputs.mjs";
import { publishDirectory } from "./publish.mjs";

export function isDirectRun(metaUrl, argv1) {
  if (!argv1) return false;
  return metaUrl === pathToFileURL(argv1).href;
}

export function exitCodeFor(error) {
  if (!error) return 0;
  if (error instanceof CatalogError && error.code === "usage") return 2;
  return 1;
}

export function parseArgs(argv) {
  let snapshot = null;
  let out = null;
  let review = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--snapshot") {
      if (snapshot) throw new CatalogError("usage", "Повтор --snapshot");
      snapshot = argv[index + 1];
      if (!snapshot) throw new CatalogError("usage", "После --snapshot нужен путь");
      index += 1;
    } else if (arg === "--out") {
      if (out) throw new CatalogError("usage", "Повтор --out");
      out = argv[index + 1];
      if (!out) throw new CatalogError("usage", "После --out нужен путь");
      index += 1;
    } else if (arg === "--chooser-review") {
      if (review) throw new CatalogError("usage", "Повтор --chooser-review");
      review = argv[index + 1];
      if (!review) throw new CatalogError("usage", "После --chooser-review нужен путь");
      index += 1;
    } else {
      throw new CatalogError("usage", `Неизвестный аргумент ${arg}`);
    }
  }
  if (!snapshot || !out) throw new CatalogError("usage", "Нужны --snapshot и --out");
  return { snapshot, out, ...(review ? { review } : {}) };
}

export function provenanceFor(loaded, snapshotArg, generator) {
  return {
    snapshot: {
      root: snapshotArg.split(path.sep).join("/"),
      gameVersion: loaded.manifest.gameVersion,
      archiveSha256: loaded.manifest.archiveSha256,
      builderSha256: loaded.manifest.builderSha256,
      loaderSha256: loaded.manifest.loaderSha256,
      engineValidation: loaded.manifest.engineValidation,
      extraction: loaded.manifest.extraction ?? null,
      iconFilesCopied: loaded.manifest.iconFiles?.copied ?? null,
      iconFilesReferenced: loaded.manifest.iconFiles?.referenced ?? null,
    },
    inputs: loaded.inputs,
    generator,
  };
}

export async function main(argv, cwd = process.cwd()) {
  const args = parseArgs(argv);
  const loaded = await loadSnapshot(path.resolve(cwd, args.snapshot), args.snapshot, args.review ? path.resolve(cwd, args.review) : null, args.review);
  const generator = await loadGenerator(cwd);
  const built = buildCatalog(loaded, provenanceFor(loaded, args.snapshot, generator));
  await publishDirectory(path.resolve(cwd, args.out), allFiles(built));
  const base = built.coverage.profiles.base;
  const spaceAge = built.coverage.profiles["space-age"];
  console.log(
    `signal-catalog ${built.coverage.gameVersion}: base ${base.rows}/${base.exported}, space-age ${spaceAge.rows}/${spaceAge.exported}, collisionsResolved=${built.collisions.resolved}`,
  );
  return built;
}

/* Процессный вход: завершение процесса проверяется запуском CLI, не веткой библиотеки. */
/* c8 ignore start */
if (isDirectRun(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(exitCodeFor(error));
    },
  );
}
/* c8 ignore stop */
