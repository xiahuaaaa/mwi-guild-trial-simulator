import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testSuffix = /\.test\.(?:[cm]?js|ts)$/;
const ignoredDirectories = new Set(["node_modules", "dist", "coverage"]);

async function collectTests(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await collectTests(path));
    } else if (testSuffix.test(entry.name)) {
      result.push(path);
    }
  }
  return result;
}

const tests = (await collectTests(projectRoot)).sort();
if (!tests.length) {
  console.error("No tests found.");
  process.exit(1);
}

console.log(`Running ${tests.length} test files:`);
for (const test of tests) console.log(`- ${relative(projectRoot, test)}`);

const result = spawnSync(
  process.execPath,
  ["--test", ...tests],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
