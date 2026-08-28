export interface ShykaiMonsterAbilityDefinition {
  readonly abilityHrid: string;
  readonly level: number;
  readonly minDifficultyTier: number;
}

export interface ShykaiMonsterBaseLevels {
  readonly staminaLevel: number;
  readonly intelligenceLevel: number;
  readonly attackLevel: number;
  readonly meleeLevel: number;
  readonly defenseLevel: number;
  readonly rangedLevel: number;
  readonly magicLevel: number;
}

export interface ShykaiMonsterDefinition {
  readonly hrid: string;
  readonly experience: number;
  readonly enrageTime: number;
  readonly abilities: readonly ShykaiMonsterAbilityDefinition[];
  readonly combatDetails: ShykaiMonsterBaseLevels & {
    readonly attackInterval: number;
    readonly combatStats: Readonly<Record<string, unknown>>;
  };
}

export interface ScaledMonsterDefinition {
  readonly hrid: string;
  readonly difficultyTier: number;
  readonly roomLevel: number;
  readonly scaleFactor: number;
  readonly levels: ShykaiMonsterBaseLevels;
  readonly experience: number;
  readonly enrageTime: number;
  readonly abilities: readonly {
    readonly abilityHrid: string;
    readonly level: number;
  }[];
  readonly combatStats: Readonly<Record<string, unknown>>;
}

const LABYRINTH_BASE_ROOM_LEVEL = 100;

/**
 * Exact subset of the recovered Monster constructor/updateCombatDetails:
 * difficulty-tier level math, roomLevel/100 scaling, ability level floor, and
 * armor/elemental-resistance scaling.
 *
 * Max HP/MP, ratings and damage still require the downstream CombatUnit stat
 * recomputation and are intentionally not fabricated here.
 */
export function scaleShykaiMonster(
  definition: ShykaiMonsterDefinition,
  difficultyTier = 0,
  requestedRoomLevel = 0,
): ScaledMonsterDefinition {
  if (!Number.isSafeInteger(difficultyTier) || difficultyTier < 0) {
    throw new RangeError("difficultyTier must be a non-negative integer");
  }
  if (!Number.isFinite(requestedRoomLevel) || requestedRoomLevel < 0) {
    throw new RangeError("roomLevel must be finite and non-negative");
  }
  const roomLevel =
    requestedRoomLevel <= 0
      ? LABYRINTH_BASE_ROOM_LEVEL
      : requestedRoomLevel;
  const scaleFactor = roomLevel / LABYRINTH_BASE_ROOM_LEVEL;
  const levelMultiplier = 1 + 0.25 * difficultyTier;
  const defenseLevelMultiplier = 1 + 0.15 * difficultyTier;
  const levelBonus = 20 * difficultyTier;
  const levels: ShykaiMonsterBaseLevels = {
    staminaLevel:
      levelMultiplier *
      (definition.combatDetails.staminaLevel + levelBonus) *
      scaleFactor,
    intelligenceLevel:
      levelMultiplier *
      (definition.combatDetails.intelligenceLevel + levelBonus) *
      scaleFactor,
    attackLevel:
      levelMultiplier *
      (definition.combatDetails.attackLevel + levelBonus) *
      scaleFactor,
    meleeLevel:
      levelMultiplier *
      (definition.combatDetails.meleeLevel + levelBonus) *
      scaleFactor,
    defenseLevel:
      defenseLevelMultiplier *
      (definition.combatDetails.defenseLevel + levelBonus) *
      scaleFactor,
    rangedLevel:
      levelMultiplier *
      (definition.combatDetails.rangedLevel + levelBonus) *
      scaleFactor,
    magicLevel:
      levelMultiplier *
      (definition.combatDetails.magicLevel + levelBonus) *
      scaleFactor,
  };
  const combatStats: Record<string, unknown> = structuredClone(
    definition.combatDetails.combatStats,
  );
  for (const stat of [
    "armor",
    "waterResistance",
    "natureResistance",
    "fireResistance",
  ]) {
    const value = combatStats[stat];
    if (typeof value === "number") {
      combatStats[stat] = value * scaleFactor;
    }
  }
  if (combatStats.attackInterval === 0) {
    combatStats.attackInterval = definition.combatDetails.attackInterval;
  }
  return {
    hrid: definition.hrid,
    difficultyTier,
    roomLevel,
    scaleFactor,
    levels,
    experience:
      (1 + 0.5 * difficultyTier) *
      (definition.experience + 5 * difficultyTier),
    enrageTime: definition.enrageTime,
    abilities: definition.abilities
      .filter((ability) => ability.minDifficultyTier <= difficultyTier)
      .map((ability) => ({
        abilityHrid: ability.abilityHrid,
        level: Math.floor(ability.level * scaleFactor),
      })),
    combatStats,
  };
}
