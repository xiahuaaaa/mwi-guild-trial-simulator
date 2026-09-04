/**
 * Dual-boss partition for ST + swarm weeks.
 *
 * chameleon + swarm (reuse whenever this pair returns):
 *   physical majority → chameleon, magic majority → swarm
 *   both sides keep ≥2 unique-class coverage seats
 *   shields split evenly (even index → shieldPrimary)
 *
 * badger + swarm (2026-09-04):
 *   physical majority → swarm (physical is weak on badger)
 *   fire/water majority → ST / badger (strong on both; occupy badger seats)
 *   nature: ST keeps N healers; leftover nature → swarm as healers
 *   leftover ST seats fill from physical overflow 枪→剑→弓→弩→锤
 *
 * hedgehog + swarm keeps 2026-08-21:
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
export const NATURE_HEALER_PER_SIDE_PREFERRED = [6, 8, 10, 11];
export const NATURE_OVERFLOW_ST_DPS = "even-healers-overflow-st-dps";
export const NATURE_OVERFLOW_SWARM_HEALERS = "st-healers-overflow-swarm-healers";
export function isBadgerNatureMode(mode) {
  return mode === NATURE_OVERFLOW_ST_DPS || mode === NATURE_OVERFLOW_SWARM_HEALERS;
}
/** Leftover badger seats: physical overflow only, hammer last. */
export const BADGER_ST_FILL_ROLES = ["枪", "剑", "弓", "弩", "锤"];
export const GUARDIAN_AURA_HRID = "/abilities/guardian_aura";

