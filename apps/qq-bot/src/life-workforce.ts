type Json = Record<string, unknown>;

// Profession equipment efficiency bonuses (base + per enhancement level).
// Pre-computed from itemDetailMap.json.js — only items with noncombat XEfficiency stats.
const PROFESSION_ITEM_BONUSES: Record<string, Record<string, { b: number; p: number }>> = {
  "/items/alchemists_bottoms": { alchemyEfficiency: { b: 0.1, p: 0.002 } },
  "/items/alchemists_top": { alchemyEfficiency: { b: 0.1, p: 0.002 } },
  "/items/brewers_bottoms": { brewingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/brewers_top": { brewingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/cheesemakers_bottoms": { cheesesmithingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/cheesemakers_top": { cheesesmithingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/chefs_bottoms": { cookingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/chefs_top": { cookingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/collectors_boots": {
    foragingEfficiency: { b: 0.1, p: 0.002 },
    milkingEfficiency: { b: 0.1, p: 0.002 },
    woodcuttingEfficiency: { b: 0.1, p: 0.002 },
  },
  "/items/crafters_bottoms": { craftingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/crafters_top": { craftingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/dairyhands_bottoms": { milkingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/dairyhands_top": { milkingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/enchanted_gloves": { alchemyEfficiency: { b: 0.1, p: 0.002 } },
  "/items/eye_watch": {
    cheesesmithingEfficiency: { b: 0.1, p: 0.002 },
    craftingEfficiency: { b: 0.1, p: 0.002 },
    tailoringEfficiency: { b: 0.1, p: 0.002 },
  },
  "/items/foragers_bottoms": { foragingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/foragers_top": { foragingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/lumberjacks_bottoms": { woodcuttingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/lumberjacks_top": { woodcuttingEfficiency: { b: 0.1, p: 0.002 } },
  "/items/red_culinary_hat": {
    brewingEfficiency: { b: 0.1, p: 0.002 },
    cookingEfficiency: { b: 0.1, p: 0.002 },
  },
  "/items/tailors_bottoms": { tailoringEfficiency: { b: 0.1, p: 0.002 } },
  "/items/tailors_top": { tailoringEfficiency: { b: 0.1, p: 0.002 } },
};

export const LIFE_SKILLS = [
  { hrid: "/skills/alchemy", actionType: "/action_types/alchemy", efficiencyKey: "alchemyEfficiency", name: "炼金" },
  { hrid: "/skills/brewing", actionType: "/action_types/brewing", efficiencyKey: "brewingEfficiency", name: "冲泡" },
  { hrid: "/skills/cheesesmithing", actionType: "/action_types/cheesesmithing", efficiencyKey: "cheesesmithingEfficiency", name: "奶酪锻造" },
  { hrid: "/skills/cooking", actionType: "/action_types/cooking", efficiencyKey: "cookingEfficiency", name: "烹饪" },
  { hrid: "/skills/crafting", actionType: "/action_types/crafting", efficiencyKey: "craftingEfficiency", name: "制作" },
  { hrid: "/skills/enhancing", actionType: "/action_types/enhancing", efficiencyKey: "enhancingEfficiency", name: "强化" },
  { hrid: "/skills/foraging", actionType: "/action_types/foraging", efficiencyKey: "foragingEfficiency", name: "采集" },
  { hrid: "/skills/milking", actionType: "/action_types/milking", efficiencyKey: "milkingEfficiency", name: "挤奶" },
  { hrid: "/skills/tailoring", actionType: "/action_types/tailoring", efficiencyKey: "tailoringEfficiency", name: "裁缝" },
  { hrid: "/skills/woodcutting", actionType: "/action_types/woodcutting", efficiencyKey: "woodcuttingEfficiency", name: "伐木" },
] as const;

function loadoutEquipment(
  loadout: Json | undefined,
): Array<{ itemHrid?: string; enhancementLevel?: number }> {
  const equipment = loadout?.equipment as
    | Array<{ itemHrid?: string; enhancementLevel?: number }>
    | undefined;
  return Array.isArray(equipment) ? equipment : [];
}

/**
 * Prefer the matching profession loadout (挤奶/采集/…).
 * Fall back to all-actions when that activity loadout is missing.
 */
export function selectWorkforceEquipment(
  snapshot: Json,
  actionType: string,
): Array<{ itemHrid?: string; enhancementLevel?: number }> {
  const loadoutCatalog = snapshot?.loadoutCatalog as Json[] | undefined;
  if (!loadoutCatalog?.length) return [];

  for (const loadout of loadoutCatalog) {
    if (loadout?.category !== "profession") continue;
    if (String(loadout.actionTypeHrid ?? "") !== actionType) continue;
    const equipment = loadoutEquipment(loadout);
    if (equipment.length) return equipment;
  }

  for (const loadout of loadoutCatalog) {
    const actionTypeHrid = String(loadout?.actionTypeHrid ?? "");
    const isAll =
      loadout?.category === "all" ||
      actionTypeHrid === "/action_types/all" ||
      actionTypeHrid === "";
    if (!isAll) continue;
    const equipment = loadoutEquipment(loadout);
    if (equipment.length) return equipment;
  }

  return [];
}

/** Compute work force for one member and one life skill. */
export function computeWorkforce(
  snapshot: Json,
  skillHrid: string,
  actionType: string,
  efficiencyKey: string,
): number {
  const skills = snapshot?.skills as Record<string, unknown> | undefined;
  const skillLevel = typeof skills?.[skillHrid] === "number"
    ? (skills[skillHrid] as number)
    : 0;
  if (skillLevel <= 0) return 0;

  let totalEfficiency = 0;
  for (const slot of selectWorkforceEquipment(snapshot, actionType)) {
    const itemHrid = slot?.itemHrid;
    if (typeof itemHrid !== "string") continue;
    const bonuses = PROFESSION_ITEM_BONUSES[itemHrid];
    if (!bonuses) continue;
    const eff = bonuses[efficiencyKey];
    if (!eff) continue;
    const enhancement = typeof slot.enhancementLevel === "number" ? slot.enhancementLevel : 0;
    totalEfficiency += eff.b + enhancement * eff.p;
  }

  return Math.floor(skillLevel * (1 + totalEfficiency));
}
