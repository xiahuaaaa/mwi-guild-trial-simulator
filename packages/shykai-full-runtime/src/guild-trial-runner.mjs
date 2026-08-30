import CombatSimulator from "../generated/src/combatsimulator/combatSimulator.js";
import Monster from "../generated/src/combatsimulator/monster.js";
import Player from "../generated/src/combatsimulator/player.js";
import abilityDetailMap from "../generated/src/combatsimulator/data/abilityDetailMap.json.js";
import combatMonsterDetailMap from "../generated/src/combatsimulator/data/combatMonsterDetailMap.json.js";
import itemDetailMap from "../generated/src/combatsimulator/data/itemDetailMap.json.js";
import {
  COMBAT_RULES_VERSION,
  PERMANENT_BUFFS_ENABLED,
} from "./combat-rules-version.mjs";

const ONE_SECOND = 1e9;

export { COMBAT_RULES_VERSION, PERMANENT_BUFFS_ENABLED };

/**
 * Confirmed encounter widths from the in-game guild-trial challenge panel.
 * Trial Badger shows two identical monsters per floor (2026-07-31 screenshot).
 * Trial Swarm shows four distinct insects per floor (2026-08-07 weekly panel);
 * prefer boss.enemies / boss.enemyHrids for heterogeneous spawns.
 * Unlisted combat trials default to a single monster until observed otherwise.
 */
export const GUILD_TRIAL_ENEMIES_PER_ENCOUNTER = Object.freeze({
  "/guild_combat/badger": 2,
  "/guild_combat/chameleon": 1,
  "/guild_combat/jellyfish": 1,
  "/guild_combat/hedgehog": 1,
  "/guild_combat/swarm": 4,
});

/**
 * Resolve the per-floor enemy hrids for a boss fixture.
 * Heterogeneous encounters (swarm) should list distinct monster hrids via
 * `enemies` or `enemyHrids`; otherwise N copies of boss.hrid are used.
 */
export function encounterEnemyHridsForBoss(boss) {
  if (Array.isArray(boss?.enemyHrids) && boss.enemyHrids.length >= 1) {
    return boss.enemyHrids.map(String);
  }
  if (Array.isArray(boss?.enemies) && boss.enemies.length >= 1) {
    return boss.enemies.map((enemy) => String(enemy.hrid));
  }
  const count = enemiesPerEncounterForBoss(boss);
  const hrid = typeof boss === "string" ? boss : boss?.hrid;
  if (!hrid) throw new Error("boss.hrid is required");
  return Array.from({ length: count }, () => hrid);
}

export function enemiesPerEncounterForBoss(boss) {
  if (Array.isArray(boss?.enemyHrids) && boss.enemyHrids.length >= 1) {
    return boss.enemyHrids.length;
  }
  if (Array.isArray(boss?.enemies) && boss.enemies.length >= 1) {
    return boss.enemies.length;
  }
  const override = boss?.enemiesPerEncounter;
  if (Number.isSafeInteger(override) && override >= 1) {
    return override;
  }
  const hrid = typeof boss === "string" ? boss : boss?.hrid;
  return GUILD_TRIAL_ENEMIES_PER_ENCOUNTER[hrid] ?? 1;
}

export async function runGuildTrial({
  snapshot,
  boss,
  members,
  seed,
  durationSeconds = 3600,
  startLevel = 100,
  levelStep = 10,
  maxLevel = 300,
  spawnDelaySeconds = 0,
  passiveRegenFlatBonus = 0.03,
}) {
  if (!Array.isArray(members) || members.length < 1) {
    throw new Error("Guild Trial requires at least one participant");
  }
  installBossDefinition(boss);
  const players = members.map((member, index) =>
    createPlayer(snapshot, member, index),
  );
  const zone = new GuildTrialZone(
    boss.hrid,
    startLevel,
    levelStep,
    maxLevel,
    members.length,
    encounterEnemyHridsForBoss(boss),
  );
  const simulator = new CombatSimulator(players, zone, null, {
    enemyRespawnInterval: spawnDelaySeconds * ONE_SECOND,
    passiveRegenFlatBonus,
    maxParryAttempts: 5,
    refillPlayersOnEnemyRespawn: true,
  });
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const simResult = await simulator.simulate(durationSeconds * ONE_SECOND);
    return summarizeRun({
      simulator,
      simResult,
      players,
      zone,
      seed,
      durationSeconds,
    });
  } finally {
    Math.random = originalRandom;
  }
}

