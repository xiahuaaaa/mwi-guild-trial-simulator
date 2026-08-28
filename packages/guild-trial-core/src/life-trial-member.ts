import itemBonuses from "./life-trial-item-bonuses.json" with { type: "json" };
import {
  isGatheringSkill,
  type LifeTrialParticipant,
} from "./life-trial-sim.ts";

type Json = Record<string, unknown>;

export interface LifeTrialMemberStats extends LifeTrialParticipant {
  memberId: string;
  displayName: string;
  skillHrid: string;
  workForce: number;
}

const SKILL_ACTION_TYPES: Record<string, string> = {
  "/skills/alchemy": "/action_types/alchemy",
  "/skills/brewing": "/action_types/brewing",
  "/skills/cheesesmithing": "/action_types/cheesesmithing",
  "/skills/cooking": "/action_types/cooking",
  "/skills/crafting": "/action_types/crafting",
  "/skills/enhancing": "/action_types/enhancing",
  "/skills/foraging": "/action_types/foraging",
  "/skills/milking": "/action_types/milking",
  "/skills/tailoring": "/action_types/tailoring",
  "/skills/woodcutting": "/action_types/woodcutting",
};

const SKILL_EFFICIENCY_KEYS: Record<string, string> = {
  "/skills/alchemy": "alchemyEfficiency",
  "/skills/brewing": "brewingEfficiency",
  "/skills/cheesesmithing": "cheesesmithingEfficiency",
  "/skills/cooking": "cookingEfficiency",
  "/skills/crafting": "craftingEfficiency",
  "/skills/enhancing": "enhancingEfficiency",
  "/skills/foraging": "foragingEfficiency",
  "/skills/milking": "milkingEfficiency",
  "/skills/tailoring": "tailoringEfficiency",
  "/skills/woodcutting": "woodcuttingEfficiency",
};

const SKILL_SPEED_KEYS: Record<string, string> = {
  "/skills/alchemy": "alchemySpeed",
  "/skills/brewing": "brewingSpeed",
  "/skills/cheesesmithing": "cheesesmithingSpeed",
  "/skills/cooking": "cookingSpeed",
  "/skills/crafting": "craftingSpeed",
  "/skills/enhancing": "enhancingSpeed",
  "/skills/foraging": "foragingSpeed",
  "/skills/milking": "milkingSpeed",
  "/skills/tailoring": "tailoringSpeed",
  "/skills/woodcutting": "woodcuttingSpeed",
};

const BONUS_TABLE = itemBonuses as Record<
  string,
  Record<string, number>
>;

/** Default guild life trial participation floor (snapshot skill level). */
export const GUILD_TRIAL_MIN_LIFE_SKILL_LEVEL = 90;

/** Milking life trial uses a lower participation floor. */
export const GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL = 85;

/** Crafting life trial uses a higher participation floor. */
export const GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL = 100;

const MILKING_SKILL_HRID = "/skills/milking";
const CRAFTING_SKILL_HRID = "/skills/crafting";

export function guildTrialMinLifeSkillLevel(skillHrid: string): number {
  if (skillHrid === CRAFTING_SKILL_HRID) {
    return GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL;
  }
  if (skillHrid === MILKING_SKILL_HRID) {
    return GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL;
  }
  return GUILD_TRIAL_MIN_LIFE_SKILL_LEVEL;
}

export function readLifeSkillLevelFromSnapshot(
  snapshot: Json,
  skillHrid: string,
): number {
  const skills = snapshot.skills as Record<string, number> | undefined;
  const level = skills?.[skillHrid];
  return typeof level === "number" && level > 0 ? Math.floor(level) : 0;
}

export function memberMeetsGuildTrialLifeSkillThreshold(
  snapshot: Json,
  skillHrid: string,
  threshold = guildTrialMinLifeSkillLevel(skillHrid),
): boolean {
  return readLifeSkillLevelFromSnapshot(snapshot, skillHrid) >= threshold;
}

