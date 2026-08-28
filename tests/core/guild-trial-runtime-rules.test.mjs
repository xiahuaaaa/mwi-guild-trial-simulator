import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import CombatSimulator from "../../packages/shykai-full-runtime/generated/src/combatsimulator/combatSimulator.js";
import Monster from "../../packages/shykai-full-runtime/generated/src/combatsimulator/monster.js";
import Ability from "../../packages/shykai-full-runtime/generated/src/combatsimulator/ability.js";
import AutoAttackEvent from "../../packages/shykai-full-runtime/generated/src/combatsimulator/events/autoAttackEvent.js";
import AbilityCastEndEvent from "../../packages/shykai-full-runtime/generated/src/combatsimulator/events/abilityCastEndEvent.js";
import combatMonsterDetailMap from "../../packages/shykai-full-runtime/generated/src/combatsimulator/data/combatMonsterDetailMap.json.js";
import {
  applyGuildTrialMonsterHpScaling,
  enemiesPerEncounterForBoss,
  guildTrialMonsterPoolAtLevel,
  GuildTrialZone,
  GUILD_TRIAL_MONSTER_ABILITY_HASTE_PER_PARTICIPANT,
  GUILD_TRIAL_MONSTER_ATTACK_SPEED_PER_PARTICIPANT,
  GUILD_TRIAL_MONSTER_CAST_SPEED_PER_PARTICIPANT,
  monsterAttackSpeedBonusForParticipants,
  monsterHpMultiplierForParticipants,
} from "../../packages/shykai-full-runtime/src/guild-trial-runner.mjs";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/monsters/guild-trial-2026-07-24-jellyfish-hedgehog.json", import.meta.url),
    "utf8",
  ),
);
const hedgehogWeek = JSON.parse(
  readFileSync(
    new URL("../../fixtures/monsters/guild-trial-2026-08-14-hedgehog-swarm.json", import.meta.url),
    "utf8",
  ),
);
const jellyfish = fixture.bosses.find((boss) => boss.hrid === "/guild_combat/jellyfish");
const hedgehog = hedgehogWeek.bosses.find((boss) => boss.hrid === "/guild_combat/hedgehog");

function installBossDefinition(boss) {
  const ONE_SECOND = 1e9;
  const lowestEvasion = Math.min(...Object.values(boss.evasion));
  const defenseLevel = Math.max(0, lowestEvasion - 10);
  const evasionRatio = (value) => value / (10 + defenseLevel) - 1;
  const attackLevel = Math.max(0, (boss.accuracy.magic ?? 10) - 10);
  const magicLevel = Math.max(0, (boss.damage.magic ?? 10) - 10);
  const staminaLevel = Math.max(0, boss.maxHp / 10 - 10);
  const intelligenceLevel = Math.max(0, boss.maxMp / 10 - 10);
  const defenseContribution = 0.2 * defenseLevel;
  combatMonsterDetailMap[boss.hrid] = {
    hrid: boss.hrid,
    name: boss.nameZh,
    experience: 0,
    enrageTime: 24 * 60 * 60 * ONE_SECOND,
    abilities: boss.abilities.map((ability) => ({
      abilityHrid: ability.hrid,
      level: ability.level,
      minDifficultyTier: 0,
    })),
    dropTable: [],
    rareDropTable: [],
    combatDetails: {
      staminaLevel,
      intelligenceLevel,
      attackLevel,
      defenseLevel,
      meleeLevel: magicLevel,
      rangedLevel: magicLevel,
      magicLevel,
      combatStats: {
        combatStyleHrids: [`/combat_styles/${boss.combatStyle}`],
        damageType: `/damage_types/${boss.damageType}`,
        attackInterval: boss.attackIntervalSeconds * ONE_SECOND * (1 + attackLevel / 2000),
        castSpeed: boss.castSpeedPercent / 100 - attackLevel / 2000,
        abilityHaste: boss.abilityHaste,
        magicAccuracy: 0,
        magicDamage: 0,
        stabEvasion: evasionRatio(boss.evasion.stab),
        slashEvasion: evasionRatio(boss.evasion.slash),
        smashEvasion: evasionRatio(boss.evasion.smash),
        rangedEvasion: evasionRatio(boss.evasion.ranged),
        magicEvasion: evasionRatio(boss.evasion.magic),
        armor: boss.armor - defenseContribution,
        waterResistance: boss.resistance.water - defenseContribution,
        natureResistance: boss.resistance.nature - defenseContribution,
        fireResistance: boss.resistance.fire - defenseContribution,
        maxHitpoints: 0,
        maxManapoints: 0,
        tenacity: boss.tenacity,
        threat: 0,
      },
    },
  };
}

