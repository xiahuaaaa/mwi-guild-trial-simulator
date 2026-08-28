/**
 * Life (skilling) guild-trial formulas.
 *
 * Success / double-progress / work-force mirror labyrinth skilling rooms.
 * Required progress is calibrated from live trial screenshots
 * (Lv.120 / Lv.130, 22 participants, 2026-07-28).
 *
 * Guild-trial enhancing uses the same shared progress bar as other life
 * rooms; its compensation is a shorter base action time (8s vs 10s).
 */

/** Non-enhancing life-trial / labyrinth skilling base action time. */
export const LIFE_TRIAL_BASE_ACTION_SECONDS = 10;
/** Guild-trial enhancing compensation: shorter base action time. */
export const LIFE_TRIAL_ENHANCING_BASE_ACTION_SECONDS = 8;
export const LIFE_TRIAL_BASE_SUCCESS_RATE = 0.8;
export const LIFE_TRIAL_LEVEL_BONUS_ABOVE = 0.005;
export const LIFE_TRIAL_LEVEL_BONUS_BELOW = 0.01;
export const LIFE_TRIAL_PARTICIPANT_PROGRESS_SCALE = 0.01;

/** Unscaled required progress before participant scaling: 400 × (level + 20). */
export function unscaledLifeTrialProgress(level: number): number {
  validatePositiveSafeInt(level, "level");
  return 400 * (level + 20);
}

/**
 * Shared progress bar target for a life-trial room (including enhancing).
 * `scaled = floor(unscaled × (1 + participantCount × 0.01))`
 */
export function scaledLifeTrialProgress(
  level: number,
  participantCount: number,
): number {
  validateNonNegativeSafeInt(participantCount, "participantCount");
  const unscaled = unscaledLifeTrialProgress(level);
  return Math.floor(
    unscaled * (1 + participantCount * LIFE_TRIAL_PARTICIPANT_PROGRESS_SCALE),
  );
}

/**
 * Effective skill level used for success rate and work force.
 * Includes profession level plus tea-crate / other level bonuses.
 */
export function lifeTrialEffectiveLevel(
  skillLevel: number,
  levelBonuses = 0,
): number {
  validateNonNegativeFinite(skillLevel, "skillLevel");
  validateFinite(levelBonuses, "levelBonuses");
  return skillLevel + levelBonuses;
}

/**
 * Success rate (clamped to [0, 1]):
 * `0.8 × (1 + levelBonus + successBonus)`
 * where levelBonus is +0.5%/level above room, −1%/level below.
 */
export function lifeTrialSuccessRate(
  effectiveLevel: number,
  roomLevel: number,
  successBonus = 0,
): number {
  validateFinite(effectiveLevel, "effectiveLevel");
  validatePositiveSafeInt(roomLevel, "roomLevel");
  validateFinite(successBonus, "successBonus");
  const diff = effectiveLevel - roomLevel;
  const levelBonus =
    diff >= 0
      ? diff * LIFE_TRIAL_LEVEL_BONUS_ABOVE
      : diff * LIFE_TRIAL_LEVEL_BONUS_BELOW;
  const rate =
    LIFE_TRIAL_BASE_SUCCESS_RATE * (1 + levelBonus + successBonus);
  return clamp01(rate);
}

/**
 * Double-progress chance on a successful action:
 * supply-crate bonus + gathering (milking / woodcutting / foraging)
 * + gourmet (cooking / brewing).
 */
export function lifeTrialDoubleProgressChance(
  supplyCrateBonus = 0,
  gatheringBonus = 0,
  gourmetBonus = 0,
): number {
  validateFinite(supplyCrateBonus, "supplyCrateBonus");
  validateFinite(gatheringBonus, "gatheringBonus");
  validateFinite(gourmetBonus, "gourmetBonus");
  return clamp01(supplyCrateBonus + gatheringBonus + gourmetBonus);
}

/**
 * Work force / progress per success:
 * `floor(effectiveLevel × (1 + efficiency))`
 */
export function lifeTrialWorkForce(
  effectiveLevel: number,
  efficiency = 0,
): number {
  validateFinite(effectiveLevel, "effectiveLevel");
  validateFinite(efficiency, "efficiency");
  return Math.max(0, Math.floor(effectiveLevel * (1 + efficiency)));
}

/** Base action seconds for a life-trial skill (enhancing is 8s, others 10s). */
export function lifeTrialBaseActionSeconds(
  skillHrid: string,
  isEnhancing = skillHrid === "/skills/enhancing",
): number {
  return isEnhancing
    ? LIFE_TRIAL_ENHANCING_BASE_ACTION_SECONDS
    : LIFE_TRIAL_BASE_ACTION_SECONDS;
}

/**
 * Observed action time after speed:
 * `baseActionSeconds / (1 + actionSpeed)`
 */
export function lifeTrialActionSeconds(
  actionSpeed = 0,
  baseActionSeconds = LIFE_TRIAL_BASE_ACTION_SECONDS,
): number {
  validateFinite(actionSpeed, "actionSpeed");
  validatePositiveFinite(baseActionSeconds, "baseActionSeconds");
  return baseActionSeconds / Math.max(0.05, 1 + actionSpeed);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function validatePositiveSafeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function validateNonNegativeSafeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function validateFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function validateNonNegativeFinite(value: number, name: string): void {
  validateFinite(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
}

function validatePositiveFinite(value: number, name: string): void {
  validateFinite(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}
