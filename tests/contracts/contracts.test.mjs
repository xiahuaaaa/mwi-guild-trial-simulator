import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  REQUIRED_UNKNOWN_POLICY_PATHS,
  validateGuildTrialScenario,
  validateMonsterFixture
} from "../../packages/contracts/src/index.mjs";
import {
  ContractValidationError,
  loadMonsterFixture
} from "../../packages/contracts/src/loader.mjs";

const fixtureUrl = new URL(
  "../../fixtures/monsters/guild-trial-2026-07-24-jellyfish-hedgehog.json",
  import.meta.url
);

test("current-week fixture loads and preserves confirmed rules", async () => {
  const fixture = await loadMonsterFixture(fixtureUrl);

  assert.equal(fixture.rules.durationSeconds, 3600);
  assert.equal(fixture.rules.startLevel, 100);
  assert.equal(fixture.rules.levelStepOnKill, 10);
  assert.equal(fixture.rules.maxLevel, 300);
  assert.equal(fixture.rules.monsterHpPerParticipantPercent, 1);
  assert.equal(fixture.rules.repeatCount, 3);
  assert.equal(fixture.rules.seeds.length, 3);
  assert.equal(fixture.rules.consumables, "disabled");
  assert.equal(fixture.rules.passiveHpMpRegenFlatBonusPercent, 3);
  assert.equal(fixture.rules.passiveRegenScope, "regen_tick_hp_mp_additive");
  assert.equal(fixture.rules.maxBlockRollsPerIncomingAttack, 5);
});

test("current-week fixture contains the exact displayed jellyfish and hedgehog panels", async () => {
  const fixture = await loadMonsterFixture(fixtureUrl);
  const byId = new Map(fixture.bosses.map((boss) => [boss.hrid, boss]));
  const jellyfish = byId.get("/guild_combat/jellyfish");
  const hedgehog = byId.get("/guild_combat/hedgehog");

  assert.deepEqual(
    {
      hp: jellyfish.maxHp,
      mp: jellyfish.maxMp,
      magicAccuracy: jellyfish.accuracy.magic,
      magicDamage: jellyfish.damage.magic,
      armor: jellyfish.armor,
      evasion: jellyfish.evasion,
      resistance: jellyfish.resistance,
      abilities: jellyfish.abilities.map(({ level }) => level)
    },
    {
      hp: 495000,
      mp: 495000,
      magicAccuracy: 418,
      magicDamage: 352,
      armor: 200,
      evasion: { stab: 770, slash: 770, smash: 770, ranged: 396, magic: 517 },
      resistance: { water: 280, nature: 160, fire: 280 },
      abilities: [40, 60, 60, 60, 60]
    }
  );

  assert.deepEqual(
    {
      hp: hedgehog.maxHp,
      mp: hedgehog.maxMp,
      magicAccuracy: hedgehog.accuracy.magic,
      magicDamage: hedgehog.damage.magic,
      armor: hedgehog.armor,
      evasion: hedgehog.evasion,
      resistance: hedgehog.resistance,
      abilities: hedgehog.abilities.map(({ level }) => level)
    },
    {
      hp: 440000,
      mp: 440000,
      magicAccuracy: 418,
      magicDamage: 286,
      armor: 270,
      evasion: { stab: 495, slash: 495, smash: 495, ranged: 495, magic: 495 },
      resistance: { water: 270, nature: 270, fire: 160 },
      abilities: [40, 60, 60, 60, 60]
    }
  );
});

test("HP/MP refill and higher-floor pool scaling are confirmed while other policies remain unknown", async () => {
  const fixture = await loadMonsterFixture(fixtureUrl);
  const { combatPolicy, transitionPolicy, scalingPolicy } = fixture.rules;

  assert.equal(scalingPolicy.status, "confirmed");
  assert.equal(scalingPolicy.id, "guild-trial-level-plus-10-over-110-v1");
  assert.equal(scalingPolicy.source, "2026-07-28-jellyfish-floor15-47p-screenshot");
  assert.equal(combatPolicy.passiveRegenRounding, "unknown");
  assert.equal(combatPolicy.healingMultiplier, "unknown");
  assert.equal(combatPolicy.lifeStealMultiplier, "unknown");
  assert.equal(combatPolicy.manaLeechMultiplier, "unknown");
  assert.equal(combatPolicy.deathBehavior, "unknown");
  assert.equal(combatPolicy.allDeadBehavior, "unknown");
  assert.equal(combatPolicy.targetPolicy, "unknown");
  assert.equal(transitionPolicy.spawnDelayMs, null);
  assert.equal(transitionPolicy.playerHp, "full");
  assert.equal(transitionPolicy.playerMp, "full");
  for (const [key, value] of Object.entries(transitionPolicy)) {
    if (!["spawnDelayMs", "playerHp", "playerMp"].includes(key)) {
      assert.equal(value, "unknown");
    }
  }
});

test("fixture validator rejects changes to confirmed invariants", async () => {
  const raw = JSON.parse(await readFile(fixtureUrl, "utf8"));
  raw.rules.durationSeconds = 10800;
  raw.rules.combatPolicy.passiveRegenFlatBonus = 0.01;
  raw.rules.combatPolicy.healingMultiplier = 4;

  const result = validateMonsterFixture(raw);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ path }) => path),
    [
      "$.rules.durationSeconds",
      "$.rules.combatPolicy.passiveRegenFlatBonus"
    ]
  );
});

test("loader returns useful path-based errors", async () => {
  const raw = JSON.parse(await readFile(fixtureUrl, "utf8"));
  raw.bosses[0].abilities = [];
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "mwi-contracts-"));
  const invalidFixturePath = join(temporaryDirectory, "invalid.json");

  try {
    await writeFile(invalidFixturePath, JSON.stringify(raw), "utf8");
    await assert.rejects(
      () => loadMonsterFixture(invalidFixturePath),
      (error) => {
        assert.ok(error instanceof ContractValidationError);
        assert.match(error.message, /\$\.bosses\[0\]\.abilities/);
        return true;
      }
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("scenario validator requires explicit provenance for every unresolved policy", async () => {
  const fixture = await loadMonsterFixture(fixtureUrl);
  const unknownEntry = {
    status: "unknown",
    value: "unknown",
    source: null
  };
  const policyProvenance = Object.fromEntries(
    REQUIRED_UNKNOWN_POLICY_PATHS.map((path) => [path, { ...unknownEntry }])
  );

  const scenario = {
    schemaVersion: 1,
    gameBuild: "fixture-only",
    scenarioId: "contracts-test",
    durationMs: 3600000,
    startMonsterLevel: 100,
    levelStep: 10,
    maxMonsterLevel: 300,
    monsterHpPerParticipant: 0.01,
    repeatCount: 3,
    seeds: fixture.rules.seeds,
    monster: fixture.bosses[0],
    members: [],
    guildModifiers: [],
    scalingPolicy: fixture.rules.scalingPolicy,
    transitionPolicy: fixture.rules.transitionPolicy,
    combatPolicy: fixture.rules.combatPolicy,
    policyProvenance,
    assumptionWarnings: ["Rules with unknown provenance are not calibrated."]
  };

  assert.equal(validateGuildTrialScenario(scenario).ok, true);

  delete policyProvenance["combatPolicy.lifeStealMultiplier"];
  const invalid = validateGuildTrialScenario(scenario);
  assert.equal(invalid.ok, false);
  assert.ok(
    invalid.errors.some(
      ({ path }) =>
        path === "$.policyProvenance.combatPolicy.lifeStealMultiplier"
    )
  );
});
