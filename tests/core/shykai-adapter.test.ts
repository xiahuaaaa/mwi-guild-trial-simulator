import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createShykaiAbility,
  createShykaiBuff,
  processUpstreamBasicAttack,
  sanitizeGuildTrialPlayerDto,
  scaleShykaiMonster,
  SHYKAI_MODULE_INVENTORY,
  UnsupportedUpstreamCombatPathError,
  type FloatRandomSource,
  type ShykaiCombatUnitView,
} from "../../packages/shykai-adapter/src/index.ts";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/shykai-basic-attack-parity.json", import.meta.url),
    "utf8",
  ),
);

test("module inventory hashes match the pinned source-import manifest", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../tools/source-import/sources.json", import.meta.url),
      "utf8",
    ),
  );
  const workerArtifact = manifest.shykai.artifacts.find(
    (artifact: { file: string }) =>
      artifact.file === "src_worker_js.bundle.js.map",
  );
  const pinned = new Map(
    workerArtifact.sourceModules.map(
      (module: { path: string; sha256: string }) => [
        module.path,
        module.sha256,
      ],
    ),
  );
  assert.equal(SHYKAI_MODULE_INVENTORY.length, 6);
  for (const module of SHYKAI_MODULE_INVENTORY) {
    assert.equal(pinned.get(module.upstreamPath), module.upstreamSha256);
  }
});

test("ordinary basic attacks match the unmodified upstream parity fixture", () => {
  for (const parityCase of fixture.cases) {
    const source = createUnit(fixture.source);
    const target = createUnit(fixture.target);
    const random = new SequenceRandom(parityCase.randomFloats);
    const result = processUpstreamBasicAttack(source, target, random);

    assert.equal(result.damageDone, parityCase.expected.damageDone, parityCase.name);
    assert.equal(result.didHit, parityCase.expected.didHit, parityCase.name);
    assert.equal(result.isCrit, parityCase.expected.isCrit, parityCase.name);
    assert.equal(
      target.combatDetails.currentHitpoints,
      parityCase.expected.targetHitpoints,
      parityCase.name,
    );
    assert.equal(
      random.drawCount,
      parityCase.expected.randomDrawCount,
      parityCase.name,
    );
  }
});

test("unsupported upstream mechanics fail before consuming random values", () => {
  const source = createUnit(fixture.source);
  const target = createUnit(fixture.target);
  target.combatDetails.combatStats.physicalThorns = 0.1;
  const random = new SequenceRandom([0.5]);
  assert.throws(
    () => processUpstreamBasicAttack(source, target, random),
    UnsupportedUpstreamCombatPathError,
  );
  assert.equal(random.drawCount, 0);
});

test("guild-trial Player DTO mapping strips every food and drink slot", () => {
  const result = sanitizeGuildTrialPlayerDto(
    {
      hrid: "upstream-player",
      staminaLevel: 100,
      intelligenceLevel: 100,
      attackLevel: 100,
      meleeLevel: 100,
      defenseLevel: 100,
      rangedLevel: 100,
      magicLevel: 100,
      equipment: { "/equipment_types/main_hand": null },
      food: [
        { hrid: "/items/food", triggers: [] },
        null,
      ],
      drinks: [{ hrid: "/items/drink", triggers: [] }],
      abilities: [
        {
          hrid: "/abilities/test",
          level: 10,
          triggers: [],
        },
      ],
      houseRooms: {},
      achievements: {},
      debuffOnLevelGap: 0,
    },
    "member-42",
  );

  assert.equal(result.player.hrid, "member-42");
  assert.deepEqual(result.player.food, []);
  assert.deepEqual(result.player.drinks, []);
  assert.equal(result.removedFoodSlots, 1);
  assert.equal(result.removedDrinkSlots, 1);
  assert.equal(result.player.abilities[0]?.hrid, "/abilities/test");
});

