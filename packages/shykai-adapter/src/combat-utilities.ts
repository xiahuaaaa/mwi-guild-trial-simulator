export type ShykaiCombatStyle =
  | "/combat_styles/stab"
  | "/combat_styles/slash"
  | "/combat_styles/smash"
  | "/combat_styles/ranged"
  | "/combat_styles/magic";

export type ShykaiDamageType =
  | "/damage_types/physical"
  | "/damage_types/water"
  | "/damage_types/nature"
  | "/damage_types/fire";

export interface FloatRandomSource {
  nextFloat(): number;
}

export interface ShykaiCombatStatsView {
  readonly combatStyleHrid: ShykaiCombatStyle;
  readonly damageType: ShykaiDamageType;
  readonly physicalAmplify: number;
  readonly waterAmplify: number;
  readonly natureAmplify: number;
  readonly fireAmplify: number;
  readonly armorPenetration: number;
  readonly waterPenetration: number;
  readonly naturePenetration: number;
  readonly firePenetration: number;
  readonly criticalRate: number;
  readonly criticalDamage: number;
  readonly taskDamage: number;
  readonly damageTaken: number;
  readonly autoAttackDamage: number;
  readonly abilityDamage: number;
  readonly physicalThorns: number;
  readonly elementalThorns: number;
  readonly retaliation: number;
  readonly lifeSteal: number;
  readonly manaLeech: number;
}

export interface ShykaiCombatDetailsView {
  currentHitpoints: number;
  readonly maxHitpoints: number;
  readonly stabAccuracyRating: number;
  readonly slashAccuracyRating: number;
  readonly smashAccuracyRating: number;
  readonly rangedAccuracyRating: number;
  readonly magicAccuracyRating: number;
  readonly stabMaxDamage: number;
  readonly slashMaxDamage: number;
  readonly smashMaxDamage: number;
  readonly rangedMaxDamage: number;
  readonly magicMaxDamage: number;
  readonly stabEvasionRating: number;
  readonly slashEvasionRating: number;
  readonly smashEvasionRating: number;
  readonly rangedEvasionRating: number;
  readonly magicEvasionRating: number;
  readonly totalArmor: number;
  readonly totalWaterResistance: number;
  readonly totalNatureResistance: number;
  readonly totalFireResistance: number;
  readonly combatStats: ShykaiCombatStatsView;
}

export interface ShykaiCombatUnitView {
  readonly isWeakened?: boolean;
  readonly weakenPercentage?: number;
  readonly combatDetails: ShykaiCombatDetailsView;
}

export interface UpstreamBasicAttackResult {
  readonly damageDone: number;
  readonly didHit: boolean;
  readonly isCrit: boolean;
  readonly hitChance: number;
  readonly damageRoll: number;
}

export class UnsupportedUpstreamCombatPathError extends Error {
  constructor(path: string) {
    super(`Shykai adapter path is not ported yet: ${path}`);
    this.name = "UnsupportedUpstreamCombatPathError";
  }
}

/** Exact recovered hit chance formula. */
export function calculateShykaiHitChance(
  sourceAccuracyRating: number,
  targetEvasionRating: number,
): number {
  return (
    Math.pow(sourceAccuracyRating, 1.4) /
    (Math.pow(sourceAccuracyRating, 1.4) +
      Math.pow(targetEvasionRating, 1.4))
  );
}

/**
 * Exact recovered `CombatUtilities.randomInt`, with Math.random replaced by an
 * injected source and the same draw ordering.
 */
export function upstreamRandomInt(
  firstMinimum: number,
  firstMaximum: number,
  random: FloatRandomSource,
): number {
  let minimum = firstMinimum;
  let maximum = firstMaximum;
  if (maximum < minimum) {
    [minimum, maximum] = [maximum, minimum];
  }

  const minimumCeiling = Math.ceil(minimum);
  const maximumFloor = Math.floor(maximum);
  if (Math.floor(minimum) === maximumFloor) {
    return Math.floor((minimum + maximum) / 2 + nextFloat(random));
  }

  const minimumTail = -1 * (minimum - minimumCeiling);
  const maximumTail = maximum - maximumFloor;
  const balancedWeight =
    2 * minimumTail + (maximumFloor - minimumCeiling);
  const balancedAverage = (maximumFloor + minimumCeiling) / 2;
  const average = (maximum + minimum) / 2;
  const extraTailWeight =
    (balancedWeight * (average - balancedAverage)) /
    (maximumFloor + 1 - average);
  const extraTailChance = Math.abs(
    extraTailWeight / (extraTailWeight + balancedWeight),
  );

  if (nextFloat(random) < extraTailChance) {
    return maximumTail > minimumTail
      ? Math.floor(maximumFloor + 1)
      : Math.floor(minimumCeiling - 1);
  }
  if (maximumTail > minimumTail) {
    return Math.floor(
      minimum +
        nextFloat(random) *
          (maximumFloor + minimumTail - minimum + 1),
    );
  }
  return Math.floor(
    minimumCeiling -
      maximumTail +
      nextFloat(random) *
        (maximum - (minimumCeiling - maximumTail) + 1),
  );
}

/**
 * Production subset of recovered `CombatUtilities.processAttack`.
 *
 * Supported: basic auto attacks, all five styles, all four damage types,
 * weaken, critical, task/auto multipliers, penetration and mitigation.
 *
 * Unsupported mechanics fail before any random draw, so callers never receive
 * a plausible-looking partial result.
 */
