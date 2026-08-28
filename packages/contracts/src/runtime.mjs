export const REQUIRED_UNKNOWN_POLICY_PATHS = Object.freeze([
  "transitionPolicy.spawnDelayMs",
  "transitionPolicy.playerHp",
  "transitionPolicy.playerMp",
  "transitionPolicy.cooldowns",
  "transitionPolicy.buffs",
  "transitionPolicy.debuffs",
  "transitionPolicy.shields",
  "transitionPolicy.casts",
  "combatPolicy.passiveRegenRounding",
  "combatPolicy.healingMultiplier",
  "combatPolicy.lifeStealMultiplier",
  "combatPolicy.manaLeechMultiplier",
  "combatPolicy.deathBehavior",
  "combatPolicy.allDeadBehavior",
  "combatPolicy.targetPolicy",
  "bossAbilityScaling",
  "guildAuraAndShrineStacking"
]);

const COMBAT_STYLES = Object.freeze(["stab", "slash", "smash", "ranged", "magic"]);
const ELEMENTS = Object.freeze(["water", "nature", "fire"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function add(errors, path, message) {
  errors.push({ path, message });
}

function expectObject(value, path, errors) {
  if (!isObject(value)) {
    add(errors, path, "must be an object");
    return false;
  }
  return true;
}

function expectString(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    add(errors, path, "must be a non-empty string");
    return false;
  }
  return true;
}

function expectFiniteNumber(value, path, errors, options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    add(errors, path, "must be a finite number");
    return false;
  }
  if (options.integer && !Number.isInteger(value)) {
    add(errors, path, "must be an integer");
    return false;
  }
  if (options.min !== undefined && value < options.min) {
    add(errors, path, `must be >= ${options.min}`);
    return false;
  }
  return true;
}

function expectExact(value, expected, path, errors) {
  if (value !== expected) {
    add(errors, path, `must be ${JSON.stringify(expected)}`);
    return false;
  }
  return true;
}

function expectEnum(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    add(errors, path, `must be one of ${allowed.map((item) => JSON.stringify(item)).join(", ")}`);
    return false;
  }
  return true;
}

function validateSeeds(value, path, errors) {
  if (!Array.isArray(value) || value.length !== 3) {
    add(errors, path, "must contain exactly three seeds");
    return;
  }
  const seen = new Set();
  value.forEach((seed, index) => {
    if (expectFiniteNumber(seed, `${path}[${index}]`, errors, { integer: true, min: 0 })) {
      if (seed > 0xffffffff) {
        add(errors, `${path}[${index}]`, "must fit in an unsigned 32-bit integer");
      }
      if (seen.has(seed)) {
        add(errors, `${path}[${index}]`, "must be distinct");
      }
      seen.add(seed);
    }
  });
}

function validateRuleProvenance(value, path, errors) {
  if (!expectObject(value, path, errors)) return;
  expectEnum(value.status, ["confirmed", "assumed", "unknown"], `${path}.status`, errors);
  if (value.source !== null && typeof value.source !== "string") {
    add(errors, `${path}.source`, "must be a string or null");
  }
  if (value.status === "unknown" && value.source !== null) {
    add(errors, `${path}.source`, "must be null when status is unknown");
  }
  if (value.status !== "unknown" && !expectString(value.source, `${path}.source`, errors)) {
    // expectString records the useful error.
  }
  if (!Object.prototype.hasOwnProperty.call(value, "value")) {
    add(errors, `${path}.value`, "is required");
  }
}

function validateTransitionPolicy(value, path, errors) {
  if (!expectObject(value, path, errors)) return;
  if (value.spawnDelayMs !== null) {
    add(errors, `${path}.spawnDelayMs`, "must be null until spawn delay is calibrated");
  }
  expectEnum(value.playerHp, ["preserve", "full", "unknown"], `${path}.playerHp`, errors);
  expectEnum(value.playerMp, ["preserve", "full", "unknown"], `${path}.playerMp`, errors);
  expectEnum(value.cooldowns, ["preserve", "reset", "unknown"], `${path}.cooldowns`, errors);
  expectEnum(value.buffs, ["preserve", "clear", "unknown"], `${path}.buffs`, errors);
  expectEnum(value.debuffs, ["preserve", "clear", "unknown"], `${path}.debuffs`, errors);
  expectEnum(value.shields, ["preserve", "clear", "unknown"], `${path}.shields`, errors);
  expectEnum(value.casts, ["preserve", "cancel", "unknown"], `${path}.casts`, errors);
}

