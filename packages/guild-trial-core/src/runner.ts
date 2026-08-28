import {
  DeterministicEventLoop,
  DynamicMemberStatistics,
  millisecondsToNanoseconds,
  Mulberry32Random,
  NANOSECONDS_PER_SECOND,
  type ScheduledEvent,
} from "../../combat-core/src/index.ts";
import { createGuildTrialCombatPolicies, validateGuildTrialRules } from "./rules.ts";
import { combatTrialBasePoints } from "./scoring.ts";
import { GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT } from "./types.ts";
import type {
  BossFactory,
  BossState,
  GuildTrialRunRequest,
  GuildTrialRunResult,
  MemberCombatPort,
  RuntimeMemberState,
  TrialMemberRunResult,
  WaveKill,
} from "./types.ts";

type TrialEventKind = "spawnBoss" | "memberAttack" | "passiveRegen";

type TrialEventPayload =
  | { readonly type: "spawnBoss"; readonly level: number }
  | { readonly type: "memberAttack"; readonly memberId: string }
  | { readonly type: "passiveRegen" };

const PRIORITY_SPAWN = 0;
const PRIORITY_REGEN = 10;
const PRIORITY_MEMBER_ACTION = 20;
const PASSIVE_REGEN_INTERVAL_NS = 10 * NANOSECONDS_PER_SECOND;

export class GuildTrialRunner<TMemberInput> {
  private readonly combatPort: MemberCombatPort<TMemberInput>;
  private readonly bossFactory: BossFactory;

  constructor(
    combatPort: MemberCombatPort<TMemberInput>,
    bossFactory: BossFactory,
  ) {
    this.combatPort = combatPort;
    this.bossFactory = bossFactory;
  }

