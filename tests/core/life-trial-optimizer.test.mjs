import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLifeTrialMemberStats,
  guildTrialMinLifeSkillLevel,
  GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL,
  GUILD_TRIAL_MIN_LIFE_SKILL_LEVEL,
  GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL,
} from "../../packages/guild-trial-core/src/life-trial-member.ts";
import { optimizeLifeAssignments } from "../../packages/guild-trial-core/src/life-trial-optimizer.ts";

const snapshot = {
  skills: { "/skills/milking": 134, "/skills/crafting": 152 },
  loadoutCatalog: [
    {
      category: "profession",
      actionTypeHrid: "/action_types/milking",
      equipment: [
        { itemHrid: "/items/dairyhands_top", enhancementLevel: 5 },
        { itemHrid: "/items/earrings_of_gathering", enhancementLevel: 0 },
      ],
    },
    {
      category: "profession",
      actionTypeHrid: "/action_types/crafting",
      equipment: [{ itemHrid: "/items/crafters_top", enhancementLevel: 0 }],
    },
  ],
};

test("buildLifeTrialMemberStats includes efficiency, speed and gathering", () => {
  const stats = buildLifeTrialMemberStats(
    snapshot,
    "alice",
    "Alice",
    "/skills/milking",
  );
  assert.ok(stats);
  assert.equal(stats.skillLevel, 134);
  assert.ok(stats.efficiency > 0.1);
  assert.ok(stats.gatheringBonus > 0);
  assert.equal(stats.workForce, Math.floor(134 * (1 + stats.efficiency)));
});

test("buildLifeTrialMemberStats falls back to all-actions loadout", () => {
  const allOnly = {
    skills: { "/skills/milking": 100 },
    loadoutCatalog: [
      {
        category: "all",
        actionTypeHrid: "/action_types/all",
        equipment: [
          { itemHrid: "/items/dairyhands_top", enhancementLevel: 0 },
        ],
      },
    ],
  };
  const stats = buildLifeTrialMemberStats(
    allOnly,
    "bob",
    "Bob",
    "/skills/milking",
  );
  assert.ok(stats);
  assert.ok(stats.efficiency > 0);
  assert.equal(stats.workForce, Math.floor(100 * (1 + stats.efficiency)));
});

test("profession loadout beats all-actions for the same skill", () => {
  const mixed = {
    skills: { "/skills/milking": 100 },
    loadoutCatalog: [
      {
        category: "all",
        actionTypeHrid: "/action_types/all",
        equipment: [
          { itemHrid: "/items/dairyhands_top", enhancementLevel: 20 },
        ],
      },
      {
        category: "profession",
        actionTypeHrid: "/action_types/milking",
        equipment: [
          { itemHrid: "/items/dairyhands_top", enhancementLevel: 0 },
        ],
      },
    ],
  };
  const stats = buildLifeTrialMemberStats(
    mixed,
    "carol",
    "Carol",
    "/skills/milking",
  );
  assert.ok(stats);
  // Prefer milking profession (+0 enhancement) over stronger all-actions.
  assert.equal(stats.efficiency, 0.1);
});

test("guildTrialMinLifeSkillLevel is per-skill", () => {
  assert.equal(guildTrialMinLifeSkillLevel("/skills/milking"), 85);
  assert.equal(guildTrialMinLifeSkillLevel("/skills/crafting"), 100);
  assert.equal(guildTrialMinLifeSkillLevel("/skills/foraging"), 90);
});

test("buildLifeTrialMemberStats rejects skill level below guild trial floor", () => {
  const below = {
    skills: { "/skills/milking": GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL - 1 },
    loadoutCatalog: snapshot.loadoutCatalog,
  };
  const atFloor = {
    skills: { "/skills/milking": GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL },
    loadoutCatalog: snapshot.loadoutCatalog,
  };
  assert.equal(
    buildLifeTrialMemberStats(below, "low", "Low", "/skills/milking"),
    null,
  );
  assert.ok(
    buildLifeTrialMemberStats(atFloor, "ok", "Ok", "/skills/milking"),
  );
});

test("buildLifeTrialMemberStats applies higher crafting floor", () => {
  const craftingLoadout = snapshot.loadoutCatalog.filter(
    (row) => row.actionTypeHrid === "/action_types/crafting",
  );
  const below = {
    skills: { "/skills/crafting": GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL - 1 },
    loadoutCatalog: craftingLoadout,
  };
  const atFloor = {
    skills: { "/skills/crafting": GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL },
    loadoutCatalog: craftingLoadout,
  };
  assert.equal(
    buildLifeTrialMemberStats(below, "low", "Low", "/skills/crafting"),
    null,
  );
  assert.ok(
    buildLifeTrialMemberStats(atFloor, "ok", "Ok", "/skills/crafting"),
  );
});

