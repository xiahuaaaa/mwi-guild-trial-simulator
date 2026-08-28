import assert from "node:assert/strict";
import test from "node:test";

import {
  collectCombatAssignmentNames,
  collectLifeAssignmentNames,
  filterActiveRegistrationTrials,
  formatSignupAssignmentMismatches,
  formatUnassignedAssignmentMembers,
  pickLifeAssignmentForWeek,
} from "../../apps/qq-bot/src/trial-signup-check.ts";

test("collects life and combat assignment roster names", () => {
  assert.deepEqual(
    collectLifeAssignmentNames({
      trials: [
        { roster: ["alice", "bob"] },
        { roster: ["cara"] },
      ],
    }),
    ["alice", "bob", "cara"],
  );
  assert.deepEqual(
    collectCombatAssignmentNames({
      bosses: [
        { roster: [{ memberId: "dave" }, { memberId: "erin" }] },
        { roster: [{ memberId: "frank" }] },
      ],
    }),
    ["dave", "erin", "frank"],
  );
});

test("lists guild members missing from both life and combat assignment results", () => {
  const text = formatUnassignedAssignmentMembers({
    rosterMembers: [
      { memberId: "alice", displayName: "alice" },
      { memberId: "bob", displayName: "bob" },
      { memberId: "cara", displayName: "cara" },
      { memberId: "dave", displayName: "dave" },
    ],
    lifeAssignment: {
      weekStartAt: "2026-08-07T00:00:00.000Z",
      trials: [{ roster: ["alice"] }],
    },
    combatAssignment: {
      generatedAt: "2026-08-07T03:17:40.857Z",
      bosses: [{ roster: [{ memberId: "bob" }] }],
    },
  });
  assert.match(text, /都未进 2/u);
  assert.match(text, /cara/u);
  assert.match(text, /dave/u);
  assert.doesNotMatch(text, /1\. alice/u);
  assert.doesNotMatch(text, /1\. bob/u);
});

test("warns when only one assignment side is available", () => {
  const text = formatUnassignedAssignmentMembers({
    rosterMembers: [{ memberId: "alice" }, { memberId: "bob" }],
    lifeAssignment: null,
    combatAssignment: {
      bosses: [{ roster: [{ memberId: "alice" }] }],
    },
  });
  assert.match(text, /尚无生活分工结果/u);
  assert.match(text, /bob/u);
});

test("prefers this week's life test assignment over last week's formal", () => {
  const picked = pickLifeAssignmentForWeek({
    expectedWeekStartAt: "2026-08-21T00:00:00.000Z",
    formal: {
      weekStartAt: "2026-08-14T00:00:00.000Z",
      assignment: { weekStartAt: "2026-08-14T00:00:00.000Z", trials: [{ roster: ["old"] }] },
    },
    test: {
      weekStartAt: "2026-08-21T00:00:00.000Z",
      assignment: { weekStartAt: "2026-08-21T00:00:00.000Z", trials: [{ roster: ["new"] }] },
    },
  });
  assert.equal(picked.source, "test");
  assert.deepEqual(collectLifeAssignmentNames(picked.assignment), ["new"]);
});

test("prefers the newer generatedAt when both life assignments are this week", () => {
  const picked = pickLifeAssignmentForWeek({
    expectedWeekStartAt: "2026-08-21T00:00:00.000Z",
    formal: {
      weekStartAt: "2026-08-21T00:00:00.000Z",
      assignment: {
        weekStartAt: "2026-08-21T00:00:00.000Z",
        generatedAt: "2026-08-21T07:18:47.876Z",
        trials: [{
          trialHrid: "/guild_skilling/foraging",
          trialName: "采摘",
          roster: ["Atlus"],
        }],
      },
    },
    test: {
      weekStartAt: "2026-08-21T00:00:00.000Z",
      assignment: {
        weekStartAt: "2026-08-21T00:00:00.000Z",
        generatedAt: "2026-08-22T01:00:00.000Z",
        trials: [{
          trialHrid: "/guild_skilling/cheesesmithing",
          trialName: "奶酪锻造",
          roster: ["Atlus"],
        }],
      },
    },
  });
  assert.equal(picked.source, "test");
  const text = formatSignupAssignmentMismatches({
    weekStartAt: "2026-08-21T00:00:00.000Z",
    registrationTrials: [{
      kind: "skilling",
      weekStartAt: "2026-08-21T00:00:00.000Z",
      trialHrid: "/guild_skilling/cheesesmithing",
      trialName: "奶酪锻造",
      members: [{ memberId: "Atlus" }, { memberId: "yangguangniuzi" }],
    }],
    lifeAssignment: picked.assignment,
    lifeSource: picked.source,
  });
  assert.doesNotMatch(text, /Atlus：/u);
  assert.doesNotMatch(text, /分配「采摘」/u);
  assert.match(text, /生活分工来源：测试方案/u);
  assert.match(text, /yangguangniuzi：报名「奶酪锻造」，未在模拟分工/u);
});

