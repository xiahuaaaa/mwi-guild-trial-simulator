export type RuleStatus = "confirmed" | "assumed" | "unknown";

export interface RuleProvenance<T> {
  status: RuleStatus;
  value: T;
  source: string | null;
  note?: string;
}

export type CombatStyle = "stab" | "slash" | "smash" | "ranged" | "magic";
export type DamageType = "physical" | "water" | "nature" | "fire";

export interface MonsterAbility {
  hrid: string;
  level: number;
  nameZh: string;
}

export interface MonsterTemplate {
  hrid: string;
  nameZh: string;
  level: number;
  combatStyle: CombatStyle;
  damageType: DamageType;
  attackIntervalSeconds: number;
  castSpeedPercent: number;
  abilityHaste: number;
  accuracy: Partial<Record<CombatStyle, number>>;
  damage: Partial<Record<CombatStyle, number>>;
  /**
   * The game tooltip displays this value, but its upstream DTO field has not
   * yet been identified. Consumers must not silently map it to armor, damage,
   * or mitigation.
   */
  defenseDamageDisplay: RuleProvenance<number>;
  maxHp: number;
  maxMp: number;
  evasion: Record<CombatStyle, number>;
  armor: number;
  resistance: Record<"water" | "nature" | "fire", number>;
  tenacity: number;
  threat: number;
  abilities: MonsterAbility[];
  /**
   * How many identical monsters spawn each floor. Defaults to 1; Trial Badger
   * is confirmed as 2 from the in-game challenge panel.
   */
  enemiesPerEncounter?: number;
}

export type UnknownTransitionValue = "unknown";

export interface TransitionPolicy {
  spawnDelayMs: null;
  playerHp: UnknownTransitionValue | "preserve" | "full";
  playerMp: UnknownTransitionValue | "preserve" | "full";
  cooldowns: UnknownTransitionValue | "preserve" | "reset";
  buffs: UnknownTransitionValue | "preserve" | "clear";
  debuffs: UnknownTransitionValue | "preserve" | "clear";
  shields: UnknownTransitionValue | "preserve" | "clear";
  casts: UnknownTransitionValue | "preserve" | "cancel";
}

export interface CombatPolicy {
  consumables: "disabled";
  passiveRegenFlatBonus: 0.03;
  passiveRegenScope: "regen_tick_hp_mp_additive";
  passiveRegenRounding: "unknown" | "multiply-before-floor" | "multiply-after-floor";
  maxBlockRollsPerIncomingAttack: 5;
  healingMultiplier: 1 | 4 | "unknown";
  lifeStealMultiplier: 1 | 4 | "unknown";
  manaLeechMultiplier: 1 | 4 | "unknown";
  deathBehavior: "permanent" | "respawn" | "unknown";
  allDeadBehavior: "end" | "wait" | "reset" | "unknown";
  targetPolicy: "unknown" | string;
}

export interface GuildModifier {
  sourceType: "guildAura" | "shrine" | "trialRule";
  sourceId: string;
  level: number;
  targetScope: "allMembers" | "role" | "member" | "monster";
  stat: string;
  operation: "addFlat" | "addPercent" | "multiply";
  value: number;
  priority: number;
}

export interface MemberSnapshot {
  memberId: string;
  displayName: string;
  capturedAt: string;
  gameBuild: string;
  source: "uploaded" | "estimated";
  confidence: "exact" | "estimated";
  playerDto: Record<string, unknown>;
  displayedCombatStats?: Record<string, number>;
}

export interface ScalingPolicy {
  id: "labyrinth-linear-v1" | string;
  status: RuleStatus;
  source: string | null;
}

export interface GuildTrialScenario {
  schemaVersion: 1;
  gameBuild: string;
  scenarioId: string;
  durationMs: 3_600_000;
  startMonsterLevel: 100;
  levelStep: 10;
  maxMonsterLevel: 300;
  monsterHpPerParticipant: 0.01;
  repeatCount: 3;
  seeds: readonly [number, number, number];
  monster: MonsterTemplate;
  members: MemberSnapshot[];
  guildModifiers: GuildModifier[];
  scalingPolicy: ScalingPolicy;
  transitionPolicy: TransitionPolicy;
  combatPolicy: CombatPolicy;
  /**
   * Every unresolved policy path must have an explicit unknown provenance
   * entry. This lets UI and result artifacts expose rather than hide guesses.
   */
  policyProvenance: Record<string, RuleProvenance<unknown>>;
  assumptionWarnings: string[];
}

export interface WaveKill {
  level: number;
  killedAtMs: number;
}

export interface MemberRunResult {
  memberId: string;
  totalDamage: number;
  dps: number;
  damageTaken: number;
  deaths: number;
  oom: boolean;
  oomEvents: number;
  firstOomAtMs?: number;
  healingDone?: number;
  abilityCasts?: Record<string, number>;
}

export interface TrialRunResult {
  seed: number;
  elapsedMs: 3_600_000;
  wavesCleared: number;
  finalMonsterLevel: number;
  finalMonsterHp: number;
  finalMonsterMaxHp: number;
  waveKills: WaveKill[];
  members: MemberRunResult[];
}

export interface MemberAggregate {
  memberId: string;
  averageDps: number;
  anyOom: boolean;
  totalDeaths: number;
  totalDamageTaken: number;
}

export interface TrialAggregate {
  meanWavesCleared: number;
  runWaveResults: readonly [number, number, number];
  members: MemberAggregate[];
}

export interface GuildTrialSimulationResult {
  scenarioId: string;
  simulatorVersion: string;
  runs: readonly [TrialRunResult, TrialRunResult, TrialRunResult];
  aggregate: TrialAggregate;
  assumptionWarnings: string[];
}

export interface MonsterFixtureRules {
  durationSeconds: 3600;
  startLevel: 100;
  levelStepOnKill: 10;
  maxLevel: 300;
  monsterHpPerParticipantPercent: 1;
  repeatCount: 3;
  seeds: readonly [number, number, number];
  membersInCurrentAssignment: 40;
  observedTeamCapacity: 48;
  consumables: "disabled";
  passiveHpMpRegenFlatBonusPercent: 3;
  passiveRegenScope: "regen_tick_hp_mp_additive";
  maxBlockRollsPerIncomingAttack: 5;
  scalingPolicy: ScalingPolicy;
  transitionPolicy: TransitionPolicy;
  combatPolicy: CombatPolicy;
}

export interface CurrentWeekMonsterFixture {
  schemaVersion: 1;
  fixtureId: string;
  observedAt: string;
  source: {
    type: "user-supplied-game-screenshots";
    confidence: "displayed-values-confirmed";
  };
  rules: MonsterFixtureRules;
  bosses: MonsterTemplate[];
  validationNeeded: string[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: ValidationIssue[];
}

export {
  REQUIRED_UNKNOWN_POLICY_PATHS,
  validateGuildTrialScenario,
  validateMonsterFixture
} from "./runtime.mjs";
