import assert from "node:assert/strict";
import test from "node:test";

await import("../../userscripts/member-snapshot-payload-builder.js");
const { buildMemberSnapshot } = globalThis.MwiTrialPayloadBuilder;

const equipment = [
  { locationHrid: "/item_locations/main_hand", itemHrid: "/items/wand", enhancementLevel: 5 },
  { locationHrid: "/item_locations/body", itemHrid: "/items/robe", enhancementLevel: 3 },
];
const loadout = (id, extras = {}) => ({
  loadoutId: id, name: `Build ${id}`, equipment, abilities: [{ slot: 0, abilityHrid: "/abilities/fireball", level: 60, triggers: [{ dependencyHrid: "/combat_trigger_dependencies/self", conditionHrid: "/combat_trigger_conditions/always", comparatorHrid: "/combat_trigger_comparators/is_active", value: 1 }] }], ...extras,
});
const build = (overrides = {}) => buildMemberSnapshot({
  memberId: "member-7", displayName: "Tester", capturedAt: "2026-07-24T00:00:00.000Z", authorizedEquipment: equipment,
  loadouts: [1, 2, 3, 4, 5].map((id) => loadout(id)), selectedLoadoutIds: ["1", "2", "3", "4", "5"],
  ...overrides,
});

test("exports at most four member-approved combat loadouts", () => {
  const snapshot = build();
  assert.equal(snapshot.approvedBuilds.length, 4);
  assert.deepEqual(snapshot.approvedBuilds.map((item) => item.sourceLoadoutId), [1, 2, 3, 4]);
  assert.ok(snapshot.approvedBuilds.every((item) => item.approvedByMember));
});

test("does not export a selected loadout containing unauthorized equipment", () => {
  const snapshot = build({ loadouts: [loadout(1), loadout(2, { equipment: [...equipment, { locationHrid: "/item_locations/head", itemHrid: "/items/not-owned", enhancementLevel: 0 }] })], selectedLoadoutIds: ["1", "2"] });
  assert.equal(snapshot.approvedBuilds.length, 1);
  assert.equal(snapshot.approvedBuilds[0].sourceLoadoutId, 1);
  assert.match(snapshot.issues[0], /incomplete-or-not-owned/);
});

test("removes food, drinks, and consumable triggers from the export", () => {
  const snapshot = build({ loadouts: [loadout(1, { equipment: [...equipment, { locationHrid: "/item_locations/food", itemHrid: "/items/food_pie" }], abilities: [{ abilityHrid: "/abilities/fireball", level: 60, triggers: [{ dependencyHrid: "/combat_trigger_dependencies/food", conditionHrid: "/combat_trigger_conditions/always", comparatorHrid: "/combat_trigger_comparators/is_active", value: 1 }] }] })], selectedLoadoutIds: ["1"] });
  assert.equal(snapshot.approvedBuilds[0].equipment.some((item) => /food|drink/i.test(item.itemHrid)), false);
  assert.deepEqual(snapshot.approvedBuilds[0].abilities[0].triggers, []);
});

test("never emits sensitive token-like fields", () => {
  const snapshot = build({ character: { memberId: "member-7", discordToken: "nope", nested: { gm_token: "nope" } }, apiToken: "nope", authorization: "nope" });
  assert.equal(JSON.stringify(snapshot).match(/token|authorization|gm_/i), null);
});

test("exports skill, learned ability, and aura levels from game arrays", () => {
  const snapshot = build({
    skills: [{ skillHrid: "/skills/magic", level: 140 }],
    learnedAbilities: [{ abilityHrid: "/abilities/fireball", level: 60 }],
    auras: [{ abilityHrid: "/abilities/mystic_aura", level: 40 }],
  });
  assert.equal(snapshot.skills["/skills/magic"], 140);
  assert.equal(snapshot.learnedAbilities["/abilities/fireball"], 60);
  assert.equal(snapshot.auras["/abilities/mystic_aura"], 40);
});