test("signup check follows the published life report even if a newer unpublished formal exists", () => {
  const picked = pickLifeAssignmentForWeek({
    expectedWeekStartAt: "2026-08-21T00:00:00.000Z",
    preferGeneratedAt: "2026-08-21T02:37:01.550Z",
    formal: {
      weekStartAt: "2026-08-21T00:00:00.000Z",
      assignment: {
        weekStartAt: "2026-08-21T00:00:00.000Z",
        generatedAt: "2026-08-21T07:18:47.876Z",
        trials: [{
          trialHrid: "/guild_skilling/foraging",
          trialName: "采摘",
          roster: ["Atlus", "yangguangniuzi"],
        }],
      },
    },
    test: {
      weekStartAt: "2026-08-21T00:00:00.000Z",
      assignment: {
        weekStartAt: "2026-08-21T00:00:00.000Z",
        generatedAt: "2026-08-21T02:37:01.550Z",
        trials: [
          {
            trialHrid: "/guild_skilling/cheesesmithing",
            trialName: "奶酪锻造",
            roster: ["Atlus"],
          },
          {
            trialHrid: "/guild_skilling/foraging",
            trialName: "采摘",
            roster: ["yangguangniuzi"],
          },
        ],
      },
    },
  });
  assert.equal(picked.source, "test");
  const text = formatSignupAssignmentMismatches({
    weekStartAt: "2026-08-21T00:00:00.000Z",
    registrationTrials: [{
      kind: "skilling",
      weekStartAt: "2026-08-21T00:00:00.000Z",
      trialHrid: "/guild_skilling/cheesesmithing",
      trialName: "奶酪锻造",
      members: [{ memberId: "Atlus" }, { memberId: "yangguangniuzi" }],
    }],
    lifeAssignment: picked.assignment,
    lifeSource: picked.source,
  });
  assert.doesNotMatch(text, /Atlus：/u);
  assert.match(text, /yangguangniuzi：分配「采摘」，报名「奶酪锻造」/u);
});

test("does not flag a life trial when assignment hrid and signup name refer to the same trial", () => {
  const text = formatSignupAssignmentMismatches({
    registrationTrials: [{
      kind: "skilling",
      trialName: "奶酪锻造",
      members: [{ memberId: "Atlus" }],
    }],
    lifeAssignment: {
      trials: [{
        trialHrid: "/guild_skilling/cheesesmithing",
        trialName: "奶酪锻造",
        roster: ["Atlus"],
      }],
    },
  });
  assert.doesNotMatch(text, /Atlus：/u);
  assert.match(text, /不一致 0/u);
});

test("coverage text names the life source and flags a stale week", () => {
  const text = formatUnassignedAssignmentMembers({
    rosterMembers: [{ memberId: "alice" }],
    lifeAssignment: { trials: [{ roster: ["bob"] }] },
    combatAssignment: { generatedAt: "2026-08-21T06:45:11.947Z", bosses: [] },
    lifeSource: "test",
    lifeWeekStartAt: "2026-08-14T00:00:00.000Z",
    expectedWeekStartAt: "2026-08-21T00:00:00.000Z",
    combatGeneratedAt: "2026-08-21T06:45:11.947Z",
  });
  assert.match(text, /生活分工来源：测试方案/u);
  assert.match(text, /不一致/u);
  assert.match(text, /alice/u);
});

