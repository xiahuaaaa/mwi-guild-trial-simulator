import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  partitionBossByKey,
  publicBossKey,
  resolveWeeklyCombatBossPair,
  ST_PARTITION_KEY,
} from "../../scripts/weekly-combat-boss-pair.mjs";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/monsters",
);

test("this week's chameleon/swarm fixture maps ST side onto the chameleon partition key", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(fixtureDir, "guild-trial-2026-08-28-chameleon-swarm.json"),
      "utf8",
    ),
  );
  const weekly = resolveWeeklyCombatBossPair(fixture);
  assert.equal(weekly.stKey, "chameleon");
  assert.equal(weekly.stLabel, "试炼变色龙");
  assert.equal(weekly.stBoss.enemiesPerEncounter, 1);
  assert.equal(weekly.stBoss.maxHp, 632500);
  assert.equal(weekly.swarmBoss.hrid, "/guild_combat/swarm");
  assert.equal(weekly.swarmBoss.enemiesPerEncounter, 4);
  const byKey = partitionBossByKey(weekly);
  assert.equal(byKey[ST_PARTITION_KEY].hrid, "/guild_combat/chameleon");
  assert.equal(byKey.swarm.hrid, "/guild_combat/swarm");
  assert.equal(publicBossKey(ST_PARTITION_KEY, weekly), "chameleon");
  assert.equal(publicBossKey("swarm", weekly), "swarm");
});

test("previous badger/swarm fixture still maps ST side onto the chameleon partition key", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(fixtureDir, "guild-trial-2026-08-21-badger-swarm.json"),
      "utf8",
    ),
  );
  const weekly = resolveWeeklyCombatBossPair(fixture);
  assert.equal(weekly.stKey, "badger");
  assert.equal(weekly.stLabel, "试炼獾");
  assert.equal(weekly.stBoss.enemiesPerEncounter, 2);
  assert.equal(weekly.swarmBoss.hrid, "/guild_combat/swarm");
  assert.equal(weekly.swarmBoss.enemiesPerEncounter, 4);
  const byKey = partitionBossByKey(weekly);
  assert.equal(byKey[ST_PARTITION_KEY].hrid, "/guild_combat/badger");
  assert.equal(byKey.swarm.hrid, "/guild_combat/swarm");
  assert.equal(publicBossKey(ST_PARTITION_KEY, weekly), "badger");
  assert.equal(publicBossKey("swarm", weekly), "swarm");
});

test("previous hedgehog/swarm fixture still maps ST side onto the chameleon partition key", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(fixtureDir, "guild-trial-2026-08-14-hedgehog-swarm.json"),
      "utf8",
    ),
  );
  const weekly = resolveWeeklyCombatBossPair(fixture);
  assert.equal(weekly.stKey, "hedgehog");
  assert.equal(weekly.stLabel, "试炼刺猬");
  assert.equal(weekly.swarmBoss.hrid, "/guild_combat/swarm");
  const byKey = partitionBossByKey(weekly);
  assert.equal(byKey[ST_PARTITION_KEY].hrid, "/guild_combat/hedgehog");
  assert.equal(byKey.swarm.hrid, "/guild_combat/swarm");
  assert.equal(publicBossKey(ST_PARTITION_KEY, weekly), "hedgehog");
  assert.equal(publicBossKey("swarm", weekly), "swarm");
});

test("previous chameleon/swarm fixture still resolves", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(fixtureDir, "guild-trial-2026-08-07-chameleon-swarm.json"),
      "utf8",
    ),
  );
  const weekly = resolveWeeklyCombatBossPair(fixture);
  assert.equal(weekly.stKey, "chameleon");
  assert.equal(weekly.stLabel, "试炼变色龙");
});

test("rejects a fixture without swarm", () => {
  assert.throws(
    () =>
      resolveWeeklyCombatBossPair({
        bosses: [{ hrid: "/guild_combat/hedgehog", nameZh: "试炼刺猬" }],
      }),
    /one swarm and one other boss/,
  );
});
