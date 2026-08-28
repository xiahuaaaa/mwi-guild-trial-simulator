import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAduduCloneLabAssignment } from "../../scripts/run-adudu-clone-lab.mjs";

const fixture = JSON.parse(await readFile(
  new URL("../../fixtures/monsters/guild-trial-2026-07-24-jellyfish-hedgehog.json", import.meta.url),
  "utf8",
));

const equipment = (weapon) => [
  { locationHrid: "/item_locations/main_hand", itemHrid: weapon, enhancementLevel: 10 },
  { locationHrid: "/item_locations/off_hand", itemHrid: "/items/test_shield", enhancementLevel: 10 },
];
const abilities = [{ abilityHrid: "/abilities/fireball", level: 80 }];
const learnedNames = [
  "speed_aura", "guardian_aura", "fierce_aura", "critical_aura", "mystic_aura",
  "provoke", "toughness", "spike_shell", "precision", "rejuvenate", "quick_aid",
  "heal", "mana_spring", "frenzy", "berserk", "penetrating_shot", "rain_of_arrows",
  "precision", "pestilent_shot", "silencing_shot", "elemental_affinity", "toxic_pollen",
  "natures_veil", "entangle", "smoke_burst", "fireball", "ice_spear", "water_strike",
];
const snapshot = {
  memberId: "195739",
  displayName: "adudu",
  capturedAt: "2026-07-24T00:00:00.000Z",
  skills: { "/skills/attack": 140, "/skills/ranged": 135, "/skills/magic": 135 },
  learnedAbilities: Object.fromEntries(learnedNames.map((name) => [`/abilities/${name}`, 60])),
  loadoutCatalog: [
    { sourceLoadoutId: 1, name: "弩", category: "combat", issues: [], equipment: equipment("/items/sundering_crossbow_refined"), abilities },
    { sourceLoadoutId: 2, name: "自然", category: "combat", issues: [], equipment: equipment("/items/blooming_trident_refined"), abilities },
    { sourceLoadoutId: 3, name: "火", category: "combat", issues: [], equipment: equipment("/items/blazing_trident_refined"), abilities },
    { sourceLoadoutId: 4, name: "缺装备", category: "combat", issues: ["missing"], equipment: equipment("/items/flail"), abilities },
  ],
};

test("adudu clone lab uses 40 members per boss and never includes incomplete equipment", () => {
  const result = buildAduduCloneLabAssignment(snapshot, fixture);
  assert.equal(result.developmentOnly, true);
  assert.equal(result.promotable, false);
  assert.equal(result.bosses.length, 2);
  for (const boss of result.bosses) {
    assert.equal(Object.values(boss.roleCounts).reduce((sum, value) => sum + value, 0), 40);
    assert.equal(Object.values(boss.buildCounts).reduce((sum, value) => sum + value, 0), 40);
    assert.equal(Object.values(boss.auraCounts).reduce((sum, value) => sum + value, 0), 40);
    assert.equal(boss.runs.length, 3);
    assert.ok(!boss.candidateRanking.some((candidate) => candidate.name === "缺装备"));
  }
  assert.match(result.summaryText, /不可转正/);
  assert.match(result.summaryText, /试炼水母/);
  assert.match(result.summaryText, /试炼刺猬/);
});
