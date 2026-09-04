import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ST_PARTITION_KEY,
  resolveWeeklyCombatBossPair,
} from "../../scripts/weekly-combat-boss-pair.mjs";
import {
  applyTeamCaps,
  assignRoleToBoss,
  coverageReserve,
  fillUnderCapFromOverflow,
  natureHealerPerSideCandidates,
  pairStrategyForStKey,
  partitionPoliciesForStrategy,
  pickHighestGuardianAuraCarrier,
  pinMinimumRoleCounts,
  preferHighestMysticAuraOn,
  rebalancePhysicalToward,
} from "../../scripts/weekly-combat-partition.mjs";
import { fixtureFromWeeklyTrials } from "../../scripts/weekly-combat-fixture.mjs";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/monsters",
);

test("chameleon+swarm sends physical majority to chameleon and magic majority to swarm", () => {
  const strategy = pairStrategyForStKey("chameleon");
  assert.equal(strategy.id, "phys-chameleon-magic-swarm");
  assert.equal(strategy.physicalMajority, "chameleon");
  assert.equal(strategy.magicMajority, "swarm");
  assert.equal(strategy.mysticAuraSide, "swarm");
  assert.equal(strategy.physicalRebalanceSide, "chameleon");

  assert.equal(assignRoleToBoss("枪", 0, 10, { strategy, natureRatio: 0.5 }), "swarm");
  assert.equal(assignRoleToBoss("枪", 2, 10, { strategy, natureRatio: 0.5 }), "chameleon");
  assert.equal(assignRoleToBoss("火", 0, 10, { strategy, natureRatio: 0.5 }), "chameleon");
  assert.equal(assignRoleToBoss("火", 2, 10, { strategy, natureRatio: 0.5 }), "swarm");
  assert.equal(assignRoleToBoss("水", 1, 8, { strategy, natureRatio: 0.5 }), "chameleon");
  assert.equal(assignRoleToBoss("水", 2, 8, { strategy, natureRatio: 0.5 }), "swarm");
  assert.equal(assignRoleToBoss("盾", 0, 2, { strategy, natureRatio: 0.5 }), "chameleon");
  assert.equal(assignRoleToBoss("盾", 1, 2, { strategy, natureRatio: 0.5 }), "swarm");
  const sixShields = Array.from({ length: 6 }, (_, index) =>
    assignRoleToBoss("盾", index, 6, { strategy, natureRatio: 0.5 }),
  );
  assert.equal(sixShields.filter((side) => side === "chameleon").length, 3);
  assert.equal(sixShields.filter((side) => side === "swarm").length, 3);
  assert.deepEqual(sixShields, [
    "chameleon",
    "swarm",
    "chameleon",
    "swarm",
    "chameleon",
    "swarm",
  ]);
  assert.equal(coverageReserve(10), 2);
});

test("badger+swarm sends physical majority to swarm and fire/water to ST", () => {
  const strategy = pairStrategyForStKey("badger");
  assert.equal(strategy.id, "aoe-swarm-fill-badger");
  assert.equal(strategy.physicalMajority, "swarm");
  assert.equal(strategy.magicMajority, "chameleon");
  assert.equal(strategy.natureMode, "st-healers-overflow-swarm-healers");
  assert.deepEqual(strategy.stFillRoleOrder, ["枪", "剑", "弓", "弩", "锤"]);
  assert.equal(strategy.physicalRebalanceSide, null);
  assert.equal(assignRoleToBoss("弩", 0, 12, { strategy, natureHealerPerSide: 8 }), "chameleon");
  assert.equal(assignRoleToBoss("弩", 2, 12, { strategy, natureHealerPerSide: 8 }), "swarm");
  assert.equal(assignRoleToBoss("锤", 0, 9, { strategy, natureHealerPerSide: 8 }), "chameleon");
  assert.equal(assignRoleToBoss("锤", 2, 9, { strategy, natureHealerPerSide: 8 }), "swarm");
  assert.equal(assignRoleToBoss("火", 0, 12, { strategy, natureHealerPerSide: 8 }), "swarm");
  assert.equal(assignRoleToBoss("火", 2, 12, { strategy, natureHealerPerSide: 8 }), "chameleon");
  const natures = Array.from({ length: 20 }, (_, index) =>
    assignRoleToBoss("自", index, 20, { strategy, natureHealerPerSide: 8 }),
  );
  assert.equal(natures.filter((side) => side === "swarm").length, 12);
  assert.equal(natures.filter((side) => side === "chameleon").length, 8);
});

