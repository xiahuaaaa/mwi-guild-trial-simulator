import itemDetailMap from "../../shykai-full-runtime/generated/src/combatsimulator/data/itemDetailMap.json.js";

const COMBAT_SLOTS = new Set([
  "/equipment_types/back",
  "/equipment_types/body",
  "/equipment_types/charm",
  "/equipment_types/earrings",
  "/equipment_types/feet",
  "/equipment_types/hands",
  "/equipment_types/head",
  "/equipment_types/legs",
  "/equipment_types/main_hand",
  "/equipment_types/neck",
  "/equipment_types/off_hand",
  "/equipment_types/pouch",
  "/equipment_types/ring",
  "/equipment_types/trinket",
  "/equipment_types/two_hand",
]);

const ACCESSORY_SLOTS = new Set([
  "/equipment_types/back",
  "/equipment_types/charm",
  "/equipment_types/earrings",
  "/equipment_types/neck",
  "/equipment_types/off_hand",
  "/equipment_types/pouch",
  "/equipment_types/ring",
  "/equipment_types/trinket",
]);

const CHARM_FOCUS_BY_ROLE = {
  弓: "/skills/ranged",
  弩: "/skills/ranged",
  火: "/skills/magic",
  水: "/skills/magic",
  自: "/skills/magic",
  盾: "/skills/defense",
  枪: "/skills/melee",
  剑: "/skills/melee",
  锤: "/skills/melee",
};

const CORE_ARMOR_SLOTS = new Set([
  "/equipment_types/body",
  "/equipment_types/feet",
  "/equipment_types/hands",
  "/equipment_types/head",
  "/equipment_types/legs",
]);

const MAGIC_BLUEPRINTS = {
  火: {
    "/equipment_types/main_hand": ["/items/blazing_trident"],
    "/equipment_types/off_hand": ["/items/bishops_codex"],
    "/equipment_types/hands": ["/items/chrono_gloves"],
    "/equipment_types/head": ["/items/magicians_hat"],
    "/equipment_types/body": ["/items/royal_fire_robe_top"],
    "/equipment_types/legs": ["/items/royal_fire_robe_bottoms"],
    "/equipment_types/feet": ["/items/pathseeker_boots"],
    "/equipment_types/back": ["/items/enchanted_cloak"],
    "/equipment_types/neck": ["/items/wizard_necklace"],
  },
  水: {
    "/equipment_types/main_hand": ["/items/rippling_trident"],
    "/equipment_types/off_hand": ["/items/bishops_codex"],
    "/equipment_types/hands": ["/items/chrono_gloves"],
    "/equipment_types/head": ["/items/magicians_hat"],
    "/equipment_types/body": ["/items/royal_water_robe_top"],
    "/equipment_types/legs": ["/items/royal_water_robe_bottoms"],
    "/equipment_types/feet": ["/items/pathseeker_boots"],
    "/equipment_types/back": ["/items/enchanted_cloak"],
    "/equipment_types/neck": ["/items/wizard_necklace"],
  },
  自: {
    "/equipment_types/main_hand": ["/items/blooming_trident"],
    "/equipment_types/off_hand": ["/items/bishops_codex"],
    "/equipment_types/hands": ["/items/chrono_gloves"],
    "/equipment_types/head": ["/items/magicians_hat"],
    "/equipment_types/body": ["/items/royal_nature_robe_top"],
    "/equipment_types/legs": ["/items/royal_nature_robe_bottoms"],
    "/equipment_types/feet": ["/items/pathseeker_boots"],
    "/equipment_types/back": ["/items/enchanted_cloak"],
    "/equipment_types/neck": ["/items/wizard_necklace"],
  },
};

