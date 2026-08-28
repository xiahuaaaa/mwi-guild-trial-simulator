import assert from "node:assert/strict";
import test from "node:test";

import {
  LIFE_TRIAL_BASE_ACTION_SECONDS,
  LIFE_TRIAL_ENHANCING_BASE_ACTION_SECONDS,
  lifeTrialActionSeconds,
  lifeTrialBaseActionSeconds,
  lifeTrialDoubleProgressChance,
  lifeTrialEffectiveLevel,
  lifeTrialSuccessRate,
  lifeTrialWorkForce,
  scaledLifeTrialProgress,
  unscaledLifeTrialProgress,
} from "../../packages/guild-trial-core/src/life-trial.ts";

test("unscaled progress matches 400 × (level + 20)", () => {
  assert.equal(unscaledLifeTrialProgress(100), 48000);
  assert.equal(unscaledLifeTrialProgress(120), 56000);
  assert.equal(unscaledLifeTrialProgress(130), 60000);
  assert.equal(unscaledLifeTrialProgress(300), 128000);
});

test("scaled progress matches Lv.120/130 @ 22 participants screenshots", () => {
  // 2026-07-28 live trial UI: milking 68320, crafting 73200
  assert.equal(scaledLifeTrialProgress(120, 22), 68320);
  assert.equal(scaledLifeTrialProgress(130, 22), 73200);
});

test("success rate uses asymmetric level bonus around base 80%", () => {
  assert.equal(lifeTrialSuccessRate(120, 120), 0.8);
  // −1 level → 0.8 × (1 − 0.01) = 0.792
  assert.equal(lifeTrialSuccessRate(119, 120), 0.792);
  // +1 level → 0.8 × (1 + 0.005) = 0.804
  assert.ok(Math.abs(lifeTrialSuccessRate(121, 120) - 0.804) < 1e-12);
  // milking screenshot 57.6% @ Lv.120 with no extra success bonus → eff 92
  assert.equal(lifeTrialSuccessRate(92, 120), 0.576);
  // crafting screenshot 47.2% @ Lv.130 → eff 89
  assert.equal(lifeTrialSuccessRate(89, 130), 0.472);
});

test("success rate clamps and applies success bonus", () => {
  assert.equal(lifeTrialSuccessRate(1, 300), 0);
  assert.ok(lifeTrialSuccessRate(300, 100, 0.5) <= 1);
  assert.equal(lifeTrialSuccessRate(120, 120, 0.1), 0.8 * 1.1);
});

test("work force floors effective level × (1 + efficiency)", () => {
  assert.equal(lifeTrialWorkForce(100, 0.23), 123);
  assert.equal(lifeTrialWorkForce(134, 0), 134);
  assert.equal(lifeTrialWorkForce(152.9, 0), 152);
});

test("double progress sums supply + gathering + gourmet", () => {
  assert.ok(
    Math.abs(lifeTrialDoubleProgressChance(0.1, 0.15, 0.0634) - 0.3134) < 1e-12,
  );
  assert.equal(lifeTrialDoubleProgressChance(0.8, 0.5, 0.5), 1);
});

test("non-enhancing base action is 10s; enhancing compensation is 8s", () => {
  assert.equal(LIFE_TRIAL_BASE_ACTION_SECONDS, 10);
  assert.equal(LIFE_TRIAL_ENHANCING_BASE_ACTION_SECONDS, 8);
  assert.equal(lifeTrialBaseActionSeconds("/skills/milking"), 10);
  assert.equal(lifeTrialBaseActionSeconds("/skills/enhancing"), 8);
  // milking screenshot ~4.6s with 10s base → speed = 10/4.6 − 1
  const milkingSpeed = 10 / 4.6 - 1;
  assert.ok(Math.abs(lifeTrialActionSeconds(milkingSpeed, 10) - 4.6) < 1e-9);
  assert.equal(lifeTrialEffectiveLevel(90, 2), 92);
});
