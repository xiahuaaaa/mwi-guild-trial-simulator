import assert from "node:assert/strict";
import test from "node:test";
import {
  CROSSBOW_SUPPORT_MODES,
  DEFAULT_SHIELD_PACKAGE_ID,
  HAMMER_DEBUFFER_ABILITIES,
  SHIELD_ABILITY_PACKAGES,
  SWORD_DEBUFFER_ABILITIES,
  crossbowDebufferAbilityNames,
  shieldAbilityNames,
} from "../../packages/optimizer/src/combat-role-policies.mjs";

test("hammer and sword debuff templates fill all five slots", () => {
  assert.deepEqual(HAMMER_DEBUFFER_ABILITIES, [
    "revive",
    "precision",
    "frenzy",
    "berserk",
    "fracturing_impact",
  ]);
  assert.deepEqual(SWORD_DEBUFFER_ABILITIES, [
    "revive",
    "precision",
    "berserk",
    "maim",
    "crippling_slash",
  ]);
  assert.equal(HAMMER_DEBUFFER_ABILITIES.length, 5);
  assert.equal(SWORD_DEBUFFER_ABILITIES.length, 5);
  assert.ok(!SWORD_DEBUFFER_ABILITIES.includes("vampirism"));
});

test("single-target crossbow prioritizes accuracy and steady shot", () => {
  assert.deepEqual(CROSSBOW_SUPPORT_MODES, ["berserk", "frenzy"]);
  for (const mode of CROSSBOW_SUPPORT_MODES) {
    const abilities = crossbowDebufferAbilityNames("critical_aura", mode);
    assert.equal(abilities.length, 5);
    assert.ok(abilities.includes("precision"));
    assert.ok(abilities.includes("pestilent_shot"));
    assert.ok(abilities.includes("steady_shot"));
    assert.ok(abilities.includes(mode));
    assert.ok(!abilities.includes("penetrating_shot"));
    assert.ok(!abilities.includes("rain_of_arrows"));
  }
});

test("every shield search package has one special and four ordinary skills", () => {
  assert.equal(DEFAULT_SHIELD_PACKAGE_ID, "retaliation-precision");
  assert.ok(SHIELD_ABILITY_PACKAGES.length >= 5);
  for (const policy of SHIELD_ABILITY_PACKAGES) {
    const abilities = shieldAbilityNames("revive", policy.id);
    assert.equal(abilities.length, 5, policy.id);
    assert.equal(abilities[0], "revive", policy.id);
    assert.ok(abilities.includes("provoke"), policy.id);
    assert.ok(abilities.includes("precision"), policy.id);
  }
});

test("shield policy search compares bash, frenzy, retaliation and thorns", () => {
  const allAbilities = new Set(
    SHIELD_ABILITY_PACKAGES.flatMap((row) => row.ordinaryAbilities),
  );
  for (const required of [
    "shield_bash",
    "frenzy",
    "retribution",
    "spike_shell",
    "toughness",
  ]) {
    assert.ok(allAbilities.has(required), required);
  }
});
