#!/usr/bin/env node
/**
 * Build a local-install WI member plugin from the TMD userscript source.
 *
 * Usage:
 *   node scripts/build-wi-member-plugin.mjs
 *   node scripts/build-wi-member-plugin.mjs --out /path/to/wi-guild-trial-sync.user.js
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "userscripts/member-candidate-loadout-exporter.user.js");
const DEFAULT_OUT = join(ROOT, "userscripts/wi-guild-trial-sync.user.js");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? String(args[outIdx + 1] ?? "").trim() : DEFAULT_OUT;

const WI_IDENTITY = `const GUILD_IDENTITY = Object.freeze({
    apiSlug: "WI",
    gameGuildName: "Wandering ICarus",
    gameGuildId: 667,
  });`;

/** @param {string} source */
export function buildWiMemberPluginSource(source) {
  let out = source.replace(
    /const GUILD_IDENTITY = Object\.freeze\(\{\s*apiSlug: "[^"]+",\s*gameGuildName: "[^"]+",\s*gameGuildId: \d+,\s*\}\);/,
    WI_IDENTITY,
  );

  out = out.replace(
    /^\/\/ @name\s+TMD-guild-trial-sync$/m,
    "// @name         WI-guild-trial-sync",
  );
  out = out.replace(
    /^\/\/ @name:en\s+TMD-guild-trial-sync$/m,
    "// @name:en      WI-guild-trial-sync",
  );
  out = out.replace(
    /^\/\/ @description\s+TMD 公会专用：.*$/m,
    "// @description  Wandering ICarus 公会专用：自动同步成员名单、本周试炼、怪物面板、全部配装、技能与光环，并高亮最新战斗分工。",
  );
  out = out.replace(
    /^\/\/ @description:en\s+TMD guild sync:.*$/m,
    "// @description:en  Wandering ICarus guild sync: roster, weekly trials, monster panels, loadouts, abilities, auras, and the latest combat assignment.",
  );
  out = out.replace(
    /^\/\/ @namespace\s+.*$/m,
    "// @namespace    https://github.com/xiahuaaaa/mwi-guild-trial-helper/wi",
  );
  out = out.replace(/^\/\/ @downloadURL\s+.*\n/m, "");
  out = out.replace(/^\/\/ @updateURL\s+.*\n/m, "");
  out = out.replace(
    /^\/\/ @version\s+([0-9.]+)$/m,
    (_, version) => `// @version      ${version}-wi.1`,
  );

  const replacements = [
    ["the TMD guild tools", "the Wandering ICarus guild tools"],
    ["the TMD roster", "the Wandering Icarus roster"],
    ["TMD-guild-trial-sync", "WI-guild-trial-sync"],
    ["TMD 专用", "Wandering Icarus 专用"],
    ["TMD only", "Wandering Icarus only"],
    ["属于 TMD", "属于 Wandering Icarus"],
    ["TMD membership", "Wandering Icarus membership"],
    ["TMD 成员名单", "Wandering Icarus 成员名单"],
    ["TMD 当前名单", "Wandering Icarus 当前名单"],
    ["TMD 成员资格", "Wandering Icarus 成员资格"],
    ["TMD roster", "Wandering Icarus roster"],
    ["in TMD", "in Wandering Icarus"],
    ["on the TMD roster", "on the Wandering Icarus roster"],
  ];
  for (const [from, to] of replacements) {
    out = out.split(from).join(to);
  }

  return out;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const source = readFileSync(SOURCE, "utf8");
  const built = buildWiMemberPluginSource(source);
  writeFileSync(outPath, built, "utf8");
  console.log(`Wrote ${outPath} (${built.length} bytes)`);
}
