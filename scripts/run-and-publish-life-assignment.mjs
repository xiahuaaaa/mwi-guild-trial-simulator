#!/usr/bin/env node
/**
 * Rebuild formal life assignment from live members, render PNG, and publish
 * to the public helper repo for member viewing.
 *
 * Usage:
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/run-and-publish-life-assignment.mjs
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/run-and-publish-life-assignment.mjs --dry-run
 *   MWI_LIFE_REPORT_FROM_BACKUP=1 node scripts/run-and-publish-life-assignment.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const fromBackup = process.argv.includes("--from-backup") ||
  process.env.MWI_LIFE_REPORT_FROM_BACKUP === "1";
const skipPublish = process.argv.includes("--skip-publish");
const apiBase = (
  process.env.MWI_GUILD_API_BASE ?? "https://adudu.tailab136f.ts.net"
).replace(/\/$/, "");
const guildId = process.env.MWI_GUILD_ID ?? "TMD";
const { resolveGuildReportPaths } = await import(
  pathToFileURL(path.join(projectRoot, "apps/qq-bot/src/guild-report-paths.ts")).href
);
const guildPaths = resolveGuildReportPaths(guildId, projectRoot);
const outputDirectory =
  process.env.MWI_LIFE_REPORT_DIR ?? guildPaths.lifeReportArtifactsDir;

const {
  generateLifeAssignmentRun,
  resolveLifeAssignmentEnvOverrides,
  weeklySkillingTrialsFromCatalog,
  formatLifeAssignmentRun,
} = await import(
  pathToFileURL(path.join(projectRoot, "apps/qq-bot/src/life-assignment.ts")).href
);
const {
  formatLifeAssignmentReportSummary,
  renderLifeAssignmentReportPng,
  writeLifeAssignmentReportArtifacts,
} = await import(
  pathToFileURL(
    path.join(projectRoot, "apps/qq-bot/src/life-assignment-report.ts"),
  ).href
);
const { publishLifeAssignmentReportToGithub } = await import(
  pathToFileURL(
    path.join(projectRoot, "apps/qq-bot/src/life-assignment-publish.ts"),
  ).href
);

async function fetchJson(urlPath, init = {}) {
  const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY?.trim();
  if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required");
  const response = await fetch(`${apiBase}${urlPath}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-admin-key": adminKey,
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `API ${response.status} ${urlPath}: ${payload?.error?.message ?? JSON.stringify(payload).slice(0, 300)}`,
    );
  }
  return payload;
}

async function loadFromBackup() {
  const backupDir = path.join(guildPaths.backupRootDir, "latest");
  const catalog = JSON.parse(
    await readFile(path.join(backupDir, "weekly-trials-current.json"), "utf8"),
  ).payload;
  const membersPayload = JSON.parse(
    await readFile(path.join(backupDir, "members.json"), "utf8"),
  ).payload;
  return { catalog, members: membersPayload.members ?? [] };
}

async function loadFromApi() {
  const [catalog, membersData] = await Promise.all([
    fetchJson(`/api/guilds/${encodeURIComponent(guildId)}/weekly-trials/current`),
    fetchJson(`/api/guilds/${encodeURIComponent(guildId)}/members`),
  ]);
  return { catalog, members: membersData.members ?? [] };
}

const { catalog, members } = fromBackup ? await loadFromBackup() : await loadFromApi();
const trials = weeklySkillingTrialsFromCatalog(catalog);
if (trials.length !== 4) {
  throw new Error(`expected 4 skilling trials, got ${trials.length}`);
}

const overrides = resolveLifeAssignmentEnvOverrides(guildId, trials);
if (overrides.reservedSlotsByTrial.size) {
  const lines = [...overrides.reservedSlotsByTrial.entries()].map(([key, count]) => `${key}:${count}`);
  console.log(`life reserve slots: ${lines.join(", ")}`);
}
if (overrides.pinnedAssignments.size) {
  const lines = [...overrides.pinnedAssignments.entries()].map(([memberId, trialHrid]) => {
    const trial = trials.find((row) => row.trialHrid === trialHrid);
    return `${memberId}→${trial?.trialName ?? trialHrid}`;
  });
  console.log(`life pinned members: ${lines.join(", ")}`);
}

const run = generateLifeAssignmentRun({
  weekStartAt: String(catalog.weekStartAt ?? new Date().toISOString()),
  trials,
  members: members.map((member) => ({
    memberId: String(member.memberId),
    displayName: String(member.displayName ?? member.memberId),
    latestSnapshot: member.latestSnapshot,
  })),
  ...overrides,
});

console.log(formatLifeAssignmentRun(run));
console.log(`\nmembers_with_snapshot=${members.filter((m) => m.latestSnapshot).length}`);

if (!fromBackup && !dryRun) {
  await fetchJson(
    `/api/admin/guilds/${encodeURIComponent(guildId)}/life-assignments/formal`,
    {
      method: "PUT",
      body: JSON.stringify({ assignment: run }),
    },
  );
  console.log("saved formal life assignment to API");
}

const png = await renderLifeAssignmentReportPng(run);
const artifacts = writeLifeAssignmentReportArtifacts(run, png, outputDirectory, {
  apiSlug: guildId,
});
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "README.md"),
  [
    "# 本周生活分工",
    "",
    "由 `scripts/run-and-publish-life-assignment.mjs` 生成。",
    "",
    `- 公会周：\`${run.weekStartAt}\``,
    `- 生成时间：\`${run.generatedAt}\``,
    `- 基础点数合计：\`${run.totalBasePoints}\``,
    "",
    `公网图片：${guildPaths.lifePublicPngUrl}`,
    "",
  ].join("\n"),
);

console.log(`wrote ${artifacts.pngPath}`);
console.log(formatLifeAssignmentReportSummary(run, { apiSlug: guildId }));

if (skipPublish) {
  console.log("skip-publish: local artifacts only");
  process.exit(0);
}

const published = publishLifeAssignmentReportToGithub({
  run,
  pngPath: artifacts.pngPath,
  jsonPath: artifacts.jsonPath,
  dryRun,
  apiSlug: guildId,
});
console.log(published.message);
console.log(published.publicPngUrl);
