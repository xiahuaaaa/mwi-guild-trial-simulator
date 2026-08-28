#!/usr/bin/env node
/**
 * Backup TMD guild member data from the live API into a GitHub-safe JSON pack.
 *
 * Usage:
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/backup-tmd-members-to-repo.mjs
 *
 * Writes:
 *   backups/tmd/latest/{manifest,members,qq-bindings,assignments-test,...}.json
 *   backups/tmd/<YYYY-MM-DD>THHMMSSZ/  (dated copy of the same files)
 *
 * Never writes sqlite, env, tokens, or credential hashes.
 */
import { mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiBase = (
  process.env.MWI_GUILD_API_BASE ?? "https://adudu.tailab136f.ts.net"
).replace(/\/$/, "");
const guildId = process.env.MWI_GUILD_ID ?? "TMD";
const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY?.trim();
if (!adminKey) {
  throw new Error("MWI_GUILD_API_ADMIN_KEY is required");
}

const SENSITIVE_KEY =
  /(?:token|authorization|cookie|secret|password|credential|session|gm_|member_token|token_hash)/i;

function stripSensitive(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => stripSensitive(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const next = stripSensitive(v, k);
      if (next !== undefined) out[k] = next;
    }
    return out;
  }
  return value;
}

async function fetchJson(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: {
      "x-admin-key": adminKey,
      accept: "application/json",
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { ok: response.ok, status: response.status, body };
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "").replace(/Z$/, "Z");
}

const membersRes = await fetchJson(
  `/api/guilds/${encodeURIComponent(guildId)}/members`,
);
if (!membersRes.ok) {
  throw new Error(`members fetch failed: ${membersRes.status}`);
}
const bindingsRes = await fetchJson(
  `/api/guilds/${encodeURIComponent(guildId)}/qq-bindings`,
);
if (!bindingsRes.ok) {
  throw new Error(`qq-bindings fetch failed: ${bindingsRes.status}`);
}

const optionalPaths = {
  "assignments-test.json": `/api/guilds/${encodeURIComponent(guildId)}/assignments/test`,
  "assignments-formal.json": `/api/guilds/${encodeURIComponent(guildId)}/assignments/formal`,
  "trial-registrations-current.json": `/api/guilds/${encodeURIComponent(guildId)}/trial-registrations/current`,
  "weekly-trials-current.json": `/api/guilds/${encodeURIComponent(guildId)}/weekly-trials/current`,
  "life-assignments-test.json": `/api/guilds/${encodeURIComponent(guildId)}/life-assignments/test`,
};

const members = stripSensitive(membersRes.body);
const bindings = stripSensitive(bindingsRes.body);
const memberRows = Array.isArray(members.members) ? members.members : [];
const bindingRows = Array.isArray(bindings.bindings) ? bindings.bindings : [];

const files = {
  "members.json": {
    schemaVersion: 1,
    kind: "tmd-member-snapshots-backup",
    guildId,
    exportedAt: new Date().toISOString(),
    source: apiBase,
    memberCount: memberRows.length,
    withSnapshotCount: memberRows.filter((m) => m.latestSnapshot).length,
    members: memberRows,
  },
  "qq-bindings.json": {
    schemaVersion: 1,
    kind: "tmd-qq-bindings-backup",
    guildId,
    exportedAt: new Date().toISOString(),
    source: apiBase,
    bindingCount: bindingRows.length,
    bindings: bindingRows,
  },
};

const optionalStatus = {};
for (const [fileName, pathname] of Object.entries(optionalPaths)) {
  const result = await fetchJson(pathname);
  optionalStatus[fileName] = result.status;
  if (!result.ok) continue;
  files[fileName] = stripSensitive({
    schemaVersion: 1,
    kind: fileName.replace(/\.json$/, ""),
    guildId,
    exportedAt: new Date().toISOString(),
    source: apiBase,
    httpStatus: result.status,
    payload: result.body,
  });
}

const backupRoot = path.join(projectRoot, "backups", "tmd");
const datedDir = path.join(backupRoot, stamp());
const latestDir = path.join(backupRoot, "latest");
await mkdir(datedDir, { recursive: true });
await mkdir(latestDir, { recursive: true });

const manifest = {
  schemaVersion: 1,
  kind: "tmd-guild-data-backup",
  guildId,
  exportedAt: new Date().toISOString(),
  source: apiBase,
  notes: [
    "Private disaster-recovery pack for the TMD guild API.",
    "Contains combat snapshots / loadouts and QQ combat bindings.",
    "Does not include sqlite, API keys, OneBot tokens, or member upload tokens.",
    "Do not publish outside the private repo.",
  ],
  counts: {
    members: memberRows.length,
    withSnapshot: memberRows.filter((m) => m.latestSnapshot).length,
    qqBindings: bindingRows.length,
  },
  optionalHttpStatus: optionalStatus,
  files: Object.keys(files).sort(),
};

await writeFile(
  path.join(datedDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
for (const [fileName, payload] of Object.entries(files)) {
  await writeFile(
    path.join(datedDir, fileName),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

// Refresh latest/ as a full copy of this dated pack.
for (const fileName of ["manifest.json", ...Object.keys(files)]) {
  await cp(path.join(datedDir, fileName), path.join(latestDir, fileName));
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      datedDir,
      latestDir,
      counts: manifest.counts,
      files: manifest.files,
      optionalHttpStatus: optionalStatus,
    },
    null,
    2,
  )}\n`,
);