test("preserves combat and profession loadouts in the catalog", () => {
  const snapshot = build({
    loadouts: [
      loadout(1, { actionTypeHrid: "/action_types/combat" }),
      loadout(2, { actionTypeHrid: "/action_types/tailoring", abilities: [] }),
    ],
    selectedLoadoutIds: ["1"],
  });
  assert.equal(snapshot.loadoutCatalog.length, 2);
  assert.deepEqual(snapshot.loadoutCatalog.map((item) => item.category), ["combat", "profession"]);
  assert.equal(snapshot.loadoutCatalog[1].actionTypeHrid, "/action_types/tailoring");
  assert.equal(snapshot.loadoutCatalog[1].equipment.length, 2);
  assert.deepEqual(snapshot.loadoutCatalog[1].abilities, []);
  assert.equal(snapshot.approvedBuilds.length, 1);
});

test("preserves all-actions loadouts as their own category", () => {
  const snapshot = build({
    loadouts: [loadout(1, { actionTypeHrid: null, abilities: [] })],
    selectedLoadoutIds: [],
  });
  assert.equal(snapshot.loadoutCatalog[0].category, "all");
  assert.equal(snapshot.loadoutCatalog[0].actionTypeHrid, "/action_types/all");
});

test("deduplicates equipment slots and caps malformed loadouts at the API boundary", () => {
  const oversized = Array.from({ length: 25 }, (_, index) => ({
    locationHrid: `/item_locations/slot_${index}`,
    itemHrid: `/items/item_${index}`,
    enhancementLevel: index,
  }));
  const snapshot = build({
    authorizedEquipment: oversized,
    loadouts: [loadout(1, { equipment: [...oversized, oversized[0]], abilities: [] })],
    selectedLoadoutIds: [],
  });
  assert.equal(snapshot.loadoutCatalog[0].equipment.length, 20);
});

test("authorizes equipped items by owned item identity rather than inventory location", () => {
  const snapshot = build({
    authorizedEquipment: equipment.map((item) => ({ ...item, locationHrid: "/item_locations/inventory" })),
    loadouts: [loadout(1, { actionTypeHrid: "/action_types/combat" })],
    selectedLoadoutIds: ["1"],
  });
  assert.equal(snapshot.approvedBuilds.length, 1);
});

test("resolves stale saved enhancement levels to currently owned upgrades", () => {
  const snapshot = build({
    authorizedEquipment: equipment.map((item) => ({ ...item, enhancementLevel: item.enhancementLevel + 4 })),
    loadouts: [loadout(1, { actionTypeHrid: "/action_types/combat" })],
    selectedLoadoutIds: ["1"],
  });
  assert.equal(snapshot.approvedBuilds.length, 1);
  assert.deepEqual(snapshot.approvedBuilds[0].equipment.map((item) => item.enhancementLevel), [7, 9]);
  assert.deepEqual(snapshot.loadoutCatalog[0].equipment.map((item) => item.enhancementLevel), [7, 9]);
  assert.deepEqual(snapshot.loadoutCatalog[0].issues, []);
});

test("uses the highest currently owned item even when a saved loadout has a stale higher requirement", () => {
  const snapshot = build({
    authorizedEquipment: equipment.map((item) => ({ ...item, enhancementLevel: Math.max(0, item.enhancementLevel - 1) })),
    loadouts: [loadout(1, { actionTypeHrid: "/action_types/combat" })],
    selectedLoadoutIds: ["1"],
  });
  assert.equal(snapshot.approvedBuilds.length, 1);
  assert.deepEqual(snapshot.approvedBuilds[0].equipment.map((item) => item.enhancementLevel), [2, 4]);
  assert.deepEqual(snapshot.loadoutCatalog[0].issues, []);
});

test("always resolves to the highest owned enhancement for the same item", () => {
  const snapshot = build({
    authorizedEquipment: [
      ...equipment,
      ...equipment.map((item) => ({ ...item, enhancementLevel: item.enhancementLevel + 6 })),
      ...equipment.map((item) => ({ ...item, enhancementLevel: item.enhancementLevel + 2 })),
    ],
    loadouts: [loadout(1, { actionTypeHrid: "/action_types/combat" })],
    selectedLoadoutIds: ["1"],
  });
  assert.deepEqual(snapshot.approvedBuilds[0].equipment.map((item) => item.enhancementLevel), [9, 11]);
  assert.deepEqual(snapshot.loadoutCatalog[0].equipment.map((item) => item.enhancementLevel), [9, 11]);
});

