import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateGuildTrialRuns,
  combatTrialBasePoints,
  combatTrialIncompleteFloorPoints,
  createGuildTrialRules,
  guildTrialMonsterPoolAtLevel,
  GuildTrialRunner,
  incompleteFloorRewardFraction,
  LinearBossFactory,
  skillingTrialIncompleteFloorPoints,
  StaticDamageCombatPort,
  type GuildTrialRunResult,
  type StaticMemberInput,
} from "../../packages/guild-trial-core/src/index.ts";

const rules = createGuildTrialRules({
  spawnDelayMs: 0,
  transitionState: "refill-hp-mp",
  passiveRegenRounding: "multiply-before-floor",
});

function createRunner(): GuildTrialRunner<StaticMemberInput> {
  return new GuildTrialRunner(
    new StaticDamageCombatPort(),
    new LinearBossFactory({
      monsterId: "/guild_combat/test",
      level100MaxHitpoints: 1,
    }),
  );
}

test("one continuous 3600s run starts at 100 and advances exactly +10 per kill", () => {
  const result = createRunner().run({
    seed: 42,
    rules,
    assumptionWarnings: ["spawn delay and state carry are test assumptions"],
    members: [
      {
        memberId: "member-1",
        attackIntervalMs: 600_000,
        minimumDamage: 1,
        maximumDamage: 1,
        maxHitpoints: 100,
        maxManapoints: 100,
        consumables: [{ id: "/items/forbidden_food", hitpointsRestored: 100 }],
      },
    ],
  });

  assert.equal(result.elapsedMs, 3_600_000);
  assert.equal(result.lastProcessedEventAtMs, 3_600_000);
  assert.equal(result.wavesCleared, 6);
  assert.deepEqual(
    result.waveKills.map((wave) => wave.level),
    [100, 110, 120, 130, 140, 150],
  );
  assert.deepEqual(
    result.waveKills.map((wave) => wave.killedAtMs),
    [600_000, 1_200_000, 1_800_000, 2_400_000, 3_000_000, 3_600_000],
  );
  assert.equal(result.finalMonsterLevel, 160);
  assert.equal(result.finalMonsterHp, result.finalMonsterMaxHp);
  assert.equal(result.awaitingMonsterSpawn, false);
  assert.equal(result.members[0]?.totalDamage, 6);
  assert.equal(result.members[0]?.dps, 6 / 3_600);
  assert.equal(result.consumableUses, 0);
  assert.deepEqual(result.assumptionWarnings, [
    "spawn delay and state carry are test assumptions",
  ]);
});

test("level transition refills HP and MP before the next level begins", () => {
  const result = createRunner().run({
    seed: 42,
    rules,
    members: [
      {
        memberId: "refill-member",
        attackIntervalMs: 600_000,
        minimumDamage: 1,
        maximumDamage: 1,
        manaCostPerAttack: 60,
        maxHitpoints: 100,
        maxManapoints: 100,
        currentHitpoints: 12,
        currentManapoints: 60,
      },
    ],
  });

  assert.deepEqual(
    result.waveKills.map((wave) => wave.level),
    [100, 110, 120, 130, 140, 150],
  );
  assert.equal(result.members[0]?.oom, false);
});

test("passive HP/MP regen receives an additive +3% and capped gain is recorded", () => {
  const result = createRunner().run({
    seed: 7,
    rules,
    members: [
      {
        memberId: "regen-member",
        attackIntervalMs: 4_000_000,
        minimumDamage: 0,
        maximumDamage: 0,
        maxHitpoints: 100,
        maxManapoints: 100,
        currentHitpoints: 50,
        currentManapoints: 50,
        passiveHpRegenPerTenSeconds: 0.01,
        passiveMpRegenPerTenSeconds: 0.01,
        consumables: [
          {
            id: "/items/forbidden_drink",
            manapointsRestored: 999_999,
          },
        ],
      },
    ],
  });

  const member = result.members[0];
  assert.equal(member?.passiveHitpointsGained, 50);
  assert.equal(member?.passiveManapointsGained, 50);
  assert.equal(result.consumableUses, 0);
});

test("monster HP increases by exactly 1% for every participant", () => {
  const members = Array.from({ length: 40 }, (_, index) => ({
    memberId: `member-${index + 1}`,
    attackIntervalMs: 4_000_000,
    minimumDamage: 0,
    maximumDamage: 0,
    maxHitpoints: 100,
    maxManapoints: 100,
  }));
  const runner = new GuildTrialRunner(
    new StaticDamageCombatPort(),
    new LinearBossFactory({
      monsterId: "/guild_combat/hp_scaling",
      level100MaxHitpoints: 1_000,
    }),
  );
  const result = runner.run({ seed: 1, rules, members });

  assert.equal(result.participantCount, 40);
  assert.equal(result.monsterHpMultiplier, 1.4);
  assert.equal(result.finalMonsterMaxHp, 1_400);
  assert.equal(result.finalMonsterHp, 1_400);
});

test("higher-floor boss pools use (level+10)/110 instead of labyrinth level/100", () => {
  assert.equal(guildTrialMonsterPoolAtLevel(495_000, 100), 495_000);
  assert.equal(guildTrialMonsterPoolAtLevel(495_000, 240), 1_125_000);
  const factory = new LinearBossFactory({
    monsterId: "/guild_combat/jellyfish",
    level100MaxHitpoints: 495_000,
  });
  const boss = factory.spawn(240);
  assert.equal(boss.maxHitpoints, 1_125_000);
  assert.equal(Math.floor(boss.maxHitpoints * 1.47), 1_653_750);
});

