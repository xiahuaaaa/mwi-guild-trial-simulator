import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Minimum length when matching via member-id-contains-group-fragment. */
const MIN_CONTAINED_FRAGMENT_LEN = 3;

/** Apply Levenshtein tolerance only to ASCII ids at least this long. */
const MIN_EDIT_DISTANCE_NAME_LEN = 5;

/** Max Levenshtein distance for near-miss game ids (e.g. CongeAqua vs CongeAuqa). */
const MAX_EDIT_DISTANCE = 2;

const ALIASES_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "group-member-aliases.json",
);

let cachedAliases: Record<string, string[]> | undefined;

function loadMemberAliases(): Record<string, string[]> {
  if (cachedAliases) return cachedAliases;
  try {
    const raw = JSON.parse(readFileSync(ALIASES_PATH, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      cachedAliases = {};
      return cachedAliases;
    }
    cachedAliases = Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, string[]] =>
          typeof entry[0] === "string" &&
          Array.isArray(entry[1]) &&
          entry[1].every((value) => typeof value === "string"),
      ),
    );
  } catch {
    cachedAliases = {};
  }
  return cachedAliases;
}

function isAsciiAlphanumeric(name: string): boolean {
  return /^[\x20-\x7e]+$/u.test(name);
}

function levenshteinDistance(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}

/** Strip guild prefix and common card suffixes before matching. */
export function normalizeGroupCardName(name: string): string {
  return name
    .replace(/^TMD[丨|｜\s]+/iu, "")
    .replace(/[#＃][^\s]{0,8}$/u, "")
    .replace(/[（(][^)）]{0,10}[)）]$/u, "")
    .trim();
}

function substringMatch(memberName: string, groupName: string): boolean {
  const memberId = memberName.toLowerCase().trim();
  const groupLabel = groupName.toLowerCase().trim();
  if (!memberId || !groupLabel) return false;

  // Group card contains the full game id (e.g. "ishi 水法低手", "TMD丨玩家甲").
  if (groupLabel.includes(memberId)) return true;

  // Game id contains the group fragment only when the fragment is long enough.
  if (
    groupLabel.length >= MIN_CONTAINED_FRAGMENT_LEN &&
    memberId.includes(groupLabel)
  ) {
    return true;
  }

  return false;
}

function namesSimilarByEditDistance(memberName: string, groupName: string): boolean {
  if (!isAsciiAlphanumeric(memberName) || !isAsciiAlphanumeric(groupName)) {
    return false;
  }

  const memberId = memberName.trim();
  const groupLabel = groupName.trim();
  if (memberId.length < MIN_EDIT_DISTANCE_NAME_LEN) return false;
  if (Math.abs(memberId.length - groupLabel.length) > 1) return false;

  return levenshteinDistance(memberId, groupLabel) <= MAX_EDIT_DISTANCE;
}

function matchesAlias(
  memberName: string,
  groupNames: readonly string[],
  aliases: Record<string, string[]>,
): boolean {
  const configured = aliases[memberName] ?? aliases[memberName.toLowerCase()];
  if (!configured?.length) return false;

  return configured.some((alias) =>
    groupNames.some(
      (groupName) =>
        groupName === alias ||
        groupName.includes(alias) ||
        alias.includes(groupName),
    ),
  );
}

/**
 * Whether a guild member's game id can be found in QQ group cards/nicknames.
 *
 * Matching rules:
 * - configured aliases (Chinese nicknames, etc.)
 * - group card contains full game id (case-insensitive)
 * - game id contains group fragment only when fragment length >= 3
 * - strip guild prefix / #职业 / bracket notes before retrying
 * - Levenshtein distance <= 2 for ASCII ids length >= 5
 */
export function fuzzyMatchMemberInGroup(
  memberName: string,
  groupNames: readonly string[],
  aliases: Record<string, string[]> = loadMemberAliases(),
): boolean {
  const trimmed = memberName.trim();
  if (!trimmed) return false;

  if (matchesAlias(trimmed, groupNames, aliases)) return true;

  for (const groupName of groupNames) {
    if (substringMatch(trimmed, groupName)) return true;

    const normalized = normalizeGroupCardName(groupName);
    if (normalized && normalized !== groupName && substringMatch(trimmed, normalized)) {
      return true;
    }

    if (namesSimilarByEditDistance(trimmed, normalized || groupName)) return true;
  }

  return false;
}