test("chameleon pair policies keep the heal-ratio suffix and ≥2 coverage", () => {
  const policies = partitionPoliciesForStrategy(pairStrategyForStKey("chameleon"));
  assert.deepEqual(
    policies.map((policy) => policy.id),
    [
      "phys-chameleon-magic-swarm-heal40",
      "phys-chameleon-magic-swarm-heal50",
      "phys-chameleon-magic-swarm-heal60",
      "phys-chameleon-magic-swarm-heal30",
    ],
  );
  const heal50 = policies[1];
  const natures = Array.from({ length: 10 }, (_, index) =>
    heal50.assign("自", index, 10),
  );
  assert.equal(natures.filter((side) => side === "swarm").length, 5);
  assert.equal(natures.filter((side) => side === "chameleon").length, 5);
});

test("badger policies sweep ST healer counts; leftover nature go to swarm", () => {
  const policies = partitionPoliciesForStrategy(pairStrategyForStKey("badger"), {
    natureCount: 20,
  });
  assert.deepEqual(
    policies.map((policy) => policy.id),
    [
      "aoe-swarm-fill-badger-stheal6",
      "aoe-swarm-fill-badger-stheal8",
      "aoe-swarm-fill-badger-stheal10",
    ],
  );
  const stheal8 = policies[1];
  const natures = Array.from({ length: 20 }, (_, index) =>
    stheal8.assign("自", index, 20),
  );
  assert.equal(natures.filter((side) => side === "swarm").length, 12);
  assert.equal(natures.filter((side) => side === "chameleon").length, 8);
  assert.deepEqual(natureHealerPerSideCandidates(22), [6, 8, 10, 11]);
  assert.deepEqual(natureHealerPerSideCandidates(19), [6, 8, 9]);
});

test("fillUnderCapFromOverflow pulls gun before hammer from physical overflow", () => {
  const base = new Map([
    ["枪", []],
    ["弩", []],
    ["锤", []],
    ["自", [{ memberId: "healer-a" }, { memberId: "healer-b" }]],
  ]);
  const overflow = new Map([
    ["枪", [{ memberId: "spear-1" }, { memberId: "spear-2" }]],
    ["弩", [{ memberId: "xbow-1" }]],
    ["锤", [{ memberId: "adudu" }, { memberId: "hammer-2" }]],
  ]);
  const filled = fillUnderCapFromOverflow(base, overflow, 5, {
    fillRoleOrder: ["枪", "剑", "弓", "弩", "锤"],
  });
  assert.deepEqual(
    filled.get("自").map((row) => row.memberId),
    ["healer-a", "healer-b"],
  );
  assert.deepEqual(
    filled.get("枪").map((row) => row.memberId),
    ["spear-1", "spear-2"],
  );
  assert.deepEqual(
    filled.get("弩").map((row) => row.memberId),
    ["xbow-1"],
  );
  assert.equal(filled.get("锤")?.length ?? 0, 0);
});

test("pickHighestGuardianAuraCarrier uses the highest learned Guardian Aura on 盾", () => {
  const carrier = pickHighestGuardianAuraCarrier([
    {
      memberId: "AkaWaka",
      combatType: "盾",
      snapshot: { learnedAbilities: { "/abilities/guardian_aura": 23 } },
    },
    {
      memberId: "himeal3",
      combatType: "盾",
      snapshot: { learnedAbilities: { "/abilities/guardian_aura": 30 } },
    },
    {
      memberId: "dps",
      combatType: "弩",
      snapshot: { learnedAbilities: { "/abilities/guardian_aura": 99 } },
    },
  ]);
  assert.equal(carrier?.memberId, "himeal3");
});

