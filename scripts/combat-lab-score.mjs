/**
 * Shared ranking for composition / insanity / nature A/B screens.
 * Playbook: docs/WEEKLY_COMBAT_SCREENING.md
 */

export function floorProgress(run) {
  if (Number(run?.finalMonsterMaxHp ?? 0) > 0) {
    return 1 - Number(run.finalMonsterHp ?? 0) / Number(run.finalMonsterMaxHp);
  }
  return Number(run?.finalProgressPercent ?? 0) / 100;
}

/** Depth first, then death penalty, then leftover progress. */
export function standardLabScore(run) {
  return (
    Number(run?.wavesCleared ?? 0) * 1_000_000 -
    Number(run?.totalDeaths ?? 0) * 1_000 +
    floorProgress(run)
  );
}

/**
 * Aggressive insanity ranking: no wipe, then waves + last-floor progress.
 * Individual deaths do not break ties — higher progress wins.
 */
export function progressFirstScore(run) {
  const wipePenalty = run?.stopReason === "party_wipe" ? 1_000_000_000 : 0;
  return Number(run?.wavesCleared ?? 0) * 1_000_000 + floorProgress(run) - wipePenalty;
}

export function compareProgressFirst(left, right, countKey = "count") {
  return (
    Number(right.score ?? 0) - Number(left.score ?? 0) ||
    Number(right[countKey] ?? 0) - Number(left[countKey] ?? 0)
  );
}

export function isPartyWipe(run) {
  return run?.stopReason === "party_wipe";
}

export function anyPartyWipe(runs) {
  return (runs ?? []).some(isPartyWipe);
}

/**
 * Most-aggressive insanity ranking: any party wipe loses, then higher x.
 * Waves / leftover progress only break remaining ties.
 */
export function compareMaxNoWipe(left, right, countKey = "count") {
  const leftWipe = Boolean(left?.anyWipe) || anyPartyWipe(left?.runs);
  const rightWipe = Boolean(right?.anyWipe) || anyPartyWipe(right?.runs);
  if (leftWipe !== rightWipe) return Number(leftWipe) - Number(rightWipe);
  return (
    Number(right[countKey] ?? 0) - Number(left[countKey] ?? 0) ||
    Number(right.score ?? 0) - Number(left.score ?? 0)
  );
}
