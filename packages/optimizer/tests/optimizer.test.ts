import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  ApprovedCombatBuild,
  MemberCapabilitySnapshotV2,
} from "../../mwi-adapter/src/model.ts";
import {
  buildInitialAssignment,
  generateBuildCandidates,
  optimizerBossesFromFixture,
  type BossTeamConstraint,
  type OptimizerBoss,
} from "../src/index.ts";
import type {
  CurrentWeekMonsterFixture,
} from "../../contracts/src/index.ts";

const bosses: OptimizerBoss[] = [
  {
    hrid: "/guild_combat/jellyfish",
    name: "试炼水母",
    evasion: { stab: 770, slash: 770, smash: 770, ranged: 396, magic: 517 },
    armor: 200,
    resistance: { water: 280, nature: 160, fire: 280 },
    capacity: 48,
  },
  {
    hrid: "/guild_combat/hedgehog",
    name: "试炼刺猬",
    evasion: { stab: 495, slash: 495, smash: 495, ranged: 495, magic: 495 },
    armor: 270,
    resistance: { water: 270, nature: 270, fire: 160 },
    capacity: 48,
  },
];

function ability(abilityHrid: string, slot: number) {
  return { slot, abilityHrid, level: 60, triggers: [] };
}

function build(
  id: string,
  weapon: string,
  abilities: string[],
): ApprovedCombatBuild {
  return {
    buildId: id,
    name: id,
    approvedByMember: true,
    capturedAt: "2026-07-24T00:00:00.000Z",
    equipment: [{
      locationHrid: "/item_locations/equipment/two_hand",
      itemHrid: weapon,
      enhancementLevel: 15,
    }],
    abilities: abilities.map(ability),
    weapon: {
      locationHrid: "/item_locations/equipment/two_hand",
      itemHrid: weapon,
      enhancementLevel: 15,
    },
    simulationReady: true,
    issues: [],
  };
}

function member(
  id: string,
  approvedBuild: ApprovedCombatBuild,
): MemberCapabilitySnapshotV2 {
  return {
    schemaVersion: "2",
    memberId: id,
    displayName: id,
    guildId: "369",
    capturedAt: "2026-07-24T00:00:00.000Z",
    source: "wandering-earth",
    sourceSchemaVersion: "2",
    sourceFingerprint: `test:${id}`,
    freshness: "fresh",
    confidence: "simulation-ready",
    skills: {
      "/skills/attack": 140,
      "/skills/ranged": 140,
      "/skills/magic": 140,
    },
    learnedAbilities: {},
    auras: {},
    approvedBuilds: [approvedBuild],
    participation: {
      eligibleBossHrids: bosses.map((boss) => boss.hrid),
      preferredBossHrids: [],
      maxBossAssignments: 1,
      allowRoleChange: true,
      allowSkillChange: true,
    },
    issues: [],
  };
}

const members = [
  member("tank-a", build("tank-a", "/items/griffin_bulwark", [
    "/abilities/provoke",
    "/abilities/guardian_aura",
  ])),
  member("tank-b", build("tank-b", "/items/griffin_bulwark", [
    "/abilities/provoke",
    "/abilities/guardian_aura",
  ])),
  member("heal-a", build("heal-a", "/items/blooming_trident", [
    "/abilities/rejuvenate",
    "/abilities/mystic_aura",
  ])),
  member("heal-b", build("heal-b", "/items/blooming_trident", [
    "/abilities/rejuvenate",
    "/abilities/mystic_aura",
  ])),
  member("nature", build("nature", "/items/holy_nature_staff", [
    "/abilities/toxic_pollen",
  ])),
  member("ranged", build("ranged", "/items/cursed_bow", [
    "/abilities/puncture",
  ])),
  member("fire-a", build("fire-a", "/items/blazing_trident", [
    "/abilities/fireball",
  ])),
  member("fire-b", build("fire-b", "/items/blazing_trident", [
    "/abilities/fireball",
  ])),
];

