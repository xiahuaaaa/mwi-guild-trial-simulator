import { createShykaiBuff, type ShykaiBuff, type ShykaiBuffDefinition } from "./buff.ts";
import type { ShykaiAbilityDto, ShykaiTriggerDto } from "./dto.ts";

export interface ShykaiAbilityEffectDefinition {
  readonly targetType: string;
  readonly effectType: string;
  readonly combatStyleHrid: string;
  readonly damageType: string;
  readonly baseDamageFlat: number;
  readonly baseDamageFlatLevelBonus: number;
  readonly baseDamageRatio: number;
  readonly baseDamageRatioLevelBonus: number;
  readonly bonusAccuracyRatio: number;
  readonly bonusAccuracyRatioLevelBonus: number;
  readonly damageOverTimeRatio: number;
  readonly damageOverTimeDuration: number;
  readonly armorDamageRatio: number;
  readonly armorDamageRatioLevelBonus: number;
  readonly hpDrainRatio: number;
  readonly pierceChance: number;
  readonly blindChance: number;
  readonly blindDuration: number;
  readonly silenceChance: number;
  readonly silenceDuration: number;
  readonly stunChance: number;
  readonly stunDuration: number;
  readonly spendHpRatio: number;
  readonly buffs: readonly ShykaiBuffDefinition[] | null;
}

export interface ShykaiAbilityDefinition {
  readonly hrid: string;
  readonly manaCost: number;
  readonly cooldownDuration: number;
  readonly castDuration: number;
  readonly isSpecialAbility: boolean;
  readonly abilityEffects: readonly ShykaiAbilityEffectDefinition[];
  readonly defaultCombatTriggers: readonly ShykaiTriggerDto[];
}

export interface ShykaiAbilityEffect {
  readonly targetType: string;
  readonly effectType: string;
  readonly combatStyleHrid: string;
  readonly damageType: string;
  readonly damageFlat: number;
  readonly damageRatio: number;
  readonly bonusAccuracyRatio: number;
  readonly damageOverTimeRatio: number;
  readonly damageOverTimeDuration: number;
  readonly armorDamageRatio: number;
  readonly hpDrainRatio: number;
  readonly pierceChance: number;
  readonly blindChance: number;
  readonly blindDuration: number;
  readonly silenceChance: number;
  readonly silenceDuration: number;
  readonly stunChance: number;
  readonly stunDuration: number;
  readonly spendHpRatio: number;
  readonly buffs: readonly ShykaiBuff[] | null;
}

export interface ShykaiAbility {
  readonly hrid: string;
  readonly level: number;
  readonly manaCost: number;
  readonly cooldownDuration: number;
  readonly castDuration: number;
  readonly isSpecialAbility: boolean;
  readonly abilityEffects: readonly ShykaiAbilityEffect[];
  readonly triggers: readonly ShykaiTriggerDto[];
}

/**
 * Exact level interpolation from the recovered Ability constructor. Definition
 * lookup is injected so callers must provide versioned current-game data.
 */
export function createShykaiAbility(
  dto: ShykaiAbilityDto,
  definition: ShykaiAbilityDefinition,
): ShykaiAbility {
  if (dto.hrid !== definition.hrid) {
    throw new Error(`ability definition mismatch for ${dto.hrid}`);
  }
  const level = dto.level;
  const abilityEffects = definition.abilityEffects.map((effect) => ({
    targetType: effect.targetType,
    effectType: effect.effectType,
    combatStyleHrid: effect.combatStyleHrid,
    damageType: effect.damageType,
    damageFlat:
      effect.baseDamageFlat +
      (level - 1) * effect.baseDamageFlatLevelBonus,
    damageRatio:
      effect.baseDamageRatio +
      (level - 1) * effect.baseDamageRatioLevelBonus,
    bonusAccuracyRatio:
      effect.bonusAccuracyRatio +
      (level - 1) * effect.bonusAccuracyRatioLevelBonus,
    damageOverTimeRatio: effect.damageOverTimeRatio,
    damageOverTimeDuration: effect.damageOverTimeDuration,
    armorDamageRatio:
      effect.armorDamageRatio +
      (level - 1) * effect.armorDamageRatioLevelBonus,
    hpDrainRatio: effect.hpDrainRatio,
    pierceChance: effect.pierceChance,
    blindChance: effect.blindChance,
    blindDuration: effect.blindDuration,
    silenceChance: effect.silenceChance,
    silenceDuration: effect.silenceDuration,
    stunChance: effect.stunChance,
    stunDuration: effect.stunDuration,
    spendHpRatio: effect.spendHpRatio,
    buffs:
      effect.buffs === null
        ? null
        : effect.buffs.map((buff) => createShykaiBuff(buff, level)),
  }));
  return {
    hrid: dto.hrid,
    level,
    manaCost: definition.manaCost,
    cooldownDuration: definition.cooldownDuration,
    castDuration: definition.castDuration,
    isSpecialAbility: definition.isSpecialAbility,
    abilityEffects,
    triggers:
      dto.triggers.length > 0
        ? structuredClone(dto.triggers)
        : structuredClone(definition.defaultCombatTriggers),
  };
}
