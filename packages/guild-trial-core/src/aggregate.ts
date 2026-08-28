import type {
  AggregatedMemberResult,
  GuildTrialAggregateResult,
  GuildTrialRunResult,
} from "./types.ts";

export function aggregateGuildTrialRuns(
  runs: readonly GuildTrialRunResult[],
): GuildTrialAggregateResult {
  if (runs.length === 0) {
    throw new Error("at least one guild trial run is required");
  }
  const memberOrder = runs[0]?.members.map((member) => member.memberId) ?? [];
  const expectedMembers = new Set(memberOrder);
  for (const run of runs) {
    const actualMembers = new Set(run.members.map((member) => member.memberId));
    if (
      actualMembers.size !== expectedMembers.size ||
      [...expectedMembers].some((memberId) => !actualMembers.has(memberId))
    ) {
      throw new Error("all runs must contain the same member IDs");
    }
  }

  const members: AggregatedMemberResult[] = memberOrder.map((memberId) => {
    const samples = runs.map((run) => {
      const member = run.members.find((entry) => entry.memberId === memberId);
      if (member === undefined) {
        throw new Error(`run is missing member: ${memberId}`);
      }
      return member;
    });
    const meanDps =
      samples.reduce((total, member) => total + member.dps, 0) /
      samples.length;
    return {
      memberId,
      meanDps,
      roundedMeanDps: Math.round(meanDps),
      oom: samples.some((member) => member.oom),
      deaths: samples.reduce((total, member) => total + member.deaths, 0),
      damageTaken: samples.reduce(
        (total, member) => total + member.damageTaken,
        0,
      ),
    };
  });

  return {
    runs: [...runs],
    members,
  };
}
