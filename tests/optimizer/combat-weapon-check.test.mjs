import assert from "node:assert/strict";
import test from "node:test";
import {
  collectWeaponEnhancementAlerts,
  formatWeaponEnhancementCheck,
  inspectAvailableCombatWeapon,
  WEAPON_ENHANCEMENT_ALERT_BELOW,
} from "../../packages/optimizer/src/combat-weapon-check.mjs";

function combatSnapshot({
  weaponHrid,
  enhancementLevel,
  skills = {},
  attackLevel = 130,
}) {
  return {
    skills: {
      "/skills/attack": attackLevel,
      "/skills/ranged": 150,
      "/skills/magic": 140,
      "/skills/melee": 145,
      "/skills/defense": 120,
      ...skills,
    },
    learnedAbilities: {},
    loadoutCatalog: [
      {
        name: "战斗",
        category: "combat",
        issues: [],
        equipment: [
          { itemHrid: weaponHrid, enhancementLevel },
          { itemHrid: "/items/magicians_hat_refined", enhancementLevel: 10 },
          { itemHrid: "/items/royal_water_robe_top_refined", enhancementLevel: 10 },
          { itemHrid: "/items/royal_water_robe_bottoms_refined", enhancementLevel: 10 },
          { itemHrid: "/items/pathseeker_boots_refined", enhancementLevel: 10 },
        ],
      },
    ],
  };
}

test("weapon enhancement alert threshold excludes ★+12", () => {
  assert.equal(WEAPON_ENHANCEMENT_ALERT_BELOW, 12);
});

test("inspect flags refined weapons strictly below +12 and accepts +12", () => {
  const below = inspectAvailableCombatWeapon(
    combatSnapshot({
      weaponHrid: "/items/sundering_crossbow_refined",
      enhancementLevel: 10,
    }),
    "弩",
  );
  assert.equal(below.available, true);
  assert.equal(below.belowThreshold, true);
  assert.equal(below.refined, true);
  assert.equal(below.enhancementLevel, 10);
  assert.equal(below.enhancementLabel, "★+10");
  assert.equal(below.weaponName, "裂空之弩");
  assert.equal(below.primaryLabel, "远程");
  assert.equal(below.primaryLevel, 150);

  const atThreshold = inspectAvailableCombatWeapon(
    combatSnapshot({
      weaponHrid: "/items/sundering_crossbow_refined",
      enhancementLevel: 12,
    }),
    "弩",
  );
  assert.equal(atThreshold.available, true);
  assert.equal(atThreshold.belowThreshold, false);
  assert.equal(atThreshold.enhancementLabel, "★+12");
});

test("inspect flags unrefined weapons below +12", () => {
  const inspected = inspectAvailableCombatWeapon(
    combatSnapshot({
      weaponHrid: "/items/blazing_trident",
      enhancementLevel: 7,
    }),
    "火",
  );
  assert.equal(inspected.available, true);
  assert.equal(inspected.belowThreshold, true);
  assert.equal(inspected.refined, false);
  assert.equal(inspected.enhancementLabel, "普通+7");
  assert.equal(inspected.primaryLabel, "魔法");
});

test("inspect skips members who fail combat readiness", () => {
  const inspected = inspectAvailableCombatWeapon(
    { skills: { "/skills/attack": 100 }, loadoutCatalog: [] },
    "弓",
  );
  assert.equal(inspected.available, false);
  assert.match(inspected.reason, /攻击等级不足/u);
});

test("collect and format list only available members below +12", () => {
  const members = [
    {
      memberId: "xlsx",
      latestSnapshot: combatSnapshot({
        weaponHrid: "/items/sundering_crossbow",
        enhancementLevel: 7,
        skills: { "/skills/ranged": 117 },
      }),
    },
    {
      memberId: "Lucian717",
      latestSnapshot: combatSnapshot({
        weaponHrid: "/items/sundering_crossbow_refined",
        enhancementLevel: 10,
        skills: { "/skills/ranged": 158 },
      }),
    },
    {
      memberId: "JackLee",
      latestSnapshot: combatSnapshot({
        weaponHrid: "/items/cursed_bow_refined",
        enhancementLevel: 12,
        skills: { "/skills/ranged": 154 },
      }),
    },
    {
      memberId: "low-attack",
      latestSnapshot: {
        skills: { "/skills/attack": 80 },
        loadoutCatalog: [],
      },
    },
  ];
  const bindings = [
    { memberId: "xlsx", combatType: "弩" },
    { memberId: "Lucian717", combatType: "弩" },
    { memberId: "JackLee", combatType: "弓" },
    { memberId: "low-attack", combatType: "弩" },
    { memberId: "gone", combatType: "剑" },
  ];

  const { availableCount, alerts } = collectWeaponEnhancementAlerts(
    members,
    bindings,
  );
  assert.equal(availableCount, 3);
  assert.deepEqual(
    alerts.map((row) => row.memberId),
    ["xlsx", "Lucian717"],
  );

  const text = formatWeaponEnhancementCheck(members, bindings);
  assert.match(text, /可用 3 人，主武器强化低于★\+12：2 人/u);
  assert.match(text, /不含★\+12/u);
  assert.match(text, /xlsx\/弩  裂空之弩 普通\+7  远程117/u);
  assert.match(text, /Lucian717\/弩  裂空之弩 ★\+10  远程158/u);
  assert.doesNotMatch(text, /JackLee/u);
  assert.doesNotMatch(text, /low-attack/u);
});

test("format reports none when every available weapon is at least +12", () => {
  const members = [
    {
      memberId: "JackLee",
      latestSnapshot: combatSnapshot({
        weaponHrid: "/items/cursed_bow_refined",
        enhancementLevel: 16,
      }),
    },
  ];
  const text = formatWeaponEnhancementCheck(members, [
    { memberId: "JackLee", combatType: "弓" },
  ]);
  assert.match(text, /可用 1 人，主武器强化低于★\+12：0 人/u);
  assert.match(text, /无人低于★\+12/u);
});
