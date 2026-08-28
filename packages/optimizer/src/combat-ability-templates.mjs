/**
 * Guild-trial combat ability templates.
 * Multi-enemy floors (swarm / badger×2) → AOE-friendly kits.
 * Single-target (chameleon / hedgehog) → ST kits.
 *
 * chameleon + swarm pair (reuse): physical majority chameleon, magic majority
 * swarm, both sides keep ≥2 coverage. Swarm uses AOE kits; chameleon uses ST.
 *
 * 2026-08-21 healer kit (AOE bosses): 群体治疗术 / 剧毒粉尘 / 自然菌幕 / 缠绕
 * ST healer kit: 群体治疗术 / 元素增幅 / 生命吸取 / 缠绕
 * ST pollen coverage (lowest-DPS 3 nature): 群体治疗术 / 元素增幅 / 剧毒粉尘 / 缠绕
 * Coverage skills kept on both sides: 烟爆 / 法力喷泉 / 冰霜爆裂 / 粉尘 /
 * 疫病 / 破甲 / 碎裂 / 致残 / 血刃.
 *
 * Weekly screening playbook: docs/WEEKLY_COMBAT_SCREENING.md
 */

export const BADGER_AOE_ABILITY_TEMPLATES = {
  弓: {
    required: ["/abilities/berserk", "/abilities/precision"],
    optional: [
      "/abilities/frenzy",
      "/abilities/pestilent_shot",
      "/abilities/penetrating_shot",
      "/abilities/steady_shot",
    ],
  },
  弩: {
    required: ["/abilities/berserk", "/abilities/precision"],
    optional: [
      "/abilities/frenzy",
      "/abilities/pestilent_shot",
      "/abilities/penetrating_shot",
      "/abilities/steady_shot",
    ],
  },
  剑: {
    required: [
      "/abilities/berserk",
      "/abilities/precision",
      "/abilities/maim",
      "/abilities/crippling_slash",
    ],
    optional: [],
  },
  枪: {
    required: [
      "/abilities/berserk",
      "/abilities/precision",
      "/abilities/puncture",
      "/abilities/penetrating_strike",
    ],
    optional: [],
  },
  锤: {
    required: [
      "/abilities/berserk",
      "/abilities/frenzy",
      "/abilities/precision",
      "/abilities/fracturing_impact",
    ],
    optional: [],
  },
  火: {
    required: [
      "/abilities/elemental_affinity",
      "/abilities/firestorm",
      "/abilities/flame_blast",
      "/abilities/fireball",
    ],
    optional: ["/abilities/smoke_burst", "/abilities/rejuvenate"],
  },
  水: {
    required: [
      "/abilities/elemental_affinity",
      "/abilities/mana_spring",
      "/abilities/frost_surge",
      "/abilities/water_strike",
    ],
    optional: [],
  },
  自_dps: {
    required: [
      "/abilities/elemental_affinity",
      "/abilities/toxic_pollen",
      "/abilities/natures_veil",
      "/abilities/entangle",
    ],
    optional: [],
  },
  自_healer: {
    required: [
      "/abilities/rejuvenate",
      "/abilities/toxic_pollen",
      "/abilities/natures_veil",
      "/abilities/entangle",
    ],
    optional: [],
  },
  盾: {
    // Slot1 = Guardian Aura (assigned separately). Ordinary: 坚韧/尖刺/惩戒/嘲讽.
    required: [
      "/abilities/toughness",
      "/abilities/spike_shell",
      "/abilities/retribution",
      "/abilities/provoke",
    ],
    optional: [],
  },
};

