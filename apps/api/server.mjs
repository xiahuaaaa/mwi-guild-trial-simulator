import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGuildRegistry, resolveRegisteredGuild } from "./guild-config.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_FIXTURE = resolve(ROOT, "fixtures/monsters/guild-trial-2026-07-24-jellyfish-hedgehog.json");
const DEFAULT_MEMBER_PLUGIN = resolve(ROOT, "userscripts/member-candidate-loadout-exporter.user.js");
/** Prefer reading report PNGs from the repo checkout; override with MWI_TEST_REPORT_DIR. */
const DEFAULT_TEST_REPORT_DIR = resolve(ROOT, "artifacts/test-report");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TEST_REPORT_BODY_BYTES = 12 * 1024 * 1024;
const TEST_REPORT_FILE_NAME = /^[12]-[a-z0-9-]+-(summary|members)\.png$/;
const SENSITIVE_KEY = /(?:token|authorization|cookie|secret|password|credential|session|gm_)/i;
const MEMBER_ID = /^[\p{L}\p{N}_.:-]{1,64}$/u;
const GUILD_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const COMBAT_TRIAL_NAMES = new Map([
  ["/guild_combat/badger", "试炼獾"],
  ["/guild_combat/chameleon", "试炼变色龙"],
  ["/guild_combat/jellyfish", "试炼水母"],
  ["/guild_combat/hedgehog", "试炼刺猬"],
  ["/guild_combat/swarm", "试炼虫群"],
]);
const SKILLING_TRIAL_NAMES = new Map([
  ["/guild_skilling/alchemy", "炼金"],
  ["/guild_skilling/brewing", "冲泡"],
  ["/guild_skilling/cheesesmithing", "奶酪锻造"],
  ["/guild_skilling/cooking", "烹饪"],
  ["/guild_skilling/crafting", "制作"],
  ["/guild_skilling/enhancing", "强化"],
  ["/guild_skilling/foraging", "采摘"],
  ["/guild_skilling/milking", "挤奶"],
  ["/guild_skilling/tailoring", "缝纫"],
  ["/guild_skilling/woodcutting", "伐木"],
]);
const COMBAT_TRIAL_ROLES = new Set([
  "",
  "any_role",
  "damage_dealer",
  "support",
  "tank",
]);

function trialKindForHrid(trialHrid) {
  if (COMBAT_TRIAL_NAMES.has(trialHrid)) return "combat";
  if (SKILLING_TRIAL_NAMES.has(trialHrid)) return "skilling";
  return null;
}

function trialDisplayName(trialHrid) {
  return COMBAT_TRIAL_NAMES.get(trialHrid) ?? SKILLING_TRIAL_NAMES.get(trialHrid) ?? trialHrid;
}

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function object(value, label = "body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(400, "invalid_json", `${label} must be an object`);
  return value;
}

function text(value, label, max = 256) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw fail(400, "invalid_field", `${label} must be a non-empty string`);
  return value.trim();
}

function integer(value, label, min = 0, max = 1000000) {
  if (!Number.isInteger(value) || value < min || value > max) throw fail(400, "invalid_field", `${label} must be an integer between ${min} and ${max}`);
  return value;
}

function optionalPositiveInteger(value, label, allowZero = false) {
  if (value == null || value === "") return null;
  const min = allowZero ? 0 : 1;
  return integer(value, label, min, 1000000);
}

