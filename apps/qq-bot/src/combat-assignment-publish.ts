import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildCombatAssignmentIndexHtml,
  buildCombatAssignmentManifest,
  COMBAT_ASSIGNMENT_PUBLIC_BASE_URL,
  COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL,
  COMBAT_ASSIGNMENT_PUBLIC_JSON_URL,
  COMBAT_ASSIGNMENT_PUBLIC_MANIFEST_URL,
  type CombatAssignmentReportManifest,
} from "./combat-assignment-report.ts";
import { resolveHelperRepoCloneUrl } from "./github-helper-repo.ts";
const REPORT_DIR_IN_REPO = "reports/combat-assignment";

export interface PublishCombatAssignmentReportInput {
  assignmentGeneratedAt: string;
  assignmentKind?: string;
  summaryText?: string;
  /** Directory containing the 4 PNGs + optional assignment JSON. */
  reportDirectory: string;
  files: Array<{ title: string; fileName: string }>;
  englishFiles?: Array<{ title: string; fileName: string }>;
  /** Optional path to the full assignment JSON (copied as latest.json). */
  assignmentJsonPath?: string;
  dryRun?: boolean;
}

export interface PublishCombatAssignmentReportResult {
  published: boolean;
  skipped: boolean;
  publicBaseUrl: string;
  publicIndexUrl: string;
  publicManifestUrl: string;
  publicJsonUrl: string;
  manifest: CombatAssignmentReportManifest;
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
 * Push combat-assignment PNGs/JSON to the public helper repo so members can
 * open raw.githubusercontent.com without Tailscale.
 */
export function publishCombatAssignmentReportToGithub(
  input: PublishCombatAssignmentReportInput,
): PublishCombatAssignmentReportResult {
  const manifest = buildCombatAssignmentManifest({
    assignmentGeneratedAt: input.assignmentGeneratedAt,
    assignmentKind: input.assignmentKind,
    files: input.files,
    englishFiles: input.englishFiles,
  });
  const publicBaseUrl = COMBAT_ASSIGNMENT_PUBLIC_BASE_URL;
  const publicIndexUrl = COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL;
  const publicManifestUrl = COMBAT_ASSIGNMENT_PUBLIC_MANIFEST_URL;
  const publicJsonUrl = COMBAT_ASSIGNMENT_PUBLIC_JSON_URL;

  if (input.dryRun) {
    return {
      published: false,
      skipped: true,
      publicBaseUrl,
      publicIndexUrl,
      publicManifestUrl,
      publicJsonUrl,
      manifest,
      message: "dry-run: skipped helper clone/push",
    };
  }

  for (const file of input.files) {
    const source = path.join(input.reportDirectory, file.fileName);
    readFileSync(source); // throw if missing
  }
  for (const file of input.englishFiles ?? []) {
    readFileSync(path.join(input.reportDirectory, file.fileName));
  }

  const work = mkdtempSync(path.join(tmpdir(), "mwi-combat-report-publish-"));
  try {
    run(["git", "clone", "--depth", "1", resolveHelperRepoCloneUrl(), work]);
    const reportDir = path.join(work, REPORT_DIR_IN_REPO);
    mkdirSync(reportDir, { recursive: true });

    for (const file of [...input.files, ...(input.englishFiles ?? [])]) {
      copyFileSync(
        path.join(input.reportDirectory, file.fileName),
        path.join(reportDir, file.fileName),
      );
    }

    if (input.assignmentJsonPath) {
      copyFileSync(input.assignmentJsonPath, path.join(reportDir, "latest.json"));
    } else {
      const localJson = path.join(input.reportDirectory, "latest.json");
      try {
        copyFileSync(localJson, path.join(reportDir, "latest.json"));
      } catch {
        writeFileSync(
          path.join(reportDir, "latest.json"),
          `${JSON.stringify(
            {
              assignmentGeneratedAt: input.assignmentGeneratedAt,
              assignmentKind: input.assignmentKind,
              summaryText: input.summaryText ?? "",
            },
            null,
            2,
          )}\n`,
        );
      }
    }

    writeFileSync(
      path.join(reportDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const indexHtml = buildCombatAssignmentIndexHtml({
      assignmentGeneratedAt: input.assignmentGeneratedAt,
      files: input.files,
      englishFiles: input.englishFiles,
      summaryText: input.summaryText,
    });
    writeFileSync(path.join(reportDir, "index.html"), indexHtml);
    // Mirror gallery into local artifacts for Windows checkout / preview.
    writeFileSync(path.join(input.reportDirectory, "index.html"), indexHtml);
    writeFileSync(
      path.join(reportDir, "README.md"),
      [
        "# 本周分工 / Weekly Assignments",
        "",
        `- assignmentGeneratedAt：\`${input.assignmentGeneratedAt}\``,
        input.assignmentKind ? `- kind：\`${input.assignmentKind}\`` : "",
        "",
        `公网浏览（可选图片 / 中英切换）：${publicIndexUrl}`,
        `原图目录：${publicBaseUrl}/`,
        `manifest：${publicManifestUrl}`,
        `JSON：${publicJsonUrl}`,
        "",
        "## 图片 / Images",
        "",
        `- [生活分工 / Life](../life-assignment/latest.png)`,
        ...input.files.map(
          (file) =>
            `- [${file.title}](${combatFileMarkdownUrl(file.fileName)})`,
        ),
        ...(input.englishFiles ?? []).map(
          (file) =>
            `- [${file.title} (EN)](${combatFileMarkdownUrl(file.fileName)})`,
        ),
        "",
      ]
        .filter((line) => line !== "")
        .join("\n") + "\n",
    );

    // Also write local artifacts mirror under reportDirectory for bot checkout.
    writeFileSync(
      path.join(input.reportDirectory, "manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          assignmentGeneratedAt: input.assignmentGeneratedAt,
          assignmentKind: input.assignmentKind,
          generatedAt: manifest.generatedAt,
          publicBaseUrl,
          publicIndexUrl,
          publicManifestUrl,
          publicJsonUrl,
          files: input.files,
          englishFiles: input.englishFiles ?? [],
        },
        null,
        2,
      )}\n`,
    );

    const status = run(["git", "status", "--porcelain"], work);
    if (!status.stdout.trim()) {
      return {
        published: false,
        skipped: true,
        publicBaseUrl,
        publicIndexUrl,
        publicManifestUrl,
        publicJsonUrl,
        manifest,
        message: "helper combat-assignment report already up to date",
      };
    }

    run(["git", "add", REPORT_DIR_IN_REPO], work);
    const message =
      `chore: refresh combat assignment report (${input.assignmentGeneratedAt})`;
    run(["git", "commit", "-m", message], work, { env: gitIdentityEnv() });
    run(["git", "push", "origin", "HEAD"], work);
    return {
      published: true,
      skipped: false,
      publicBaseUrl,
      publicIndexUrl,
      publicManifestUrl,
      publicJsonUrl,
      manifest,
      message: "published combat assignment report to public helper repo",
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function combatFileMarkdownUrl(fileName: string): string {
  return `${COMBAT_ASSIGNMENT_PUBLIC_BASE_URL}/${fileName}`;
}

/** Copy local artifacts into a directory (used by scripts / Windows checkout). */
export function copyCombatAssignmentArtifacts(
  sourceDirectory: string,
  targetDirectory: string,
): void {
  mkdirSync(targetDirectory, { recursive: true });
  const names = [
    "manifest.json",
    "latest.json",
    "index.html",
    "README.md",
    "1-jellyfish-summary.png",
    "1-jellyfish-members.png",
    "1-hedgehog-summary.png",
    "1-hedgehog-members.png",
    "1-chameleon-summary.png",
    "1-chameleon-members.png",
    "1-badger-summary.png",
    "1-badger-members.png",
    "2-hedgehog-summary.png",
    "2-hedgehog-members.png",
    "2-swarm-summary.png",
    "2-swarm-members.png",
  ];
  for (const fileName of names) {
    const source = path.join(sourceDirectory, fileName);
    try {
      copyFileSync(source, path.join(targetDirectory, fileName));
    } catch {
      // optional / boss-slug variants
    }
  }
  try {
    for (const fileName of readdirSync(sourceDirectory)) {
      if (fileName.endsWith(".en.png")) {
        copyFileSync(
          path.join(sourceDirectory, fileName),
          path.join(targetDirectory, fileName),
        );
      }
    }
  } catch {
    // optional English report variants
  }
}