/** Single-target chameleon / hedgehog. */
export const HEDGEHOG_ST_ABILITY_TEMPLATES = {
  ...BADGER_AOE_ABILITY_TEMPLATES,
  弓: {
    required: ["/abilities/berserk", "/abilities/precision"],
    optional: [
      "/abilities/pestilent_shot",
      "/abilities/steady_shot",
      "/abilities/frenzy",
      "/abilities/penetrating_shot",
    ],
  },
  弩: {
    required: ["/abilities/berserk", "/abilities/precision"],
    optional: [
      "/abilities/pestilent_shot",
      "/abilities/steady_shot",
      "/abilities/frenzy",
      "/abilities/penetrating_shot",
    ],
  },
  剑: {
    required: [
      "/abilities/berserk",
      "/abilities/precision",
      "/abilities/maim",
      "/abilities/crippling_slash",
    ],
    optional: [],
  },
  枪: {
    required: [
      "/abilities/berserk",
      "/abilities/precision",
      "/abilities/puncture",
      "/abilities/frenzy",
    ],
    optional: [],
  },
  火: {
    required: [
      "/abilities/elemental_affinity",
      "/abilities/precision",
      "/abilities/smoke_burst",
      "/abilities/fireball",
    ],
    optional: [],
  },
  水_support: {
    required: [
      "/abilities/elemental_affinity",
      "/abilities/mana_spring",
      "/abilities/frost_surge",
      "/abilities/water_strike",
    ],
    optional: [],
  },
  水_dps: {
    required: [
      "/abilities/elemental_affinity",
      "/abilities/frost_surge",
      "/abilities/water_strike",
    ],
    optional: ["/abilities/precision", "/abilities/ice_spear"],
  },
  自_dps: {
    required: [
      "/abilities/elemental_affinity",
      "/abilities/life_drain",
      "/abilities/entangle",
    ],
    optional: ["/abilities/precision", "/abilities/toxic_pollen"],
  },
  自_healer: {
    required: [
      "/abilities/rejuvenate",
      "/abilities/elemental_affinity",
      "/abilities/life_drain",
      "/abilities/entangle",
    ],
    optional: [],
  },
};

export const NATURE_HEALER_FIXED_KIT = [
  "/abilities/rejuvenate",
  "/abilities/toxic_pollen",
  "/abilities/natures_veil",
  "/abilities/entangle",
];
/** ST majority healers: 群疗 still the heal; life drain is filler, not the main heal. */
export const ST_NATURE_HEALER_DRAIN_KIT = [
  "/abilities/rejuvenate",
  "/abilities/elemental_affinity",
  "/abilities/life_drain",
  "/abilities/entangle",
];
/** Lowest-DPS ST nature keep pollen for coverage. */
export const ST_NATURE_HEALER_POLLEN_KIT = [
  "/abilities/rejuvenate",
  "/abilities/elemental_affinity",
  "/abilities/toxic_pollen",
  "/abilities/entangle",
];
export const ST_NATURE_POLLEN_COVERAGE_COUNT = 3;

export function applyStNatureHealerKits(
  roster,
  { pollenMemberIds = [], pollenCount = ST_NATURE_POLLEN_COVERAGE_COUNT } = {},
) {
  const pollen = new Set(
    (pollenMemberIds ?? []).slice(0, Math.max(0, Number(pollenCount) || 0)).map(String),
  );
  return (roster ?? []).map((row) => {
    if (row?.combatType !== "自") {
      return { ...row, abilityHrids: Array.isArray(row?.abilityHrids) ? [...row.abilityHrids] : [] };
    }
    const hrids = Array.isArray(row.abilityHrids) ? [...row.abilityHrids] : [];
    const special = hrids[0];
    const kit = pollen.has(String(row.memberId))
      ? ST_NATURE_HEALER_POLLEN_KIT
      : ST_NATURE_HEALER_DRAIN_KIT;
    return {
      ...row,
      duty: "healer",
      abilityHrids: special ? [special, ...kit] : [...kit],
    };
  });
}
export const NATURE_DPS_FIXED_KIT = [
  "/abilities/elemental_affinity",
  "/abilities/toxic_pollen",
  "/abilities/natures_veil",
  "/abilities/entangle",
];
export const HAMMER_FIXED_KIT = [
  "/abilities/berserk",
  "/abilities/frenzy",
  "/abilities/precision",
  "/abilities/fracturing_impact",
];
export const SWORD_FIXED_KIT = [
  "/abilities/berserk",
  "/abilities/precision",
  "/abilities/maim",
  "/abilities/crippling_slash",
];

