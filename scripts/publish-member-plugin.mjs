#!/usr/bin/env node
/**
 * Publish the TMD guild trial member plugin:
 *   workspace userscript → mwi-guild-trial-helper/dist → push
 * Greasy Fork auto-syncs from GitHub via webhook (script 588902).
 *
 * Usage:
 *   node scripts/publish-member-plugin.mjs
 *   node scripts/publish-member-plugin.mjs --dry-run
 *   node scripts/publish-member-plugin.mjs --notes "fix: ..."
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "userscripts/member-candidate-loadout-exporter.user.js");
const HELPER_REPO = "https://github.com/xiahuaaaa/mwi-guild-trial-helper.git";
const DIST_NAME = "mwi-guild-trial-sync.user.js";
const GREASYFORK_PAGE =
  "https://greasyfork.org/zh-CN/scripts/588902-mwi-%E5%85%AC%E4%BC%9A%E8%AF%95%E7%82%BC%E8%B5%84%E6%96%99%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B";
const GREASYFORK_INSTALL =
  "https://update.greasyfork.org/scripts/588902/MWI%20%E5%85%AC%E4%BC%9A%E8%AF%95%E7%82%BC%E8%B5%84%E6%96%99%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B.user.js";
const GREASYFORK_SYNC_SOURCE =
  "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/dist/mwi-guild-trial-sync.user.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const notesIdx = args.indexOf("--notes");
const notes = notesIdx >= 0 ? String(args[notesIdx + 1] ?? "").trim() : "";

function run(cmd, cwd, { allowFail = false, env = process.env } = {}) {
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

function gitIdentityEnv() {
  // Prefer ambient identity; fall back to the known GitHub noreply used by this project.
  // Do not call `git config` (repo rule).
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

function readVersion(source) {
  const match = source.match(/^\/\/\s*@version\s+(\S+)/m);
  if (!match) throw new Error("missing @version in userscript header");
  return match[1];
}

function assertGreasyForkUrls(source) {
  if (!source.includes("update.greasyfork.org/scripts/588902/")) {
    throw new Error(
      "userscript @downloadURL/@updateURL must point at Greasy Fork script 588902",
    );
  }
  if (!source.includes("@namespace    https://greasyfork.org/users/1466859-adudu")) {
    throw new Error("do not change @namespace; Tampermonkey treats it as a new script");
  }
  if (!/^\/\/\s*@name\s+MWI 公会试炼资料同步助手\s*$/m.test(source)) {
    throw new Error("do not change primary @name; updates would show as Install");
  }
}

const source = readFileSync(SOURCE, "utf8");
assertGreasyForkUrls(source);
const version = readVersion(source);
console.log(`publishing plugin v${version}`);
console.log(`source: ${SOURCE}`);
console.log(`greasyfork: ${GREASYFORK_PAGE}`);

if (dryRun) {
  console.log("dry-run: skipped clone/push");
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "mwi-plugin-publish-"));
try {
  run(["git", "clone", "--depth", "1", HELPER_REPO, work]);
  const distDir = join(work, "dist");
  mkdirSync(distDir, { recursive: true });
  const distPath = join(distDir, DIST_NAME);
  copyFileSync(SOURCE, distPath);

  const status = run(["git", "status", "--porcelain"], work);
  if (!status.stdout.trim()) {
    console.log("helper dist already up to date; nothing to push");
  } else {
    run(["git", "add", `dist/${DIST_NAME}`], work);
    const message = notes
      ? `release: plugin v${version} — ${notes}`
      : `release: plugin v${version}`;
    run(["git", "commit", "-m", message], work, { env: gitIdentityEnv() });
    run(["git", "push", "origin", "HEAD"], work);
    console.log("pushed helper dist; Greasy Fork webhook should sync shortly");
  }

  writeFileSync(
    join(ROOT, ".local/last-plugin-publish.json"),
    `${JSON.stringify(
      {
        version,
        publishedAt: new Date().toISOString(),
        greasyForkPage: GREASYFORK_PAGE,
        greasyForkInstall: GREASYFORK_INSTALL,
        githubSyncSource: GREASYFORK_SYNC_SOURCE,
        notes: notes || null,
      },
      null,
      2,
    )}\n`,
  );

  console.log("verify:");
  console.log(`  meta: ${GREASYFORK_INSTALL.replace(/\.user\.js$/, ".meta.js")}`);
  console.log(`  raw : ${GREASYFORK_SYNC_SOURCE}`);
  console.log("then update API plugin_versions installUrl to Greasy Fork install URL.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
