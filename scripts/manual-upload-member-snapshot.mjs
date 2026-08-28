#!/usr/bin/env node
/**
 * Manually convert a pasted MWI character/combat JSON blob into a member
 * snapshot and upload it to the public TMD API.
 *
 * Usage:
 *   node scripts/manual-upload-member-snapshot.mjs --member Acceleratorlin --file ./paste.json
 *   node scripts/manual-upload-member-snapshot.mjs --member Acceleratorlin --dry-run --file ./paste.json
 *   cat paste.json | node scripts/manual-upload-member-snapshot.mjs --member Acceleratorlin
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import "../userscripts/member-snapshot-payload-builder.js";

const DEFAULT_API_BASE = process.env.MWI_GUILD_API_BASE ?? "https://adudu.tailab136f.ts.net";

function usage(exitCode = 2) {
  console.error(`Usage:
  node scripts/manual-upload-member-snapshot.mjs --member <CharacterName> --file <paste.json>
  node scripts/manual-upload-member-snapshot.mjs --member <CharacterName> --dry-run --file <paste.json>
  cat paste.json | node scripts/manual-upload-member-snapshot.mjs --member <CharacterName>

Options:
  --member      Game character name / memberId (required)
  --file        Path to pasted JSON (default: stdin)
  --api-base    API base URL (default: ${DEFAULT_API_BASE})
  --dry-run     Build+validate only; do not upload
  --no-approve  Do not mark the pasted combat loadout as approvedBuilds
  --out         Write converted snapshot JSON to this path
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    member: "",
    file: "",
    apiBase: DEFAULT_API_BASE,
    dryRun: false,
    approve: true,
    out: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") usage(0);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-approve") options.approve = false;
    else if (arg === "--member" && next) {
      options.member = next;
      index += 1;
    } else if (arg === "--file" && next) {
      options.file = next;
      index += 1;
    } else if (arg === "--api-base" && next) {
      options.apiBase = next;
      index += 1;
    } else if (arg === "--out" && next) {
      options.out = next;
      index += 1;
    } else usage();
  }
  if (!options.member.trim()) usage();
  return options;
}

async function readStdin() {
  if (process.stdin.isTTY) {
    throw new Error("No --file provided and stdin is a TTY. Paste JSON into a file or pipe it.");
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonSource(filePath) {
  const raw = filePath ? await readFile(resolve(filePath), "utf8") : await readStdin();
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("JSON input is empty");
  return JSON.parse(trimmed);
}

function summarizeSnapshot(snapshot) {
  return {
    memberId: snapshot.memberId,
    displayName: snapshot.displayName,
    guildId: snapshot.guildId,
    confidence: snapshot.confidence,
    skills: Object.keys(snapshot.skills ?? {}).length,
    learnedAbilities: Object.keys(snapshot.learnedAbilities ?? {}).length,
    auras: snapshot.auras ?? {},
    loadoutCatalog: (snapshot.loadoutCatalog ?? []).map((loadout) => ({
      name: loadout.name,
      category: loadout.category,
      equipment: loadout.equipment?.length ?? 0,
      abilities: loadout.abilities?.length ?? 0,
    })),
    approvedBuilds: snapshot.approvedBuilds?.length ?? 0,
    issues: snapshot.issues ?? [],
  };
}

async function uploadSnapshot(apiBase, memberId, snapshot) {
  const url = `${apiBase.replace(/\/$/u, "")}/api/public/guilds/TMD/members/${encodeURIComponent(memberId)}/snapshots`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(snapshot),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const code = body?.error?.code ?? response.status;
    const message = body?.error?.message ?? text;
    throw new Error(`Upload failed (${code}): ${message}`);
  }
  return body;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const builder = globalThis.MwiTrialPayloadBuilder;
  if (!builder?.buildMemberSnapshotFromGamePaste) {
    throw new Error("MwiTrialPayloadBuilder.buildMemberSnapshotFromGamePaste is unavailable");
  }

  const pasted = await readJsonSource(options.file);
  const snapshot = builder.buildMemberSnapshotFromGamePaste({
    ...pasted,
    memberId: options.member,
    displayName: pasted.displayName ?? options.member,
    guildId: pasted.guildId ?? "TMD",
    approveCombat: options.approve,
  });

  if (snapshot.memberId !== options.member) {
    throw new Error(`Snapshot memberId mismatch: got ${snapshot.memberId}, expected ${options.member}`);
  }

  const summary = summarizeSnapshot(snapshot);
  console.log(JSON.stringify({ ok: true, dryRun: options.dryRun, summary }, null, 2));

  if (options.out) {
    const outPath = resolve(options.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(`wrote ${outPath}`);
  }

  if (options.dryRun) return;

  const result = await uploadSnapshot(options.apiBase, options.member, snapshot);
  console.log(JSON.stringify({ uploaded: true, result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
