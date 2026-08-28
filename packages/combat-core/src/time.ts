export const NANOSECONDS_PER_MILLISECOND = 1_000_000;
export const NANOSECONDS_PER_SECOND = 1_000_000_000;

export function millisecondsToNanoseconds(milliseconds: number): number {
  assertNonNegativeSafeInteger(milliseconds, "milliseconds");
  const result = milliseconds * NANOSECONDS_PER_MILLISECOND;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("milliseconds cannot be represented safely as nanoseconds");
  }
  return result;
}

export function nanosecondsToMilliseconds(nanoseconds: number): number {
  assertNonNegativeSafeInteger(nanoseconds, "nanoseconds");
  return nanoseconds / NANOSECONDS_PER_MILLISECOND;
}

export function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
