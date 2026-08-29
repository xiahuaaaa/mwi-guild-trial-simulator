import assert from "node:assert/strict";
import test from "node:test";
import {
  selectCombatBuild,
  synthesizeCombatBuild,
} from "../../packages/optimizer/src/combat-build-selection.mjs";

const entry = (itemHrid, enhancementLevel = 10) => ({
  itemHrid,
  enhancementLevel,
});

const mageCombatEquipment = (element = "water", enhancementLevel = 10) => [
  entry(`/items/${element === "water" ? "rippling" : element === "fire" ? "blazing" : "blooming"}_trident_refined`, enhancementLevel),
  entry("/items/bishops_codex_refined", enhancementLevel),
  entry("/items/chrono_gloves", enhancementLevel),
  entry("/items/magicians_hat_refined", enhancementLevel),
  entry(`/items/royal_${element}_robe_top_refined`, enhancementLevel),
  entry(`/items/royal_${element}_robe_bottoms_refined`, enhancementLevel),
  entry("/items/pathseeker_boots_refined", enhancementLevel),
];

const lifeEquipmentWithWaterWeapon = [
  entry("/items/rippling_trident_refined", 14),
  entry("/items/alchemists_top", 10),
  entry("/items/alchemists_bottoms", 10),
  entry("/items/collectors_boots", 10),
  entry("/items/enchanted_gloves", 10),
  entry("/items/red_culinary_hat", 10),
  entry("/items/eye_watch", 10),
  entry("/items/holy_alembic", 10),
];

test("dedicated combat loadout beats a higher-enhancement all-actions life set", () => {
  const snapshot = {
    loadoutCatalog: [
      {
        name: "所有行动",
        category: "all",
        equipment: lifeEquipmentWithWaterWeapon,
        issues: [],
      },
      {
        name: "公会水法",
        category: "combat",
        equipment: mageCombatEquipment("water", 10),
        issues: [],
      },
    ],
  };

  const selection = selectCombatBuild(snapshot, "水");
  assert.equal(selection.source, "dedicated-combat-loadout");
  assert.equal(selection.build.name, "公会水法");
  assert.ok(selection.build.equipment.some((row) => row.itemHrid.includes("bishops_codex")));
  assert.ok(!selection.build.equipment.some((row) => row.itemHrid === "/items/alchemists_top"));
});

test("all-actions set is reconstructed from owned battle equipment when no battle preset exists", () => {
  const ownedAcrossLoadouts = mageCombatEquipment("water", 12).map(
    (equipment, index) => ({
      name: `生活-${index}`,
      category: "profession",
      issues: [],
      equipment: [
        ...lifeEquipmentWithWaterWeapon,
        equipment,
      ],
    }),
  );

  const build = synthesizeCombatBuild(ownedAcrossLoadouts, "水");
  assert.equal(build.name, "自动重组-水-战斗配装");
  for (const required of [
    "rippling_trident",
    "bishops_codex",
    "chrono_gloves",
    "magicians_hat",
    "royal_water_robe_top",
    "royal_water_robe_bottoms",
    "pathseeker_boots",
  ]) {
    assert.ok(
      build.equipment.some((row) => row.itemHrid.includes(required)),
      required,
    );
  }
  assert.ok(!build.equipment.some((row) => row.itemHrid === "/items/alchemists_top"));
});

test("highest enhancement of the same owned item is retained", () => {
  const catalog = [
    {
      category: "profession",
      equipment: [
        ...mageCombatEquipment("nature", 10),
        entry("/items/chrono_gloves", 14),
      ],
    },
  ];
  const selection = selectCombatBuild({ loadoutCatalog: catalog }, "自");
  const gloves = selection.build.equipment.find(
    (row) => row.itemHrid === "/items/chrono_gloves",
  );
  assert.equal(gloves.enhancementLevel, 14);
});

test("combat necklace and task badge slots are kept (game types are neck/trinket)", () => {
  const snapshot = {
    loadoutCatalog: [
      {
        name: "水法",
        category: "combat",
        issues: [],
        equipment: [
          ...mageCombatEquipment("water", 7),
          entry("/items/wizard_necklace", 3),
          entry("/items/expert_task_badge", 0),
        ],
      },
    ],
  };

  const selection = selectCombatBuild(snapshot, "水");
  assert.equal(selection.source, "dedicated-combat-loadout");
  assert.ok(
    selection.build.equipment.some((row) => row.itemHrid === "/items/wizard_necklace"),
    "wizard necklace must stay in the combat build",
  );
  assert.ok(
    selection.build.equipment.some((row) => row.itemHrid === "/items/expert_task_badge"),
    "task badge must stay in the combat build",
  );
});

test("skilling necklace in a combat preset is replaced by an owned combat necklace", () => {
  const snapshot = {
    loadoutCatalog: [
      {
        name: "fire",
        category: "combat",
        issues: [],
        equipment: [
          ...mageCombatEquipment("fire", 6),
          entry("/items/necklace_of_wisdom", 4),
          entry("/items/chimerical_quiver", 0),
        ],
      },
      {
        name: "水法配件",
        category: "combat",
        issues: [],
        equipment: [
          ...mageCombatEquipment("water", 5),
          entry("/items/wizard_necklace", 3),
          entry("/items/enchanted_cloak", 3),
        ],
      },
    ],
  };

  const selection = selectCombatBuild(snapshot, "火");
  assert.equal(selection.source, "dedicated-combat-loadout");
  assert.equal(selection.build.name, "fire");
  assert.ok(
    selection.build.equipment.some((row) => row.itemHrid === "/items/wizard_necklace"),
  );
  assert.ok(
    !selection.build.equipment.some((row) => row.itemHrid === "/items/necklace_of_wisdom"),
  );
  assert.ok(
    selection.build.equipment.some((row) => row.itemHrid === "/items/enchanted_cloak"),
    "ranged quiver on a mage should yield to an owned mage cloak",
  );
  assert.ok(
    !selection.build.equipment.some((row) => row.itemHrid === "/items/chimerical_quiver"),
  );
});

test("profession rare-find jewelry is not overlaid onto a combat preset", () => {
  const snapshot = {
    loadoutCatalog: [
      {
        name: "fire",
        category: "combat",
        issues: [],
        equipment: [
          ...mageCombatEquipment("fire", 6),
          entry("/items/earrings_of_regeneration", 3),
          entry("/items/ring_of_regeneration", 7),
        ],
      },
      {
        name: "炼金",
        category: "profession",
        issues: [],
        equipment: [
          entry("/items/alchemists_top", 10),
          entry("/items/earrings_of_rare_find", 7),
          entry("/items/ring_of_rare_find", 7),
          entry("/items/necklace_of_wisdom", 4),
        ],
      },
    ],
  };

  const selection = selectCombatBuild(snapshot, "火");
  const hrids = selection.build.equipment.map((row) => row.itemHrid);
  assert.ok(hrids.includes("/items/earrings_of_regeneration"));
  assert.ok(hrids.includes("/items/ring_of_regeneration"));
  assert.ok(!hrids.includes("/items/earrings_of_rare_find"));
  assert.ok(!hrids.includes("/items/ring_of_rare_find"));
  assert.ok(!hrids.includes("/items/necklace_of_wisdom"));
});