  run(request: GuildTrialRunRequest<TMemberInput>): GuildTrialRunResult {
    validateGuildTrialRules(request.rules);
    const policies = createGuildTrialCombatPolicies(request.rules);
    const random = new Mulberry32Random(request.seed);
    const members = this.initializeMembers(request.members);
    const memberIds = members.map((member) => member.memberId);
    const memberById = new Map(
      members.map((member) => [member.memberId, member]),
    );
    const stats = new DynamicMemberStatistics(memberIds);
    const waveKills: WaveKill[] = [];
    const eventLoop = new DeterministicEventLoop<
      TrialEventKind,
      TrialEventPayload
    >();
    const deadlineNs = millisecondsToNanoseconds(request.rules.durationMs);

    // Input normalization and the runtime policy both reject consumables. This
    // intentionally invokes the adapter to ensure imported DTO content cannot
    // silently bypass the rule.
    if (this.combatPort.listConsumables !== undefined) {
      for (const memberInput of request.members) {
        for (const consumable of this.combatPort.listConsumables(memberInput)) {
          if (policies.consumables.permits(consumable)) {
            throw new Error("disabled consumable policy admitted a consumable");
          }
        }
      }
    }

    let currentBoss: BossState | undefined = this.spawnValidatedBoss(
      request.rules.startMonsterLevel,
      members.length,
    );
    let pendingBossLevel: number | undefined;
    let maximumLevelCleared = false;
    let lastClearedBoss: BossState | undefined;

    for (const member of members) {
      eventLoop.schedule({
        timeNs: millisecondsToNanoseconds(member.attackIntervalMs),
        priority: PRIORITY_MEMBER_ACTION,
        kind: "memberAttack",
        payload: { type: "memberAttack", memberId: member.memberId },
      });
    }
    eventLoop.schedule({
      timeNs: PASSIVE_REGEN_INTERVAL_NS,
      priority: PRIORITY_REGEN,
      kind: "passiveRegen",
      payload: { type: "passiveRegen" },
    });

    const processEvent = (
      event: ScheduledEvent<TrialEventKind, TrialEventPayload>,
    ): void => {
      switch (event.payload.type) {
        case "spawnBoss": {
          for (const member of members) {
            member.currentHitpoints = member.maxHitpoints;
            member.currentManapoints = member.maxManapoints;
            stats.recordManaAvailable(member.memberId, event.timeNs);
          }
          currentBoss = this.spawnValidatedBoss(
            event.payload.level,
            members.length,
          );
          pendingBossLevel = undefined;
          return;
        }
        case "passiveRegen": {
          for (const member of members) {
            if (member.currentHitpoints <= 0) {
              continue;
            }
            const hpRequested = policies.passiveRegen.calculateTick(
              member.maxHitpoints,
              member.passiveHpRegenPerTenSeconds,
            );
            const mpRequested = policies.passiveRegen.calculateTick(
              member.maxManapoints,
              member.passiveMpRegenPerTenSeconds,
            );
            const hpGained = restoreUpToMaximum(
              member,
              "currentHitpoints",
              "maxHitpoints",
              hpRequested,
            );
            const mpGained = restoreUpToMaximum(
              member,
              "currentManapoints",
              "maxManapoints",
              mpRequested,
            );
            stats.recordPassiveRegen(member.memberId, hpGained, mpGained);
          }
          const nextTickNs = event.timeNs + PASSIVE_REGEN_INTERVAL_NS;
          if (nextTickNs <= deadlineNs) {
            eventLoop.schedule({
              timeNs: nextTickNs,
              priority: PRIORITY_REGEN,
              kind: "passiveRegen",
              payload: { type: "passiveRegen" },
            });
          }
          return;
        }
        case "memberAttack": {
          const member = memberById.get(event.payload.memberId);
          if (member === undefined) {
            throw new Error(`unknown member event: ${event.payload.memberId}`);
          }
          if (member.currentHitpoints > 0 && currentBoss !== undefined) {
            const action = this.combatPort.nextAction(
              member,
              currentBoss,
              random,
              event.timeNs / 1_000_000,
            );
            validateAction(action.damage, action.manaCost);
            if (member.currentManapoints < action.manaCost) {
              stats.recordOomFailure(member.memberId, event.timeNs);
            } else {
              member.currentManapoints -= action.manaCost;
              stats.recordManaAvailable(member.memberId, event.timeNs);
              const effectiveDamage = Math.min(
                action.damage,
                currentBoss.currentHitpoints,
              );
              currentBoss.currentHitpoints -= effectiveDamage;
              stats.recordDamageDealt(member.memberId, effectiveDamage);

              if (currentBoss.currentHitpoints === 0) {
                const killedLevel = currentBoss.level;
                lastClearedBoss = currentBoss;
                waveKills.push({
                  level: killedLevel,
                  killedAtMs: event.timeNs / 1_000_000,
                });
                currentBoss = undefined;
                if (killedLevel >= request.rules.maxMonsterLevel) {
                  maximumLevelCleared = true;
                  pendingBossLevel = undefined;
                  return;
                }
                const nextLevel =
                  killedLevel + request.rules.levelStepOnKill;
                pendingBossLevel = nextLevel;
                const spawnTimeNs =
                  event.timeNs +
                  millisecondsToNanoseconds(request.rules.spawnDelayMs);
                if (spawnTimeNs <= deadlineNs) {
                  eventLoop.schedule({
                    timeNs: spawnTimeNs,
                    priority: PRIORITY_SPAWN,
                    kind: "spawnBoss",
                    payload: { type: "spawnBoss", level: nextLevel },
                  });
                }
              }
            }
          }

          const nextAttackNs =
            event.timeNs + millisecondsToNanoseconds(member.attackIntervalMs);
          if (nextAttackNs <= deadlineNs) {
            eventLoop.schedule({
              timeNs: nextAttackNs,
              priority: PRIORITY_MEMBER_ACTION,
              kind: "memberAttack",
              payload: {
                type: "memberAttack",
                memberId: member.memberId,
              },
            });
          }
          return;
        }
      }
    };

    const loopResult = eventLoop.runUntil(deadlineNs, processEvent);
    const memberResults = stats.snapshots(deadlineNs, memberIds).map(
      (member): TrialMemberRunResult => member,
    );
    const finalBoss =
      currentBoss ??
      (maximumLevelCleared && lastClearedBoss !== undefined
        ? lastClearedBoss
        : this.spawnValidatedBoss(
            pendingBossLevel ??
              request.rules.startMonsterLevel +
                waveKills.length * request.rules.levelStepOnKill,
            members.length,
          ));

    return {
      seed: request.seed,
      elapsedMs: request.rules.durationMs,
      participantCount: members.length,
      monsterHpMultiplier:
        1 + members.length * request.rules.monsterHpPerParticipant,
      processedEvents: loopResult.processedEvents,
      ...(loopResult.lastProcessedEventTimeNs === undefined
        ? {}
        : {
            lastProcessedEventAtMs:
              loopResult.lastProcessedEventTimeNs / 1_000_000,
          }),
      wavesCleared: waveKills.length,
      finalMonsterLevel: finalBoss.level,
      finalMonsterHp: maximumLevelCleared ? 0 : finalBoss.currentHitpoints,
      finalMonsterMaxHp: finalBoss.maxHitpoints,
      awaitingMonsterSpawn:
        !maximumLevelCleared && currentBoss === undefined,
      maximumLevelCleared,
      combatBasePoints: combatTrialBasePoints(waveKills.length),
      waveKills,
      members: memberResults,
      consumableUses: 0,
      assumptionWarnings: [...(request.assumptionWarnings ?? [])],
    };
  }

