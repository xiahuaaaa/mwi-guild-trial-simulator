#!/usr/bin/env node
/**
 * One-time / repeat bootstrap for WI plugin Gitee + Greasy Fork channels.
 *
 * Prerequisites:
 *   - Log into https://greasyfork.org and https://gitee.com in ego-browser task space
 *   - export GITEE_TOKEN=... (Gitee 私人令牌，需 repo 权限)
 *   - After creating the GF script once, export WI_GREASYFORK_SCRIPT_ID=...
 *
 * Usage:
 *   node scripts/bootstrap-wi-plugin-channels.mjs --print-gf-code
 *   node scripts/publish-guild-plugins.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWiMemberPluginSource } from "./build-wi-member-plugin.mjs";
import {
  buildWiGreasyForkDistSource,
  WI_GREASYFORK_SYNC_SOURCE,
  wiGreasyForkPageUrl,
} from "./wi-plugin-install-urls.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMD_SOURCE = join(ROOT, "userscripts/member-candidate-loadout-exporter.user.js");
const GF_ID_FILE = join(ROOT, ".local/wi-greasyfork-script-id");

const args = process.argv.slice(2);
const scriptId = String(process.env.WI_GREASYFORK_SCRIPT_ID ?? "").trim()
  || (args.includes("--print-gf-code") ? "REPLACE_WITH_SCRIPT_ID" : "");

if (args.includes("--print-gf-code")) {
  const built = buildWiMemberPluginSource(readFileSync(TMD_SOURCE, "utf8"));
  const source = scriptId === "REPLACE_WITH_SCRIPT_ID"
    ? built
    : buildWiGreasyForkDistSource(built, scriptId);
  console.log("=== Greasy Fork: 新建脚本后粘贴以下代码，或配置同步源 ===");
  console.log(`sync source: ${WI_GREASYFORK_SYNC_SOURCE}`);
  console.log("--- userscript ---");
  console.log(source);
  process.exit(0);
}

if (!scriptId) {
  console.error("Set WI_GREASYFORK_SCRIPT_ID or pass --print-gf-code");
  process.exit(1);
}

writeFileSync(GF_ID_FILE, `${scriptId}\n`, "utf8");
console.log(`saved ${GF_ID_FILE} -> ${scriptId}`);
console.log(`GF page: ${wiGreasyForkPageUrl(scriptId)}`);
console.log("Next: node scripts/publish-guild-plugins.mjs");
