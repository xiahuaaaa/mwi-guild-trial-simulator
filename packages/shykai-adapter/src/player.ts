import type {
  SanitizedGuildTrialPlayerDto,
  ShykaiPlayerDto,
} from "./dto.ts";

export interface SanitizedPlayerResult {
  readonly player: SanitizedGuildTrialPlayerDto;
  readonly removedFoodSlots: number;
  readonly removedDrinkSlots: number;
}

/**
 * Mirrors the fields consumed by upstream `Player.createFromDTO`, while
 * stripping every consumable before `Consumable.createFromDTO` can run.
 */
export function sanitizeGuildTrialPlayerDto(
  input: ShykaiPlayerDto,
  memberId: string,
): SanitizedPlayerResult {
  validatePlayerDto(input);
  if (memberId.trim().length === 0) {
    throw new Error("canonical memberId must not be empty");
  }
  const removedFoodSlots = input.food.filter((entry) => entry !== null).length;
  const removedDrinkSlots = input.drinks.filter((entry) => entry !== null).length;
  const player: SanitizedGuildTrialPlayerDto = {
    ...structuredClone(input),
    hrid: memberId,
    food: [],
    drinks: [],
  };
  assertGuildTrialPlayerHasNoConsumables(player);
  return { player, removedFoodSlots, removedDrinkSlots };
}

export function assertGuildTrialPlayerHasNoConsumables(
  input: Pick<ShykaiPlayerDto, "food" | "drinks">,
): void {
  if (input.food.length !== 0 || input.drinks.length !== 0) {
    throw new Error("guild-trial player DTO contains forbidden consumables");
  }
}

export function validatePlayerDto(input: ShykaiPlayerDto): void {
  if (input.hrid.trim().length === 0) {
    throw new Error("player hrid must not be empty");
  }
  for (const [field, value] of [
    ["staminaLevel", input.staminaLevel],
    ["intelligenceLevel", input.intelligenceLevel],
    ["attackLevel", input.attackLevel],
    ["meleeLevel", input.meleeLevel],
    ["defenseLevel", input.defenseLevel],
    ["rangedLevel", input.rangedLevel],
    ["magicLevel", input.magicLevel],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${field} must be finite and non-negative`);
    }
  }
  if (!Array.isArray(input.food) || !Array.isArray(input.drinks)) {
    throw new Error("player consumable slots must be arrays");
  }
  if (!Array.isArray(input.abilities)) {
    throw new Error("player abilities must be an array");
  }
}
