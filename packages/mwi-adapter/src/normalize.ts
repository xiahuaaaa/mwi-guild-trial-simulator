import type {
  AdapterOptions,
  ApprovedCombatBuild,
  CombatAbility,
  CombatTrigger,
  EquipmentItem,
  SnapshotFreshness,
} from "./model.ts";

export const ADAPTER_VERSION = "0.1.0";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function cleanString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return "";
}

export function finiteInteger(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, Math.trunc(result)) : fallback;
}

export function normalizedLevelMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};

  if (Array.isArray(value)) {
    for (const entry of value) {
      const row = asRecord(entry);
      const hrid = cleanString(
        row.hrid
        ?? row.skillHrid
        ?? row.skill_hrid
        ?? row.abilityHrid
        ?? row.ability_hrid,
      );
      if (!hrid) continue;
      result[hrid] = Math.max(result[hrid] ?? 0, finiteInteger(row.level));
    }
    return result;
  }

  for (const [hrid, raw] of Object.entries(asRecord(value))) {
    if (!hrid.startsWith("/")) continue;
    const row = asRecord(raw);
    result[hrid] = finiteInteger(row.level ?? raw);
  }
  return result;
}

export function normalizedBooleanMap(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [hrid, raw] of Object.entries(asRecord(value))) {
    if (hrid.startsWith("/")) result[hrid] = Boolean(asRecord(raw).completed ?? raw);
  }
  return result;
}

export function normalizedEquipment(value: unknown): EquipmentItem[] {
  const byLocation = new Map<string, EquipmentItem>();
  for (const entry of asArray(value)) {
    const row = asRecord(entry);
    const locationHrid = cleanString(
      row.locationHrid
      ?? row.itemLocationHrid
      ?? row.slot
      ?? row.location_hrid,
    );
    const itemHrid = cleanString(row.itemHrid ?? row.item_hrid);
    if (!locationHrid || !itemHrid) continue;
    if (locationHrid === "/item_locations/inventory") continue;
    byLocation.set(locationHrid, {
      locationHrid,
      itemHrid,
      enhancementLevel: finiteInteger(
        row.enhancementLevel
        ?? row.enhancement_level,
      ),
    });
  }
  return [...byLocation.values()].sort(
    (left, right) => left.locationHrid.localeCompare(right.locationHrid),
  );
}

function normalizedTriggers(value: unknown): CombatTrigger[] {
  return asArray(value).flatMap((entry) => {
    const row = asRecord(entry);
    const trigger: CombatTrigger = {
      dependencyHrid: cleanString(
        row.dependencyHrid
        ?? row.combatTriggerDependencyHrid
        ?? row.dependency_hrid,
      ),
      conditionHrid: cleanString(
        row.conditionHrid
        ?? row.combatTriggerConditionHrid
        ?? row.condition_hrid,
      ),
      comparatorHrid: cleanString(
        row.comparatorHrid
        ?? row.combatTriggerComparatorHrid
        ?? row.comparator_hrid,
      ),
      value: Number(row.value ?? 0),
    };
    return trigger.dependencyHrid
      && trigger.conditionHrid
      && trigger.comparatorHrid
      && Number.isFinite(trigger.value)
      ? [trigger]
      : [];
  }).slice(0, 16);
}

export function normalizedSlottedAbilities(value: unknown): CombatAbility[] {
  return asArray(value)
    .slice(0, 5)
    .flatMap((entry, index) => {
      const row = asRecord(entry);
      const abilityHrid = cleanString(row.abilityHrid ?? row.ability_hrid);
      if (!abilityHrid) return [];
      return [{
        slot: finiteInteger(row.slot, index),
        abilityHrid,
        level: Math.max(1, finiteInteger(row.level, 1)),
        triggers: normalizedTriggers(
          row.triggers
          ?? row.combatTriggers
          ?? row.combat_triggers,
        ),
      }];
    })
    .sort((left, right) => left.slot - right.slot);
}

export function buildFromParts(input: {
  buildId: string;
  sourceLoadoutId?: number;
  name: string;
  approvedByMember: boolean;
  capturedAt: string;
  equipment: unknown;
  abilities: unknown;
}): ApprovedCombatBuild {
  const equipment = normalizedEquipment(input.equipment);
  const abilities = normalizedSlottedAbilities(input.abilities);
  const issues: string[] = [];
  if (!equipment.length) issues.push("missing-equipment");
  if (!abilities.length) issues.push("missing-build-abilities");
  const weapon = equipment.find((item) =>
    item.locationHrid.endsWith("/main_hand")
    || item.locationHrid.endsWith("/two_hand")
  );
  if (!weapon) issues.push("missing-weapon");

  return {
    buildId: input.buildId,
    ...(input.sourceLoadoutId == null ? {} : { sourceLoadoutId: input.sourceLoadoutId }),
    name: input.name || input.buildId,
    approvedByMember: input.approvedByMember,
    capturedAt: input.capturedAt,
    equipment,
    abilities,
    ...(weapon ? { weapon } : {}),
    simulationReady: issues.length === 0,
    issues,
  };
}

export function capturedAt(value: unknown, options: AdapterOptions): string {
  const candidate = cleanString(value) || cleanString(options.capturedAt);
  const date = candidate ? new Date(candidate) : new Date(options.now ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function freshnessFor(
  capturedAtValue: string,
  options: AdapterOptions,
): SnapshotFreshness {
  const timestamp = new Date(capturedAtValue).getTime();
  const now = new Date(options.now ?? Date.now()).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(now) || timestamp <= 0) return "expired";
  const ageDays = Math.max(0, now - timestamp) / 86_400_000;
  if (ageDays <= 7) return "fresh";
  if (ageDays <= 30) return "stale";
  return "expired";
}

export function participationFrom(
  eligibleBossHrids: string[],
  options: AdapterOptions,
) {
  return {
    eligibleBossHrids: uniqueHrids(
      options.eligibleBossHrids?.length
        ? options.eligibleBossHrids
        : eligibleBossHrids,
    ),
    preferredBossHrids: uniqueHrids(options.preferredBossHrids ?? []),
    maxBossAssignments: Math.max(0, Math.min(2, options.maxBossAssignments ?? 1)),
    allowRoleChange: options.allowRoleChange ?? true,
    allowSkillChange: options.allowSkillChange ?? true,
  };
}

function uniqueHrids(values: string[]): string[] {
  return [...new Set(values.map(cleanString).filter((value) => value.startsWith("/")))];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !/token|authorization|secret/i.test(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function sourceFingerprint(value: unknown): string {
  const text = JSON.stringify(stableValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
