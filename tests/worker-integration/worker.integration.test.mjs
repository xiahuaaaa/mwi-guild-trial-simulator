import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worker = await import("../../workers/simulator/src/worker.ts");
const fixture = JSON.parse(await readFile(new URL("../../fixtures/monsters/guild-trial-2026-07-24-jellyfish-hedgehog.json", import.meta.url)));

test("validate-input calls the real contracts validator and preserves request id", () => {
  const response = worker.handleSimulatorRequest({
    id: "validate-1",
    kind: "validate-input",
    validator: "monster-fixture",
    input: fixture,
  });
  assert.equal(response.id, "validate-1");
  assert.equal(response.status, "ready");
  assert.equal(response.result.ok, true);
  assert.equal(response.productionReady, false);
});

test("static fixture uses exactly three seeds in stable input order and stays development-only", () => {
  const seeds = [9, 3, 1];
  const response = worker.handleSimulatorRequest({
    id: "static-1",
    kind: "simulate-static-fixture",
    fixture,
    seeds,
    assumptions: { spawnDelayMs: 0, passiveRegenRounding: "multiply-before-floor", transitionState: "refill-hp-mp" },
    members: [{ memberId: "member", attackIntervalMs: 3_600_000, minimumDamage: 1, maximumDamage: 1, maxHitpoints: 1, maxManapoints: 0 }],
  });
  assert.equal(response.status, "development-harness");
  assert.equal(response.productionReady, false);
  assert.equal(response.result.executionKind, "development-harness");
  assert.deepEqual(response.result.seeds, seeds);
  assert.deepEqual(response.result.runs.map((run) => run.seed), seeds);
});

test("cancel marker, unknown production rules, and thrown adapter errors are serialized", () => {
  const cancelled = worker.handleSimulatorRequest({ id: "stop", kind: "simulate-dual-boss", fixtureId: fixture.fixtureId, plan: "balanced", members: [], cancelled: true });
  assert.equal(cancelled.status, "cancelled");

  const unknown = worker.handleSimulatorRequest({ id: "production", kind: "simulate-dual-boss", fixtureId: fixture.fixtureId, plan: "balanced", members: [] });
  assert.equal(unknown.status, "unknown-rules");
  assert.equal(unknown.productionReady, false);

  const failed = worker.handleSimulatorRequest({ id: "bad-static", kind: "simulate-static-fixture", fixture, assumptions: { spawnDelayMs: 0, passiveRegenRounding: "multiply-before-floor", transitionState: "refill-hp-mp" }, members: [{ memberId: "", attackIntervalMs: 1, minimumDamage: 0, maximumDamage: 0, maxHitpoints: 1, maxManapoints: 0 }] });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.name, "Error");
  assert.match(failed.error.message, /memberId/);
});
