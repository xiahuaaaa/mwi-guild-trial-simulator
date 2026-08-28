import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LifeAssignmentRun } from "../../../packages/guild-trial-core/src/life-trial-optimizer.ts";
import {
  LIFE_ASSIGNMENT_PUBLIC_JSON_URL,
  LIFE_ASSIGNMENT_PUBLIC_PNG_URL,
} from "./life-assignment-report.ts";
import {
  buildCombatAssignmentIndexHtml,
  WEEKLY_ASSIGNMENT_PUBLIC_INDEX_URL,
} from "./combat-assignment-report.ts";
import { resolveHelperRepoCloneUrl } from "./github-helper-repo.ts";
const REPORT_DIR_IN_REPO = "reports/life-assignment";

export interface PublishLifeAssignmentReportInput {
  run: LifeAssignmentRun;
  pngPath: string;
  jsonPath?: string;
  dryRun?: boolean;
}

export interface PublishLifeAssignmentReportResult {
  published: boolean;
  skipped: boolean;
  publicPngUrl: string;
  publicJsonUrl: string;
  message: string;
}

function run(
  cmd: string[],
  cwd: string,
  { allowFail = false, env = process.env }: { allowFail?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  if (result.status !== 0 && !allowFail) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`command failed (${cmd.join(" ")}):\n${detail}`);
  }
  return result;
}

function gitIdentityEnv(): NodeJS.ProcessEnv {
  const name =
    process.env.GIT_AUTHOR_NAME ||
    process.env.GIT_COMMITTER_NAME ||
    "xiahuaaaa";
  const email =
    process.env.GIT_AUTHOR_EMAIL ||
    process.env.GIT_COMMITTER_EMAIL ||
    "xiahuaaaa@users.noreply.github.com";
  return {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

/**
 * Push life-assignment PNG/JSON to the public helper repo so members can open
 * raw.githubusercontent.com without Tailscale.
 */
export function publishLifeAssignmentReportToGithub(
  input: PublishLifeAssignmentReportInput,
): PublishLifeAssignmentReportResult {
  const publicPngUrl = LIFE_ASSIGNMENT_PUBLIC_PNG_URL;
  const publicJsonUrl = LIFE_ASSIGNMENT_PUBLIC_JSON_URL;
  if (input.dryRun) {
    return {
      published: false,
      skipped: true,
      publicPngUrl,
      publicJsonUrl,
      message: "dry-run: skipped helper clone/push",
    };
  }

  const png = readFileSync(input.pngPath);
  const jsonText = input.jsonPath
    ? readFileSync(input.jsonPath, "utf8")
    : `${JSON.stringify(input.run, null, 2)}\n`;
  const manifest = {
    kind: "life-assignment-report",
    weekStartAt: input.run.weekStartAt,
    generatedAt: input.run.generatedAt,
    totalBasePoints: input.run.totalBasePoints,
    publicPngUrl,
    publicJsonUrl,
    files: [
      { fileName: "latest.png", title: "本周生活分工" },
      { fileName: "latest.json", title: "本周生活分工 JSON" },
    ],
  };

  const work = mkdtempSync(path.join(tmpdir(), "mwi-life-report-publish-"));
  try {
    run(["git", "clone", "--depth", "1", resolveHelperRepoCloneUrl(), work]);
    const reportDir = path.join(work, REPORT_DIR_IN_REPO);
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(path.join(reportDir, "latest.png"), png);
    writeFileSync(path.join(reportDir, "latest.json"), jsonText);
    writeFileSync(
      path.join(reportDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    writeFileSync(
      path.join(reportDir, "README.md"),
      [
        "# 本周生活分工",
        "",
        `- 公会周：\`${input.run.weekStartAt}\``,
        `- 生成时间：\`${input.run.generatedAt}\``,
        `- 基础点数合计：\`${input.run.totalBasePoints}\``,
        "",
        `图片：${publicPngUrl}`,
        `JSON：${publicJsonUrl}`,
        `统一浏览页（生活+战斗）：${WEEKLY_ASSIGNMENT_PUBLIC_INDEX_URL}`,
        "",
      ].join("\n"),
    );

    // Keep the weekly gallery index pointing at this life PNG (first tab).
    refreshWeeklyGalleryIndex(work, input.run.generatedAt);

    const status = run(["git", "status", "--porcelain"], work);
    if (!status.stdout.trim()) {
      return {
        published: false,
        skipped: true,
        publicPngUrl,
        publicJsonUrl,
        message: "helper life-assignment report already up to date",
      };
    }

    run(["git", "add", REPORT_DIR_IN_REPO, "reports/combat-assignment/index.html"], work);
    const message =
      `chore: refresh life assignment report (${input.run.weekStartAt}, ${input.run.totalBasePoints} pts)`;
    run(["git", "commit", "-m", message], work, { env: gitIdentityEnv() });
    run(["git", "push", "origin", "HEAD"], work);
    return {
      published: true,
      skipped: false,
      publicPngUrl,
      publicJsonUrl,
      message: "published life assignment report to public helper repo",
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Rewrite reports/combat-assignment/index.html so 生活分工 stays the first tab. */
function refreshWeeklyGalleryIndex(helperRepoRoot: string, generatedAt: string): void {
  const combatDir = path.join(helperRepoRoot, "reports/combat-assignment");
  mkdirSync(combatDir, { recursive: true });
  let files: Array<{ title: string; fileName: string }> = [];
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(combatDir, "manifest.json"), "utf8"),
    ) as { files?: Array<{ title?: string; fileName?: string }> };
    files = (manifest.files ?? [])
      .filter((entry): entry is { title: string; fileName: string } =>
        Boolean(entry.fileName && entry.title)
      );
  } catch {
    // combat report may not exist yet; still publish life-only gallery shell
  }
  writeFileSync(
    path.join(combatDir, "index.html"),
    buildCombatAssignmentIndexHtml({
      assignmentGeneratedAt: generatedAt,
      files,
      includeLife: true,
    }),
  );
}

/** Copy local artifacts into a directory (used by scripts / Windows checkout). */
export function copyLifeAssignmentArtifacts(
  sourceDirectory: string,
  targetDirectory: string,
): void {
  mkdirSync(targetDirectory, { recursive: true });
  for (const fileName of ["latest.png", "latest.json", "manifest.json", "README.md"]) {
    const source = path.join(sourceDirectory, fileName);
    try {
      copyFileSync(source, path.join(targetDirectory, fileName));
    } catch {
      // optional README may be missing locally
    }
  }
}
