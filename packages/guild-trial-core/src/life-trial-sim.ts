import {
  lifeTrialActionSeconds,
  lifeTrialBaseActionSeconds,
  lifeTrialDoubleProgressChance,
  lifeTrialEffectiveLevel,
  lifeTrialSuccessRate,
  lifeTrialWorkForce,
  scaledLifeTrialProgress,
} from "./life-trial.ts";
import { skillingTrialBasePoints } from "./scoring.ts";

export const LIFE_TRIAL_DURATION_SECONDS = 3600;
export const LIFE_TRIAL_START_LEVEL = 100;
export const LIFE_TRIAL_LEVEL_STEP = 10;
export const LIFE_TRIAL_MAX_LEVEL = 300;

export interface LifeTrialParticipant {
  skillLevel: number;
  levelBonuses?: number;
  efficiency?: number;
  actionSpeed?: number;
  successBonus?: number;
  supplyCrateBonus?: number;
  gatheringBonus?: number;
  gourmetBonus?: number;
}

export interface LifeTrialSimInput {
  skillHrid: string;
  participants: readonly LifeTrialParticipant[];
  durationSeconds?: number;
  isEnhancing?: boolean;
}

export interface LifeTrialSimResult {
  participantCount: number;
  levelsCleared: number;
  basePoints: number;
  finalLevel: number;
  remainingProgress: number;
  progressPerSecond: number;
  assumptions: string[];
}

const GATHERING_SKILLS = new Set([
  "/skills/milking",
  "/skills/woodcutting",
  "/skills/foraging",
]);
const GOURMET_SKILLS = new Set(["/skills/cooking", "/skills/brewing"]);

export function expectedProgressPerSecond(
  participants: readonly LifeTrialParticipant[],
  roomLevel: number,
  baseActionSeconds = lifeTrialBaseActionSeconds("/skills/milking"),
): number {
  let total = 0;
  for (const participant of participants) {
    const effectiveLevel = lifeTrialEffectiveLevel(
      participant.skillLevel,
      participant.levelBonuses ?? 0,
    );
    const successRate = lifeTrialSuccessRate(
      effectiveLevel,
      roomLevel,
      participant.successBonus ?? 0,
    );
    const workForce = lifeTrialWorkForce(
      effectiveLevel,
      participant.efficiency ?? 0,
    );
    const doubleChance = lifeTrialDoubleProgressChance(
      participant.supplyCrateBonus ?? 0,
      participant.gatheringBonus ?? 0,
      participant.gourmetBonus ?? 0,
    );
    const actionSeconds = lifeTrialActionSeconds(
      participant.actionSpeed ?? 0,
      baseActionSeconds,
    );
    const expectedPerAction = successRate * workForce * (1 + doubleChance);
    total += expectedPerAction / actionSeconds;
  }
  return total;
}

/**
 * Guild life trials (including enhancing) share one progress-bar climb.
 * Enhancing only differs by base action time (8s vs 10s).
 */
export function simulateLifeTrialExpected(
  input: LifeTrialSimInput,
): LifeTrialSimResult {
  const participants = input.participants ?? [];
  const durationSeconds = input.durationSeconds ?? LIFE_TRIAL_DURATION_SECONDS;
  const isEnhancing =
    input.isEnhancing ?? input.skillHrid === "/skills/enhancing";
  const assumptions = ["tea_crate_zero"];
  if (isEnhancing) assumptions.push("enhancing_progress_bar_8s");

  if (!participants.length || durationSeconds <= 0) {
    return {
      participantCount: participants.length,
      levelsCleared: 0,
      basePoints: 0,
      finalLevel: LIFE_TRIAL_START_LEVEL,
      remainingProgress: 0,
      progressPerSecond: 0,
      assumptions,
    };
  }

  const baseActionSeconds = lifeTrialBaseActionSeconds(
    input.skillHrid,
    isEnhancing,
  );
  let level = LIFE_TRIAL_START_LEVEL;
  let cleared = 0;
  let pool = 0;
  let timeLeft = durationSeconds;

  while (timeLeft > 0 && level < LIFE_TRIAL_MAX_LEVEL) {
    const required = scaledLifeTrialProgress(level, participants.length);
    const rate = expectedProgressPerSecond(
      participants,
      level,
      baseActionSeconds,
    );
    if (rate <= 0) break;
    const timeToClear = (required - pool) / rate;
    if (timeToClear <= timeLeft) {
      cleared += 1;
      level += LIFE_TRIAL_LEVEL_STEP;
      pool = 0;
      timeLeft -= timeToClear;
      continue;
    }
    pool += rate * timeLeft;
    timeLeft = 0;
  }

  const progressPerSecond = expectedProgressPerSecond(
    participants,
    level,
    baseActionSeconds,
  );
  return {
    participantCount: participants.length,
    levelsCleared: cleared,
    basePoints: skillingTrialBasePoints(cleared),
    finalLevel: level,
    remainingProgress: pool,
    progressPerSecond,
    assumptions,
  };
}

export function isGatheringSkill(skillHrid: string): boolean {
  return GATHERING_SKILLS.has(skillHrid);
}

export function isGourmetSkill(skillHrid: string): boolean {
  return GOURMET_SKILLS.has(skillHrid);
}

export function isEnhancingSkill(skillHrid: string): boolean {
  return skillHrid === "/skills/enhancing";
}
