#!/usr/bin/env node
/**
 * A/B: adudu on chameleon as 锤(公会锤) vs 枪(公会枪).
 *
 * Usage:
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/ab-adudu-hammer-vs-spear.mjs
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
const targetId = "adudu";
const seeds = [1297565953, 1297565954, 1297565955];
const durationSeconds = Number(
  process.env.MWI_GUILD_FINAL_DURATION_SECONDS ?? 3600,
);
const workerCount = Math.max(
  1,
  Number(process.env.MWI_GUILD_SIM_WORKERS ?? Math.min(6, os.cpus().length || 4)),
);

if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required");

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
const chameleonBoss = fixture.bosses.find((boss) =>
  String(boss.hrid).includes("chameleon"),
);
const chameleon = lab.bosses.find((boss) =>
  String(boss.bossName ?? "").includes("变色龙"),
);
if (!chameleonBoss || !chameleon?.roster?.length) {
  throw new Error("missing chameleon boss/roster");
}

const membersData = await apiGet(
  `/api/guilds/${encodeURIComponent(guildId)}/members`,
);
const memberMap = new Map(
  (membersData.members ?? []).map((row) => [String(row.memberId), row]),
);
const aduduSnap = memberMap.get(targetId)?.latestSnapshot;
if (!aduduSnap) throw new Error("adudu snapshot missing");

const hammerLoadout = namedLoadout(aduduSnap, "公会锤");
const spearLoadout = namedLoadout(aduduSnap, "公会枪");
if (!hammerLoadout || !spearLoadout) {
  throw new Error("adudu missing 公会锤 or 公会枪 combat loadout");
}

console.log("adudu 配装对比");
console.log(
  `  公会锤：${weaponLabel(hammerLoadout)} | skills: ${abilityLabels(hammerLoadout)}`,
);
console.log(
  `  公会枪：${weaponLabel(spearLoadout)} | skills: ${abilityLabels(spearLoadout)}`,
);
console.log("");

const variants = [
  {
    id: "锤-公会锤",
    combatType: "锤",
    loadoutName: "公会锤",
    loadout: hammerLoadout,
    duty: "debuffer",
  },
  {
    id: "枪-公会枪",
    combatType: "枪",
    loadoutName: "公会枪",
    loadout: spearLoadout,
    duty: "dps",
  },
];

const simPool = createSimPool(workerCount);
try {
  const results = [];
  for (const variant of variants) {
    const team = chameleon.roster.map((entry) => {
      if (String(entry.memberId).toLocaleLowerCase("en-US") !== targetId) {
        return buildFromRoster(entry);
      }
      return buildAduduVariant(variant);
    });
    console.log(`→ 模拟 ${variant.id}（变色龙 ${team.length} 人）…`);
    const runs = [];
    for (const seed of seeds) {
      const run = await simPool.run({
        snapshot: slimSnapshot(team[0].snapshot),
        boss: chameleonBoss,
        members: slimMembers(team),
        seed,
        durationSeconds,
        includeMembers: true,
      });
      runs.push(run);
      const self = (run.members ?? []).find(
        (row) => String(row.memberId).toLocaleLowerCase("en-US") === targetId,
      );
      console.log(
        `  ${variant.id} seed ${seed}: 层=${run.wavesCleared} 末层=${run.finalProgressPercent}% ` +
          `团队DPS=${Math.round(run.teamDps)} | adudu DPS=${Math.round(self?.dps ?? 0)} ` +
          `伤害=${Math.round(self?.damageDone ?? 0)} 死亡=${self?.deaths ?? "?"}`,
      );
    }
    results.push({ variant, runs });
  }

  console.log("\n=== 汇总 ===");
  for (const { variant, runs } of results) {
    const avg = average(runs);
    const self = averageSelf(runs);
    console.log(
      `${variant.id}: 层均 ${avg.waves.toFixed(2)}（${runs.map((r) => r.wavesCleared).join("/")}）` +
        ` 末层% ${avg.progress.toFixed(1)} 团队DPS≈${Math.round(avg.dps)} | ` +
        `adudu DPS≈${Math.round(self.dps)} 伤害≈${Math.round(self.damage)} 死亡均 ${self.deaths.toFixed(1)}`,
    );
  }
  const hammer = results.find((row) => row.variant.combatType === "锤");
  const spear = results.find((row) => row.variant.combatType === "枪");
  if (hammer && spear) {
    const h = averageSelf(hammer.runs);
    const s = averageSelf(spear.runs);
    const ht = average(hammer.runs);
    const st = average(spear.runs);
    console.log("\n=== 枪 − 锤 ===");
    console.log(
      `adudu DPS：${fmt(s.dps - h.dps)}（枪 ${Math.round(s.dps)} / 锤 ${Math.round(h.dps)}）`,
    );
    console.log(
      `adudu 伤害：${fmt(s.damage - h.damage)}（枪 ${Math.round(s.damage)} / 锤 ${Math.round(h.damage)}）`,
    );
    console.log(
      `团队层数：${fmt(st.waves - ht.waves)}（枪 ${st.waves.toFixed(2)} / 锤 ${ht.waves.toFixed(2)}）`,
    );
    console.log(
      `团队DPS：${fmt(st.dps - ht.dps)}（枪 ${Math.round(st.dps)} / 锤 ${Math.round(ht.dps)}）`,
    );
  }
} finally {
  await simPool.close();
}

function buildAduduVariant(variant) {
  const prepared = prepareSnapshotForCombat(aduduSnap, variant.combatType);
  // Restrict catalog so selectCombatBuild must pick the named guild loadout.
  const forcedSnapshot = {
    ...prepared,
    loadoutCatalog: [variant.loadout],
  };
  const selected = selectCombatBuild(forcedSnapshot, variant.combatType);
  if (!selected.build) {
    throw new Error(`${variant.loadoutName} not selectable for ${variant.combatType}`);
  }
  const abilityHrids = (variant.loadout.abilities ?? [])
    .slice()
    .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0))
    .map((row) => row.abilityHrid);
  if (abilityHrids.length !== 5) {
    throw new Error(`${variant.loadoutName} abilities != 5`);
  }
  const special = abilityHrids[0];
  const member = buildPlayerMember({
    build: selected.build,
    label: `adudu·${variant.combatType}·${variant.loadoutName}`,
    role: variant.duty,
    memberId: targetId,
    snapshot: prepared,
    abilities: abilityHrids.map((abilityHrid) =>
      defaultAbility(abilityHrid, prepared.learnedAbilities),
    ),
    combatType: variant.combatType,
    sourceMemberId: targetId,
  });
  member.combatType = variant.combatType;
  member.sourceMemberId = targetId;
  member.auraHrid = special.includes("aura") ? special : null;
  return member;
}

function buildFromRoster(entry) {
  const memberId = String(entry.memberId);
  const combatType = entry.combatType;
  const snapshot = memberMap.get(memberId)?.latestSnapshot;
  if (!snapshot) throw new Error(`${memberId} missing snapshot`);
  const prepared = prepareSnapshotForCombat(snapshot, combatType);
  const selected = selectCombatBuild(prepared, combatType);
  if (!selected.build) throw new Error(`${memberId}/${combatType} no build`);
  if (!Array.isArray(entry.abilityHrids) || entry.abilityHrids.length !== 5) {
    throw new Error(`${memberId} missing abilityHrids`);
  }
  const member = buildPlayerMember({
    build: selected.build,
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
  member.combatType = combatType;
  member.sourceMemberId = memberId;
  member.auraHrid = entry.auraHrid ?? null;
  return member;
}

function namedLoadout(snapshot, name) {
  return (snapshot.loadoutCatalog ?? []).find((row) => row?.name === name);
}

function weaponLabel(loadout) {
  const main = (loadout.equipment ?? []).find((row) =>
    String(row.locationHrid ?? "").includes("main_hand") ||
    String(row.locationHrid ?? "").includes("two_hand"),
  );
  if (!main) return "?";
  return `${String(main.itemHrid).split("/").at(-1)}+${main.enhancementLevel}`;
}

function abilityLabels(loadout) {
  return (loadout.abilities ?? [])
    .slice()
    .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0))
    .map((row) => String(row.abilityHrid).split("/").at(-1))
    .join("/");
}

function average(runs) {
  const n = runs.length || 1;
  return {
    waves: runs.reduce((sum, run) => sum + run.wavesCleared, 0) / n,
    progress: runs.reduce((sum, run) => sum + run.finalProgressPercent, 0) / n,
    dps: runs.reduce((sum, run) => sum + run.teamDps, 0) / n,
  };
}

function averageSelf(runs) {
  const rows = runs.map((run) =>
    (run.members ?? []).find(
      (row) => String(row.memberId).toLocaleLowerCase("en-US") === targetId,
    ),
  );
  const n = rows.length || 1;
  return {
    dps: rows.reduce((sum, row) => sum + (row?.dps ?? 0), 0) / n,
    damage: rows.reduce((sum, row) => sum + (row?.damageDone ?? 0), 0) / n,
    deaths: rows.reduce((sum, row) => sum + (row?.deaths ?? 0), 0) / n,
  };
}

function fmt(delta) {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}`;
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
