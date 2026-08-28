import type {
  AdapterOptions,
  EquipmentItem,
  MemberCapabilitySnapshotV2,
} from "../model.ts";
import {
  ADAPTER_VERSION,
  asRecord,
  buildFromParts,
  capturedAt,
  cleanString,
  finiteInteger,
  freshnessFor,
  normalizedLevelMap,
  participationFrom,
  sourceFingerprint,
} from "../normalize.ts";

export function adaptTys(
  input: unknown,
  options: AdapterOptions = {},
): MemberCapabilitySnapshotV2 {
  const payload = asRecord(input);
  const reporter = asRecord(payload.reporter);
  const guild = asRecord(payload.guild);
  const week = asRecord(payload.week);
  const capability = asRecord(payload.capability);
  const weapon = asRecord(capability.combat_weapon);
  const captured = capturedAt(payload.captured_at, options);
  const weaponHrid = cleanString(weapon.item_hrid ?? weapon.itemHrid);
  const equipment: EquipmentItem[] = weaponHrid
    ? [{
        locationHrid: "/item_locations/equipment/two_hand",
        itemHrid: weaponHrid,
        enhancementLevel: finiteInteger(
          weapon.enhancement_level
          ?? weapon.enhancementLevel,
        ),
      }]
    : [];
  const currentBuild = buildFromParts({
    buildId: "capability-weapon",
    name: "TYS reported weapon",
    approvedByMember: false,
    capturedAt: captured,
    equipment,
    abilities: [],
  });
  const auraLevels = normalizedLevelMap(capability.aura_abilities);
  const issues = [
    "capability-summary-only",
    "missing-full-equipment",
    "missing-build-abilities",
    "missing-combat-triggers",
  ];

  return {
    schemaVersion: "2",
    memberId: cleanString(reporter.player_id ?? capability.player_id),
    displayName: cleanString(reporter.display_name),
    guildId: cleanString(guild.id),
    capturedAt: captured,
    source: "tys",
    sourceSchemaVersion: cleanString(payload.schema_version) || "3",
    sourceRevision: `${cleanString(payload.client_revision) || "unknown"}+adapter.${ADAPTER_VERSION}`,
    sourceFingerprint: sourceFingerprint(input),
    freshness: freshnessFor(captured, options),
    confidence: "capability-only",
    skills: normalizedLevelMap(capability.skills),
    learnedAbilities: auraLevels,
    auras: auraLevels,
    approvedBuilds: [],
    ...(equipment.length ? { currentBuild } : {}),
    participation: participationFrom(
      Array.isArray(week.combat_trial_hrids)
        ? week.combat_trial_hrids.map(cleanString)
        : [],
      options,
    ),
    issues,
  };
}