test("accepts native MWI wearableMap and abilityMap before page-bridge normalization", () => {
  const snapshot = build({
    authorizedEquipment: [
      { itemHrid: "/items/test_spear", enhancementLevel: 10 },
      { itemHrid: "/items/test_body", enhancementLevel: 12 },
    ],
    loadouts: [{
      id: 9,
      name: "枪",
      actionTypeHrid: "/action_types/combat",
      wearableMap: {
        "/item_locations/main_hand": { itemHrid: "/items/test_spear", enhancementLevel: 10 },
        "/item_locations/body": "195739::/item_locations/body::/items/test_body::12",
      },
      abilityMap: { 1: "/abilities/smash" },
    }],
    selectedLoadoutIds: ["9"],
  });
  assert.equal(snapshot.loadoutCatalog[0].equipment.length, 2);
  assert.equal(snapshot.loadoutCatalog[0].abilities.length, 1);
  assert.equal(snapshot.approvedBuilds[0].equipment.length, 2);
  assert.equal(snapshot.approvedBuilds[0].abilities[0].abilityHrid, "/abilities/smash");
});

test("manual game paste converts player levels and equipped combat loadout", () => {
  const { buildMemberSnapshotFromGamePaste } = globalThis.MwiTrialPayloadBuilder;
  const snapshot = buildMemberSnapshotFromGamePaste({
    memberId: "Acceleratorlin",
    player: {
      attackLevel: 130,
      magicLevel: 154,
      staminaLevel: 130,
      intelligenceLevel: 120,
      defenseLevel: 130,
      rangedLevel: 100,
      meleeLevel: 46,
      equipment: [
        { itemLocationHrid: "/item_locations/main_hand", itemHrid: "/items/blooming_trident_refined", enhancementLevel: 12 },
        { itemLocationHrid: "/item_locations/off_hand", itemHrid: "/items/bishops_codex_refined", enhancementLevel: 12 },
        { itemLocationHrid: "/item_locations/head", itemHrid: "/items/magicians_hat_refined", enhancementLevel: 12 },
        { itemLocationHrid: "/item_locations/body", itemHrid: "/items/royal_nature_robe_top_refined", enhancementLevel: 12 },
        { itemLocationHrid: "/item_locations/legs", itemHrid: "/items/royal_nature_robe_bottoms_refined", enhancementLevel: 12 },
        { itemLocationHrid: "/item_locations/feet", itemHrid: "/items/pathseeker_boots_refined", enhancementLevel: 12 },
        { itemLocationHrid: "/item_locations/hands", itemHrid: "/items/chrono_gloves", enhancementLevel: 14 },
        { itemLocationHrid: "/item_locations/ring", itemHrid: "/items/philosophers_ring", enhancementLevel: 7 },
        { itemLocationHrid: "/item_locations/trinket", itemHrid: "/items/expert_task_badge", enhancementLevel: 5 },
        { itemLocationHrid: "/item_locations/milking_tool", itemHrid: "/items/holy_brush", enhancementLevel: 5 },
      ],
    },
    abilities: [
      { abilityHrid: "/abilities/critical_aura", level: 38 },
      { abilityHrid: "/abilities/quick_aid", level: 80 },
      { abilityHrid: "/abilities/natures_veil", level: 77 },
      { abilityHrid: "/abilities/toxic_pollen", level: 84 },
      { abilityHrid: "/abilities/entangle", level: 77 },
    ],
    triggerMap: {
      "/abilities/critical_aura": [{
        dependencyHrid: "/combat_trigger_dependencies/self",
        conditionHrid: "/combat_trigger_conditions/critical_aura",
        comparatorHrid: "/combat_trigger_comparators/is_inactive",
        value: 0,
      }],
    },
  });
  assert.equal(snapshot.memberId, "Acceleratorlin");
  assert.equal(snapshot.confidence, "simulation-ready");
  assert.equal(snapshot.skills["/skills/magic"], 154);
  assert.equal(snapshot.auras["/abilities/critical_aura"], 38);
  assert.equal(snapshot.approvedBuilds.length, 1);
  assert.equal(snapshot.approvedBuilds[0].equipment.some((item) => item.locationHrid === "/item_locations/ring"), true);
  assert.equal(snapshot.approvedBuilds[0].equipment.some((item) => item.locationHrid === "/item_locations/trinket"), true);
  assert.equal(snapshot.loadoutCatalog.some((loadout) => loadout.category === "all"), true);
  assert.ok(snapshot.issues.includes("manual-game-paste"));
});
