/** Browser-side boundary; the actual Worker is supplied by workers/simulator. */
export type PlanKind = 'balanced' | 'robust' | 'push';
export interface SimulationRequest { kind: 'simulate-dual-boss'; plan: PlanKind; members: unknown[]; fixtureId: string; }
export interface SimulationResponse { kind: 'simulation-result'; status: 'ready' | 'unknown-rules' | 'failed'; warnings: string[]; result?: unknown; }
export function createWorkerRequest(plan: PlanKind, members: unknown[]): SimulationRequest {
  return { kind: 'simulate-dual-boss', plan, members, fixtureId: 'guild-trial-2026-07-24-jellyfish-hedgehog' };
}
export function decodeWorkerResponse(value: unknown): SimulationResponse {
  if (!value || typeof value !== 'object') return { kind: 'simulation-result', status: 'failed', warnings: ['Worker 返回了无效响应。'] };
  return value as SimulationResponse;
}