function validateCombatPolicy(value, path, errors) {
  if (!expectObject(value, path, errors)) return;
  expectExact(value.consumables, "disabled", `${path}.consumables`, errors);
  expectExact(value.passiveRegenFlatBonus, 0.03, `${path}.passiveRegenFlatBonus`, errors);
  expectExact(value.passiveRegenScope, "regen_tick_hp_mp_additive", `${path}.passiveRegenScope`, errors);
  expectExact(value.maxBlockRollsPerIncomingAttack, 5, `${path}.maxBlockRollsPerIncomingAttack`, errors);
  expectEnum(
    value.passiveRegenRounding,
    ["unknown", "multiply-before-floor", "multiply-after-floor"],
    `${path}.passiveRegenRounding`,
    errors
  );
  expectEnum(value.healingMultiplier, [1, 4, "unknown"], `${path}.healingMultiplier`, errors);
  expectEnum(value.lifeStealMultiplier, [1, 4, "unknown"], `${path}.lifeStealMultiplier`, errors);
  expectEnum(value.manaLeechMultiplier, [1, 4, "unknown"], `${path}.manaLeechMultiplier`, errors);
  expectEnum(value.deathBehavior, ["permanent", "respawn", "unknown"], `${path}.deathBehavior`, errors);
  expectEnum(value.allDeadBehavior, ["end", "wait", "reset", "unknown"], `${path}.allDeadBehavior`, errors);
  expectString(value.targetPolicy, `${path}.targetPolicy`, errors);
}

function validateMonster(value, path, errors) {
  if (!expectObject(value, path, errors)) return;
  expectString(value.hrid, `${path}.hrid`, errors);
  expectString(value.nameZh, `${path}.nameZh`, errors);
  expectExact(value.level, 100, `${path}.level`, errors);
  expectEnum(value.combatStyle, COMBAT_STYLES, `${path}.combatStyle`, errors);
  expectEnum(value.damageType, ["physical", ...ELEMENTS], `${path}.damageType`, errors);
  expectFiniteNumber(value.attackIntervalSeconds, `${path}.attackIntervalSeconds`, errors, { min: 0.001 });
  expectFiniteNumber(value.castSpeedPercent, `${path}.castSpeedPercent`, errors, { min: 0 });
  expectFiniteNumber(value.abilityHaste, `${path}.abilityHaste`, errors, { min: 0 });
  expectFiniteNumber(value.maxHp, `${path}.maxHp`, errors, { integer: true, min: 1 });
  expectFiniteNumber(value.maxMp, `${path}.maxMp`, errors, { integer: true, min: 0 });
  expectFiniteNumber(value.armor, `${path}.armor`, errors, { min: 0 });
  expectFiniteNumber(value.tenacity, `${path}.tenacity`, errors, { min: 0 });
  expectFiniteNumber(value.threat, `${path}.threat`, errors, { min: 0 });
  if (value.enemiesPerEncounter !== undefined) {
    expectFiniteNumber(value.enemiesPerEncounter, `${path}.enemiesPerEncounter`, errors, {
      integer: true,
      min: 1,
    });
  }

  for (const [groupName, keys] of [
    ["evasion", COMBAT_STYLES],
    ["resistance", ELEMENTS]
  ]) {
    const group = value[groupName];
    if (!expectObject(group, `${path}.${groupName}`, errors)) continue;
    for (const key of keys) {
      expectFiniteNumber(group[key], `${path}.${groupName}.${key}`, errors, { min: 0 });
    }
  }

  for (const groupName of ["accuracy", "damage"]) {
    const group = value[groupName];
    if (!expectObject(group, `${path}.${groupName}`, errors)) continue;
    if (Object.keys(group).length === 0) {
      add(errors, `${path}.${groupName}`, "must contain at least one combat style");
    }
    for (const [style, amount] of Object.entries(group)) {
      expectEnum(style, COMBAT_STYLES, `${path}.${groupName}.${style}`, errors);
      expectFiniteNumber(amount, `${path}.${groupName}.${style}`, errors, { min: 0 });
    }
  }

  validateRuleProvenance(value.defenseDamageDisplay, `${path}.defenseDamageDisplay`, errors);
  if (isObject(value.defenseDamageDisplay)) {
    expectExact(value.defenseDamageDisplay.status, "unknown", `${path}.defenseDamageDisplay.status`, errors);
    expectFiniteNumber(value.defenseDamageDisplay.value, `${path}.defenseDamageDisplay.value`, errors, { min: 0 });
  }

  if (!Array.isArray(value.abilities) || value.abilities.length !== 5) {
    add(errors, `${path}.abilities`, "must contain the five displayed boss abilities");
  } else {
    const abilityIds = new Set();
    value.abilities.forEach((ability, index) => {
      const abilityPath = `${path}.abilities[${index}]`;
      if (!expectObject(ability, abilityPath, errors)) return;
      expectString(ability.hrid, `${abilityPath}.hrid`, errors);
      expectString(ability.nameZh, `${abilityPath}.nameZh`, errors);
      expectFiniteNumber(ability.level, `${abilityPath}.level`, errors, { integer: true, min: 1 });
      if (abilityIds.has(ability.hrid)) {
        add(errors, `${abilityPath}.hrid`, "must be unique within a boss");
      }
      abilityIds.add(ability.hrid);
    });
  }
}

