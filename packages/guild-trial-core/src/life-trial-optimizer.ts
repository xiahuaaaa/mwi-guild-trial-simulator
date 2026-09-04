import { buildLifeTrialMemberStats } from "./life-trial-member.ts";
import { scaledLifeTrialProgress } from "./life-trial.ts";
import {
  simulateLifeTrialExpected,
  type LifeTrialParticipant,
  type LifeTrialSimResult,
} from "./life-trial-sim.ts";
type Json = Record<string, unknown>;

/** Lexicographic gain: points → levels → fraction toward next floor. */
interface AssignmentGain {
  points: number;
  levels: number;
  /** remainingProgress / required at final level; 0 when required is 0. */
  progressFrac: number;
}

export interface LifeTrialDefinition {
  trialHrid: string;
  trialName: string;
  skillHrid: string;
  maxParticipants: number;
}

export interface LifeAssignmentMember {
  memberId: string;
  displayName: string;
}

export interface LifeAssignmentRun {
  weekStartAt: string;
  generatedAt: string;
  trials: Array<{
    trialHrid: string;
    trialName: string;
    skillHrid: string;
    maxParticipants: number;
    roster: string[];
    expectedLevelsCleared: number;
    basePoints: number;
    finalLevel: number;
    remainingProgress: number;
    finalLevelRequired: number;
  }>;
  totalBasePoints: number;
  unassigned: string[];
  assumptions: string[];
}

export interface OptimizeLifeAssignmentsInput {
  weekStartAt: string;
  trials: readonly LifeTrialDefinition[];
  members: readonly LifeAssignmentMember[];
  snapshotsByMemberId: Readonly<Record<string, Json>>;
  excludedMemberIds?: readonly string[];
  /** memberId -> trialHrid assignments that must not move during optimization */
  pinnedAssignments?: ReadonlyMap<string, string>;
}

