import {
  validateGuildTrialScenario,
  validateMonsterFixture,
} from "../../../packages/contracts/src/index.mjs";
import {
  createGuildTrialRules,
  GuildTrialRunner,
  LinearBossFactory,
  StaticDamageCombatPort,
  type StaticMemberInput,
} from "../../../packages/guild-trial-core/src/index.ts";
import {
  createCancelledResponse,
  createPlaceholderResponse,
  DEVELOPMENT_HARNESS_WARNING,
  serializeError,
  type SimulatorRequest,
  type SimulatorResponse,
  type StaticFixtureRequest,
} from "./protocol.ts";

export interface SimulatorHandlerOptions {
  /** Allows a host to cancel between deterministic seed runs. */
  readonly isCancelled?: (requestId: string) => boolean;
}

type ValidationResult = { readonly ok: boolean; readonly errors: readonly unknown[] };
type MonsterFixture = {
  readonly fixtureId: string;
  readonly rules: { readonly seeds: readonly number[] };
  readonly bosses: readonly { readonly hrid: string; readonly maxHp: number }[];
};

/**
 * Node-testable handler. Browser hosts can call this from onmessage and post
 * the returned value; no DOM or Worker globals are touched here.
 */
export function handleSimulatorRequest(
  request: SimulatorRequest,
  options: SimulatorHandlerOptions = {},
): SimulatorResponse {
  try {
    assertRequestId(request);
    if (request.kind === "cancel-simulation" || isCancelled(request, options)) {
      return createCancelledResponse(request.id);
    }

    switch (request.kind) {
      case "validate-input":
        return validateInput(request);
      case "simulate-static-fixture":
        return simulateStaticFixture(request, options);
      case "simulate-dual-boss":
        // The production path remains intentionally blocked until the Shykai
        // adapter supplies real Player/Ability/Trigger and Monster behavior.
        return createPlaceholderResponse(request);
    }
  } catch (error) {
    return {
      id: typeof request?.id === "string" ? request.id : "invalid-request",
      kind: "simulation-result",
      status: "failed",
      warnings: [],
      error: serializeError(error),
      productionReady: false,
    };
  }
}

function validateInput(request: Extract<SimulatorRequest, { kind: "validate-input" }>): SimulatorResponse {
  const validation: ValidationResult = request.validator === "monster-fixture"
    ? validateMonsterFixture(request.input)
    : validateGuildTrialScenario(request.input);
  return {
    id: request.id,
    kind: "simulation-result",
    status: validation.ok ? "ready" : "validation-failed",
    warnings: [],
    result: { validator: request.validator, ok: validation.ok, errors: validation.errors },
    productionReady: false,
  };
}

function simulateStaticFixture(
  request: StaticFixtureRequest,
  options: SimulatorHandlerOptions,
): SimulatorResponse {
  const fixtureValidation = validateMonsterFixture(request.fixture);
  if (!fixtureValidation.ok) {
    return {
      id: request.id,
      kind: "simulation-result",
      status: "validation-failed",
      warnings: [DEVELOPMENT_HARNESS_WARNING],
      result: { validator: "monster-fixture", ok: false, errors: fixtureValidation.errors },
      productionReady: false,
    };
  }

  const fixture = request.fixture as MonsterFixture;
  const seeds = normalizeThreeSeeds(request.seeds ?? fixture.rules.seeds);
  const boss = request.bossId === undefined
    ? fixture.bosses[0]
    : fixture.bosses.find((candidate) => candidate.hrid === request.bossId);
  if (boss === undefined) throw new Error("static fixture boss was not found");

  const rules = createGuildTrialRules(request.assumptions);
  const members = request.members as readonly StaticMemberInput[];
  const runs = [];
  for (const seed of seeds) {
    if (isCancelled(request, options)) return createCancelledResponse(request.id);
    const port = new StaticDamageCombatPort();
    port.register(members);
    const runner = new GuildTrialRunner(
      port,
      new LinearBossFactory({
        monsterId: boss.hrid,
        level100MaxHitpoints: boss.maxHp,
      }),
    );
    runs.push(runner.run({ seed, rules, members, assumptionWarnings: [DEVELOPMENT_HARNESS_WARNING] }));
  }

  return {
    id: request.id,
    kind: "simulation-result",
    status: "development-harness",
    warnings: [DEVELOPMENT_HARNESS_WARNING],
    result: {
      executionKind: "development-harness",
      fixtureId: fixture.fixtureId,
      bossId: boss.hrid,
      seeds: [...seeds],
      runs,
    },
    productionReady: false,
  };
}

function isCancelled(request: { readonly id: string; readonly cancelled?: boolean }, options: SimulatorHandlerOptions): boolean {
  return request.cancelled === true || options.isCancelled?.(request.id) === true;
}

function assertRequestId(request: SimulatorRequest): void {
  if (typeof request.id !== "string" || request.id.trim().length === 0) {
    throw new Error("simulator request id must be a non-empty string");
  }
}

function normalizeThreeSeeds(seeds: readonly number[]): readonly number[] {
  if (seeds.length !== 3) throw new Error("simulator requires exactly three seeds");
  const normalized = [...seeds];
  if (new Set(normalized).size !== 3 || normalized.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    throw new Error("simulator seeds must be three distinct unsigned 32-bit integers");
  }
  return normalized;
}
