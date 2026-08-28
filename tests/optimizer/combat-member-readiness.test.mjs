import test from "node:test";
import assert from "node:assert/strict";
import {
  canDefaultMissingSkillLevel,
  defaultLevelForMissingAbility,
  isAuraAbilityHrid,
  resolveLearnedAbilityLevel,
  DEFAULT_MISSING_SKILL_LEVEL,
  DEFAULT_REVIVE_INSANITY_LEVEL,
} from "../../packages/shykai-full-runtime/src/ability-level-defaults.mjs";
import {
  assessCombatMemberReadiness,
  applyDefaultMissingSkillLevels,
  GUILD_TRIAL_MIN_ATTACK_LEVEL,
  memberMeetsGuildTrialAttackThreshold,
  readAttackLevelFromSnapshot,
} from "../../packages/optimizer/src/combat-member-readiness.mjs";
import { defaultAbility } from "../../packages/shykai-full-runtime/src/guild-trial-runner.mjs";

test("auras and invincible are not defaultable; revive/insanity default to Lv1", () => {
  assert.equal(isAuraAbilityHrid("/abilities/speed_aura"), true);
  assert.equal(canDefaultMissingSkillLevel("/abilities/speed_aura"), false);
  assert.equal(canDefaultMissingSkillLevel("/abilities/invincible"), false);
  assert.equal(canDefaultMissingSkillLevel("/abilities/revive"), true);
  assert.equal(canDefaultMissingSkillLevel("/abilities/insanity"), true);
  assert.equal(canDefaultMissingSkillLevel("/abilities/frenzy"), true);
  assert.equal(defaultLevelForMissingAbility("/abilities/revive"), 1);
  assert.equal(defaultLevelForMissingAbility("/abilities/insanity"), 1);
});

test("missing ordinary skills default to level 40; revive/insanity to 1", () => {
  const learned = { "/abilities/berserk": 80 };
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/precision", learned),
    DEFAULT_MISSING_SKILL_LEVEL,
  );
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/insanity", learned),
    DEFAULT_REVIVE_INSANITY_LEVEL,
  );
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/revive", learned),
    DEFAULT_REVIVE_INSANITY_LEVEL,
  );
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/speed_aura", learned),
    null,
  );
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/insanity", {
      "/abilities/insanity": 45,
    }),
    45,
  );
});

test("stub ordinary skill levels below 40 are floored to the default", () => {
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/water_strike", {
      "/abilities/water_strike": 1,
    }),
    DEFAULT_MISSING_SKILL_LEVEL,
  );
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/mana_spring", {
      "/abilities/mana_spring": 39,
    }),
    DEFAULT_MISSING_SKILL_LEVEL,
  );
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/mana_spring", {
      "/abilities/mana_spring": 40,
    }),
    40,
  );
  assert.equal(
    resolveLearnedAbilityLevel("/abilities/insanity", {
      "/abilities/insanity": 2,
    }),
    2,
  );
});

test("defaultAbility uses level-40 fallback for missing ordinary skills", () => {
  const ability = defaultAbility("/abilities/precision", {
    "/abilities/berserk": 70,
  });
  assert.equal(ability.level, DEFAULT_MISSING_SKILL_LEVEL);
});

test("defaultAbility uses Lv1 for missing insanity/revive", () => {
  const insanity = defaultAbility("/abilities/insanity", {});
  const revive = defaultAbility("/abilities/revive", {});
  assert.equal(insanity.level, DEFAULT_REVIVE_INSANITY_LEVEL);
  assert.equal(revive.level, DEFAULT_REVIVE_INSANITY_LEVEL);
});

test("guild trial attack floor is 110", () => {
  assert.equal(GUILD_TRIAL_MIN_ATTACK_LEVEL, 110);
  assert.equal(
    readAttackLevelFromSnapshot({ skills: { "/skills/attack": 119 } }),
    119,
  );
  assert.equal(
    memberMeetsGuildTrialAttackThreshold({
      skills: { "/skills/attack": 109 },
    }),
    false,
  );
  assert.equal(
    memberMeetsGuildTrialAttackThreshold({
      skills: { "/skills/attack": 110 },
    }),
    true,
  );
  assert.equal(
    memberMeetsGuildTrialAttackThreshold({
      skills: { "/skills/attack": 119 },
    }),
    true,
  );
});

test("assessCombatMemberReadiness blocks attack below 110", () => {
  const snapshot = {
    skills: { "/skills/attack": 109 },
    learnedAbilities: {},
    loadoutCatalog: [],
  };
  const readiness = assessCombatMemberReadiness(snapshot, "弩");
  assert.equal(readiness.ok, false);
  assert.match(readiness.reason, /攻击等级不足/u);
  assert.equal(readiness.attackLevel, 109);
});

test("assessCombatMemberReadiness blocks missing attack skill", () => {
  const readiness = assessCombatMemberReadiness(
    { learnedAbilities: {}, loadoutCatalog: [] },
    "弩",
  );
  assert.equal(readiness.ok, false);
  assert.match(readiness.reason, /缺少攻击等级/u);
});

test("assessCombatMemberReadiness still blocks missing equipment", () => {
  const snapshot = {
    skills: { "/skills/attack": 120 },
    learnedAbilities: {},
    loadoutCatalog: [],
  };
  const readiness = assessCombatMemberReadiness(snapshot, "弩");
  assert.equal(readiness.ok, false);
  assert.match(readiness.reason, /装备/u);
});

test("applyDefaultMissingSkillLevels skips auras and fills ordinary skills", () => {
  const snapshot = { learnedAbilities: {} };
  const { snapshot: next, defaultedAbilityHrids } = applyDefaultMissingSkillLevels(
    snapshot,
    "弩",
    ["/abilities/speed_aura", "/abilities/precision", "/abilities/insanity"],
  );
  assert.ok(defaultedAbilityHrids.includes("/abilities/precision"));
  assert.ok(defaultedAbilityHrids.includes("/abilities/berserk"));
  assert.ok(defaultedAbilityHrids.includes("/abilities/insanity"));
  assert.equal(next.learnedAbilities["/abilities/speed_aura"], undefined);
  assert.equal(next.learnedAbilities["/abilities/precision"], 40);
  assert.equal(next.learnedAbilities["/abilities/insanity"], 1);
});
