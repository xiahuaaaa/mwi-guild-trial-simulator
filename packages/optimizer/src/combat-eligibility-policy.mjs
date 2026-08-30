import itemDetailMap from "../../shykai-full-runtime/generated/src/combatsimulator/data/itemDetailMap.json.js";
import { weaponMatchesRole } from "./combat-build-selection.mjs";

/** WI-only combat lab floors. TMD keeps attack ≥110 and no extra weapon/shield caps. */
export const WI_COMBAT_MIN_PRIMARY_LEVEL = 125;
export const WI_COMBAT_MIN_WEAPON_ITEM_LEVEL = 95;
export const WI_SHIELDS_PER_SIDE = 2;
export const WI_DEFAULT_TEAM_CAP = 48;
export const TMD_DEFAULT_TEAM_CAP = 52;

export const PRIMARY_SKILL_BY_ROLE = {
  弓: { skillHrid: "/skills/ranged", label: "远程" },
  弩: { skillHrid: "/skills/ranged", label: "远程" },
  火: { skillHrid: "/skills/magic", label: "魔法" },
  水: { skillHrid: "/skills/magic", label: "魔法" },
  自: { skillHrid: "/skills/magic", label: "魔法" },
  盾: { skillHrid: "/skills/defense", label: "防御" },
  枪: { skillHrid: "/skills/melee", label: "近战" },
  剑: { skillHrid: "/skills/melee", label: "近战" },
  锤: { skillHrid: "/skills/melee", label: "近战" },
};

export function combatReadinessOptionsForGuild(guildId) {
  if (String(guildId ?? "") === "WI") {
    return {
      minPrimaryLevel: WI_COMBAT_MIN_PRIMARY_LEVEL,
      minWeaponItemLevel: WI_COMBAT_MIN_WEAPON_ITEM_LEVEL,
    };
  }
  return {};
}

export function shieldsPerSideForGuild(guildId) {
  return String(guildId ?? "") === "WI" ? WI_SHIELDS_PER_SIDE : null;
}

export function defaultTeamCapForGuild(guildId) {
  return String(guildId ?? "") === "WI"
    ? WI_DEFAULT_TEAM_CAP
    : TMD_DEFAULT_TEAM_CAP;
}

export function itemLevelFor(itemHrid) {
  return Number(itemDetailMap[itemHrid]?.itemLevel ?? 0);
}

function equipmentEntriesFromSnapshot(snapshot) {
  const builds = [
    ...(snapshot?.loadoutCatalog ?? []),
    ...(snapshot?.approvedBuilds ?? []),
  ];
  return builds.flatMap((build) =>
    Array.isArray(build?.equipment) ? build.equipment : [],
  );
}

/** True if the member owns a bound-role weapon at or above the item-level floor (T95 / ★T95). */
export function memberOwnsRoleWeaponAtItemLevel(
  snapshot,
  combatType,
  minItemLevel,
) {
  if (!combatType || !Number.isFinite(minItemLevel)) return false;
  return equipmentEntriesFromSnapshot(snapshot).some(
    (entry) =>
      weaponMatchesRole(entry, combatType) &&
      itemLevelFor(entry.itemHrid) >= minItemLevel,
  );
}

export function primarySkillForRole(combatType) {
  return (
    PRIMARY_SKILL_BY_ROLE[combatType] ?? {
      skillHrid: "/skills/attack",
      label: "攻击",
    }
  );
}

export function readPrimarySkillLevel(snapshot, combatType) {
  const { skillHrid } = primarySkillForRole(combatType);
  const value = snapshot?.skills?.[skillHrid];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const level = Number(value.level ?? value.buffedLevel);
    return Number.isFinite(level) ? level : null;
  }
  return null;
}

export function shieldDefenseLevel(member) {
  const value = member?.snapshot?.skills?.["/skills/defense"];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const level = Number(value.level ?? value.buffedLevel);
    return Number.isFinite(level) ? level : -1;
  }
  return -1;
}

/**
 * Keep the highest-defense shields; drop the rest.
 * `keepCount` is the total across both bosses (WI: 2 per side → 4).
 */
export function keepTopShieldsByDefense(shields, keepCount) {
  const ranked = [...(shields ?? [])].sort(
    (left, right) =>
      shieldDefenseLevel(right) - shieldDefenseLevel(left) ||
      String(left.memberId).localeCompare(String(right.memberId)),
  );
  const keep = Math.max(0, Number(keepCount) || 0);
  return {
    kept: ranked.slice(0, keep),
    dropped: ranked.slice(keep),
  };
}

export function formatShieldCapReason(member, shieldsPerSide) {
  const defense = shieldDefenseLevel(member);
  const defenseLabel = defense >= 0 ? String(defense) : "未知";
  return `盾超额（防御${defenseLabel}较低，每边只带${shieldsPerSide}盾）`;
}

export function combatEligibilityNote(guildId, minAttackLevel) {
  if (String(guildId ?? "") === "WI") {
    return (
      `WI门槛：主属性≥${WI_COMBAT_MIN_PRIMARY_LEVEL}` +
      `（弓弩远程/枪剑锤近战/火水自魔法/盾防御）；` +
      `需T95或精炼★T95武器；每边${WI_SHIELDS_PER_SIDE}盾（去掉防御较低的盾）；` +
      `攻击≥${minAttackLevel}`
    );
  }
  return `攻击≥${minAttackLevel}`;
}
