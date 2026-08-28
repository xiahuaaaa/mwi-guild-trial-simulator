/**
 * Dual-boss partition for ST + swarm weeks.
 *
 * chameleon + swarm (reuse whenever this pair returns):
 *   physical majority → chameleon, magic majority → swarm
 *   both sides keep ≥2 unique-class coverage seats
 *
 * badger + swarm (2026-08-21):
 *   physical majority → swarm, magic majority → ST
 *
 * Coverage skills on both sides: 烟爆 / 法力喷泉 / 冰霜爆裂 / 粉尘 /
 * 疫病 / 破甲 / 碎裂 / 致残 / 血刃.
 *
 * Weekly screening playbook: docs/WEEKLY_COMBAT_SCREENING.md
 */
import {
  ST_PARTITION_KEY,
  SWARM_PARTITION_KEY,
} from "./weekly-combat-boss-pair.mjs";

export const COVERAGE_RESERVE = 2;
export const PHYSICAL_ROLES = new Set(["弓", "弩", "枪", "剑", "锤"]);
export const MAGIC_ROLES = new Set(["火", "水", "自"]);
export const PHYSICAL_SWAP_MIN_LEVEL_GAP = 5;
export const NATURE_SWARM_RATIOS = [0.4, 0.5, 0.6, 0.3];

export function pairStrategyForStKey(stKey) {
  if (stKey === "chameleon") {
    return {
      id: "phys-chameleon-magic-swarm",
      stKey,
      physicalMajority: ST_PARTITION_KEY,
      magicMajority: SWARM_PARTITION_KEY,
      shieldPrimary: ST_PARTITION_KEY,
      mysticAuraSide: SWARM_PARTITION_KEY,
      physicalRebalanceSide: ST_PARTITION_KEY,
      ruleNote: "物理职业去变色龙、魔法职业去虫群",
    };
  }
  return {
    id: `phys-swarm-magic-${stKey}`,
    stKey,
    physicalMajority: SWARM_PARTITION_KEY,
    magicMajority: ST_PARTITION_KEY,
    shieldPrimary: SWARM_PARTITION_KEY,
    mysticAuraSide: ST_PARTITION_KEY,
    physicalRebalanceSide: SWARM_PARTITION_KEY,
    ruleNote: `物理职业去虫群、魔法职业去${stKey}`,
  };
}

export function coverageReserve(count, wanted = COVERAGE_RESERVE) {
  if (count <= 0) return 0;
  if (count < wanted * 2) return Math.max(1, Math.floor(count / 2));
  return wanted;
}

export function natureSwarmCount(count, ratio) {
  if (count <= 0) return 0;
  const reserve = coverageReserve(count);
  const desired = Math.round(count * ratio);
  return Math.min(count - reserve, Math.max(reserve, desired));
}

function otherPartition(side) {
  return side === ST_PARTITION_KEY ? SWARM_PARTITION_KEY : ST_PARTITION_KEY;
}

export function assignRoleToBoss(role, index, count, { strategy, natureRatio }) {
  const cover = coverageReserve(count);
  if (role === "盾") {
    return index === 0 ? strategy.shieldPrimary : otherPartition(strategy.shieldPrimary);
  }
  if (role === "火" || role === "水") {
    return index < cover ? otherPartition(strategy.magicMajority) : strategy.magicMajority;
  }
  if (role === "自") {
    return index < natureSwarmCount(count, natureRatio)
      ? SWARM_PARTITION_KEY
      : ST_PARTITION_KEY;
  }
  return index < cover
    ? otherPartition(strategy.physicalMajority)
    : strategy.physicalMajority;
}

export function partitionPoliciesForStrategy(strategy) {
  return NATURE_SWARM_RATIOS.map((ratio) => ({
    id: `${strategy.id}-heal${Math.round(ratio * 100)}`,
    natureRatio: ratio,
    strategy,
    assign(role, index, count) {
      return assignRoleToBoss(role, index, count, { strategy, natureRatio: ratio });
    },
  }));
}

export function applyTeamCaps(pools, teamCap, helpers) {
  const { capTeamPool, leftoversAfterCap, mergeRolePools, sumMap } = helpers;
  let chameleon = capTeamPool(pools.chameleon, teamCap);
  let swarm = capTeamPool(pools.swarm, teamCap);
  const chamOverflow = leftoversAfterCap(pools.chameleon, chameleon);
  const swarmOverflow = leftoversAfterCap(pools.swarm, swarm);
  const overflow = {
    chameleon: sumMap(chamOverflow),
    swarm: sumMap(swarmOverflow),
  };
  if (sumMap(swarm) < teamCap && overflow.chameleon > 0) {
    swarm = capTeamPool(mergeRolePools(swarm, chamOverflow), teamCap);
  }
  if (sumMap(chameleon) < teamCap && overflow.swarm > 0) {
    chameleon = capTeamPool(mergeRolePools(chameleon, swarmOverflow), teamCap);
  }
  return { chameleon, swarm, overflow };
}

