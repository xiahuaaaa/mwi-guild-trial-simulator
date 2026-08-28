import itemDetailMap from "../../shykai-full-runtime/generated/src/combatsimulator/data/itemDetailMap.json.js";
import { selectCombatBuild, weaponFor } from "./combat-build-selection.mjs";
import { assessCombatMemberReadiness } from "./combat-member-readiness.mjs";

/**
 * Flag available combat members whose selected main weapon enhancement is
 * strictly below this value. ★+12 is accepted; ★+11 and unrefined +11 are not.
 */
export const WEAPON_ENHANCEMENT_ALERT_BELOW = 12;

export const COMBAT_ROLE_ORDER = [
  "弓",
  "弩",
  "火",
  "水",
  "自",
  "盾",
  "枪",
  "剑",
  "锤",
];

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

const WEAPON_NAME_ZH = {
  "Cursed Bow": "咒怨之弓",
  "Sundering Crossbow": "裂空之弩",
  "Blazing Trident": "炽焰三叉戟",
  "Rippling Trident": "涟漪三叉戟",
  "Blooming Trident": "绽放三叉戟",
  "Furious Spear": "狂怒长枪",
  "Regal Sword": "君王之剑",
  "Chaotic Flail": "混沌连枷",
};

export function isRefinedItemHrid(itemHrid) {
  return String(itemHrid ?? "").endsWith("_refined");
}

export function englishWeaponName(itemHrid) {
  const detailName = itemDetailMap[itemHrid]?.name;
  const raw = detailName || String(itemHrid ?? "").split("/").at(-1) || "";
  return raw.replace(/ \(R\)$/u, "");
}

export function weaponDisplayName(itemHrid) {
  const english = englishWeaponName(itemHrid);
  return WEAPON_NAME_ZH[english] ?? english;
}

export function formatWeaponEnhancementLabel(refined, enhancementLevel) {
  return refined ? `★+${enhancementLevel}` : `普通+${enhancementLevel}`;
}

function skillLevel(snapshot, skillHrid) {
  const level = snapshot?.skills?.[skillHrid];
  return typeof level === "number" && Number.isFinite(level) ? level : null;
}

export function inspectAvailableCombatWeapon(snapshot, combatType) {
  const readiness = assessCombatMemberReadiness(snapshot, combatType);
  if (!readiness.ok) {
    return { available: false, reason: readiness.reason };
  }
  const { build } = selectCombatBuild(snapshot, combatType);
  const weapon = weaponFor(build);
  const itemHrid = weapon?.itemHrid ?? "";
  const enhancementLevel = Number(weapon?.enhancementLevel ?? 0);
  const primary = PRIMARY_SKILL_BY_ROLE[combatType] ?? {
    skillHrid: "/skills/attack",
    label: "攻击",
  };
  const refined = isRefinedItemHrid(itemHrid);
  return {
    available: true,
    combatType,
    itemHrid,
    weaponName: weaponDisplayName(itemHrid),
    refined,
    enhancementLevel,
    enhancementLabel: formatWeaponEnhancementLabel(refined, enhancementLevel),
    belowThreshold: enhancementLevel < WEAPON_ENHANCEMENT_ALERT_BELOW,
    primaryLabel: primary.label,
    primaryLevel: skillLevel(snapshot, primary.skillHrid),
  };
}

function sortAlertRows(left, right) {
  if (left.refined !== right.refined) return left.refined ? 1 : -1;
  if (left.enhancementLevel !== right.enhancementLevel) {
    return left.enhancementLevel - right.enhancementLevel;
  }
  const roleDelta =
    COMBAT_ROLE_ORDER.indexOf(left.combatType) -
    COMBAT_ROLE_ORDER.indexOf(right.combatType);
  if (roleDelta) return roleDelta;
  return String(left.memberId).localeCompare(String(right.memberId), "en");
}

export function collectWeaponEnhancementAlerts(members, bindings) {
  const memberMap = new Map(
    members.map((member) => [String(member.memberId), member]),
  );
  let availableCount = 0;
  const alerts = [];
  for (const binding of bindings) {
    const memberId = String(binding.memberId);
    const member = memberMap.get(memberId);
    if (!member) continue;
    const combatType = binding.combatType ?? "";
    const inspected = inspectAvailableCombatWeapon(
      member.latestSnapshot ?? null,
      combatType,
    );
    if (!inspected.available) continue;
    availableCount += 1;
    if (!inspected.belowThreshold) continue;
    alerts.push({
      memberId,
      displayName: String(member.displayName ?? memberId),
      ...inspected,
    });
  }
  alerts.sort(sortAlertRows);
  return { availableCount, alerts };
}

function formatAlertLine(row, index) {
  const primary =
    row.primaryLevel == null
      ? `${row.primaryLabel}未知`
      : `${row.primaryLabel}${row.primaryLevel}`;
  return `${index}. ${row.memberId}/${row.combatType}  ${row.weaponName} ${row.enhancementLabel}  ${primary}`;
}

export function formatWeaponEnhancementCheck(members, bindings) {
  const { availableCount, alerts } = collectWeaponEnhancementAlerts(
    members,
    bindings,
  );
  const threshold = WEAPON_ENHANCEMENT_ALERT_BELOW;
  const lines = [
    `装备检查：可用 ${availableCount} 人，主武器强化低于★+${threshold}：${alerts.length} 人`,
    `口径：已通过战斗模拟门槛；★精炼与未精炼都算；不含★+${threshold}。`,
  ];
  if (!alerts.length) {
    lines.push(`无人低于★+${threshold}。`);
    return lines.join("\n");
  }

  const unrefined = alerts.filter((row) => !row.refined);
  const refined = alerts.filter((row) => row.refined);
  let index = 1;
  if (unrefined.length) {
    lines.push("");
    lines.push(`未精炼且低于+${threshold}`);
    for (const row of unrefined) {
      lines.push(formatAlertLine(row, index));
      index += 1;
    }
  }
  if (refined.length) {
    lines.push("");
    lines.push(`精炼低于★+${threshold}`);
    for (const row of refined) {
      lines.push(formatAlertLine(row, index));
      index += 1;
    }
  }
  return lines.join("\n");
}
