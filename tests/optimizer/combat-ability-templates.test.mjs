import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHammerFixedKit,
  HAMMER_FIXED_KIT,
  NATURE_DPS_FIXED_KIT,
  NATURE_HEALER_FIXED_KIT,
  applyStNatureHealerKits,
  ST_NATURE_HEALER_DRAIN_KIT,
  ST_NATURE_HEALER_POLLEN_KIT,
  abilityTemplatesForBoss,
  isSingleTargetBossKey,
  ordinaryAbilityHridsForTemplate,
} from "../../packages/optimizer/src/combat-ability-templates.mjs";

test("badger and swarm are AOE weeks; hedgehog/chameleon stay single-target", () => {
  assert.equal(isSingleTargetBossKey("badger"), false);
  assert.equal(isSingleTargetBossKey("swarm"), false);
  assert.equal(isSingleTargetBossKey("hedgehog"), true);
  assert.equal(isSingleTargetBossKey("chameleon"), true);
});

test("AOE nature healer kit is 群疗/粉尘/菌幕/缠绕", () => {
  assert.deepEqual(NATURE_HEALER_FIXED_KIT, [
    "/abilities/rejuvenate",
    "/abilities/toxic_pollen",
    "/abilities/natures_veil",
    "/abilities/entangle",
  ]);
  const hrids = ordinaryAbilityHridsForTemplate(
    { combatType: "自", duty: "healer", roleIndex: 0 },
    { bossKey: "badger" },
  );
  assert.deepEqual(hrids, NATURE_HEALER_FIXED_KIT);
  const swarm = ordinaryAbilityHridsForTemplate(
    { combatType: "自", duty: "healer", roleIndex: 3 },
    { bossKey: "swarm" },
  );
  assert.deepEqual(swarm, NATURE_HEALER_FIXED_KIT);
});

test("AOE nature DPS kit is 元素增幅/粉尘/菌幕/缠绕", () => {
  assert.deepEqual(NATURE_DPS_FIXED_KIT, [
    "/abilities/elemental_affinity",
    "/abilities/toxic_pollen",
    "/abilities/natures_veil",
    "/abilities/entangle",
  ]);
  const hrids = ordinaryAbilityHridsForTemplate(
    { combatType: "自", duty: "dps", roleIndex: 0 },
    { bossKey: "badger" },
  );
  assert.deepEqual(hrids, NATURE_DPS_FIXED_KIT);
});

test("AOE physical kits keep required coverage plus pierce; sword is 精确/血刃/致残", () => {
  const sword = ordinaryAbilityHridsForTemplate(
    { combatType: "剑", duty: "debuffer", roleIndex: 0 },
    { bossKey: "swarm" },
  );
  assert.deepEqual(sword, [
    "/abilities/berserk",
    "/abilities/precision",
    "/abilities/maim",
    "/abilities/crippling_slash",
  ]);
  assert.ok(!sword.includes("/abilities/cleave"));

  const spear = ordinaryAbilityHridsForTemplate(
    { combatType: "枪", duty: "debuffer", roleIndex: 0 },
    { bossKey: "badger" },
  );
  assert.ok(spear.includes("/abilities/puncture"));
  assert.ok(spear.includes("/abilities/penetrating_strike"));
});

test("AOE hammer kit is 狂暴/狂速/精确/碎裂", () => {
  assert.deepEqual(HAMMER_FIXED_KIT, [
    "/abilities/berserk",
    "/abilities/frenzy",
    "/abilities/precision",
    "/abilities/fracturing_impact",
  ]);
  const hammer = ordinaryAbilityHridsForTemplate(
    { combatType: "锤", duty: "debuffer", roleIndex: 0 },
    { bossKey: "swarm" },
  );
  assert.deepEqual(hammer, HAMMER_FIXED_KIT);
  const patched = applyHammerFixedKit([
    {
      combatType: "锤",
      abilityHrids: [
        "/abilities/revive",
        "/abilities/berserk",
        "/abilities/precision",
        "/abilities/sweep",
        "/abilities/fracturing_impact",
      ],
    },
  ]);
  assert.deepEqual(patched[0].abilityHrids, [
    "/abilities/revive",
    ...HAMMER_FIXED_KIT,
  ]);
});

