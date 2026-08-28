/** Default level for missing ordinary combat skills in guild-trial simulation. */
export const DEFAULT_MISSING_SKILL_LEVEL = 40;

/** Game baseline: every character has at least Lv1 insanity and revive. */
export const DEFAULT_REVIVE_INSANITY_LEVEL = 1;

const REVIVE_INSANITY_HRIDS = new Set([
  "/abilities/revive",
  "/abilities/insanity",
]);

export function isAuraAbilityHrid(abilityHrid) {
  return String(abilityHrid).endsWith("_aura");
}

export function isReviveOrInsanityHrid(abilityHrid) {
  return REVIVE_INSANITY_HRIDS.has(abilityHrid);
}

/**
 * Missing-skill default level:
 * - ordinary skills → 40
 * - revive / insanity → 1 (game baseline)
 * - auras / invincible → never auto-filled
 */
export function defaultLevelForMissingAbility(abilityHrid) {
  if (isAuraAbilityHrid(abilityHrid)) return null;
  if (abilityHrid === "/abilities/invincible") return null;
  if (isReviveOrInsanityHrid(abilityHrid)) return DEFAULT_REVIVE_INSANITY_LEVEL;
  return DEFAULT_MISSING_SKILL_LEVEL;
}

export function canDefaultMissingSkillLevel(abilityHrid) {
  return defaultLevelForMissingAbility(abilityHrid) != null;
}

export function resolveLearnedAbilityLevel(abilityHrid, learnedAbilities) {
  const level = learnedAbilities?.[abilityHrid];
  const fallback = defaultLevelForMissingAbility(abilityHrid);
  if (!Number.isFinite(level)) return fallback;
  // Stub levels (e.g. water_strike Lv1 while magic is 150+) are treated like
  // missing for ordinary skills and floored to the guild-trial default.
  if (
    fallback != null &&
    !isAuraAbilityHrid(abilityHrid) &&
    abilityHrid !== "/abilities/invincible" &&
    !isReviveOrInsanityHrid(abilityHrid) &&
    level < fallback
  ) {
    return fallback;
  }
  return level;
}

/** Effective learned level including revive/insanity Lv1 baseline. */
export function effectiveLearnedAbilityLevel(abilityHrid, learnedAbilities) {
  return resolveLearnedAbilityLevel(abilityHrid, learnedAbilities);
}
