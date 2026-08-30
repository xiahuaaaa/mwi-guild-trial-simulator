/**
 * Versioned contract for combat lab artifacts. B is the current trial
 * respawn policy: players keep the 150s automatic respawn, but a party wipe
 * is terminal when every player is dead at the same simulation timestamp.
 */
export const COMBAT_RULES_VERSION = "guild-trial-rules-2026-08-30.1";
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
