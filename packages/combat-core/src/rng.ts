export interface RandomSource {
  readonly seed: number;
  nextUint32(): number;
  nextFloat(): number;
  nextIntInclusive(minimum: number, maximum: number): number;
}

/**
 * A small deterministic PRNG with fully specified uint32 arithmetic.
 *
 * Mulberry32 is not cryptographically secure. It is used because battle
 * simulation needs reproducibility, not secrets. The implementation avoids
 * engine-specific floating-point state and produces the same sequence in all
 * conforming JavaScript runtimes.
 */
export class Mulberry32Random implements RandomSource {
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError("seed must be a safe integer");
    }
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  nextIntInclusive(minimum: number, maximum: number): number {
    if (
      !Number.isSafeInteger(minimum) ||
      !Number.isSafeInteger(maximum) ||
      maximum < minimum
    ) {
      throw new RangeError("random integer bounds must be ordered safe integers");
    }
    const span = maximum - minimum + 1;
    if (!Number.isSafeInteger(span) || span <= 0 || span > 0x1_0000_0000) {
      throw new RangeError("random integer span must be between 1 and 2^32");
    }
    return minimum + Math.floor(this.nextFloat() * span);
  }
}