export function buildPlayerMember({
  build,
  abilities,
  label,
  role = "dps",
  memberId,
  snapshot,
}) {
  return {
    label: label ?? build.name,
    role,
    build,
    abilities,
    memberId,
    snapshot,
  };
}

import { resolveLearnedAbilityLevel } from "./ability-level-defaults.mjs";

export function defaultAbility(abilityHrid, learnedAbilities) {
  const level = resolveLearnedAbilityLevel(abilityHrid, learnedAbilities);
  const detail = abilityDetailMap[abilityHrid];
  if (!detail) throw new Error(`Unknown Shykai ability: ${abilityHrid}`);
  if (!Number.isFinite(level)) {
    throw new Error(`Member has not learned ability: ${abilityHrid}`);
  }
  return {
    abilityHrid,
    level,
    triggers: structuredClone(detail.defaultCombatTriggers ?? []),
  };
}

export function abilityDetail(abilityHrid) {
  return abilityDetailMap[abilityHrid] ?? null;
}

export function equipmentDetail(itemHrid) {
  return itemDetailMap[itemHrid] ?? null;
}

export class GuildTrialZone {
  constructor(
    bossHrid,
    startLevel,
    levelStep,
    maxLevel,
    participantCount,
    enemiesPerEncounterOrHrids = 1,
  ) {
    const enemyHrids = Array.isArray(enemiesPerEncounterOrHrids)
      ? enemiesPerEncounterOrHrids.map(String)
      : Array.from({ length: enemiesPerEncounterOrHrids }, () => bossHrid);
    if (
      !Array.isArray(enemyHrids) ||
      enemyHrids.length < 1 ||
      enemyHrids.some((hrid) => !hrid)
    ) {
      throw new RangeError(
        "enemiesPerEncounterOrHrids must be a safe integer >= 1 or a non-empty hrid list",
      );
    }
    if (
      !Array.isArray(enemiesPerEncounterOrHrids) &&
      (!Number.isSafeInteger(enemiesPerEncounterOrHrids) ||
        enemiesPerEncounterOrHrids < 1)
    ) {
      throw new RangeError("enemiesPerEncounter must be a safe integer >= 1");
    }
    this.hrid = bossHrid;
    this.isGuildTrial = true;
    this.difficultyTier = 0;
    this.isDungeon = false;
    this.buffs = [];
    this.encountersKilled = 1;
    this.bossHrid = bossHrid;
    this.nextLevel = startLevel;
    this.levelStep = levelStep;
    this.maxLevel = maxLevel;
    this.participantCount = participantCount;
    this.enemyHrids = enemyHrids;
    this.enemiesPerEncounter = enemyHrids.length;
    this.monsterHpMultiplier = monsterHpMultiplierForParticipants(participantCount);
    this.monsterAttackSpeedBonus =
      monsterAttackSpeedBonusForParticipants(participantCount);
    this.monsterCastSpeedBonus =
      GUILD_TRIAL_MONSTER_CAST_SPEED_PER_PARTICIPANT * participantCount;
    this.monsterAbilityHasteBonus =
      GUILD_TRIAL_MONSTER_ABILITY_HASTE_PER_PARTICIPANT * participantCount;
    this.spawnedLevels = [];
  }

  getRandomEncounter() {
    const level = this.nextLevel;
    if (level > this.maxLevel) {
      throw new Error("Guild Trial attempted to spawn above level 300");
    }
    this.nextLevel += this.levelStep;
    this.encountersKilled += 1;
    this.spawnedLevels.push(level);
    // Upstream CombatSimulator advances the floor only when every living
    // enemy reaches 0 HP, so multi-monster floors (e.g. two badgers or four
    // swarm insects) must all die before the next level spawns.
    return this.enemyHrids.map((enemyHrid, index) => {
      const monster = new Monster(enemyHrid, 0, level);
      applyGuildTrialMonsterHpScaling(monster, this.participantCount);
      const displayName = combatMonsterDetailMap[enemyHrid]?.name ?? enemyHrid;
      monster.uniqueHrid = `${enemyHrid}#${index + 1}`;
      monster.hrid = monster.uniqueHrid;
      monster.displayName = `${displayName} #${index + 1}`;
      return monster;
    });
  }