test("lists signup vs assignment mismatches for life and combat", () => {
  const text = formatSignupAssignmentMismatches({
    registrationTrials: [
      {
        kind: "skilling",
        trialHrid: "/guild_skilling/woodcutting",
        trialName: "伐木",
        members: [{ memberId: "alice" }, { memberId: "bob" }],
      },
      {
        kind: "skilling",
        trialHrid: "/guild_skilling/cooking",
        trialName: "烹饪",
        members: [{ memberId: "cara" }],
      },
      {
        kind: "combat",
        trialHrid: "/guild_combat/chameleon",
        trialName: "试炼变色龙",
        members: [{ memberId: "dave" }, { memberId: "erin" }],
      },
      {
        kind: "combat",
        trialHrid: "/guild_combat/swarm",
        trialName: "试炼虫群",
        members: [{ memberId: "frank" }],
      },
    ],
    lifeAssignment: {
      weekStartAt: "2026-08-07T00:00:00.000Z",
      trials: [
        {
          trialHrid: "/guild_skilling/woodcutting",
          trialName: "伐木",
          roster: ["alice", "cara"],
        },
        {
          trialHrid: "/guild_skilling/cooking",
          trialName: "烹饪",
          roster: ["gina"],
        },
      ],
    },
    combatAssignment: {
      generatedAt: "2026-08-07T07:45:46.837Z",
      bosses: [
        {
          bossId: "/guild_combat/chameleon",
          bossName: "试炼变色龙",
          roster: [{ memberId: "dave" }, { memberId: "frank" }],
        },
        {
          bossId: "/guild_combat/swarm",
          bossName: "试炼虫群",
          roster: [{ memberId: "erin" }],
        },
      ],
    },
    combatGeneratedAt: "2026-08-14T02:48:46.162Z",
    registrationCapturedAt: "2026-08-17T01:16:43.453Z",
  });

  assert.match(text, /报名检查/u);
  assert.match(text, /生活试炼不一致/u);
  assert.match(text, /bob：报名「伐木」，未在模拟分工/u);
  assert.match(text, /cara：分配「伐木」，报名「烹饪」/u);
  assert.match(text, /gina：分配「烹饪」，未报名/u);
  assert.doesNotMatch(text, /alice：/u);

  assert.match(text, /战斗试炼不一致/u);
  assert.match(text, /erin：分配「试炼虫群」，报名「试炼变色龙」/u);
  assert.match(text, /frank：分配「试炼变色龙」，报名「试炼虫群」/u);
  assert.match(text, /本周起点：2026-08-07/u);
  assert.match(text, /战斗分工生成：2026-08-14 10:48:46 北京时间/u);
  assert.match(text, /报名同步：2026-08-17 09:16:43 北京时间/u);
  assert.doesNotMatch(text, /2026-08-14T02:48:46\.162Z/u);
  assert.doesNotMatch(text, /2026-08-17T01:16:43\.453Z/u);
  assert.doesNotMatch(text, /dave：/u);
});

test("signup mismatch report can say everything matches", () => {
  const text = formatSignupAssignmentMismatches({
    registrationTrials: [
      {
        kind: "skilling",
        trialHrid: "/guild_skilling/woodcutting",
        trialName: "伐木",
        members: [{ memberId: "alice" }],
      },
      {
        kind: "combat",
        trialHrid: "/guild_combat/swarm",
        trialName: "试炼虫群",
        members: [{ memberId: "bob" }],
      },
    ],
    lifeAssignment: {
      trials: [{
        trialHrid: "/guild_skilling/woodcutting",
        trialName: "伐木",
        roster: ["alice"],
      }],
    },
    combatAssignment: {
      bosses: [{
        bossId: "/guild_combat/swarm",
        bossName: "试炼虫群",
        roster: [{ memberId: "bob" }],
      }],
    },
  });
  assert.match(text, /生活与战斗报名均与最新模拟分工一致/u);
  assert.match(text, /不一致 0/u);
});

test("ignores previous-week registration snapshots for other bosses", () => {
  const text = formatSignupAssignmentMismatches({
    weekStartAt: "2026-08-07T00:00:00.000Z",
    activeTrialHrids: [
      "/guild_combat/chameleon",
      "/guild_combat/swarm",
      "/guild_skilling/woodcutting",
    ],
    registrationTrials: [
      {
        kind: "combat",
        weekStartAt: "2026-08-07T00:00:00.000Z",
        trialHrid: "/guild_combat/chameleon",
        trialName: "试炼变色龙",
        members: [{ memberId: "alice" }],
      },
      {
        kind: "combat",
        weekStartAt: "2026-07-31T00:00:00.000Z",
        trialHrid: "/guild_combat/hedgehog",
        trialName: "试炼刺猬",
        members: [{ memberId: "alice" }],
      },
      {
        kind: "combat",
        weekStartAt: "2026-07-31T00:00:00.000Z",
        trialHrid: "/guild_combat/badger",
        trialName: "试炼獾",
        members: [{ memberId: "bob" }],
      },
    ],
    combatAssignment: {
      source: { mode: "all-available-bound-members-reassigned" },
      bosses: [{
        bossId: "/guild_combat/chameleon",
        bossName: "试炼变色龙",
        roster: [{ memberId: "alice" }],
      }],
    },
  });
  assert.match(text, /不按报名/u);
  assert.doesNotMatch(text, /刺猬/u);
  assert.doesNotMatch(text, /獾/u);
  assert.doesNotMatch(text, /alice：/u);
  assert.doesNotMatch(text, /bob：/u);
});

test("filterActiveRegistrationTrials keeps only current catalog trials", () => {
  const filtered = filterActiveRegistrationTrials([
    {
      trialHrid: "/guild_combat/chameleon",
      weekStartAt: "2026-08-07T00:00:00.000Z",
    },
    {
      trialHrid: "/guild_combat/hedgehog",
      weekStartAt: "2026-07-31T00:00:00.000Z",
    },
  ], {
    weekStartAt: "2026-08-07T00:00:00.000Z",
    activeTrialHrids: ["/guild_combat/chameleon", "/guild_combat/swarm"],
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.trialHrid, "/guild_combat/chameleon");
});
