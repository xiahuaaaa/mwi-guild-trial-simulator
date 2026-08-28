import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  adaptCyberBeggar,
  adaptTys,
  adaptWanderingEarth,
} from "../src/index.ts";

const now = "2026-07-24T12:00:00.000Z";
const fixtures = new URL("../../../fixtures/source-payloads/", import.meta.url);

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(new URL(name, fixtures)), "utf8"));
}

test("de-identified Wandering Earth fixture preserves only the approved trial build", async () => {
  const adapted = adaptWanderingEarth(
    await readFixture("wandering-earth-snapshot-trial-build.json"),
    { now },
  );

  assert.equal(adapted.memberId, "100001");
  assert.equal(adapted.confidence, "simulation-ready");
  assert.equal(adapted.approvedBuilds.length, 1);
  assert.equal(adapted.approvedBuilds[0].simulationReady, true);
  assert.equal(adapted.approvedBuilds[0].approvedByMember, true);
  assert.equal(adapted.currentBuild?.weapon?.itemHrid, "/items/unapproved_fixture_staff");

  const recommendableEquipment = adapted.approvedBuilds
    .filter((build) => build.approvedByMember && build.simulationReady)
    .flatMap((build) => build.equipment.map((item) => item.itemHrid));
  assert.deepEqual(recommendableEquipment, ["/items/blazing_trident"]);
  assert.ok(!recommendableEquipment.includes("/items/unapproved_fixture_staff"));
});

test("de-identified Cyber Beggar schema v1 fixture remains current-loadout-only", async () => {
  const adapted = adaptCyberBeggar(
    await readFixture("cyber-beggar-schema-v1.json"),
    { now },
  );

  assert.equal(adapted.memberId, "100002");
  assert.equal(adapted.confidence, "current-loadout-only");
  assert.equal(adapted.approvedBuilds.length, 0);
  assert.equal(adapted.currentBuild?.simulationReady, false);
});

test("de-identified TYS schema v3 fixture reports both weekly bosses", async () => {
  const adapted = adaptTys(await readFixture("tys-schema-v3.json"), { now });

  assert.equal(adapted.memberId, "100003");
  assert.equal(adapted.confidence, "capability-only");
  assert.deepEqual(adapted.participation.eligibleBossHrids, [
    "/guild_combat/jellyfish",
    "/guild_combat/hedgehog",
  ]);
});
