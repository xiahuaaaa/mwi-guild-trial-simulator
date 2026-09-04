import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL,
  buildCombatAssignmentManifest,
  formatCombatAssignmentReportSummary,
} from "../../apps/qq-bot/src/combat-assignment-report.ts";
import {
  TMD_DEFAULT_EXCLUDE_MEMBERS,
  defaultExcludeMembersForSlug,
  labArtifactKind,
  parseExcludedMemberIds,
  resolveExcludeMembersEnv,
  resolveGuildReportPaths,
  resolveLifeReportDirectory,
} from "../../apps/qq-bot/src/guild-report-paths.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("TMD default combat public index stays on unprefixed helper path", () => {
  assert.equal(
    COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL,
    "https://xiahuaaaa.github.io/mwi-guild-trial-helper/reports/combat-assignment/",
  );
  const tmd = resolveGuildReportPaths("TMD", projectRoot);
  assert.equal(tmd.combatReportDirInRepo, "reports/combat-assignment");
  assert.equal(tmd.lifeReportDirInRepo, "reports/life-assignment");
});

test("WI publish paths use reports/WI/ prefix and do not target TMD latest dirs", () => {
  const wi = resolveGuildReportPaths("WI", projectRoot);
  const tmd = resolveGuildReportPaths("TMD", projectRoot);

  assert.equal(wi.combatReportDirInRepo, "reports/WI/combat-assignment");
  assert.equal(wi.lifeReportDirInRepo, "reports/WI/life-assignment");
  assert.match(wi.combatPublicIndexUrl, /\/reports\/WI\/combat-assignment\/$/u);
  assert.match(wi.lifePublicPngUrl, /reports\/WI\/life-assignment\/latest\.png$/u);
  assert.match(wi.lifePublicJsonUrl, /reports\/WI\/life-assignment\/latest\.json$/u);

  assert.notEqual(wi.combatReportDirInRepo, tmd.combatReportDirInRepo);
  assert.notEqual(wi.lifeReportDirInRepo, tmd.lifeReportDirInRepo);
  assert.notEqual(wi.combatPublicIndexUrl, tmd.combatPublicIndexUrl);
  assert.doesNotMatch(wi.combatPublicIndexUrl, /\/reports\/combat-assignment\/$/u);
});

test("formatCombatAssignmentReportSummary uses WI gallery URL when apiSlug=WI", () => {
  const wi = resolveGuildReportPaths("WI");
  const text = formatCombatAssignmentReportSummary({
    summaryText: "demo",
    files: [{ title: "试炼獾 · 阵容与技能", fileName: "1-jellyfish-summary.png" }],
    apiSlug: "WI",
  });
  assert.match(
    text,
    new RegExp(wi.combatPublicIndexUrl.replaceAll(".", "\\."), "u"),
  );
  assert.match(text, /reports\/WI\/combat-assignment\/1-jellyfish-summary\.png/u);
  assert.doesNotMatch(text, /reports\/combat-assignment\/1-jellyfish-summary\.png/u);
});

