import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../userscripts/member-candidate-loadout-exporter.user.js", import.meta.url), "utf8");

const ENCAMPMENT_BUILDING_HRIDS = {
  skilling: "/guild_buildings/skilling_encampment",
  combat: "/guild_buildings/combat_encampment",
};
const ENCAMPMENT_SLOTS_PER_LEVEL_FIELDS = {
  skilling: "skillingTrialSlotsPerLevel",
  combat: "combatTrialSlotsPerLevel",
};
const TRIAL_BASE_PARTICIPANTS = { skilling: 20, combat: 40 };

function partyCapForKind(kind, levelDict, detailDict) {
  const buildingHrid = ENCAMPMENT_BUILDING_HRIDS[kind];
  const detail = detailDict[buildingHrid] || {};
  const slotsPerLevel = detail[ENCAMPMENT_SLOTS_PER_LEVEL_FIELDS[kind]] || 0;
  const maxLevel = detail.maxLevel ?? 0;
  const buildingLevel = levelDict[buildingHrid] || 0;
  const effectiveLevel = Math.max(0, Math.min(buildingLevel, maxLevel));
  return TRIAL_BASE_PARTICIPANTS[kind] + effectiveLevel * slotsPerLevel;
}

const TMD_DETAIL_DICT = {
  [ENCAMPMENT_BUILDING_HRIDS.skilling]: {
    maxLevel: 20,
    skillingTrialSlotsPerLevel: 2,
  },
  [ENCAMPMENT_BUILDING_HRIDS.combat]: {
    maxLevel: 20,
    combatTrialSlotsPerLevel: 4,
  },
};

test("trial party cap matches MWI partyCapForKind with base slots and encampment bonus", () => {
  assert.match(source, /TRIAL_BASE_PARTICIPANTS/);
  assert.match(source, /guildBuildingLevelDict/);
  assert.match(source, /encampmentTrialSlotsBonus/);

  const levelTwo = {
    [ENCAMPMENT_BUILDING_HRIDS.skilling]: 2,
    [ENCAMPMENT_BUILDING_HRIDS.combat]: 2,
  };
  assert.equal(partyCapForKind("skilling", levelTwo, TMD_DETAIL_DICT), 24);
  assert.equal(partyCapForKind("combat", levelTwo, TMD_DETAIL_DICT), 48);

  const empty = {};
  assert.equal(partyCapForKind("skilling", empty, TMD_DETAIL_DICT), 20);
  assert.equal(partyCapForKind("combat", empty, TMD_DETAIL_DICT), 40);
});
