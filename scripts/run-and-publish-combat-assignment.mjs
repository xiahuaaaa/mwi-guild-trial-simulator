#!/usr/bin/env node
/**
 * Combat trial assignment pipeline:
 *   1) run available-roster composition lab (latest members)
 *   2) render 4 PNGs into artifacts/test-report
 *   3) publish test assignment + assets to API
 *   4) push PNGs/JSON to public helper repo
 *
 * After insanity / nature-healer A/B, always pass --skip-sim so the lab JSON
 * is not overwritten. Playbook: docs/WEEKLY_COMBAT_SCREENING.md
 *
 * Usage:
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/run-and-publish-combat-assignment.mjs
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/run-and-publish-combat-assignment.mjs --skip-sim
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/run-and-publish-combat-assignment.mjs --dry-run
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/run-and-publish-combat-assignment.mjs --skip-publish
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertCombatRulesVersion } from "../packages/shykai-full-runtime/src/combat-rules-version.mjs";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const skipSim = process.argv.includes("--skip-sim");
const skipPublish = process.argv.includes("--skip-publish");
const skipApiPublish = process.argv.includes("--skip-api-publish");

const assignmentJsonPath =
  process.env.MWI_AVAILABLE_REPORT_JSON ??
  path.join(projectRoot, ".local/tmd-available-roster-composition-lab.json");
const outputDirectory =
  process.env.MWI_TEST_REPORT_DIR ??
  path.join(projectRoot, "artifacts/test-report");

function run(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    const detail = result.error?.message
      ?? (result.status == null ? `signal ${result.signal ?? "unknown"}` : `exit ${result.status}`);
    throw new Error(`command failed: ${cmd} ${args.join(" ")} (${detail})`);
  }
}

if (!process.env.MWI_GUILD_API_ADMIN_KEY?.trim() && !skipSim) {
  throw new Error("MWI_GUILD_API_ADMIN_KEY is required");
}

if (!skipSim) {
  console.log("==> running available-roster composition lab");
  run(process.execPath, ["scripts/run-available-roster-composition-lab.mjs"], {
    ...process.env,
    MWI_GUILD_API_BASE:
      process.env.MWI_GUILD_API_BASE ?? "https://adudu.tailab136f.ts.net",
  });
} else {
  console.log(`==> skip-sim: using ${assignmentJsonPath}`);
}

const assignment = JSON.parse(readFileSync(assignmentJsonPath, "utf8"));
assertCombatRulesVersion(assignment, assignmentJsonPath);
if (!assignment?.generatedAt) {
  throw new Error(`assignment JSON missing generatedAt: ${assignmentJsonPath}`);
}

console.log("==> rendering report PNGs");
const renderEnv = {
  ...process.env,
  MWI_AVAILABLE_REPORT_JSON: assignmentJsonPath,
  MWI_TEST_REPORT_DIR: outputDirectory,
  MWI_REPORT_SEND: "0",
  // Assignment JSON goes to API; PNG assets are served from repo checkout /
  // public helper repo, so API asset upload is optional (older hosts may 404).
  MWI_REPORT_PUBLISH_ASSIGNMENT: skipApiPublish || dryRun ? "0" : "1",
  MWI_REPORT_PUBLISH_ASSETS: "0",
};
run(process.execPath, ["scripts/render-and-send-available-roster-report.mjs"], renderEnv);

mkdirSync(outputDirectory, { recursive: true });
copyFileSync(assignmentJsonPath, path.join(outputDirectory, "latest.json"));

const manifestPath = path.join(outputDirectory, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const files = Array.isArray(manifest.files) ? manifest.files : [];
if (files.length !== 4) {
  throw new Error(`expected 4 report files in ${manifestPath}`);
}

const {
  publishCombatAssignmentReportToGithub,
} = await import(
  pathToFileURL(
    path.join(projectRoot, "apps/qq-bot/src/combat-assignment-publish.ts"),
  ).href
);
const {
  COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL,
  formatCombatAssignmentReportSummary,
} = await import(
  pathToFileURL(
    path.join(projectRoot, "apps/qq-bot/src/combat-assignment-report.ts"),
  ).href
);

writeFileSync(
  path.join(outputDirectory, "README.md"),
  [
    "# 本周分工结果图",
    "",
    "由 `scripts/run-and-publish-combat-assignment.mjs` 生成。",
    "",
    `- assignmentGeneratedAt：\`${assignment.generatedAt}\``,
    `- kind：\`${assignment.kind ?? ""}\``,
    "",
    `公网浏览（可选图片）：${COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL}`,
    "",
    "QQ 命令：`本周分工`",
    "",
  ].join("\n"),
);

// QQ bot LaunchAgent reads MWI_TEST_REPORT_DIR under the runtime install.
// Keep that copy in sync when publishing from the workspace checkout.
const runtimeReportDir = path.resolve(
  process.env.MWI_RUNTIME_TEST_REPORT_DIR ??
    path.join(homedir(), ".local/share/mwi-guild-server/artifacts/test-report"),
);
if (
  existsSync(path.dirname(runtimeReportDir)) &&
  path.resolve(outputDirectory) !== runtimeReportDir
) {
  mkdirSync(runtimeReportDir, { recursive: true });
  cpSync(outputDirectory, runtimeReportDir, { recursive: true });
  console.log(`==> synced QQ bot report dir: ${runtimeReportDir}`);
}

console.log(
  formatCombatAssignmentReportSummary({
    summaryText: String(assignment.summaryText ?? ""),
    files,
  }),
);

if (skipPublish) {
  console.log("skip-publish: local artifacts only");
  process.exit(0);
}

const published = publishCombatAssignmentReportToGithub({
  assignmentGeneratedAt: String(assignment.generatedAt),
  assignmentKind: assignment.kind,
  summaryText: assignment.summaryText,
  reportDirectory: outputDirectory,
  files,
  englishFiles: Array.isArray(manifest.englishFiles) ? manifest.englishFiles : [],
  assignmentJsonPath: path.join(outputDirectory, "latest.json"),
  dryRun,
});
console.log(published.message);
console.log(published.publicBaseUrl);
