#!/usr/bin/env node
/**
 * A/B: chameleon progress with vs without a named member swapped onto the team.
 *
 * Usage:
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/ab-chameleon-member-presence.mjs qingyuyou
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import os from "node:os";
import {
  buildPlayerMember,
  defaultAbility,
} from "../packages/shykai-full-runtime/src/guild-trial-runner.mjs";
import { selectCombatBuild } from "../packages/optimizer/src/combat-build-selection.mjs";
import { prepareSnapshotForCombat } from "../packages/optimizer/src/combat-member-readiness.mjs";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiBase = (
  process.env.MWI_GUILD_API_BASE ?? "http://127.0.0.1:8787"
).replace(/\/$/, "");
const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY;
const guildId = process.env.MWI_GUILD_ID ?? "TMD";
const memberName = String(process.argv[2] ?? "qingyuyou").trim();
const seeds = [1297565953, 1297565954, 1297565955];
const durationSeconds = Number(
  process.env.MWI_GUILD_FINAL_DURATION_SECONDS ?? 3600,
);
const workerCount = Math.max(
  1,
  Number(process.env.MWI_GUILD_SIM_WORKERS ?? Math.min(6, os.cpus().length || 4)),
);

if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required");
if (!memberName) throw new Error("usage: node scripts/ab-chameleon-member-presence.mjs <memberId>");

const lab = JSON.parse(
  await readFile(
    path.join(projectDirectory, ".local/tmd-available-roster-composition-lab.json"),
    "utf8",
  ),
);
const fixture = JSON.parse(
  await readFile(
    path.join(
      projectDirectory,
      process.env.MWI_GUILD_TRIAL_FIXTURE ??
        "fixtures/monsters/guild-trial-2026-08-14-hedgehog-swarm.json",
    ),
    "utf8",
  ),
);
const chameleonBoss = (fixture.bosses ?? []).find((boss) =>
  String(boss.hrid ?? "").includes("chameleon"),
);
if (!chameleonBoss) throw new Error("fixture missing chameleon boss");
const chameleon = (lab.bosses ?? []).find((boss) =>
  String(boss.bossName ?? "").includes("变色龙") ||
  String(boss.bossId ?? "").includes("chameleon"),
);
if (!chameleon?.roster?.length) {
  throw new Error("latest lab JSON missing chameleon roster");
}

const [membersData, bindingsData] = await Promise.all([
  apiGet(`/api/guilds/${encodeURIComponent(guildId)}/members`),
  apiGet(`/api/guilds/${encodeURIComponent(guildId)}/qq-bindings`),
]);
const memberMap = new Map(
  (membersData.members ?? []).map((row) => [String(row.memberId), row]),
);
const bindingMap = new Map(
  (bindingsData.bindings ?? []).map((row) => [
    String(row.memberId).toLocaleLowerCase("en-US"),
    row,
  ]),
);

const targetKey = memberName.toLocaleLowerCase("en-US");
const targetBinding = bindingMap.get(targetKey);
if (!targetBinding) throw new Error(`${memberName} has no combat binding`);

const onChameleon = chameleon.roster.find(
  (row) => String(row.memberId).toLocaleLowerCase("en-US") === targetKey,
);
const onSwarm = (lab.bosses ?? [])
  .find((boss) => String(boss.bossName ?? "").includes("虫群"))
  ?.roster?.find(
    (row) => String(row.memberId).toLocaleLowerCase("en-US") === targetKey,
  );

const withoutRoster = chameleon.roster.map((row) => ({ ...row }));
let withRoster;
let replaced = null;
if (onChameleon) {
  // Already on chameleon: WITH = current; WITHOUT = drop them (51).
  withRoster = withoutRoster;
  const dropped = withoutRoster.filter(
    (row) => String(row.memberId).toLocaleLowerCase("en-US") !== targetKey,
  );
  console.log(
    `现状：${memberName} 已在变色龙。参加=含本人(${withRoster.length})；不参加=去掉本人(${dropped.length})`,
  );
  await runCompare({
    withRoster,
    withoutRoster: dropped,
    note: "drop-from-current",
  });
} else {
  // Not on chameleon: WITHOUT = current; WITH = swap onto same combat type.
  const combatType = onSwarm?.combatType ?? targetBinding.combatType;
  const peers = withoutRoster
    .filter((row) => row.combatType === combatType)
    .map((row) => ({
      row,
      level: combatLevel(row.memberId, combatType),
    }))
    .sort(
      (left, right) =>
        left.level - right.level ||
        left.row.memberId.localeCompare(right.row.memberId),
    );
  if (!peers.length) {
    throw new Error(`chameleon has no ${combatType} to swap for ${memberName}`);
  }
  replaced = peers[0].row;
  const incoming = onSwarm ?? {
    memberId: targetBinding.memberId,
    combatType,
    duty: "dps",
    abilityHrids: null,
  };
  withRoster = withoutRoster.map((row) =>
    row.memberId === replaced.memberId
      ? {
          ...incoming,
          memberId: targetBinding.memberId,
          combatType,
          duty: incoming.duty ?? replaced.duty ?? "dps",
          abilityHrids: incoming.abilityHrids ?? replaced.abilityHrids,
          abilityLevels: incoming.abilityLevels ?? replaced.abilityLevels,
          auraHrid: incoming.auraHrid ?? null,
        }
      : row
  );
  console.log(
    `现状：${memberName} 在虫群（${combatType}）。\n` +
      `不参加变色龙 = 当前 ${withoutRoster.length} 人\n` +
      `参加变色龙 = 换上 ${memberName}，换下 ${replaced.memberId}` +
      `（同职业最低战斗等级 ${peers[0].level}）\n`,
  );
  await runCompare({
    withRoster,
    withoutRoster,
    note: `swap-in-for-${replaced.memberId}`,
  });
}

async function runCompare({ withRoster, withoutRoster, note }) {
  const simPool = createSimPool(workerCount);
  try {
    const [withoutRuns, withRuns] = await Promise.all([
      simulateRoster("不参加", withoutRoster),
      simulateRoster("参加", withRoster),
    ]);
    printSide("不参加（当前变色龙，无此人）", withoutRuns, withoutRoster.length);
    printSide(
      `参加（换上 ${memberName}${replaced ? ` / 换下 ${replaced.memberId}` : ""}）`,
      withRuns,
      withRoster.length,
    );
    const withoutAvg = average(withoutRuns);
    const withAvg = average(withRuns);
    console.log("\n=== 对比（参加 − 不参加）===");
    console.log(
      `层数：${fmtDelta(withAvg.waves, withoutAvg.waves)}（参加 ${withAvg.waves.toFixed(2)} / 不参加 ${withoutAvg.waves.toFixed(2)}）`,
    );
    console.log(
      `末层%：${fmtDelta(withAvg.progress, withoutAvg.progress)}（参加 ${withAvg.progress.toFixed(1)} / 不参加 ${withoutAvg.progress.toFixed(1)}）`,
    );
    console.log(
      `DPS：${fmtDelta(withAvg.dps, withoutAvg.dps)}（参加 ${Math.round(withAvg.dps)} / 不参加 ${Math.round(withoutAvg.dps)}）`,
    );
    console.log(
      `死亡：${fmtDelta(withAvg.deaths, withoutAvg.deaths)}（参加 ${withAvg.deaths.toFixed(1)} / 不参加 ${withoutAvg.deaths.toFixed(1)}）`,
    );
    console.log(`note=${note}`);
  } finally {
    await simPool.close();
  }

  async function simulateRoster(label, roster) {
    const team = roster.map((entry) => buildCombatMember(entry));
    console.log(`→ 模拟 ${label}（${team.length} 人）…`);
    const runs = [];
    for (const seed of seeds) {
      const run = await simPool.run({
        snapshot: slimSnapshot(team[0].snapshot),
        boss: chameleonBoss,
        members: slimMembers(team),
        seed,
        durationSeconds,
        includeMembers: false,
      });
      runs.push(run);
      console.log(
        `  ${label} seed ${seed}: 层=${run.wavesCleared} 末层=${run.finalProgressPercent}% ` +
          `DPS=${Math.round(run.teamDps)} 死亡=${run.totalDeaths}`,
      );
    }
    return runs;
  }
}

function buildCombatMember(entry) {
  const memberId = String(entry.memberId);
  const combatType = entry.combatType;
  const snapshot = memberMap.get(memberId)?.latestSnapshot;
  if (!snapshot) throw new Error(`${memberId} missing snapshot`);
  const prepared = prepareSnapshotForCombat(snapshot, combatType);
  const buildSelection = selectCombatBuild(prepared, combatType);
  const abilityHrids = Array.isArray(entry.abilityHrids) && entry.abilityHrids.length === 5
    ? entry.abilityHrids
    : defaultKit(combatType, entry);
  return buildPlayerMember({
    build: buildSelection.build,
    label: `${memberId}·${combatType}·${entry.duty ?? "dps"}`,
    role: entry.duty ?? "dps",
    memberId,
    snapshot: prepared,
    abilities: abilityHrids.map((abilityHrid) =>
      defaultAbility(abilityHrid, prepared.learnedAbilities),
    ),
    combatType,
    sourceMemberId: memberId,
  });
}

function defaultKit(combatType, entry) {
  if (combatType === "枪") {
    return [
      entry.auraHrid || "/abilities/insanity",
      "/abilities/berserk",
      "/abilities/precision",
      "/abilities/puncture",
      "/abilities/penetrating_strike",
    ];
  }
  throw new Error(`no fallback kit for ${combatType}; need abilityHrids on roster`);
}

function combatLevel(memberId, combatType) {
  const skills = memberMap.get(memberId)?.latestSnapshot?.skills ?? {};
  const hrid = combatType === "弓" || combatType === "弩"
    ? "/skills/ranged"
    : "/skills/attack";
  const value = skills[hrid];
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const level = Number(value.level ?? value.buffedLevel);
    return Number.isFinite(level) ? level : 0;
  }
  return 0;
}

function printSide(title, runs, n) {
  const avg = average(runs);
  console.log(
    `\n${title}\n` +
      `  人数 ${n}；层 ${runs.map((r) => r.wavesCleared).join("/")} 均 ${avg.waves.toFixed(2)}；` +
      `末层% ${avg.progress.toFixed(1)}；DPS≈${Math.round(avg.dps)}；死亡 ${avg.deaths.toFixed(1)}`,
  );
}

function average(runs) {
  const n = runs.length || 1;
  return {
    waves: runs.reduce((sum, run) => sum + run.wavesCleared, 0) / n,
    progress: runs.reduce((sum, run) => sum + run.finalProgressPercent, 0) / n,
    dps: runs.reduce((sum, run) => sum + run.teamDps, 0) / n,
    deaths: runs.reduce((sum, run) => sum + run.totalDeaths, 0) / n,
  };
}

function fmtDelta(withValue, withoutValue) {
  const delta = withValue - withoutValue;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(2)}`;
}

function slimSnapshot(snapshot) {
  return {
    memberId: snapshot.memberId,
    displayName: snapshot.displayName,
    skills: snapshot.skills,
    learnedAbilities: snapshot.learnedAbilities,
    auras: snapshot.auras,
    loadoutCatalog: snapshot.loadoutCatalog,
  };
}

function slimMembers(team) {
  return team.map((member) => ({
    label: member.label,
    role: member.role,
    memberId: member.memberId,
    combatType: member.combatType,
    sourceMemberId: member.sourceMemberId,
    cloneIndex: member.cloneIndex,
    auraHrid: member.auraHrid,
    abilities: member.abilities,
    build: { equipment: member.build.equipment },
    snapshot: slimSnapshot(member.snapshot),
  }));
}

function createSimPool(size) {
  const workerPath = path.join(projectDirectory, "scripts/sim-worker.mjs");
  const workers = [];
  const idle = [];
  const queue = [];
  let nextId = 1;
  for (let index = 0; index < size; index += 1) {
    const worker = new Worker(workerPath);
    const slot = { worker, busy: false };
    worker.on("message", (message) => {
      const pending = slot.pending;
      slot.pending = null;
      slot.busy = false;
      idle.push(slot);
      pump();
      if (!pending) return;
      if (!message.ok) {
        pending.reject(new Error(message.error || "sim worker failed"));
        return;
      }
      pending.resolve(message.run);
    });
    worker.on("error", (error) => {
      const pending = slot.pending;
      slot.pending = null;
      slot.busy = false;
      if (pending) pending.reject(error);
    });
    workers.push(slot);
    idle.push(slot);
  }
  function pump() {
    while (queue.length && idle.length) {
      const slot = idle.pop();
      const job = queue.shift();
      slot.busy = true;
      slot.pending = job;
      slot.worker.postMessage({ ...job.task, id: job.id });
    }
  }
  return {
    run(task) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        queue.push({ id, task, resolve, reject });
        pump();
      });
    },
    async close() {
      await Promise.all(workers.map((slot) => slot.worker.terminate()));
    },
  };
}

async function apiGet(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { "X-Admin-Key": adminKey },
  });
  if (!response.ok) {
    throw new Error(`${pathname} -> ${response.status}`);
  }
  return response.json();
}
