import assert from "node:assert/strict";
import test from "node:test";
import {
  compareMaxNoWipe,
  compareProgressFirst,
  progressFirstScore,
  standardLabScore,
} from "../../scripts/combat-lab-score.mjs";

test("standard lab score penalizes deaths enough to beat leftover progress", () => {
  const clear = {
    wavesCleared: 12,
    totalDeaths: 8,
    finalMonsterHp: 20,
    finalMonsterMaxHp: 100,
  };
  const safer = {
    wavesCleared: 12,
    totalDeaths: 0,
    finalMonsterHp: 90,
    finalMonsterMaxHp: 100,
  };
  assert.ok(standardLabScore(safer) > standardLabScore(clear));
});

test("progress-first insanity score prefers last-floor progress over deaths", () => {
  const aggressive = {
    wavesCleared: 12,
    totalDeaths: 40,
    finalMonsterHp: 20,
    finalMonsterMaxHp: 100,
    stopReason: "time_cap",
  };
  const safer = {
    wavesCleared: 12,
    totalDeaths: 0,
    finalMonsterHp: 80,
    finalMonsterMaxHp: 100,
    stopReason: "time_cap",
  };
  assert.ok(progressFirstScore(aggressive) > progressFirstScore(safer));
  assert.ok(standardLabScore(safer) > standardLabScore(aggressive));
});

test("progress-first score disqualifies a party wipe behind any non-wipe", () => {
  const wipe = {
    wavesCleared: 14,
    totalDeaths: 0,
    finalProgressPercent: 90,
    stopReason: "party_wipe",
  };
  const alive = {
    wavesCleared: 1,
    totalDeaths: 99,
    finalProgressPercent: 1,
    stopReason: "time_cap",
  };
  assert.ok(progressFirstScore(alive) > progressFirstScore(wipe));
});

test("progress-first ties break toward the more aggressive count", () => {
  const low = { score: 12_000_000.4, count: 16 };
  const high = { score: 12_000_000.4, count: 32 };
  assert.ok(compareProgressFirst(high, low) < 0);
});

test("max-no-wipe ranking prefers the highest x that did not wipe", () => {
  const wiped = {
    count: 39,
    anyWipe: true,
    score: 13_000_000.9,
    runs: [{ stopReason: "party_wipe", wavesCleared: 13 }],
  };
  const highAlive = {
    count: 32,
    anyWipe: false,
    score: 12_000_000.2,
    runs: [{ stopReason: "time_cap", wavesCleared: 12 }],
  };
  const lowAlive = {
    count: 24,
    anyWipe: false,
    score: 13_000_000.5,
    runs: [{ stopReason: "time_cap", wavesCleared: 13 }],
  };
  assert.ok(compareMaxNoWipe(highAlive, wiped) < 0);
  assert.ok(compareMaxNoWipe(highAlive, lowAlive) < 0);
});
