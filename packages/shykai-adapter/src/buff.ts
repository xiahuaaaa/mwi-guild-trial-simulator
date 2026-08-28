export interface ShykaiBuffDefinition {
  readonly uniqueHrid: string;
  readonly typeHrid: string;
  readonly ratioBoost: number;
  readonly ratioBoostLevelBonus: number;
  readonly flatBoost: number;
  readonly flatBoostLevelBonus: number;
  readonly duration: number;
  readonly multiplierForSkillHrid?: string | null;
  readonly multiplierPerSkillLevel?: number | null;
}

export interface ShykaiBuff {
  readonly uniqueHrid: string;
  readonly typeHrid: string;
  readonly ratioBoost: number;
  readonly flatBoost: number;
  readonly duration: number;
  readonly multiplierForSkillHrid: string;
  readonly multiplierPerSkillLevel: number;
}

/** Exact port of the recovered upstream Buff constructor. */
export function createShykaiBuff(
  definition: ShykaiBuffDefinition,
  level = 1,
): ShykaiBuff {
  if (!Number.isFinite(level)) {
    throw new RangeError("buff level must be finite");
  }
  return {
    uniqueHrid: definition.uniqueHrid,
    typeHrid: definition.typeHrid,
    ratioBoost:
      definition.ratioBoost + (level - 1) * definition.ratioBoostLevelBonus,
    flatBoost:
      definition.flatBoost + (level - 1) * definition.flatBoostLevelBonus,
    duration: definition.duration,
    multiplierForSkillHrid: definition.multiplierForSkillHrid ?? "",
    multiplierPerSkillLevel: definition.multiplierPerSkillLevel ?? 0,
  };
}
