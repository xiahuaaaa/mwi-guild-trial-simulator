import { GUILD_TRIAL_START_LEVEL } from "./types.ts";

/**
 * Confirmed 2026-07-28 from a live 试炼水母 floor-15 / Lv.240 fight with 47
 * participants: unscaled HP/MP were 1,125,000 while Lv.100 fixture HP/MP are
 * 495,000. That matches:
 *
 *   pool(level) = floor(level100Pool * (level + 10) / 110)
 *
 * which is equivalent to adding level100Pool/110 per level above 100 when the
 * Lv.100 pool is divisible by 110 (495000 / 110 = 4500).
 *
 * Participant HP scaling (+1% each) is applied separately after this pool.
 */
export const GUILD_TRIAL_MONSTER_POOL_DENOMINATOR = 110 as const;
export const GUILD_TRIAL_MONSTER_POOL_SCALING_POLICY_ID =
  "guild-trial-level-plus-10-over-110-v1" as const;

export function guildTrialMonsterPoolAtLevel(
  level100Pool: number,
  level: number,
): number {
  if (!Number.isFinite(level100Pool) || level100Pool < 0) {
    throw new RangeError("level100Pool must be a non-negative finite number");
  }
  if (!Number.isSafeInteger(level) || level < GUILD_TRIAL_START_LEVEL) {
    throw new RangeError(
      `monster level must be a safe integer >= ${GUILD_TRIAL_START_LEVEL}`,
    );
  }
  return Math.floor(
    (level100Pool * (level + 10)) / GUILD_TRIAL_MONSTER_POOL_DENOMINATOR,
  );
}
