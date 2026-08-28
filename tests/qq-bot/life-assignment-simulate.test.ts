import assert from "node:assert/strict";
import test from "node:test";

import { simulateLifeTrialForRoster } from "../../apps/qq-bot/src/life-assignment.ts";
import {
  GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL,
  GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL,
} from "../../packages/guild-trial-core/src/life-trial-member.ts";

const milkingTrial = {
  trialHrid: "/guild_skilling/milking",
  trialName: "挤奶",
  skillHrid: "/skills/milking",
  maxParticipants: 24,
};

const craftingTrial = {
  trialHrid: "/guild_skilling/crafting",
  trialName: "制作",
  skillHrid: "/skills/crafting",
  maxParticipants: 24,
};

const milkingLoadoutCatalog = [
  {
    category: "profession",
    actionTypeHrid: "/action_types/milking",
    equipment: [
      { itemHrid: "/items/dairyhands_top", enhancementLevel: 0 },
      { itemHrid: "/items/earrings_of_gathering", enhancementLevel: 0 },
    ],
  },
];

const craftingLoadoutCatalog = [
  {
    category: "profession",
    actionTypeHrid: "/action_types/crafting",
    equipment: [{ itemHrid: "/items/crafters_top", enhancementLevel: 0 }],
  },
];

test("simulateLifeTrialForRoster reports members below milking floor", () => {
  const text = simulateLifeTrialForRoster({
    trial: milkingTrial,
    memberIds: ["bob"],
    snapshotsByMemberId: {
      bob: {
        skills: { "/skills/milking": GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL - 1 },
        loadoutCatalog: milkingLoadoutCatalog,
      },
    },
  });
  assert.match(
    text,
    new RegExp(
      `未计入模拟（对应技能<${GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL}）：bob（挤奶84）`,
      "u",
    ),
  );
  assert.match(text, /人数：0\/24/u);
});

test("simulateLifeTrialForRoster reports members below crafting floor", () => {
  const text = simulateLifeTrialForRoster({
    trial: craftingTrial,
    memberIds: ["bob"],
    snapshotsByMemberId: {
      bob: {
        skills: { "/skills/crafting": GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL - 1 },
        loadoutCatalog: craftingLoadoutCatalog,
      },
    },
  });
  assert.match(
    text,
    new RegExp(
      `未计入模拟（对应技能<${GUILD_TRIAL_MIN_CRAFTING_SKILL_LEVEL}）：bob（制作99）`,
      "u",
    ),
  );
  assert.match(text, /人数：0\/24/u);
});

test("simulateLifeTrialForRoster does not label missing snapshot as skill floor", () => {
  const text = simulateLifeTrialForRoster({
    trial: milkingTrial,
    memberIds: ["ghost", "ok"],
    snapshotsByMemberId: {
      ok: {
        skills: { "/skills/milking": GUILD_TRIAL_MIN_MILKING_SKILL_LEVEL },
        loadoutCatalog: milkingLoadoutCatalog,
      },
    },
  });
  assert.doesNotMatch(text, /未计入模拟/u);
  assert.match(text, /人数：1\/24/u);
});
