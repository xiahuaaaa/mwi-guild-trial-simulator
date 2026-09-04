import {
  buildLifeTrialMemberStats,
  guildTrialMinLifeSkillLevel,
  readLifeSkillLevelFromSnapshot,
} from "../../../packages/guild-trial-core/src/life-trial-member.ts";
import {
  optimizeLifeAssignments,
  type LifeAssignmentRun,
} from "../../../packages/guild-trial-core/src/life-trial-optimizer.ts";
import {
  simulateLifeTrialExpected,
} from "../../../packages/guild-trial-core/src/life-trial-sim.ts";
import { scaledLifeTrialProgress } from "../../../packages/guild-trial-core/src/life-trial.ts";
import { formatBeijingDate } from "./beijing-time.ts";
import { finalLevelProgressPercent } from "./life-assignment-report.ts";

type Json = Record<string, unknown>;

export interface WeeklySkillingTrial {
  trialHrid: string;
  trialName: string;
  skillHrid: string;
  maxParticipants: number;
}

export function weeklySkillingTrialsFromCatalog(catalog: Json): WeeklySkillingTrial[] {
  const trials = Array.isArray(catalog.trials) ? catalog.trials as Json[] : [];
  return trials
    .filter((trial) => trial.kind === "skilling")
    .map((trial) => ({
      trialHrid: String(trial.trialHrid),
      trialName: String(trial.trialName ?? trial.trialHrid),
      skillHrid: String(trial.skillHrid ?? ""),
      maxParticipants: Number(trial.maxParticipants),
    }))
    .filter((trial) =>
      trial.trialHrid &&
      trial.skillHrid &&
      Number.isInteger(trial.maxParticipants) &&
      trial.maxParticipants > 0
    );
}

/** Parse `MWI_LIFE_RESERVE_SLOTS` entries like `/guild_skilling/alchemy:2` or `炼金:2`. */
export function parseLifeTrialReserveSlots(
  spec: string | undefined,
): Map<string, number> {
  const reserved = new Map<string, number>();
  if (!spec?.trim()) return reserved;
  for (const entry of spec.split(/[,，\s]+/u)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [key, countText] = trimmed.split(/[:：]/u);
    const count = Number(countText);
    if (!key?.trim() || !Number.isInteger(count) || count < 1) {
      throw new Error(`invalid life reserve slot entry: ${trimmed}`);
    }
    reserved.set(key.trim(), count);
  }
  return reserved;
}

export function resolveLifeTrialReserveCount(
  trial: Pick<WeeklySkillingTrial, "trialHrid" | "trialName">,
  reserved: ReadonlyMap<string, number>,
): number {
  return reserved.get(trial.trialHrid) ?? reserved.get(trial.trialName) ?? 0;
}

export function formatLifeTrialsOverview(
  catalog: Json,
  staleCapacityTrials: readonly string[] = [],
): string {
  const trials = weeklySkillingTrialsFromCatalog(catalog);
  if (!trials.length) {
    return "本周生活试炼尚未同步。请让 adudu 更新插件并登录游戏。";
  }
  const stale = new Set(staleCapacityTrials);
  const lines = [
    `本周生活试炼（${formatBeijingDate(catalog.weekStartAt ?? "未知周")}）`,
    ...trials.map((trial, index) => {
      const cap = stale.has(trial.trialHrid)
        ? `${trial.maxParticipants}（stale_cap）`
        : String(trial.maxParticipants);
      return `${index + 1}. ${trial.trialName} 上限 ${cap}`;
    }),
  ];
  return lines.join("\n");
}

export function generateLifeAssignmentRun(input: {
  weekStartAt: string;
  trials: readonly WeeklySkillingTrial[];
  members: Array<{ memberId: string; displayName: string; latestSnapshot?: Json }>;
  excludedMemberIds?: readonly string[];
  reservedSlotsByTrial?: ReadonlyMap<string, number>;
}): LifeAssignmentRun {
  const snapshotsByMemberId: Record<string, Json> = {};
  const members = input.members
    .filter((member) => member.latestSnapshot)
    .map((member) => {
      snapshotsByMemberId[member.memberId] = member.latestSnapshot as Json;
      return {
        memberId: member.memberId,
        displayName: member.displayName,
      };
    });
  const reserved = input.reservedSlotsByTrial ?? new Map<string, number>();
  const capacityByHrid = new Map(
    input.trials.map((trial) => [trial.trialHrid, trial.maxParticipants]),
  );
  const trialsForOptimizer = input.trials.map((trial) => {
    const reserve = resolveLifeTrialReserveCount(trial, reserved);
    return {
      ...trial,
      maxParticipants: Math.max(1, trial.maxParticipants - reserve),
    };
  });
  const run = optimizeLifeAssignments({
    weekStartAt: input.weekStartAt,
    trials: trialsForOptimizer,
    members,
    snapshotsByMemberId,
    excludedMemberIds: input.excludedMemberIds,
  });
  return {
    ...run,
    trials: run.trials.map((trial) => ({
      ...trial,
      maxParticipants: capacityByHrid.get(trial.trialHrid) ?? trial.maxParticipants,
    })),
  };
}

