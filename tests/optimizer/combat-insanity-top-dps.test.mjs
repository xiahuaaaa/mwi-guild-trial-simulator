import assert from "node:assert/strict";
import test from "node:test";
import {
  applyInsanityToTopDps,
  defaultInsanityCounts,
  rankedReviveDpsIds,
  revertInsanityToRevive,
} from "../../packages/optimizer/src/combat-insanity-top-dps.mjs";

const roster = [
  {
    memberId: "aura",
    duty: "dps",
    auraHrid: "/abilities/critical_aura",
    abilityHrids: ["/abilities/critical_aura", "/abilities/berserk"],
  },
  {
    memberId: "low",
    duty: "dps",
    auraHrid: null,
    abilityHrids: ["/abilities/revive", "/abilities/berserk"],
  },
  {
    memberId: "high",
    duty: "dps",
    auraHrid: null,
    abilityHrids: ["/abilities/revive", "/abilities/berserk"],
  },
  {
    memberId: "healer",
    duty: "healer",
    auraHrid: null,
    abilityHrids: ["/abilities/revive", "/abilities/rejuvenate"],
  },
  {
    memberId: "debuffer",
    duty: "debuffer",
    auraHrid: null,
    abilityHrids: ["/abilities/insanity", "/abilities/maim"],
  },
];

test("ranks revive DPS and debuffers by all-revive DPS; skips aura/healers", () => {
  const ranked = rankedReviveDpsIds(
    roster,
    new Map([
      ["low", 100],
      ["high", 400],
      ["aura", 999],
      ["healer", 50],
      ["debuffer", 500],
    ]),
  );
  assert.deepEqual(ranked, ["debuffer", "high", "low"]);
});

test("reverts insanity to revive before ranking", () => {
  const next = revertInsanityToRevive(roster);
  assert.equal(next[4].abilityHrids[0], "/abilities/revive");
  assert.equal(next[4].special, "复活");
  assert.equal(next[0].abilityHrids[0], "/abilities/critical_aura");
});

test("switches only the top X revive DPS to insanity", () => {
  const ranked = ["high", "low"];
  const next = applyInsanityToTopDps(roster, 1, ranked);
  assert.equal(next[2].abilityHrids[0], "/abilities/insanity");
  assert.equal(next[2].special, "疯狂");
  assert.equal(next[1].abilityHrids[0], "/abilities/revive");
  assert.equal(next[0].abilityHrids[0], "/abilities/critical_aura");
  assert.equal(next[3].abilityHrids[0], "/abilities/revive");
});

test("default counts include 0, steps, and the roster cap", () => {
  assert.deepEqual(defaultInsanityCounts(19), [0, 2, 4, 6, 8, 10, 12, 16, 19]);
  assert.deepEqual(defaultInsanityCounts(8), [0, 2, 4, 6, 8]);
});
