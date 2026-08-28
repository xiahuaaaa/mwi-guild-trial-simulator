import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const projectorUrl = pathToFileURL(
  join(ROOT, "userscripts/guild-combat-trial-packet-projector.js"),
).href;

await import(projectorUrl);
const {
  WHITELIST_VERSION,
  projectGuildCombatPacket,
  hashRawFrame,
} = globalThis.MwiGuildCombatTrialPacketProjector;

const CANARY_RAW = JSON.stringify({
  type: "guild_battle_updated",
  characterName: "SecretPlayer",
  characterId: "char-uuid-123",
  token: "super-secret-token",
  authorization: "Bearer leaked",
  nested: { secret: "nested-secret-value", gm_token: "nope" },
  pMap: {
    "0": { characterName: "Alice", characterId: "a1" },
    "1": { characterName: "Bob", characterId: "b2" },
  },
  unknownFutureField: { alsoUnknown: true },
  mMap: {
    "0": { cHP: 50000, mHP: 100000, level: 100, characterName: "BossObserver" },
  },
  seq: 42,
  level: 100,
});

test("WHITELIST_VERSION is provisional-unreviewed", () => {
  assert.equal(WHITELIST_VERSION, "provisional-unreviewed");
});

test("canary input strips sensitive and unknown fields", () => {
  const projected = projectGuildCombatPacket(CANARY_RAW);
  assert.ok(projected);
  const serialized = JSON.stringify(projected);

  for (const needle of [
    "SecretPlayer",
    "char-uuid-123",
    "super-secret-token",
    "Bearer leaked",
    "nested-secret",
    "gm_token",
    "Alice",
    "Bob",
    "unknownFutureField",
    "alsoUnknown",
    "BossObserver",
    "pMap",
  ]) {
    assert.equal(
      serialized.includes(needle),
      false,
      `projected output must not contain ${needle}`,
    );
  }

  assert.equal(projected.type, "guild_battle_updated");
  assert.equal(projected.seq, 42);
  assert.equal(projected.level, 100);
  assert.equal(projected.mMap["0"].cHP, 50000);
  assert.equal(projected._projectorMeta.whitelistVersion, WHITELIST_VERSION);
});

test("extra unknown nested keys are stripped", () => {
  const projected = projectGuildCombatPacket(
    JSON.stringify({
      type: "new_guild_battle",
      level: 110,
      extra: { nested: { deep: "secret" } },
      mMap: { "0": { cHP: 1, mHP: 2, rogue: "drop-me" } },
    }),
  );
  assert.ok(projected);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("extra"), false);
  assert.equal(serialized.includes("deep"), false);
  assert.equal(serialized.includes("rogue"), false);
  assert.equal(projected.mMap["0"].cHP, 1);
});

test("empty or irrelevant packet returns null", () => {
  assert.equal(projectGuildCombatPacket(""), null);
  assert.equal(projectGuildCombatPacket("   "), null);
  assert.equal(projectGuildCombatPacket("{}"), null);
  assert.equal(
    projectGuildCombatPacket(JSON.stringify({ type: "chat_message", text: "hello" })),
    null,
  );
  assert.equal(
    projectGuildCombatPacket(JSON.stringify({ type: "guild_battle_updated" })),
    null,
  );
});

test("hashRawFrame is stable for the same input", () => {
  const raw = '{"type":"guild_battle_updated","seq":1}';
  assert.equal(hashRawFrame(raw), hashRawFrame(raw));
  assert.equal(hashRawFrame(raw).length, 32);
});

test("hashRawFrame rejects non-strings", () => {
  assert.throws(() => hashRawFrame(123), TypeError);
});