  failWave() {
    // Guild Trial keeps the current boss after a party wipe. Individual
    // respawns are handled by the upstream event engine.
  }

  isComplete() {
    return this.nextLevel > this.maxLevel;
  }
}

/** 2026-08-14 patch: each participant also speeds the monster up. */
export const GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT = 0.01;
export const GUILD_TRIAL_MONSTER_ATTACK_SPEED_PER_PARTICIPANT = 0.02;
export const GUILD_TRIAL_MONSTER_CAST_SPEED_PER_PARTICIPANT = 0.02;
export const GUILD_TRIAL_MONSTER_ABILITY_HASTE_PER_PARTICIPANT = 2;

export function monsterHpMultiplierForParticipants(participantCount) {
  if (!Number.isSafeInteger(participantCount) || participantCount < 1) {
    throw new RangeError("participantCount must be a positive safe integer");
  }
  return 1 + GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT * participantCount;
}

export function monsterAttackSpeedBonusForParticipants(participantCount) {
  if (!Number.isSafeInteger(participantCount) || participantCount < 1) {
    throw new RangeError("participantCount must be a positive safe integer");
  }
  return GUILD_TRIAL_MONSTER_ATTACK_SPEED_PER_PARTICIPANT * participantCount;
}

/**
 * Confirmed 2026-07-28 from live 试炼水母 floor 15 (Lv.240) with 47 players:
 * unscaled HP/MP = 1,125,000 from Lv.100 pools of 495,000, i.e.
 * floor(level100Pool * (level + 10) / 110). Labyrinth's roomLevel/100 multiplier
 * overstates higher-floor HP/MP and must not drive guild-trial pools.
 */
export const GUILD_TRIAL_MONSTER_POOL_DENOMINATOR = 110;

export function guildTrialMonsterPoolAtLevel(level100Pool, level) {
  if (!Number.isFinite(level100Pool) || level100Pool < 0) {
    throw new RangeError("level100Pool must be a non-negative finite number");
  }
  if (!Number.isSafeInteger(level) || level < 100) {
    throw new RangeError("monster level must be a safe integer >= 100");
  }
  return Math.floor(
    (level100Pool * (level + 10)) / GUILD_TRIAL_MONSTER_POOL_DENOMINATOR,
  );
}

function level100PoolsFromDefinition(hrid) {
  const gameMonster = combatMonsterDetailMap[hrid];
  if (!gameMonster) {
    throw new Error(`No guild-trial monster definition installed for ${hrid}`);
  }
  const stamina = Number(gameMonster.combatDetails.staminaLevel);
  const intelligence = Number(gameMonster.combatDetails.intelligenceLevel);
  const flatHp = Number(gameMonster.combatDetails.combatStats?.maxHitpoints ?? 0);
  const flatMp = Number(gameMonster.combatDetails.combatStats?.maxManapoints ?? 0);
  if (![stamina, intelligence, flatHp, flatMp].every(Number.isFinite)) {
    throw new Error(`Invalid level-100 pools for ${hrid}`);
  }
  return {
    maxHitpoints: Math.floor(10 * (10 + stamina) + flatHp),
    maxManapoints: Math.floor(10 * (10 + intelligence) + flatMp),
  };
}

