import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { validateMemberCapabilitySnapshot } from "../packages/mwi-adapter/src/index.ts";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node scripts/validate-member-snapshot.mjs <snapshot.json> [...]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const path = resolve(file);
  try {
    const input = JSON.parse(await readFile(path, "utf8"));
    const result = validateMemberCapabilitySnapshot(input);
    if (!result.ok) {
      failed = true;
      console.error(`${path}: invalid`);
      for (const error of result.errors) console.error(`- ${error}`);
    } else {
      console.log(`${path}: valid (${result.value.approvedBuilds.length} approved builds)`);
    }
  } catch (error) {
    failed = true;
    console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exit(failed ? 1 : 0);
