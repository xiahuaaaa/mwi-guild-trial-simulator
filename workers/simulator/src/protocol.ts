/**
 * Stable message boundary shared by the web client and the simulator worker.
 *
 * `simulate-static-fixture` is deliberately a development-only path. It uses
 * deterministic stand-ins so that worker plumbing can be tested before the
 * recovered Shykai adapter is available; it must never be presented as a
 * production simulation result.
 */
export type PlanKind = "balanced" | "robust" | "push";
export type InputValidator = "monster-fixture" | "guild-trial-scenario";

export interface ValidateInputRequest {
  readonly id: string;
  readonly kind: "validate-input";
  readonly validator: InputValidator;
  readonly input: unknown;
  readonly cancelled?: boolean;
}

export interface StaticFixtureAssumptions {
  readonly spawnDelayMs: number;
  readonly passiveRegenRounding: "multiply-before-floor" | "multiply-after-floor";
  readonly transitionState: "preserve";
}

/** Loose DTO boundary: StaticDamageCombatPort validates every member itself. */
export interface StaticFixtureRequest {
  readonly id: string;
  readonly kind: "simulate-static-fixture";
  readonly fixture: unknown;
  readonly members: readonly unknown[];
  readonly assumptions: StaticFixtureAssumptions;
  readonly bossId?: string;
  readonly seeds?: readonly number[];
  readonly cancelled?: boolean;
}

export interface DualBossRequest {
  readonly id: string;
  readonly kind: "simulate-dual-boss";
  readonly fixtureId: string;
  readonly plan: PlanKind;
  readonly members: readonly unknown[];
  readonly seeds?: readonly number[];
  readonly cancelled?: boolean;
}

export interface CancelSimulationRequest {
  readonly id: string;
  readonly kind: "cancel-simulation";
  readonly targetId: string;
}

export type SimulatorRequest =
  | ValidateInputRequest
  | StaticFixtureRequest
  | DualBossRequest
  | CancelSimulationRequest;

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface SimulatorResponse {
  readonly id: string;
  readonly kind: "simulation-result";
  readonly status:
    | "ready"
    | "validation-failed"
    | "development-harness"
    | "unknown-rules"
    | "cancelled"
    | "failed";
  readonly warnings: readonly string[];
  readonly result?: unknown;
  readonly error?: SerializedError;
  /** Only the recovered Shykai adapter may ever set this to true. */
  readonly productionReady: boolean;
}

export const UNKNOWN_RULE_WARNINGS = [
  "Boss 成长公式尚未实测。",
  "光环和 Debuff 的叠加规则尚未实测。",
  "Boss 转场时状态保留规则尚未实测。",
] as const;

export const DEVELOPMENT_HARNESS_WARNING =
  "development-harness：StaticDamageCombatPort 仅用于开发 smoke，不能作为正式推荐。";

export function createPlaceholderResponse(request: Pick<DualBossRequest, "id">): SimulatorResponse {
  return {
    id: request.id,
    kind: "simulation-result",
    status: "unknown-rules",
    warnings: [...UNKNOWN_RULE_WARNINGS],
    productionReady: false,
  };
}

export function createCancelledResponse(id: string): SimulatorResponse {
  return {
    id,
    kind: "simulation-result",
    status: "cancelled",
    warnings: ["模拟任务已取消。"],
    productionReady: false,
  };
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      ...(typeof error.stack === "string" ? { stack: error.stack } : {}),
    };
  }
  return { name: "Error", message: String(error) };
}
