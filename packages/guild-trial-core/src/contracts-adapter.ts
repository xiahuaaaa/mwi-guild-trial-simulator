import { createGuildTrialRules } from "./rules.ts";
import type { GuildTrialRules } from "./types.ts";

/**
 * Narrow structural view of `contracts.GuildTrialScenario`.
 *
 * Keeping this boundary structural prevents combat-core from depending on
 * contract runtime validators or their Node-specific module declarations.
 * The canonical GuildTrialScenario is assignable to this interface.
 */
export interface GuildTrialScenarioRuleView {
  readonly durationMs: number;
  readonly startMonsterLevel: number;
  readonly levelStep: number;
  readonly maxMonsterLevel: number;
  readonly monsterHpPerParticipant: number;
  readonly transitionPolicy: {
    readonly spawnDelayMs: number | null;
    readonly playerHp: "unknown" | "preserve" | "full";
    readonly playerMp: "unknown" | "preserve" | "full";
    readonly cooldowns: "unknown" | "preserve" | "reset";
    readonly buffs: "unknown" | "preserve" | "clear";
    readonly debuffs: "unknown" | "preserve" | "clear";
    readonly shields: "unknown" | "preserve" | "clear";
    readonly casts: "unknown" | "preserve" | "cancel";
  };
  readonly combatPolicy: {
    readonly consumables: "disabled";
    readonly passiveRegenFlatBonus: number;
    readonly passiveRegenScope: "regen_tick_hp_mp_additive";
    readonly maxBlockRollsPerIncomingAttack: number;
    readonly passiveRegenRounding:
      | "unknown"
      | "multiply-before-floor"
      | "multiply-after-floor";
    readonly healingMultiplier: 1 | 4 | "unknown";
    readonly lifeStealMultiplier: 1 | 4 | "unknown";
    readonly manaLeechMultiplier: 1 | 4 | "unknown";
  };
}

export interface UnknownRuleResolution {
  readonly spawnDelayMs: number;
  readonly transitionState: "refill-hp-mp";
  readonly passiveRegenRounding:
    | "multiply-before-floor"
    | "multiply-after-floor";
  readonly source: string;
}

export interface AdaptedGuildTrialRules {
  readonly rules: GuildTrialRules;
  readonly assumptionWarnings: readonly string[];
}

/**
 * Converts the canonical contract into executable rules.
 *
 * Unknown contract values are never guessed. Callers must supply an explicit
 * resolution and its provenance; every such choice is returned as a warning
 * for propagation into the result artifact and UI.
 */
export function adaptScenarioRules(
  scenario: GuildTrialScenarioRuleView,
  resolution: UnknownRuleResolution,
): AdaptedGuildTrialRules {
  if (resolution.source.trim().length === 0) {
    throw new Error("unknown rule resolution requires a non-empty source");
  }
  if (
    scenario.durationMs !== 3_600_000 ||
    scenario.startMonsterLevel !== 100 ||
    scenario.levelStep !== 10 ||
    scenario.maxMonsterLevel !== 300 ||
    scenario.monsterHpPerParticipant !== 0.01 ||
    scenario.combatPolicy.consumables !== "disabled" ||
    scenario.combatPolicy.passiveRegenFlatBonus !== 0.03 ||
    scenario.combatPolicy.passiveRegenScope !==
      "regen_tick_hp_mp_additive" ||
    scenario.combatPolicy.maxBlockRollsPerIncomingAttack !== 5
  ) {
    throw new Error("scenario violates confirmed guild-trial invariants");
  }

  if (
    !["full", "unknown"].includes(scenario.transitionPolicy.playerHp) ||
    !["full", "unknown"].includes(scenario.transitionPolicy.playerMp)
  ) {
    throw new Error("the runner requires full HP and MP between levels");
  }
  for (const [name, value] of [
    ["cooldowns", scenario.transitionPolicy.cooldowns],
    ["buffs", scenario.transitionPolicy.buffs],
    ["debuffs", scenario.transitionPolicy.debuffs],
    ["shields", scenario.transitionPolicy.shields],
    ["casts", scenario.transitionPolicy.casts],
  ] as const) {
    if (!["preserve", "unknown"].includes(value)) {
      throw new Error(`the runner cannot represent transition ${name}=${value}`);
    }
  }
  if (resolution.transitionState !== "refill-hp-mp") {
    throw new Error("the runner requires refill-hp-mp transition resolution");
  }

  const assumptionWarnings: string[] = [];
  if (scenario.transitionPolicy.spawnDelayMs === null) {
    assumptionWarnings.push(
      `Assumed spawnDelayMs=${resolution.spawnDelayMs} from ${resolution.source}.`,
    );
  } else if (scenario.transitionPolicy.spawnDelayMs !== resolution.spawnDelayMs) {
    throw new Error("resolved spawn delay conflicts with scenario");
  }
  if (
    scenario.transitionPolicy.playerHp === "unknown" ||
    scenario.transitionPolicy.playerMp === "unknown"
  ) {
    assumptionWarnings.push(
      `Assumed cross-wave player HP/MP refill from ${resolution.source}.`,
    );
  }
  const unresolvedPreservedState = [
    scenario.transitionPolicy.cooldowns,
    scenario.transitionPolicy.buffs,
    scenario.transitionPolicy.debuffs,
    scenario.transitionPolicy.shields,
    scenario.transitionPolicy.casts,
  ].some((value) => value === "unknown");
  if (unresolvedPreservedState) {
    assumptionWarnings.push(
      `Assumed cooldowns, buffs, debuffs, shields and casts persist from ${resolution.source}.`,
    );
  }
  if (scenario.combatPolicy.passiveRegenRounding === "unknown") {
    assumptionWarnings.push(
      `Assumed passive regen rounding=${resolution.passiveRegenRounding} from ${resolution.source}.`,
    );
  } else if (
    scenario.combatPolicy.passiveRegenRounding !==
    resolution.passiveRegenRounding
  ) {
    throw new Error("resolved passive regen rounding conflicts with scenario");
  }

  for (const [name, value] of [
    ["healingMultiplier", scenario.combatPolicy.healingMultiplier],
    ["lifeStealMultiplier", scenario.combatPolicy.lifeStealMultiplier],
    ["manaLeechMultiplier", scenario.combatPolicy.manaLeechMultiplier],
  ] as const) {
    if (value === "unknown") {
      assumptionWarnings.push(
        `${name} remains unknown and does not receive the fixed passive regen bonus.`,
      );
    }
  }

  return {
    rules: createGuildTrialRules({
      spawnDelayMs: resolution.spawnDelayMs,
      transitionState: resolution.transitionState,
      passiveRegenRounding:
        resolution.passiveRegenRounding === "multiply-after-floor"
          ? "floor-before-multiply"
          : "multiply-before-floor",
    }),
    assumptionWarnings,
  };
}
