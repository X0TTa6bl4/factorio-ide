import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lcovPath = path.join(root, "dev/artifacts/coverage/lcov.info");
const htmlPath = path.join(root, "dev/artifacts/coverage/index.html");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(lcovPath)) fail(`нет отчёта ${lcovPath}`);
if (!existsSync(htmlPath)) fail(`нет HTML-отчёта ${htmlPath}`);

const blocks = readFileSync(lcovPath, "utf8").split("end_of_record");

function hits(name) {
  const block = blocks.find((part) => part.includes(name));
  if (!block) fail(`${name} отсутствует в lcov`);
  return [...block.matchAll(/^DA:\d+,(\d+)/gm)].map((match) => Number(match[1]));
}

const uncovered = hits("unexecuted.js");
if (uncovered.length === 0) fail("у unexecuted.js нет строк в покрытии");
if (uncovered.some((hit) => hit !== 0)) fail(`unexecuted.js исполнен: ${uncovered.join(",")}`);

for (const name of ["executed.js", "dev/smoke/app.js"]) {
  const covered = hits(name);
  if (!covered.some((hit) => hit > 0)) fail(`${name} не отмечен как исполненный`);
}

console.log(`coverage: unexecuted.js lines=${uncovered.length} hits=0; html сохранён`);
