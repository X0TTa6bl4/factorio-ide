import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CatalogError } from "./errors.mjs";
import { compareText } from "./format.mjs";

const io = { mkdir, mkdtemp, rename, rm, writeFile };

export async function publishDirectory(outDir, files, operations = io) {
  if (!files || typeof files !== "object" || Array.isArray(files) || Object.keys(files).length === 0) {
    throw new CatalogError("schema", "Нет файлов для публикации");
  }
  const target = path.resolve(outDir);
  const parent = path.dirname(target);
  await operations.mkdir(parent, { recursive: true });
  const temp = await operations.mkdtemp(path.join(parent, ".signal-catalog-"));
  const backup = `${target}.replacing`;
  try {
    for (const name of Object.keys(files).sort(compareText)) {
      if (name !== path.basename(name) || name.startsWith(".")) {
        throw new CatalogError("schema", `Недопустимое имя результата ${name}`);
      }
      await operations.writeFile(path.join(temp, name), files[name]);
    }
    await operations.rm(backup, { recursive: true, force: true });
    let hadPrevious = true;
    try {
      await operations.rename(target, backup);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hadPrevious = false;
    }
    try {
      await operations.rename(temp, target);
    } catch (error) {
      if (hadPrevious) await operations.rename(backup, target);
      throw error;
    }
    await operations.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await operations.rm(temp, { recursive: true, force: true });
    throw error;
  }
}