export function applyHammerFixedKit(roster, kit = HAMMER_FIXED_KIT) {
  return (roster ?? []).map((row) => {
    const hrids = Array.isArray(row.abilityHrids) ? [...row.abilityHrids] : [];
    if (row?.combatType !== "锤") return { ...row, abilityHrids: hrids };
    const special = hrids[0];
    return {
      ...row,
      abilityHrids: special ? [special, ...kit] : [...kit],
    };
  });
}
/** @deprecated healer kit is fixed; kept for old callers. */
export const NATURE_HEALER_FREE_SLOTS = ["natures_veil"];
export const NATURE_DPS_MIDDLE_SLOTS = ["precision", "toxic_pollen"];
export const WATER_DPS_MIDDLE_SLOTS = ["precision", "ice_spear"];
export const WATER_SUPPORT_COUNTS = [1, 2];

/** @deprecated use NATURE_DPS_MIDDLE_SLOTS */
export const HEDGEHOG_NATURE_DPS_FREE_SLOTS = NATURE_DPS_MIDDLE_SLOTS;
/** @deprecated chameleon fire kit is fixed */
export const HEDGEHOG_FIRE_FREE_SLOTS = ["firestorm", "flame_blast"];

/** Single-target floors (hedgehog / chameleon). */
export function isSingleTargetBossKey(bossKey) {
  return bossKey === "hedgehog" || bossKey === "chameleon";
}

/** Multi-enemy floors (badger / swarm / …) → AOE kits. */
export function abilityTemplatesForBoss(bossKey) {
  if (isSingleTargetBossKey(bossKey)) return HEDGEHOG_ST_ABILITY_TEMPLATES;
  return BADGER_AOE_ABILITY_TEMPLATES;
}

function pickOptionalMiddle(optional, preferredSlug) {
  if (!preferredSlug) return [...optional];
  const preferred = `/abilities/${preferredSlug}`;
  return [...optional].sort((left, right) => {
    if (left === preferred) return -1;
    if (right === preferred) return 1;
    return left.localeCompare(right);
  });
}

export const SWARM_RANGED_DPS_KITS = ["precision_rain", "frenzy_rain"];
/** Swarm fire: default 熔岩爆裂; only compare 0 / 1 / 2 smoke-burst carriers. */
export const SWARM_FIRE_SMOKE_COUNTS = [0, 1, 2];
export const SWARM_RANGED_DEBUFF_COUNTS = [1, 2];

export const SWARM_RANGED_DPS_KIT_HRIDS = {
  precision_rain: [
    "/abilities/berserk",
    "/abilities/precision",
    "/abilities/penetrating_shot",
    "/abilities/rain_of_arrows",
  ],
  frenzy_rain: [
    "/abilities/berserk",
    "/abilities/frenzy",
    "/abilities/penetrating_shot",
    "/abilities/rain_of_arrows",
  ],
};

export const SWARM_RANGED_DEBUFF_KIT_HRIDS = [
  "/abilities/berserk",
  "/abilities/precision",
  "/abilities/pestilent_shot",
  "/abilities/penetrating_shot",
];

export const SWARM_FIRE_FLAME_KIT_HRIDS = [
  "/abilities/elemental_affinity",
  "/abilities/firestorm",
  "/abilities/flame_blast",
  "/abilities/fireball",
];

/** Minority smoke-burst carriers (1–2) keep firestorm+smoke instead of flame_blast. */
export const SWARM_FIRE_SMOKE_KIT_HRIDS = [
  "/abilities/elemental_affinity",
  "/abilities/firestorm",
  "/abilities/smoke_burst",
  "/abilities/fireball",
];

function swarmFireUsesSmokeBurst(member, definition) {
  const smokeCount = Number(definition.fireSmokeBurstCount ?? 0);
  if (!Number.isFinite(smokeCount) || smokeCount <= 0) return false;
  return member.roleIndex < smokeCount;
}