function validateUnknownPolicyProvenance(value, path, errors) {
  if (!expectObject(value, path, errors)) return;
  for (const policyPath of REQUIRED_UNKNOWN_POLICY_PATHS) {
    const entry = value[policyPath];
    if (!entry) {
      add(errors, `${path}.${policyPath}`, "must explicitly describe this unresolved policy");
      continue;
    }
    validateRuleProvenance(entry, `${path}.${policyPath}`, errors);
    if (isObject(entry)) {
      expectExact(entry.status, "unknown", `${path}.${policyPath}.status`, errors);
    }
  }
}

export function validateGuildTrialScenario(input) {
  const errors = [];
  if (!expectObject(input, "$", errors)) return { ok: false, errors };

  expectExact(input.schemaVersion, 1, "$.schemaVersion", errors);
  expectString(input.gameBuild, "$.gameBuild", errors);
  expectString(input.scenarioId, "$.scenarioId", errors);
  expectExact(input.durationMs, 3_600_000, "$.durationMs", errors);
  expectExact(input.startMonsterLevel, 100, "$.startMonsterLevel", errors);
  expectExact(input.levelStep, 10, "$.levelStep", errors);
  expectExact(input.maxMonsterLevel, 300, "$.maxMonsterLevel", errors);
  expectExact(input.monsterHpPerParticipant, 0.01, "$.monsterHpPerParticipant", errors);
  expectExact(input.repeatCount, 3, "$.repeatCount", errors);
  validateSeeds(input.seeds, "$.seeds", errors);
  validateMonster(input.monster, "$.monster", errors);

  if (!Array.isArray(input.members)) {
    add(errors, "$.members", "must be an array");
  }
  if (!Array.isArray(input.guildModifiers)) {
    add(errors, "$.guildModifiers", "must be an array");
  }

  if (expectObject(input.scalingPolicy, "$.scalingPolicy", errors)) {
    expectString(input.scalingPolicy.id, "$.scalingPolicy.id", errors);
    expectEnum(input.scalingPolicy.status, ["confirmed", "assumed", "unknown"], "$.scalingPolicy.status", errors);
    if (input.scalingPolicy.status === "unknown" && input.scalingPolicy.source !== null) {
      add(errors, "$.scalingPolicy.source", "must be null while scaling is unvalidated");
    }
  }
  validateTransitionPolicy(input.transitionPolicy, "$.transitionPolicy", errors);
  validateCombatPolicy(input.combatPolicy, "$.combatPolicy", errors);
  validateUnknownPolicyProvenance(input.policyProvenance, "$.policyProvenance", errors);

  if (!Array.isArray(input.assumptionWarnings)) {
    add(errors, "$.assumptionWarnings", "must be an array");
  } else if (input.assumptionWarnings.length === 0) {
    add(errors, "$.assumptionWarnings", "must expose unresolved trial assumptions");
  }

  return errors.length === 0
    ? { ok: true, value: input, errors }
    : { ok: false, errors };
}