test("buildCombatAssignmentManifest stamps WI public URLs separately from TMD", () => {
  const wiManifest = buildCombatAssignmentManifest({
    assignmentGeneratedAt: "2026-08-04T03:00:00.000Z",
    files: [{ title: "a", fileName: "1-jellyfish-summary.png" }],
    apiSlug: "WI",
  });
  const tmdManifest = buildCombatAssignmentManifest({
    assignmentGeneratedAt: "2026-08-04T03:00:00.000Z",
    files: [{ title: "a", fileName: "1-jellyfish-summary.png" }],
    apiSlug: "TMD",
  });
  assert.match(wiManifest.publicIndexUrl, /reports\/WI\/combat-assignment\//u);
  assert.equal(tmdManifest.publicIndexUrl, COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL);
  assert.notEqual(wiManifest.publicJsonUrl, tmdManifest.publicJsonUrl);
});

test("local artifacts, lab JSON, lock, backup, and cache paths split by apiSlug", () => {
  const wi = resolveGuildReportPaths("WI", projectRoot);
  const tmd = resolveGuildReportPaths("TMD", projectRoot);

  assert.equal(wi.testReportArtifactsDir, path.join(projectRoot, "artifacts/WI/test-report"));
  assert.equal(tmd.testReportArtifactsDir, path.join(projectRoot, "artifacts/test-report"));
  assert.equal(wi.lifeReportArtifactsDir, path.join(projectRoot, "artifacts/WI/life-report"));
  assert.equal(tmd.lifeReportArtifactsDir, path.join(projectRoot, "artifacts/life-report"));

  assert.equal(
    wi.availableRosterLabJsonPath,
    path.join(projectRoot, ".local/wi-available-roster-composition-lab.json"),
  );
  assert.equal(
    tmd.availableRosterLabJsonPath,
    path.join(projectRoot, ".local/tmd-available-roster-composition-lab.json"),
  );

  assert.equal(wi.combatTestRunStatePath, path.join(projectRoot, ".local/wi-combat-test-run.json"));
  assert.equal(tmd.combatTestRunStatePath, path.join(projectRoot, ".local/combat-test-run.json"));
  assert.notEqual(wi.combatTestRunStatePath, tmd.combatTestRunStatePath);

  assert.equal(wi.backupRootDir, path.join(projectRoot, "backups/wi"));
  assert.equal(tmd.backupRootDir, path.join(projectRoot, "backups/tmd"));
  assert.notEqual(wi.backupRootDir, tmd.backupRootDir);

  assert.equal(
    wi.professionReportCacheDir,
    "/var/lib/mwi-guild-server/qq-profession-report-cache/WI",
  );
  assert.equal(
    tmd.professionReportCacheDir,
    "/var/lib/mwi-guild-server/qq-profession-report-cache",
  );
});

test("resolveLifeReportDirectory does not route WI through TMD env override", () => {
  const prevTmd = process.env.MWI_LIFE_REPORT_DIR;
  const prevWi = process.env.MWI_LIFE_REPORT_DIR_WI;
  process.env.MWI_LIFE_REPORT_DIR = "/srv/tmd-life-report";
  process.env.MWI_LIFE_REPORT_DIR_WI = "/srv/wi-life-report";
  try {
    assert.equal(resolveLifeReportDirectory("TMD", projectRoot), "/srv/tmd-life-report");
    assert.equal(resolveLifeReportDirectory("WI", projectRoot), "/srv/wi-life-report");
  } finally {
    if (prevTmd === undefined) delete process.env.MWI_LIFE_REPORT_DIR;
    else process.env.MWI_LIFE_REPORT_DIR = prevTmd;
    if (prevWi === undefined) delete process.env.MWI_LIFE_REPORT_DIR_WI;
    else process.env.MWI_LIFE_REPORT_DIR_WI = prevWi;
  }
});

test("resolveLifeReportDirectory falls back to slug artifact dirs when env unset", () => {
  const prevTmd = process.env.MWI_LIFE_REPORT_DIR;
  const prevWi = process.env.MWI_LIFE_REPORT_DIR_WI;
  delete process.env.MWI_LIFE_REPORT_DIR;
  delete process.env.MWI_LIFE_REPORT_DIR_WI;
  try {
    assert.equal(
      resolveLifeReportDirectory("WI", projectRoot),
      path.join(projectRoot, "artifacts/WI/life-report"),
    );
    assert.equal(
      resolveLifeReportDirectory("TMD", projectRoot),
      path.join(projectRoot, "artifacts/life-report"),
    );
  } finally {
    if (prevTmd === undefined) delete process.env.MWI_LIFE_REPORT_DIR;
    else process.env.MWI_LIFE_REPORT_DIR = prevTmd;
    if (prevWi === undefined) delete process.env.MWI_LIFE_REPORT_DIR_WI;
    else process.env.MWI_LIFE_REPORT_DIR_WI = prevWi;
  }
});

test("exclude-member defaults follow apiSlug when env is unset", () => {
  assert.equal(defaultExcludeMembersForSlug("TMD"), TMD_DEFAULT_EXCLUDE_MEMBERS);
  assert.equal(defaultExcludeMembersForSlug("WI"), "");
  assert.equal(
    resolveExcludeMembersEnv("TMD", undefined),
    TMD_DEFAULT_EXCLUDE_MEMBERS,
  );
  assert.equal(resolveExcludeMembersEnv("WI", undefined), "");
  assert.equal(resolveExcludeMembersEnv("TMD", ""), "");
  assert.equal(resolveExcludeMembersEnv("WI", "alice,bob"), "alice,bob");
});

test("parseExcludedMemberIds normalizes names for roster lab filtering", () => {
  const tmd = parseExcludedMemberIds("TMD", undefined);
  assert.deepEqual([...tmd].sort(), ["sh1ro", "xlsx"]);
  assert.equal(parseExcludedMemberIds("WI", undefined).size, 0);
});

test("labArtifactKind uses slug prefix without colliding TMD/WI filenames", () => {
  assert.equal(
    labArtifactKind("TMD", "available-roster-composition-lab"),
    "tmd-available-roster-composition-lab",
  );
  assert.equal(
    labArtifactKind("WI", "available-roster-composition-lab"),
    "wi-available-roster-composition-lab",
  );
});

test("ab weekly scripts query snapshots with guildId instead of hardcoded TMD", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const script of [
    "scripts/ab-nature-healer-to-dps.mjs",
    "scripts/ab-insanity-top-dps.mjs",
  ]) {
    const source = await readFile(path.join(projectRoot, script), "utf8");
    assert.doesNotMatch(source, /\.all\("TMD"/u);
    assert.match(source, /\.all\(guildId,\s*memberId\)/u);
  }
});
