#!/usr/bin/env node
/**
 * A/B chameleon ST nature healers:
 *   majority 群疗/增幅/生命吸取/缠绕
 *   lowest-DPS 3 keep 群疗/增幅/粉尘/缠绕
 * Reverts any nature-DPS conversion on chameleon (both kits start with 群疗).
 *
 * Playbook: docs/WEEKLY_COMBAT_SCREENING.md
 *
 * Usage:
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/ab-chameleon-st-nature-healers.mjs
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/ab-chameleon-st-nature-healers.mjs --apply
 */
import { readFile, writeFile } from "node:fs/promises";
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
import {
  applyStNatureHealerKits,
  ST_NATURE_POLLEN_COVERAGE_COUNT,
} from "../packages/optimizer/src/combat-ability-templates.mjs";
import { officialAbilityNameZh } from "../packages/mwi-data/official-zh-ability-names.mjs";
import {
  partitionBossByKey,
  publicBossKey,
  resolveWeeklyCombatBossPair,
} from "./weekly-combat-boss-pair.mjs";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiBase = (
  process.env.MWI_GUILD_API_BASE ?? "http://127.0.0.1:8787"
).replace(/\/$/, "");
const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY;
const guildId = process.env.MWI_GUILD_ID ?? "TMD";
const pollenCount = Number(
  process.env.MWI_GUILD_ST_NATURE_POLLEN ?? ST_NATURE_POLLEN_COVERAGE_COUNT,
);
const seeds = [1297565953, 1297565954, 1297565955];
const durationSeconds = Number(
  process.env.MWI_GUILD_FINAL_DURATION_SECONDS ?? 3600,
);
const workerCount = Math.max(
  1,
  Number(process.env.MWI_GUILD_SIM_WORKERS ?? Math.min(8, os.cpus().length || 4)),
);
const apply = process.argv.includes("--apply");

if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required");

const labPath = path.join(
  projectDirectory,
  ".local/tmd-available-roster-composition-lab.json",
);
const lab = JSON.parse(await readFile(labPath, "utf8"));
assertCombatRulesVersion(lab, labPath);
const fixture = JSON.parse(
  await readFile(
    path.join(
      projectDirectory,
      process.env.MWI_GUILD_TRIAL_FIXTURE ??
        "fixtures/monsters/guild-trial-2026-08-28-chameleon-swarm.json",
    ),
    "utf8",
  ),
);
const weekly = resolveWeeklyCombatBossPair(fixture);
const bossByPublicKey = Object.fromEntries(
  Object.entries(partitionBossByKey(weekly)).map(([partitionKey, boss]) => [
    publicBossKey(partitionKey, weekly),
    boss,
  ]),
);
const chameleon = (lab.bosses ?? []).find((boss) => boss.bossKey === "chameleon");
const fixtureBoss = bossByPublicKey.chameleon;
if (!chameleon?.roster?.length || !fixtureBoss) {
  throw new Error("lab JSON / fixture missing chameleon");
}

const membersData = await apiGet(
  `/api/guilds/${encodeURIComponent(guildId)}/members`,
);
const memberMap = new Map(
  (membersData.members ?? []).map((row) => [String(row.memberId), row]),
);

const pollenMemberIds = rankedLowDpsNatureIds(
  chameleon.roster,
  chameleon.memberAverages,
).slice(0, pollenCount);
const variantRoster = applyStNatureHealerKits(chameleon.roster, {
  pollenMemberIds,
  pollenCount,
});

process.stdout.write(
  `变色龙自然：多数=群疗/增幅/生命吸取/缠绕；粉尘覆盖 ${pollenCount} 人（低 DPS）：${pollenMemberIds.join("、") || "无人"}\n` +
    `kogge 等自然输出会改回治疗。基线=${summarizeRuns(chameleon.runs)}\n`,
);

