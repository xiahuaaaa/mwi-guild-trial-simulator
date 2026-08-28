import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface GroupDailyQuotaDecision {
  ok: boolean;
  used: number;
  limit: number;
  day: string;
}

export interface GroupDailyQuotaStore {
  readonly limit: number;
  /** Reserve one outbound group reply. Private sends are not tracked. */
  tryConsume(groupId: string): GroupDailyQuotaDecision;
  peek(groupId: string): GroupDailyQuotaDecision;
}

type DayBucket = Record<string, number>;

interface QuotaFileShape {
  day: string;
  groups: DayBucket;
}

/** Calendar day in Asia/Shanghai (`YYYY-MM-DD`). */
export function shanghaiDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function parseGroupDailyReplyLimit(
  raw: string | undefined,
  fallback = 500,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      "MWI_QQ_GROUP_DAILY_REPLY_LIMIT must be a non-negative number (0 disables)",
    );
  }
  return Math.floor(value);
}

function emptyFile(day: string): QuotaFileShape {
  return { day, groups: {} };
}

/**
 * Per-group daily outbound reply counter.
 * `limit <= 0` disables enforcement (always ok).
 */
export function createGroupDailyQuotaStore(input: {
  limit: number;
  statePath?: string;
  now?: () => Date;
}): GroupDailyQuotaStore {
  const limit = Math.floor(input.limit);
  const now = input.now ?? (() => new Date());
  const statePath = input.statePath;
  let state: QuotaFileShape = emptyFile(shanghaiDayKey(now()));

  if (statePath) {
    try {
      const raw = readFileSync(statePath, "utf8");
      const parsed = JSON.parse(raw) as QuotaFileShape;
      if (
        parsed &&
        typeof parsed.day === "string" &&
        parsed.groups &&
        typeof parsed.groups === "object"
      ) {
        state = {
          day: parsed.day,
          groups: Object.fromEntries(
            Object.entries(parsed.groups).filter(
              ([, count]) => typeof count === "number" && count >= 0,
            ),
          ),
        };
      }
    } catch {
      // Missing or corrupt file → start fresh for today.
      state = emptyFile(shanghaiDayKey(now()));
    }
  }

  function rollDay(): void {
    const day = shanghaiDayKey(now());
    if (state.day !== day) {
      state = emptyFile(day);
      persist();
    }
  }

  function persist(): void {
    if (!statePath) return;
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      const tempPath = `${statePath}.${process.pid}.tmp`;
      writeFileSync(tempPath, `${JSON.stringify(state)}\n`, "utf8");
      renameSync(tempPath, statePath);
    } catch (error) {
      console.error(
        "[quota] failed to persist group daily quota:",
        (error as Error).message ?? error,
      );
    }
  }

  function snapshot(groupId: string): GroupDailyQuotaDecision {
    rollDay();
    const used = state.groups[groupId] ?? 0;
    if (limit <= 0) {
      return { ok: true, used, limit: 0, day: state.day };
    }
    return { ok: used < limit, used, limit, day: state.day };
  }

  return {
    limit,
    peek(groupId: string): GroupDailyQuotaDecision {
      return snapshot(String(groupId));
    },
    tryConsume(groupId: string): GroupDailyQuotaDecision {
      const id = String(groupId);
      const before = snapshot(id);
      if (limit <= 0) return before;
      if (!before.ok) return before;
      state.groups[id] = before.used + 1;
      persist();
      return {
        ok: true,
        used: before.used + 1,
        limit,
        day: state.day,
      };
    },
  };
}
