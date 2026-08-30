#!/usr/bin/env node
/**
 * A/B: swarm progress with vs without named low contributors.
 *
 * Usage:
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/ab-swarm-drop-members.mjs Nixhhhhh,qingyuyou,xlsx
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
import { assertCombatRulesVersion } from "../packages/shykai-full-runtime/src/combat-rules-version.mjs";
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
const dropNames = String(process.argv[2] ?? "Nixhhhhh,qingyuyou,xlsx")
  .split(/[,，\s]+/u)
  .map((name) => name.trim())
  .filter(Boolean);
const seeds = [1297565953, 1297565954, 1297565955];
const durationSeconds = Number(
  process.env.MWI_GUILD_FINAL_DURATION_SECONDS ?? 3600,
);
const workerCount = Math.max(
  1,
  Number(process.env.MWI_GUILD_SIM_WORKERS ?? Math.min(6, os.cpus().length || 4)),
);

if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required");
if (!dropNames.length) throw new Error("need member names to drop");

const lab = JSON.parse(
  await readFile(
    path.join(projectDirectory, ".local/tmd-available-roster-composition-lab.json"),
    "utf8",
  ),
);
assertCombatRulesVersion(lab, path.join(projectDirectory, ".local/tmd-available-roster-composition-lab.json"));
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
const swarmBoss = (fixture.bosses ?? []).find((boss) =>
  String(boss.hrid ?? "").includes("swarm"),
);
const swarm = (lab.bosses ?? []).find(
  (boss) =>
    String(boss.bossName ?? "").includes("虫群") ||
    String(boss.bossId ?? "").includes("swarm"),
);
if (!swarmBoss || !swarm?.roster?.length) {
  throw new Error("latest lab JSON / fixture missing swarm");
}

const membersData = await apiGet(
  `/api/guilds/${encodeURIComponent(guildId)}/members`,
);
const memberMap = new Map(
  (membersData.members ?? []).map((row) => [String(row.memberId), row]),
);

const dropKeys = new Set(
  dropNames.map((name) => name.toLocaleLowerCase("en-US")),
);
const withRoster = swarm.roster.map((row) => ({ ...row }));
const withoutRoster = withRoster.filter(
  (row) => !dropKeys.has(String(row.memberId).toLocaleLowerCase("en-US")),
);
const dropped = withRoster.filter((row) =>
  dropKeys.has(String(row.memberId).toLocaleLowerCase("en-US")),
);
if (dropped.length !== dropNames.length) {
  const found = new Set(dropped.map((row) => row.memberId));
  const missing = dropNames.filter((name) => !found.has(name) &&
    ![...found].some((id) => id.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US")));
  console.log("warning: some names not on swarm roster:", missing.join(", "));
}

console.log(
  `虫群 A/B：保留 ${withRoster.length} 人 vs 去掉 ${dropped.map((row) => row.memberId).join("、")} 后 ${withoutRoster.length} 人\n`,
);

const simPool = createSimPool(workerCount);
try {
  const [keepRuns, dropRuns] = await Promise.all([
    simulateRoster("参加(当前)", withRoster),
    simulateRoster("不参加(去掉3人)", withoutRoster),
  ]);
  printSide("参加（当前虫群，含低DPS三人）", keepRuns, withRoster.length);
  printSide(
    `不参加（去掉 ${dropped.map((row) => row.memberId).join("/")}）`,
    dropRuns,
    withoutRoster.length,
  );
  const keepAvg = average(keepRuns);
  const dropAvg = average(dropRuns);
  console.log("\n=== 对比（不参加 − 参加）===");
  console.log(
    `层数：${fmtDelta(dropAvg.waves, keepAvg.waves)}（不参加 ${dropAvg.waves.toFixed(2)} / 参加 ${keepAvg.waves.toFixed(2)}）`,
  );
  console.log(
    `末层%：${fmtDelta(dropAvg.progress, keepAvg.progress)}（不参加 ${dropAvg.progress.toFixed(1)} / 参加 ${keepAvg.progress.toFixed(1)}）`,
  );
  console.log(
    `DPS：${fmtDelta(dropAvg.dps, keepAvg.dps)}（不参加 ${Math.round(dropAvg.dps)} / 参加 ${Math.round(keepAvg.dps)}）`,
  );
  console.log(
    `死亡：${fmtDelta(dropAvg.deaths, keepAvg.deaths)}（不参加 ${dropAvg.deaths.toFixed(1)} / 参加 ${keepAvg.deaths.toFixed(1)}）`,
  );
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
      boss: swarmBoss,
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

function buildCombatMember(entry) {
  const memberId = String(entry.memberId);
  const combatType = entry.combatType;
  const snapshot = memberMap.get(memberId)?.latestSnapshot;
  if (!snapshot) throw new Error(`${memberId} missing snapshot`);
  const prepared = prepareSnapshotForCombat(snapshot, combatType);
  const buildSelection = selectCombatBuild(prepared, combatType);
  if (!Array.isArray(entry.abilityHrids) || entry.abilityHrids.length !== 5) {
    throw new Error(`${memberId} missing abilityHrids in roster`);
  }
  return buildPlayerMember({
    build: buildSelection.build,
    label: `${memberId}·${combatType}·${entry.duty ?? "dps"}`,
    role: entry.duty ?? "dps",
    memberId,
    snapshot: prepared,
    abilities: entry.abilityHrids.map((abilityHrid) =>
      defaultAbility(abilityHrid, prepared.learnedAbilities),
    ),
    combatType,
    sourceMemberId: memberId,
  });
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

function fmtDelta(left, right) {
  const delta = left - right;
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
  if (!response.ok) throw new Error(`${pathname} -> ${response.status}`);
  return response.json();
}
