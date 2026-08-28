import assert from "node:assert/strict";
import test from "node:test";

import {
  formatLifeAssignmentReportSummary,
  renderLifeAssignmentReportHtml,
  estimateLifeAssignmentReportHeight,
  LIFE_ASSIGNMENT_PUBLIC_PNG_URL,
  finalLevelProgressPercent,
} from "../../apps/qq-bot/src/life-assignment-report.ts";
import type { LifeAssignmentRun } from "../../packages/guild-trial-core/src/life-trial-optimizer.ts";

const trialProgress = (
  expectedLevelsCleared: number,
  finalLevel: number,
  remainingProgress: number,
  finalLevelRequired: number,
) => ({
  expectedLevelsCleared,
  basePoints: expectedLevelsCleared === 0 ? 0 : 200 + (expectedLevelsCleared - 1) * 100,
  finalLevel,
  remainingProgress,
  finalLevelRequired,
});

const sampleRun: LifeAssignmentRun = {
  weekStartAt: "2026-07-31T00:00:00.000Z",
  generatedAt: "2026-08-04T02:30:00.000Z",
  totalBasePoints: 3400,
  assumptions: ["tea_crate_zero"],
  unassigned: ["idle1", "idle2"],
  trials: [
    {
      trialHrid: "/guild_skilling/foraging",
      trialName: "采摘",
      skillHrid: "/skills/foraging",
      maxParticipants: 24,
      roster: ["alice", "bob", "carol"],
      ...trialProgress(8, 180, 42000, 88000),
    },
    {
      trialHrid: "/guild_skilling/crafting",
      trialName: "制作",
      skillHrid: "/skills/crafting",
      maxParticipants: 24,
      roster: ["dave"],
      ...trialProgress(7, 170, 30000, 84000),
    },
    {
      trialHrid: "/guild_skilling/milking",
      trialName: "挤奶",
      skillHrid: "/skills/milking",
      maxParticipants: 24,
      roster: [],
      ...trialProgress(0, 100, 0, 48000),
    },
    {
      trialHrid: "/guild_skilling/alchemy",
      trialName: "炼金",
      skillHrid: "/skills/alchemy",
      maxParticipants: 24,
      roster: Array.from({ length: 12 }, (_, i) => `m${i}`),
      ...trialProgress(9, 190, 51000, 92000),
    },
  ],
};

test("formatLifeAssignmentReportSummary points to the public image", () => {
  const text = formatLifeAssignmentReportSummary(sampleRun);
  assert.match(text, /本周生活分工推荐/u);
  assert.match(text, /Weekly Life Trial Assignments/u);
  assert.match(text, /3400/u);
  assert.match(text, /完整名单见下图/u);
  assert.match(text, new RegExp(LIFE_ASSIGNMENT_PUBLIC_PNG_URL.replaceAll(".", "\\."), "u"));
  assert.doesNotMatch(text, /alice、bob/u);
  assert.doesNotMatch(text, /假设|tea_crate/u);
});

test("renderLifeAssignmentReportHtml is bilingual and omits assumptions", () => {
  const html = renderLifeAssignmentReportHtml(sampleRun);
  assert.match(html, /本周生活分工推荐/u);
  assert.match(html, /Weekly Life Trial Assignments/u);
  for (const name of ["采摘", "制作", "挤奶", "炼金"]) {
    assert.match(html, new RegExp(name, "u"));
  }
  for (const name of ["Foraging", "Crafting", "Milking", "Alchemy"]) {
    assert.match(html, new RegExp(name, "u"));
  }
  assert.match(html, /alice/u);
  assert.match(html, /未分配（2）/u);
  assert.match(html, /Unassigned \(2\)/u);
  assert.match(html, /推荐名单/u);
  assert.match(html, /Recommended roster/u);
  assert.match(
    html,
    new RegExp(
      `末层 <b>Lv\\.180</b> <b>${finalLevelProgressPercent(sampleRun.trials[0])}%</b>`,
      "u",
    ),
  );
  assert.match(html, /公会周：2026-07-31 · 生成于：2026-08-04 10:30:00 北京时间/u);
  assert.doesNotMatch(html, /2026-08-04T02:30:00\.000Z/u);
  assert.doesNotMatch(html, /假设|tea_crate/u);
  assert.match(html, /grid-template-columns:repeat\(2,/u);
});

test("estimateLifeAssignmentReportHeight scales with roster size", () => {
  const short = estimateLifeAssignmentReportHeight({
    ...sampleRun,
    trials: sampleRun.trials.map((trial) => ({ ...trial, roster: ["only"] })),
    unassigned: [],
  });
  const tall = estimateLifeAssignmentReportHeight(sampleRun);
  assert.ok(tall >= short);
  assert.ok(tall > 400);
});

test("estimateLifeAssignmentReportHeight covers full 24-player roster with unassigned", () => {
  const fullRoster = Array.from({ length: 24 }, (_, index) => `player-${index}`);
  const height = estimateLifeAssignmentReportHeight({
    ...sampleRun,
    trials: sampleRun.trials.map((trial) => ({ ...trial, roster: fullRoster })),
    unassigned: Array.from({ length: 13 }, (_, index) => `idle-${index}`),
  });
  assert.ok(height >= 1080);
});
