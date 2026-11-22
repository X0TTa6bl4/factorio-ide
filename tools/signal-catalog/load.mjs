import { readFile } from "node:fs/promises";
import path from "node:path";
import { CatalogError } from "./errors.mjs";
import { PROFILES, TYPE_FILES } from "./expected.mjs";
import { compareText } from "./format.mjs";
import { sha256 } from "./hash.mjs";

export const GENERATOR_FILES = [
  "tools/signal-catalog/build.mjs",
  "tools/signal-catalog/cli.mjs",
  "tools/signal-catalog/chooser-review.mjs",
  "tools/signal-catalog/decisions.mjs",
  "tools/signal-catalog/errors.mjs",
  "tools/signal-catalog/expected.mjs",
  "tools/signal-catalog/format.mjs",
  "tools/signal-catalog/hash.mjs",
  "tools/signal-catalog/load.mjs",
  "tools/signal-catalog/names.mjs",
  "tools/signal-catalog/outputs.mjs",
  "tools/signal-catalog/publish.mjs",
  "tools/signal-catalog/review.mjs",
  "tools/signal-catalog/tree.mjs",
];

function slash(root, ...parts) {
  return [root.split(path.sep).join("/"), ...parts].filter((part) => part !== "").join("/");
}

async function readJson(file) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") throw new CatalogError("schema", `Нет файла ${file}`);
    throw error;
  }
  try {
    return { data: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes) };
  } catch {
    throw new CatalogError("schema", `Повреждённый JSON ${file}`);
  }
}

export async function loadSnapshot(snapshotDir, pathLabel = snapshotDir, reviewFile = null, reviewLabel = reviewFile) {
  const root = path.resolve(snapshotDir);
  const label = pathLabel.split(path.sep).join("/");
  const manifestFile = await readJson(path.join(root, "manifest.json"));
  const specialFile = await readJson(path.join(root, "special-signals.json"));
  if (!Array.isArray(specialFile.data)) {
    throw new CatalogError("schema", "special-signals.json должен быть массивом");
  }
  const inputs = [
    { path: slash(label, "manifest.json"), sha256: manifestFile.sha256 },
    { path: slash(label, "special-signals.json"), sha256: specialFile.sha256 },
  ];
  const profiles = {};
  for (const profile of PROFILES) {
    const groupsFile = await readJson(path.join(root, profile, "groups.json"));
    const records = [];
    for (const [type, fileName] of Object.entries(TYPE_FILES)) {
      const loaded = await readJson(path.join(root, profile, fileName));
      if (!Array.isArray(loaded.data)) {
        throw new CatalogError("schema", `${profile}/${fileName} должен быть массивом`);
      }
      for (const record of loaded.data) {
        if (!record || record.type !== type) {
          throw new CatalogError("bad-record", `${profile}/${fileName}: запись не типа ${type}`);
        }
      }
      records.push(...loaded.data);
      inputs.push({ path: slash(label, profile, fileName), sha256: loaded.sha256 });
    }
    profiles[profile] = { records, groups: groupsFile.data };
    inputs.push({ path: slash(label, profile, "groups.json"), sha256: groupsFile.sha256 });
  }
  inputs.sort((left, right) => compareText(left.path, right.path));
  let chooserReview;
  if (reviewFile) {
    const review = await readJson(reviewFile);
    if (!review.data || typeof review.data !== "object" || Array.isArray(review.data)) throw new CatalogError("schema", "Сверка chooser должна быть объектом");
    chooserReview = review.data;
    inputs.push({ path: reviewLabel.split(path.sep).join("/"), sha256: review.sha256 });
    inputs.sort((left, right) => compareText(left.path, right.path));
  }
  const missing = manifestFile.data?.iconFiles?.missing;
  if (manifestFile.data?.iconFiles && !Array.isArray(missing)) {
    throw new CatalogError("schema", "manifest.iconFiles.missing должен быть массивом");
  }
  return {
    manifest: manifestFile.data,
    profiles,
    missingIcons: missing ?? [],
    specialSignals: specialFile.data,
    inputs,
    ...(chooserReview ? { chooserReview } : {}),
  };
}

export async function loadGenerator(rootDir, files = GENERATOR_FILES) {
  const listed = [];
  for (const relativePath of files) {
    let bytes;
    try {
      bytes = await readFile(path.join(rootDir, relativePath));
    } catch (error) {
      if (error.code === "ENOENT") throw new CatalogError("schema", `Нет файла генератора ${relativePath}`);
      throw error;
    }
    listed.push({ path: relativePath, sha256: sha256(bytes) });
  }
  return listed;
}