test("pinMinimumRoleCounts keeps all 盾 by stealing from the largest other role", () => {
  const pinned = pinMinimumRoleCounts(
    { 弓: 2, 弩: 20, 火: 2, 水: 1, 自: 10, 盾: 2, 枪: 8, 剑: 2, 锤: 1 },
    { 盾: 3 },
    48,
  );
  assert.equal(pinned.盾, 3);
  assert.equal(pinned.弩, 19);
  assert.equal(
    Object.values(pinned).reduce((sum, count) => sum + count, 0),
    48,
  );
});

test("pinMinimumRoleCounts keeps hammers and nature by stealing from xbows", () => {
  const pinned = pinMinimumRoleCounts(
    { 弓: 2, 弩: 15, 火: 2, 水: 2, 自: 10, 盾: 1, 枪: 13, 剑: 2, 锤: 5 },
    { 盾: 1, 自: 12, 锤: 7, 火: 2, 水: 2 },
    52,
  );
  assert.equal(pinned.自, 12);
  assert.equal(pinned.锤, 7);
  assert.equal(pinned.火, 2);
  assert.equal(pinned.弩, 11);
  assert.equal(
    Object.values(pinned).reduce((sum, count) => sum + count, 0),
    52,
  );
});

test("applyTeamCaps overflows the over-cap side onto the under-cap side", () => {
  const roleOrder = ["弓"];
  const makePool = (ids) =>
    new Map([["弓", ids.map((memberId) => ({ memberId }))]]);
  const capTeamPool = (pool, cap) =>
    new Map([["弓", (pool.get("弓") ?? []).slice(0, cap)]]);
  const leftoversAfterCap = (full, capped) => {
    const used = new Set((capped.get("弓") ?? []).map((row) => row.memberId));
    return new Map([
      ["弓", (full.get("弓") ?? []).filter((row) => !used.has(row.memberId))],
    ]);
  };
  const mergeRolePools = (primary, extra) =>
    new Map([["弓", [...(primary.get("弓") ?? []), ...(extra.get("弓") ?? [])]]]);
  const sumMap = (map) => (map.get("弓") ?? []).length;
  const result = applyTeamCaps(
    {
      chameleon: makePool(["c1", "c2", "c3"]),
      swarm: makePool(["s1"]),
    },
    2,
    { capTeamPool, leftoversAfterCap, mergeRolePools, sumMap },
  );
  assert.deepEqual(
    result.chameleon.get("弓").map((row) => row.memberId),
    ["c1", "c2"],
  );
  assert.deepEqual(
    result.swarm.get("弓").map((row) => row.memberId),
    ["s1", "c3"],
  );
  assert.equal(roleOrder[0], "弓");
});

test("physical rebalance moves the stronger physical onto the target side", () => {
  const roleOrder = ["枪"];
  const capped = {
    chameleon: new Map([
      ["枪", [{ memberId: "weak-st", level: 120 }]],
    ]),
    swarm: new Map([
      ["枪", [{ memberId: "strong-swarm", level: 140 }]],
    ]),
  };
  const next = rebalancePhysicalToward("chameleon", capped, {
    roleOrder,
    physicalCombatLevel: (row) => row.level,
    minGap: 5,
    targetLabel: "试炼变色龙",
  });
  assert.equal(next.chameleon.get("枪")[0].memberId, "strong-swarm");
  assert.equal(next.swarm.get("枪")[0].memberId, "weak-st");
});

test("highest mystic aura rides with the magic team", () => {
  const roleOrder = ["火"];
  const capped = {
    chameleon: new Map([
      ["火", [{ memberId: "low", mystic: 20 }]],
    ]),
    swarm: new Map([
      ["火", [{ memberId: "high", mystic: 80 }]],
    ]),
  };
  const next = preferHighestMysticAuraOn("swarm", capped, {
    roleOrder,
    mysticAuraLevel: (row) => row.mystic,
    targetLabel: "试炼虫群",
  });
  assert.equal(next.swarm.get("火")[0].memberId, "high");
  assert.equal(next.chameleon.get("火")[0].memberId, "low");
});