export function processUpstreamBasicAttack(
  source: ShykaiCombatUnitView,
  target: ShykaiCombatUnitView,
  random: FloatRandomSource,
): UpstreamBasicAttackResult {
  assertSupportedBasicAttack(source, target);
  const combatStyle = source.combatDetails.combatStats.combatStyleHrid;
  const damageType = source.combatDetails.combatStats.damageType;
  const {
    sourceAccuracyRating: initialSourceAccuracy,
    sourceMaxDamage,
    targetEvasionRating,
  } = selectStyleValues(source, target, combatStyle);
  const {
    sourceDamageMultiplier,
    sourcePenetration,
    targetResistance,
  } = selectDamageTypeValues(source, target, damageType);

  let sourceAccuracyRating = initialSourceAccuracy;
  if (source.isWeakened) {
    sourceAccuracyRating -=
      (source.weakenPercentage ?? 0) * sourceAccuracyRating;
  }
  const hitChance = calculateShykaiHitChance(
    sourceAccuracyRating,
    targetEvasionRating,
  );
  let criticalChance =
    (combatStyle === "/combat_styles/ranged" ? 0.3 * hitChance : 0) +
    source.combatDetails.combatStats.criticalRate;

  let sourceMinimumDamage = sourceDamageMultiplier;
  let sourceMaximumDamage = sourceDamageMultiplier * sourceMaxDamage;
  let isCrit = false;
  if (nextFloat(random) < criticalChance) {
    sourceMaximumDamage *=
      1 + source.combatDetails.combatStats.criticalDamage;
    sourceMinimumDamage = sourceMaximumDamage;
    isCrit = true;
  }

  let damageRoll = upstreamRandomInt(
    sourceMinimumDamage,
    sourceMaximumDamage,
    random,
  );
  damageRoll *= 1 + source.combatDetails.combatStats.taskDamage;
  damageRoll *= 1 + target.combatDetails.combatStats.damageTaken;
  damageRoll +=
    damageRoll * source.combatDetails.combatStats.autoAttackDamage;

  let didHit = false;
  let damageDone = 0;
  if (nextFloat(random) < hitChance) {
    didHit = true;
    let penetratedTargetResistance = targetResistance;
    if (sourcePenetration > 0 && targetResistance > 0) {
      penetratedTargetResistance =
        targetResistance / (1 + sourcePenetration);
    }
    const targetDamageTakenRatio =
      penetratedTargetResistance < 0
        ? (100 - penetratedTargetResistance) / 100
        : 100 / (100 + penetratedTargetResistance);
    const mitigatedDamage = Math.ceil(
      targetDamageTakenRatio * damageRoll,
    );
    damageDone = Math.min(
      mitigatedDamage,
      target.combatDetails.currentHitpoints,
    );
    target.combatDetails.currentHitpoints -= damageDone;
  }

  return { damageDone, didHit, isCrit, hitChance, damageRoll };
}

function assertSupportedBasicAttack(
  source: ShykaiCombatUnitView,
  target: ShykaiCombatUnitView,
): void {
  const sourceStats = source.combatDetails.combatStats;
  const targetStats = target.combatDetails.combatStats;
  const thornPower =
    sourceStats.damageType === "/damage_types/physical"
      ? targetStats.physicalThorns
      : targetStats.elementalThorns;
  if (thornPower !== 0) {
    throw new UnsupportedUpstreamCombatPathError("thorns");
  }
  if (targetStats.retaliation !== 0) {
    throw new UnsupportedUpstreamCombatPathError("retaliation");
  }
  if (sourceStats.lifeSteal !== 0) {
    throw new UnsupportedUpstreamCombatPathError("lifesteal");
  }
  if (sourceStats.manaLeech !== 0) {
    throw new UnsupportedUpstreamCombatPathError("mana leech");
  }
}

function selectStyleValues(
  source: ShykaiCombatUnitView,
  target: ShykaiCombatUnitView,
  style: ShykaiCombatStyle,
): {
  sourceAccuracyRating: number;
  sourceMaxDamage: number;
  targetEvasionRating: number;
} {
  const prefix = style.slice("/combat_styles/".length);
  switch (prefix) {
    case "stab":
    case "slash":
    case "smash":
    case "ranged":
    case "magic":
      return {
        sourceAccuracyRating:
          source.combatDetails[`${prefix}AccuracyRating`],
        sourceMaxDamage: source.combatDetails[`${prefix}MaxDamage`],
        targetEvasionRating:
          target.combatDetails[`${prefix}EvasionRating`],
      };
    default:
      throw new Error(`unsupported Shykai combat style: ${style}`);
  }
}

function selectDamageTypeValues(
  source: ShykaiCombatUnitView,
  target: ShykaiCombatUnitView,
  damageType: ShykaiDamageType,
): {
  sourceDamageMultiplier: number;
  sourcePenetration: number;
  targetResistance: number;
} {
  const sourceStats = source.combatDetails.combatStats;
  switch (damageType) {
    case "/damage_types/physical":
      return {
        sourceDamageMultiplier: 1 + sourceStats.physicalAmplify,
        sourcePenetration: sourceStats.armorPenetration,
        targetResistance: target.combatDetails.totalArmor,
      };
    case "/damage_types/water":
      return {
        sourceDamageMultiplier: 1 + sourceStats.waterAmplify,
        sourcePenetration: sourceStats.waterPenetration,
        targetResistance: target.combatDetails.totalWaterResistance,
      };
    case "/damage_types/nature":
      return {
        sourceDamageMultiplier: 1 + sourceStats.natureAmplify,
        sourcePenetration: sourceStats.naturePenetration,
        targetResistance: target.combatDetails.totalNatureResistance,
      };
    case "/damage_types/fire":
      return {
        sourceDamageMultiplier: 1 + sourceStats.fireAmplify,
        sourcePenetration: sourceStats.firePenetration,
        targetResistance: target.combatDetails.totalFireResistance,
      };
  }
}

function nextFloat(random: FloatRandomSource): number {
  const value = random.nextFloat();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random source must return a value in [0, 1)");
  }
  return value;
}
