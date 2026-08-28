export function combatTrialBasePoints(levelsCleared: number): number {
  validateLevelsCleared(levelsCleared);
  return levelsCleared === 0 ? 0 : 400 + (levelsCleared - 1) * 200;
}

export function skillingTrialBasePoints(levelsCleared: number): number {
  validateLevelsCleared(levelsCleared);
  return levelsCleared === 0 ? 0 : 200 + (levelsCleared - 1) * 100;
}

/** 2026-08-14 patch: incomplete floors pay progress%, capped at 50%. */
export const INCOMPLETE_FLOOR_REWARD_CAP = 0.5 as const;

export function incompleteFloorRewardFraction(progressRatio: number): number {
  if (!Number.isFinite(progressRatio)) {
    throw new RangeError("progressRatio must be finite");
  }
  return Math.min(Math.max(progressRatio, 0), INCOMPLETE_FLOOR_REWARD_CAP);
}

function incompleteFloorBasePoints(
  levelsCleared: number,
  firstFloorPoints: number,
  laterFloorPoints: number,
): number {
  validateLevelsCleared(levelsCleared);
  return levelsCleared === 0 ? firstFloorPoints : laterFloorPoints;
}

/**
 * Extra base points for the unfinished current floor.
 * Formula assumed from the 2026-08-14 patch text; not yet screenshot-calibrated.
 */
export function combatTrialIncompleteFloorPoints(
  levelsCleared: number,
  progressRatio: number,
): number {
  return Math.floor(
    incompleteFloorBasePoints(levelsCleared, 400, 200) *
      incompleteFloorRewardFraction(progressRatio),
  );
}

export function skillingTrialIncompleteFloorPoints(
  levelsCleared: number,
  progressRatio: number,
): number {
  return Math.floor(
    incompleteFloorBasePoints(levelsCleared, 200, 100) *
      incompleteFloorRewardFraction(progressRatio),
  );
}

export function guildPointsFromBase(
  basePoints: number,
  buildersHallBonus: number,
): number {
  validateNonNegative(basePoints, "basePoints");
  validateNonNegative(buildersHallBonus, "buildersHallBonus");
  return basePoints * (1 + buildersHallBonus);
}

export function eligibleMemberTokens(
  totalBasePoints: number,
  vaultBonus: number,
): number {
  validateNonNegative(totalBasePoints, "totalBasePoints");
  validateNonNegative(vaultBonus, "vaultBonus");
  return 0.5 * totalBasePoints * (1 + vaultBonus);
}

export function participantRewardTokens(eligibleTokens: number): number {
  validateNonNegative(eligibleTokens, "eligibleTokens");
  return eligibleTokens * 0.5;
}

function validateLevelsCleared(levelsCleared: number): void {
  if (!Number.isSafeInteger(levelsCleared) || levelsCleared < 0) {
    throw new RangeError("levelsCleared must be a non-negative safe integer");
  }
}

function validateNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
}