test("AOE water keeps mana spring and frost surge; fire smoke is first two", () => {
  const water = ordinaryAbilityHridsForTemplate(
    { combatType: "水", duty: "dps", roleIndex: 0 },
    { bossKey: "badger" },
  );
  assert.ok(water.includes("/abilities/mana_spring"));
  assert.ok(water.includes("/abilities/frost_surge"));

  const smoke = ordinaryAbilityHridsForTemplate(
    { combatType: "火", duty: "debuffer", roleIndex: 0 },
    { bossKey: "swarm", fireSmokeBurstCount: 2 },
  );
  assert.ok(smoke.includes("/abilities/smoke_burst"));
  const flame = ordinaryAbilityHridsForTemplate(
    { combatType: "火", duty: "debuffer", roleIndex: 2 },
    { bossKey: "swarm", fireSmokeBurstCount: 2 },
  );
  assert.ok(flame.includes("/abilities/flame_blast"));
  assert.ok(!flame.includes("/abilities/smoke_burst"));
});

test("AOE ranged DPS use rain; first two ranged keep pestilent", () => {
  const dps = ordinaryAbilityHridsForTemplate(
    { combatType: "弩", duty: "dps", roleIndex: 3 },
    { bossKey: "swarm", rangedDpsKit: "precision_rain" },
  );
  assert.ok(dps.includes("/abilities/rain_of_arrows"));
  const debuff = ordinaryAbilityHridsForTemplate(
    { combatType: "弩", duty: "debuffer", roleIndex: 0 },
    { bossKey: "badger", rangedDebuffCount: 2 },
  );
  assert.ok(debuff.includes("/abilities/pestilent_shot"));
});

test("chameleon ST fire is 元素增幅/精确/烟爆/火球", () => {
  const hrids = ordinaryAbilityHridsForTemplate(
    { combatType: "火", duty: "debuffer", roleIndex: 0 },
    { bossKey: "chameleon" },
  );
  assert.deepEqual(hrids, [
    "/abilities/elemental_affinity",
    "/abilities/precision",
    "/abilities/smoke_burst",
    "/abilities/fireball",
  ]);
});

test("chameleon ST spear is 狂暴/精确/破甲/狂速; sword matches swarm", () => {
  const spear = ordinaryAbilityHridsForTemplate(
    { combatType: "枪", duty: "debuffer", roleIndex: 0 },
    { bossKey: "chameleon" },
  );
  assert.deepEqual(spear, [
    "/abilities/berserk",
    "/abilities/precision",
    "/abilities/puncture",
    "/abilities/frenzy",
  ]);
  const sword = ordinaryAbilityHridsForTemplate(
    { combatType: "剑", duty: "debuffer", roleIndex: 0 },
    { bossKey: "chameleon" },
  );
  assert.deepEqual(sword, [
    "/abilities/berserk",
    "/abilities/precision",
    "/abilities/maim",
    "/abilities/crippling_slash",
  ]);
});

test("chameleon ST healer is 群疗/增幅/生命吸取/缠绕; lowest 3 keep 粉尘", () => {
  assert.deepEqual(ST_NATURE_HEALER_DRAIN_KIT, [
    "/abilities/rejuvenate",
    "/abilities/elemental_affinity",
    "/abilities/life_drain",
    "/abilities/entangle",
  ]);
  assert.deepEqual(ST_NATURE_HEALER_POLLEN_KIT, [
    "/abilities/rejuvenate",
    "/abilities/elemental_affinity",
    "/abilities/toxic_pollen",
    "/abilities/entangle",
  ]);
  const drain = ordinaryAbilityHridsForTemplate(
    { combatType: "自", duty: "healer", roleIndex: 3 },
    { bossKey: "chameleon" },
  );
  assert.deepEqual(drain, ST_NATURE_HEALER_DRAIN_KIT);
  const pollen = ordinaryAbilityHridsForTemplate(
    { combatType: "自", duty: "healer", roleIndex: 0 },
    { bossKey: "chameleon" },
  );
  assert.deepEqual(pollen, ST_NATURE_HEALER_POLLEN_KIT);
  const patched = applyStNatureHealerKits(
    [
      { memberId: "weak", combatType: "自", duty: "dps", abilityHrids: ["/abilities/revive", "x"] },
      { memberId: "strong", combatType: "自", duty: "dps", abilityHrids: ["/abilities/insanity", "y"] },
    ],
    { pollenMemberIds: ["weak"], pollenCount: 3 },
  );
  assert.equal(patched[0].duty, "healer");
  assert.deepEqual(patched[0].abilityHrids.slice(1), ST_NATURE_HEALER_POLLEN_KIT);
  assert.deepEqual(patched[1].abilityHrids.slice(1), ST_NATURE_HEALER_DRAIN_KIT);
});

test("abilityTemplatesForBoss maps badger onto the AOE table", () => {
  const aoe = abilityTemplatesForBoss("badger");
  assert.equal(aoe, abilityTemplatesForBoss("swarm"));
  assert.ok(aoe.自_healer.required.includes("/abilities/natures_veil"));
});
