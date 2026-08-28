import { asRecord, cleanString } from "./normalize.ts";
import type { MemberCapabilitySnapshotV2 } from "./model.ts";

export interface MemberSnapshotValidation {
  ok: boolean;
  errors: string[];
  value?: MemberCapabilitySnapshotV2;
}

const SENSITIVE_KEY = /token|authorization|cookie|secret|password|credential|session|gm_/i;
const CONSUMABLE = /food|drink|consumable|potion/i;

export function validateMemberCapabilitySnapshot(
  input: unknown,
): MemberSnapshotValidation {
  const value = asRecord(input);
  const errors: string[] = [];
  if (value.schemaVersion !== "2") errors.push("schemaVersion must be \"2\"");
  for (const field of ["memberId", "displayName", "guildId", "capturedAt"]) {
    if (!cleanString(value[field])) errors.push(`${field} is required`);
  }
  if (containsSensitiveKey(value)) errors.push("sensitive token-like field is forbidden");
  const builds = Array.isArray(value.approvedBuilds) ? value.approvedBuilds : [];
  if (builds.length > 4) errors.push("approvedBuilds must contain at most four builds");
  const loadoutCatalog = Array.isArray(value.loadoutCatalog) ? value.loadoutCatalog : [];
  if (loadoutCatalog.length > 64) errors.push("loadoutCatalog must contain at most 64 loadouts");
  loadoutCatalog.forEach((raw, index) => {
    const loadout = asRecord(raw);
    if (!["combat", "profession", "unknown"].includes(String(loadout.category))) {
      errors.push(`loadoutCatalog[${index}] has an invalid category`);
    }
    if (!cleanString(loadout.actionTypeHrid).startsWith("/action_types/")) {
      errors.push(`loadoutCatalog[${index}] has an invalid actionTypeHrid`);
    }
    if (!Array.isArray(loadout.equipment) || loadout.equipment.length > 20) {
      errors.push(`loadoutCatalog[${index}] has invalid equipment`);
    }
    if (!Array.isArray(loadout.abilities) || loadout.abilities.length > 5) {
      errors.push(`loadoutCatalog[${index}] has invalid abilities`);
    }
  });
  builds.forEach((raw, index) => {
    const build = asRecord(raw);
    if (build.approvedByMember !== true) {
      errors.push(`approvedBuilds[${index}] is not member-approved`);
    }
    const equipment = Array.isArray(build.equipment) ? build.equipment : [];
    const abilities = Array.isArray(build.abilities) ? build.abilities : [];
    if (!equipment.length) errors.push(`approvedBuilds[${index}] has no equipment`);
    if (!abilities.length || abilities.length > 5) {
      errors.push(`approvedBuilds[${index}] must contain one to five abilities`);
    }
    if (CONSUMABLE.test(JSON.stringify({ equipment, abilities }))) {
      errors.push(`approvedBuilds[${index}] contains a consumable path`);
    }
  });
  return {
    ok: errors.length === 0,
    errors,
    ...(errors.length ? {} : { value: input as MemberCapabilitySnapshotV2 }),
  };
}

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => SENSITIVE_KEY.test(key) || containsSensitiveKey(child),
  );
}