test("full runtime applies +1% boss HP per participant after every stat refresh", () => {
  let baseHp = 495_000;
  const monster = {
    hrid: "/guild_combat/test",
    roomLevel: 100,
    combatDetails: {
      maxHitpoints: 0,
      currentHitpoints: 0,
      maxManapoints: 0,
      currentManapoints: 0,
    },
    updateCombatDetails() {
      this.combatDetails.maxHitpoints = guildTrialMonsterPoolAtLevel(baseHp, this.roomLevel);
      this.combatDetails.maxManapoints = guildTrialMonsterPoolAtLevel(baseHp, this.roomLevel);
    },
  };
  combatMonsterDetailMap["/guild_combat/test"] = {
    combatDetails: {
      staminaLevel: baseHp / 10 - 10,
      intelligenceLevel: baseHp / 10 - 10,
      combatStats: { maxHitpoints: 0, maxManapoints: 0 },
    },
  };

  applyGuildTrialMonsterHpScaling(monster, 40);
  assert.equal(monsterHpMultiplierForParticipants(40), 1.4);
  assert.equal(monster.combatDetails.maxHitpoints, 693_000);
  assert.equal(monster.combatDetails.currentHitpoints, 693_000);
  assert.equal(monster.combatDetails.maxManapoints, 495_000);

  baseHp = 544_500;
  combatMonsterDetailMap["/guild_combat/test"].combatDetails.staminaLevel = baseHp / 10 - 10;
  combatMonsterDetailMap["/guild_combat/test"].combatDetails.intelligenceLevel = baseHp / 10 - 10;
  monster.updateCombatDetails();
  assert.equal(monster.combatDetails.maxHitpoints, 762_300);
  assert.equal(monster.combatDetails.maxManapoints, 544_500);
});

test("jellyfish floor 15 with 47 participants matches the live screenshot pools", () => {
  installBossDefinition(jellyfish);
  const level = 240;
  const participants = 47;
  assert.equal(guildTrialMonsterPoolAtLevel(jellyfish.maxHp, 100), 495_000);
  assert.equal(guildTrialMonsterPoolAtLevel(jellyfish.maxHp, level), 1_125_000);
  assert.equal(Math.floor(1_125_000 * monsterHpMultiplierForParticipants(participants)), 1_653_750);

  const monster = new Monster(jellyfish.hrid, 0, level);
  applyGuildTrialMonsterHpScaling(monster, participants);
  assert.equal(monster.combatDetails.maxHitpoints, 1_653_750);
  assert.equal(monster.combatDetails.maxManapoints, 1_125_000);
  assert.equal(monster.combatDetails.currentHitpoints, 1_653_750);
  assert.equal(monster.combatDetails.currentManapoints, 1_125_000);
});

test("full runtime scales monster attack speed, cast speed and skill haste per participant", () => {
  installBossDefinition(hedgehog);
  const participants = 50;
  const unscaled = new Monster(hedgehog.hrid, 0, 100);
  unscaled.updateCombatDetails();
  const baseInterval = unscaled.combatDetails.combatStats.attackInterval;
  const baseCastSpeed = unscaled.combatDetails.combatStats.castSpeed;
  const baseHaste = unscaled.combatDetails.combatStats.abilityHaste || 0;

  const scaled = new Monster(hedgehog.hrid, 0, 100);
  applyGuildTrialMonsterHpScaling(scaled, participants);
  const attackSpeedBonus = monsterAttackSpeedBonusForParticipants(participants);
  assert.equal(attackSpeedBonus, participants * GUILD_TRIAL_MONSTER_ATTACK_SPEED_PER_PARTICIPANT);
  assert.equal(
    scaled.combatDetails.combatStats.attackInterval,
    baseInterval / (1 + attackSpeedBonus),
  );
  assert.equal(
    scaled.combatDetails.combatStats.castSpeed,
    baseCastSpeed + participants * GUILD_TRIAL_MONSTER_CAST_SPEED_PER_PARTICIPANT,
  );
  assert.equal(
    scaled.combatDetails.combatStats.abilityHaste,
    baseHaste + participants * GUILD_TRIAL_MONSTER_ABILITY_HASTE_PER_PARTICIPANT,
  );
  assert.equal(scaled.combatDetails.maxHitpoints, 660_000);

  scaled.updateCombatDetails();
  assert.equal(
    scaled.combatDetails.combatStats.attackInterval,
    baseInterval / (1 + attackSpeedBonus),
  );
  assert.equal(
    scaled.combatDetails.combatStats.abilityHaste,
    baseHaste + participants * GUILD_TRIAL_MONSTER_ABILITY_HASTE_PER_PARTICIPANT,
  );
});

