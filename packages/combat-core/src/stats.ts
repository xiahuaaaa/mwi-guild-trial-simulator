import { assertNonNegativeSafeInteger, NANOSECONDS_PER_SECOND } from "./time.ts";

interface MutableMemberStatistics {
  totalDamage: number;
  damageTaken: number;
  deaths: number;
  oom: boolean;
  oomEvents: number;
  firstOomAtNs?: number;
  oomSinceNs?: number;
  closedOomDurationNs: number;
  passiveHitpointsGained: number;
  passiveManapointsGained: number;
}

export interface MemberStatisticsSnapshot {
  readonly memberId: string;
  readonly totalDamage: number;
  readonly dps: number;
  readonly damageTaken: number;
  readonly deaths: number;
  readonly oom: boolean;
  readonly oomEvents: number;
  readonly firstOomAtMs?: number;
  readonly oomDurationMs: number;
  readonly passiveHitpointsGained: number;
  readonly passiveManapointsGained: number;
}

export class DynamicMemberStatistics {
  private readonly members = new Map<string, MutableMemberStatistics>();

  constructor(memberIds: readonly string[] = []) {
    for (const memberId of memberIds) {
      this.ensure(memberId);
    }
  }

  recordDamageDealt(memberId: string, amount: number): void {
    this.ensure(memberId).totalDamage += assertFiniteNonNegative(amount, "damage");
  }

  recordDamageTaken(memberId: string, amount: number): void {
    this.ensure(memberId).damageTaken += assertFiniteNonNegative(amount, "damage taken");
  }

  recordDeath(memberId: string): void {
    this.ensure(memberId).deaths += 1;
  }

  recordOomFailure(memberId: string, timeNs: number): void {
    assertNonNegativeSafeInteger(timeNs, "OOM time");
    const member = this.ensure(memberId);
    member.oom = true;
    member.oomEvents += 1;
    member.firstOomAtNs ??= timeNs;
    member.oomSinceNs ??= timeNs;
  }

  recordManaAvailable(memberId: string, timeNs: number): void {
    assertNonNegativeSafeInteger(timeNs, "mana available time");
    const member = this.ensure(memberId);
    if (member.oomSinceNs !== undefined) {
      if (timeNs < member.oomSinceNs) {
        throw new RangeError("mana recovery cannot precede OOM");
      }
      member.closedOomDurationNs += timeNs - member.oomSinceNs;
      delete member.oomSinceNs;
    }
  }

  recordPassiveRegen(
    memberId: string,
    hitpointsGained: number,
    manapointsGained: number,
  ): void {
    const member = this.ensure(memberId);
    member.passiveHitpointsGained += assertFiniteNonNegative(
      hitpointsGained,
      "passive HP gained",
    );
    member.passiveManapointsGained += assertFiniteNonNegative(
      manapointsGained,
      "passive MP gained",
    );
  }

  snapshots(
    elapsedNs: number,
    memberOrder?: readonly string[],
  ): MemberStatisticsSnapshot[] {
    assertNonNegativeSafeInteger(elapsedNs, "elapsedNs");
    const ids = memberOrder ?? [...this.members.keys()];
    const elapsedSeconds = elapsedNs / NANOSECONDS_PER_SECOND;
    return ids.map((memberId) => {
      const member = this.ensure(memberId);
      const openOomDuration =
        member.oomSinceNs === undefined
          ? 0
          : Math.max(0, elapsedNs - member.oomSinceNs);
      return {
        memberId,
        totalDamage: member.totalDamage,
        dps: elapsedSeconds === 0 ? 0 : member.totalDamage / elapsedSeconds,
        damageTaken: member.damageTaken,
        deaths: member.deaths,
        oom: member.oom,
        oomEvents: member.oomEvents,
        ...(member.firstOomAtNs === undefined
          ? {}
          : { firstOomAtMs: member.firstOomAtNs / 1_000_000 }),
        oomDurationMs:
          (member.closedOomDurationNs + openOomDuration) / 1_000_000,
        passiveHitpointsGained: member.passiveHitpointsGained,
        passiveManapointsGained: member.passiveManapointsGained,
      };
    });
  }

  private ensure(memberId: string): MutableMemberStatistics {
    if (memberId.trim().length === 0) {
      throw new Error("memberId must not be empty");
    }
    let member = this.members.get(memberId);
    if (member === undefined) {
      member = {
        totalDamage: 0,
        damageTaken: 0,
        deaths: 0,
        oom: false,
        oomEvents: 0,
        closedOomDurationNs: 0,
        passiveHitpointsGained: 0,
        passiveManapointsGained: 0,
      };
      this.members.set(memberId, member);
    }
    return member;
  }
}

function assertFiniteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
  return value;
}
