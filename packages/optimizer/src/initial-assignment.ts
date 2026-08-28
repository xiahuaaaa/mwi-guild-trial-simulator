import type {
  BossTeamConstraint,
  BuildCandidate,
  InitialAssignmentResult,
  TeamAssignment,
} from "./model.ts";

interface MutableTeam {
  constraint: BossTeamConstraint;
  candidates: BuildCandidate[];
}

function teamHasMember(team: MutableTeam, memberId: string): boolean {
  return team.candidates.some((candidate) => candidate.memberId === memberId);
}

function providerCount(team: MutableTeam, tag: string): number {
  return team.candidates.filter((candidate) =>
    candidate.coverageTags.includes(tag)
  ).length;
}

function roleCount(team: MutableTeam, role: "tank" | "healer"): number {
  return team.candidates.filter((candidate) => candidate.role === role).length;
}

function bestCandidate(
  candidates: BuildCandidate[],
  team: MutableTeam,
  assignedMembers: Set<string>,
  predicate: (candidate: BuildCandidate) => boolean,
): BuildCandidate | undefined {
  return candidates
    .filter((candidate) =>
      candidate.bossHrid === team.constraint.bossHrid
      && !assignedMembers.has(candidate.memberId)
      && team.candidates.length < team.constraint.capacity
      && predicate(candidate)
    )
    .sort((left, right) =>
      right.heuristicScore - left.heuristicScore
      || left.memberId.localeCompare(right.memberId)
      || left.candidateId.localeCompare(right.candidateId)
    )[0];
}

function addCandidate(
  team: MutableTeam,
  candidate: BuildCandidate,
  assignedMembers: Set<string>,
): void {
  if (assignedMembers.has(candidate.memberId) || teamHasMember(team, candidate.memberId)) return;
  team.candidates.push(candidate);
  assignedMembers.add(candidate.memberId);
}

function fillHardRequirements(
  teams: MutableTeam[],
  candidates: BuildCandidate[],
  assignedMembers: Set<string>,
): void {
  for (const team of teams) {
    for (const [role, minimum] of [
      ["tank", team.constraint.minimumTanks],
      ["healer", team.constraint.minimumHealers],
    ] as const) {
      while (roleCount(team, role) < minimum) {
        const selected = bestCandidate(
          candidates,
          team,
          assignedMembers,
          (candidate) => candidate.role === role,
        );
        if (!selected) break;
        addCandidate(team, selected, assignedMembers);
      }
    }

    for (const requirement of team.constraint.coverage) {
      while (providerCount(team, requirement.tag) < requirement.minimumProviders) {
        const selected = bestCandidate(
          candidates,
          team,
          assignedMembers,
          (candidate) => candidate.coverageTags.includes(requirement.tag),
        );
        if (!selected) break;
        addCandidate(team, selected, assignedMembers);
      }
    }
  }
}

function score(team: MutableTeam): number {
  return team.candidates.reduce(
    (total, candidate) => total + candidate.heuristicScore,
    0,
  );
}

function fillBalanced(
  teams: MutableTeam[],
  candidates: BuildCandidate[],
  assignedMembers: Set<string>,
): void {
  const allMemberIds = [...new Set(candidates.map((candidate) => candidate.memberId))]
    .filter((memberId) => !assignedMembers.has(memberId))
    .sort();

  for (const memberId of allMemberIds) {
    const options = candidates.filter((candidate) =>
      candidate.memberId === memberId
      && teams.some((team) =>
        team.constraint.bossHrid === candidate.bossHrid
        && team.candidates.length < team.constraint.capacity
      )
    );
    if (!options.length) continue;

    const selected = options
      .map((candidate) => ({
        candidate,
        team: teams.find((team) =>
          team.constraint.bossHrid === candidate.bossHrid
        )!,
      }))
      .sort((left, right) => {
        const leftMin = Math.min(
          ...teams.map((team) =>
            team === left.team ? score(team) + left.candidate.heuristicScore : score(team)
          ),
        );
        const rightMin = Math.min(
          ...teams.map((team) =>
            team === right.team ? score(team) + right.candidate.heuristicScore : score(team)
          ),
        );
        return rightMin - leftMin
          || right.candidate.heuristicScore - left.candidate.heuristicScore
          || left.candidate.candidateId.localeCompare(right.candidate.candidateId);
      })[0];
    addCandidate(selected.team, selected.candidate, assignedMembers);
  }
}

