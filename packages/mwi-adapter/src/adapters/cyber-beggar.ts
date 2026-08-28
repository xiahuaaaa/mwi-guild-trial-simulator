import type {
  AdapterOptions,
  MemberCapabilitySnapshotV2,
} from "../model.ts";
import {
  ADAPTER_VERSION,
  asRecord,
  buildFromParts,
  capturedAt,
  cleanString,
  freshnessFor,
  normalizedLevelMap,
  participationFrom,
  sourceFingerprint,
} from "../normalize.ts";

export function adaptCyberBeggar(
  input: unknown,
  options: AdapterOptions = {},
): MemberCapabilitySnapshotV2 {
  const payload = asRecord(input);
  const character = asRecord(payload.character);
  const guild = asRecord(payload.guild);
  const captured = capturedAt(payload.capturedAt, options);
  const issues = [
    "source-does-not-identify-five-slotted-abilities",
    "source-does-not-provide-combat-trigger-loadout",
  ];
  const currentBuild = buildFromParts({
    buildId: "current",
    name: "Uploaded current equipment",
    approvedByMember: false,
    capturedAt: captured,
    equipment: payload.equipment,
    abilities: [],
  });

  const memberId = cleanString(character.id ?? character.characterId);
  const displayName = cleanString(character.name ?? character.characterName);
  const guildId = cleanString(guild.id ?? character.guildId);
  if (!memberId) issues.push("missing-member-id");
  if (!displayName) issues.push("missing-display-name");
  if (!guildId) issues.push("missing-guild-id");

  return {
    schemaVersion: "2",
    memberId,
    displayName,
    guildId,
    capturedAt: captured,
    source: "cyber-beggar",
    sourceSchemaVersion: cleanString(payload.schemaVersion) || "1",
    sourceRevision: `${cleanString(payload.scriptVersion) || "unknown"}+adapter.${ADAPTER_VERSION}`,
    sourceFingerprint: sourceFingerprint(input),
    freshness: freshnessFor(captured, options),
    confidence: currentBuild.equipment.length
      ? "current-loadout-only"
      : "capability-only",
    skills: normalizedLevelMap(payload.skills),
    learnedAbilities: normalizedLevelMap(payload.abilities),
    auras: Object.fromEntries(
      Object.entries(normalizedLevelMap(payload.abilities))
        .filter(([hrid]) => hrid.endsWith("_aura")),
    ),
    houseRooms: normalizedLevelMap(payload.houseRooms),
    approvedBuilds: [],
    ...(currentBuild.equipment.length ? { currentBuild } : {}),
    participation: participationFrom([], options),
    issues,
  };
}
