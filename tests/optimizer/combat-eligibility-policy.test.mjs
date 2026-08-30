import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  combatEligibilityNote,
  combatReadinessOptionsForGuild,
  defaultTeamCapForGuild,
  formatShieldCapReason,
  keepTopShieldsByDefense,
  memberOwnsRoleWeaponAtItemLevel,
  shieldsPerSideForGuild,
  WI_COMBAT_MIN_PRIMARY_LEVEL,
  WI_COMBAT_MIN_WEAPON_ITEM_LEVEL,
  WI_DEFAULT_TEAM_CAP,
  WI_SHIELDS_PER_SIDE,
} from "../../packages/optimizer/src/combat-eligibility-policy.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("WI combat eligibility is opt-in and TMD stays on attack-only floors", () => {
  assert.deepEqual(combatReadinessOptionsForGuild("TMD"), {});
  assert.deepEqual(combatReadinessOptionsForGuild("WI"), {
    minPrimaryLevel: WI_COMBAT_MIN_PRIMARY_LEVEL,
    minWeaponItemLevel: WI_COMBAT_MIN_WEAPON_ITEM_LEVEL,
  });
  assert.equal(WI_COMBAT_MIN_PRIMARY_LEVEL, 125);
  assert.equal(WI_COMBAT_MIN_WEAPON_ITEM_LEVEL, 95);
  assert.equal(shieldsPerSideForGuild("TMD"), null);
  assert.equal(shieldsPerSideForGuild("WI"), WI_SHIELDS_PER_SIDE);
  assert.equal(WI_SHIELDS_PER_SIDE, 2);
  assert.equal(defaultTeamCapForGuild("TMD"), 52);
  assert.equal(defaultTeamCapForGuild("WI"), WI_DEFAULT_TEAM_CAP);
  assert.equal(WI_DEFAULT_TEAM_CAP, 48);
  assert.match(combatEligibilityNote("TMD", 110), /^攻击≥110$/u);
  assert.match(combatEligibilityNote("WI", 110), /主属性≥125/u);
  assert.match(combatEligibilityNote("WI", 110), /每边2盾/u);
});

test("T95 check accepts unrefined and refined T95, rejects T80", () => {
  const catalog = (weaponHrid) => ({
    loadoutCatalog: [
      {
        category: "combat",
        equipment: [{ itemHrid: weaponHrid, enhancementLevel: 7 }],
      },
    ],
  });
  assert.equal(
    memberOwnsRoleWeaponAtItemLevel(
      catalog("/items/sundering_crossbow"),
      "弩",
      95,
    ),
    true,
  );
  assert.equal(
    memberOwnsRoleWeaponAtItemLevel(
      catalog("/items/sundering_crossbow_refined"),
      "弩",
      95,
    ),
    true,
  );
  assert.equal(
    memberOwnsRoleWeaponAtItemLevel(
      catalog("/items/arcane_crossbow"),
      "弩",
      95,
    ),
    false,
  );
});

test("keepTopShieldsByDefense drops the lowest-defense extras", () => {
  const shields = [
    { memberId: "low", snapshot: { skills: { "/skills/defense": 125 } } },
    { memberId: "mid", snapshot: { skills: { "/skills/defense": 132 } } },
    { memberId: "high", snapshot: { skills: { "/skills/defense": 136 } } },
    { memberId: "high2", snapshot: { skills: { "/skills/defense": 134 } } },
    { memberId: "also-low", snapshot: { skills: { "/skills/defense": 125 } } },
    { memberId: "third", snapshot: { skills: { "/skills/defense": 133 } } },
  ];
  const { kept, dropped } = keepTopShieldsByDefense(shields, 4);
  assert.deepEqual(
    kept.map((row) => row.memberId),
    ["high", "high2", "third", "mid"],
  );
  assert.deepEqual(
    dropped.map((row) => row.memberId),
    ["also-low", "low"],
  );
  assert.match(formatShieldCapReason(dropped[0], 2), /防御125较低，每边只带2盾/u);
});

test("composition lab wires WI eligibility without changing TMD defaults", async () => {
  const source = await readFile(
    path.join(projectRoot, "scripts/run-available-roster-composition-lab.mjs"),
    "utf8",
  );
  assert.match(source, /combatReadinessOptionsForGuild\(guildId\)/u);
  assert.match(source, /defaultTeamCapForGuild\(guildId\)/u);
  assert.match(source, /keepTopShieldsByDefense/u);
  assert.match(source, /shieldsPerSideForGuild\(guildId\)/u);
});