export function selectCombatBuild(snapshot, role) {
  const catalog = Array.isArray(snapshot?.loadoutCatalog)
    ? snapshot.loadoutCatalog
    : [];

  const dedicated = catalog
    .filter(
      (build) =>
        build?.category === "combat" &&
        Array.isArray(build.equipment) &&
        build.equipment.length > 0 &&
        (build.issues?.length ?? 0) === 0 &&
        buildMatchesRole(build, role),
    )
    .map((build) => normalizeCombatBuild(build))
    .filter((build) => isCombatReady(build, role))
    .sort((left, right) => combatBuildScore(right, role) - combatBuildScore(left, role));

  if (dedicated.length > 0) {
    return {
      build: overlayOwnedCombatAccessories(dedicated[0], catalog, role),
      source: "dedicated-combat-loadout",
    };
  }

  const synthesized = synthesizeCombatBuild(catalog, role);
  return synthesized
    ? { build: synthesized, source: "reconstructed-from-owned-equipment" }
    : { build: null, source: "no-combat-equipment" };
}

export function buildMatchesRole(build, role) {
  const weapon = weaponFor(build);
  if (!weapon) return false;
  return weaponMatchesRole(weapon, role);
}

export function isCombatReady(build, role) {
  if (!buildMatchesRole(build, role)) return false;
  const combatArmorCount = build.equipment.filter((entry) => {
    const detail = itemDetailMap[entry.itemHrid];
    const type = detail?.equipmentDetail?.type;
    return (
      CORE_ARMOR_SLOTS.has(type) &&
      hasCombatStats(detail?.equipmentDetail?.combatStats)
    );
  }).length;
  return combatArmorCount >= 4;
}

export function synthesizeCombatBuild(catalog, role) {
  const bySlot = combatItemPoolBySlot(catalog, role);
  const weaponCandidates = [
    ...(bySlot.get("/equipment_types/main_hand") ?? []),
    ...(bySlot.get("/equipment_types/two_hand") ?? []),
  ].filter((entry) => weaponMatchesRole(entry, role));
  const weapon = pickBestForSlot(weaponCandidates, role);
  if (!weapon) return null;

  const weaponType =
    itemDetailMap[weapon.itemHrid]?.equipmentDetail?.type;
  const equipment = [weapon];
  for (const [slot, candidates] of bySlot) {
    if (
      slot === "/equipment_types/main_hand" ||
      slot === "/equipment_types/two_hand" ||
      (slot === "/equipment_types/off_hand" &&
        weaponType === "/equipment_types/two_hand")
    ) {
      continue;
    }
    const selected = pickBestForSlot(candidates, role, slot);
    if (selected) equipment.push(selected);
  }

  const build = {
    buildId: `reconstructed-${role}`,
    sourceLoadoutId: null,
    name: `自动重组-${role}-战斗配装`,
    category: "combat",
    equipment,
    abilities: [],
    simulationReady: true,
    issues: [],
  };
  return isCombatReady(build, role) ? build : null;
}

function overlayOwnedCombatAccessories(build, catalog, role) {
  const bySlot = new Map();
  for (const entry of build.equipment) {
    const type = itemDetailMap[entry.itemHrid]?.equipmentDetail?.type;
    if (COMBAT_SLOTS.has(type)) bySlot.set(type, entry);
  }
  const pool = combatItemPoolBySlot(catalog, role);
  const weapon = weaponFor(build);
  const weaponType = weapon
    ? itemDetailMap[weapon.itemHrid]?.equipmentDetail?.type
    : null;
  for (const slot of COMBAT_SLOTS) {
    if (
      slot === "/equipment_types/main_hand" ||
      slot === "/equipment_types/two_hand" ||
      (slot === "/equipment_types/off_hand" &&
        weaponType === "/equipment_types/two_hand")
    ) {
      continue;
    }
    const current = bySlot.get(slot);
    const overlayAccessories = ACCESSORY_SLOTS.has(slot);
    if (
      current &&
      !overlayAccessories &&
      !isPrimarilySkilling(current, role)
    ) {
      continue;
    }
    const selected = pickBestForSlot(pool.get(slot) ?? [], role, slot);
    if (selected) {
      bySlot.set(slot, selected);
    } else if (current && isPrimarilySkilling(current, role)) {
      bySlot.delete(slot);
    }
  }
  return { ...build, equipment: [...bySlot.values()] };
}

