export const DEFAULT_SHIELD_PACKAGE_ID = "retaliation-precision";

export const SHIELD_ABILITY_PACKAGES = Object.freeze([
  Object.freeze({
    id: "retaliation-precision",
    nameZh: "精确惩戒",
    ordinaryAbilities: Object.freeze([
      "provoke",
      "toughness",
      "retribution",
      "precision",
    ]),
  }),
  Object.freeze({
    id: "retaliation-speed",
    nameZh: "狂速惩戒",
    ordinaryAbilities: Object.freeze([
      "provoke",
      "retribution",
      "precision",
      "frenzy",
    ]),
  }),
  Object.freeze({
    id: "bash-precision",
    nameZh: "精确盾击",
    ordinaryAbilities: Object.freeze([
      "provoke",
      "toughness",
      "shield_bash",
      "precision",
    ]),
  }),
  Object.freeze({
    id: "bash-speed",
    nameZh: "狂速盾击",
    ordinaryAbilities: Object.freeze([
      "provoke",
      "shield_bash",
      "precision",
      "frenzy",
    ]),
  }),
  Object.freeze({
    id: "thorns-precision",
    nameZh: "精确荆棘",
    ordinaryAbilities: Object.freeze([
      "provoke",
      "spike_shell",
      "retribution",
      "precision",
    ]),
  }),
]);

export function shieldAbilityNames(
  specialAbility,
  packageId = DEFAULT_SHIELD_PACKAGE_ID,
) {
  const policy = SHIELD_ABILITY_PACKAGES.find(
    (candidate) => candidate.id === packageId,
  );
  if (!policy) {
    throw new Error(`Unknown shield ability package: ${packageId}`);
  }
  return [specialAbility, ...policy.ordinaryAbilities];
}

export function shieldPackageNameZh(packageId) {
  return (
    SHIELD_ABILITY_PACKAGES.find((candidate) => candidate.id === packageId)
      ?.nameZh ?? packageId
  );
}

export const HAMMER_DEBUFFER_ABILITIES = Object.freeze([
  "revive",
  "precision",
  "frenzy",
  "berserk",
  "fracturing_impact",
]);

export const SWORD_DEBUFFER_ABILITIES = Object.freeze([
  "revive",
  "precision",
  "berserk",
  "maim",
  "crippling_slash",
]);

export const DEFAULT_CROSSBOW_SUPPORT_MODE = "berserk";

export const CROSSBOW_SUPPORT_MODES = Object.freeze(["berserk", "frenzy"]);

export function crossbowDebufferAbilityNames(
  specialAbility,
  mode = DEFAULT_CROSSBOW_SUPPORT_MODE,
) {
  if (!CROSSBOW_SUPPORT_MODES.includes(mode)) {
    throw new Error(`Unknown crossbow support mode: ${mode}`);
  }
  return [
    specialAbility,
    "precision",
    mode,
    "pestilent_shot",
    "steady_shot",
  ];
}