test("combat simulator auto-attacks and casts use the participant speed bonuses", () => {
  installBossDefinition(hedgehog);
  const participants = 50;
  const monster = new Monster(hedgehog.hrid, 0, 100);
  applyGuildTrialMonsterHpScaling(monster, participants);
  monster.abilities = [];
  const dummyPlayer = {
    isPlayer: true,
    combatDetails: {
      currentHitpoints: 10_000,
      maxHitpoints: 10_000,
      combatStats: { parry: 0 },
    },
    abilities: [],
  };
  const simulator = new CombatSimulator([dummyPlayer], null, null, {
    maxParryAttempts: 5,
  });
  simulator.simulationTime = 0;
  simulator.enemies = [monster];
  simulator.addNextAttackEvent(monster);
  const autoAttack = simulator.eventQueue.getNextEvent();
  assert.equal(autoAttack.type, AutoAttackEvent.type);
  assert.equal(autoAttack.source, monster);
  assert.equal(autoAttack.time, monster.combatDetails.combatStats.attackInterval);

  const fireball = new Ability("/abilities/fireball", 60);
  fireball.triggers = [];
  fireball.lastUsed = 0;
  const haste = monster.combatDetails.combatStats.abilityHaste;
  const expectedCooldown = fireball.cooldownDuration * 100 / (100 + haste);
  assert.equal(
    fireball.shouldTrigger(expectedCooldown - 1, monster, dummyPlayer, [monster], [dummyPlayer]),
    false,
  );
  assert.equal(
    fireball.shouldTrigger(expectedCooldown, monster, dummyPlayer, [monster], [dummyPlayer]),
    true,
  );

  fireball.lastUsed = Number.MIN_SAFE_INTEGER;

  monster.abilities = [fireball];
  simulator.eventQueue.clear();
  simulator.addNextAttackEvent(monster);
  const cast = simulator.eventQueue.getNextEvent();
  assert.equal(cast.type, AbilityCastEndEvent.type);
  assert.equal(
    cast.time,
    fireball.castDuration / (1 + monster.combatDetails.combatStats.castSpeed),
  );
});

test("guild trial parry checks can try five distinct living parry users", () => {
  const targets = Array.from({ length: 6 }, (_, index) => ({
    id: index,
    combatDetails: {
      currentHitpoints: 100,
      combatStats: { parry: 0.5 },
    },
  }));
  const simulator = new CombatSimulator([], null, null, {
    maxParryAttempts: 5,
  });
  const sequence = [
    0, 0.9,
    0, 0.9,
    0, 0.9,
    0, 0.9,
    0, 0.1,
  ];
  const originalRandom = Math.random;
  Math.random = () => sequence.shift() ?? 0;
  try {
    assert.equal(simulator.checkParry(targets)?.id, 4);
  } finally {
    Math.random = originalRandom;
  }
});

test("guild trial refills every player's HP and MP between monster levels", () => {
  const players = [
    {
      hrid: "alive-low",
      combatDetails: {
        currentHitpoints: 12,
        maxHitpoints: 100,
        currentManapoints: 7,
        maxManapoints: 80,
      },
    },
    {
      hrid: "dead",
      combatDetails: {
        currentHitpoints: 0,
        maxHitpoints: 120,
        currentManapoints: 0,
        maxManapoints: 90,
      },
    },
  ];
  const simulator = new CombatSimulator(players, null, null, {
    refillPlayersOnEnemyRespawn: true,
  });
  simulator.simulationTime = 123;
  simulator.simResult.addRanOutOfManaCount(players[0], true, 100);
  simulator.refillPlayersForNextEncounter();

  assert.deepEqual(
    players.map((player) => [
      player.combatDetails.currentHitpoints,
      player.combatDetails.currentManapoints,
    ]),
    [[100, 80], [120, 90]],
  );
  assert.equal(
    simulator.simResult.playerRanOutOfManaTime["alive-low"].isOutOfMana,
    false,
  );
  assert.equal(
    simulator.simResult.playerRanOutOfManaTime["alive-low"]
      .totalTimeForOutOfMana,
    23,
  );
});

