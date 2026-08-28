import type {
  ConsumableDescriptor,
  RandomSource,
  RegenRoundingOrder,
} from "../../combat-core/src/index.ts";

export const GUILD_TRIAL_DURATION_MS = 3_600_000 as const;
export const GUILD_TRIAL_START_LEVEL = 100 as const;
export const GUILD_TRIAL_LEVEL_STEP = 10 as const;
export const GUILD_TRIAL_MAX_LEVEL = 300 as const;
export const GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT = 0.01 as const;
export const GUILD_TRIAL_PASSIVE_REGEN_FLAT_BONUS = 0.03 as const;
export const GUILD_TRIAL_MAX_BLOCK_ROLLS_PER_ATTACK = 5 as const;

export interface GuildTrialRules {
  readonly durationMs: typeof GUILD_TRIAL_DURATION_MS;
  readonly startMonsterLevel: typeof GUILD_TRIAL_START_LEVEL;
  readonly levelStepOnKill: typeof GUILD_TRIAL_LEVEL_STEP;
  readonly maxMonsterLevel: typeof GUILD_TRIAL_MAX_LEVEL;
  readonly monsterHpPerParticipant: typeof GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT;
  readonly consumables: "disabled";
  readonly passiveRegenFlatBonus: typeof GUILD_TRIAL_PASSIVE_REGEN_FLAT_BONUS;
  readonly passiveRegenRounding: RegenRoundingOrder;
  readonly maxBlockRollsPerIncomingAttack:
    typeof GUILD_TRIAL_MAX_BLOCK_ROLLS_PER_ATTACK;
  readonly spawnDelayMs: number;
  readonly transitionState: "refill-hp-mp";
}

export interface RuntimeMemberState {
  readonly memberId: string;
  readonly attackIntervalMs: number;
  readonly maxHitpoints: number;
  readonly maxManapoints: number;
  currentHitpoints: number;
  currentManapoints: number;
  readonly passiveHpRegenPerTenSeconds: number;
  readonly passiveMpRegenPerTenSeconds: number;
}

export interface MemberActionResolution {
  readonly damage: number;
  readonly manaCost: number;
}

/**
 * Adapter boundary for the recovered upstream Player/Ability/Trigger kernel.
 *
 * Canonical MemberSnapshot contracts should be normalized by an adapter into
 * this port. Guild-trial orchestration never reaches into Shykai DTO details.
 */
export interface MemberCombatPort<TMemberInput> {
  initialize(input: TMemberInput): RuntimeMemberState;
  nextAction(
    member: RuntimeMemberState,
    monster: BossState,
    random: RandomSource,
    timeMs: number,
  ): MemberActionResolution;
  listConsumables?(input: TMemberInput): readonly ConsumableDescriptor[];
}

export interface BossState {
  readonly monsterId: string;
  readonly level: number;
  readonly maxHitpoints: number;
  currentHitpoints: number;
}

/**
 * Adapter boundary for exact MWI monster construction and level scaling.
 *
 * The production implementation should wrap recovered `Monster` logic plus
 * current, versioned game data. The scenario runner only requests a level.
 */
export interface BossFactory {
  spawn(level: number): BossState;
}

export interface GuildTrialRunRequest<TMemberInput> {
  readonly seed: number;
  readonly members: readonly TMemberInput[];
  readonly rules: GuildTrialRules;
  readonly assumptionWarnings?: readonly string[];
}

export interface WaveKill {
  readonly level: number;
  readonly killedAtMs: number;
}

export interface TrialMemberRunResult {
  readonly memberId: string;
  readonly totalDamage: number;
  readonly dps: number;
  readonly damageTaken: number;
  readonly deaths: number;
  readonly oom: boolean;
  readonly oomEvents: number;
  readonly firstOomAtMs?: number;
  readonly oomDurationMs: number;
  readonly passiveHitpointsGained: number;
  readonly passiveManapointsGained: number;
}

export interface GuildTrialRunResult {
  readonly seed: number;
  readonly elapsedMs: typeof GUILD_TRIAL_DURATION_MS;
  readonly participantCount: number;
  readonly monsterHpMultiplier: number;
  readonly processedEvents: number;
  readonly lastProcessedEventAtMs?: number;
  readonly wavesCleared: number;
  readonly finalMonsterLevel: number;
  readonly finalMonsterHp: number;
  readonly finalMonsterMaxHp: number;
  readonly awaitingMonsterSpawn: boolean;
  readonly maximumLevelCleared: boolean;
  readonly combatBasePoints: number;
  readonly waveKills: readonly WaveKill[];
  readonly members: readonly TrialMemberRunResult[];
  readonly consumableUses: 0;
  readonly assumptionWarnings: readonly string[];
}

export interface AggregatedMemberResult {
  readonly memberId: string;
  readonly meanDps: number;
  readonly roundedMeanDps: number;
  readonly oom: boolean;
  readonly deaths: number;
  readonly damageTaken: number;
}

export interface GuildTrialAggregateResult {
  readonly runs: readonly GuildTrialRunResult[];
  readonly members: readonly AggregatedMemberResult[];
}
