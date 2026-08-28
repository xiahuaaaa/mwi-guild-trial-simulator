import type {
  AdapterOptions,
  MemberCapabilitySnapshotV2,
  SnapshotConfidence,
} from "../model.ts";
import {
  ADAPTER_VERSION,
  asArray,
  asRecord,
  buildFromParts,
  capturedAt,
  cleanString,
  finiteInteger,
  freshnessFor,
  normalizedBooleanMap,
  normalizedLevelMap,
  participationFrom,
  sourceFingerprint,
} from "../normalize.ts";

export function adaptWanderingEarth(
  input: unknown,
  options: AdapterOptions = {},
): MemberCapabilitySnapshotV2 {
  const envelope = asRecord(input);
  const snapshot = asRecord(envelope.snapshot ?? input);
  const character = asRecord(snapshot.character);
  const captured = capturedAt(snapshot.capturedAt, options);
  const issues: string[] = [];

  const currentBuild = buildFromParts({
    buildId: "current",
    name: "Current build",
    approvedByMember: false,
    capturedAt: captured,
    equipment: snapshot.equipment,
    abilities: snapshot.abilities,
  });

  const rawTrialBuilds = asArray(envelope.trialBuilds ?? envelope.trial_builds);
  const approvedBuilds = rawTrialBuilds.map((entry, index) => {
    const payload = asRecord(entry);
    const trialBuild = asRecord(payload.trialBuild ?? payload.trial_build ?? entry);
    const buildCapturedAt = capturedAt(payload.capturedAt ?? captured, options);
    const sourceLoadoutId = finiteInteger(
      trialBuild.loadoutId ?? trialBuild.loadout_id,
      0,
    );
    return buildFromParts({
      buildId: sourceLoadoutId ? `loadout:${sourceLoadoutId}` : `trial-build:${index + 1}`,
      ...(sourceLoadoutId ? { sourceLoadoutId } : {}),
      name: cleanString(trialBuild.name) || `Trial build ${index + 1}`,
      approvedByMember: true,
      capturedAt: buildCapturedAt,
      equipment: trialBuild.equipment,
      abilities: trialBuild.abilities,
    });
  });

  for (const build of approvedBuilds) {
    if (!build.simulationReady) {
      issues.push(`build:${build.buildId}:${build.issues.join(",")}`);
    }
  }

  const readyApproved = approvedBuilds.some((build) => build.simulationReady);
  const confidence: SnapshotConfidence = readyApproved
    ? "simulation-ready"
    : currentBuild.simulationReady
      ? "current-loadout-only"
      : "capability-only";

  const memberId = cleanString(
    character.characterId
    ?? character.character_id
    ?? character.id,
  );
  const displayName = cleanString(
    character.characterName
    ?? character.character_name
    ?? character.name,
  );
  const guildId = cleanString(character.guildId ?? character.guild_id);
  if (!memberId) issues.push("missing-member-id");
  if (!displayName) issues.push("missing-display-name");
  if (!guildId) issues.push("missing-guild-id");

  return {
    schemaVersion: "2",
    memberId,
    displayName,
    guildId,
    capturedAt: captured,
    source: "wandering-earth",
    sourceSchemaVersion: cleanString(snapshot.schemaVersion) || "1",
    sourceRevision: `${cleanString(snapshot.scriptVersion) || "unknown"}+adapter.${ADAPTER_VERSION}`,
    sourceFingerprint: sourceFingerprint(input),
    freshness: freshnessFor(captured, options),
    confidence,
    skills: normalizedLevelMap(snapshot.skills),
    learnedAbilities: normalizedLevelMap(snapshot.learnedAbilities),
    auras: normalizedLevelMap(snapshot.auras),
    houseRooms: normalizedLevelMap(
      approvedBuilds.length
        ? asRecord(rawTrialBuilds.at(-1)).houseRooms
        : snapshot.houseRooms,
    ),
    achievements: normalizedBooleanMap(
      approvedBuilds.length
        ? asRecord(rawTrialBuilds.at(-1)).achievements
        : snapshot.achievements,
    ),
    approvedBuilds,
    ...(currentBuild.equipment.length || currentBuild.abilities.length ? { currentBuild } : {}),
    participation: participationFrom([], options),
    issues,
  };
}
