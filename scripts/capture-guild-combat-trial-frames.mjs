#!/usr/bin/env node
/**
 * Phase 0B fail-closed capture helper for guild combat trial WS frames.
 *
 * Writes ONLY whitelist-projected JSON to fixtures/guild-combat-trial-ws/frames/.
 * Never persists raw WebSocket text.
 *
 * Usage:
 *   node scripts/capture-guild-combat-trial-frames.mjs --canary
 *   node scripts/capture-guild-combat-trial-frames.mjs --project-file <path>
 */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_DIR = join(ROOT, "fixtures/guild-combat-trial-ws");
const FRAMES_DIR = join(FIXTURES_DIR, "frames");
const MANIFEST_PATH = join(FIXTURES_DIR, "manifest.json");

const projectorUrl = pathToFileURL(
  join(ROOT, "userscripts/guild-combat-trial-packet-projector.js"),
).href;
await import(projectorUrl);
const {
  WHITELIST_VERSION,
  projectGuildCombatPacket,
  hashRawFrame,
} = globalThis.MwiGuildCombatTrialPacketProjector;

function usage() {
  console.log(`capture-guild-combat-trial-frames.mjs — whitelistVersion=${WHITELIST_VERSION}

Options:
  --canary                 Run built-in canary (sensitive fields never survive)
  --project-file <path>    Project JSONL or JSON array of {raw} / raw strings
  --help                   Show this help
`);
}

function ensureFixtureDirs() {
  mkdirSync(FRAMES_DIR, { recursive: true });
  if (!existsSync(join(FIXTURES_DIR, "README.md"))) {
    writeFileSync(
      join(FIXTURES_DIR, "README.md"),
      `# Guild combat trial WS fixtures (projected only)

Phase 0B scaffolding. Frames are **whitelist-projected**; raw WebSocket text is never stored.

- \`whitelistVersion\`: see manifest.json
- Samples A–D: not complete until Phase 0B capture finishes
`,
      "utf8",
    );
  }
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      protocolVersion: "provisional-unreviewed",
      whitelistVersion: WHITELIST_VERSION,
      status: "scaffolding",
      samples: {
        A: "pending",
        B: "pending",
        C: "pending",
        D: "pending",
      },
      frames: [],
    };
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function writeManifest(manifest) {
  manifest.whitelistVersion = WHITELIST_VERSION;
  manifest.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function parseInputFile(path) {
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error("expected JSON array");
    return arr;
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function extractRaw(entry, index) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    if (typeof entry.raw === "string") return entry.raw;
    if (typeof entry.rawData === "string") {
      throw new Error(
        `entry ${index}: rawData field present — refuse to read/write raw WS from disk helper`,
      );
    }
    return JSON.stringify(entry);
  }
  throw new Error(`entry ${index}: expected string or {raw} object`);
}

function buildCanaryInput() {
  return JSON.stringify({
    type: "guild_battle_updated",
    characterName: "SecretPlayer",
    characterId: "char-uuid-123",
    token: "super-secret-token",
    authorization: "Bearer leaked",
    nested: { secret: "nested-secret-value", gm_token: "nope" },
    pMap: {
      "0": { characterName: "Alice", characterId: "a1", loadouts: [{ name: "main" }] },
      "1": { characterName: "Bob", characterId: "b2" },
    },
    guildCharacterMap: { x: "y" },
    loadouts: [{ name: "hidden" }],
    unknownFutureField: { alsoUnknown: true },
    mMap: {
      "0": { cHP: 50000, mHP: 100000, level: 100, characterName: "BossObserver" },
    },
    seq: 42,
    level: 100,
  });
}

function runCanary() {
  const raw = buildCanaryInput();
  const projected = projectGuildCombatPacket(raw);
  if (!projected) {
    throw new Error("canary: projection returned null");
  }

  const serialized = JSON.stringify(projected);
  const forbidden = [
    "SecretPlayer",
    "char-uuid-123",
    "super-secret-token",
    "Bearer leaked",
    "nested-secret",
    "gm_token",
    "Alice",
    "Bob",
    "a1",
    "b2",
    "hidden",
    "guildCharacterMap",
    "unknownFutureField",
    "alsoUnknown",
    "BossObserver",
    "pMap",
    "loadouts",
  ];

  for (const needle of forbidden) {
    if (serialized.includes(needle)) {
      throw new Error(`canary failed: projected output still contains "${needle}"`);
    }
  }

  if (!projected.mMap?.["0"]?.cHP) {
    throw new Error("canary: expected anonymous mMap HP to survive projection");
  }

  const hash1 = hashRawFrame(raw);
  const hash2 = hashRawFrame(raw);
  if (hash1 !== hash2 || hash1.length !== 32) {
    throw new Error("canary: hashRawFrame unstable or wrong length");
  }

  console.log(`canary OK (whitelistVersion=${WHITELIST_VERSION})`);
  console.log(`  projected keys: ${Object.keys(projected).join(", ")}`);
  console.log(`  frameHash prefix: ${hash1}`);
  return true;
}

function projectFile(inputPath) {
  ensureFixtureDirs();
  const entries = parseInputFile(inputPath);
  if (entries.length === 0) {
    throw new Error(`no entries in ${inputPath}`);
  }

  const manifest = readManifest();
  const sourceBase = basename(inputPath, ".json").replace(/\.(jsonl|ndjson)$/i, "");
  const written = [];

  for (let i = 0; i < entries.length; i++) {
    const raw = extractRaw(entries[i], i);
    const projected = projectGuildCombatPacket(raw);
    if (!projected) {
      throw new Error(`entry ${i}: projection returned null — refusing to write raw frame`);
    }

    const frameHash = hashRawFrame(raw);
    const frameName = `${sourceBase}-${String(i).padStart(4, "0")}-${frameHash.slice(0, 8)}.json`;
    const framePath = join(FRAMES_DIR, frameName);
    const frameDoc = {
      frameHash,
      whitelistVersion: WHITELIST_VERSION,
      projectedAt: new Date().toISOString(),
      sourceFile: basename(inputPath),
      sourceIndex: i,
      packet: projected,
    };

    writeFileSync(framePath, `${JSON.stringify(frameDoc, null, 2)}\n`, "utf8");
    written.push({
      file: `frames/${frameName}`,
      frameHash,
      whitelistVersion: WHITELIST_VERSION,
      sourceFile: basename(inputPath),
      sourceIndex: i,
    });
  }

  const existing = manifest.frames.filter(
    (row) => row.sourceFile !== basename(inputPath),
  );
  manifest.frames = [...existing, ...written];
  manifest.status = manifest.status ?? "scaffolding";
  writeManifest(manifest);

  console.log(`projected ${written.length} frame(s) (whitelistVersion=${WHITELIST_VERSION})`);
  for (const row of written) {
    console.log(`  ${row.file}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }

  console.log(`whitelistVersion=${WHITELIST_VERSION}`);

  if (args.includes("--canary")) {
    runCanary();
    return;
  }

  const fileIdx = args.indexOf("--project-file");
  if (fileIdx >= 0) {
    const inputPath = args[fileIdx + 1];
    if (!inputPath) throw new Error("--project-file requires a path");
    projectFile(inputPath);
    return;
  }

  usage();
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