function teamIssues(team: MutableTeam): string[] {
  const issues: string[] = [];
  if (team.candidates.length < team.constraint.minimumMembers) {
    issues.push(
      `members:${team.candidates.length}<${team.constraint.minimumMembers}`,
    );
  }
  if (roleCount(team, "tank") < team.constraint.minimumTanks) {
    issues.push(
      `tanks:${roleCount(team, "tank")}<${team.constraint.minimumTanks}`,
    );
  }
  if (roleCount(team, "healer") < team.constraint.minimumHealers) {
    issues.push(
      `healers:${roleCount(team, "healer")}<${team.constraint.minimumHealers}`,
    );
  }
  for (const requirement of team.constraint.coverage) {
    const providers = providerCount(team, requirement.tag);
    if (providers < requirement.minimumProviders) {
      issues.push(
        `${requirement.critical ? "critical-" : ""}coverage:${requirement.tag}:${providers}<${requirement.minimumProviders}`,
      );
    }
    if (requirement.minimumUptime > 0) {
      issues.push(`uptime-pending-full-simulation:${requirement.tag}`);
    }
  }
  return issues;
}

function finalizeTeam(team: MutableTeam): TeamAssignment {
  const coverageProviders: Record<string, string[]> = {};
  for (const candidate of team.candidates) {
    for (const tag of candidate.coverageTags) {
      (coverageProviders[tag] ??= []).push(candidate.memberId);
    }
  }
  return {
    bossHrid: team.constraint.bossHrid,
    candidates: [...team.candidates].sort((left, right) =>
      left.memberId.localeCompare(right.memberId)
    ),
    heuristicScore: score(team),
    coverageProviders,
    issues: teamIssues(team),
  };
}

/**
 * Produces a deterministic, constraint-aware starting point. It is not the
 * final optimizer: uptime, healing, threat, deaths, OOM and true progress must
 * be evaluated by the full combat simulator before a recommendation can be
 * published.
 */
export function buildInitialAssignment(
  candidates: BuildCandidate[],
  constraints: BossTeamConstraint[],
): InitialAssignmentResult {
  const teams: MutableTeam[] = constraints.map((constraint) => ({
    constraint,
    candidates: [],
  }));
  const assignedMembers = new Set<string>();

  fillHardRequirements(teams, candidates, assignedMembers);
  fillBalanced(teams, candidates, assignedMembers);

  const finalizedTeams = teams.map(finalizeTeam);
  const allMemberIds = [...new Set(candidates.map((candidate) => candidate.memberId))];
  const unassignedMemberIds = allMemberIds
    .filter((memberId) => !assignedMembers.has(memberId))
    .sort();
  const scores = finalizedTeams.map((team) => team.heuristicScore);
  const hardIssues = finalizedTeams.flatMap((team) =>
    team.issues.filter((issue) => !issue.startsWith("uptime-pending-"))
  );

  return {
    phase: "initial-feasible-assignment",
    feasible: hardIssues.length === 0,
    teams: finalizedTeams,
    unassignedMemberIds,
    objective: {
      weakerTeamScore: scores.length ? Math.min(...scores) : 0,
      totalScore: scores.reduce((total, value) => total + value, 0),
    },
    warnings: [
      "heuristic-scores-are-for-candidate-pruning-only",
      "full-two-boss-three-seed-simulation-required",
      "coverage-uptime-healing-threat-death-and-oom-not-yet-evaluated",
    ],
  };
}
