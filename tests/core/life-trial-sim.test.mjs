import assert from "node:assert/strict";
import test from "node:test";

import { buildLifeTrialMemberStats } from "../../packages/guild-trial-core/src/life-trial-member.ts";
import {
  LIFE_TRIAL_DURATION_SECONDS,
  expectedProgressPerSecond,
  simulateLifeTrialExpected,
} from "../../packages/guild-trial-core/src/life-trial-sim.ts";
import { lifeTrialBaseActionSeconds } from "../../packages/guild-trial-core/src/life-trial.ts";
import { skillingTrialBasePoints } from "../../packages/guild-trial-core/src/scoring.ts";

// Screenshot work time ~4.6s with 10s base → speed = 10/4.6 − 1
const milkingParticipant = {
  skillLevel: 134,
  efficiency: 0,
  actionSpeed: 10 / 4.6 - 1,
  gatheringBonus: 0.3134,
};

test("expected progress rate is positive for calibrated milking panel", () => {
  const rate = expectedProgressPerSecond(
    [milkingParticipant],
    120,
    lifeTrialBaseActionSeconds("/skills/milking"),
  );
  assert.ok(rate > 20);
  assert.ok(rate < 40);
});

test("3600s simulation clears multiple layers for a strong roster", () => {
  const participants = Array.from({ length: 22 }, () => milkingParticipant);
  const result = simulateLifeTrialExpected({
    skillHrid: "/skills/milking",
    participants,
    durationSeconds: LIFE_TRIAL_DURATION_SECONDS,
  });
  assert.ok(result.levelsCleared >= 8);
  assert.equal(result.basePoints, skillingTrialBasePoints(result.levelsCleared));
  assert.ok(result.assumptions.includes("tea_crate_zero"));
  assert.ok(!result.assumptions.includes("labyrinth_enhancing"));
});

test("enhancing uses shared progress bar with 8s base action", () => {
  const participants = Array.from({ length: 12 }, () => ({
    skillLevel: 120,
    efficiency: 0.5,
    actionSpeed: 0.5,
  }));
  const enhancing = simulateLifeTrialExpected({
    skillHrid: "/skills/enhancing",
    participants,
    durationSeconds: LIFE_TRIAL_DURATION_SECONDS,
  });
  const milkingSameStats = simulateLifeTrialExpected({
    skillHrid: "/skills/milking",
    participants,
    durationSeconds: LIFE_TRIAL_DURATION_SECONDS,
  });
  assert.ok(enhancing.assumptions.includes("enhancing_progress_bar_8s"));
  assert.ok(!enhancing.assumptions.includes("labyrinth_enhancing"));
  // Same panels: enhancing (8s base) clears at least as many floors as milking (10s).
  assert.ok(enhancing.levelsCleared >= milkingSameStats.levelsCleared);
  const rateEnhancing = expectedProgressPerSecond(
    participants,
    120,
    lifeTrialBaseActionSeconds("/skills/enhancing"),
  );
  const rateMilking = expectedProgressPerSecond(
    participants,
    120,
    lifeTrialBaseActionSeconds("/skills/milking"),
  );
  assert.ok(rateEnhancing > rateMilking);
  assert.ok(Math.abs(rateEnhancing / rateMilking - 10 / 8) < 1e-9);
});

test("gourmet is not proxied from rare-find equipment stats", () => {
  const cookingSnapshot = {
    skills: { "/skills/cooking": 100 },
    loadoutCatalog: [
      {
        category: "profession",
        actionTypeHrid: "/action_types/cooking",
        equipment: [{ itemHrid: "/items/chefs_top", enhancementLevel: 0 }],
      },
    ],
  };
  const stats = buildLifeTrialMemberStats(
    cookingSnapshot,
    "chef",
    "Chef",
    "/skills/cooking",
  );
  assert.ok(stats);
  // chefs_top has cookingRareFind but that is not gourmet double-progress.
  assert.equal(stats.gourmetBonus, 0);
});