export function validateMonsterFixture(input) {
  const errors = [];
  if (!expectObject(input, "$", errors)) return { ok: false, errors };

  expectExact(input.schemaVersion, 1, "$.schemaVersion", errors);
  expectString(input.fixtureId, "$.fixtureId", errors);
  expectString(input.observedAt, "$.observedAt", errors);

  if (expectObject(input.source, "$.source", errors)) {
    expectExact(input.source.type, "user-supplied-game-screenshots", "$.source.type", errors);
    expectExact(input.source.confidence, "displayed-values-confirmed", "$.source.confidence", errors);
  }

  if (expectObject(input.rules, "$.rules", errors)) {
    expectExact(input.rules.durationSeconds, 3600, "$.rules.durationSeconds", errors);
    expectExact(input.rules.startLevel, 100, "$.rules.startLevel", errors);
    expectExact(input.rules.levelStepOnKill, 10, "$.rules.levelStepOnKill", errors);
    expectExact(input.rules.maxLevel, 300, "$.rules.maxLevel", errors);
    expectExact(input.rules.monsterHpPerParticipantPercent, 1, "$.rules.monsterHpPerParticipantPercent", errors);
    expectExact(input.rules.repeatCount, 3, "$.rules.repeatCount", errors);
    validateSeeds(input.rules.seeds, "$.rules.seeds", errors);
    expectExact(input.rules.membersInCurrentAssignment, 40, "$.rules.membersInCurrentAssignment", errors);
    expectExact(input.rules.observedTeamCapacity, 48, "$.rules.observedTeamCapacity", errors);
    expectExact(input.rules.consumables, "disabled", "$.rules.consumables", errors);
    expectExact(input.rules.passiveHpMpRegenFlatBonusPercent, 3, "$.rules.passiveHpMpRegenFlatBonusPercent", errors);
    expectExact(input.rules.passiveRegenScope, "regen_tick_hp_mp_additive", "$.rules.passiveRegenScope", errors);
    expectExact(input.rules.maxBlockRollsPerIncomingAttack, 5, "$.rules.maxBlockRollsPerIncomingAttack", errors);
    if (expectObject(input.rules.scalingPolicy, "$.rules.scalingPolicy", errors)) {
      expectExact(input.rules.scalingPolicy.id, "guild-trial-level-plus-10-over-110-v1", "$.rules.scalingPolicy.id", errors);
      expectExact(input.rules.scalingPolicy.status, "confirmed", "$.rules.scalingPolicy.status", errors);
      expectExact(input.rules.scalingPolicy.source, "2026-07-28-jellyfish-floor15-47p-screenshot", "$.rules.scalingPolicy.source", errors);
    }
    validateTransitionPolicy(input.rules.transitionPolicy, "$.rules.transitionPolicy", errors);
    validateCombatPolicy(input.rules.combatPolicy, "$.rules.combatPolicy", errors);
  }

  if (!Array.isArray(input.bosses) || input.bosses.length !== 2) {
    add(errors, "$.bosses", "must contain exactly the current jellyfish and hedgehog bosses");
  } else {
    const expectedIds = new Set(["/guild_combat/jellyfish", "/guild_combat/hedgehog"]);
    input.bosses.forEach((boss, index) => {
      validateMonster(boss, `$.bosses[${index}]`, errors);
      expectedIds.delete(boss?.hrid);
    });
    if (expectedIds.size > 0) {
      add(errors, "$.bosses", `missing ${[...expectedIds].join(", ")}`);
    }
  }

  if (!Array.isArray(input.validationNeeded) || input.validationNeeded.length === 0) {
    add(errors, "$.validationNeeded", "must explicitly list unresolved validation work");
  }

  return errors.length === 0
    ? { ok: true, value: input, errors }
    : { ok: false, errors };
}
