#!/usr/bin/env node
/**
 * Publish TMD and WI guild plugins to all three player channels:
 *   Greasy Fork (via helper-repo webhook), Gitee, GitHub raw.
 *
 * Usage:
 *   node scripts/publish-guild-plugins.mjs --notes "一句话变更说明"
 *   node scripts/publish-guild-plugins.mjs --dry-run
 *
 * Env:
 *   GITEE_TOKEN   or guild-trial-simulator/.local/gitee.token
 *   WI_GREASYFORK_SCRIPT_ID  or .local/wi-greasyfork-script-id (default 593342)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWiMemberPluginSource } from "./build-wi-member-plugin.mjs";
import {
  HELPER_REPO,
  TMD_HELPER_DIST,
  WI_HELPER_DIST,
  fetchHeaderVersion,
  gitIdentityEnv,
  pushGiteeUserscript,
  readGiteeToken,
  readUserscriptVersion,
  run,
} from "./guild-plugin-publish-lib.mjs";
import {
  TMD_GITEE_FILE,
  TMD_GITEE_INSTALL_URL,
  TMD_GITEE_REPO,
  TMD_GITHUB_DIST,
  TMD_GREASYFORK_INSTALL,
  TMD_GREASYFORK_PAGE,
  assertTmdGreasyForkIdentity,
  buildTmdGiteeDistSource,
  buildTmdGreasyForkDistSource,
} from "./tmd-plugin-install-urls.mjs";
import {
  WI_GITEE_FILE,
  WI_GITEE_INSTALL_URL,
  WI_GITEE_REPO,
  WI_GITHUB_DIST,
  buildWiGiteeDistSource,
  buildWiGreasyForkDistSource,
  resolveWiGreasyForkScriptId,
  wiGreasyForkInstallUrl,
  wiGreasyForkPageUrl,
} from "./wi-plugin-install-urls.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMD_SOURCE = join(ROOT, "userscripts/member-candidate-loadout-exporter.user.js");
const WI_WORKSPACE = join(ROOT, "userscripts/wi-guild-trial-sync.user.js");
const GF_ID_FILE = join(ROOT, ".local/wi-greasyfork-script-id");

export function readWiGreasyForkScriptId() {
  const fileValue = existsSync(GF_ID_FILE) ? readFileSync(GF_ID_FILE, "utf8") : "";
  return resolveWiGreasyForkScriptId(process.env.WI_GREASYFORK_SCRIPT_ID, fileValue);
}

export function buildGuildPluginArtifacts(tmdSource, wiGreasyForkScriptId) {
  assertTmdGreasyForkIdentity(tmdSource);
  const wiSource = buildWiMemberPluginSource(tmdSource);
  return {
    tmdVersion: readUserscriptVersion(tmdSource),
    wiVersion: readUserscriptVersion(wiSource),
    tmdGithub: buildTmdGreasyForkDistSource(tmdSource),
    tmdGitee: buildTmdGiteeDistSource(tmdSource),
    wiGithub: buildWiGreasyForkDistSource(wiSource, wiGreasyForkScriptId),
    wiGitee: buildWiGiteeDistSource(wiSource),
    channels: {
      tmd: {
        greasyFork: TMD_GREASYFORK_INSTALL,
        gitee: TMD_GITEE_INSTALL_URL,
        github: TMD_GITHUB_DIST,
      },
      wi: {
        greasyFork: wiGreasyForkInstallUrl(wiGreasyForkScriptId),
        gitee: WI_GITEE_INSTALL_URL,
        github: WI_GITHUB_DIST,
      },
    },
  };
}

async function verifyPublishedVersion(url, expectedVersion, label) {
  const { version } = await fetchHeaderVersion(url);
  if (version !== expectedVersion) {
    throw new Error(`${label} is ${version}, expected ${expectedVersion} (${url})`);
  }
  console.log(`verified ${label}: ${version}`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const notesIdx = args.indexOf("--notes");
  const notes = notesIdx >= 0 ? String(args[notesIdx + 1] ?? "").trim() : "";
  const tmdSource = readFileSync(TMD_SOURCE, "utf8");
  const wiScriptId = readWiGreasyForkScriptId();
  const artifacts = buildGuildPluginArtifacts(tmdSource, wiScriptId);
  const giteeToken = readGiteeToken(ROOT);

  console.log(`publishing TMD v${artifacts.tmdVersion} and WI v${artifacts.wiVersion}`);
  console.log(`TMD GF: ${TMD_GREASYFORK_PAGE}`);
  console.log(`WI  GF: ${wiGreasyForkPageUrl(wiScriptId)}`);
  console.log(`TMD GitHub: ${TMD_GITHUB_DIST}`);
  console.log(`WI  GitHub: ${WI_GITHUB_DIST}`);
  console.log(`TMD Gitee: ${TMD_GITEE_INSTALL_URL}`);
  console.log(`WI  Gitee: ${WI_GITEE_INSTALL_URL}`);

  if (dryRun) {
    console.log("dry-run: skipped helper/Gitee push");
    process.exit(0);
  }

  if (!giteeToken) {
    throw new Error("GITEE_TOKEN or .local/gitee.token is required so both Gitee mirrors update");
  }

  writeFileSync(WI_WORKSPACE, artifacts.wiGithub, "utf8");

  const work = mkdtempSync(join(tmpdir(), "mwi-guild-plugins-publish-"));
  try {
    run(["git", "clone", "--depth", "1", HELPER_REPO, work]);
    const distDir = join(work, "dist");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, TMD_HELPER_DIST), artifacts.tmdGithub, "utf8");
    writeFileSync(join(distDir, WI_HELPER_DIST), artifacts.wiGithub, "utf8");

    const status = run(["git", "status", "--porcelain"], work);
    if (!status.stdout.trim()) {
      console.log("helper dist already up to date; nothing to push");
    } else {
      run(["git", "add", `dist/${TMD_HELPER_DIST}`, `dist/${WI_HELPER_DIST}`], work);
      const message = notes
        ? `release: TMD v${artifacts.tmdVersion} / WI v${artifacts.wiVersion} — ${notes}`
        : `release: TMD v${artifacts.tmdVersion} / WI v${artifacts.wiVersion}`;
      run(["git", "commit", "-m", message], work, { env: gitIdentityEnv() });
      run(["git", "push", "origin", "HEAD"], work);
      console.log("pushed helper dist for TMD and WI; Greasy Fork webhooks should sync");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const releaseNotes = notes || `TMD ${artifacts.tmdVersion} / WI ${artifacts.wiVersion}`;
  await pushGiteeUserscript({
    token: giteeToken,
    repo: TMD_GITEE_REPO,
    file: TMD_GITEE_FILE,
    content: artifacts.tmdGitee,
    message: `release: TMD plugin v${artifacts.tmdVersion} — ${releaseNotes}`,
  });
  console.log(`pushed Gitee ${TMD_GITEE_REPO}/${TMD_GITEE_FILE}`);
  await pushGiteeUserscript({
    token: giteeToken,
    repo: WI_GITEE_REPO,
    file: WI_GITEE_FILE,
    content: artifacts.wiGitee,
    message: `release: WI plugin v${artifacts.wiVersion} — ${releaseNotes}`,
  });
  console.log(`pushed Gitee ${WI_GITEE_REPO}/${WI_GITEE_FILE}`);

  await verifyPublishedVersion(TMD_GITHUB_DIST, artifacts.tmdVersion, "TMD GitHub");
  await verifyPublishedVersion(WI_GITHUB_DIST, artifacts.wiVersion, "WI GitHub");
  await verifyPublishedVersion(TMD_GITEE_INSTALL_URL, artifacts.tmdVersion, "TMD Gitee");
  await verifyPublishedVersion(WI_GITEE_INSTALL_URL, artifacts.wiVersion, "WI Gitee");

  writeFileSync(
    join(ROOT, ".local/last-plugin-publish.json"),
    `${JSON.stringify(
      {
        tmdVersion: artifacts.tmdVersion,
        wiVersion: artifacts.wiVersion,
        publishedAt: new Date().toISOString(),
        notes: notes || null,
        channels: artifacts.channels,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(ROOT, ".local/last-wi-plugin-publish.json"),
    `${JSON.stringify(
      {
        version: artifacts.wiVersion,
        publishedAt: new Date().toISOString(),
        githubDist: WI_GITHUB_DIST,
        giteeInstall: WI_GITEE_INSTALL_URL,
        greasyForkScriptId: wiScriptId,
        greasyForkInstall: wiGreasyForkInstallUrl(wiScriptId),
        greasyForkSyncSource: WI_GITHUB_DIST,
        notes: notes || null,
      },
      null,
      2,
    )}\n`,
  );

  console.log("all six channel files match the workspace versions");
  console.log(`then confirm GF meta: ${TMD_GREASYFORK_INSTALL.replace(/\.user\.js$/, ".meta.js")}`);
  console.log(`then confirm GF meta: ${wiGreasyForkInstallUrl(wiScriptId).replace(/\.user\.js$/, ".meta.js")}`);
}