const simPool = createSimPool(workerCount);
try {
  const team = variantRoster.map((entry) => buildCombatMember(entry));
  const runs = await Promise.all(
    seeds.map((seed) =>
      simPool.run({
        snapshot: slimSnapshot(team[0].snapshot),
        boss: fixtureBoss,
        members: slimMembers(team),
        seed,
        durationSeconds,
        includeMembers: true,
      }),
    ),
  );
  for (const run of runs) {
    process.stdout.write(
      `  生命吸取方案 seed ${run.seed}: 层=${run.wavesCleared} 末层=${run.finalProgressPercent}% ` +
        `DPS=${Math.round(run.teamDps)} 死亡=${run.totalDeaths}\n`,
    );
  }
  const baseline = average(chameleon.runs);
  const variant = average(runs);
  process.stdout.write(
    `\n=== 对比（新方案 − 当前发布）===\n` +
      `层 ${fmtDelta(variant.waves, baseline.waves)}（新 ${variant.waves.toFixed(2)} / 旧 ${baseline.waves.toFixed(2)}）\n` +
      `末层% ${fmtDelta(variant.progress, baseline.progress)}（新 ${variant.progress.toFixed(1)} / 旧 ${baseline.progress.toFixed(1)}）\n` +
      `DPS ${fmtDelta(variant.dps, baseline.dps)}（新 ${Math.round(variant.dps)} / 旧 ${Math.round(baseline.dps)}）\n` +
      `死亡 ${fmtDelta(variant.deaths, baseline.deaths)}（新 ${variant.deaths.toFixed(1)} / 旧 ${baseline.deaths.toFixed(1)}）\n` +
      `计分 ${fmtDelta(mean(runs.map(score)), mean((chameleon.runs ?? []).map(score)))}\n`,
  );

  if (apply) {
    chameleon.roster = team.map((member) => ({
      memberId: member.sourceMemberId ?? member.memberId,
      combatType: member.combatType,
      duty: member.role,
      cloneIndex: member.cloneIndex ?? 1,
      aura: member.auraHrid
        ? officialAbilityNameZh(member.auraHrid) ?? member.auraHrid
        : null,
      special:
        officialAbilityNameZh(member.abilities[0]?.abilityHrid) ??
        member.abilities[0]?.abilityHrid,
      abilities: member.abilities.map(
        (ability) =>
          `${officialAbilityNameZh(ability.abilityHrid) ?? ability.abilityHrid}` +
          `Lv${ability.level}`,
      ),
      abilityHrids: member.abilities.map((ability) => ability.abilityHrid),
      abilityLevels: Object.fromEntries(
        member.abilities.map((ability) => [
          ability.abilityHrid,
          ability.level,
        ]),
      ),
      auraHrid: member.auraHrid ?? null,
    }));
    chameleon.runs = runs.map((run) => ({
      seed: run.seed,
      wavesCleared: run.wavesCleared,
      finalMonsterHp: run.finalMonsterHp,
      finalMonsterMaxHp: run.finalMonsterMaxHp,
      finalProgressPercent: run.finalProgressPercent,
      teamDps: run.teamDps,
      totalDeaths: run.totalDeaths,
      oomMembers: run.oomMembers,
    }));
    chameleon.natureHealersConvertedToDps = 0;
    chameleon.stNaturePollenCoverage = pollenMemberIds;
    if (chameleon.team?.duties) {
      chameleon.team.duties.healer = chameleon.roster.filter(
        (row) => row.duty === "healer",
      ).length;
      chameleon.team.duties.dps = chameleon.roster.filter(
        (row) => row.duty === "dps",
      ).length;
    }
    lab.rules = {
      ...(lab.rules ?? {}),
      natureDpsFromHealers: {
        ...(lab.rules?.natureDpsFromHealers ?? {}),
        chameleon: 0,
      },
      stNatureHealerKit: "rejuvenate/affinity/life_drain/entangle",
      stNaturePollenCoverage: pollenMemberIds,
    };
    lab.generatedAt = new Date().toISOString();
    lab.summaryText = rebuildSummaryText(lab);
    await writeFile(labPath, `${JSON.stringify(lab, null, 2)}\n`);
    process.stdout.write(`已写入 ${labPath}\n`);
  }
} finally {
  await simPool.close();
}