export function optimizeLifeAssignments(
  input: OptimizeLifeAssignmentsInput,
): LifeAssignmentRun {
  const excluded = new Set(input.excludedMemberIds ?? []);
  const candidates = input.members
    .map((member) => {
      const snapshot = input.snapshotsByMemberId[member.memberId];
      if (!snapshot) return null;
      const statsByTrial = new Map<string, ReturnType<typeof buildLifeTrialMemberStats>>();
      for (const trial of input.trials) {
        const stats = buildLifeTrialMemberStats(
          snapshot,
          member.memberId,
          member.displayName,
          trial.skillHrid,
        );
        if (stats) statsByTrial.set(trial.trialHrid, stats);
      }
      if (!statsByTrial.size) return null;
      return { member, statsByTrial };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .filter((row) => !excluded.has(row.member.memberId));

  const rosters = new Map(input.trials.map((trial) => [trial.trialHrid, [] as string[]]));
  const assigned = new Set<string>();
  const pinnedMemberIds = applyPinnedAssignments(
    input,
    candidates,
    rosters,
    assigned,
    input.pinnedAssignments ?? new Map(),
  );

  while (true) {
    let best: {
      memberId: string;
      trialHrid: string;
      gain: AssignmentGain;
    } | null = null;

    for (const candidate of candidates) {
      if (assigned.has(candidate.member.memberId)) continue;
      for (const trial of input.trials) {
        const roster = rosters.get(trial.trialHrid) ?? [];
        if (roster.length >= trial.maxParticipants) continue;
        const stats = candidate.statsByTrial.get(trial.trialHrid);
        if (!stats) continue;
        const gain = marginalAssignmentGain(
          input,
          rosters,
          trial.trialHrid,
          stats,
        );
        // Discrete base points alone create flat steps (Δpts=0) where the next
        // person still raises floors later. Keep investing while levels or
        // progress-toward-next-floor improve — not only whole-point cliffs.
        if (!isPositiveGain(gain)) continue;
        if (!best || compareAssignmentGain(gain, best.gain) > 0) {
          best = {
            memberId: candidate.member.memberId,
            trialHrid: trial.trialHrid,
            gain,
          };
        }
      }
    }

    if (!best) break;
    rosters.get(best.trialHrid)?.push(best.memberId);
    assigned.add(best.memberId);
  }

  improveBySwaps(input, rosters, candidates, assigned, pinnedMemberIds);

  const assumptions = new Set<string>(["tea_crate_zero"]);
  const trialResults = input.trials.map((trial) => {
    const roster = rosters.get(trial.trialHrid) ?? [];
    const participants = roster
      .map((memberId) => candidates.find((c) => c.member.memberId === memberId))
      .map((candidate) =>
        candidate?.statsByTrial.get(trial.trialHrid)
      )
      .filter((stats): stats is NonNullable<typeof stats> => stats != null)
      .map(toParticipant);
    const sim = simulateLifeTrialExpected({
      skillHrid: trial.skillHrid,
      participants,
      isEnhancing: trial.skillHrid === "/skills/enhancing",
    });
    for (const item of sim.assumptions) assumptions.add(item);
    const participantCount = Math.max(1, sim.participantCount);
    const finalLevelRequired = scaledLifeTrialProgress(
      sim.finalLevel,
      participantCount,
    );
    return {
      trialHrid: trial.trialHrid,
      trialName: trial.trialName,
      skillHrid: trial.skillHrid,
      maxParticipants: trial.maxParticipants,
      roster,
      expectedLevelsCleared: sim.levelsCleared,
      basePoints: sim.basePoints,
      finalLevel: sim.finalLevel,
      remainingProgress: Math.round(sim.remainingProgress),
      finalLevelRequired,
    };
  });

  const totalBasePoints = trialResults.reduce((sum, trial) => sum + trial.basePoints, 0);
  const unassigned = candidates
    .map((candidate) => candidate.member.memberId)
    .filter((memberId) => !assigned.has(memberId));

  return {
    weekStartAt: input.weekStartAt,
    generatedAt: new Date().toISOString(),
    trials: trialResults,
    totalBasePoints,
    unassigned,
    assumptions: [...assumptions],
  };
}

function toParticipant(stats: {
  skillLevel: number;
  levelBonuses?: number;
  efficiency?: number;
  actionSpeed?: number;
  successBonus?: number;
  supplyCrateBonus?: number;
  gatheringBonus?: number;
  gourmetBonus?: number;
}): LifeTrialParticipant {
  return {
    skillLevel: stats.skillLevel,
    levelBonuses: stats.levelBonuses,
    efficiency: stats.efficiency,
    actionSpeed: stats.actionSpeed,
    successBonus: stats.successBonus,
    supplyCrateBonus: stats.supplyCrateBonus,
    gatheringBonus: stats.gatheringBonus,
    gourmetBonus: stats.gourmetBonus,
  };
}

function simScore(sim: LifeTrialSimResult): AssignmentGain {
  const required = scaledLifeTrialProgress(
    sim.finalLevel,
    Math.max(1, sim.participantCount),
  );
  const progressFrac =
    required > 0 ? Math.min(1, Math.max(0, sim.remainingProgress / required)) : 0;
  return {
    points: sim.basePoints,
    levels: sim.levelsCleared,
    progressFrac,
  };
}

function emptyGain(): AssignmentGain {
  return { points: 0, levels: 0, progressFrac: 0 };
}

function subtractGain(after: AssignmentGain, before: AssignmentGain): AssignmentGain {
  return {
    points: after.points - before.points,
    levels: after.levels - before.levels,
    progressFrac: after.progressFrac - before.progressFrac,
  };
}

function isPositiveGain(gain: AssignmentGain): boolean {
  return gain.points > 0 || gain.levels > 0 || gain.progressFrac > 1e-12;
}

function compareAssignmentGain(left: AssignmentGain, right: AssignmentGain): number {
  if (left.points !== right.points) return left.points - right.points;
  if (left.levels !== right.levels) return left.levels - right.levels;
  return left.progressFrac - right.progressFrac;
}

function marginalAssignmentGain(
  input: OptimizeLifeAssignmentsInput,
  rosters: Map<string, string[]>,
  trialHrid: string,
  stats: NonNullable<ReturnType<typeof buildLifeTrialMemberStats>>,
): AssignmentGain {
  const before = simScore(simulateTrialRoster(input, rosters, trialHrid));
  const nextRoster = [...(rosters.get(trialHrid) ?? []), stats.memberId];
  const after = simScore(
    simulateTrialRoster(input, new Map(rosters).set(trialHrid, nextRoster), trialHrid),
  );
  return subtractGain(after, before);
}

function simulateTrialRoster(
  input: OptimizeLifeAssignmentsInput,
  rosters: Map<string, string[]>,
  trialHrid: string,
): LifeTrialSimResult {
  const trial = input.trials.find((row) => row.trialHrid === trialHrid);
  if (!trial) {
    return {
      participantCount: 0,
      levelsCleared: 0,
      basePoints: 0,
      finalLevel: 100,
      remainingProgress: 0,
      progressPerSecond: 0,
      assumptions: [],
    };
  }
  const roster = rosters.get(trialHrid) ?? [];
  const participants = roster
    .map((memberId) => {
      const snapshot = input.snapshotsByMemberId[memberId];
      if (!snapshot) return null;
      return buildLifeTrialMemberStats(
        snapshot,
        memberId,
        memberId,
        trial.skillHrid,
      );
    })
    .filter((stats): stats is NonNullable<typeof stats> => stats != null)
    .map(toParticipant);
  return simulateLifeTrialExpected({
    skillHrid: trial.skillHrid,
    participants,
    isEnhancing: trial.skillHrid === "/skills/enhancing",
  });
}

function totalObjective(
  input: OptimizeLifeAssignmentsInput,
  rosters: Map<string, string[]>,
): AssignmentGain {
  return input.trials.reduce((sum, trial) => {
    const score = simScore(simulateTrialRoster(input, rosters, trial.trialHrid));
    return {
      points: sum.points + score.points,
      levels: sum.levels + score.levels,
      progressFrac: sum.progressFrac + score.progressFrac,
    };
  }, emptyGain());
}

function applyPinnedAssignments(
  input: OptimizeLifeAssignmentsInput,
  candidates: Array<{
    member: LifeAssignmentMember;
    statsByTrial: Map<string, NonNullable<ReturnType<typeof buildLifeTrialMemberStats>>>;
  }>,
  rosters: Map<string, string[]>,
  assigned: Set<string>,
  pinnedAssignments: ReadonlyMap<string, string>,
): Set<string> {
  const pinnedMemberIds = new Set<string>();
  for (const [memberId, trialHrid] of pinnedAssignments) {
    const candidate = candidates.find(
      (row) => row.member.memberId.toLocaleLowerCase() === memberId.toLocaleLowerCase(),
    );
    if (!candidate) {
      throw new Error(`pinned life member not found or ineligible: ${memberId}`);
    }
    const trial = input.trials.find((row) => row.trialHrid === trialHrid);
    if (!trial) {
      throw new Error(`pinned life trial not found: ${trialHrid}`);
    }
    if (!candidate.statsByTrial.has(trialHrid)) {
      throw new Error(`${memberId} cannot be pinned to ${trial.trialName}`);
    }
    const roster = rosters.get(trialHrid) ?? [];
    if (roster.length >= trial.maxParticipants) {
      throw new Error(`${trial.trialName} is full; cannot pin ${memberId}`);
    }
    roster.push(candidate.member.memberId);
    rosters.set(trialHrid, roster);
    assigned.add(candidate.member.memberId);
    pinnedMemberIds.add(candidate.member.memberId);
  }
  return pinnedMemberIds;
}

function improveBySwaps(
  input: OptimizeLifeAssignmentsInput,
  rosters: Map<string, string[]>,
  candidates: Array<{
    member: LifeAssignmentMember;
    statsByTrial: Map<string, NonNullable<ReturnType<typeof buildLifeTrialMemberStats>>>;
  }>,
  assigned: Set<string>,
  pinnedMemberIds: ReadonlySet<string>,
): void {
  let improved = true;
  while (improved) {
    improved = false;
    const memberIds = [...assigned];
    for (let i = 0; i < memberIds.length; i += 1) {
      for (let j = i + 1; j < memberIds.length; j += 1) {
        const a = memberIds[i];
        const b = memberIds[j];
        if (pinnedMemberIds.has(a) || pinnedMemberIds.has(b)) continue;
        const trialA = findTrialForMember(rosters, a);
        const trialB = findTrialForMember(rosters, b);
        if (!trialA || !trialB || trialA === trialB) continue;
        const candidateA = candidates.find((row) => row.member.memberId === a);
        const candidateB = candidates.find((row) => row.member.memberId === b);
        if (!candidateA || !candidateB) continue;
        if (!candidateA.statsByTrial.has(trialB) || !candidateB.statsByTrial.has(trialA)) {
          continue;
        }
        const before = totalObjective(input, rosters);
        swapMembers(rosters, trialA, a, trialB, b);
        const after = totalObjective(input, rosters);
        if (compareAssignmentGain(after, before) > 0) {
          improved = true;
        } else {
          swapMembers(rosters, trialB, a, trialA, b);
        }
      }
    }
  }
}

function findTrialForMember(
  rosters: Map<string, string[]>,
  memberId: string,
): string | null {
  for (const [trialHrid, roster] of rosters.entries()) {
    if (roster.includes(memberId)) return trialHrid;
  }
  return null;
}

function swapMembers(
  rosters: Map<string, string[]>,
  trialA: string,
  memberA: string,
  trialB: string,
  memberB: string,
): void {
  const rosterA = rosters.get(trialA) ?? [];
  const rosterB = rosters.get(trialB) ?? [];
  rosters.set(
    trialA,
    rosterA.map((memberId) => (memberId === memberA ? memberB : memberId)),
  );
  rosters.set(
    trialB,
    rosterB.map((memberId) => (memberId === memberB ? memberA : memberId)),
  );
}

export function weakestTrialBasePoints(run: LifeAssignmentRun): number {
  return run.trials.reduce(
    (min, trial) => Math.min(min, trial.basePoints),
    Number.POSITIVE_INFINITY,
  );
}

export function compareLifeAssignmentRuns(
  left: LifeAssignmentRun,
  right: LifeAssignmentRun,
): number {
  if (left.totalBasePoints !== right.totalBasePoints) {
    return left.totalBasePoints - right.totalBasePoints;
  }
  const leftMin = weakestTrialBasePoints(left);
  const rightMin = weakestTrialBasePoints(right);
  if (leftMin !== rightMin) return leftMin - rightMin;
  const leftMargin = left.trials.reduce((sum, trial) => sum + trial.expectedLevelsCleared, 0);
  const rightMargin = right.trials.reduce((sum, trial) => sum + trial.expectedLevelsCleared, 0);
  return leftMargin - rightMargin;
}
