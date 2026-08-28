import { assertNonNegativeSafeInteger } from "./time.ts";

export interface EventToken {
  readonly id: number;
}

export interface ScheduledEvent<
  TKind extends string = string,
  TPayload = unknown,
> {
  readonly token: EventToken;
  readonly timeNs: number;
  readonly priority: number;
  readonly sequence: number;
  readonly kind: TKind;
  readonly payload: TPayload;
}

export interface EventInput<TKind extends string, TPayload> {
  readonly timeNs: number;
  readonly priority?: number;
  readonly kind: TKind;
  readonly payload: TPayload;
}

function compareEvents(
  left: ScheduledEvent,
  right: ScheduledEvent,
): number {
  if (left.timeNs !== right.timeNs) {
    return left.timeNs - right.timeNs;
  }
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }
  return left.sequence - right.sequence;
}

/**
 * Stable binary min-heap.
 *
 * Cancellation is lazy: cancelling an event is O(1), and cancelled roots are
 * discarded when peeking or popping. This avoids the upstream implementation's
 * repeated heap-to-array scans and arbitrary `heap.remove` calls.
 */
export class StableEventQueue<
  TKind extends string = string,
  TPayload = unknown,
> {
  private readonly heap: Array<ScheduledEvent<TKind, TPayload>> = [];
  private readonly cancelledTokenIds = new Set<number>();
  private nextSequence = 0;
  private nextTokenId = 1;

  get size(): number {
    this.discardCancelledRoots();
    return this.heap.length;
  }

  schedule(input: EventInput<TKind, TPayload>): EventToken {
    assertNonNegativeSafeInteger(input.timeNs, "event.timeNs");
    const priority = input.priority ?? 0;
    if (!Number.isSafeInteger(priority)) {
      throw new RangeError("event.priority must be a safe integer");
    }

    const token = { id: this.nextTokenId++ };
    const event: ScheduledEvent<TKind, TPayload> = {
      token,
      timeNs: input.timeNs,
      priority,
      sequence: this.nextSequence++,
      kind: input.kind,
      payload: input.payload,
    };
    this.heap.push(event);
    this.siftUp(this.heap.length - 1);
    return token;
  }

  cancel(token: EventToken): boolean {
    if (!Number.isSafeInteger(token.id) || token.id <= 0) {
      return false;
    }
    this.cancelledTokenIds.add(token.id);
    return true;
  }

  peek(): ScheduledEvent<TKind, TPayload> | undefined {
    this.discardCancelledRoots();
    return this.heap[0];
  }

  pop(): ScheduledEvent<TKind, TPayload> | undefined {
    this.discardCancelledRoots();
    const result = this.removeRoot();
    this.discardCancelledRoots();
    return result;
  }

  clear(): void {
    this.heap.length = 0;
    this.cancelledTokenIds.clear();
  }

  private discardCancelledRoots(): void {
    while (
      this.heap[0] !== undefined &&
      this.cancelledTokenIds.has(this.heap[0].token.id)
    ) {
      const removed = this.removeRoot();
      if (removed !== undefined) {
        this.cancelledTokenIds.delete(removed.token.id);
      }
    }
  }

  private removeRoot(): ScheduledEvent<TKind, TPayload> | undefined {
    const root = this.heap[0];
    const tail = this.heap.pop();
    if (root === undefined) {
      return undefined;
    }
    if (this.heap.length > 0 && tail !== undefined) {
      this.heap[0] = tail;
      this.siftDown(0);
    }
    return root;
  }

  private siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];
      const current = this.heap[index];
      if (
        parent === undefined ||
        current === undefined ||
        compareEvents(parent, current) <= 0
      ) {
        return;
      }
      this.heap[parentIndex] = current;
      this.heap[index] = parent;
      index = parentIndex;
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;

      const current = this.heap[smallestIndex];
      const left = this.heap[leftIndex];
      if (
        current !== undefined &&
        left !== undefined &&
        compareEvents(left, current) < 0
      ) {
        smallestIndex = leftIndex;
      }

      const smallest = this.heap[smallestIndex];
      const right = this.heap[rightIndex];
      if (
        smallest !== undefined &&
        right !== undefined &&
        compareEvents(right, smallest) < 0
      ) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === index) {
        return;
      }
      const next = this.heap[smallestIndex];
      const original = this.heap[index];
      if (next === undefined || original === undefined) {
        throw new Error("event queue heap invariant violated");
      }
      this.heap[index] = next;
      this.heap[smallestIndex] = original;
      index = smallestIndex;
    }
  }
}
