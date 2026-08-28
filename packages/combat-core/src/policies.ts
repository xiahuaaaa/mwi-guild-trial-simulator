export interface ConsumableDescriptor {
  readonly id: string;
  readonly hitpointsRestored?: number;
  readonly manapointsRestored?: number;
  readonly hasCombatBuff?: boolean;
}

export interface ConsumablePolicy {
  readonly mode: "disabled" | "restorative-disabled" | "enabled";
  permits(consumable: ConsumableDescriptor): boolean;
}

export class DisabledConsumablePolicy implements ConsumablePolicy {
  readonly mode = "disabled" as const;

  permits(_consumable: ConsumableDescriptor): boolean {
    return false;
  }
}

export type RegenRoundingOrder =
  | "multiply-before-floor"
  | "floor-before-multiply";

export interface PassiveRegenPolicyOptions {
  readonly multiplier?: number;
  readonly flatBonus?: number;
  readonly roundingOrder: RegenRoundingOrder;
}

/**
 * Applies only to the passive 10-second HP/MP regeneration path.
 *
 * Active healing, lifesteal and mana leech deliberately do not pass through
 * this policy.
 */
export class PassiveRegenPolicy {
  readonly multiplier: number;
  readonly flatBonus: number;
  readonly roundingOrder: RegenRoundingOrder;

  constructor(options: PassiveRegenPolicyOptions) {
    const multiplier = options.multiplier ?? 1;
    const flatBonus = options.flatBonus ?? 0;
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      throw new RangeError("passive regen multiplier must be non-negative");
    }
    if (!Number.isFinite(flatBonus) || flatBonus < 0) {
      throw new RangeError("passive regen flat bonus must be non-negative");
    }
    this.multiplier = multiplier;
    this.flatBonus = flatBonus;
    this.roundingOrder = options.roundingOrder;
  }

  calculateTick(maximum: number, regenPerTenSeconds: number): number {
    if (!Number.isFinite(maximum) || maximum < 0) {
      throw new RangeError("regen maximum must be non-negative");
    }
    if (!Number.isFinite(regenPerTenSeconds) || regenPerTenSeconds < 0) {
      throw new RangeError("regen rate must be non-negative");
    }

    if (this.roundingOrder === "multiply-before-floor") {
      return Math.floor(
        maximum * (regenPerTenSeconds * this.multiplier + this.flatBonus),
      );
    }
    return (
      Math.floor(maximum * regenPerTenSeconds) * this.multiplier +
      Math.floor(maximum * this.flatBonus)
    );
  }
}
