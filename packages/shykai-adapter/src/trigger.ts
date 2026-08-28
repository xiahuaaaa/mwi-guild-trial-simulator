import type { ShykaiTriggerDto } from "./dto.ts";

export interface TriggerUnitView {
  readonly currentHitpoints: number;
  readonly maxHitpoints: number;
  readonly currentManapoints: number;
  readonly maxManapoints: number;
  readonly isStunned: boolean;
  readonly isBlinded: boolean;
  readonly isSilenced: boolean;
  readonly stunExpireTime: number | null;
  readonly blindExpireTime: number | null;
  readonly silenceExpireTime: number | null;
}

export function compareShykaiTriggerValue(
  comparatorHrid: string,
  dependencyValue: unknown,
  expectedValue: number,
): boolean {
  switch (comparatorHrid) {
    case "/combat_trigger_comparators/greater_than_equal":
      return Number(dependencyValue) >= expectedValue;
    case "/combat_trigger_comparators/less_than_equal":
      return Number(dependencyValue) <= expectedValue;
    case "/combat_trigger_comparators/is_active":
      return Boolean(dependencyValue);
    case "/combat_trigger_comparators/is_inactive":
      return !dependencyValue;
    default:
      throw new Error(`unsupported Shykai trigger comparator: ${comparatorHrid}`);
  }
}

export function getShykaiTriggerDependencyValue(
  conditionHrid: string,
  unit: TriggerUnitView,
  currentTime: number,
): number | boolean {
  switch (conditionHrid) {
    case "/combat_trigger_conditions/current_hp":
      return unit.currentHitpoints;
    case "/combat_trigger_conditions/current_mp":
      return unit.currentManapoints;
    case "/combat_trigger_conditions/missing_hp":
      return unit.maxHitpoints - unit.currentHitpoints;
    case "/combat_trigger_conditions/missing_mp":
      return unit.maxManapoints - unit.currentManapoints;
    case "/combat_trigger_conditions/stun_status":
      return unit.isStunned || unit.stunExpireTime === currentTime;
    case "/combat_trigger_conditions/blind_status":
      return unit.isBlinded || unit.blindExpireTime === currentTime;
    case "/combat_trigger_conditions/silence_status":
      return unit.isSilenced || unit.silenceExpireTime === currentTime;
    default:
      throw new Error(`unsupported Shykai trigger condition: ${conditionHrid}`);
  }
}

export function evaluateShykaiSingleTargetTrigger(
  trigger: ShykaiTriggerDto,
  unit: TriggerUnitView,
  currentTime: number,
): boolean {
  return compareShykaiTriggerValue(
    trigger.comparatorHrid,
    getShykaiTriggerDependencyValue(
      trigger.conditionHrid,
      unit,
      currentTime,
    ),
    trigger.value,
  );
}

export function countActiveUnits(units: readonly TriggerUnitView[]): number {
  return units.filter((unit) => unit.currentHitpoints > 0).length;
}

export function countDeadUnits(units: readonly TriggerUnitView[]): number {
  return units.filter((unit) => unit.currentHitpoints <= 0).length;
}

export function lowestAliveHitpointPercentage(
  units: readonly TriggerUnitView[],
): number {
  return (
    units
      .filter((unit) => unit.currentHitpoints > 0)
      .reduce((previous, current) => {
        const percentage =
          current.currentHitpoints / current.maxHitpoints;
        return percentage < previous ? percentage : previous;
      }, 2) * 100
  );
}