function combatItemPoolBySlot(catalog, role) {
  const pool = highestEnhancementInstances(
    catalog.flatMap((row) =>
      Array.isArray(row?.equipment) ? row.equipment : [],
    ),
  );
  const bySlot = new Map();
  for (const entry of pool) {
    const detail = itemDetailMap[entry.itemHrid];
    const type = detail?.equipmentDetail?.type;
    if (!COMBAT_SLOTS.has(type)) continue;
    if (
      !["/equipment_types/main_hand", "/equipment_types/two_hand"].includes(type) &&
      !hasCombatStats(detail?.equipmentDetail?.combatStats)
    ) {
      continue;
    }
    if (
      !["/equipment_types/main_hand", "/equipment_types/two_hand"].includes(type) &&
      isPrimarilySkilling(entry, role)
    ) {
      continue;
    }
    const list = bySlot.get(type) ?? [];
    list.push(entry);
    bySlot.set(type, list);
  }
  return bySlot;
}

function isPrimarilySkilling(entry, role) {
  const detail = itemDetailMap[entry.itemHrid];
  const noncombat = detail?.equipmentDetail?.noncombatStats ?? {};
  const hasSkilling = Object.values(noncombat).some((value) => Number(value) !== 0);
  if (!hasSkilling) return false;
  return combatWeightedFitness(entry, role) <= 0;
}

function normalizeCombatBuild(build) {
  const equipment = [];
  const slots = new Map();
  for (const entry of highestEnhancementInstances(build.equipment)) {
    const type = itemDetailMap[entry.itemHrid]?.equipmentDetail?.type;
    if (!COMBAT_SLOTS.has(type)) continue;
    const previous = slots.get(type);
    if (!previous || compareSameSlot(entry, previous) > 0) {
      slots.set(type, entry);
    }
  }
  for (const entry of slots.values()) equipment.push(entry);
  return { ...build, equipment };
}

function pickBestForSlot(candidates, role, slot) {
  return [...candidates].sort((left, right) => {
    const blueprintDifference =
      blueprintPriority(right, role, slot) - blueprintPriority(left, role, slot);
    if (blueprintDifference) return blueprintDifference;
    const fitnessDifference =
      itemCombatFitness(right, role) - itemCombatFitness(left, role);
    if (fitnessDifference) return fitnessDifference;
    return compareSameSlot(right, left);
  })[0] ?? null;
}

function blueprintPriority(entry, role, slot) {
  const preferred = MAGIC_BLUEPRINTS[role]?.[slot] ?? [];
  const family = itemFamily(entry.itemHrid);
  return preferred.some((hrid) => itemFamily(hrid) === family) ? 1 : 0;
}

function combatWeightedFitness(entry, role) {
  const detail = itemDetailMap[entry.itemHrid];
  const stats = detail?.equipmentDetail?.combatStats ?? {};
  const stylePrefix =
    role === "弓" || role === "弩"
      ? "ranged"
      : role === "火" || role === "水" || role === "自"
        ? "magic"
        : role === "枪"
          ? "stab"
          : role === "剑"
            ? "slash"
            : "smash";
  const elementPrefix = role === "火" ? "fire" : role === "水" ? "water" : role === "自" ? "nature" : null;
  const charmFocus = CHARM_FOCUS_BY_ROLE[role];
  return (
    positive(stats[`${stylePrefix}Accuracy`]) * 40 +
    positive(stats[`${stylePrefix}Damage`]) * 50 +
    positive(stats.attackSpeed) * 22 +
    positive(stats.castSpeed) * 22 +
    positive(stats.abilityDamage) * 35 +
    positive(stats.abilityHaste) * 0.8 +
    positive(stats.criticalRate) * 25 +
    positive(stats.criticalDamage) * 15 +
    positive(stats.taskDamage) * 40 +
    (elementPrefix ? positive(stats[`${elementPrefix}Amplify`]) * 40 : 0) +
    (elementPrefix ? positive(stats[`${elementPrefix}Penetration`]) * 30 : 0) +
    (role === "自" ? positive(stats.healingAmplify) * 45 : 0) +
    (charmFocus && stats.focusTraining === charmFocus ? 40 : 0) +
    positive(stats.armor) * 0.03 +
    positive(stats.maxHitpoints) * 0.001 +
    positive(stats.maxManapoints) * 0.001
  );
}