test("trial badger defaults to two monsters per floor; swarm to four; jellyfish stays at one", () => {
  assert.equal(enemiesPerEncounterForBoss({ hrid: "/guild_combat/badger" }), 2);
  assert.equal(enemiesPerEncounterForBoss({ hrid: "/guild_combat/jellyfish" }), 1);
  assert.equal(enemiesPerEncounterForBoss({ hrid: "/guild_combat/hedgehog" }), 1);
  assert.equal(enemiesPerEncounterForBoss({ hrid: "/guild_combat/swarm" }), 4);
  assert.equal(enemiesPerEncounterForBoss({ hrid: "/guild_combat/chameleon" }), 1);
  assert.equal(
    enemiesPerEncounterForBoss({ hrid: "/guild_combat/badger", enemiesPerEncounter: 3 }),
    3,
  );
  assert.equal(
    enemiesPerEncounterForBoss({
      hrid: "/guild_combat/swarm",
      enemyHrids: ["/monsters/a", "/monsters/b", "/monsters/c", "/monsters/d"],
    }),
    4,
  );
});

test("guild trial zone spawns two independently scaled badgers before advancing", () => {
  installBossDefinition({
    ...jellyfish,
    hrid: "/guild_combat/badger",
    nameZh: "试炼獾",
    combatStyle: "slash",
    damageType: "physical",
    accuracy: { slash: 462 },
    damage: { slash: 264 },
    maxHp: 330_000,
    maxMp: 330_000,
    armor: 400,
    resistance: { water: 140, nature: 140, fire: 140 },
    abilities: [
      { hrid: "/abilities/fierce_aura", level: 40, nameZh: "物理光环" },
      { hrid: "/abilities/berserk", level: 60, nameZh: "狂暴" },
      { hrid: "/abilities/maim", level: 60, nameZh: "血刃斩" },
      { hrid: "/abilities/cleave", level: 60, nameZh: "分裂斩" },
      { hrid: "/abilities/scratch", level: 60, nameZh: "爪影斩" },
    ],
  });

  const zone = new GuildTrialZone("/guild_combat/badger", 100, 10, 300, 21, 2);
  const encounter = zone.getRandomEncounter();
  assert.equal(encounter.length, 2);
  assert.equal(zone.nextLevel, 110);
  assert.equal(zone.spawnedLevels.at(-1), 100);
  assert.notEqual(encounter[0], encounter[1]);

  const expectedHp = Math.floor(
    guildTrialMonsterPoolAtLevel(330_000, 100) *
      monsterHpMultiplierForParticipants(21),
  );
  for (const monster of encounter) {
    assert.equal(monster.hrid, "/guild_combat/badger");
    assert.equal(monster.roomLevel, 100);
    assert.equal(monster.combatDetails.maxHitpoints, expectedHp);
    assert.equal(monster.combatDetails.currentHitpoints, expectedHp);
  }

  // Wave clears only after every living enemy is dead.
  const players = [
    {
      hrid: "alive",
      combatDetails: {
        currentHitpoints: 100,
        maxHitpoints: 100,
        currentManapoints: 50,
        maxManapoints: 50,
      },
    },
  ];
  const simulator = new CombatSimulator(players, zone, null, {
    enemyRespawnInterval: 0,
    maxParryAttempts: 5,
  });
  simulator.enemies = encounter;
  encounter[0].combatDetails.currentHitpoints = 0;
  assert.equal(simulator.checkEncounterEnd(), false);
  assert.equal(simulator.enemies?.length, 2);

  encounter[1].combatDetails.currentHitpoints = 0;
  assert.equal(simulator.checkEncounterEnd(), true);
  assert.equal(simulator.enemies, null);
});
