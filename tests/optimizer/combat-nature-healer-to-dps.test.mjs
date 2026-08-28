import assert from "node:assert/strict";
import test from "node:test";
import { NATURE_DPS_FIXED_KIT } from "../../packages/optimizer/src/combat-ability-templates.mjs";
import {
  convertNatureHealersToDps,
  defaultNatureDpsCounts,
  rankedNatureHealerIds,
} from "../../packages/optimizer/src/combat-nature-healer-to-dps.mjs";

const roster = [
  {
    memberId: "low",
    combatType: "自",
    duty: "healer",
    abilityHrids: ["/abilities/revive", "/abilities/rejuvenate"],
  },
  {
    memberId: "high",
    combatType: "自",
    duty: "healer",
    abilityHrids: ["/abilities/mystic_aura", "/abilities/rejuvenate"],
  },
  {
    memberId: "bow",
    combatType: "弓",
    duty: "dps",
    abilityHrids: ["/abilities/revive", "/abilities/berserk"],
  },
];

test("ranks nature healers by weapon enhancement then magic level", () => {
  const ranked = rankedNatureHealerIds(
    roster,
    new Map([
      ["low", { enhancementLevel: 8, refined: true, magicLevel: 200 }],
      ["high", { enhancementLevel: 12, refined: true, magicLevel: 120 }],
      ["bow", { enhancementLevel: 20, refined: true, magicLevel: 1 }],
    ]),
  );
  assert.deepEqual(ranked, ["high", "low"]);
});

test("converts the top X nature healers to affinity/pollen/veil/entangle DPS", () => {
  const next = convertNatureHealersToDps(roster, 1, ["high", "low"]);
  assert.equal(next[1].duty, "dps");
  assert.deepEqual(next[1].abilityHrids, [
    "/abilities/mystic_aura",
    ...NATURE_DPS_FIXED_KIT,
  ]);
  assert.equal(next[0].duty, "healer");
  assert.equal(next[2].duty, "dps");
});

test("default counts are every integer from 0 through the healer cap", () => {
  assert.deepEqual(defaultNatureDpsCounts(4), [0, 1, 2, 3, 4]);
  assert.deepEqual(defaultNatureDpsCounts(0), [0]);
});