test("optimizer excludes members below life skill floor for each trial", () => {
  const loadout = snapshot.loadoutCatalog.filter(
    (row) => row.actionTypeHrid === "/action_types/milking",
  );
  const below = {
    skills: { "/skills/milking": GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL - 1 },
    loadoutCatalog: loadout,
  };
  const atFloor = {
    skills: { "/skills/milking": GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL },
    loadoutCatalog: loadout,
  };
  const run = optimizeLifeAssignments({
    weekStartAt: "2026-07-24T00:00:00.000Z",
    trials: [
      {
        trialHrid: "/guild_skilling/milking",
        trialName: "挤奶",
        skillHrid: "/skills/milking",
        maxParticipants: 24,
      },
    ],
    members: [
      { memberId: "below", displayName: "Below" },
      { memberId: "ok", displayName: "Ok" },
    ],
    snapshotsByMemberId: { below, ok: atFloor },
  });
  assert.deepEqual(run.trials[0].roster, ["ok"]);
  assert.equal(run.unassigned.length, 0);
});

test("optimizer applies life skill floor per trial independently", () => {
  const crossSnapshot = {
    skills: {
      "/skills/milking": 95,
      "/skills/crafting": GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL - 1,
    },
    loadoutCatalog: snapshot.loadoutCatalog,
  };
  const run = optimizeLifeAssignments({
    weekStartAt: "2026-07-24T00:00:00.000Z",
    trials: [
      {
        trialHrid: "/guild_skilling/milking",
        trialName: "挤奶",
        skillHrid: "/skills/milking",
        maxParticipants: 24,
      },
      {
        trialHrid: "/guild_skilling/crafting",
        trialName: "制作",
        skillHrid: "/skills/crafting",
        maxParticipants: 24,
      },
    ],
    members: [{ memberId: "cross", displayName: "Cross" }],
    snapshotsByMemberId: { cross: crossSnapshot },
  });
  assert.deepEqual(run.trials[0].roster, ["cross"]);
  assert.deepEqual(run.trials[1].roster, []);
  assert.equal(run.unassigned.length, 0);
});

test("optimizer assigns crafting trial at crafting floor", () => {
  const craftingOnly = {
    skills: { "/skills/crafting": GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL },
    loadoutCatalog: snapshot.loadoutCatalog.filter(
      (row) => row.actionTypeHrid === "/action_types/crafting",
    ),
  };
  const run = optimizeLifeAssignments({
    weekStartAt: "2026-07-24T00:00:00.000Z",
    trials: [
      {
        trialHrid: "/guild_skilling/crafting",
        trialName: "制作",
        skillHrid: "/skills/crafting",
        maxParticipants: 24,
      },
    ],
    members: [{ memberId: "crafter", displayName: "Crafter" }],
    snapshotsByMemberId: { crafter: craftingOnly },
  });
  assert.deepEqual(run.trials[0].roster, ["crafter"]);
});

test("optimizer respects per-trial caps and one trial per member", () => {
  const members = [
    { memberId: "alice", displayName: "Alice" },
    { memberId: "bob", displayName: "Bob" },
  ];
  const snapshotsByMemberId = {
    alice: snapshot,
    bob: snapshot,
  };
  const run = optimizeLifeAssignments({
    weekStartAt: "2026-07-24T00:00:00.000Z",
    trials: [
      {
        trialHrid: "/guild_skilling/milking",
        trialName: "挤奶",
        skillHrid: "/skills/milking",
        maxParticipants: 1,
      },
      {
        trialHrid: "/guild_skilling/crafting",
        trialName: "制作",
        skillHrid: "/skills/crafting",
        maxParticipants: 1,
      },
    ],
    members,
    snapshotsByMemberId,
  });
  const assigned = new Set(run.trials.flatMap((trial) => trial.roster));
  assert.equal(assigned.size, 2);
  assert.equal(run.trials[0].roster.length, 1);
  assert.equal(run.trials[1].roster.length, 1);
  assert.ok(run.totalBasePoints > 0);
});

test("optimizer invests through flat base-point steps instead of stopping early", () => {
  const midSnapshot = {
    skills: { "/skills/milking": GUILD_TRIAL_MIN_LIFE_SKILL_LEVEL },
    loadoutCatalog: [
      {
        category: "profession",
        actionTypeHrid: "/action_types/milking",
        equipment: [
          { itemHrid: "/items/dairyhands_top", enhancementLevel: 0 },
          { itemHrid: "/items/earrings_of_gathering", enhancementLevel: 0 },
        ],
      },
    ],
  };
  const members = Array.from({ length: 12 }, (_, i) => ({
    memberId: `m${i}`,
    displayName: `M${i}`,
  }));
  const snapshotsByMemberId = Object.fromEntries(
    members.map((member) => [member.memberId, midSnapshot]),
  );
  const run = optimizeLifeAssignments({
    weekStartAt: "2026-07-24T00:00:00.000Z",
    trials: [
      {
        trialHrid: "/guild_skilling/milking",
        trialName: "挤奶",
        skillHrid: "/skills/milking",
        maxParticipants: 24,
      },
    ],
    members,
    snapshotsByMemberId,
  });
  // Old greedy stopped when the next person's Δ base points was 0 (or even
  // refused the first person if they didn't clear a whole floor alone).
  // Progress-toward-next-floor must keep staffing through those flats.
  assert.equal(run.trials[0].roster.length, 12);
  assert.ok(run.trials[0].expectedLevelsCleared >= 3);
  assert.ok(run.totalBasePoints >= 400);
  assert.equal(run.unassigned.length, 0);
});
