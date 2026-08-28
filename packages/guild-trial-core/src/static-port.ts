import type { RandomSource } from "../../combat-core/src/index.ts";
import { guildTrialMonsterPoolAtLevel } from "./monster-scaling.ts";
import type {
  BossFactory,
  BossState,
  MemberActionResolution,
  MemberCombatPort,
  RuntimeMemberState,
} from "./types.ts";

export interface StaticMemberInput {
  readonly memberId: string;
  readonly attackIntervalMs: number;
  readonly minimumDamage: number;
  readonly maximumDamage: number;
  readonly manaCostPerAttack?: number;
  readonly maxHitpoints: number;
  readonly maxManapoints: number;
  readonly currentHitpoints?: number;
  readonly currentManapoints?: number;
  readonly passiveHpRegenPerTenSeconds?: number;
  readonly passiveMpRegenPerTenSeconds?: number;
  readonly consumables?: readonly {
    readonly id: string;
    readonly hitpointsRestored?: number;
    readonly manapointsRestored?: number;
  }[];
}

/**
 * Deterministic fixture port. It exists to exercise scenario invariants while
 * the upstream Shykai formula adapter is being recovered.
 */
export class StaticDamageCombatPort
  implements MemberCombatPort<StaticMemberInput>
{
  initialize(input: StaticMemberInput): RuntimeMemberState {
    validateStaticMemberInput(input);
    return {
      memberId: input.memberId,
      attackIntervalMs: input.attackIntervalMs,
      maxHitpoints: input.maxHitpoints,
      maxManapoints: input.maxManapoints,
      currentHitpoints: input.currentHitpoints ?? input.maxHitpoints,
      currentManapoints: input.currentManapoints ?? input.maxManapoints,
      passiveHpRegenPerTenSeconds:
        input.passiveHpRegenPerTenSeconds ?? 0,
      passiveMpRegenPerTenSeconds:
        input.passiveMpRegenPerTenSeconds ?? 0,
    };
  }

  nextAction(
    member: RuntimeMemberState,
    _monster: BossState,
    random: RandomSource,
    _timeMs: number,
  ): MemberActionResolution {
    const input = this.inputs.get(member.memberId);
    if (input === undefined) {
      throw new Error(`missing static member input: ${member.memberId}`);
    }
    return {
      damage: random.nextIntInclusive(
        input.minimumDamage,
        input.maximumDamage,
      ),
      manaCost: input.manaCostPerAttack ?? 0,
    };
  }

  listConsumables(input: StaticMemberInput) {
    this.inputs.set(input.memberId, input);
    return input.consumables ?? [];
  }

  register(inputs: readonly StaticMemberInput[]): void {
    this.inputs.clear();
    for (const input of inputs) {
      this.inputs.set(input.memberId, input);
    }
  }

  private readonly inputs = new Map<string, StaticMemberInput>();
}

export interface LinearBossTemplate {
  readonly monsterId: string;
  readonly level100MaxHitpoints: number;
}

/**
 * Guild-trial HP factory using the confirmed Lv.100 → higher-level pool rule:
 * floor(level100MaxHitpoints * (level + 10) / 110).
 */
export class LinearBossFactory implements BossFactory {
  private readonly template: LinearBossTemplate;

  constructor(template: LinearBossTemplate) {
    if (
      template.monsterId.trim().length === 0 ||
      !Number.isFinite(template.level100MaxHitpoints) ||
      template.level100MaxHitpoints <= 0
    ) {
      throw new Error("invalid linear boss template");
    }
    this.template = template;
  }

  spawn(level: number): BossState {
    if (!Number.isSafeInteger(level) || level <= 0) {
      throw new RangeError("boss level must be a positive safe integer");
    }
    const maxHitpoints = guildTrialMonsterPoolAtLevel(
      this.template.level100MaxHitpoints,
      level,
    );
    return {
      monsterId: this.template.monsterId,
      level,
      maxHitpoints,
      currentHitpoints: maxHitpoints,
    };
  }
}

function validateStaticMemberInput(input: StaticMemberInput): void {
  if (input.memberId.trim().length === 0) {
    throw new Error("memberId must not be empty");
  }
  for (const [name, value] of [
    ["attackIntervalMs", input.attackIntervalMs],
    ["minimumDamage", input.minimumDamage],
    ["maximumDamage", input.maximumDamage],
    ["maxHitpoints", input.maxHitpoints],
    ["maxManapoints", input.maxManapoints],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be finite and non-negative`);
    }
  }
  if (!Number.isSafeInteger(input.attackIntervalMs) || input.attackIntervalMs <= 0) {
    throw new RangeError("attackIntervalMs must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(input.minimumDamage) ||
    !Number.isSafeInteger(input.maximumDamage) ||
    input.maximumDamage < input.minimumDamage
  ) {
    throw new RangeError("damage range must be ordered safe integers");
  }
}