function rebuildSummaryText(assignment) {
  const header = String(assignment.summaryText ?? "").split("\n").slice(0, 2);
  const pollen = assignment.rules?.stNaturePollenCoverage ?? [];
  const insanity = assignment.rules?.insanityTopDps ?? {};
  const natureCounts = assignment.rules?.natureDpsFromHealers ?? {};
  const lines = [
    ...header,
    `规则：物理职业去变色龙、魔法职业去虫群；两边各留至少2个必要覆盖（烟爆/法力喷泉/冰霜爆裂/粉尘/疫病/破甲/碎裂/致残/血刃）；` +
      `变色龙自然治疗群疗/增幅/生命吸取/缠绕，低DPS ${pollen.length}人（${pollen.join("、") || "无人"}）留粉尘；` +
      `虫群自然奶改输出 x=${natureCounts.swarm ?? 0}；` +
      `非光环默认复活、前x输出改疯狂（chameleon=${insanity.chameleon ?? 0}，swarm=${insanity.swarm ?? 0}）；` +
      `攻击≥110；双 Boss 人员互斥；无复制人。`,
  ];
  for (const boss of assignment.bosses ?? []) {
    const layers = (boss.runs ?? []).map((run) => run.wavesCleared);
    const deaths = (boss.runs ?? []).map((run) => run.totalDeaths);
    const dps =
      (boss.runs ?? []).reduce((sum, run) => sum + Number(run.teamDps ?? 0), 0) /
      Math.max(1, (boss.runs ?? []).length);
    const progress =
      (boss.runs ?? []).reduce(
        (sum, run) => sum + Number(run.finalProgressPercent ?? 0),
        0,
      ) / Math.max(1, (boss.runs ?? []).length);
    const converted = Number(boss.natureHealersConvertedToDps ?? 0);
    const pollenNote =
      boss.bossKey === "chameleon" && pollen.length
        ? `；粉尘覆盖${pollen.join("、")}`
        : "";
    lines.push(
      `【${boss.bossName}】${boss.participantCount}人` +
        (boss.enemiesPerEncounter > 1
          ? `（每层${boss.enemiesPerEncounter}只）`
          : "") +
        `；3次 ${Math.min(...layers)}–${Math.max(...layers)} 层；` +
        `DPS≈${Math.round(dps)}；末层平均${progress.toFixed(1)}%；` +
        `死亡 ${Math.min(...deaths)}–${Math.max(...deaths)}` +
        (boss.insanityTopDpsCount
          ? `；前${boss.insanityTopDpsCount}输出疯狂`
          : "") +
        (converted ? `；${converted}名自然奶改输出` : "") +
        pollenNote,
      `技能包：${boss.selectedCandidate}`,
      `职业：${formatRoleCounts(boss.team?.roles)}`,
      `职责：坦克${boss.team?.duties?.tank ?? 0} 奶${boss.team?.duties?.healer ?? 0} ` +
        `减${boss.team?.duties?.debuffer ?? 0} 输出${boss.team?.duties?.dps ?? 0}`,
      `名单：${(boss.roster ?? [])
        .map((row) => `${row.memberId}(${row.combatType})`)
        .join("、")}`,
    );
  }
  const unavailableLine = String(assignment.summaryText ?? "")
    .split("\n")
    .find((line) => line.startsWith("全库不可用："));
  if (unavailableLine) lines.push(unavailableLine);
  return lines.join("\n");
}

function formatRoleCounts(roles = {}) {
  return ["弓", "弩", "火", "水", "自", "盾", "枪", "剑", "锤"]
    .filter((role) => Number(roles[role] ?? 0) > 0)
    .map((role) => `${role}${roles[role]}`)
    .join(" ");
}

function rankedLowDpsNatureIds(roster, memberAverages) {
  const dps = new Map(
    (memberAverages ?? []).map((row) => [
      String(row.memberId),
      Number(row.averageDps ?? 0),
    ]),
  );
  return (roster ?? [])
    .filter((row) => row.combatType === "自")
    .sort(
      (left, right) =>
        (dps.get(String(left.memberId)) ?? 0) -
          (dps.get(String(right.memberId)) ?? 0) ||
        String(left.memberId).localeCompare(String(right.memberId)),
    )
    .map((row) => String(row.memberId));
}

function score(run) {
  const progress =
    Number(run.finalMonsterMaxHp ?? 0) > 0
      ? 1 - Number(run.finalMonsterHp ?? 0) / Number(run.finalMonsterMaxHp)
      : Number(run.finalProgressPercent ?? 0) / 100;
  return (
    Number(run.wavesCleared ?? 0) * 1_000_000 -
    Number(run.totalDeaths ?? 0) * 1_000 +
    progress
  );
}

function average(runs) {
  const n = runs?.length || 1;
  return {
    waves: (runs ?? []).reduce((sum, run) => sum + Number(run.wavesCleared ?? 0), 0) / n,
    progress:
      (runs ?? []).reduce(
        (sum, run) => sum + Number(run.finalProgressPercent ?? 0),
        0,
      ) / n,
    dps: (runs ?? []).reduce((sum, run) => sum + Number(run.teamDps ?? 0), 0) / n,
    deaths: (runs ?? []).reduce((sum, run) => sum + Number(run.totalDeaths ?? 0), 0) / n,
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + Number(value ?? 0), 0) /
    Math.max(1, values.length);
}

function fmtDelta(next, prev) {
  const delta = next - prev;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(2)}`;
}

function summarizeRuns(runs) {
  const avg = average(runs);
  return `层=${avg.waves.toFixed(2)} 末层=${avg.progress.toFixed(1)}% DPS≈${Math.round(avg.dps)} 死亡=${avg.deaths.toFixed(1)}`;
}

function buildCombatMember(entry) {
  const memberId = String(entry.memberId);
  const combatType = entry.combatType;
  const snapshot = memberMap.get(memberId)?.latestSnapshot;
  if (!snapshot) throw new Error(`${memberId} missing snapshot`);
  const prepared = prepareSnapshotForCombat(snapshot, combatType);
  const buildSelection = selectCombatBuild(prepared, combatType);
  if (!Array.isArray(entry.abilityHrids) || entry.abilityHrids.length !== 5) {
    throw new Error(`${memberId} missing abilityHrids`);
  }
  const member = buildPlayerMember({
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
  member.auraHrid = entry.auraHrid ?? null;
  member.combatType = combatType;
  member.sourceMemberId = memberId;
  return member;
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
