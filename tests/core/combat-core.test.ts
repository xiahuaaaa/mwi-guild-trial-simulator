import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicEventLoop,
  DynamicMemberStatistics,
  Mulberry32Random,
  PassiveRegenPolicy,
  StableEventQueue,
} from "../../packages/combat-core/src/index.ts";

test("Mulberry32 has a pinned, cross-runtime sequence", () => {
  const random = new Mulberry32Random(123456789);
  assert.deepEqual(
    Array.from({ length: 5 }, () => random.nextUint32()),
    [1107202814, 4169434471, 3372958138, 885470128, 1301683845],
  );

  const first = new Mulberry32Random(7);
  const second = new Mulberry32Random(7);
  const third = new Mulberry32Random(8);
  assert.deepEqual(
    Array.from({ length: 32 }, () => first.nextUint32()),
    Array.from({ length: 32 }, () => second.nextUint32()),
  );
  assert.notDeepEqual(
    Array.from({ length: 8 }, () => new Mulberry32Random(7).nextUint32()),
    Array.from({ length: 8 }, () => third.nextUint32()),
  );
});

test("stable event ordering is time, priority, then insertion sequence", () => {
  const queue = new StableEventQueue<"event", string>();
  queue.schedule({ timeNs: 10, priority: 20, kind: "event", payload: "late-priority" });
  queue.schedule({ timeNs: 10, priority: 10, kind: "event", payload: "first" });
  queue.schedule({ timeNs: 10, priority: 10, kind: "event", payload: "second" });
  queue.schedule({ timeNs: 9, priority: 99, kind: "event", payload: "earlier-time" });

  assert.deepEqual(
    Array.from({ length: 4 }, () => queue.pop()?.payload),
    ["earlier-time", "first", "second", "late-priority"],
  );
});

test("lazy cancellation does not scan or execute a cancelled event", () => {
  const queue = new StableEventQueue<"event", string>();
  const cancelled = queue.schedule({
    timeNs: 1,
    kind: "event",
    payload: "cancelled",
  });
  queue.schedule({ timeNs: 2, kind: "event", payload: "kept" });
  assert.equal(queue.cancel(cancelled), true);
  assert.equal(queue.pop()?.payload, "kept");
  assert.equal(queue.pop(), undefined);
});

test("event loop includes the deadline and never processes a later event", () => {
  const loop = new DeterministicEventLoop<"tick", number>();
  const processed: number[] = [];
  loop.schedule({ timeNs: 99, kind: "tick", payload: 99 });
  loop.schedule({ timeNs: 100, kind: "tick", payload: 100 });
  loop.schedule({ timeNs: 101, kind: "tick", payload: 101 });

  const result = loop.runUntil(100, (event) => {
    processed.push(event.payload);
  });

  assert.deepEqual(processed, [99, 100]);
  assert.equal(result.lastProcessedEventTimeNs, 100);
  assert.equal(result.pendingEvents, 1);
  assert.equal(loop.nowNs, 100);
});

test("member statistics are dynamic for 48 members and preserve OOM duration", () => {
  const memberIds = Array.from({ length: 48 }, (_, index) => `member-${index + 1}`);
  const stats = new DynamicMemberStatistics(memberIds);
  stats.recordDamageDealt("member-48", 3_600);
  stats.recordOomFailure("member-48", 1_000_000_000);
  stats.recordOomFailure("member-48", 2_000_000_000);
  stats.recordManaAvailable("member-48", 3_000_000_000);

  const snapshots = stats.snapshots(3_600_000_000_000, memberIds);
  assert.equal(snapshots.length, 48);
  const member = snapshots[47];
  assert.equal(member?.memberId, "member-48");
  assert.equal(member?.dps, 1);
  assert.equal(member?.oom, true);
  assert.equal(member?.oomEvents, 2);
  assert.equal(member?.firstOomAtMs, 1_000);
  assert.equal(member?.oomDurationMs, 2_000);
});

test("passive regen x4 is isolated and its rounding order is explicit", () => {
  const beforeFloor = new PassiveRegenPolicy({
    multiplier: 4,
    roundingOrder: "multiply-before-floor",
  });
  const afterFloor = new PassiveRegenPolicy({
    multiplier: 4,
    roundingOrder: "floor-before-multiply",
  });

  assert.equal(beforeFloor.calculateTick(101, 0.01), 4);
  assert.equal(afterFloor.calculateTick(101, 0.01), 4);
  assert.equal(beforeFloor.calculateTick(25, 0.01), 1);
  assert.equal(afterFloor.calculateTick(25, 0.01), 0);
});

test("guild trial recovery is an additive +3 percentage points", () => {
  const policy = new PassiveRegenPolicy({
    flatBonus: 0.03,
    roundingOrder: "multiply-before-floor",
  });

  assert.equal(policy.calculateTick(100, 0.01), 4);
  assert.equal(policy.calculateTick(100, 0.02), 5);
});