test("runtime fixture maps directly into the optimizer boss model", async () => {
  const fixtureUrl = new URL(
    "../../../fixtures/monsters/guild-trial-2026-07-24-jellyfish-hedgehog.json",
    import.meta.url,
  );
  const fixture = JSON.parse(
    await readFile(fixtureUrl, "utf8"),
  ) as CurrentWeekMonsterFixture;
  const mapped = optimizerBossesFromFixture(fixture);
  assert.deepEqual(mapped.map((boss) => boss.hrid), bosses.map((boss) => boss.hrid));
  assert.equal(mapped[0].resistance.nature, 160);
  assert.equal(mapped[1].resistance.fire, 160);
  assert.equal(mapped[0].capacity, 48);
});

test("candidate generation only uses approved simulation-ready builds", () => {
  const candidates = generateBuildCandidates(members, bosses, {
    abilityEffectTags: {
      "/abilities/toxic_pollen": ["nature-resistance-down"],
      "/abilities/puncture": ["armor-down"],
    },
  });
  assert.equal(candidates.length, members.length * bosses.length);
  assert.ok(candidates.every((candidate) => candidate.heuristicOnly));
  assert.ok(candidates.some((candidate) =>
    candidate.coverageTags.includes("effect:armor-down")
  ));
});

test("QQ combat binding selects matching weapons from the full uploaded catalog", () => {
  const catalogMember = member("catalog-user", build("unused", "/items/cursed_bow", []));
  catalogMember.approvedBuilds = [];
  catalogMember.confidence = "capability-only";
  catalogMember.loadoutCatalog = [
    {
      sourceLoadoutId: 1,
      name: "弩",
      category: "combat",
      actionTypeHrid: "/action_types/combat",
      equipment: [{ locationHrid: "/item_locations/equipment/two_hand", itemHrid: "/items/enchanted_crossbow", enhancementLevel: 15 }],
      abilities: [ability("/abilities/steady_shot", 1)],
      issues: [],
    },
    {
      sourceLoadoutId: 2,
      name: "火",
      category: "combat",
      actionTypeHrid: "/action_types/combat",
      equipment: [{ locationHrid: "/item_locations/equipment/two_hand", itemHrid: "/items/blazing_trident", enhancementLevel: 15 }],
      abilities: [ability("/abilities/fireball", 1)],
      issues: [],
    },
  ];
  const candidates = generateBuildCandidates([catalogMember], bosses, {
    memberCombatTypes: { "catalog-user": "弩" },
  });
  assert.equal(candidates.length, bosses.length);
  assert.ok(candidates.every((candidate) => candidate.build.weapon?.itemHrid.includes("crossbow")));
});

test("initial assignment is disjoint and satisfies hard provider constraints", () => {
  const candidates = generateBuildCandidates(members, bosses, {
    abilityEffectTags: {
      "/abilities/toxic_pollen": ["nature-resistance-down"],
      "/abilities/puncture": ["armor-down"],
    },
  });
  const constraints: BossTeamConstraint[] = [
    {
      bossHrid: bosses[0].hrid,
      capacity: 48,
      minimumMembers: 4,
      minimumTanks: 1,
      minimumHealers: 1,
      coverage: [{
        tag: "effect:nature-resistance-down",
        minimumProviders: 1,
        minimumUptime: 0.9,
        critical: true,
      }],
    },
    {
      bossHrid: bosses[1].hrid,
      capacity: 48,
      minimumMembers: 4,
      minimumTanks: 1,
      minimumHealers: 1,
      coverage: [],
    },
  ];
  const result = buildInitialAssignment(candidates, constraints);
  const assigned = result.teams.flatMap((team) =>
    team.candidates.map((candidate) => candidate.memberId)
  );

  assert.equal(result.feasible, true);
  assert.equal(new Set(assigned).size, assigned.length);
  assert.equal(result.unassignedMemberIds.length, 0);
  assert.ok(result.teams.every((team) => team.candidates.length >= 4));
  assert.match(result.warnings.join("|"), /full-two-boss-three-seed/);
});

test("missing critical coverage is a hard infeasibility", () => {
  const candidates = generateBuildCandidates(members, bosses);
  const result = buildInitialAssignment(candidates, [{
    bossHrid: bosses[0].hrid,
    capacity: 48,
    minimumMembers: 1,
    minimumTanks: 0,
    minimumHealers: 0,
    coverage: [{
      tag: "effect:unavailable",
      minimumProviders: 1,
      minimumUptime: 1,
      critical: true,
    }],
  }]);
  assert.equal(result.feasible, false);
  assert.match(result.teams[0].issues.join("|"), /critical-coverage/);
});
