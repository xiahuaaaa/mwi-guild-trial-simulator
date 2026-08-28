#!/usr/bin/env node
/**
 * Audit who can enter the bound-roster battle simulation right now.
 *
 * Sources (pick one):
 *   MWI_GUILD_API_BASE + MWI_GUILD_API_ADMIN_KEY  → production API
 *   MWI_GUILD_API_DB_PATH                         → local/online sqlite
 *
 * Classification uses packages/optimizer/src/combat-member-readiness.mjs
 * (same gate as run-bound-roster-full-engine-lab.mjs):
 *   available   = assessCombatMemberReadiness(...).ok
 *   unavailable = anything short of that (reason listed)
 *
 * Combat signup cross-check uses the current week's trial-registration
 * snapshots when available (API) / trial_registration_snapshots (sqlite).
 *
 * Usage:
 *   MWI_GUILD_API_BASE=https://adudu.tailab136f.ts.net \
 *   MWI_GUILD_API_ADMIN_KEY=... \
 *   node scripts/audit-combat-sim-availability.mjs
 *
 *   MWI_GUILD_API_DB_PATH=/path/to/qq-test.sqlite \
 *   node scripts/audit-combat-sim-availability.mjs
 *
 * Optional:
 *   MWI_GUILD_ID=TMD
 *   MWI_AUDIT_OUTPUT=/tmp/combat-sim-availability.json
 */
import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessCombatMemberReadiness } from "../packages/optimizer/src/combat-member-readiness.mjs";

const guildId = process.env.MWI_GUILD_ID ?? "TMD";
const apiBase = (process.env.MWI_GUILD_API_BASE ?? "").replace(/\/$/u, "");
const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY ?? "";
const databasePath = process.env.MWI_GUILD_API_DB_PATH ?? "";
const outputPath =
  process.env.MWI_AUDIT_OUTPUT ??
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".local",
    "combat-sim-availability.json",
  );

const COMBAT_TRIAL_PREFIX = "/guild_combat/";

export function classifyBoundMember(binding) {
  const base = {
    memberId: binding.memberId,
    combatType: binding.combatType ?? null,
  };
  const readiness = assessCombatMemberReadiness(
    binding.snapshot,
    binding.combatType,
  );
  if (!readiness.ok) {
    return {
      ...base,
      available: false,
      reason: readiness.reason,
      attackLevel: readiness.attackLevel,
      missingNonDefaultableAbilityHrids:
        readiness.missingNonDefaultableAbilityHrids,
    };
  }
  return {
    ...base,
    available: true,
    reason: null,
    buildSelectionSource: readiness.buildSource,
    defaultedAbilityHrids: readiness.defaultedAbilityHrids,
    defaultedSkillNames: readiness.defaultedSkillNames,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "x-admin-key": adminKey,
      accept: "application/json",
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(
      `${url} → HTTP ${response.status}: ${body?.error?.message ?? text.slice(0, 200)}`,
    );
  }
  return body;
}

async function loadFromApi() {
  const [membersBody, bindingsBody, regsBody] = await Promise.all([
    fetchJson(`${apiBase}/api/guilds/${encodeURIComponent(guildId)}/members`),
    fetchJson(
      `${apiBase}/api/guilds/${encodeURIComponent(guildId)}/qq-bindings`,
    ),
    fetchJson(
      `${apiBase}/api/guilds/${encodeURIComponent(guildId)}/trial-registrations/current`,
    ).catch(() => ({ trials: [] })),
  ]);
  const bindingsByMember = new Map(
    (bindingsBody.bindings ?? []).map((row) => [row.memberId, row]),
  );
  const members = (membersBody.members ?? []).map((member) => {
    const binding = bindingsByMember.get(member.memberId);
    return {
      memberId: member.memberId,
      displayName: member.displayName ?? member.memberId,
      combatType: binding?.combatType ?? null,
      snapshot: member.latestSnapshot ?? null,
      snapshotReceivedAt: member.snapshotReceivedAt ?? null,
    };
  });
  return {
    source: `api:${apiBase}`,
    members,
    combatTrials: (regsBody.trials ?? []).filter((trial) =>
      String(trial.trialHrid ?? "").startsWith(COMBAT_TRIAL_PREFIX),
    ),
  };
}

function loadFromSqlite() {
  const db = new DatabaseSync(databasePath);
  try {
    const members = db
      .prepare(
        `SELECT m.member_id, m.display_name,
                q.combat_type,
                (SELECT s.received_at FROM snapshots s
                  WHERE s.guild_id = m.guild_id AND s.member_id = m.member_id
                  ORDER BY s.id DESC LIMIT 1) AS snapshot_received_at,
                (SELECT s.payload_json FROM snapshots s
                  WHERE s.guild_id = m.guild_id AND s.member_id = m.member_id
                  ORDER BY s.id DESC LIMIT 1) AS snapshot_json
         FROM members m
         LEFT JOIN qq_bindings q
           ON q.guild_id = m.guild_id AND q.member_id = m.member_id
         WHERE m.guild_id = ? AND m.active = 1
         ORDER BY m.display_name, m.member_id`,
      )
      .all(guildId)
      .map((row) => ({
        memberId: row.member_id,
        displayName: row.display_name ?? row.member_id,
        combatType: row.combat_type ?? null,
        snapshot: row.snapshot_json ? JSON.parse(row.snapshot_json) : null,
        snapshotReceivedAt: row.snapshot_received_at ?? null,
      }));

    const combatTrials = db
      .prepare(
        `SELECT r.trial_hrid, r.trial_name, r.registered_count, r.payload_json,
                r.week_start_at, r.captured_at, r.received_at
         FROM trial_registration_snapshots r
         WHERE r.guild_id = ?
           AND r.trial_hrid LIKE '/guild_combat/%'
           AND r.id = (
             SELECT MAX(latest.id)
             FROM trial_registration_snapshots latest
             WHERE latest.guild_id = r.guild_id
               AND latest.trial_hrid = r.trial_hrid
           )
         ORDER BY r.trial_hrid`,
      )
      .all(guildId)
      .map((row) => {
        const payload = row.payload_json ? JSON.parse(row.payload_json) : {};
        return {
          trialHrid: row.trial_hrid,
          trialName: row.trial_name,
          registeredCount: row.registered_count,
          weekStartAt: row.week_start_at,
          capturedAt: row.captured_at,
          receivedAt: row.received_at,
          members: payload.members ?? [],
        };
      });

    return {
      source: `sqlite:${databasePath}`,
      members,
      combatTrials,
    };
  } finally {
    db.close();
  }
}