function sumEquipmentBonuses(
  equipment: Array<{ itemHrid?: string; enhancementLevel?: number }> | undefined,
  keys: string[],
): number {
  if (!equipment?.length) return 0;
  let total = 0;
  for (const slot of equipment) {
    const itemHrid = slot?.itemHrid;
    if (typeof itemHrid !== "string") continue;
    const row = BONUS_TABLE[itemHrid];
    if (!row) continue;
    const enhancement =
      typeof slot.enhancementLevel === "number" ? slot.enhancementLevel : 0;
    for (const key of keys) {
      const base = row[key];
      if (typeof base !== "number") continue;
      const perLevelKey = `${key}LevelBonus`;
      const perLevel = typeof row[perLevelKey] === "number" ? row[perLevelKey] : 0.002;
      total += base + enhancement * perLevel;
    }
  }
  return total;
}

function loadoutEquipment(
  loadout: Json | undefined,
): Array<{ itemHrid?: string; enhancementLevel?: number }> {
  const equipment = loadout?.equipment;
  return Array.isArray(equipment) ? equipment : [];
}

/**
 * Prefer the profession loadout for this activity (e.g. milking/foraging).
 * If missing, fall back to an all-actions loadout.
 */
export function selectLifeTrialLoadoutEquipment(
  snapshot: Json,
  actionTypeHrid: string,
): Array<{ itemHrid?: string; enhancementLevel?: number }> {
  const catalog = snapshot.loadoutCatalog as Json[] | undefined;
  if (!catalog?.length) return [];

  for (const loadout of catalog) {
    if (loadout?.category !== "profession") continue;
    if (String(loadout.actionTypeHrid ?? "") !== actionTypeHrid) continue;
    const equipment = loadoutEquipment(loadout);
    if (equipment.length) return equipment;
  }

  for (const loadout of catalog) {
    const actionType = String(loadout?.actionTypeHrid ?? "");
    const isAll =
      loadout?.category === "all" ||
      actionType === "/action_types/all" ||
      actionType === "";
    if (!isAll) continue;
    const equipment = loadoutEquipment(loadout);
    if (equipment.length) return equipment;
  }

  return [];
}

export function buildLifeTrialMemberStats(
  snapshot: Json,
  memberId: string,
  displayName: string,
  skillHrid: string,
): LifeTrialMemberStats | null {
  const level = readLifeSkillLevelFromSnapshot(snapshot, skillHrid);
  if (level <= 0) return null;
  if (level < guildTrialMinLifeSkillLevel(skillHrid)) return null;
  const actionType = SKILL_ACTION_TYPES[skillHrid];
  if (!actionType) return null;

  const equipment = selectLifeTrialLoadoutEquipment(snapshot, actionType);
  const efficiencyKey = SKILL_EFFICIENCY_KEYS[skillHrid] ?? "";
  const speedKey = SKILL_SPEED_KEYS[skillHrid] ?? "";
  const efficiency = sumEquipmentBonuses(equipment, [
    efficiencyKey,
    "skillingEfficiency",
  ]);
  const actionSpeed = sumEquipmentBonuses(equipment, [speedKey, "skillingSpeed"]);
  // Labyrinth clear-rate calculator: gathering buff → double progress on
  // milking/WC/foraging. Equipment `gatheringQuantity` maps to that buff.
  const gatheringBonus = isGatheringSkill(skillHrid)
    ? sumEquipmentBonuses(equipment, ["gatheringQuantity"])
    : 0;
  // Gourmet is a separate buff (`/buff_types/gourmet`), not rare-find.
  // Snapshots do not yet carry house/community gourmet; keep 0.
  const gourmetBonus = 0;
  const workForce = Math.floor(level * (1 + efficiency));

  return {
    memberId,
    displayName,
    skillHrid,
    skillLevel: level,
    levelBonuses: 0,
    efficiency,
    actionSpeed,
    successBonus: 0,
    supplyCrateBonus: 0,
    gatheringBonus,
    gourmetBonus,
    workForce,
  };
}
