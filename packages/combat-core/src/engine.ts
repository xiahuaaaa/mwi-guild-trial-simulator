import {
  type EventInput,
  type EventToken,
  type ScheduledEvent,
  StableEventQueue,
} from "./event-queue.ts";
import { assertNonNegativeSafeInteger } from "./time.ts";

export interface EventProcessingContext<
  TKind extends string,
  TPayload,
> {
  readonly nowNs: number;
  schedule(input: EventInput<TKind, TPayload>): EventToken;
  cancel(token: EventToken): boolean;
}

export interface EventLoopResult {
  readonly deadlineNs: number;
  readonly processedEvents: number;
  readonly pendingEvents: number;
  readonly lastProcessedEventTimeNs?: number;
}

export type EventProcessor<TKind extends string, TPayload> = (
  event: ScheduledEvent<TKind, TPayload>,
  context: EventProcessingContext<TKind, TPayload>,
) => void;

export class DeterministicEventLoop<
  TKind extends string = string,
  TPayload = unknown,
> {
  readonly queue = new StableEventQueue<TKind, TPayload>();
  private currentTimeNs = 0;

  get nowNs(): number {
    return this.currentTimeNs;
  }

  schedule(input: EventInput<TKind, TPayload>): EventToken {
    if (input.timeNs < this.currentTimeNs) {
      throw new RangeError("cannot schedule an event before the current time");
    }
    return this.queue.schedule(input);
  }

  cancel(token: EventToken): boolean {
    return this.queue.cancel(token);
  }

  runUntil(
    deadlineNs: number,
    processor: EventProcessor<TKind, TPayload>,
  ): EventLoopResult {
    assertNonNegativeSafeInteger(deadlineNs, "deadlineNs");
    if (deadlineNs < this.currentTimeNs) {
      throw new RangeError("deadline cannot be before the current time");
    }

    let processedEvents = 0;
    let lastProcessedEventTimeNs: number | undefined;
    while (true) {
      const nextEvent = this.queue.peek();
      if (nextEvent === undefined || nextEvent.timeNs > deadlineNs) {
        break;
      }

      const event = this.queue.pop();
      if (event === undefined) {
        break;
      }
      this.currentTimeNs = event.timeNs;
      const context: EventProcessingContext<TKind, TPayload> = {
        nowNs: this.currentTimeNs,
        schedule: (input) => this.schedule(input),
        cancel: (token) => this.cancel(token),
      };
      processor(event, context);
      processedEvents += 1;
      lastProcessedEventTimeNs = event.timeNs;
    }

    // Results are finalized at the exact scenario boundary even if the queue
    // has no event at that timestamp.
    this.currentTimeNs = deadlineNs;
    return {
      deadlineNs,
      processedEvents,
      pendingEvents: this.queue.size,
      ...(lastProcessedEventTimeNs === undefined
        ? {}
        : { lastProcessedEventTimeNs }),
    };
  }
}
