/**
 * Convert a TMD weekly-trials API payload into the guild-trial monster fixture
 * used by composition labs.
 *
 * Usage:
 *   node scripts/weekly-combat-fixture.mjs <weekly-trials.json> <out.json>
 *
 * Weekly screening playbook: docs/WEEKLY_COMBAT_SCREENING.md
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { officialAbilityNameZh } from "../packages/mwi-data/official-zh-ability-names.mjs";

export const MONSTER_NAME_ZH = Object.freeze({
  "/monsters/trial_chameleon": "试炼变色龙",
  "/monsters/trial_beetle": "试炼甲虫",
  "/monsters/trial_dragonfly": "试炼蜻蜓",
  "/monsters/trial_wasp": "试炼黄蜂",
  "/monsters/trial_firefly": "试炼萤火虫",
  "/monsters/trial_badger": "试炼獾",
  "/monsters/trial_hedgehog": "试炼刺猬",
  "/monsters/trial_jellyfish": "试炼水母",
});

export const TRIAL_NAME_ZH = Object.freeze({
  "/guild_combat/chameleon": "试炼变色龙",
  "/guild_combat/swarm": "试炼虫群",
  "/guild_combat/badger": "试炼獾",
  "/guild_combat/hedgehog": "试炼刺猬",
  "/guild_combat/jellyfish": "试炼水母",
});

export const DEFAULT_FIXTURE_RULES = Object.freeze({
  durationSeconds: 3600,
  startLevel: 100,
  levelStepOnKill: 10,
  maxLevel: 300,
  monsterHpPerParticipantPercent: 1,
  monsterAttackSpeedPerParticipantPercent: 2,
  monsterCastSpeedPerParticipantPercent: 2,
  monsterAbilityHastePerParticipant: 2,
  repeatCount: 3,
  seeds: [1297565953, 1297565954, 1297565955],
  observedTeamCapacity: 52,
  consumables: "disabled",
  passiveHpMpRegenFlatBonusPercent: 3,
  maxBlockRollsPerIncomingAttack: 5,
  incompleteFloorRewardCapPercent: 50,
});

function lastHridSegment(hrid, fallback = "") {
  const text = String(hrid ?? "");
  return text.split("/").at(-1) || fallback;
}

function fixtureAbility(ability) {
  const hrid = ability.hrid ?? ability.abilityHrid;
  return {
    hrid,
    level: ability.level,
    nameZh: officialAbilityNameZh(hrid) ?? lastHridSegment(hrid, hrid),
  };
}

export function fixtureEnemyFromWeeklyMonster(monster) {
  const hrid = monster.monsterHrid ?? monster.hrid;
  return {
    hrid,
    nameZh: MONSTER_NAME_ZH[hrid] ?? monster.nameZh ?? monster.name ?? lastHridSegment(hrid),
    level: monster.level ?? 100,
    combatStyle: lastHridSegment(monster.combatStyleHrids?.[0] ?? monster.combatStyle, "magic"),
    damageType: lastHridSegment(monster.damageTypeHrid ?? monster.damageType, "physical"),
    attackIntervalSeconds: monster.attackIntervalSeconds,
    castSpeedPercent: monster.castSpeedPercent,
    abilityHaste: monster.abilityHaste,
    accuracy: { ...monster.accuracy },
    damage: { ...monster.damage },
    maxHp: monster.maxHp,
    maxMp: monster.maxMp,
    evasion: { ...monster.evasion },
    armor: monster.armor,
    resistance: { ...monster.resistance },
    tenacity: monster.tenacity,
    threat: monster.threat,
    abilities: (monster.abilities ?? []).map(fixtureAbility),
  };
}

export function fixtureBossFromWeeklyTrial(trial) {
  const enemies = (trial.monsters ?? []).map(fixtureEnemyFromWeeklyMonster);
  if (!enemies.length) {
    throw new Error(`combat trial ${trial.trialHrid} has no monsters`);
  }
  const first = enemies[0];
  const hrid = trial.trialHrid;
  return {
    hrid,
    nameZh: trial.trialName ?? TRIAL_NAME_ZH[hrid] ?? first.nameZh,
    level: first.level,
    combatStyle: first.combatStyle,
    damageType: first.damageType,
    attackIntervalSeconds: first.attackIntervalSeconds,
    castSpeedPercent: first.castSpeedPercent,
    abilityHaste: first.abilityHaste,
    accuracy: { ...first.accuracy },
    damage: { ...first.damage },
    evasion: { ...first.evasion },
    armor: first.armor,
    resistance: { ...first.resistance },
    tenacity: first.tenacity,
    threat: first.threat,
    abilities: first.abilities,
    enemiesPerEncounter: enemies.length,
    enemyHrids: enemies.map((enemy) => enemy.hrid),
    enemies,
    maxHp: enemies.reduce((sum, enemy) => sum + Number(enemy.maxHp ?? 0), 0),
    maxMp: enemies.reduce((sum, enemy) => sum + Number(enemy.maxMp ?? 0), 0),
  };
}

export function fixtureIdForWeek(weekStartAt, combatHrids) {
  const day = String(weekStartAt ?? "").slice(0, 10);
  const keys = (combatHrids ?? [])
    .map((hrid) => lastHridSegment(hrid))
    .filter(Boolean)
    .join("-");
  return `guild-trial-${day}-${keys}`;
}

export function fixtureFromWeeklyTrials(payload, options = {}) {
  const combatHrids = payload?.weeklyTrialSet?.combatHrids ?? [];
  const trials = (payload.trials ?? []).filter((trial) => trial.kind === "combat");
  if (trials.length < 2) {
    throw new Error("weekly trials payload must include two combat trials");
  }
  const ordered = combatHrids.length
    ? combatHrids.map((hrid) => {
        const trial = trials.find((row) => row.trialHrid === hrid);
        if (!trial) throw new Error(`missing combat trial ${hrid}`);
        return trial;
      })
    : trials;
  const bosses = ordered.map(fixtureBossFromWeeklyTrial);
  const teamCap = Math.max(
    ...ordered.map((trial) => Number(trial.maxParticipants ?? 0)),
    DEFAULT_FIXTURE_RULES.observedTeamCapacity,
  );
  const weekStartAt = payload.weekStartAt;
  return {
    schemaVersion: 1,
    fixtureId: options.fixtureId ?? fixtureIdForWeek(weekStartAt, combatHrids),
    observedAt: String(weekStartAt ?? "").slice(0, 10),
    source: {
      type: "weekly-trials-api-monster-panel",
      confidence: options.confidence ?? "initClientData-adudu-sync",
      weekStartAt,
      capturedAt: payload.capturedAt,
      characterId: payload.reporter?.playerId,
    },
    rules: {
      ...DEFAULT_FIXTURE_RULES,
      observedTeamCapacity: teamCap,
    },
    bosses,
  };
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error("usage: node scripts/weekly-combat-fixture.mjs <weekly-trials.json> <out.json>");
  }
  const payload = JSON.parse(await readFile(inputPath, "utf8"));
  const fixture = fixtureFromWeeklyTrials(payload);
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
  process.stdout.write(
    `wrote ${outputPath} (${fixture.fixtureId}, ${fixture.bosses.map((boss) => boss.nameZh).join("+")})\n`,
  );
}