test("trial stops after clearing level 300 and awards combat base points", () => {
  const result = createRunner().run({
    seed: 2,
    rules,
    members: [
      {
        memberId: "cap-clearer",
        attackIntervalMs: 1_000,
        minimumDamage: 1,
        maximumDamage: 1,
        maxHitpoints: 100,
        maxManapoints: 100,
      },
    ],
  });

  assert.equal(result.wavesCleared, 21);
  assert.equal(result.finalMonsterLevel, 300);
  assert.equal(result.finalMonsterHp, 0);
  assert.equal(result.maximumLevelCleared, true);
  assert.equal(result.awaitingMonsterSpawn, false);
  assert.equal(result.combatBasePoints, 4_400);
  assert.equal(combatTrialBasePoints(0), 0);
  assert.equal(combatTrialBasePoints(1), 400);
  assert.equal(combatTrialBasePoints(3), 800);
});

test("incomplete floor rewards pay progress percent capped at 50%", () => {
  assert.equal(incompleteFloorRewardFraction(0.8), 0.5);
  assert.equal(incompleteFloorRewardFraction(0.3), 0.3);
  assert.equal(combatTrialIncompleteFloorPoints(0, 0.8), 200);
  assert.equal(combatTrialIncompleteFloorPoints(10, 0.3), 60);
  assert.equal(skillingTrialIncompleteFloorPoints(0, 1), 100);
  assert.equal(skillingTrialIncompleteFloorPoints(5, 0.4), 40);
});

test("insufficient MP produces dynamic OOM events without executing the action", () => {
  const result = createRunner().run({
    seed: 9,
    rules,
    members: [
      {
        memberId: "oom-member",
        attackIntervalMs: 600_000,
        minimumDamage: 10,
        maximumDamage: 10,
        manaCostPerAttack: 1,
        maxHitpoints: 100,
        maxManapoints: 0,
      },
    ],
  });

  const member = result.members[0];
  assert.equal(member?.totalDamage, 0);
  assert.equal(member?.oom, true);
  assert.equal(member?.oomEvents, 6);
  assert.equal(member?.firstOomAtMs, 600_000);
  assert.equal(member?.oomDurationMs, 3_000_000);
});

test("same seed is byte-identical while a different seed changes random damage", () => {
  const request = {
    rules,
    members: [
      {
        memberId: "rng-member",
        attackIntervalMs: 600_000,
        minimumDamage: 1,
        maximumDamage: 10,
        maxHitpoints: 100,
        maxManapoints: 100,
      },
    ],
  } as const;
  const createRandomRunner = () =>
    new GuildTrialRunner(
      new StaticDamageCombatPort(),
      new LinearBossFactory({
        monsterId: "/guild_combat/random_test",
        level100MaxHitpoints: 1_000_000_000,
      }),
    );
  const first = createRandomRunner().run({ ...request, seed: 1 });
  const second = createRandomRunner().run({ ...request, seed: 1 });
  // Seeds 1 and 3 have pinned, distinct six-roll sums under Mulberry32.
  // This avoids relying on the false assumption that every pair of seeds must
  // produce a different aggregate over a small sample.
  const third = createRandomRunner().run({ ...request, seed: 3 });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.notEqual(
    first.members[0]?.totalDamage,
    third.members[0]?.totalDamage,
  );
});

test("three-run aggregation keeps raw runs and uses screenshot semantics", () => {
  const runs = [
    createSyntheticRun(1, 10, false, 1, 100),
    createSyntheticRun(2, 20, true, 2, 200),
    createSyntheticRun(3, 31, false, 3, 300),
  ] as const;
  const aggregate = aggregateGuildTrialRuns(runs);

  assert.equal(aggregate.runs.length, 3);
  assert.equal(aggregate.members[0]?.meanDps, 61 / 3);
  assert.equal(aggregate.members[0]?.roundedMeanDps, 20);
  assert.equal(aggregate.members[0]?.oom, true);
  assert.equal(aggregate.members[0]?.deaths, 6);
  assert.equal(aggregate.members[0]?.damageTaken, 600);
});

function createSyntheticRun(
  seed: number,
  dps: number,
  oom: boolean,
  deaths: number,
  damageTaken: number,
): GuildTrialRunResult {
  return {
    seed,
    elapsedMs: 3_600_000,
    participantCount: 1,
    monsterHpMultiplier: 1.01,
    processedEvents: 0,
    wavesCleared: 0,
    finalMonsterLevel: 100,
    finalMonsterHp: 1,
    finalMonsterMaxHp: 1,
    awaitingMonsterSpawn: false,
    maximumLevelCleared: false,
    combatBasePoints: 0,
    waveKills: [],
    members: [
      {
        memberId: "member",
        totalDamage: dps * 3_600,
        dps,
        damageTaken,
        deaths,
        oom,
        oomEvents: oom ? 1 : 0,
        oomDurationMs: 0,
        passiveHitpointsGained: 0,
        passiveManapointsGained: 0,
      },
    ],
    consumableUses: 0,
    assumptionWarnings: [],
  };
}