test("this week's chameleon/swarm fixture maps onto the ST partition key", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(fixtureDir, "guild-trial-2026-08-28-chameleon-swarm.json"),
      "utf8",
    ),
  );
  const weekly = resolveWeeklyCombatBossPair(fixture);
  assert.equal(weekly.stKey, "chameleon");
  assert.equal(weekly.stLabel, "试炼变色龙");
  assert.equal(weekly.stBoss.maxHp, 632500);
  assert.equal(weekly.stBoss.armor, 245);
  assert.equal(weekly.stBoss.resistance.fire, 420);
  assert.equal(weekly.swarmBoss.enemiesPerEncounter, 4);
  assert.equal(weekly.swarmBoss.enemies[0].maxHp, 220000);
  assert.equal(pairStrategyForStKey(weekly.stKey).id, "phys-chameleon-magic-swarm");
  assert.equal(ST_PARTITION_KEY, "chameleon");
});

test("fixture builder preserves this week's live chameleon HP and swarm encounter", () => {
  const fixture = fixtureFromWeeklyTrials({
    weekStartAt: "2026-08-28T00:00:00.000Z",
    capturedAt: "2026-08-28T01:02:55.086Z",
    reporter: { playerId: 195739, memberId: "adudu" },
    weeklyTrialSet: {
      combatHrids: ["/guild_combat/chameleon", "/guild_combat/swarm"],
    },
    trials: [
      {
        trialHrid: "/guild_combat/chameleon",
        trialName: "试炼变色龙",
        kind: "combat",
        maxParticipants: 52,
        monsters: [
          {
            monsterHrid: "/monsters/trial_chameleon",
            name: "Trial Chameleon",
            level: 100,
            combatStyleHrids: ["/combat_styles/ranged"],
            damageTypeHrid: "/damage_types/physical",
            attackIntervalSeconds: 2.7,
            castSpeedPercent: 5,
            abilityHaste: 0,
            maxHp: 632500,
            maxMp: 632500,
            accuracy: { stab: 110, slash: 110, smash: 110, ranged: 506, magic: 110 },
            damage: { defensive: 110, stab: 10, slash: 10, smash: 10, ranged: 385, magic: 10 },
            evasion: { stab: 396, slash: 396, smash: 396, ranged: 517, magic: 616 },
            armor: 245,
            resistance: { water: 420, nature: 420, fire: 420 },
            tenacity: 3000,
            threat: 100,
            abilities: [{ abilityHrid: "/abilities/precision", level: 60 }],
          },
        ],
      },
      {
        trialHrid: "/guild_combat/swarm",
        trialName: "试炼虫群",
        kind: "combat",
        maxParticipants: 52,
        monsters: [
          {
            monsterHrid: "/monsters/trial_beetle",
            name: "Trial Beetle",
            level: 100,
            combatStyleHrids: ["/combat_styles/smash"],
            damageTypeHrid: "/damage_types/physical",
            attackIntervalSeconds: 2.3,
            castSpeedPercent: 5,
            abilityHaste: 0,
            maxHp: 220000,
            maxMp: 220000,
            accuracy: { stab: 110, slash: 110, smash: 330, ranged: 110, magic: 110 },
            damage: { defensive: 110, stab: 110, slash: 110, smash: 165, ranged: 10, magic: 10 },
            evasion: { stab: 550, slash: 550, smash: 429, ranged: 550, magic: 429 },
            armor: 420,
            resistance: { water: 220, nature: 320, fire: 320 },
            tenacity: 3000,
            threat: 100,
            abilities: [{ abilityHrid: "/abilities/sweep", level: 60 }],
          },
          {
            monsterHrid: "/monsters/trial_dragonfly",
            name: "Trial Dragonfly",
            level: 100,
            combatStyleHrids: ["/combat_styles/ranged"],
            damageTypeHrid: "/damage_types/physical",
            attackIntervalSeconds: 2.7,
            castSpeedPercent: 5,
            abilityHaste: 0,
            maxHp: 220000,
            maxMp: 220000,
            accuracy: { stab: 110, slash: 110, smash: 110, ranged: 506, magic: 110 },
            damage: { defensive: 110, stab: 10, slash: 10, smash: 10, ranged: 143, magic: 10 },
            evasion: { stab: 352, slash: 352, smash: 352, ranged: 473, magic: 616 },
            armor: 140,
            resistance: { water: 220, nature: 220, fire: 220 },
            tenacity: 3000,
            threat: 100,
            abilities: [{ abilityHrid: "/abilities/rain_of_arrows", level: 60 }],
          },
        ],
      },
    ],
  });
  assert.equal(fixture.fixtureId, "guild-trial-2026-08-28-chameleon-swarm");
  assert.equal(fixture.bosses[0].maxHp, 632500);
  assert.equal(fixture.bosses[0].combatStyle, "ranged");
  assert.equal(fixture.bosses[1].enemiesPerEncounter, 2);
  assert.equal(fixture.bosses[1].maxHp, 440000);
  assert.equal(fixture.bosses[1].abilities[0].nameZh, "重扫");
});