function buildReport(bundle) {
  const classified = bundle.members
    .map((member) => {
      const row = classifyBoundMember(member);
      return {
        ...row,
        displayName: member.displayName,
        snapshotReceivedAt: member.snapshotReceivedAt,
      };
    })
    .sort((left, right) =>
      left.memberId.localeCompare(right.memberId, "en"),
    );

  const available = classified.filter((row) => row.available);
  const unavailable = classified.filter((row) => !row.available);
  const byReason = new Map();
  for (const row of unavailable) {
    const key = row.reason ?? "未知原因";
    if (!byReason.has(key)) byReason.set(key, []);
    byReason.get(key).push(row.memberId);
  }

  const memberIndex = new Map(
    classified.map((row) => [row.memberId.toLowerCase(), row]),
  );

  const trials = (bundle.combatTrials ?? []).map((trial) => {
    const signups = (trial.members ?? []).map((signup) => {
      const memberId = signup.memberId ?? signup.characterName ?? "";
      const classifiedRow = memberIndex.get(String(memberId).toLowerCase());
      if (!classifiedRow) {
        return {
          memberId,
          available: false,
          combatType: null,
          reason: "不在当前公会名单或无员记录中",
        };
      }
      return {
        memberId: classifiedRow.memberId,
        available: classifiedRow.available,
        combatType: classifiedRow.combatType,
        reason: classifiedRow.reason,
      };
    });
    return {
      trialHrid: trial.trialHrid,
      trialName: trial.trialName,
      registeredCount: trial.registeredCount ?? signups.length,
      available: signups.filter((row) => row.available),
      unavailable: signups.filter((row) => !row.available),
      signups,
    };
  });

  return {
    guildId,
    generatedAt: new Date().toISOString(),
    source: bundle.source,
    totals: {
      roster: classified.length,
      bound: classified.filter((row) => row.combatType).length,
      uploaded: classified.filter((row) => row.snapshotReceivedAt).length,
      available: available.length,
      unavailable: unavailable.length,
    },
    available: available.map((row) => ({
      memberId: row.memberId,
      combatType: row.combatType,
      buildSelectionSource: row.buildSelectionSource,
      defaultedSkillNames: row.defaultedSkillNames || undefined,
    })),
    unavailable: unavailable.map((row) => ({
      memberId: row.memberId,
      combatType: row.combatType,
      reason: row.reason,
      attackLevel: row.attackLevel,
    })),
    unavailableByReason: Object.fromEntries(
      [...byReason.entries()].map(([reason, members]) => [reason, members]),
    ),
    combatTrials: trials,
  };
}

function printReport(report) {
  const lines = [];
  lines.push(
    `战斗模拟可用性（${report.guildId}） source=${report.source}`,
  );
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push(
    `名单 ${report.totals.roster}｜已绑定 ${report.totals.bound}｜已上传 ${report.totals.uploaded}｜可直接模拟 ${report.totals.available}｜不可用 ${report.totals.unavailable}`,
  );
  lines.push("");
  lines.push(`=== 可用（${report.available.length}）===`);
  for (const [index, row] of report.available.entries()) {
    lines.push(
      `${String(index + 1).padStart(2, " ")}. ${row.memberId}  ${row.combatType}`,
    );
  }
  lines.push("");
  lines.push(`=== 不可用（${report.unavailable.length}）===`);
  for (const [reason, members] of Object.entries(report.unavailableByReason)) {
    lines.push(`· ${reason}（${members.length}）`);
    lines.push(`  ${members.join("、")}`);
  }
  for (const trial of report.combatTrials) {
    lines.push("");
    lines.push(
      `=== ${trial.trialName ?? trial.trialHrid} 报名 ${trial.registeredCount}｜可用 ${trial.available.length}｜不可用 ${trial.unavailable.length} ===`,
    );
    if (trial.available.length) {
      lines.push("可用：");
      for (const [index, row] of trial.available.entries()) {
        lines.push(
          `${String(index + 1).padStart(2, " ")}. ${row.memberId}  ${row.combatType}`,
        );
      }
    }
    if (trial.unavailable.length) {
      lines.push("不可用：");
      for (const [index, row] of trial.unavailable.entries()) {
        lines.push(
          `${String(index + 1).padStart(2, " ")}. ${row.memberId}  ${row.combatType ?? "未绑定"}  — ${row.reason}`,
        );
      }
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
}

async function main() {
  let bundle;
  if (apiBase && adminKey) {
    bundle = await loadFromApi();
  } else if (databasePath) {
    bundle = loadFromSqlite();
  } else {
    throw new Error(
      "Set MWI_GUILD_API_BASE+MWI_GUILD_API_ADMIN_KEY or MWI_GUILD_API_DB_PATH",
    );
  }
  const report = buildReport(bundle);
  printReport(report);
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  process.stderr.write(`wrote ${outputPath}\n`);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