export function rebalancePhysicalToward(targetSide, capped, options) {
  const {
    roleOrder,
    physicalCombatLevel,
    minGap = PHYSICAL_SWAP_MIN_LEVEL_GAP,
    targetLabel,
    log = () => {},
  } = options;
  const otherSide = otherPartition(targetSide);
  const sides = {
    chameleon: new Map(
      roleOrder.map((role) => [role, [...(capped.chameleon.get(role) ?? [])]]),
    ),
    swarm: new Map(
      roleOrder.map((role) => [role, [...(capped.swarm.get(role) ?? [])]]),
    ),
  };
  const swaps = [];
  for (const role of roleOrder) {
    if (!PHYSICAL_ROLES.has(role)) continue;
    let guard = 0;
    while (guard < 20) {
      guard += 1;
      const targetRows = sides[targetSide].get(role) ?? [];
      const otherRows = sides[otherSide].get(role) ?? [];
      if (!targetRows.length || !otherRows.length) break;
      const weakest = [...targetRows].sort(
        (left, right) =>
          physicalCombatLevel(left) - physicalCombatLevel(right) ||
          left.memberId.localeCompare(right.memberId),
      )[0];
      const strongest = [...otherRows].sort(
        (left, right) =>
          physicalCombatLevel(right) - physicalCombatLevel(left) ||
          left.memberId.localeCompare(right.memberId),
      )[0];
      const gap = physicalCombatLevel(strongest) - physicalCombatLevel(weakest);
      if (gap < minGap) break;
      sides[otherSide].set(
        role,
        otherRows.map((row) =>
          row.memberId === strongest.memberId ? weakest : row,
        ),
      );
      sides[targetSide].set(
        role,
        targetRows.map((row) =>
          row.memberId === weakest.memberId ? strongest : row,
        ),
      );
      swaps.push(
        `${strongest.memberId}(${role}${physicalCombatLevel(strongest)})↔` +
          `${weakest.memberId}(${role}${physicalCombatLevel(weakest)})`,
      );
    }
  }
  if (swaps.length) {
    log(`  物理补强${targetLabel}：${swaps.join("，")}\n`);
  }
  return { chameleon: sides.chameleon, swarm: sides.swarm };
}

export function preferHighestMysticAuraOn(targetSide, capped, options) {
  const {
    roleOrder,
    mysticAuraLevel,
    targetLabel,
    log = () => {},
  } = options;
  const chameleon = new Map(
    roleOrder.map((role) => [role, [...(capped.chameleon.get(role) ?? [])]]),
  );
  const swarm = new Map(
    roleOrder.map((role) => [role, [...(capped.swarm.get(role) ?? [])]]),
  );
  const all = [
    ...roleOrder.flatMap((role) =>
      (chameleon.get(role) ?? []).map((row) => ({
        side: ST_PARTITION_KEY,
        role,
        row,
      })),
    ),
    ...roleOrder.flatMap((role) =>
      (swarm.get(role) ?? []).map((row) => ({
        side: SWARM_PARTITION_KEY,
        role,
        row,
      })),
    ),
  ];
  const best = [...all]
    .filter((entry) => MAGIC_ROLES.has(entry.role))
    .sort(
      (left, right) =>
        mysticAuraLevel(right.row) - mysticAuraLevel(left.row) ||
        left.row.memberId.localeCompare(right.row.memberId),
    )[0];
  if (!best || best.side === targetSide || mysticAuraLevel(best.row) <= 0) {
    return { chameleon, swarm };
  }
  const targetPool = targetSide === ST_PARTITION_KEY ? chameleon : swarm;
  const sourcePool = targetSide === ST_PARTITION_KEY ? swarm : chameleon;
  const peers = [...(targetPool.get(best.role) ?? [])];
  if (!peers.length) {
    log(
      `  元素光环：${best.row.memberId}(Lv${mysticAuraLevel(best.row)}) 不在${targetLabel}，但同职业无对换\n`,
    );
    return { chameleon, swarm };
  }
  const weakest = [...peers].sort(
    (left, right) =>
      mysticAuraLevel(left) - mysticAuraLevel(right) ||
      left.memberId.localeCompare(right.memberId),
  )[0];
  if (mysticAuraLevel(best.row) <= mysticAuraLevel(weakest)) {
    return { chameleon, swarm };
  }
  sourcePool.set(
    best.role,
    (sourcePool.get(best.role) ?? []).map((row) =>
      row.memberId === best.row.memberId ? weakest : row,
    ),
  );
  targetPool.set(
    best.role,
    (targetPool.get(best.role) ?? []).map((row) =>
      row.memberId === weakest.memberId ? best.row : row,
    ),
  );
  log(
    `  元素光环去${targetLabel}：${best.row.memberId}(${best.role}/元素Lv${mysticAuraLevel(best.row)})↔` +
      `${weakest.memberId}(${best.role}/元素Lv${mysticAuraLevel(weakest)})\n`,
  );
  return { chameleon, swarm };
}