function finiteNumber(value, label, min = -1000000000, max = 1000000000000000) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw fail(400, "invalid_field", `${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function ensureKeys(row, allowed, label) {
  for (const key of Object.keys(row)) {
    if (SENSITIVE_KEY.test(key)) throw fail(400, "sensitive_field_rejected", `${label}.${key} is not accepted`);
    if (!allowed.has(key)) throw fail(400, "unknown_field", `${label}.${key} is not accepted`);
  }
}

function safeId(value, label, pattern = MEMBER_ID) {
  const id = text(value, label, 128);
  if (!pattern.test(id)) throw fail(400, "invalid_field", `${label} contains unsupported characters`);
  return id;
}

function safeJson(value, label, maxBytes = 500000) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > maxBytes) throw fail(413, "payload_too_large", `${label} is too large`);
  return encoded;
}

function levelMap(value, label) {
  const row = object(value ?? {}, label);
  ensureKeys(row, new Set(Object.keys(row)), label);
  const result = {};
  for (const [hrid, level] of Object.entries(row)) {
    if (!hrid.startsWith("/") || hrid.length > 256) throw fail(400, "invalid_field", `${label} keys must be HRIDs`);
    result[hrid] = integer(typeof level === "object" && level ? level.level : level, `${label}.${hrid}`, 0, 10000);
  }
  return result;
}

function stringList(value, label, maxItems, itemMax = 256) {
  if (!Array.isArray(value) || value.length > maxItems) throw fail(400, "invalid_field", `${label} must contain at most ${maxItems} entries`);
  return value.map((entry, index) => text(entry, `${label}[${index}]`, itemMax));
}

function sanitizeTrigger(value, label) {
  const row = object(value, label);
  ensureKeys(row, new Set(["dependencyHrid", "conditionHrid", "comparatorHrid", "value"]), label);
  return {
    dependencyHrid: text(row.dependencyHrid, `${label}.dependencyHrid`),
    conditionHrid: text(row.conditionHrid, `${label}.conditionHrid`),
    comparatorHrid: text(row.comparatorHrid, `${label}.comparatorHrid`),
    value: integer(row.value, `${label}.value`, -1000000, 1000000),
  };
}

function sanitizeBuild(value, label) {
  const row = object(value, label);
  ensureKeys(row, new Set(["buildId", "sourceLoadoutId", "name", "approvedByMember", "capturedAt", "equipment", "abilities", "simulationReady", "issues"]), label);
  if (row.approvedByMember !== true || row.simulationReady !== true) throw fail(400, "invalid_field", `${label} must be member-approved and simulation-ready`);
  const equipment = Array.isArray(row.equipment) ? row.equipment : null;
  const abilities = Array.isArray(row.abilities) ? row.abilities : null;
  if (!equipment || !abilities || equipment.length > 20 || abilities.length > 5) throw fail(400, "invalid_field", `${label} equipment or abilities is invalid`);
  const capturedAt = new Date(text(row.capturedAt, `${label}.capturedAt`));
  if (Number.isNaN(capturedAt.getTime())) throw fail(400, "invalid_field", `${label}.capturedAt must be ISO-8601`);
  return {
    buildId: text(row.buildId, `${label}.buildId`),
    ...(row.sourceLoadoutId == null ? {} : { sourceLoadoutId: integer(row.sourceLoadoutId, `${label}.sourceLoadoutId`) }),
    name: text(row.name, `${label}.name`),
    approvedByMember: true,
    capturedAt: capturedAt.toISOString(),
    equipment: equipment.map((entry, index) => {
      const item = object(entry, `${label}.equipment[${index}]`);
      ensureKeys(item, new Set(["locationHrid", "itemHrid", "enhancementLevel"]), `${label}.equipment[${index}]`);
      return { locationHrid: text(item.locationHrid, `${label}.equipment[${index}].locationHrid`), itemHrid: text(item.itemHrid, `${label}.equipment[${index}].itemHrid`), enhancementLevel: integer(item.enhancementLevel, `${label}.equipment[${index}].enhancementLevel`, 0, 100) };
    }),
    abilities: abilities.map((entry, index) => {
      const ability = object(entry, `${label}.abilities[${index}]`);
      ensureKeys(ability, new Set(["slot", "abilityHrid", "level", "triggers"]), `${label}.abilities[${index}]`);
      const triggers = Array.isArray(ability.triggers) && ability.triggers.length <= 16 ? ability.triggers : null;
      if (!triggers) throw fail(400, "invalid_field", `${label}.abilities[${index}].triggers is invalid`);
      return { slot: integer(ability.slot, `${label}.abilities[${index}].slot`, 0, 4), abilityHrid: text(ability.abilityHrid, `${label}.abilities[${index}].abilityHrid`), level: integer(ability.level, `${label}.abilities[${index}].level`, 1, 10000), triggers: triggers.map((trigger, triggerIndex) => sanitizeTrigger(trigger, `${label}.abilities[${index}].triggers[${triggerIndex}]`)) };
    }),
    simulationReady: true,
    issues: stringList(row.issues ?? [], `${label}.issues`, 20),
  };
}

function sanitizeLoadoutCatalogEntry(value, label) {
  const row = object(value, label);
  ensureKeys(row, new Set(["sourceLoadoutId", "name", "category", "actionTypeHrid", "equipment", "abilities", "issues"]), label);
  if (!["combat", "profession", "all", "unknown"].includes(row.category)) throw fail(400, "invalid_field", `${label}.category is invalid`);
  const equipment = Array.isArray(row.equipment) && row.equipment.length <= 20 ? row.equipment : null;
  const abilities = Array.isArray(row.abilities) && row.abilities.length <= 5 ? row.abilities : null;
  if (!equipment || !abilities) throw fail(400, "invalid_field", `${label} equipment or abilities is invalid`);
  return {
    ...(row.sourceLoadoutId == null ? {} : { sourceLoadoutId: integer(row.sourceLoadoutId, `${label}.sourceLoadoutId`) }),
    name: text(row.name, `${label}.name`, 100),
    category: row.category,
    actionTypeHrid: text(row.actionTypeHrid, `${label}.actionTypeHrid`),
    equipment: equipment.map((entry, index) => {
      const item = object(entry, `${label}.equipment[${index}]`);
      ensureKeys(item, new Set(["locationHrid", "itemHrid", "enhancementLevel"]), `${label}.equipment[${index}]`);
      return { locationHrid: text(item.locationHrid, `${label}.equipment[${index}].locationHrid`), itemHrid: text(item.itemHrid, `${label}.equipment[${index}].itemHrid`), enhancementLevel: integer(item.enhancementLevel, `${label}.equipment[${index}].enhancementLevel`, 0, 100) };
    }),
    abilities: abilities.map((entry, index) => {
      const ability = object(entry, `${label}.abilities[${index}]`);
      ensureKeys(ability, new Set(["slot", "abilityHrid", "level", "triggers"]), `${label}.abilities[${index}]`);
      const triggers = Array.isArray(ability.triggers) && ability.triggers.length <= 16 ? ability.triggers : null;
      if (!triggers) throw fail(400, "invalid_field", `${label}.abilities[${index}].triggers is invalid`);
      return { slot: integer(ability.slot, `${label}.abilities[${index}].slot`, 0, 4), abilityHrid: text(ability.abilityHrid, `${label}.abilities[${index}].abilityHrid`), level: integer(ability.level, `${label}.abilities[${index}].level`, 1, 10000), triggers: triggers.map((trigger, triggerIndex) => sanitizeTrigger(trigger, `${label}.abilities[${index}].triggers[${triggerIndex}]`)) };
    }),
    issues: stringList(row.issues ?? [], `${label}.issues`, 20),
  };
}

function notTmdGuildMessage(guildConfig, resource) {
  if (guildConfig.slug === "TMD") {
    return `${resource} can only be synchronized from the TMD guild`;
  }
  return `${resource} can only be synchronized from ${guildConfig.gameGuildName}`;
}

function gameGuildMismatchMessage(guildConfig) {
  if (guildConfig.slug === "TMD") {
    return "game guild ID does not match the pinned TMD guild";
  }
  return "game guild ID does not match the pinned guild";
}

function sanitizeGuildRoster(value, guildConfig) {
  const row = object(value, "roster");
  ensureKeys(row, new Set(["guild", "reporter", "members", "capturedAt"]), "roster");
  const guild = object(row.guild, "roster.guild");
  ensureKeys(guild, new Set(["id", "name"]), "roster.guild");
  const guildName = text(guild.name, "roster.guild.name", 100);
  if (guildName !== guildConfig.gameGuildName) {
    throw fail(403, "not_tmd_guild", notTmdGuildMessage(guildConfig, "roster"));
  }
  const reporter = object(row.reporter, "roster.reporter");
  ensureKeys(reporter, new Set(["playerId", "memberId"]), "roster.reporter");
  const reporterMemberId = safeId(reporter.memberId, "roster.reporter.memberId");
  const reporterPlayerId = integer(reporter.playerId, "roster.reporter.playerId", 1, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(row.members) || row.members.length < 1 || row.members.length > 500) {
    throw fail(400, "invalid_roster", "roster.members must contain between 1 and 500 members");
  }
  const seenPlayerIds = new Set();
  const seenMemberIds = new Set();
  const members = row.members.map((value, index) => {
    const member = object(value, `roster.members[${index}]`);
    ensureKeys(member, new Set(["playerId", "memberId", "status", "guildRole"]), `roster.members[${index}]`);
    const playerId = integer(member.playerId, `roster.members[${index}].playerId`, 1, Number.MAX_SAFE_INTEGER);
    const memberId = safeId(member.memberId, `roster.members[${index}].memberId`);
    if (seenPlayerIds.has(playerId) || seenMemberIds.has(memberId.toLocaleLowerCase("en-US"))) {
      throw fail(400, "duplicate_roster_member", "roster contains a duplicate player ID or member name");
    }
    seenPlayerIds.add(playerId);
    seenMemberIds.add(memberId.toLocaleLowerCase("en-US"));
    return {
      playerId,
      memberId,
      status: text(member.status || "ACTIVE", `roster.members[${index}].status`, 32),
      guildRole: typeof member.guildRole === "string" && member.guildRole.trim()
        ? text(member.guildRole, `roster.members[${index}].guildRole`, 32)
        : "",
    };
  });
  if (!members.some((member) => member.playerId === reporterPlayerId && member.memberId === reporterMemberId)) {
    throw fail(400, "reporter_not_in_roster", "reporter must appear in the synchronized roster");
  }
  const capturedAt = new Date(text(row.capturedAt, "roster.capturedAt"));
  if (Number.isNaN(capturedAt.getTime())) throw fail(400, "invalid_field", "roster.capturedAt must be ISO-8601");
  return {
    guild: {
      id: integer(guild.id, "roster.guild.id", 1, Number.MAX_SAFE_INTEGER),
      name: guildName,
    },
    reporter: { playerId: reporterPlayerId, memberId: reporterMemberId },
    members,
    capturedAt: capturedAt.toISOString(),
  };
}

function sanitizeTrialRegistrations(value, guildConfig) {
  const row = object(value, "trialRegistrations");
  ensureKeys(row, new Set(["guild", "reporter", "weekStartAt", "trials", "capturedAt"]), "trialRegistrations");
  const guild = object(row.guild, "trialRegistrations.guild");
  ensureKeys(guild, new Set(["id", "name"]), "trialRegistrations.guild");
  const guildName = text(guild.name, "trialRegistrations.guild.name", 100);
  if (guildName !== guildConfig.gameGuildName) {
    throw fail(403, "not_tmd_guild", notTmdGuildMessage(guildConfig, "trial registrations"));
  }
  const reporter = object(row.reporter, "trialRegistrations.reporter");
  ensureKeys(reporter, new Set(["playerId", "memberId"]), "trialRegistrations.reporter");
  const reporterMemberId = safeId(reporter.memberId, "trialRegistrations.reporter.memberId");
  const reporterPlayerId = integer(reporter.playerId, "trialRegistrations.reporter.playerId", 1, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(row.trials) || row.trials.length < 1 || row.trials.length > 12) {
    throw fail(400, "invalid_trial_registrations", "trialRegistrations.trials must contain between 1 and 12 trials");
  }
  const seenTrials = new Set();
  const seenCombatMembers = new Set();
  const seenSkillingMembers = new Set();
  const trials = row.trials.map((value, trialIndex) => {
    const trial = object(value, `trialRegistrations.trials[${trialIndex}]`);
    ensureKeys(trial, new Set(["trialHrid", "trialName", "registeredCount", "members"]), `trialRegistrations.trials[${trialIndex}]`);
    const trialHrid = text(trial.trialHrid, `trialRegistrations.trials[${trialIndex}].trialHrid`);
    const kind = trialKindForHrid(trialHrid);
    if (!kind) throw fail(400, "unsupported_trial", `${trialHrid} is not a supported guild trial`);
    if (seenTrials.has(trialHrid)) throw fail(400, "duplicate_trial", "trial registrations contain a duplicate trial");
    seenTrials.add(trialHrid);
    if (!Array.isArray(trial.members) || trial.members.length > 100) {
      throw fail(400, "invalid_trial_members", `${trialHrid} members must contain at most 100 entries`);
    }
    const seenForKind = kind === "combat" ? seenCombatMembers : seenSkillingMembers;
    const members = trial.members.map((value, memberIndex) => {
      const member = object(value, `trialRegistrations.trials[${trialIndex}].members[${memberIndex}]`);
      ensureKeys(member, new Set(["playerId", "memberId", "roleHrid", "level"]), `trialRegistrations.trials[${trialIndex}].members[${memberIndex}]`);
      const playerId = integer(member.playerId, `trialRegistrations.trials[${trialIndex}].members[${memberIndex}].playerId`, 1, Number.MAX_SAFE_INTEGER);
      const memberId = safeId(member.memberId, `trialRegistrations.trials[${trialIndex}].members[${memberIndex}].memberId`);
      const memberKey = memberId.toLocaleLowerCase("en-US");
      if (seenForKind.has(memberKey)) {
        throw fail(
          400,
          "duplicate_trial_member",
          `${memberId} is registered for more than one ${kind} trial`,
        );
      }
      seenForKind.add(memberKey);
      const roleHrid = typeof member.roleHrid === "string" ? member.roleHrid.trim() : "";
      if (kind === "combat") {
        const legacyRole = /^\/party_roles\/(?:any_role|damage_dealer|support|tank)$/u.test(roleHrid);
        if (!COMBAT_TRIAL_ROLES.has(roleHrid) && !legacyRole) {
          throw fail(400, "invalid_trial_role", `${memberId} has an invalid combat trial role`);
        }
      }
      return {
        playerId,
        memberId,
        roleHrid,
        level: integer(member.level ?? 0, `trialRegistrations.trials[${trialIndex}].members[${memberIndex}].level`, 0, 1000),
      };
    });
    const registeredCount = integer(trial.registeredCount, `trialRegistrations.trials[${trialIndex}].registeredCount`, 0, 100);
    if (registeredCount !== members.length) {
      throw fail(400, "incomplete_trial_roster", `${trialHrid} registeredCount must equal the complete members list`);
    }
    return {
      trialHrid,
      trialName: trialDisplayName(trialHrid),
      kind,
      registeredCount,
      members,
    };
  });
  const weekStartAt = new Date(text(row.weekStartAt, "trialRegistrations.weekStartAt"));
  const capturedAt = new Date(text(row.capturedAt, "trialRegistrations.capturedAt"));
  if (Number.isNaN(weekStartAt.getTime()) || Number.isNaN(capturedAt.getTime())) {
    throw fail(400, "invalid_field", "trial registration timestamps must be ISO-8601");
  }
  return {
    guild: {
      id: integer(guild.id, "trialRegistrations.guild.id", 1, Number.MAX_SAFE_INTEGER),
      name: guildName,
    },
    reporter: { playerId: reporterPlayerId, memberId: reporterMemberId },
    weekStartAt: weekStartAt.toISOString(),
    trials,
    capturedAt: capturedAt.toISOString(),
  };
}

function optionalHrid(value, label) {
  if (value == null || value === "") return "";
  const hrid = text(value, label);
  if (!hrid.startsWith("/")) throw fail(400, "invalid_field", `${label} must be an HRID`);
  return hrid;
}

function sanitizeNumericMap(value, label, allowedKeys) {
  const row = object(value ?? {}, label);
  ensureKeys(row, allowedKeys, label);
  return Object.fromEntries(Object.entries(row).map(([key, number]) => [
    key,
    finiteNumber(number, `${label}.${key}`),
  ]));
}

function sanitizeWeeklyMonster(value, label) {
  const row = object(value, label);
  ensureKeys(row, new Set([
    "monsterHrid", "name", "level", "combatStyleHrids", "damageTypeHrid",
    "attackIntervalSeconds", "castSpeedPercent", "abilityHaste", "maxHp",
    "maxMp", "accuracy", "damage", "evasion", "armor", "resistance",
    "tenacity", "threat", "abilities",
  ]), label);
  const result = {
    monsterHrid: optionalHrid(row.monsterHrid, `${label}.monsterHrid`),
    name: typeof row.name === "string" ? row.name.trim().slice(0, 100) : "",
    level: integer(row.level, `${label}.level`, 1, 1000),
    combatStyleHrids: stringList(row.combatStyleHrids ?? [], `${label}.combatStyleHrids`, 8),
    damageTypeHrid: optionalHrid(row.damageTypeHrid, `${label}.damageTypeHrid`),
    accuracy: sanitizeNumericMap(row.accuracy, `${label}.accuracy`, new Set(["stab", "slash", "smash", "ranged", "magic"])),
    damage: sanitizeNumericMap(row.damage, `${label}.damage`, new Set(["defensive", "stab", "slash", "smash", "ranged", "magic"])),
    evasion: sanitizeNumericMap(row.evasion, `${label}.evasion`, new Set(["stab", "slash", "smash", "ranged", "magic"])),
    resistance: sanitizeNumericMap(row.resistance, `${label}.resistance`, new Set(["water", "nature", "fire"])),
    abilities: (Array.isArray(row.abilities) && row.abilities.length <= 20 ? row.abilities : null)?.map((value, index) => {
      const ability = object(value, `${label}.abilities[${index}]`);
      ensureKeys(ability, new Set(["abilityHrid", "level", "minDifficultyTier"]), `${label}.abilities[${index}]`);
      return {
        abilityHrid: optionalHrid(ability.abilityHrid, `${label}.abilities[${index}].abilityHrid`),
        level: integer(ability.level, `${label}.abilities[${index}].level`, 1, 10000),
        minDifficultyTier: integer(ability.minDifficultyTier ?? 0, `${label}.abilities[${index}].minDifficultyTier`, 0, 1000),
      };
    }),
  };
  if (!result.monsterHrid.startsWith("/monsters/")) throw fail(400, "invalid_field", `${label}.monsterHrid must identify a monster`);
  if (!result.abilities) throw fail(400, "invalid_field", `${label}.abilities must contain at most 20 entries`);
  for (const [key, minimum, maximum] of [
    ["attackIntervalSeconds", 0, 1000000],
    ["castSpeedPercent", -1000000, 1000000],
    ["abilityHaste", -1000000, 1000000],
    ["maxHp", 0, 1000000000000000],
    ["maxMp", 0, 1000000000000000],
    ["armor", -1000000000, 1000000000],
    ["tenacity", -1000000000, 1000000000],
    ["threat", -1000000000, 1000000000],
  ]) {
    if (row[key] != null) result[key] = finiteNumber(row[key], `${label}.${key}`, minimum, maximum);
  }
  return result;
}

function sanitizeWeeklyTrialCatalog(value, options = {}) {
  const capacityFallbackByTrialHrid = options.capacityFallbackByTrialHrid ?? new Map();
  const guildConfig = options.guildConfig;
  if (!guildConfig) throw new Error("sanitizeWeeklyTrialCatalog requires guildConfig");
  const row = object(value, "weeklyTrials");
  ensureKeys(row, new Set(["guild", "reporter", "weekStartAt", "weeklyTrialSet", "trials", "capturedAt"]), "weeklyTrials");
  const guild = object(row.guild, "weeklyTrials.guild");
  ensureKeys(guild, new Set(["id", "name"]), "weeklyTrials.guild");
  const guildName = text(guild.name, "weeklyTrials.guild.name", 100);
  if (guildName !== guildConfig.gameGuildName) {
    throw fail(403, "not_tmd_guild", notTmdGuildMessage(guildConfig, "weekly trials"));
  }
  const reporter = object(row.reporter, "weeklyTrials.reporter");
  ensureKeys(reporter, new Set(["playerId", "memberId"]), "weeklyTrials.reporter");
  const weeklyTrialSet = object(row.weeklyTrialSet, "weeklyTrials.weeklyTrialSet");
  ensureKeys(weeklyTrialSet, new Set(["skillHrids", "combatHrids"]), "weeklyTrials.weeklyTrialSet");
  const skillHrids = stringList(weeklyTrialSet.skillHrids, "weeklyTrials.weeklyTrialSet.skillHrids", 4);
  const combatHrids = stringList(weeklyTrialSet.combatHrids, "weeklyTrials.weeklyTrialSet.combatHrids", 2);
  if (skillHrids.length !== 4 || combatHrids.length !== 2) {
    throw fail(400, "incomplete_weekly_trial_set", "weekly trial set must contain exactly four skilling and two combat trials");
  }
  if (!Array.isArray(row.trials) || row.trials.length !== 6) {
    throw fail(400, "incomplete_weekly_trial_catalog", "weekly trial catalog must contain exactly six trials");
  }
  const configured = new Set([...skillHrids, ...combatHrids]);
  const seen = new Set();
  const trials = row.trials.map((value, index) => {
    const trial = object(value, `weeklyTrials.trials[${index}]`);
    ensureKeys(trial, new Set(["trialHrid", "trialName", "kind", "skillHrid", "actionTypeHrid", "monsterHrids", "monsters", "maxParticipants", "signedUpCount"]), `weeklyTrials.trials[${index}]`);
    const trialHrid = optionalHrid(trial.trialHrid, `weeklyTrials.trials[${index}].trialHrid`);
    if (!configured.has(trialHrid) || seen.has(trialHrid)) {
      throw fail(400, "weekly_trial_mismatch", "weekly trial catalog must match the configured trial HRIDs exactly once");
    }
    seen.add(trialHrid);
    if (!["skilling", "combat"].includes(trial.kind)) {
      throw fail(400, "invalid_field", `weeklyTrials.trials[${index}].kind is invalid`);
    }
    const expectedKind = skillHrids.includes(trialHrid) ? "skilling" : "combat";
    if (trial.kind !== expectedKind) throw fail(400, "weekly_trial_kind_mismatch", `${trialHrid} has the wrong trial kind`);
    const monsterHrids = stringList(trial.monsterHrids ?? [], `weeklyTrials.trials[${index}].monsterHrids`, 20);
    const monsters = (Array.isArray(trial.monsters) && trial.monsters.length <= 20 ? trial.monsters : null)?.map((monster, monsterIndex) =>
      sanitizeWeeklyMonster(monster, `weeklyTrials.trials[${index}].monsters[${monsterIndex}]`)
    );
    if (!monsters) throw fail(400, "invalid_field", `weeklyTrials.trials[${index}].monsters must contain at most 20 entries`);
    if (monsters.some((monster) => !monsterHrids.includes(monster.monsterHrid))) {
      throw fail(400, "weekly_monster_mismatch", `${trialHrid} includes monster details outside monsterHrids`);
    }
    if (expectedKind === "combat" && (!monsterHrids.length || monsters.length !== monsterHrids.length)) {
      throw fail(400, "incomplete_weekly_monsters", `${trialHrid} must include the complete monster HRID list and base panels`);
    }
    if (expectedKind === "skilling" && (monsterHrids.length || monsters.length)) {
      throw fail(400, "unexpected_weekly_monsters", `${trialHrid} is a skilling trial and cannot include monsters`);
    }
    let maxParticipants = optionalPositiveInteger(
      trial.maxParticipants,
      `weeklyTrials.trials[${index}].maxParticipants`,
    );
    let capacitySource = "synced";
    if (maxParticipants == null) {
      const fallback = capacityFallbackByTrialHrid.get(trialHrid);
      if (fallback != null) {
        maxParticipants = fallback;
        capacitySource = "stale_cap";
      }
    }
    if (maxParticipants == null) {
      throw fail(400, "missing_trial_capacity", `${trialHrid} is missing maxParticipants and no previous capacity is available`);
    }
    const signedUpCount = optionalPositiveInteger(
      trial.signedUpCount,
      `weeklyTrials.trials[${index}].signedUpCount`,
      true,
    );
    return {
      trialHrid,
      trialName: typeof trial.trialName === "string" && trial.trialName.trim()
        ? trial.trialName.trim().slice(0, 100)
        : trialHrid.split("/").at(-1),
      kind: trial.kind,
      skillHrid: optionalHrid(trial.skillHrid, `weeklyTrials.trials[${index}].skillHrid`),
      actionTypeHrid: optionalHrid(trial.actionTypeHrid, `weeklyTrials.trials[${index}].actionTypeHrid`),
      maxParticipants,
      ...(signedUpCount != null ? { signedUpCount } : {}),
      ...(capacitySource === "stale_cap" ? { capacitySource } : {}),
      monsterHrids,
      monsters,
    };
  });
  const staleCapacityTrials = trials.filter((trial) => trial.capacitySource === "stale_cap").map((trial) => trial.trialHrid);
  const weekStartAt = new Date(text(row.weekStartAt, "weeklyTrials.weekStartAt"));
  const capturedAt = new Date(text(row.capturedAt, "weeklyTrials.capturedAt"));
  if (Number.isNaN(weekStartAt.getTime()) || Number.isNaN(capturedAt.getTime())) {
    throw fail(400, "invalid_field", "weekly trial timestamps must be ISO-8601");
  }
  return {
    guild: {
      id: integer(guild.id, "weeklyTrials.guild.id", 1, Number.MAX_SAFE_INTEGER),
      name: guildName,
    },
    reporter: {
      playerId: integer(reporter.playerId, "weeklyTrials.reporter.playerId", 1, Number.MAX_SAFE_INTEGER),
      memberId: safeId(reporter.memberId, "weeklyTrials.reporter.memberId"),
    },
    weekStartAt: weekStartAt.toISOString(),
    weeklyTrialSet: { skillHrids, combatHrids },
    trials,
    capturedAt: capturedAt.toISOString(),
    ...(staleCapacityTrials.length ? { staleCapacityTrials } : {}),
  };
}

function sanitizeLifeAssignment(value, label = "lifeAssignment") {
  const row = object(value, label);
  ensureKeys(row, new Set(["weekStartAt", "generatedAt", "trials", "totalBasePoints", "unassigned", "assumptions"]), label);
  const weekStartAt = new Date(text(row.weekStartAt, `${label}.weekStartAt`));
  const generatedAt = new Date(text(row.generatedAt, `${label}.generatedAt`));
  if (Number.isNaN(weekStartAt.getTime()) || Number.isNaN(generatedAt.getTime())) {
    throw fail(400, "invalid_field", `${label} timestamps must be ISO-8601`);
  }
  if (!Array.isArray(row.trials) || row.trials.length !== 4) {
    throw fail(400, "invalid_field", `${label}.trials must contain exactly four skilling trials`);
  }
  const trials = row.trials.map((trial, index) => {
    const entry = object(trial, `${label}.trials[${index}]`);
    ensureKeys(entry, new Set(["trialHrid", "trialName", "skillHrid", "maxParticipants", "roster", "expectedLevelsCleared", "basePoints", "finalLevel", "remainingProgress", "finalLevelRequired"]), `${label}.trials[${index}]`);
    const roster = stringList(entry.roster, `${label}.trials[${index}].roster`, 200);
    const maxParticipants = integer(entry.maxParticipants, `${label}.trials[${index}].maxParticipants`, 1, 200);
    if (roster.length > maxParticipants) {
      throw fail(400, "life_assignment_over_capacity", `${entry.trialHrid} exceeds maxParticipants`);
    }
    return {
      trialHrid: optionalHrid(entry.trialHrid, `${label}.trials[${index}].trialHrid`),
      trialName: text(entry.trialName, `${label}.trials[${index}].trialName`, 100),
      skillHrid: optionalHrid(entry.skillHrid, `${label}.trials[${index}].skillHrid`),
      maxParticipants,
      roster,
      expectedLevelsCleared: integer(entry.expectedLevelsCleared, `${label}.trials[${index}].expectedLevelsCleared`, 0, 100),
      basePoints: integer(entry.basePoints, `${label}.trials[${index}].basePoints`, 0, 1000000),
      finalLevel: integer(entry.finalLevel, `${label}.trials[${index}].finalLevel`, 100, 500),
      remainingProgress: integer(entry.remainingProgress, `${label}.trials[${index}].remainingProgress`, 0, 100000000),
      finalLevelRequired: integer(entry.finalLevelRequired, `${label}.trials[${index}].finalLevelRequired`, 0, 100000000),
    };
  });
  const rosterMembers = new Set();
  for (const trial of trials) {
    for (const memberId of trial.roster) {
      if (rosterMembers.has(memberId)) {
        throw fail(400, "life_assignment_duplicate_member", `${memberId} is assigned to more than one life trial`);
      }
      rosterMembers.add(memberId);
    }
  }
  return {
    weekStartAt: weekStartAt.toISOString(),
    generatedAt: generatedAt.toISOString(),
    trials,
    totalBasePoints: integer(row.totalBasePoints, `${label}.totalBasePoints`, 0, 10000000),
    unassigned: stringList(row.unassigned, `${label}.unassigned`, 500),
    assumptions: stringList(row.assumptions, `${label}.assumptions`, 50),
  };
}

/** Rejects unknown/sensitive input. This is the API's data minimisation boundary. */
export function sanitizeMemberSnapshot(value, expectedGuildId, expectedMemberId) {
  const row = object(value, "snapshot");
  ensureKeys(row, new Set(["schemaVersion", "memberId", "displayName", "guildId", "capturedAt", "source", "sourceSchemaVersion", "freshness", "confidence", "skills", "learnedAbilities", "auras", "loadoutCatalog", "approvedBuilds", "participation", "issues"]), "snapshot");
  if (String(row.schemaVersion) !== "2") throw fail(400, "invalid_field", "snapshot.schemaVersion must be 2");
  if (safeId(row.memberId, "snapshot.memberId") !== expectedMemberId) throw fail(403, "member_mismatch", "member token cannot upload another member's snapshot");
  if (safeId(row.guildId, "snapshot.guildId", GUILD_ID) !== expectedGuildId) throw fail(403, "guild_mismatch", "member token cannot upload another guild's snapshot");
  const capturedAt = new Date(text(row.capturedAt, "snapshot.capturedAt"));
  if (Number.isNaN(capturedAt.getTime())) throw fail(400, "invalid_field", "snapshot.capturedAt must be ISO-8601");
  const participation = object(row.participation, "snapshot.participation");
  ensureKeys(participation, new Set(["eligibleBossHrids", "preferredBossHrids", "maxBossAssignments", "allowRoleChange", "allowSkillChange"]), "snapshot.participation");
  if (typeof participation.allowRoleChange !== "boolean" || typeof participation.allowSkillChange !== "boolean") throw fail(400, "invalid_field", "snapshot participation flags must be boolean");
  const builds = Array.isArray(row.approvedBuilds) && row.approvedBuilds.length <= 4 ? row.approvedBuilds : null;
  if (!builds) throw fail(400, "invalid_field", "snapshot.approvedBuilds must contain at most four builds");
  const loadoutCatalog = Array.isArray(row.loadoutCatalog) && row.loadoutCatalog.length <= 64 ? row.loadoutCatalog : [];
  const sanitizedLoadoutCatalog = loadoutCatalog.map((loadout, index) =>
    sanitizeLoadoutCatalogEntry(loadout, `snapshot.loadoutCatalog[${index}]`)
  );
  const hasUsableEquipment = sanitizedLoadoutCatalog.some((loadout) => loadout.equipment.length > 0);
  if (!hasUsableEquipment) {
    throw fail(400, "empty_loadout_catalog", "snapshot has no usable loadout equipment");
  }
  return {
    schemaVersion: "2", memberId: expectedMemberId, guildId: expectedGuildId,
    displayName: text(row.displayName, "snapshot.displayName", 100),
    capturedAt: capturedAt.toISOString(), source: text(row.source, "snapshot.source", 64),
    sourceSchemaVersion: text(row.sourceSchemaVersion, "snapshot.sourceSchemaVersion", 100),
    freshness: text(row.freshness, "snapshot.freshness", 32), confidence: text(row.confidence, "snapshot.confidence", 64),
    skills: levelMap(row.skills, "snapshot.skills"), learnedAbilities: levelMap(row.learnedAbilities, "snapshot.learnedAbilities"), auras: levelMap(row.auras, "snapshot.auras"),
    loadoutCatalog: sanitizedLoadoutCatalog,
    approvedBuilds: builds.map((build, index) => sanitizeBuild(build, `snapshot.approvedBuilds[${index}]`)),
    participation: { eligibleBossHrids: stringList(participation.eligibleBossHrids, "snapshot.participation.eligibleBossHrids", 20), preferredBossHrids: stringList(participation.preferredBossHrids, "snapshot.participation.preferredBossHrids", 20), maxBossAssignments: integer(participation.maxBossAssignments, "snapshot.participation.maxBossAssignments", 1, 1), allowRoleChange: participation.allowRoleChange, allowSkillChange: participation.allowSkillChange },
    issues: stringList(row.issues ?? [], "snapshot.issues", 50),
  };
}

function initialize(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (guild_id TEXT NOT NULL REFERENCES guilds(id), member_id TEXT NOT NULL, display_name TEXT NOT NULL, member_token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (guild_id, member_id));
    CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL, member_id TEXT NOT NULL, captured_at TEXT NOT NULL, received_at TEXT NOT NULL, payload_json TEXT NOT NULL, FOREIGN KEY (guild_id, member_id) REFERENCES members(guild_id, member_id));
    CREATE INDEX IF NOT EXISTS snapshots_member_received ON snapshots(guild_id, member_id, received_at DESC);
    CREATE TABLE IF NOT EXISTS qq_bindings (guild_id TEXT NOT NULL, qq_number TEXT NOT NULL, member_id TEXT NOT NULL, combat_type TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (guild_id, member_id), FOREIGN KEY (guild_id, member_id) REFERENCES members(guild_id, member_id));
    CREATE TABLE IF NOT EXISTS auras (guild_id TEXT NOT NULL, member_id TEXT NOT NULL, aura_type TEXT NOT NULL, level INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (guild_id, member_id, aura_type), FOREIGN KEY (guild_id, member_id) REFERENCES members(guild_id, member_id));
    CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id), kind TEXT NOT NULL CHECK(kind IN ('formal','test')), locked INTEGER NOT NULL CHECK(locked IN (0,1)), created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS assignments_current ON assignments(guild_id, kind, id DESC);
    CREATE TABLE IF NOT EXISTS simulation_jobs (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id), mode TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, result_json TEXT, error_code TEXT);
    CREATE TABLE IF NOT EXISTS plugin_versions (plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL, install_url TEXT NOT NULL, updated_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS roster_syncs (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id), game_guild_id INTEGER NOT NULL, guild_name TEXT NOT NULL, reporter_member_id TEXT NOT NULL, captured_at TEXT NOT NULL, received_at TEXT NOT NULL, member_count INTEGER NOT NULL, payload_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS roster_syncs_latest ON roster_syncs(guild_id, id DESC);
    CREATE TABLE IF NOT EXISTS trial_registration_snapshots (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id), game_guild_id INTEGER NOT NULL, reporter_member_id TEXT NOT NULL, week_start_at TEXT NOT NULL, trial_hrid TEXT NOT NULL, trial_name TEXT NOT NULL, registered_count INTEGER NOT NULL, captured_at TEXT NOT NULL, received_at TEXT NOT NULL, payload_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS trial_registration_latest ON trial_registration_snapshots(guild_id, trial_hrid, id DESC);
    CREATE TABLE IF NOT EXISTS weekly_trial_catalog_snapshots (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id), game_guild_id INTEGER NOT NULL, reporter_member_id TEXT NOT NULL, week_start_at TEXT NOT NULL, captured_at TEXT NOT NULL, received_at TEXT NOT NULL, skill_trial_count INTEGER NOT NULL, combat_trial_count INTEGER NOT NULL, monster_count INTEGER NOT NULL, payload_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS weekly_trial_catalog_latest ON weekly_trial_catalog_snapshots(guild_id, id DESC);
    CREATE TABLE IF NOT EXISTS life_assignment_runs (id INTEGER PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id), kind TEXT NOT NULL CHECK(kind IN ('formal','test')), week_start_at TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS life_assignment_runs_current ON life_assignment_runs(guild_id, kind, id DESC);
  `);
  const ensureColumn = (table, column, definition) => {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn("guilds", "game_guild_id", "INTEGER");
  ensureColumn("members", "game_player_id", "INTEGER");
  ensureColumn("members", "guild_role", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("members", "status", "TEXT NOT NULL DEFAULT 'ACTIVE'");
  ensureColumn("members", "active", "INTEGER NOT NULL DEFAULT 1");
}

function parseCsvSet(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Parse a case-sensitive member-ID list for the TMD roster reporter allow-list.
 *
 * Accepts a comma-separated string or an array of strings. Each entry is trimmed
 * and validated against MEMBER_ID; invalid characters reject the whole config
 * instead of being silently coerced. An empty result is also rejected so a
 * misconfigured env cannot lock every reporter out.
 */
function parseMemberIdSet(value) {
  let rawEntries;
  if (value === undefined || value === null) {
    rawEntries = [];
  } else if (typeof value === "string") {
    rawEntries = value.split(",");
  } else if (Array.isArray(value)) {
    rawEntries = value;
  } else {
    throw fail(400, "invalid_field", "tmd roster reporter list must be a comma-separated string or an array of member ids");
  }
  const reporters = new Set();
  for (const raw of rawEntries) {
    if (typeof raw !== "string") {
      throw fail(400, "invalid_field", "tmd roster reporter list entries must be strings");
    }
    const entry = raw.trim();
    if (!entry) continue;
    if (!MEMBER_ID.test(entry)) {
      throw fail(400, "invalid_field", `tmd roster reporter list contains an invalid member id: ${entry}`);
    }
    reporters.add(entry);
  }
  if (reporters.size === 0) {
    throw fail(400, "invalid_field", "tmd roster reporter list must contain at least one member id");
  }
  return reporters;
}

function remoteIpAddress(req) {
  return String(req.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");
}

/** Tailscale CGNAT is 100.64.0.0/10 — used when API is reached directly on the tailnet. */
function isTailscaleCgnatIp(ip) {
  const match = String(ip).match(/^100\.(\d+)(?:\.|$)/);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 64 && second <= 127;
}

function napcatQrPageHtml({ token, login }) {
  const safeToken = encodeURIComponent(token);
  const safeLogin = String(login ?? "").replace(/[<>&"']/g, "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>NapCat 扫码登录</title>
<style>
  :root { color-scheme: light; --ink:#1c1917; --muted:#78716c; --line:#d6d3d1; --bg:#fafaf9; --card:#fff; --accent:#0f766e; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; font:16px/1.5 "IBM Plex Sans", "PingFang SC", "Noto Sans SC", sans-serif; color:var(--ink); background:
    radial-gradient(1200px 600px at 10% -10%, #ccfbf1 0%, transparent 55%),
    radial-gradient(900px 500px at 100% 0%, #fef3c7 0%, transparent 50%),
    var(--bg); }
  main { max-width:420px; margin:0 auto; padding:48px 20px 64px; }
  h1 { margin:0 0 8px; font-size:1.5rem; letter-spacing:-0.02em; }
  p { margin:0 0 12px; color:var(--muted); }
  .badge { display:inline-block; margin-bottom:16px; font-size:12px; color:var(--accent); border:1px solid #99f6e4; background:#f0fdfa; padding:4px 8px; }
  .frame { background:var(--card); border:1px solid var(--line); padding:16px; text-align:center; }
  img { width:min(280px,100%); height:auto; image-rendering:pixelated; background:#fff; }
  .meta { margin-top:12px; font-size:13px; color:var(--muted); }
  button { margin-top:16px; width:100%; border:0; background:var(--accent); color:#fff; padding:12px 16px; font:inherit; cursor:pointer; }
  button:disabled { opacity:.6; cursor:wait; }
  .err { color:#b91c1c; min-height:1.5em; margin-top:8px; font-size:14px; }
</style>
</head>
<body>
<main>
  <div class="badge">仅 Tailscale 成员可访问</div>
  <h1>NapCat 扫码登录</h1>
  <p>用手机 QQ 扫码。二维码约两分钟过期；过期点下方刷新。</p>
  <div class="frame">
    <img id="qr" alt="NapCat login QR" src="/napcat-qr.png?token=${safeToken}&amp;t=0"/>
    <div class="meta">登录身份：${safeLogin || "tailscale"} · 自动刷新中</div>
  </div>
  <button type="button" id="refresh">重启 NapCat 并刷新二维码</button>
  <div class="err" id="err"></div>
</main>
<script>
const token = ${JSON.stringify(token)};
const qr = document.getElementById("qr");
const err = document.getElementById("err");
const btn = document.getElementById("refresh");
function bump() { qr.src = "/napcat-qr.png?token=" + encodeURIComponent(token) + "&t=" + Date.now(); }
setInterval(bump, 5000);
btn.addEventListener("click", async () => {
  btn.disabled = true; err.textContent = "";
  try {
    const res = await fetch("/napcat-qr/refresh?token=" + encodeURIComponent(token), { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || ("HTTP " + res.status));
    await new Promise((r) => setTimeout(r, 2500));
    bump();
  } catch (e) { err.textContent = e.message || String(e); }
  finally { btn.disabled = false; }
});
</script>
</body>
</html>`;
}

function equalsSecret(actual, expected) {
  if (!expected || !actual) return false;
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Member credentials are provisioned once and retained only as a salted hash.
// The admin key is intentionally not persisted by this process at all.
function hashMemberToken(value) {
  const salt = randomBytes(16);
  return `${salt.toString("base64url")}:${scryptSync(value, salt, 32).toString("base64url")}`;
}

function matchesMemberToken(value, stored) {
  const [saltText, digestText] = String(stored ?? "").split(":");
  if (!value || !saltText || !digestText) return false;
  try {
    const expected = Buffer.from(digestText, "base64url");
    const actual = scryptSync(value, Buffer.from(saltText, "base64url"), 32);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function readJson(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw fail(
        413,
        "payload_too_large",
        maxBytes > MAX_BODY_BYTES
          ? "request body exceeds test-report upload limit"
          : "request body exceeds 1 MiB",
      );
    }
    chunks.push(chunk);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch (error) { if (error.status) throw error; throw fail(400, "invalid_json", "request body must be JSON"); }
}

function isAllowedTestReportFileName(fileName) {
  return TEST_REPORT_FILE_NAME.test(fileName);
}

function token(req, header) { return req.headers[header]?.toString().replace(/^Bearer\s+/i, "").trim() ?? ""; }
function now() { return new Date().toISOString(); }
function decode(value) { try { return decodeURIComponent(value); } catch { throw fail(400, "invalid_path", "invalid URL path"); } }

export async function createGuildApi(options = {}) {
  const dbPath = options.dbPath ?? process.env.MWI_GUILD_API_DB_PATH ?? ":memory:";
  const adminKey = options.adminKey ?? process.env.MWI_GUILD_API_ADMIN_KEY;
  if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required (or pass adminKey when embedding the API)");
  const fixturePath = options.fixturePath ?? process.env.MWI_GUILD_API_FIXTURE_PATH ?? DEFAULT_FIXTURE;
  const fixture = options.fixture ?? JSON.parse(await readFile(fixturePath, "utf8"));
  const memberPluginPath = options.memberPluginPath ?? process.env.MWI_GUILD_MEMBER_PLUGIN_PATH ?? DEFAULT_MEMBER_PLUGIN;
  const tmdRosterReporters = parseMemberIdSet(
    options.tmdRosterReporters ??
    options.tmdRosterReporter ??
    process.env.MWI_TMD_ROSTER_REPORTERS ??
    process.env.MWI_TMD_ROSTER_REPORTER ??
    "adudu"
  );
  const guildRegistry = buildGuildRegistry({ tmdReporters: tmdRosterReporters });
  const napcatQrToken = options.napcatQrToken ?? process.env.MWI_NAPCAT_QR_TOKEN ?? "";
  const napcatQrPath =
    options.napcatQrPath ??
    process.env.MWI_NAPCAT_QR_PATH ??
    "D:\\mwi-napcat\\shell\\cache\\qrcode.png";
  const napcatQrAllowedLogins = parseCsvSet(
    options.napcatQrAllowedLogins ?? process.env.MWI_NAPCAT_QR_ALLOWED_LOGINS ?? "",
  );
  const napcatRestartCommand =
    options.napcatRestartCommand ??
    process.env.MWI_NAPCAT_RESTART_COMMAND ??
    'cmd /c "taskkill /F /IM QQ.exe /T >nul 2>&1 & start \"\" /MIN D:\\mwi-napcat\\start-napcat.bat"';
  const napcatQrRunner = options.napcatQrRunner ?? ((command) => new Promise((resolveRunner, rejectRunner) => {
    const child = spawn(command, { shell: true, windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", rejectRunner);
    child.on("exit", (code) => {
      if (code === 0 || code === 128 || code === 1) resolveRunner({ code, stderr });
      else rejectRunner(new Error(stderr.trim() || `restart exited with code ${code}`));
    });
  }));
  const testReportDirectory =
    options.testReportDirectory ??
    process.env.MWI_TEST_REPORT_DIR ??
    DEFAULT_TEST_REPORT_DIR;
  const db = new DatabaseSync(dbPath);
  initialize(db);

  const requireNapcatQrAccess = (req, url) => {
    if (!napcatQrToken) {
      throw fail(503, "napcat_qr_unconfigured", "MWI_NAPCAT_QR_TOKEN is not configured");
    }
    const provided =
      url.searchParams.get("token") ||
      token(req, "x-napcat-qr-token") ||
      "";
    if (!equalsSecret(provided, napcatQrToken)) {
      throw fail(401, "napcat_qr_auth_required", "valid NapCat QR token is required");
    }
    // Tailscale Serve injects Tailscale-User-Login for tailnet members; Funnel public visitors
    // do not get it (and Tailscale overwrites client-supplied values). Direct CGNAT peers are
    // also accepted when the API is reachable on a Tailscale address (not via Funnel/loopback).
    const login = String(req.headers["tailscale-user-login"] ?? "").trim().toLowerCase();
    const peerIp = remoteIpAddress(req);
    const identity = login || (isTailscaleCgnatIp(peerIp) ? `tailnet:${peerIp}` : "");
    if (!identity) {
      throw fail(
        403,
        "tailscale_only",
        "NapCat QR is only available to Tailscale network members (open via MagicDNS while connected to the tailnet)",
      );
    }
    if (napcatQrAllowedLogins.size > 0 && !napcatQrAllowedLogins.has(identity) && !(login && napcatQrAllowedLogins.has(login))) {
      throw fail(403, "tailscale_user_not_allowed", "this Tailscale identity is not allowed to view NapCat QR");
    }
    return { login: identity, providedToken: provided };
  };

  const requireTestReportDirectory = () => {
    if (!testReportDirectory) {
      throw fail(
        503,
        "test_report_dir_unconfigured",
        "MWI_TEST_REPORT_DIR is not configured on the API host",
      );
    }
    return testReportDirectory;
  };
  const requireAdmin = (req) => { if (!equalsSecret(token(req, "x-admin-key"), adminKey)) throw fail(401, "admin_auth_required", "valid X-Admin-Key is required"); };
  const requireMember = (req, guildId, memberId) => {
    const member = db.prepare("SELECT member_token FROM members WHERE guild_id = ? AND member_id = ? AND active = 1").get(guildId, memberId);
    if (!member || !matchesMemberToken(token(req, "authorization"), member.member_token)) throw fail(401, "member_auth_required", "valid member bearer token is required");
  };
  const guildExists = (guildId) => db.prepare("SELECT id FROM guilds WHERE id = ?").get(guildId);
  const assignment = (guildId, kind) => db.prepare("SELECT id, locked, created_at, payload_json FROM assignments WHERE guild_id = ? AND kind = ? ORDER BY id DESC LIMIT 1").get(guildId, kind);
  const lifeAssignment = (guildId, kind) => db.prepare("SELECT id, week_start_at, created_at, payload_json FROM life_assignment_runs WHERE guild_id = ? AND kind = ? ORDER BY id DESC LIMIT 1").get(guildId, kind);
  const weeklyTrialCapacityFallback = (guildId) => {
    const row = db.prepare(`
      SELECT payload_json
      FROM weekly_trial_catalog_snapshots
      WHERE guild_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(guildId);
    const fallback = new Map();
    if (!row) return fallback;
    const payload = JSON.parse(row.payload_json);
    for (const trial of payload.trials ?? []) {
      if (Number.isInteger(trial?.maxParticipants) && trial.maxParticipants > 0) {
        fallback.set(trial.trialHrid, trial.maxParticipants);
      }
    }
    return fallback;
  };
  const requireRegisteredGuild = (slug) => {
    const guildConfig = resolveRegisteredGuild(guildRegistry, slug);
    if (!guildConfig) throw fail(404, "guild_not_found", "guild is not registered for public ingest");
    return guildConfig;
  };
  const assertPinnedGameGuildId = (guildConfig, gameGuildId) => {
    if (Number(gameGuildId) !== guildConfig.gameGuildId) {
      throw fail(403, "game_guild_mismatch", gameGuildMismatchMessage(guildConfig));
    }
  };
  const publicUploadWindows = new Map();
  const checkPublicUploadRate = (req, memberId, limit = 20) => {
    const address = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
    const key = `${address}:${memberId}`;
    const timestamp = Date.now();
    const recent = (publicUploadWindows.get(key) ?? []).filter((entry) => timestamp - entry < 60_000);
    if (recent.length >= limit) throw fail(429, "upload_rate_limited", "too many uploads; wait before trying again");
    recent.push(timestamp);
    publicUploadWindows.set(key, recent);
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean).map(decode);
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "mwi-guild-api", simulationEngine: "unavailable" });
      if (url.pathname === "/napcat-qr" || url.pathname === "/napcat-qr.png" || url.pathname === "/napcat-qr/refresh") {
        const access = requireNapcatQrAccess(req, url);
        if (req.method === "GET" && url.pathname === "/napcat-qr") {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-robots-tag": "noindex, nofollow",
            "referrer-policy": "no-referrer",
          });
          return res.end(napcatQrPageHtml({ token: access.providedToken, login: access.login }));
        }
        if (req.method === "GET" && url.pathname === "/napcat-qr.png") {
          if (!existsSync(napcatQrPath)) {
            throw fail(404, "napcat_qr_missing", "qrcode.png not found; restart NapCat to generate a new QR");
          }
          const png = await readFile(napcatQrPath);
          res.writeHead(200, {
            "content-type": "image/png",
            "cache-control": "no-store",
            "content-length": png.length,
          });
          return res.end(png);
        }
        if (req.method === "POST" && url.pathname === "/napcat-qr/refresh") {
          try {
            await napcatQrRunner(napcatRestartCommand);
          } catch (error) {
            throw fail(500, "napcat_restart_failed", error?.message || "failed to restart NapCat");
          }
          return json(res, 200, {
            ok: true,
            restarted: true,
            login: access.login,
            qrPath: basename(napcatQrPath),
            hint: "wait a few seconds then reload /napcat-qr.png",
          });
        }
        throw fail(405, "method_not_allowed", "unsupported method for NapCat QR route");
      }
      if (req.method === "GET" && url.pathname === "/mwi-guild-trial-exporter.user.js") {
        const source = await readFile(memberPluginPath, "utf8");
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
        });
        return res.end(source);
      }
      if (req.method === "GET" && url.pathname === "/api/boss-fixture/current") return json(res, 200, fixture);
      if (req.method === "GET" && url.pathname === "/api/plugin-versions") return json(res, 200, { plugins: db.prepare("SELECT plugin_id AS pluginId, version, install_url AS installUrl, updated_at AS updatedAt, notes FROM plugin_versions ORDER BY plugin_id").all() });

      if (parts[0] === "api" && parts[1] === "public" && parts[2] === "guilds" && parts[3] && parts[4] === "roster" && parts.length === 5 && req.method === "POST") {
        const guildConfig = requireRegisteredGuild(safeId(parts[3], "guildSlug", GUILD_ID));
        const guildId = guildConfig.slug;
        const roster = sanitizeGuildRoster(await readJson(req), guildConfig);
        if (!guildConfig.reporters.has(roster.reporter.memberId)) {
          throw fail(403, "roster_reporter_not_allowed", "this character is not allowed to synchronize the TMD roster");
        }
        const reporter = db.prepare("SELECT 1 FROM members WHERE guild_id = ? AND member_id = ? AND active = 1").get(guildId, roster.reporter.memberId);
        if (!reporter) throw fail(403, "roster_reporter_not_registered", "roster reporter is not an active TMD member");
        if (!guildExists(guildId)) throw fail(404, "guild_not_found", "TMD guild is not configured");
        assertPinnedGameGuildId(guildConfig, roster.guild.id);
        checkPublicUploadRate(req, `roster:${roster.reporter.memberId}`, 2);
        const activeCount = Number(db.prepare("SELECT COUNT(*) AS count FROM members WHERE guild_id = ? AND active = 1").get(guildId).count);
        if (activeCount >= 10 && roster.members.length < Math.ceil(activeCount * 0.75)) {
          throw fail(409, "incomplete_roster", "received roster is too small to safely replace the current TMD roster");
        }
        const timestamp = now();
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("UPDATE guilds SET name = ?, game_guild_id = ? WHERE id = ?").run(guildConfig.gameGuildName, roster.guild.id, guildId);
          db.prepare("UPDATE members SET active = 0 WHERE guild_id = ?").run(guildId);
          const upsert = db.prepare(`
            INSERT INTO members (guild_id, member_id, display_name, member_token, created_at, updated_at, game_player_id, guild_role, status, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(guild_id, member_id) DO UPDATE SET
              display_name = excluded.display_name,
              updated_at = excluded.updated_at,
              game_player_id = excluded.game_player_id,
              guild_role = excluded.guild_role,
              status = excluded.status,
              active = 1
          `);
          for (const member of roster.members) {
            upsert.run(
              guildId,
              member.memberId,
              member.memberId,
              hashMemberToken(randomBytes(32).toString("base64url")),
              timestamp,
              timestamp,
              member.playerId,
              member.guildRole,
              member.status,
            );
          }
          db.prepare(`
            DELETE FROM qq_bindings
            WHERE guild_id = ?
              AND member_id IN (
                SELECT member_id FROM members WHERE guild_id = ? AND active = 0
              )
          `).run(guildId, guildId);
          const inserted = db.prepare(`
            INSERT INTO roster_syncs (guild_id, game_guild_id, guild_name, reporter_member_id, captured_at, received_at, member_count, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(guildId, roster.guild.id, guildConfig.gameGuildName, roster.reporter.memberId, roster.capturedAt, timestamp, roster.members.length, safeJson(roster, "roster"));
          db.exec("COMMIT");
          return json(res, 200, {
            rosterSyncId: Number(inserted.lastInsertRowid),
            guildId,
            gameGuildId: roster.guild.id,
            memberCount: roster.members.length,
            receivedAt: timestamp,
          });
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }

      if (parts[0] === "api" && parts[1] === "public" && parts[2] === "guilds" && parts[3] && parts[4] === "trial-registrations" && parts.length === 5 && req.method === "POST") {
        const guildConfig = requireRegisteredGuild(safeId(parts[3], "guildSlug", GUILD_ID));
        const guildId = guildConfig.slug;
        const registrations = sanitizeTrialRegistrations(await readJson(req), guildConfig);
        if (!guildConfig.reporters.has(registrations.reporter.memberId)) {
          throw fail(403, "trial_reporter_not_allowed", "this character is not allowed to synchronize TMD trial registrations");
        }
        const reporter = db.prepare("SELECT game_player_id FROM members WHERE guild_id = ? AND member_id = ? AND active = 1").get(guildId, registrations.reporter.memberId);
        if (!reporter) throw fail(403, "trial_reporter_not_registered", "trial reporter is not an active TMD member");
        if (reporter.game_player_id != null && Number(reporter.game_player_id) !== registrations.reporter.playerId) {
          throw fail(403, "trial_reporter_mismatch", "trial reporter player ID does not match the TMD roster");
        }
        if (!guildExists(guildId)) throw fail(404, "guild_not_found", "TMD guild is not configured");
        assertPinnedGameGuildId(guildConfig, registrations.guild.id);
        checkPublicUploadRate(req, `trial:${registrations.reporter.memberId}`, 6);
        for (const trial of registrations.trials) {
          for (const trialMember of trial.members) {
            const rosterMember = db.prepare("SELECT member_id, game_player_id FROM members WHERE guild_id = ? AND lower(member_id) = lower(?) AND active = 1").get(guildId, trialMember.memberId);
            if (!rosterMember) throw fail(409, "trial_member_not_in_roster", `${trialMember.memberId} is not in the current TMD roster`);
            if (rosterMember.game_player_id != null && Number(rosterMember.game_player_id) !== trialMember.playerId) {
              throw fail(409, "trial_member_mismatch", `${trialMember.memberId} player ID does not match the current TMD roster`);
            }
            trialMember.memberId = rosterMember.member_id;
          }
        }
        const timestamp = now();
        const insert = db.prepare(`
          INSERT INTO trial_registration_snapshots
            (guild_id, game_guild_id, reporter_member_id, week_start_at, trial_hrid, trial_name, registered_count, captured_at, received_at, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const snapshotIds = [];
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const trial of registrations.trials) {
            const inserted = insert.run(
              guildId,
              registrations.guild.id,
              registrations.reporter.memberId,
              registrations.weekStartAt,
              trial.trialHrid,
              trial.trialName,
              trial.registeredCount,
              registrations.capturedAt,
              timestamp,
              safeJson(trial, "trialRegistration"),
            );
            snapshotIds.push(Number(inserted.lastInsertRowid));
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return json(res, 201, {
          guildId,
          weekStartAt: registrations.weekStartAt,
          receivedAt: timestamp,
          snapshotIds,
          trials: registrations.trials.map((trial) => ({
            trialHrid: trial.trialHrid,
            registeredCount: trial.registeredCount,
          })),
        });
      }

      if (parts[0] === "api" && parts[1] === "public" && parts[2] === "guilds" && parts[3] && parts[4] === "weekly-trials" && parts.length === 5 && req.method === "POST") {
        const guildConfig = requireRegisteredGuild(safeId(parts[3], "guildSlug", GUILD_ID));
        const guildId = guildConfig.slug;
        const weeklyTrials = sanitizeWeeklyTrialCatalog(await readJson(req), {
          capacityFallbackByTrialHrid: weeklyTrialCapacityFallback(guildId),
          guildConfig,
        });
        if (!guildConfig.reporters.has(weeklyTrials.reporter.memberId)) {
          throw fail(403, "weekly_trial_reporter_not_allowed", "this character is not allowed to synchronize TMD weekly trials");
        }
        const reporter = db.prepare("SELECT game_player_id FROM members WHERE guild_id = ? AND member_id = ? AND active = 1").get(guildId, weeklyTrials.reporter.memberId);
        if (!reporter) throw fail(403, "weekly_trial_reporter_not_registered", "weekly trial reporter is not an active TMD member");
        if (reporter.game_player_id != null && Number(reporter.game_player_id) !== weeklyTrials.reporter.playerId) {
          throw fail(403, "weekly_trial_reporter_mismatch", "weekly trial reporter player ID does not match the TMD roster");
        }
        if (!guildExists(guildId)) throw fail(404, "guild_not_found", "TMD guild is not configured");
        assertPinnedGameGuildId(guildConfig, weeklyTrials.guild.id);
        checkPublicUploadRate(req, `weekly-trials:${weeklyTrials.reporter.memberId}`, 6);
        const timestamp = now();
        const monsterCount = weeklyTrials.trials.reduce((count, trial) => count + trial.monsters.length, 0);
        const inserted = db.prepare(`
          INSERT INTO weekly_trial_catalog_snapshots
            (guild_id, game_guild_id, reporter_member_id, week_start_at, captured_at, received_at, skill_trial_count, combat_trial_count, monster_count, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          guildId,
          weeklyTrials.guild.id,
          weeklyTrials.reporter.memberId,
          weeklyTrials.weekStartAt,
          weeklyTrials.capturedAt,
          timestamp,
          weeklyTrials.weeklyTrialSet.skillHrids.length,
          weeklyTrials.weeklyTrialSet.combatHrids.length,
          monsterCount,
          safeJson(weeklyTrials, "weeklyTrials"),
        );
        return json(res, 201, {
          snapshotId: Number(inserted.lastInsertRowid),
          guildId,
          weekStartAt: weeklyTrials.weekStartAt,
          skillTrialCount: weeklyTrials.weeklyTrialSet.skillHrids.length,
          combatTrialCount: weeklyTrials.weeklyTrialSet.combatHrids.length,
          monsterCount,
          receivedAt: timestamp,
          ...(weeklyTrials.staleCapacityTrials?.length
            ? { staleCapacityTrials: weeklyTrials.staleCapacityTrials }
            : {}),
        });
      }

      if (parts[0] === "api" && parts[1] === "public" && parts[2] === "guilds" && parts[3] && parts[4] === "members" && parts[5] && parts.length >= 7) {
        const guildConfig = requireRegisteredGuild(safeId(parts[3], "guildSlug", GUILD_ID));
        const guildId = guildConfig.slug;
        const memberId = safeId(parts[5], "memberId");
        const member = db.prepare("SELECT display_name FROM members WHERE guild_id = ? AND member_id = ? AND active = 1").get(guildId, memberId);
        if (req.method === "GET" && parts[6] === "eligibility" && parts.length === 7) {
          return json(res, 200, {
            guildId,
            memberId,
            eligible: Boolean(member),
            rosterSyncAllowed: Boolean(member) && guildConfig.reporters.has(memberId),
          });
        }
        if (req.method === "POST" && parts[6] === "snapshots" && parts.length === 7) {
          if (!member) throw fail(403, "member_not_in_tmd", "character is not registered in the TMD guild roster");
          checkPublicUploadRate(req, memberId);
          const snapshot = sanitizeMemberSnapshot(await readJson(req), guildId, memberId);
          const timestamp = now();
          const result = db.prepare("INSERT INTO snapshots (guild_id, member_id, captured_at, received_at, payload_json) VALUES (?, ?, ?, ?, ?)").run(guildId, memberId, snapshot.capturedAt, timestamp, safeJson(snapshot, "snapshot"));
          db.prepare("UPDATE members SET display_name = ?, updated_at = ? WHERE guild_id = ? AND member_id = ?").run(snapshot.displayName, timestamp, guildId, memberId);
          return json(res, 201, { snapshotId: Number(result.lastInsertRowid), receivedAt: timestamp });
        }
      }

      if (parts[0] === "api" && parts[1] === "guilds" && parts.length >= 3) {
        const guildId = safeId(parts[2], "guildId", GUILD_ID);
        if (req.method === "GET" && parts[3] === "members" && parts.length === 4) {
          requireAdmin(req);
          const members = db.prepare(`
            SELECT m.member_id, m.display_name, m.updated_at,
              (SELECT s.received_at FROM snapshots s WHERE s.guild_id = m.guild_id AND s.member_id = m.member_id ORDER BY s.id DESC LIMIT 1) AS snapshot_received_at,
              (SELECT s.payload_json FROM snapshots s WHERE s.guild_id = m.guild_id AND s.member_id = m.member_id ORDER BY s.id DESC LIMIT 1) AS snapshot_json
            FROM members m WHERE m.guild_id = ? AND m.active = 1 ORDER BY m.display_name, m.member_id
          `).all(guildId).map((member) => ({
            memberId: member.member_id,
            displayName: member.display_name,
            updatedAt: member.updated_at,
            snapshotReceivedAt: member.snapshot_received_at ?? null,
            latestSnapshot: member.snapshot_json ? JSON.parse(member.snapshot_json) : null,
          }));
          return json(res, 200, { guildId, members });
        }
        if (req.method === "GET" && parts[3] === "qq-bindings" && parts.length === 4) {
          requireAdmin(req);
          const qqNumber = url.searchParams.get("qqNumber");
          const rows = qqNumber
            ? db.prepare("SELECT qq_number, member_id, combat_type, updated_at FROM qq_bindings WHERE guild_id = ? AND qq_number = ? ORDER BY member_id").all(guildId, qqNumber)
            : db.prepare("SELECT qq_number, member_id, combat_type, updated_at FROM qq_bindings WHERE guild_id = ? ORDER BY qq_number, member_id").all(guildId);
          return json(res, 200, {
            guildId,
            bindings: rows.map((row) => ({
              qqNumber: row.qq_number,
              memberId: row.member_id,
              combatType: row.combat_type,
              updatedAt: row.updated_at,
            })),
          });
        }
        if (req.method === "GET" && parts[3] === "trial-registrations" && parts[4] === "current" && parts.length === 5) {
          requireAdmin(req);
          const rows = db.prepare(`
            SELECT r.id, r.week_start_at, r.trial_hrid, r.trial_name, r.registered_count,
              r.captured_at, r.received_at, r.reporter_member_id, r.payload_json
            FROM trial_registration_snapshots r
            WHERE r.guild_id = ?
              AND r.id = (
                SELECT MAX(latest.id)
                FROM trial_registration_snapshots latest
                WHERE latest.guild_id = r.guild_id AND latest.trial_hrid = r.trial_hrid
              )
            ORDER BY r.trial_hrid
          `).all(guildId);
          if (!rows.length) {
            return json(res, 404, {
              error: {
                code: "trial_registrations_not_found",
                message: "no combat trial registration snapshot is available",
              },
            });
          }
          return json(res, 200, {
            guildId,
            trials: rows.map((row) => {
              const payload = JSON.parse(row.payload_json);
              return {
                snapshotId: row.id,
                weekStartAt: row.week_start_at,
                capturedAt: row.captured_at,
                receivedAt: row.received_at,
                reporterMemberId: row.reporter_member_id,
                ...payload,
                kind: payload.kind ?? trialKindForHrid(row.trial_hrid),
              };
            }),
          });
        }
        if (req.method === "GET" && parts[3] === "weekly-trials" && parts[4] === "current" && parts.length === 5) {
          requireAdmin(req);
          const row = db.prepare(`
            SELECT id, reporter_member_id, week_start_at, captured_at, received_at, payload_json
            FROM weekly_trial_catalog_snapshots
            WHERE guild_id = ?
            ORDER BY id DESC
            LIMIT 1
          `).get(guildId);
          if (!row) {
            return json(res, 404, {
              error: {
                code: "weekly_trials_not_found",
                message: "no weekly trial catalog snapshot is available",
              },
            });
          }
          return json(res, 200, {
            snapshotId: row.id,
            guildId,
            reporterMemberId: row.reporter_member_id,
            weekStartAt: row.week_start_at,
            capturedAt: row.captured_at,
            receivedAt: row.received_at,
            ...JSON.parse(row.payload_json),
          });
        }
        if (req.method === "POST" && parts[3] === "members" && parts[5] === "snapshots" && parts.length === 6) {
          const memberId = safeId(parts[4], "memberId"); requireMember(req, guildId, memberId);
          const snapshot = sanitizeMemberSnapshot(await readJson(req), guildId, memberId);
          const timestamp = now();
          const result = db.prepare("INSERT INTO snapshots (guild_id, member_id, captured_at, received_at, payload_json) VALUES (?, ?, ?, ?, ?)").run(guildId, memberId, snapshot.capturedAt, timestamp, safeJson(snapshot, "snapshot"));
          db.prepare("UPDATE members SET display_name = ?, updated_at = ? WHERE guild_id = ? AND member_id = ?").run(snapshot.displayName, timestamp, guildId, memberId);
          return json(res, 201, { snapshotId: Number(result.lastInsertRowid), receivedAt: timestamp });
        }
        if (req.method === "GET" && parts[3] === "assignments" && (parts[4] === "formal" || parts[4] === "test") && parts.length === 5) {
          requireAdmin(req); const current = assignment(guildId, parts[4]);
          if (!current) return json(res, 404, { error: { code: "assignment_not_found", message: `no ${parts[4]} assignment is available` } });
          return json(res, 200, { id: current.id, kind: parts[4], locked: Boolean(current.locked), createdAt: current.created_at, assignment: JSON.parse(current.payload_json) });
        }
        if (parts[3] === "test-report-assets" && parts.length === 4) {
          requireAdmin(req);
          if (!guildExists(guildId)) throw fail(404, "guild_not_found", "guild does not exist");
          const reportDirectory = requireTestReportDirectory();
          if (req.method === "GET") {
            const manifestPath = join(reportDirectory, "manifest.json");
            let manifest;
            try {
              manifest = JSON.parse(await readFile(manifestPath, "utf8"));
            } catch (error) {
              if (error && error.code === "ENOENT") {
                throw fail(404, "test_report_not_found", "test report assets are not present on the API host");
              }
              throw error;
            }
            const files = Array.isArray(manifest.files) ? manifest.files : [];
            const images = [];
            for (const entry of files) {
              const fileName = entry?.fileName;
              if (
                typeof fileName !== "string" ||
                basename(fileName) !== fileName ||
                !isAllowedTestReportFileName(fileName)
              ) {
                throw fail(500, "test_report_corrupt", "test report manifest contains an invalid file name");
              }
              const bytes = await readFile(join(reportDirectory, fileName));
              images.push({
                title: typeof entry.title === "string" ? entry.title : fileName,
                fileName,
                base64: bytes.toString("base64"),
              });
            }
            return json(res, 200, {
              assignmentGeneratedAt: manifest.assignmentGeneratedAt ?? null,
              generatedAt: manifest.generatedAt ?? null,
              files: images,
            });
          }
          if (req.method === "PUT") {
            const body = await readJson(req, { maxBytes: MAX_TEST_REPORT_BODY_BYTES });
            ensureKeys(body, new Set(["assignmentGeneratedAt", "files"]), "testReportAssets");
            const assignmentGeneratedAt = text(body.assignmentGeneratedAt, "testReportAssets.assignmentGeneratedAt", 64);
            if (!Array.isArray(body.files) || body.files.length !== 4) {
              throw fail(400, "invalid_field", "testReportAssets.files must contain exactly 4 entries");
            }
            const prepared = [];
            for (const [index, entry] of body.files.entries()) {
              const row = object(entry, `testReportAssets.files[${index}]`);
              ensureKeys(row, new Set(["fileName", "base64", "title"]), `testReportAssets.files[${index}]`);
              const fileName = text(row.fileName, `testReportAssets.files[${index}].fileName`, 128);
              if (basename(fileName) !== fileName || !isAllowedTestReportFileName(fileName)) {
                throw fail(400, "invalid_field", `testReportAssets.files[${index}].fileName is not an allowed report image name`);
              }
              const base64 = text(row.base64, `testReportAssets.files[${index}].base64`, MAX_TEST_REPORT_BODY_BYTES);
              let bytes;
              try {
                bytes = Buffer.from(base64, "base64");
              } catch {
                throw fail(400, "invalid_field", `testReportAssets.files[${index}].base64 is invalid`);
              }
              if (bytes.length < 8_000) {
                throw fail(400, "invalid_field", `testReportAssets.files[${index}] image is unexpectedly small`);
              }
              prepared.push({
                fileName,
                title: typeof row.title === "string" ? row.title.slice(0, 200) : fileName,
                bytes,
              });
            }
            await mkdir(reportDirectory, { recursive: true });
            for (const file of prepared) {
              await writeFile(join(reportDirectory, file.fileName), file.bytes);
            }
            const manifest = {
              schemaVersion: 1,
              assignmentGeneratedAt,
              generatedAt: now(),
              files: prepared.map((file) => ({
                title: file.title,
                fileName: file.fileName,
              })),
            };
            await writeFile(
              join(reportDirectory, "manifest.json"),
              `${JSON.stringify(manifest, null, 2)}\n`,
              "utf8",
            );
            return json(res, 200, {
              ok: true,
              directory: reportDirectory,
              assignmentGeneratedAt,
              files: manifest.files,
            });
          }
        }
        if (req.method === "GET" && parts[3] === "life-assignments" && (parts[4] === "formal" || parts[4] === "test") && parts.length === 5) {
          requireAdmin(req);
          const current = lifeAssignment(guildId, parts[4]);
          if (!current) {
            return json(res, 404, {
              error: {
                code: "life_assignment_not_found",
                message: `no ${parts[4]} life assignment is available`,
              },
            });
          }
          return json(res, 200, {
            id: current.id,
            kind: parts[4],
            weekStartAt: current.week_start_at,
            createdAt: current.created_at,
            assignment: JSON.parse(current.payload_json),
          });
        }
        if (req.method === "POST" && parts[3] === "jobs" && parts.length === 4) {
          requireAdmin(req); if (!guildExists(guildId)) throw fail(404, "guild_not_found", "guild does not exist");
          const body = await readJson(req); ensureKeys(body, new Set(["mode"]), "job"); const mode = text(body.mode, "job.mode", 16);
          if (!["normal", "test", "full"].includes(mode)) throw fail(400, "invalid_field", "job.mode must be normal, test, or full");
          if (mode === "full") return json(res, 409, { error: { code: "simulation_unsupported", message: "full simulation is blocked: the production simulation engine is not ready" }, status: "blocked" });
          const timestamp = now(); const result = { reason: "simulation-engine-not-ready", safeToFinalize: true };
          const inserted = db.prepare("INSERT INTO simulation_jobs (guild_id, mode, status, progress, created_at, updated_at, result_json, error_code) VALUES (?, ?, 'blocked', 0, ?, ?, ?, 'simulation_engine_unavailable')").run(guildId, mode, timestamp, timestamp, JSON.stringify(result));
          return json(res, 202, { id: Number(inserted.lastInsertRowid), mode, status: "blocked", progress: 0, result });
        }
        if (parts[3] === "jobs" && parts[4] && parts.length === 5 && /^\d+$/.test(parts[4])) {
          requireAdmin(req); const jobId = Number(parts[4]); const job = db.prepare("SELECT * FROM simulation_jobs WHERE id = ? AND guild_id = ?").get(jobId, guildId);
          if (!job) throw fail(404, "job_not_found", "simulation job does not exist");
          if (req.method === "GET") return json(res, 200, serializeJob(job));
          if (req.method === "DELETE") {
            const timestamp = now(); const result = { ...(job.result_json ? JSON.parse(job.result_json) : {}), finalization: "safe-no-partial-assignment-published", cancelledAt: timestamp };
            db.prepare("UPDATE simulation_jobs SET status = 'cancelled', cancel_requested = 1, updated_at = ?, result_json = ? WHERE id = ?").run(timestamp, JSON.stringify(result), jobId);
            return json(res, 200, { ...serializeJob({ ...job, status: "cancelled", cancel_requested: 1, updated_at: timestamp, result_json: JSON.stringify(result) }), cancellation: "safe-finalized" });
          }
        }
      }
      if (parts[0] === "api" && parts[1] === "admin") {
        requireAdmin(req);
        if (req.method === "PUT" && parts[2] === "guilds" && parts[3] && parts.length === 4) {
          const guildId = safeId(parts[3], "guildId", GUILD_ID); const body = await readJson(req); ensureKeys(body, new Set(["name"]), "guild");
          db.prepare("INSERT INTO guilds (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").run(guildId, text(body.name, "guild.name", 100), now());
          return json(res, 200, { id: guildId });
        }
        if (parts[2] === "guilds" && parts[3] && parts[4] === "members" && parts.length === 5 && req.method === "PUT") {
          const guildId = safeId(parts[3], "guildId", GUILD_ID); if (!guildExists(guildId)) throw fail(404, "guild_not_found", "guild does not exist");
          // This is the one credential-provisioning endpoint. Its token value is
          // accepted only over admin auth and is never returned by any endpoint.
          const body = await readJson(req); for (const key of Object.keys(body)) if (!["memberId", "displayName", "memberToken"].includes(key)) throw fail(400, "unknown_field", `member.${key} is not accepted`); const memberId = safeId(body.memberId, "member.memberId"); const memberToken = text(body.memberToken, "member.memberToken", 512); const timestamp = now();
          db.prepare("INSERT INTO members (guild_id, member_id, display_name, member_token, created_at, updated_at, active) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(guild_id, member_id) DO UPDATE SET display_name = excluded.display_name, member_token = excluded.member_token, updated_at = excluded.updated_at, active = 1").run(guildId, memberId, text(body.displayName, "member.displayName", 100), hashMemberToken(memberToken), timestamp, timestamp);
          return json(res, 200, { guildId, memberId });
        }
        if (parts[2] === "guilds" && parts[3] && parts[4] === "assignments" && (parts[5] === "formal" || parts[5] === "test") && parts.length === 6 && req.method === "PUT") {
          const guildId = safeId(parts[3], "guildId", GUILD_ID); if (!guildExists(guildId)) throw fail(404, "guild_not_found", "guild does not exist"); const body = await readJson(req); ensureKeys(body, new Set(["assignment", "locked"]), "assignment");
          if (parts[5] === "formal" && body.assignment && typeof body.assignment === "object" && body.assignment.promotable === false) {
            throw fail(409, "assignment_not_promotable", "development or invalidated assignment cannot be promoted to formal");
          }
          if (typeof body.locked !== "boolean") throw fail(400, "invalid_field", "assignment.locked must be boolean"); const timestamp = now(); const inserted = db.prepare("INSERT INTO assignments (guild_id, kind, locked, created_at, payload_json) VALUES (?, ?, ?, ?, ?)").run(guildId, parts[5], body.locked ? 1 : 0, timestamp, safeJson(body.assignment, "assignment"));
          return json(res, 201, { id: Number(inserted.lastInsertRowid), kind: parts[5], locked: body.locked });
        }
        if (parts[2] === "guilds" && parts[3] && parts[4] === "life-assignments" && (parts[5] === "formal" || parts[5] === "test") && parts.length === 6 && req.method === "PUT") {
          const guildId = safeId(parts[3], "guildId", GUILD_ID);
          if (!guildExists(guildId)) throw fail(404, "guild_not_found", "guild does not exist");
          const body = await readJson(req);
          ensureKeys(body, new Set(["assignment"]), "lifeAssignment");
          const assignment = sanitizeLifeAssignment(body.assignment, "lifeAssignment");
          const timestamp = now();
          const inserted = db.prepare(`
            INSERT INTO life_assignment_runs (guild_id, kind, week_start_at, created_at, payload_json)
            VALUES (?, ?, ?, ?, ?)
          `).run(guildId, parts[5], assignment.weekStartAt, timestamp, safeJson(assignment, "lifeAssignment"));
          return json(res, 201, {
            id: Number(inserted.lastInsertRowid),
            kind: parts[5],
            weekStartAt: assignment.weekStartAt,
            createdAt: timestamp,
          });
        }
        if (parts[2] === "guilds" && parts[3] && parts[4] === "qq-bindings" && parts[5] && parts.length === 6 && req.method === "PUT") {
          const guildId = safeId(parts[3], "guildId", GUILD_ID); const qq = text(parts[5], "qqNumber", 32); const body = await readJson(req); ensureKeys(body, new Set(["memberId", "combatType"]), "qqBinding"); const memberId = safeId(body.memberId, "qqBinding.memberId");
          if (!db.prepare("SELECT 1 FROM members WHERE guild_id = ? AND member_id = ? AND active = 1").get(guildId, memberId)) throw fail(400, "member_not_in_guild", "binding member must be in the current guild"); const combatType = text(body.combatType, "qqBinding.combatType", 32); const timestamp = now();
          db.prepare("INSERT INTO qq_bindings (guild_id, qq_number, member_id, combat_type, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, member_id) DO UPDATE SET qq_number = excluded.qq_number, combat_type = excluded.combat_type, updated_at = excluded.updated_at").run(guildId, qq, memberId, combatType, timestamp);
          return json(res, 200, { guildId, qqNumber: qq, memberId, combatType });
        }
        if (parts[2] === "guilds" && parts[3] && parts[4] === "qq-bindings" && parts[5] === "by-member" && parts[6] && parts.length === 7 && req.method === "DELETE") {
          const guildId = safeId(parts[3], "guildId", GUILD_ID); const memberId = safeId(parts[6], "memberId");
          const deleted = db.prepare("DELETE FROM qq_bindings WHERE guild_id = ? AND member_id = ?").run(guildId, memberId);
          if (!deleted.changes) throw fail(404, "binding_not_found", "combat binding does not exist");
          return json(res, 200, { guildId, memberId, removed: true });
        }
        if (parts[2] === "guilds" && parts[3] && parts[4] === "auras" && parts[5] && parts.length === 6 && req.method === "PUT") {
          const guildId = safeId(parts[3], "guildId", GUILD_ID); const memberId = safeId(parts[5], "memberId"); const body = await readJson(req); ensureKeys(body, new Set(["auraType", "level"]), "aura");
          if (!db.prepare("SELECT 1 FROM members WHERE guild_id = ? AND member_id = ? AND active = 1").get(guildId, memberId)) throw fail(400, "member_not_in_guild", "aura member must be in the current guild"); const auraType = text(body.auraType, "aura.auraType", 32); const level = integer(body.level, "aura.level", 1, 200); const timestamp = now();
          db.prepare("INSERT INTO auras (guild_id, member_id, aura_type, level, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, member_id, aura_type) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at").run(guildId, memberId, auraType, level, timestamp);
          return json(res, 200, { guildId, memberId, auraType, level });
        }
        if (parts[2] === "plugin-versions" && parts[3] && parts.length === 4 && req.method === "PUT") {
          const pluginId = safeId(parts[3], "pluginId"); const body = await readJson(req); ensureKeys(body, new Set(["version", "installUrl", "notes"]), "pluginVersion"); const updatedAt = now(); const installUrl = text(body.installUrl, "pluginVersion.installUrl", 2048); if (!/^https?:\/\//.test(installUrl)) throw fail(400, "invalid_field", "pluginVersion.installUrl must be HTTP(S)");
          db.prepare("INSERT INTO plugin_versions (plugin_id, version, install_url, updated_at, notes) VALUES (?, ?, ?, ?, ?) ON CONFLICT(plugin_id) DO UPDATE SET version = excluded.version, install_url = excluded.install_url, updated_at = excluded.updated_at, notes = excluded.notes").run(pluginId, text(body.version, "pluginVersion.version", 64), installUrl, updatedAt, typeof body.notes === "string" ? body.notes.slice(0, 500) : "");
          return json(res, 200, { pluginId, updatedAt });
        }
      }
      throw fail(404, "not_found", "route not found");
    } catch (error) {
      const status = error.status ?? 500;
      let pathname = "invalid-url";
      try { pathname = new URL(req.url, "http://localhost").pathname; } catch { /* keep safe fallback */ }
      console.error(JSON.stringify({
        timestamp: now(),
        method: req.method,
        pathname,
        status,
        code: error.code ?? "internal_error",
        message: error.status ? error.message : "internal server error",
      }));
      json(res, status, { error: { code: error.code ?? "internal_error", message: error.status ? error.message : "internal server error" } });
    }
  });
  return { server, db, close() { server.close(); db.close(); } };
}

function serializeJob(job) {
  return { id: job.id, guildId: job.guild_id, mode: job.mode, status: job.status, progress: job.progress, cancelRequested: Boolean(job.cancel_requested), createdAt: job.created_at, updatedAt: job.updated_at, errorCode: job.error_code, result: job.result_json ? JSON.parse(job.result_json) : null };
}

export async function listenFromEnvironment() {
  const api = await createGuildApi(); const host = process.env.MWI_GUILD_API_HOST ?? "127.0.0.1"; const port = Number(process.env.MWI_GUILD_API_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MWI_GUILD_API_PORT must be a TCP port");
  await new Promise((resolveListen, rejectListen) => api.server.once("error", rejectListen).listen(port, host, resolveListen));
  return api;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  listenFromEnvironment().then(() => console.log("MWI guild API listening on local interface")).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
