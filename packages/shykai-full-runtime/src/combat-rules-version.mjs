/**
 * Versioned contract for combat lab artifacts. Guild-trial automatic respawn
 * is disabled, while player revive abilities remain enabled. A party wipe is
 * terminal only when every player is dead and has not been revived.
 */
export const COMBAT_RULES_VERSION = "guild-trial-rules-2026-08-30.2";
export const PERMANENT_BUFFS_ENABLED = false;

export function assertCombatRulesVersion(lab, source = "combat lab JSON") {
  if (lab?.combatRulesVersion !== COMBAT_RULES_VERSION) {
    throw new Error(
      `${source} missing or incompatible combatRulesVersion; ` +
        `expected ${COMBAT_RULES_VERSION}`,
    );
  }
  if (lab.permanentBuffsEnabled !== PERMANENT_BUFFS_ENABLED) {
    throw new Error(
      `${source} has unsupported permanentBuffsEnabled=${String(lab.permanentBuffsEnabled)}; ` +
        `expected ${String(PERMANENT_BUFFS_ENABLED)}`,
    );
  }
  return lab;
}
