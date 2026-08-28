const REVIVE_HRID = "/abilities/revive";
const INSANITY_HRID = "/abilities/insanity";
const INSANITY_DUTIES = new Set(["dps", "debuffer"]);

export function isAuraCarrier(row) {
  return Boolean(row?.auraHrid);
}

export function isInsanityCandidate(row) {
  const special = row?.abilityHrids?.[0];
  return (
    INSANITY_DUTIES.has(row?.duty) &&
    !isAuraCarrier(row) &&
    (special === REVIVE_HRID || special === INSANITY_HRID)
  );
}

/** @deprecated use isInsanityCandidate; kept for callers that meant "revive DPS". */
export function isReviveDps(row) {
  return isInsanityCandidate(row);
}

export function rankedReviveDpsIds(roster, dpsByMemberId = new Map()) {
  return [...(roster ?? [])]
    .filter(isInsanityCandidate)
    .sort(
      (left, right) =>
        Number(dpsByMemberId.get(String(right.memberId)) ?? 0) -
          Number(dpsByMemberId.get(String(left.memberId)) ?? 0) ||
        String(left.memberId).localeCompare(String(right.memberId)),
    )
    .map((row) => String(row.memberId));
}

export function revertInsanityToRevive(roster) {
  return (roster ?? []).map((row) => {
    const hrids = Array.isArray(row.abilityHrids) ? [...row.abilityHrids] : [];
    if (isAuraCarrier(row) || hrids[0] !== INSANITY_HRID) {
      return { ...row, abilityHrids: hrids };
    }
    hrids[0] = REVIVE_HRID;
    return {
      ...row,
      abilityHrids: hrids,
      special: "复活",
    };
  });
}

export function applyInsanityToTopDps(roster, count, rankedIds) {
  const take = new Set(
    (rankedIds ?? []).slice(0, Math.max(0, Number(count) || 0)),
  );
  return (roster ?? []).map((row) => {
    const hrids = Array.isArray(row.abilityHrids) ? [...row.abilityHrids] : [];
    if (!take.has(String(row.memberId)) || hrids[0] !== REVIVE_HRID) {
      return { ...row, abilityHrids: hrids };
    }
    hrids[0] = INSANITY_HRID;
    return {
      ...row,
      abilityHrids: hrids,
      special: "疯狂",
    };
  });
}

export function defaultInsanityCounts(maxDps) {
  const cap = Math.max(0, Number(maxDps) || 0);
  const stepped = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32].filter(
    (value) => value <= cap,
  );
  if (!stepped.includes(cap)) stepped.push(cap);
  return [...new Set(stepped)].sort((left, right) => left - right);
}