test("fixture builder duplicates a single badger panel into a two-enemy floor", () => {
  const fixture = fixtureFromWeeklyTrials({
    weekStartAt: "2026-09-04T00:00:00.000Z",
    capturedAt: "2026-09-04T01:12:25.764Z",
    reporter: { playerId: 195739, memberId: "adudu" },
    weeklyTrialSet: {
      combatHrids: ["/guild_combat/swarm", "/guild_combat/badger"],
    },
    trials: [
      {
        trialHrid: "/guild_combat/swarm",
        trialName: "试炼虫群",
        kind: "combat",
        maxParticipants: 52,
        monsters: [
          {
            monsterHrid: "/monsters/trial_beetle",
            name: "Trial Beetle",
            level: 100,
            combatStyleHrids: ["/combat_styles/smash"],
            damageTypeHrid: "/damage_types/physical",
            attackIntervalSeconds: 2.3,
            castSpeedPercent: 5,
            abilityHaste: 0,
            maxHp: 220000,
            maxMp: 220000,
            accuracy: { stab: 110, slash: 110, smash: 330, ranged: 110, magic: 110 },
            damage: { defensive: 110, stab: 110, slash: 110, smash: 165, ranged: 10, magic: 10 },
            evasion: { stab: 550, slash: 550, smash: 429, ranged: 550, magic: 429 },
            armor: 420,
            resistance: { water: 220, nature: 320, fire: 320 },
            tenacity: 3000,
            threat: 100,
            abilities: [{ abilityHrid: "/abilities/sweep", level: 60 }],
          },
        ],
      },
      {
        trialHrid: "/guild_combat/badger",
        trialName: "试炼獾",
        kind: "combat",
        maxParticipants: 52,
        monsters: [
          {
            monsterHrid: "/monsters/trial_badger",
            name: "Trial Badger",
            level: 100,
            combatStyleHrids: ["/combat_styles/slash"],
            damageTypeHrid: "/damage_types/physical",
            attackIntervalSeconds: 2.7,
            castSpeedPercent: 5,
            abilityHaste: 0,
            maxHp: 379500,
            maxMp: 379500,
            accuracy: { stab: 110, slash: 462, smash: 110, ranged: 110, magic: 110 },
            damage: { defensive: 110, stab: 110, slash: 264, smash: 110, ranged: 10, magic: 10 },
            evasion: { stab: 517, slash: 517, smash: 517, ranged: 660, magic: 374 },
            armor: 420,
            resistance: { water: 170, nature: 170, fire: 170 },
            tenacity: 3000,
            threat: 100,
            abilities: [{ abilityHrid: "/abilities/cleave", level: 60 }],
          },
        ],
      },
    ],
  });
  assert.equal(fixture.fixtureId, "guild-trial-2026-09-04-badger-swarm");
  const badger = fixture.bosses.find((boss) => boss.hrid.includes("badger"));
  assert.equal(badger.enemiesPerEncounter, 2);
  assert.equal(badger.enemies.length, 2);
  assert.equal(badger.maxHp, 759000);
});