export function applyGuildTrialMonsterHpScaling(monster, participantCount) {
  const multiplier = monsterHpMultiplierForParticipants(participantCount);
  const attackSpeedBonus = monsterAttackSpeedBonusForParticipants(participantCount);
  const castSpeedBonus =
    GUILD_TRIAL_MONSTER_CAST_SPEED_PER_PARTICIPANT * participantCount;
  const abilityHasteBonus =
    GUILD_TRIAL_MONSTER_ABILITY_HASTE_PER_PARTICIPANT * participantCount;
  const updateCombatDetails = monster.updateCombatDetails.bind(monster);
  monster.updateCombatDetails = () => {
    updateCombatDetails();
    const pools = level100PoolsFromDefinition(monster.dataHrid ?? monster.hrid);
    const level = Number(monster.roomLevel);
    const unscaledHp = guildTrialMonsterPoolAtLevel(pools.maxHitpoints, level);
    const unscaledMp = guildTrialMonsterPoolAtLevel(pools.maxManapoints, level);
    monster.combatDetails.maxHitpoints = Math.floor(unscaledHp * multiplier);
    monster.combatDetails.maxManapoints = unscaledMp;
    const stats = monster.combatDetails.combatStats;
    if (stats) {
      // MWI applies attack-speed buckets as separate divisors:
      // interval /= (1 + attackLevel/2000) /= (1 + attackSpeed).
      // Participant +2% is an extra attackSpeed bucket on the displayed interval.
      stats.attackInterval /= 1 + attackSpeedBonus;
      stats.castSpeed = (Number(stats.castSpeed) || 0) + castSpeedBonus;
      stats.abilityHaste = (Number(stats.abilityHaste) || 0) + abilityHasteBonus;
    }
  };
  monster.updateCombatDetails();
  monster.combatDetails.currentHitpoints = monster.combatDetails.maxHitpoints;
  monster.combatDetails.currentManapoints = monster.combatDetails.maxManapoints;
  return monster;
}

export const applyGuildTrialMonsterScaling = applyGuildTrialMonsterHpScaling;

function createPlayer(snapshot, member, index) {
  const memberSnapshot = member.snapshot ?? snapshot;
  const equipment = {};
  for (const entry of member.build.equipment) {
    const definition = itemDetailMap[entry.itemHrid];
    const type = definition?.equipmentDetail?.type;
    if (!type) throw new Error(`Not an equipment item: ${entry.itemHrid}`);
    equipment[type] = {
      hrid: entry.itemHrid,
      enhancementLevel: entry.enhancementLevel,
    };
  }
  const abilities = member.abilities.map((entry) => ({
    hrid: entry.abilityHrid,
    level: entry.level,
    triggers: structuredClone(
      entry.triggers ??
        abilityDetailMap[entry.abilityHrid]?.defaultCombatTriggers ??
        [],
    ),
  }));
  const dto = {
    hrid:
      member.memberId ??
      `member_${String(index + 1).padStart(2, "0")}`,
    staminaLevel: skill(memberSnapshot, "stamina"),
    intelligenceLevel: skill(memberSnapshot, "intelligence"),
    attackLevel: skill(memberSnapshot, "attack"),
    defenseLevel: skill(memberSnapshot, "defense"),
    meleeLevel: skill(memberSnapshot, "melee"),
    rangedLevel: skill(memberSnapshot, "ranged"),
    magicLevel: skill(memberSnapshot, "magic"),
    equipment,
    food: [],
    drinks: [],
    abilities,
    houseRooms: {},
    achievements: {},
    debuffOnLevelGap: 0,
  };
  const player = Player.createFromDTO(dto);
  player.cloneLabel = member.label;
  player.cloneRole = member.role;
  player.zoneBuffs = [];
  player.extraBuffs = [];
  return player;
}

function skill(snapshot, name) {
  const level = snapshot.skills[`/skills/${name}`];
  if (!Number.isFinite(level)) throw new Error(`Missing skill level: ${name}`);
  return level;
}

function installBossDefinition(boss) {
  if (Array.isArray(boss?.enemies) && boss.enemies.length >= 1) {
    for (const enemy of boss.enemies) {
      installMonsterDefinition(enemy);
    }
    return;
  }
  installMonsterDefinition(boss);
}

