import { DisabledConsumablePolicy, PassiveRegenPolicy } from "../../combat-core/src/index.ts";
import {
  GUILD_TRIAL_DURATION_MS,
  GUILD_TRIAL_LEVEL_STEP,
  GUILD_TRIAL_MAX_BLOCK_ROLLS_PER_ATTACK,
  GUILD_TRIAL_MAX_LEVEL,
  GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT,
  GUILD_TRIAL_PASSIVE_REGEN_FLAT_BONUS,
  GUILD_TRIAL_START_LEVEL,
  type GuildTrialRules,
} from "./types.ts";

export interface TransitionAssumptions {
  readonly spawnDelayMs: number;
  readonly transitionState: "refill-hp-mp";
  readonly passiveRegenRounding: GuildTrialRules["passiveRegenRounding"];
}

export function createGuildTrialRules(
  assumptions: TransitionAssumptions,
): GuildTrialRules {
  if (
    !Number.isSafeInteger(assumptions.spawnDelayMs) ||
    assumptions.spawnDelayMs < 0
  ) {
    throw new RangeError("spawnDelayMs must be a non-negative safe integer");
  }
  return {
    durationMs: GUILD_TRIAL_DURATION_MS,
    startMonsterLevel: GUILD_TRIAL_START_LEVEL,
    levelStepOnKill: GUILD_TRIAL_LEVEL_STEP,
    maxMonsterLevel: GUILD_TRIAL_MAX_LEVEL,
    monsterHpPerParticipant: GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT,
    consumables: "disabled",
    passiveRegenFlatBonus: GUILD_TRIAL_PASSIVE_REGEN_FLAT_BONUS,
    passiveRegenRounding: assumptions.passiveRegenRounding,
    maxBlockRollsPerIncomingAttack:
      GUILD_TRIAL_MAX_BLOCK_ROLLS_PER_ATTACK,
    spawnDelayMs: assumptions.spawnDelayMs,
    transitionState: assumptions.transitionState,
  };
}

export function validateGuildTrialRules(rules: GuildTrialRules): void {
  if (rules.durationMs !== GUILD_TRIAL_DURATION_MS) {
    throw new Error("guild trial duration must be exactly 3,600,000 ms");
  }
  if (rules.startMonsterLevel !== GUILD_TRIAL_START_LEVEL) {
    throw new Error("guild trial start level must be 100");
  }
  if (rules.levelStepOnKill !== GUILD_TRIAL_LEVEL_STEP) {
    throw new Error("guild trial level step must be 10");
  }
  if (rules.maxMonsterLevel !== GUILD_TRIAL_MAX_LEVEL) {
    throw new Error("guild trial maximum monster level must be 300");
  }
  if (
    rules.monsterHpPerParticipant !==
    GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT
  ) {
    throw new Error("guild trial monster HP must increase 1% per participant");
  }
  if (rules.consumables !== "disabled") {
    throw new Error("guild trial consumables must be disabled");
  }
  if (
    rules.passiveRegenFlatBonus !==
    GUILD_TRIAL_PASSIVE_REGEN_FLAT_BONUS
  ) {
    throw new Error("guild trial passive HP/MP regen bonus must be +3%");
  }
  if (
    rules.maxBlockRollsPerIncomingAttack !==
    GUILD_TRIAL_MAX_BLOCK_ROLLS_PER_ATTACK
  ) {
    throw new Error("guild trial block rolls per incoming attack must cap at 5");
  }
  if (!Number.isSafeInteger(rules.spawnDelayMs) || rules.spawnDelayMs < 0) {
    throw new Error("guild trial spawn delay must be a non-negative integer");
  }
  if (rules.transitionState !== "refill-hp-mp") {
    throw new Error("guild trial must refill player HP and MP between levels");
  }
}

export function createGuildTrialCombatPolicies(rules: GuildTrialRules): {
  readonly consumables: DisabledConsumablePolicy;
  readonly passiveRegen: PassiveRegenPolicy;
} {
  validateGuildTrialRules(rules);
  return {
    consumables: new DisabledConsumablePolicy(),
    passiveRegen: new PassiveRegenPolicy({
      flatBonus: rules.passiveRegenFlatBonus,
      roundingOrder: rules.passiveRegenRounding,
    }),
  };
}
