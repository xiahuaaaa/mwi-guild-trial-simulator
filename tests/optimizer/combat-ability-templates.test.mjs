import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHammerFixedKit,
  HAMMER_FIXED_KIT,
  NATURE_DPS_FIXED_KIT,
  NATURE_HEALER_FIXED_KIT,
  applyStNatureHealerKits,
  applyStRangedPestilentCoverage,
  rankedStRangedCoverageIds,
  PESTILENT_SHOT_HRID,
  STEADY_SHOT_HRID,
  ST_NATURE_HEALER_DRAIN_KIT,
  ST_NATURE_HEALER_POLLEN_KIT,
  ST_NATURE_HEALER_SMOKE_KIT,
  ST_NATURE_HEALER_FROST_KIT,
  AOE_NATURE_HEALER_SMOKE_KIT,
  AOE_NATURE_HEALER_FROST_KIT,
  assignNatureDebuffBackup,
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

test("hedgehog ST fire is 增幅/烟爆/火焰风暴或精确/火球", () => {
  const firestorm = ordinaryAbilityHridsForTemplate(
    { combatType: "火", duty: "dps", roleIndex: 0 },
    { bossKey: "hedgehog", fireOptional: "firestorm" },
  );
  assert.deepEqual(firestorm, [
    "/abilities/elemental_affinity",
    "/abilities/smoke_burst",
    "/abilities/firestorm",
    "/abilities/fireball",
  ]);
  const precision = ordinaryAbilityHridsForTemplate(
    { combatType: "火", duty: "dps", roleIndex: 1 },
    { bossKey: "hedgehog", fireOptional: "precision" },
  );
  assert.deepEqual(precision, [
    "/abilities/elemental_affinity",
    "/abilities/smoke_burst",
    "/abilities/precision",
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

test("ST ranged keep 2 pestilent coverage and swap the rest to steady shot", () => {
  const ranked = rankedStRangedCoverageIds(
    [
      { memberId: "strong", combatType: "弩" },
      { memberId: "weak", combatType: "弓" },
      { memberId: "mid", combatType: "弩" },
      { memberId: "mage", combatType: "火" },
    ],
    new Map([
      ["strong", 90],
      ["weak", 10],
      ["mid", 40],
    ]),
  );
  assert.deepEqual(ranked, ["weak", "mid", "strong"]);
  const patched = applyStRangedPestilentCoverage(
    [
      {
        memberId: "weak",
        combatType: "弓",
        duty: "dps",
        abilityHrids: [
          "/abilities/insanity",
          "/abilities/berserk",
          "/abilities/precision",
          PESTILENT_SHOT_HRID,
          "/abilities/frenzy",
        ],
      },
      {
        memberId: "strong",
        combatType: "弩",
        duty: "dps",
        abilityHrids: [
          "/abilities/revive",
          "/abilities/berserk",
          "/abilities/precision",
          PESTILENT_SHOT_HRID,
          "/abilities/frenzy",
        ],
      },
    ],
    { pestilentMemberIds: ["weak"], pestilentCount: 2 },
  );
  assert.equal(patched[0].duty, "debuffer");
  assert.ok(patched[0].abilityHrids.includes(PESTILENT_SHOT_HRID));
  assert.equal(patched[1].duty, "dps");
  assert.equal(patched[1].abilityHrids[3], STEADY_SHOT_HRID);
  assert.equal(patched[1].abilityHrids[0], "/abilities/revive");
});

test("abilityTemplatesForBoss maps badger onto the AOE table", () => {
  const aoe = abilityTemplatesForBoss("badger");
  assert.equal(aoe, abilityTemplatesForBoss("swarm"));
  assert.ok(aoe.自_healer.required.includes("/abilities/natures_veil"));
});

function coverageTeam({ fires = 0, waters = 0, healers = 6 } = {}) {
  const team = [];
  for (let i = 0; i < fires; i += 1) {
    team.push({
      memberId: `fire${i}`,
      combatType: "火",
      duty: "debuffer",
      roleIndex: i,
    });
  }
  for (let i = 0; i < waters; i += 1) {
    team.push({
      memberId: `water${i}`,
      combatType: "水",
      duty: "dps",
      roleIndex: i,
    });
  }
  for (let i = 0; i < healers; i += 1) {
    team.push({
      memberId: `nature${i}`,
      combatType: "自",
      duty: "healer",
      roleIndex: i,
    });
  }
  return team;
}

function natureKits(team, definition) {
  return Object.fromEntries(
    team
      .filter((row) => row.combatType === "自")
      .map((row) => [row.memberId, ordinaryAbilityHridsForTemplate(row, definition)]),
  );
}

test("hedgehog 1 fire + 1 water: weakest natures split smoke/frost; pollen stays on the next three", () => {
  const team = coverageTeam({ fires: 1, waters: 1, healers: 6 });
  const assigned = assignNatureDebuffBackup(team, { bossKey: "hedgehog" });
  assert.deepEqual(assigned.smokeBackups, ["nature0"]);
  assert.deepEqual(assigned.frostBackups, ["nature1"]);
  assert.deepEqual(assigned.pollenIds, ["nature2", "nature3", "nature4"]);
  const kits = natureKits(team, { bossKey: "hedgehog" });
  assert.deepEqual(kits.nature0, ST_NATURE_HEALER_SMOKE_KIT);
  assert.deepEqual(kits.nature1, ST_NATURE_HEALER_FROST_KIT);
  assert.deepEqual(kits.nature2, ST_NATURE_HEALER_POLLEN_KIT);
  assert.deepEqual(kits.nature3, ST_NATURE_HEALER_POLLEN_KIT);
  assert.deepEqual(kits.nature4, ST_NATURE_HEALER_POLLEN_KIT);
  assert.deepEqual(kits.nature5, ST_NATURE_HEALER_DRAIN_KIT);
  const pollenCount = Object.values(kits).filter((kit) =>
    kit.includes("/abilities/toxic_pollen"),
  ).length;
  assert.ok(pollenCount >= 2);
});

test("swarm 2 fire + 2 water does not borrow nature for smoke or frost", () => {
  const team = coverageTeam({ fires: 2, waters: 2, healers: 4 });
  const assigned = assignNatureDebuffBackup(team, {
    bossKey: "swarm",
    fireSmokeBurstCount: 2,
  });
  assert.deepEqual(assigned.smokeBackups, []);
  assert.deepEqual(assigned.frostBackups, []);
  const kits = natureKits(team, { bossKey: "swarm", fireSmokeBurstCount: 2 });
  assert.deepEqual(kits.nature0, NATURE_HEALER_FIXED_KIT);
});

test("swarm 1 fire + 2 water: weakest nature carries smoke, not frost", () => {
  const team = coverageTeam({ fires: 1, waters: 2, healers: 4 });
  const assigned = assignNatureDebuffBackup(team, {
    bossKey: "swarm",
    fireSmokeBurstCount: 2,
  });
  assert.deepEqual(assigned.smokeBackups, ["nature0"]);
  assert.deepEqual(assigned.frostBackups, []);
  const kits = natureKits(team, { bossKey: "swarm", fireSmokeBurstCount: 2 });
  assert.deepEqual(kits.nature0, AOE_NATURE_HEALER_SMOKE_KIT);
  assert.deepEqual(kits.nature1, NATURE_HEALER_FIXED_KIT);
});

test("AOE frost backup kit is 群疗/菌幕/冰霜/缠绕", () => {
  const team = coverageTeam({ fires: 2, waters: 1, healers: 3 });
  assignNatureDebuffBackup(team, { bossKey: "swarm", fireSmokeBurstCount: 2 });
  const kits = natureKits(team, { bossKey: "swarm", fireSmokeBurstCount: 2 });
  assert.deepEqual(kits.nature0, AOE_NATURE_HEALER_FROST_KIT);
});

