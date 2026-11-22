import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TABS = [
  ["Logistic", "01 Логистика"],
  ["Production", "02 Производство"],
  ["Intermediate", "03 Компоненты"],
  ["Space", "04 Космос"],
  ["Combat", "05 Вооружение"],
  ["Fluids", "06 Жидкости"],
  ["Signals", "07 Сигналы"],
  ["Enemies", "08 Враги"],
  ["Environment", "09 Окружение"],
  ["Unsorted", "10 Несортированное"],
];
const VERSION = 562954249961473;

export function makeSurvey(document) {
  if (document.gameVersion !== "2.1.24" || document.profile !== "space-age") throw new Error("Нужен каталог Space Age 2.1.24");
  const seen = new Set();
  const sections = TABS.map(([section, group], tab) => {
    const filters = document.rows.filter(row => row.publicSection === section && row.publicPath && row.role === "ordinary").map((row, slot) => {
      if (seen.has(row.prototypeId)) throw new Error(`Повтор сигнала ${row.prototypeId}`);
      seen.add(row.prototypeId);
      return {
        index: slot + 1,
        ...(row.gameType === "item" ? {} : { type: row.gameType }),
        name: row.gameName,
        quality: "normal",
        comparator: "=",
        count: 1,
      };
    });
    if (filters.length > 1000) throw new Error(`Вкладка ${section} не помещается в одну секцию`);
    return { index: tab + 1, group, filters };
  });
  const expected = document.rows.filter(row => row.publicPath && row.role === "ordinary");
  if (seen.size !== expected.length) throw new Error("Есть обычные экспортированные сигналы вне десяти вкладок");
  return { blueprint: {
    item: "blueprint",
    version: VERSION,
    label: "f logic · Space Age · каталог сигналов",
    description: "Черновик для сверки: 1 постоянный комбинатор, 10 групп = 10 вкладок меню. Все значения 1, качество normal. Добавьте недостающие сигналы, удалите лишние и верните экспортированный чертёж. Импорт не подтверждает наличие сигнала в меню.",
    icons: [{ signal: { name: "constant-combinator" }, index: 1 }],
    entities: [{
      entity_number: 1,
      name: "constant-combinator",
      position: { x: .5, y: .5 },
      control_behavior: { sections: { sections } },
    }],
  } };
}

export function encodeBlueprint(document) {
  return "0" + deflateSync(Buffer.from(JSON.stringify(document))).toString("base64");
}

export async function main(root = process.cwd()) {
  const catalogPath = "data/signal-catalog/2.1.24/space-age.json";
  const bytes = await readFile(path.join(root, catalogPath));
  const blueprint = makeSurvey(JSON.parse(bytes));
  const text = encodeBlueprint(blueprint);
  const decoded = JSON.parse(inflateSync(Buffer.from(text.slice(1), "base64")));
  if (JSON.stringify(decoded) !== JSON.stringify(blueprint)) throw new Error("Ошибка round-trip blueprint");
  const sections = blueprint.blueprint.entities[0].control_behavior.sections.sections;
  const folder = path.join(root, "data/review/constant-combinator-space-age-2026-11-18");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "blueprint.txt"), text + "\n");
  await writeFile(path.join(folder, "blueprint.json"), JSON.stringify(blueprint, null, 2) + "\n");
  await writeFile(path.join(folder, "manifest.json"), JSON.stringify({
    gameVersion: "2.1.24", profile: "space-age", draft: true, menuConfirmed: false,
    input: { path: catalogPath, sha256: createHash("sha256").update(bytes).digest("hex") },
    entities: 1, sections: sections.length,
    signals: sections.reduce((sum, section) => sum + section.filters.length, 0),
    groups: sections.map(section => ({ index: section.index, name: section.group, count: section.filters.length })),
  }, null, 2) + "\n");
  console.log(JSON.stringify(sections.map(section => ({ group: section.group, signals: section.filters.length }))));
  console.log(`${folder}/blueprint.txt`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
