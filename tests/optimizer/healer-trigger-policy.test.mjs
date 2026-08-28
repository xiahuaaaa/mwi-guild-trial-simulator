import assert from "node:assert/strict";
import test from "node:test";
import {
  healerAbilityNames,
  healerWeaponPolicy,
} from "../../packages/optimizer/src/healer-trigger-policy.mjs";
import {
  equipmentDetail,
} from "../../packages/shykai-full-runtime/src/guild-trial-runner.mjs";

const build = (name, itemHrid) => ({
  name,
  equipment: [{ itemHrid, enhancementLevel: 0 }],
});

test("Blooming Trident healers spam Entangle and never use Life Drain", () => {
  const blooming = build("自然", "/items/blooming_trident_refined");
  assert.deepEqual(
    healerWeaponPolicy(blooming, equipmentDetail),
    {
      stat: "bloom",
      triggerAbility: "entangle",
      reason:
        "Blooming Trident: use a zero-cooldown nature cast to roll Bloom frequently",
      itemHrid: "/items/blooming_trident_refined",
      procChance: 0.38,
    },
  );
  const abilities = healerAbilityNames(blooming, "revive", equipmentDetail);
  assert.deepEqual(abilities, [
    "revive",
    "rejuvenate",
    "quick_aid",
    "mana_spring",
    "entangle",
  ]);
  assert.ok(!abilities.includes("life_drain"));
});

test("Rippling Trident healers spam Water Strike to roll Ripple", () => {
  const rippling = build("迷宫水", "/items/rippling_trident_refined");
  assert.deepEqual(
    healerWeaponPolicy(rippling, equipmentDetail),
    {
      stat: "ripple",
      triggerAbility: "water_strike",
      reason:
        "Rippling Trident: use a zero-cooldown water cast to roll Ripple frequently",
      itemHrid: "/items/rippling_trident_refined",
      procChance: 0.2,
    },
  );
  assert.deepEqual(
    healerAbilityNames(rippling, "mystic_aura", equipmentDetail),
    [
      "mystic_aura",
      "rejuvenate",
      "quick_aid",
      "mana_spring",
      "water_strike",
    ],
  );
});

test("unsupported weapons cannot silently become healer candidates", () => {
  assert.throws(
    () =>
      healerAbilityNames(
        build("火", "/items/blazing_trident_refined"),
        "revive",
        equipmentDetail,
      ),
    /no supported Bloom\/Ripple weapon/u,
  );
});
