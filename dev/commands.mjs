import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "test";

function testFiles(directory) {
  const result = [];
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...testFiles(relative));
    else if (entry.name.endsWith(".test.mjs")) result.push(relative);
  }
  return result;
}

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", () => resolve(127));
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

function runTests(directory) {
  const files = testFiles(directory);
  if (files.length === 0) {
    console.error(`Нет тестов в ${directory}`);
    return Promise.resolve(1);
  }
  return run(["node", "--test", "--test-reporter=spec", ...files]);
}

if (command === "test") {
  process.exit(await runTests("test/unit"));
}

if (command === "test:browser") {
  process.exit(await runTests("test/browser"));
}

if (command === "serve") {
  process.exit(await run(["node", "dev/server.mjs"]));
}

if (command === "test:full") {
  const include = [
    "--include=dev/smoke/**/*.js",
    "--include=dev/sample/**/*.js",
  ];
  if (existsSync(path.join(root, "src"))) include.push("--include=src/**/*.js");
  const code = await run([
    "c8",
    "--all",
    ...include,
    "--exclude=test/**",
    "--exclude=dev/artifacts/**",
    "--reporter=text",
    "--reporter=lcov",
    "--reporter=html",
    "--reports-dir=dev/artifacts/coverage",
    "node",
    "--test",
    "--test-reporter=spec",
    ...testFiles("test/unit"),
    ...testFiles("test/browser"),
  ]);
  if (code !== 0) process.exit(code);
  await import("./check-coverage.mjs");
  process.exit(0);
}

console.error(`Неизвестная команда: ${command}`);
console.error("Ожидается test, test:browser, test:full или serve.");
process.exit(2);