function itemCombatFitness(entry, role) {
  const detail = itemDetailMap[entry.itemHrid];
  return combatWeightedFitness(entry, role) * 1_000 + Number(detail?.itemLevel ?? 0);
}

function combatBuildScore(build, role) {
  return build.equipment.reduce(
    (sum, entry) =>
      sum +
      itemCombatFitness(entry, role) * 1_000 +
      Number(entry.enhancementLevel ?? 0),
    0,
  );
}

export function weaponFor(build) {
  return build.equipment.find((entry) =>
    ["/equipment_types/main_hand", "/equipment_types/two_hand"].includes(
      itemDetailMap[entry.itemHrid]?.equipmentDetail?.type,
    ),
  );
}

export function weaponMatchesRole(entry, role) {
  const detail = itemDetailMap[entry.itemHrid];
  const type = detail?.equipmentDetail?.type;
  const stats = detail?.equipmentDetail?.combatStats ?? {};
  const style = stats.combatStyleHrids?.[0];
  const damageType = stats.damageType;
  switch (role) {
    case "弓":
      return style === "/combat_styles/ranged" && type === "/equipment_types/two_hand";
    case "弩":
      return style === "/combat_styles/ranged" && type === "/equipment_types/main_hand";
    case "火":
      return style === "/combat_styles/magic" && damageType === "/damage_types/fire";
    case "水":
      return style === "/combat_styles/magic" && damageType === "/damage_types/water";
    case "自":
      return style === "/combat_styles/magic" && damageType === "/damage_types/nature";
    case "盾":
      return style === "/combat_styles/smash" && type === "/equipment_types/two_hand";
    case "枪":
      return style === "/combat_styles/stab";
    case "剑":
      return style === "/combat_styles/slash";
    case "锤":
      return style === "/combat_styles/smash" && type === "/equipment_types/main_hand";
    default:
      return false;
  }
}

function highestEnhancementInstances(entries) {
  const highest = new Map();
  for (const entry of entries) {
    if (!entry?.itemHrid) continue;
    const previous = highest.get(entry.itemHrid);
    if (
      !previous ||
      Number(entry.enhancementLevel ?? 0) >
        Number(previous.enhancementLevel ?? 0)
    ) {
      highest.set(entry.itemHrid, structuredClone(entry));
    }
  }
  return [...highest.values()];
}

function compareSameSlot(left, right) {
  const leftEnhancement = Number(left.enhancementLevel ?? 0);
  const rightEnhancement = Number(right.enhancementLevel ?? 0);
  if (leftEnhancement !== rightEnhancement) {
    return leftEnhancement - rightEnhancement;
  }
  const leftLevel = Number(itemDetailMap[left.itemHrid]?.itemLevel ?? 0);
  const rightLevel = Number(itemDetailMap[right.itemHrid]?.itemLevel ?? 0);
  return leftLevel - rightLevel;
}

function itemFamily(hrid) {
  return String(hrid).replace(/_refined$/, "");
}

function hasCombatStats(stats) {
  return Object.values(stats ?? {}).some((value) => {
    if (Array.isArray(value) || typeof value === "string") return true;
    return Number(value) !== 0;
  });
}

function positive(value) {
  return Math.max(0, Number(value ?? 0));
}
