import { NATURE_DPS_FIXED_KIT } from "./combat-ability-templates.mjs";

export function isNatureHealer(row) {
  return row?.combatType === "自" && row?.duty === "healer";
}

export function rankedNatureHealerIds(roster, statsByMemberId = new Map()) {
  return [...(roster ?? [])]
    .filter(isNatureHealer)
    .sort((left, right) => {
      const leftStats = statsByMemberId.get(String(left.memberId)) ?? {};
      const rightStats = statsByMemberId.get(String(right.memberId)) ?? {};
      return (
        Number(rightStats.enhancementLevel ?? 0) -
          Number(leftStats.enhancementLevel ?? 0) ||
        Number(Boolean(rightStats.refined)) - Number(Boolean(leftStats.refined)) ||
        Number(rightStats.magicLevel ?? 0) - Number(leftStats.magicLevel ?? 0) ||
        String(left.memberId).localeCompare(String(right.memberId))
      );
    })
    .map((row) => String(row.memberId));
}

export function convertNatureHealersToDps(
  roster,
  count,
  rankedIds,
  kit = NATURE_DPS_FIXED_KIT,
) {
  const take = new Set(
    (rankedIds ?? []).slice(0, Math.max(0, Number(count) || 0)),
  );
  return (roster ?? []).map((row) => {
    const hrids = Array.isArray(row.abilityHrids) ? [...row.abilityHrids] : [];
    if (!take.has(String(row.memberId))) {
      return { ...row, abilityHrids: hrids };
    }
    const special = hrids[0];
    return {
      ...row,
      duty: "dps",
      abilityHrids: special ? [special, ...kit] : [...kit],
    };
  });
}

export function defaultNatureDpsCounts(healerCount) {
  const cap = Math.max(0, Number(healerCount) || 0);
  return Array.from({ length: cap + 1 }, (_, index) => index);
}