export function ordinaryAbilityHridsForTemplate(member, definition = {}) {
  const role = member.combatType;
  const stBoss = isSingleTargetBossKey(definition.bossKey);
  const templates = abilityTemplatesForBoss(definition.bossKey);

  if (!stBoss && (member.combatType === "弓" || member.combatType === "弩")) {
    if (member.duty === "debuffer") {
      return [...SWARM_RANGED_DEBUFF_KIT_HRIDS];
    }
    const dpsKit = definition.rangedDpsKit ?? "precision_rain";
    const kit = SWARM_RANGED_DPS_KIT_HRIDS[dpsKit];
    if (!kit) {
      throw new Error(`Unknown swarm ranged DPS kit: ${dpsKit}`);
    }
    return [...kit];
  }

  if (!stBoss && member.combatType === "火") {
    return swarmFireUsesSmokeBurst(member, definition)
      ? [...SWARM_FIRE_SMOKE_KIT_HRIDS]
      : [...SWARM_FIRE_FLAME_KIT_HRIDS];
  }

  if (stBoss && role === "火") {
    return [...templates.火.required];
  }

  if (stBoss && role === "水") {
    const waterRole = member.waterRole ?? "dps";
    if (waterRole === "support") {
      return [...templates.水_support.required];
    }
    const middle =
      definition.waterDpsMiddle ??
      pickOptionalMiddle(templates.水_dps.optional, "precision")[0]?.split("/").at(-1);
    return [
      ...templates.水_dps.required.slice(0, 1),
      `/abilities/${middle}`,
      ...templates.水_dps.required.slice(1),
    ];
  }

  if (stBoss && role === "自") {
    if (member.duty === "healer") {
      const pollenCount = Number(
        definition.naturePollenCoverageCount ?? ST_NATURE_POLLEN_COVERAGE_COUNT,
      );
      const usePollen =
        member.naturePollenCoverage === true ||
        (Number.isFinite(member.roleIndex) && member.roleIndex < pollenCount);
      return usePollen
        ? [...ST_NATURE_HEALER_POLLEN_KIT]
        : [...ST_NATURE_HEALER_DRAIN_KIT];
    }
    const middle =
      definition.natureDpsMiddle ??
      pickOptionalMiddle(templates.自_dps.optional, "toxic_pollen")[0]?.split("/").at(-1);
    return [
      templates.自_dps.required[0],
      `/abilities/${middle}`,
      ...templates.自_dps.required.slice(1),
    ];
  }

  let template;
  if (role === "自") {
    template =
      member.duty === "healer" ? templates.自_healer : templates.自_dps;
  } else {
    template = templates[role];
  }
  if (!template) {
    throw new Error(`Unsupported combat type ${role}`);
  }

  const optional = [...template.optional];
  if (role === "弓" || role === "弩") {
    const preferred = definition.rangedOptional
      ? [`/abilities/${definition.rangedOptional}`]
      : [];
    optional.sort((left, right) => {
      const leftRank = preferred.indexOf(left);
      const rightRank = preferred.indexOf(right);
      return (
        (leftRank === -1 ? 99 : leftRank) - (rightRank === -1 ? 99 : rightRank) ||
        left.localeCompare(right)
      );
    });
  }
  if (role === "火" && definition.fireOptional) {
    const preferred = `/abilities/${definition.fireOptional}`;
    optional.sort((left, right) => {
      if (left === preferred) return -1;
      if (right === preferred) return 1;
      return left.localeCompare(right);
    });
  }
  if (role === "枪" && definition.spearOptional) {
    const preferred = `/abilities/${definition.spearOptional}`;
    optional.sort((left, right) => {
      if (left === preferred) return -1;
      if (right === preferred) return 1;
      return left.localeCompare(right);
    });
  }
  if (role === "盾" && definition.shieldOptional) {
    const preferred = `/abilities/${definition.shieldOptional}`;
    optional.sort((left, right) => {
      if (left === preferred) return -1;
      if (right === preferred) return 1;
      return left.localeCompare(right);
    });
  }

  const hrids = [...template.required, ...optional];
  if (!stBoss && role === "自" && member.duty === "healer") {
    return [...NATURE_HEALER_FIXED_KIT];
  }
  return hrids;
}