export function guardianAuraLevel(member) {
  const value = member?.snapshot?.learnedAbilities?.[GUARDIAN_AURA_HRID];
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

/** Highest Guardian Aura level on 盾; ties break by memberId. */
export function pickHighestGuardianAuraCarrier(members) {
  const shields = (members ?? []).filter((member) => member.combatType === "盾");
  if (!shields.length) return null;
  return [...shields].sort(
    (left, right) =>
      guardianAuraLevel(right) - guardianAuraLevel(left) ||
      String(left.memberId).localeCompare(String(right.memberId)),
  )[0];
}

/**
 * Keep pinned roles (e.g. 盾) at their pre-cap counts, stealing from the
 * largest other roles so a team cap does not drop tanks.
 */
export function pinMinimumRoleCounts(targets, minimums, cap) {
  const next = { ...targets };
  for (const [role, rawMin] of Object.entries(minimums ?? {})) {
    const want = Math.min(Math.max(0, Number(rawMin) || 0), cap);
    const have = next[role] ?? 0;
    if (have >= want) continue;
    let need = want - have;
    next[role] = want;
    const donors = Object.keys(next)
      .filter((other) => other !== role)
      .sort(
        (left, right) =>
          (next[right] ?? 0) - (next[left] ?? 0) || left.localeCompare(right),
      );
    for (const other of donors) {
      if (need <= 0) break;
      const steal = Math.min(need, next[other] ?? 0);
      next[other] -= steal;
      need -= steal;
    }
  }
  return next;
}

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
  if (stKey === "badger") {
    return {
      id: "aoe-swarm-fill-badger",
      stKey,
      physicalMajority: SWARM_PARTITION_KEY,
      magicMajority: ST_PARTITION_KEY,
      shieldPrimary: SWARM_PARTITION_KEY,
      mysticAuraSide: ST_PARTITION_KEY,
      physicalRebalanceSide: null,
      natureMode: NATURE_OVERFLOW_SWARM_HEALERS,
      stFillRoleOrder: BADGER_ST_FILL_ROLES,
      ruleNote:
        "物理去虫群（溢出才上獾，锤最后）；火/水主体去獾；獾留定额自当奶，溢出自去虫群当奶",
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

/** Even healer seats per side; leftover nature headcount goes to ST as DPS. */
export function natureHealerPerSideCandidates(count) {
  if (!count || count <= 0) return [0];
  const reserve = coverageReserve(count);
  const maxEven = Math.floor(count / 2);
  if (maxEven < reserve) return [Math.max(0, maxEven)];
  const picked = NATURE_HEALER_PER_SIDE_PREFERRED.filter(
    (value) => value >= reserve && value <= maxEven,
  );
  if (!picked.includes(maxEven)) picked.push(maxEven);
  if (!picked.length) picked.push(maxEven);
  return [...new Set(picked)].sort((left, right) => left - right);
}

export function clampNatureHealerPerSide(count, requested) {
  if (count <= 0) return 0;
  const reserve = coverageReserve(count);
  const maxEven = Math.floor(count / 2);
  const value = Number(requested);
  if (!Number.isFinite(value)) return reserve;
  return Math.min(maxEven, Math.max(reserve, Math.round(value)));
}

function otherPartition(side) {
  return side === ST_PARTITION_KEY ? SWARM_PARTITION_KEY : ST_PARTITION_KEY;
}

export function assignRoleToBoss(role, index, count, { strategy, natureRatio, natureHealerPerSide }) {
  const cover = coverageReserve(count);
  if (role === "盾") {
    return index % 2 === 0
      ? strategy.shieldPrimary
      : otherPartition(strategy.shieldPrimary);
  }
  if (role === "火" || role === "水") {
    return index < cover ? otherPartition(strategy.magicMajority) : strategy.magicMajority;
  }
  if (role === "自") {
    if (strategy.natureMode === NATURE_OVERFLOW_SWARM_HEALERS) {
      const stHealers = clampNatureHealerPerSide(count, natureHealerPerSide);
      const swarmHealers = count - stHealers;
      return index < swarmHealers ? SWARM_PARTITION_KEY : ST_PARTITION_KEY;
    }
    if (strategy.natureMode === NATURE_OVERFLOW_ST_DPS) {
      const healers = clampNatureHealerPerSide(count, natureHealerPerSide);
      return index < healers ? SWARM_PARTITION_KEY : ST_PARTITION_KEY;
    }
    return index < natureSwarmCount(count, natureRatio)
      ? SWARM_PARTITION_KEY
      : ST_PARTITION_KEY;
  }
  return index < cover
    ? otherPartition(strategy.physicalMajority)
    : strategy.physicalMajority;
}

export function partitionPoliciesForStrategy(strategy, options = {}) {
  if (isBadgerNatureMode(strategy.natureMode)) {
    const suffix =
      strategy.natureMode === NATURE_OVERFLOW_SWARM_HEALERS ? "stheal" : "heal";
    return natureHealerPerSideCandidates(options.natureCount).map((healers) => ({
      id: `${strategy.id}-${suffix}${healers}`,
      natureHealerPerSide: healers,
      natureMode: strategy.natureMode,
      strategy,
      assign(role, index, count) {
        return assignRoleToBoss(role, index, count, {
          strategy,
          natureHealerPerSide: healers,
        });
      },
    }));
  }
  return NATURE_SWARM_RATIOS.map((ratio) => ({
    id: `${strategy.id}-heal${Math.round(ratio * 100)}`,
    natureRatio: ratio,
    strategy,
    assign(role, index, count) {
      return assignRoleToBoss(role, index, count, { strategy, natureRatio: ratio });
    },
  }));
}

/**
 * Keep the under-cap roster intact and append overflow in fillRoleOrder
 * until `cap`. Does not drop people already seated.
 */
export function fillUnderCapFromOverflow(base, overflow, cap, options = {}) {
  const fillRoleOrder = options.fillRoleOrder ?? [];
  const sum =
    options.sumMap ??
    ((map) =>
      [...map.values()].reduce((total, rows) => total + (rows?.length ?? 0), 0));
  const roles = [
    ...new Set([...base.keys(), ...overflow.keys(), ...fillRoleOrder]),
  ];
  const next = new Map(
    roles.map((role) => [role, [...(base.get(role) ?? [])]]),
  );
  const used = new Set(
    [...next.values()].flat().map((row) => row.memberId),
  );
  let size = sum(next);
  for (const role of fillRoleOrder) {
    for (const row of overflow.get(role) ?? []) {
      if (size >= cap) return next;
      if (used.has(row.memberId)) continue;
      if (!next.has(role)) next.set(role, []);
      next.get(role).push(row);
      used.add(row.memberId);
      size += 1;
    }
  }
  return next;
}

export function applyTeamCaps(pools, teamCap, helpers) {
  const {
    capTeamPool,
    leftoversAfterCap,
    mergeRolePools,
    sumMap,
    stFillRoleOrder,
  } = helpers;
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
    chameleon = stFillRoleOrder?.length
      ? fillUnderCapFromOverflow(chameleon, swarmOverflow, teamCap, {
          fillRoleOrder: stFillRoleOrder,
          sumMap,
        })
      : capTeamPool(mergeRolePools(chameleon, swarmOverflow), teamCap);
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
