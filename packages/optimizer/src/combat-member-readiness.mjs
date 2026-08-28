import { selectCombatBuild } from "./combat-build-selection.mjs";
import {
  canDefaultMissingSkillLevel,
  defaultLevelForMissingAbility,
} from "../../shykai-full-runtime/src/ability-level-defaults.mjs";
import { officialAbilityNameZh } from "../../mwi-data/official-zh-ability-names.mjs";

/** Guild combat trial participation floor (snapshot `/skills/attack`). */
export const GUILD_TRIAL_MIN_ATTACK_LEVEL = 110;

export const ATTACK_SKILL_HRID = "/skills/attack";

export function readAttackLevelFromSnapshot(snapshot) {
  const level = snapshot?.skills?.[ATTACK_SKILL_HRID];
  return typeof level === "number" && Number.isFinite(level) ? level : null;
}

export function memberMeetsGuildTrialAttackThreshold(
  snapshot,
  threshold = GUILD_TRIAL_MIN_ATTACK_LEVEL,
) {
  const attackLevel = readAttackLevelFromSnapshot(snapshot);
  return attackLevel !== null && attackLevel >= threshold;
}

export const REQUIRED_CORE_ABILITY_HRIDS_BY_ROLE = {
  弓: ["/abilities/berserk", "/abilities/precision"],
  弩: ["/abilities/berserk", "/abilities/precision"],
  火: [
    "/abilities/elemental_affinity",
    "/abilities/firestorm",
    "/abilities/fireball",
  ],
  水: [
    "/abilities/elemental_affinity",
    "/abilities/mana_spring",
    "/abilities/frost_surge",
    "/abilities/water_strike",
  ],
  自: [
    "/abilities/rejuvenate",
    "/abilities/toxic_pollen",
    "/abilities/entangle",
  ],
  盾: [
    "/abilities/toughness",
    "/abilities/spike_shell",
    "/abilities/retribution",
    "/abilities/provoke",
  ],
  枪: [
    "/abilities/berserk",
    "/abilities/precision",
    "/abilities/puncture",
  ],
  剑: ["/abilities/berserk", "/abilities/precision"],
  锤: [
    "/abilities/berserk",
    "/abilities/precision",
    "/abilities/frenzy",
    "/abilities/fracturing_impact",
  ],
};

export function requiredCoreAbilityHrids(role) {
  return REQUIRED_CORE_ABILITY_HRIDS_BY_ROLE[role] ?? [];
}

export function missingAbilityHrids(snapshot, abilityHrids) {
  const learned = snapshot?.learnedAbilities ?? {};
  return abilityHrids.filter((hrid) => !Number.isFinite(learned[hrid]));
}

export function formatAbilityNames(abilityHrids) {
  return abilityHrids
    .map((hrid) => officialAbilityNameZh(hrid) ?? hrid)
    .join("、");
}

/**
 * Fill missing skills with defaults:
 * ordinary → Lv40, revive/insanity → Lv1. Auras / invincible stay missing.
 */
export function applyDefaultMissingSkillLevels(
  snapshot,
  combatType,
  extraAbilityHrids = [],
) {
  const learned = { ...(snapshot?.learnedAbilities ?? {}) };
  const targets = new Set([
    ...requiredCoreAbilityHrids(combatType),
    ...extraAbilityHrids,
  ]);
  const defaulted = [];
  for (const abilityHrid of targets) {
    if (Number.isFinite(learned[abilityHrid])) continue;
    const fallback = defaultLevelForMissingAbility(abilityHrid);
    if (fallback == null) continue;
    learned[abilityHrid] = fallback;
    defaulted.push(abilityHrid);
  }
  if (!defaulted.length) {
    return { snapshot, defaultedAbilityHrids: [] };
  }
  return {
    snapshot: { ...snapshot, learnedAbilities: learned },
    defaultedAbilityHrids: defaulted,
  };
}

export function prepareSnapshotForCombat(snapshot, combatType) {
  return applyDefaultMissingSkillLevels(snapshot, combatType).snapshot;
}

export function assessCombatMemberReadiness(snapshot, combatType) {
  if (!combatType) {
    return { ok: false, reason: "未绑定 QQ 战斗职业" };
  }
  if (!snapshot) {
    return { ok: false, reason: "尚未上传成员快照" };
  }
  const attackLevel = readAttackLevelFromSnapshot(snapshot);
  if (attackLevel === null) {
    return {
      ok: false,
      reason: `快照缺少攻击等级（需≥${GUILD_TRIAL_MIN_ATTACK_LEVEL}）`,
      attackLevel: null,
      minAttackLevel: GUILD_TRIAL_MIN_ATTACK_LEVEL,
    };
  }
  if (attackLevel < GUILD_TRIAL_MIN_ATTACK_LEVEL) {
    return {
      ok: false,
      reason: `攻击等级不足（${attackLevel}<${GUILD_TRIAL_MIN_ATTACK_LEVEL}）`,
      attackLevel,
      minAttackLevel: GUILD_TRIAL_MIN_ATTACK_LEVEL,
    };
  }
  const buildSelection = selectCombatBuild(snapshot, combatType);
  if (!buildSelection.build) {
    return { ok: false, reason: "快照缺少可用的对应职业装备" };
  }

  const missingCore = missingAbilityHrids(
    snapshot,
    requiredCoreAbilityHrids(combatType),
  );
  const missingNonDefaultable = missingCore.filter(
    (hrid) => !canDefaultMissingSkillLevel(hrid),
  );
  if (missingNonDefaultable.length) {
    return {
      ok: false,
      reason:
        "缺少不可默认技能：" +
        formatAbilityNames(missingNonDefaultable),
      missingNonDefaultableAbilityHrids: missingNonDefaultable,
    };
  }

  const missingDefaultable = missingCore.filter(canDefaultMissingSkillLevel);
  const { defaultedAbilityHrids } = applyDefaultMissingSkillLevels(
    snapshot,
    combatType,
    missingDefaultable,
  );

  return {
    ok: true,
    buildSource: buildSelection.source,
    defaultedAbilityHrids,
    defaultedSkillNames: formatAbilityNames(defaultedAbilityHrids),
    missingDefaultableAbilityHrids: missingDefaultable,
  };
}

export function listMembersMissingCombatEquipment(members, bindings) {
  const rows = [];
  for (const binding of bindings) {
    const member = members.find((m) => m.memberId === binding.memberId);
    const snapshot = member?.latestSnapshot;
    if (!snapshot) continue;
    const buildSelection = selectCombatBuild(snapshot, binding.combatType);
    if (!buildSelection.build) {
      rows.push({
        memberId: binding.memberId,
        combatType: binding.combatType,
        displayName: member?.displayName ?? binding.memberId,
      });
    }
  }
  return rows.sort((a, b) => a.memberId.localeCompare(b.memberId));
}