test("Monster room-level and Ability/Buff interpolation match upstream formulas", () => {
  const scaled = scaleShykaiMonster(
    {
      hrid: "/monsters/example",
      experience: 10,
      enrageTime: 60,
      abilities: [
        {
          abilityHrid: "/abilities/example",
          level: 60,
          minDifficultyTier: 0,
        },
      ],
      combatDetails: {
        staminaLevel: 100,
        intelligenceLevel: 100,
        attackLevel: 100,
        meleeLevel: 100,
        defenseLevel: 100,
        rangedLevel: 100,
        magicLevel: 100,
        attackInterval: 1_900_000_000,
        combatStats: {
          attackInterval: 0,
          armor: 200,
          waterResistance: 100,
          natureResistance: 120,
          fireResistance: 140,
        },
      },
    },
    0,
    110,
  );
  assert.equal(scaled.scaleFactor, 1.1);
  assert.equal(scaled.levels.staminaLevel, 110.00000000000001);
  assert.equal(scaled.levels.defenseLevel, 110.00000000000001);
  assert.equal(scaled.abilities[0]?.level, 66);
  assert.equal(scaled.combatStats.armor, 220.00000000000003);
  assert.equal(scaled.combatStats.attackInterval, 1_900_000_000);

  const buff = createShykaiBuff(
    {
      uniqueHrid: "/buff_uniques/example",
      typeHrid: "/buff_types/damage",
      ratioBoost: 0.1,
      ratioBoostLevelBonus: 0.01,
      flatBoost: 2,
      flatBoostLevelBonus: 0.5,
      duration: 10,
    },
    5,
  );
  assert.equal(buff.ratioBoost, 0.14);
  assert.equal(buff.flatBoost, 4);

  const ability = createShykaiAbility(
    { hrid: "/abilities/example", level: 5, triggers: [] },
    {
      hrid: "/abilities/example",
      manaCost: 10,
      cooldownDuration: 20,
      castDuration: 2,
      isSpecialAbility: false,
      defaultCombatTriggers: [],
      abilityEffects: [
        {
          targetType: "enemy",
          effectType: "/ability_effect_types/damage",
          combatStyleHrid: "/combat_styles/smash",
          damageType: "/damage_types/physical",
          baseDamageFlat: 2,
          baseDamageFlatLevelBonus: 0.5,
          baseDamageRatio: 1,
          baseDamageRatioLevelBonus: 0.1,
          bonusAccuracyRatio: 0.2,
          bonusAccuracyRatioLevelBonus: 0.01,
          damageOverTimeRatio: 0,
          damageOverTimeDuration: 0,
          armorDamageRatio: 0,
          armorDamageRatioLevelBonus: 0,
          hpDrainRatio: 0,
          pierceChance: 0,
          blindChance: 0,
          blindDuration: 0,
          silenceChance: 0,
          silenceDuration: 0,
          stunChance: 0,
          stunDuration: 0,
          spendHpRatio: 0,
          buffs: null,
        },
      ],
    },
  );
  assert.equal(ability.abilityEffects[0]?.damageFlat, 4);
  assert.equal(ability.abilityEffects[0]?.damageRatio, 1.4);
  assert.equal(
    ability.abilityEffects[0]?.bonusAccuracyRatio,
    0.24000000000000002,
  );
});

class SequenceRandom implements FloatRandomSource {
  drawCount = 0;
  private readonly values: readonly number[];

  constructor(values: readonly number[]) {
    this.values = values;
  }

  nextFloat(): number {
    const value = this.values[this.drawCount];
    if (value === undefined) {
      throw new Error(`parity random sequence exhausted at ${this.drawCount}`);
    }
    this.drawCount += 1;
    return value;
  }
}

function createUnit(input: typeof fixture.source): ShykaiCombatUnitView {
  const details = input.combatDetails;
  return {
    isWeakened: input.isWeakened,
    weakenPercentage: input.weakenPercentage,
    combatDetails: {
      currentHitpoints: details.currentHitpoints,
      maxHitpoints: details.maxHitpoints,
      stabAccuracyRating: details.accuracyRating,
      slashAccuracyRating: details.accuracyRating,
      smashAccuracyRating: details.accuracyRating,
      rangedAccuracyRating: details.accuracyRating,
      magicAccuracyRating: details.accuracyRating,
      stabMaxDamage: details.maxDamage,
      slashMaxDamage: details.maxDamage,
      smashMaxDamage: details.maxDamage,
      rangedMaxDamage: details.maxDamage,
      magicMaxDamage: details.maxDamage,
      stabEvasionRating: details.evasionRating,
      slashEvasionRating: details.evasionRating,
      smashEvasionRating: details.evasionRating,
      rangedEvasionRating: details.evasionRating,
      magicEvasionRating: details.evasionRating,
      totalArmor: details.totalArmor,
      totalWaterResistance: details.totalWaterResistance,
      totalNatureResistance: details.totalNatureResistance,
      totalFireResistance: details.totalFireResistance,
      combatStats: structuredClone(details.combatStats),
    },
  };
}