  private initializeMembers(inputs: readonly TMemberInput[]): RuntimeMemberState[] {
    const members = inputs.map((input) => this.combatPort.initialize(input));
    const memberIds = new Set<string>();
    for (const member of members) {
      if (memberIds.has(member.memberId)) {
        throw new Error(`duplicate memberId: ${member.memberId}`);
      }
      memberIds.add(member.memberId);
      validateMember(member);
    }
    return members;
  }

  private spawnValidatedBoss(
    level: number,
    participantCount: number,
  ): BossState {
    const boss = this.bossFactory.spawn(level);
    if (
      boss.level !== level ||
      boss.monsterId.trim().length === 0 ||
      !Number.isFinite(boss.maxHitpoints) ||
      boss.maxHitpoints <= 0 ||
      boss.currentHitpoints !== boss.maxHitpoints
    ) {
      throw new Error("boss factory returned an invalid fresh boss");
    }
    if (
      !Number.isSafeInteger(participantCount) ||
      participantCount < 1
    ) {
      throw new RangeError("guild trial requires at least one participant");
    }
    const multiplier =
      1 + participantCount * GUILD_TRIAL_MONSTER_HP_PER_PARTICIPANT;
    const maxHitpoints = Math.floor(boss.maxHitpoints * multiplier);
    return {
      ...boss,
      maxHitpoints,
      currentHitpoints: maxHitpoints,
    };
  }
}

function validateMember(member: RuntimeMemberState): void {
  if (member.memberId.trim().length === 0) {
    throw new Error("memberId must not be empty");
  }
  if (
    !Number.isSafeInteger(member.attackIntervalMs) ||
    member.attackIntervalMs <= 0
  ) {
    throw new RangeError("attack interval must be a positive integer");
  }
  if (
    member.maxHitpoints < 0 ||
    member.maxManapoints < 0 ||
    member.currentHitpoints < 0 ||
    member.currentHitpoints > member.maxHitpoints ||
    member.currentManapoints < 0 ||
    member.currentManapoints > member.maxManapoints
  ) {
    throw new RangeError("member HP/MP state is outside its valid range");
  }
}

function validateAction(damage: number, manaCost: number): void {
  if (
    !Number.isFinite(damage) ||
    damage < 0 ||
    !Number.isFinite(manaCost) ||
    manaCost < 0
  ) {
    throw new RangeError("combat actions require non-negative finite values");
  }
}

function restoreUpToMaximum(
  member: RuntimeMemberState,
  currentKey: "currentHitpoints" | "currentManapoints",
  maximumKey: "maxHitpoints" | "maxManapoints",
  requested: number,
): number {
  const before = member[currentKey];
  member[currentKey] = Math.min(member[maximumKey], before + requested);
  return member[currentKey] - before;
}