export function formatLifeAssignmentRun(run: LifeAssignmentRun): string {
  const lines = [
    `本周生活分工推荐（${formatBeijingDate(run.weekStartAt)}）`,
    `生活基础点数合计：${run.totalBasePoints}`,
    "",
  ];
  for (const trial of run.trials) {
    lines.push(
      `${trial.trialName}（≤${trial.maxParticipants}，期望 ${trial.expectedLevelsCleared} 层，末层 Lv.${trial.finalLevel} ${finalLevelProgressPercent(trial)}%，${trial.basePoints} 点）`,
    );
    lines.push(trial.roster.length ? trial.roster.join("、") : "（暂无推荐）");
    lines.push("");
  }
  if (run.unassigned.length) {
    lines.push(`未分配：${run.unassigned.join("、")}`);
  }
  return lines.join("\n").trim();
}

export const LIFE_SIMULATION_USAGE = [
  "生活模拟 用法：",
  "生活模拟 1              → 模拟第 1 场，用生活分工推荐名单",
  "生活模拟 挤奶            → 模拟挤奶场，用推荐名单",
  "生活模拟 挤奶 #alice,bob → 只模拟 alice 和 bob 两人",
].join("\n");

export function simulateLifeTrialForRoster(input: {
  trial: WeeklySkillingTrial;
  memberIds: readonly string[];
  snapshotsByMemberId: Readonly<Record<string, Json>>;
}): string {
  const participants: NonNullable<ReturnType<typeof buildLifeTrialMemberStats>>[] = [];
  const belowThreshold: string[] = [];
  const minLevel = guildTrialMinLifeSkillLevel(input.trial.skillHrid);
  for (const memberId of input.memberIds) {
    const snapshot = input.snapshotsByMemberId[memberId];
    if (!snapshot) continue;
    const level = readLifeSkillLevelFromSnapshot(snapshot, input.trial.skillHrid);
    if (level < minLevel) {
      belowThreshold.push(`${memberId}（${input.trial.trialName}${level}）`);
      continue;
    }
    const stats = buildLifeTrialMemberStats(
      snapshot,
      memberId,
      memberId,
      input.trial.skillHrid,
    );
    if (stats) participants.push(stats);
  }
  const result = simulateLifeTrialExpected({
    skillHrid: input.trial.skillHrid,
    participants,
    isEnhancing: input.trial.skillHrid === "/skills/enhancing",
  });
  const lines = [
    `${input.trial.trialName} 生活模拟`,
    `人数：${result.participantCount}/${input.trial.maxParticipants}`,
    `期望通关：${result.levelsCleared} 层（基础点数 ${result.basePoints}）`,
    `末层：Lv.${result.finalLevel}，进度 ${Math.round(result.remainingProgress)} / ${scaledLifeTrialProgress(result.finalLevel, Math.max(1, result.participantCount))}`,
    `假设：${result.assumptions.join("、")}`,
  ];
  if (belowThreshold.length) {
    lines.push(
      `未计入模拟（对应技能<${minLevel}）：${belowThreshold.join("、")}`,
    );
  }
  return lines.join("\n");
}

export function resolveLifeTrialByToken(
  trials: readonly WeeklySkillingTrial[],
  token: string,
): WeeklySkillingTrial | null {
  const normalized = token.trim();
  if (!normalized) return null;
  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 1 && index <= trials.length) {
    return trials[index - 1] ?? null;
  }
  const lower = normalized.toLocaleLowerCase();
  return trials.find((trial) =>
    trial.trialName.includes(normalized) ||
    trial.trialHrid.toLocaleLowerCase().includes(lower) ||
    trial.skillHrid.split("/").at(-1)?.toLocaleLowerCase() === lower
  ) ?? null;
}

export function parseLifeSimulationCommand(text: string): {
  trialToken: string;
  memberIds: string[];
} | null {
  const normalized = text.trim();
  if (!normalized.startsWith("生活模拟")) return null;
  const rest = normalized.slice("生活模拟".length).trim();
  if (!rest) return { trialToken: "", memberIds: [] };
  const hashIndex = Math.max(rest.indexOf("#"), rest.indexOf("＃"));
  if (hashIndex >= 0) {
    return {
      trialToken: rest.slice(0, hashIndex).trim(),
      memberIds: rest
        .slice(hashIndex + 1)
        .split(/[,，]/u)
        .map((name) => name.trim())
        .filter(Boolean),
    };
  }
  return { trialToken: rest, memberIds: [] };
}
