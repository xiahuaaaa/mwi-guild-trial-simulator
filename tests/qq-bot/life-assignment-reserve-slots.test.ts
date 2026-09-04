import assert from "node:assert/strict";
import test from "node:test";

import {
  generateLifeAssignmentRun,
  parseLifePinnedMembers,
  parseLifeTrialReserveSlots,
  resolveLifeAssignmentEnvOverrides,
} from "../../apps/qq-bot/src/life-assignment.ts";

const trials = [
  {
    trialHrid: "/guild_skilling/alchemy",
    trialName: "炼金",
    skillHrid: "/skills/alchemy",
    maxParticipants: 4,
  },
  {
    trialHrid: "/guild_skilling/milking",
    trialName: "挤奶",
    skillHrid: "/skills/milking",
    maxParticipants: 4,
  },
] as const;

function member(id: string, skillHrid: string, level: number) {
  return {
    memberId: id,
    displayName: id,
    latestSnapshot: {
      skills: { [skillHrid]: level },
      loadoutCatalog: [
        {
          category: "profession",
          actionTypeHrid: skillHrid.replace("/skills/", "/action_types/"),
          equipment: [{ itemHrid: "/items/alchemists_top", enhancementLevel: 0 }],
        },
      ],
    },
  };
}

test("parseLifeTrialReserveSlots accepts hrid and trial name", () => {
  const parsed = parseLifeTrialReserveSlots("/guild_skilling/alchemy:2,炼金:1");
  assert.equal(parsed.get("/guild_skilling/alchemy"), 2);
  assert.equal(parsed.get("炼金"), 1);
});

test("generateLifeAssignmentRun keeps display capacity while reserving optimizer slots", () => {
  const members = [
    member("a", "/skills/alchemy", 100),
    member("b", "/skills/alchemy", 100),
    member("c", "/skills/alchemy", 100),
    member("d", "/skills/milking", 90),
    member("e", "/skills/milking", 90),
    member("f", "/skills/milking", 90),
    member("g", "/skills/milking", 90),
  ];
  const run = generateLifeAssignmentRun({
    weekStartAt: "2026-09-04T00:00:00.000Z",
    trials,
    members,
    reservedSlotsByTrial: parseLifeTrialReserveSlots("/guild_skilling/alchemy:2"),
  });
  const alchemy = run.trials.find((trial) => trial.trialHrid === "/guild_skilling/alchemy");
  assert.ok(alchemy);
  assert.equal(alchemy.maxParticipants, 4);
  assert.equal(alchemy.roster.length, 2);
});

test("resolveLifeAssignmentEnvOverrides reads slug-specific env keys", () => {
  const envTrials = [
    ...trials,
    {
      trialHrid: "/guild_skilling/enhancing",
      trialName: "强化",
      skillHrid: "/skills/enhancing",
      maxParticipants: 4,
    },
  ];
  const previousTmd = process.env.MWI_LIFE_PINNED;
  const previousWi = process.env.MWI_LIFE_PINNED_WI;
  process.env.MWI_LIFE_PINNED = "adudu:强化";
  process.env.MWI_LIFE_PINNED_WI = "foo:炼金";
  try {
    const tmd = resolveLifeAssignmentEnvOverrides("TMD", envTrials);
    const wi = resolveLifeAssignmentEnvOverrides("WI", envTrials);
    assert.equal(tmd.pinnedAssignments.get("adudu"), "/guild_skilling/enhancing");
    assert.equal(wi.pinnedAssignments.get("foo"), "/guild_skilling/alchemy");
  } finally {
    if (previousTmd === undefined) delete process.env.MWI_LIFE_PINNED;
    else process.env.MWI_LIFE_PINNED = previousTmd;
    if (previousWi === undefined) delete process.env.MWI_LIFE_PINNED_WI;
    else process.env.MWI_LIFE_PINNED_WI = previousWi;
  }
});

test("generateLifeAssignmentRun honors pinned members", () => {
  const fullTrials = [
    ...trials,
    {
      trialHrid: "/guild_skilling/enhancing",
      trialName: "强化",
      skillHrid: "/skills/enhancing",
      maxParticipants: 4,
    },
  ];
  const members = [
    {
      memberId: "adudu",
      displayName: "adudu",
      latestSnapshot: {
        skills: {
          "/skills/alchemy": 100,
          "/skills/enhancing": 100,
          "/skills/milking": 90,
        },
        loadoutCatalog: [
          {
            category: "profession",
            actionTypeHrid: "/action_types/enhancing",
            equipment: [{ itemHrid: "/items/enhancers_top", enhancementLevel: 0 }],
          },
        ],
      },
    },
    member("b", "/skills/alchemy", 100),
    member("c", "/skills/alchemy", 100),
    member("d", "/skills/milking", 90),
    member("e", "/skills/milking", 90),
    member("f", "/skills/milking", 90),
    member("g", "/skills/milking", 90),
  ];
  const run = generateLifeAssignmentRun({
    weekStartAt: "2026-09-04T00:00:00.000Z",
    trials: fullTrials,
    members,
    pinnedAssignments: parseLifePinnedMembers("adudu:强化", fullTrials),
  });
  const enhancing = run.trials.find((trial) => trial.trialHrid === "/guild_skilling/enhancing");
  assert.ok(enhancing);
  assert.ok(enhancing.roster.includes("adudu"));
});