function installMonsterDefinition(monster) {
  const lowestEvasion = Math.min(...Object.values(monster.evasion));
  const defenseLevel = Math.max(0, lowestEvasion - 10);
  const evasionRatio = (value) =>
    value / (10 + defenseLevel) - 1;
  const style = monster.combatStyle ?? "magic";
  const primaryAccuracy =
    monster.accuracy?.[style] ??
    monster.accuracy?.magic ??
    monster.accuracy?.slash ??
    monster.accuracy?.stab ??
    monster.accuracy?.smash ??
    monster.accuracy?.ranged ??
    10;
  const primaryDamage =
    monster.damage?.[style] ??
    monster.damage?.magic ??
    monster.damage?.slash ??
    monster.damage?.stab ??
    monster.damage?.smash ??
    monster.damage?.ranged ??
    10;
  const attackLevel = Math.max(0, primaryAccuracy - 10);
  const magicLevel = Math.max(0, primaryDamage - 10);
  const staminaLevel = Math.max(0, monster.maxHp / 10 - 10);
  const intelligenceLevel = Math.max(0, monster.maxMp / 10 - 10);
  const defenseContribution = 0.2 * defenseLevel;
  combatMonsterDetailMap[monster.hrid] = {
    hrid: monster.hrid,
    name: monster.nameZh ?? monster.name ?? monster.hrid,
    experience: 0,
    enrageTime: 10 * 60 * ONE_SECOND,
    abilities: monster.abilities.map((ability) => ({
      abilityHrid: ability.hrid ?? ability.abilityHrid,
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
        combatStyleHrids: [`/combat_styles/${monster.combatStyle}`],
        damageType: `/damage_types/${monster.damageType}`,
        attackInterval:
          monster.attackIntervalSeconds *
          ONE_SECOND *
          (1 + attackLevel / 2000),
        castSpeed: monster.castSpeedPercent / 100 - attackLevel / 2000,
        abilityHaste: Number(monster.abilityHaste) || 0,
        magicAccuracy: 0,
        magicDamage: 0,
        stabEvasion: evasionRatio(monster.evasion.stab),
        slashEvasion: evasionRatio(monster.evasion.slash),
        smashEvasion: evasionRatio(monster.evasion.smash),
        rangedEvasion: evasionRatio(monster.evasion.ranged),
        magicEvasion: evasionRatio(monster.evasion.magic),
        armor: monster.armor - defenseContribution,
        waterResistance: monster.resistance.water - defenseContribution,
        natureResistance: monster.resistance.nature - defenseContribution,
        fireResistance: monster.resistance.fire - defenseContribution,
        maxHitpoints: 0,
        maxManapoints: 0,
        tenacity: monster.tenacity,
        threat: 0,
      },
    },
  };
}

function summarizeRun({
  simulator,
  simResult,
  players,
  zone,
  seed,
  durationSeconds,
}) {
  const livingEnemies = (simulator.enemies ?? []).filter(
    (enemy) => enemy.combatDetails.currentHitpoints > 0,
  );
  const currentBoss = livingEnemies[0] ?? null;
  const members = players.map((player) => {
    const damageDone = sumHits(simResult.attacks[player.hrid]);
    const damageTaken = sumTargetHits(simResult.attacks, player.hrid);
    const oomState = simResult.playerRanOutOfManaTime[player.hrid];
    const simulatedTime = Number(simResult.simulatedTime ?? 0);
    const oomDurationNanoseconds =
      Number(oomState?.totalTimeForOutOfMana ?? 0) +
      (oomState?.isOutOfMana
        ? Math.max(
            0,
            simulatedTime - Number(oomState.startTimeForOutOfMana ?? 0),
          )
        : 0);
    const healingReceived = sumValues(simResult.hitpointsGained[player.hrid], [
      "regen",
      "lifesteal",
    ]);
    const healingDone = sumValues(simResult.healingDone?.[player.hrid]);
    const abilityDamage = abilityDamageBreakdown(
      simResult.attacks,
      player.hrid,
    );
    const passiveRegen =
      simResult.hitpointsGained[player.hrid]?.regen ?? 0;
    const lifesteal =
      simResult.hitpointsGained[player.hrid]?.lifesteal ?? 0;
    return {
      memberId: player.hrid,
      label: player.cloneLabel,
      role: player.cloneRole,
      damageDone,
      dps: damageDone / durationSeconds,
      damageTaken,
      healing: healingReceived,
      healingReceived,
      healingDone,
      abilityDamage,
      passiveRegen,
      lifesteal,
      manaRestored: sumValues(simResult.manapointsGained[player.hrid]),
      passiveManaRegen:
        simResult.manapointsGained[player.hrid]?.regen ?? 0,
      manaSpent: [...player.abilityManaCosts.values()].reduce(
        (total, value) => total + Number(value ?? 0),
        0,
      ),
      deaths: simResult.deaths[player.hrid] ?? 0,
      ranOutOfMana: simResult.playerRanOutOfMana[player.hrid] ?? false,
      oomDurationSeconds: oomDurationNanoseconds / ONE_SECOND,
      maxMp: player.combatDetails.maxManapoints,
      finalHp: player.combatDetails.currentHitpoints,
      finalMp: player.combatDetails.currentManapoints,
    };
  });
  const teamDamage = members.reduce(
    (total, member) => total + member.damageDone,
    0,
  );
  return {
    seed,
    durationSeconds,
    combatRulesVersion: COMBAT_RULES_VERSION,
    permanentBuffsEnabled: PERMANENT_BUFFS_ENABLED,
    stopReason: simResult.stopReason ?? simulator.stopReason,
    endedAt: simResult.endedAt ?? simulator.endedAt,
    simulatedTime: simResult.simulatedTime,
    wavesCleared: simResult.encounters,
    enemiesPerEncounter: zone.enemiesPerEncounter,
    finalMonsterLevel:
      currentBoss?.roomLevel ??
      zone.spawnedLevels.at(-1) ??
      zone.nextLevel,
    finalMonsterHp: livingEnemies.reduce(
      (total, enemy) => total + Number(enemy.combatDetails.currentHitpoints ?? 0),
      0,
    ),
    finalMonsterMaxHp: livingEnemies.reduce(
      (total, enemy) => total + Number(enemy.combatDetails.maxHitpoints ?? 0),
      0,
    ),
    livingEnemyCount: livingEnemies.length,
    livingEnemies: livingEnemies.map((enemy) => ({
      uniqueHrid: enemy.uniqueHrid ?? enemy.hrid,
      dataHrid: enemy.dataHrid ?? enemy.hrid,
      displayName: enemy.displayName ?? enemy.hrid,
      currentHitpoints: enemy.combatDetails.currentHitpoints,
      maxHitpoints: enemy.combatDetails.maxHitpoints,
    })),
    participantCount: zone.participantCount,
    monsterHpMultiplier: zone.monsterHpMultiplier,
    monsterAttackSpeedBonus: zone.monsterAttackSpeedBonus,
    monsterCastSpeedBonus: zone.monsterCastSpeedBonus,
    monsterAbilityHasteBonus: zone.monsterAbilityHasteBonus,
    maximumLevelCleared:
      simResult.encounters >=
      Math.floor((zone.maxLevel - zone.spawnedLevels[0]) / zone.levelStep) + 1,
    teamDamage,
    teamDps: teamDamage / durationSeconds,
    totalDeaths: members.reduce((total, member) => total + member.deaths, 0),
    oomMembers: members.filter((member) => member.ranOutOfMana).length,
    members,
    upstream: {
      encounters: simResult.encounters,
      simulatedTimeNanoseconds: simResult.simulatedTime,
      attacks: simResult.attacks,
      hitpointsGained: simResult.hitpointsGained,
      manapointsGained: simResult.manapointsGained,
    },
  };
}

function sumHits(sourceTargets) {
  if (!sourceTargets) return 0;
  let total = 0;
  for (const abilities of Object.values(sourceTargets)) {
    for (const hits of Object.values(abilities)) {
      for (const [hit, count] of Object.entries(hits)) {
        const damage = Number(hit);
        if (Number.isFinite(damage)) total += damage * count;
      }
    }
  }
  return total;
}

function abilityDamageBreakdown(attacks, playerHrid) {
  const byAbility = {};
  const targets = attacks?.[playerHrid];
  if (!targets) return byAbility;
  for (const abilities of Object.values(targets)) {
    for (const [abilityHrid, hits] of Object.entries(abilities)) {
      let total = 0;
      for (const [hit, count] of Object.entries(hits)) {
        const damage = Number(hit);
        if (Number.isFinite(damage)) total += damage * count;
      }
      if (total > 0) {
        byAbility[abilityHrid] = (byAbility[abilityHrid] ?? 0) + total;
      }
    }
  }
  return byAbility;
}

function sumTargetHits(attacks, targetHrid) {
  let total = 0;
  for (const targets of Object.values(attacks)) {
    const abilities = targets[targetHrid];
    if (!abilities) continue;
    for (const hits of Object.values(abilities)) {
      for (const [hit, count] of Object.entries(hits)) {
        const damage = Number(hit);
        if (Number.isFinite(damage)) total += damage * count;
      }
    }
  }
  return total;
}

function sumValues(row, excluded = []) {
  if (!row) return 0;
  const excludedSet = new Set(excluded);
  return Object.entries(row).reduce(
    (total, [key, value]) =>
      excludedSet.has(key) ? total : total + Number(value ?? 0),
    0,
  );
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
