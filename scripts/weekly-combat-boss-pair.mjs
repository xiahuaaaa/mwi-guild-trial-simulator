/**
 * Guild combat weeks are always one single-target boss + trial swarm.
 * Composition labs historically keyed the ST side as "chameleon"; keep that
 * internal partition key so existing assign/cap helpers stay unchanged.
 *
 * Pair assignment (physical vs magic majority) lives in
 * `weekly-combat-partition.mjs`. chameleon+swarm reuses
 * phys-chameleon-magic-swarm.
 *
 * Weekly screening playbook: docs/WEEKLY_COMBAT_SCREENING.md
 */
export const ST_PARTITION_KEY = "chameleon";
export const SWARM_PARTITION_KEY = "swarm";

export function resolveWeeklyCombatBossPair(fixture) {
  const bosses = Array.isArray(fixture?.bosses) ? fixture.bosses : [];
  const swarmBoss = bosses.find((boss) =>
    String(boss.hrid ?? "").includes("swarm"),
  );
  const stBoss = bosses.find(
    (boss) => !String(boss.hrid ?? "").includes("swarm"),
  );
  if (!swarmBoss || !stBoss || bosses.length < 2) {
    const hrids = bosses.map((boss) => boss.hrid).filter(Boolean).join(", ");
    throw new Error(
      `fixture must include one swarm and one other boss, got ${hrids || "(empty)"}`,
    );
  }
  const stKey = String(stBoss.hrid).split("/").at(-1) || "primary";
  return {
    stKey,
    stBoss,
    swarmBoss,
    stLabel: stBoss.nameZh ?? stKey,
    swarmLabel: swarmBoss.nameZh ?? "试炼虫群",
    partitionStKey: ST_PARTITION_KEY,
  };
}

export function partitionBossByKey(weekly) {
  return {
    [ST_PARTITION_KEY]: weekly.stBoss,
    [SWARM_PARTITION_KEY]: weekly.swarmBoss,
  };
}

export function publicBossKey(partitionKey, weekly) {
  return partitionKey === ST_PARTITION_KEY ? weekly.stKey : partitionKey;
}
