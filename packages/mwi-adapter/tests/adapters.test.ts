import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptCyberBeggar,
  adaptTys,
  adaptWanderingEarth,
  validateMemberCapabilitySnapshot,
} from "../src/index.ts";

const now = "2026-07-24T12:00:00.000Z";

const currentEquipment = [
  {
    locationHrid: "/item_locations/equipment/two_hand",
    itemHrid: "/items/blazing_trident",
    enhancementLevel: 15,
  },
];

const currentAbilities = [
  {
    slot: 0,
    abilityHrid: "/abilities/fireball",
    level: 60,
    triggers: [{
      dependencyHrid: "/combat_trigger_dependencies/self",
      conditionHrid: "/combat_trigger_conditions/always",
      comparatorHrid: "/combat_trigger_comparators/is_active",
      value: 0,
    }],
  },
];

test("Wandering Earth keeps current build separate from member-approved builds", () => {
  const adapted = adaptWanderingEarth({
    snapshot: {
      schemaVersion: 1,
      scriptVersion: "1.13.1",
      capturedAt: now,
      character: {
        characterId: 42,
        characterName: "Ada",
        guildId: 369,
      },
      skills: { "/skills/magic": 140 },
      learnedAbilities: [
        { abilityHrid: "/abilities/fireball", level: 60 },
      ],
      auras: { "/abilities/mystic_aura": 40 },
      equipment: currentEquipment,
      abilities: currentAbilities,
      deviceToken: "must-not-survive",
    },
    trialBuilds: [{
      capturedAt: now,
      trialBuild: {
        loadoutId: 7,
        name: "Fire",
        equipment: currentEquipment,
      },
      memberToken: "also-must-not-survive",
    }],
  }, { now });

  assert.equal(adapted.confidence, "current-loadout-only");
  assert.equal(adapted.currentBuild?.simulationReady, true);
  assert.equal(adapted.approvedBuilds[0].simulationReady, false);
  assert.match(adapted.issues.join("|"), /missing-build-abilities/);
  assert.doesNotMatch(JSON.stringify(adapted), /must-not-survive/);
});

test("enhanced Wandering Earth trial build is simulation ready", () => {
  const adapted = adaptWanderingEarth({
    snapshot: {
      capturedAt: now,
      character: { characterId: 42, characterName: "Ada", guildId: 369 },
      skills: { "/skills/magic": 140 },
      learnedAbilities: [{ abilityHrid: "/abilities/fireball", level: 60 }],
      equipment: currentEquipment,
      abilities: currentAbilities,
    },
    trialBuilds: [{
      capturedAt: now,
      trialBuild: {
        loadoutId: 7,
        name: "Fire",
        equipment: currentEquipment,
        abilities: currentAbilities,
      },
    }],
  }, { now });

  assert.equal(adapted.confidence, "simulation-ready");
  assert.equal(adapted.approvedBuilds[0].simulationReady, true);
  assert.equal(adapted.approvedBuilds[0].approvedByMember, true);
});

test("Cyber Beggar payload is not promoted to simulation-ready without slots", () => {
  const adapted = adaptCyberBeggar({
    schemaVersion: 1,
    scriptVersion: "0.6.14",
    capturedAt: now,
    character: { id: 1, name: "Player", guildId: 2 },
    guild: { id: 2, name: "Guild" },
    skills: { "/skills/stamina": { level: 130 } },
    abilities: { "/abilities/fierce_aura": { level: 40 } },
    equipment: currentEquipment,
  }, { now });

  assert.equal(adapted.confidence, "current-loadout-only");
  assert.equal(adapted.approvedBuilds.length, 0);
  assert.equal(adapted.currentBuild?.simulationReady, false);
});

test("TYS payload remains capability-only and carries both weekly bosses", () => {
  const adapted = adaptTys({
    schema_version: 3,
    client_revision: 9,
    guild: { id: 2, name: "Guild" },
    reporter: { player_id: 1, display_name: "Player" },
    week: {
      combat_trial_hrids: [
        "/guild_combat/jellyfish",
        "/guild_combat/hedgehog",
      ],
    },
    capability: {
      player_id: 1,
      skills: { "/skills/magic": 140 },
      combat_weapon: {
        item_hrid: "/items/blazing_trident",
        enhancement_level: 15,
      },
      aura_abilities: [
        { ability_hrid: "/abilities/mystic_aura", level: 40 },
      ],
      has_shield: false,
    },
  }, { now, capturedAt: now });

  assert.equal(adapted.confidence, "capability-only");
  assert.deepEqual(adapted.participation.eligibleBossHrids, [
    "/guild_combat/jellyfish",
    "/guild_combat/hedgehog",
  ]);
  assert.equal(adapted.auras["/abilities/mystic_aura"], 40);
});

test("canonical validator rejects sensitive and consumable payloads", () => {
  const result = validateMemberCapabilitySnapshot({
    schemaVersion: "2",
    memberId: "1",
    displayName: "Player",
    guildId: "2",
    capturedAt: now,
    apiToken: "forbidden",
    approvedBuilds: [{
      approvedByMember: true,
      equipment: [{ itemHrid: "/items/food_pie" }],
      abilities: [{ abilityHrid: "/abilities/fireball" }],
    }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("|"), /sensitive/);
  assert.match(result.errors.join("|"), /consumable/);
});
