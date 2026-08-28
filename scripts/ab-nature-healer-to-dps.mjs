#!/usr/bin/env node
/**
 * Sweep converting top-X nature healers into nature DPS.
 * Baseline: current assignment (insanity already applied).
 * Nature DPS kit: 元素增幅 / 粉尘 / 菌幕 / 缠绕.
 * Playbook: docs/WEEKLY_COMBAT_SCREENING.md
 *
 * Usage:
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/ab-nature-healer-to-dps.mjs
 *   MWI_GUILD_API_ADMIN_KEY=... node scripts/ab-nature-healer-to-dps.mjs --apply=chameleon:0,swarm:3
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  buildPlayerMember,
  defaultAbility,
} from "../packages/shykai-full-runtime/src/guild-trial-runner.mjs";
import { selectCombatBuild } from "../packages/optimizer/src/combat-build-selection.mjs";
import { prepareSnapshotForCombat } from "../packages/optimizer/src/combat-member-readiness.mjs";
import { inspectAvailableCombatWeapon } from "../packages/optimizer/src/combat-weapon-check.mjs";
import { NATURE_DPS_FIXED_KIT } from "../packages/optimizer/src/combat-ability-templates.mjs";
import {
  convertNatureHealersToDps,
  defaultNatureDpsCounts,
  rankedNatureHealerIds,
} from "../packages/optimizer/src/combat-nature-healer-to-dps.mjs";
import {
  partitionBossByKey,
  publicBossKey,
  resolveWeeklyCombatBossPair,
} from "./weekly-combat-boss-pair.mjs";
import { pairStrategyForStKey } from "./weekly-combat-partition.mjs";
import { officialAbilityNameZh } from "../packages/mwi-data/official-zh-ability-names.mjs";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiBase = (
  process.env.MWI_GUILD_API_BASE ?? "http://127.0.0.1:8787"
).replace(/\/$/, "");
const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY;
const guildId = process.env.MWI_GUILD_ID ?? "TMD";
const screenSeconds = Number(
  process.env.MWI_GUILD_AOE_SCREEN_DURATION_SECONDS ?? 1800,
);
const finalSeconds = Number(
  process.env.MWI_GUILD_FINAL_DURATION_SECONDS ?? 3600,
);
const maxDeaths = Number(process.env.MWI_GUILD_MAX_DEATHS ?? 0);
const seeds = [1297565953, 1297565954, 1297565955];
const workerCount = Math.max(
  1,
  Number(process.env.MWI_GUILD_SIM_WORKERS ?? Math.min(8, os.cpus().length || 4)),
);
const applyArg = process.argv.find((arg) => arg.startsWith("--apply"));
const applyCounts = parseApplyCounts(applyArg);
const verifyArg = process.argv.find((arg) => arg.startsWith("--verify"));
const verifyCounts = parseVerifyCounts(verifyArg);

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

const membersData = await apiGet(
  `/api/guilds/${encodeURIComponent(guildId)}/members`,
);
const memberMap = new Map(
  (membersData.members ?? []).map((row) => [String(row.memberId), row]),
);
const snapshotCache = new Map();

const simPool = createSimPool(workerCount);
try {
  if (applyCounts) {
    await applyAndWrite(applyCounts);
  } else if (verifyCounts) {
    await verifyOnly(verifyCounts);
  } else {
    await sweep();
  }
} finally {
  await simPool.close();
}

async function sweep() {
  for (const boss of lab.bosses ?? []) {
    for (const row of boss.roster ?? []) {
      snapshotForMember(String(row.memberId), row.combatType);
    }
  }
  const screens = (lab.bosses ?? []).map((boss) => {
    const fixtureBoss = bossByPublicKey[boss.bossKey];
    if (!fixtureBoss) throw new Error(`fixture missing ${boss.bossKey}`);
    const statsByMemberId = natureHealerStats(boss.roster);
    const ranked = rankedNatureHealerIds(boss.roster, statsByMemberId);
    const counts = defaultNatureDpsCounts(ranked.length);
    process.stdout.write(
      `\n## ${boss.bossName} 可改自然输出的奶 ${ranked.length} 人\n`,
    );
    for (const memberId of ranked) {
      const stats = statsByMemberId.get(memberId) ?? {};
      process.stdout.write(
        `  ${memberId} ${stats.enhancementLabel ?? "?"} 魔法${stats.magicLevel ?? "?"}\n`,
      );
    }
    return { boss, fixtureBoss, ranked, counts };
  });

  const screenRows = await Promise.all(
    screens.flatMap((screen) =>
      screen.counts.map(async (count) => {
        const roster = convertNatureHealersToDps(
          screen.boss.roster,
          count,
          screen.ranked,
        );
        const run = await simulateRoster(
          screen.fixtureBoss,
          roster,
          seeds[0],
          screenSeconds,
        );
        const row = {
          bossName: screen.boss.bossName,
          count,
          names: screen.ranked.slice(0, count),
          healersLeft: screen.ranked.length - count,
          run,
          score: score(run),
        };
        process.stdout.write(
          `  ${row.bossName} 筛 x=${count} 剩奶=${row.healersLeft}: ` +
            `层=${run.wavesCleared} 末层=${run.finalProgressPercent}% ` +
            `DPS=${Math.round(run.teamDps)} 死亡=${run.totalDeaths}\n`,
        );
        return row;
      }),
    ),
  );

  process.stdout.write("\n将完整验证每边筛分前三（生存优先）的 x…\n");
  const finals = [];
  for (const screen of screens) {
    const rows = screenRows
      .filter((row) => row.bossName === screen.boss.bossName)
      .sort(compareRows);
    const surviving = rows.filter(
      (row) => Number(row.run.totalDeaths ?? 0) <= maxDeaths,
    );
    const top = (surviving.length ? surviving : rows).slice(0, 3);
    const verified = [];
    for (const candidate of top) {
      const roster = convertNatureHealersToDps(
        screen.boss.roster,
        candidate.count,
        screen.ranked,
      );
      const runs = await Promise.all(
        seeds.map((seed) =>
          simulateRoster(screen.fixtureBoss, roster, seed, finalSeconds),
        ),
      );
      for (const run of runs) {
        process.stdout.write(
          `  ${screen.boss.bossName} x=${candidate.count} seed ${run.seed}: ` +
            `层=${run.wavesCleared} 末层=${run.finalProgressPercent}% ` +
            `DPS=${Math.round(run.teamDps)} 死亡=${run.totalDeaths}\n`,
        );
      }
      verified.push({
        count: candidate.count,
        names: candidate.names,
        healersLeft: candidate.healersLeft,
        runs,
        averageWaves: mean(runs.map((run) => run.wavesCleared)),
        averageProgress: mean(runs.map((run) => run.finalProgressPercent)),
        averageDps: mean(runs.map((run) => run.teamDps)),
        averageDeaths: mean(runs.map((run) => run.totalDeaths)),
        score: mean(runs.map((run) => score(run))),
      });
    }
    verified.sort(compareVerified);
    finals.push({
      bossName: screen.boss.bossName,
      ranked: screen.ranked,
      winner: verified[0],
      verified,
    });
  }

  process.stdout.write("\n=== 最优 x（生存优先）===\n");
  for (const row of finals) {
    const win = row.winner;
    process.stdout.write(
      `${row.bossName}: x=${win.count} / ${row.ranked.length} 自然奶改输出，剩奶 ${win.healersLeft}；` +
        `3seed 层=${win.averageWaves.toFixed(2)} 末层=${win.averageProgress.toFixed(1)}% ` +
        `DPS≈${Math.round(win.averageDps)} 死亡=${win.averageDeaths.toFixed(1)}；` +
        `改输出：${win.names.join("、") || "无人"}\n`,
    );
  }
}

function natureHealerStats(roster) {
  const statsByMemberId = new Map();
  for (const row of roster ?? []) {
    if (row.combatType !== "自" || row.duty !== "healer") continue;
    const memberId = String(row.memberId);
    const snapshot = memberMap.get(memberId)?.latestSnapshot;
    if (!snapshot) continue;
    const prepared = prepareSnapshotForCombat(snapshot, "自");
    const inspect = inspectAvailableCombatWeapon(prepared, "自");
    statsByMemberId.set(memberId, {
      enhancementLevel: Number(inspect.enhancementLevel ?? 0),
      refined: Boolean(inspect.refined),
      enhancementLabel: inspect.enhancementLabel ?? "?",
      magicLevel: Number(inspect.primaryLevel ?? 0),
    });
  }
  return statsByMemberId;
}

function compareRows(left, right) {
  return (
    Number(left.run.totalDeaths ?? 0) - Number(right.run.totalDeaths ?? 0) ||
    right.score - left.score ||
    right.count - left.count
  );
}

function compareVerified(left, right) {
  return (
    left.averageDeaths - right.averageDeaths ||
    right.score - left.score ||
    right.count - left.count
  );
}

function parseVerifyCounts(arg) {
  if (!arg) return null;
  const raw = arg.slice("--verify=".length);
  const counts = {};
  for (const part of raw.split(";")) {
    const [key, values] = part.split(":");
    if (!key || !values) continue;
    counts[key] = values
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }
  return Object.keys(counts).length ? counts : null;
}

async function verifyOnly(countsByBoss) {
  for (const boss of lab.bosses ?? []) {
    for (const row of boss.roster ?? []) {
      snapshotForMember(String(row.memberId), row.combatType);
    }
  }
  for (const boss of lab.bosses ?? []) {
    const fixtureBoss = bossByPublicKey[boss.bossKey];
    const statsByMemberId = natureHealerStats(boss.roster);
    const ranked = rankedNatureHealerIds(boss.roster, statsByMemberId);
    const counts = countsByBoss[boss.bossKey] ?? [];
    for (const count of counts) {
      const roster = convertNatureHealersToDps(boss.roster, count, ranked);
      const runs = await Promise.all(
        seeds.map((seed) =>
          simulateRoster(fixtureBoss, roster, seed, finalSeconds),
        ),
      );
      const avg = {
        waves: mean(runs.map((run) => run.wavesCleared)),
        progress: mean(runs.map((run) => run.finalProgressPercent)),
        dps: mean(runs.map((run) => run.teamDps)),
        deaths: mean(runs.map((run) => run.totalDeaths)),
      };
      for (const run of runs) {
        process.stdout.write(
          `  ${boss.bossName} x=${count} seed ${run.seed}: 层=${run.wavesCleared} ` +
            `末层=${run.finalProgressPercent}% DPS=${Math.round(run.teamDps)} ` +
            `死亡=${run.totalDeaths}\n`,
        );
      }
      process.stdout.write(
        `  => ${boss.bossName} x=${count} 均层=${avg.waves.toFixed(2)} ` +
          `末层=${avg.progress.toFixed(1)}% DPS≈${Math.round(avg.dps)} ` +
          `死亡=${avg.deaths.toFixed(1)} 改=${ranked.slice(0, count).join(",") || "—"}\n`,
      );
    }
  }
}

function parseApplyCounts(arg) {
  if (!arg) return null;
  const raw = arg === "--apply" ? "" : arg.slice("--apply=".length);
  const counts = {};
  for (const part of raw.split(/[,，\s]+/u)) {
    const [key, value] = part.split(":");
    const count = Number(value);
    if (key && Number.isFinite(count)) counts[key] = count;
  }
  return Object.keys(counts).length ? counts : null;
}

async function applyAndWrite(counts) {
  for (const boss of lab.bosses ?? []) {
    for (const row of boss.roster ?? []) {
      snapshotForMember(String(row.memberId), row.combatType);
    }
  }
  const labPath = path.join(
    projectDirectory,
    ".local/tmd-available-roster-composition-lab.json",
  );
  for (const boss of lab.bosses ?? []) {
    const fixtureBoss = bossByPublicKey[boss.bossKey];
    if (!fixtureBoss) throw new Error(`fixture missing ${boss.bossKey}`);
    const count = Number(counts[boss.bossKey] ?? 0);
    const statsByMemberId = natureHealerStats(boss.roster);
    const ranked = rankedNatureHealerIds(boss.roster, statsByMemberId);
    const roster = convertNatureHealersToDps(boss.roster, count, ranked);
    const team = roster.map((entry) => buildCombatMember(entry));
    process.stdout.write(
      `\n应用 ${boss.bossName} 奶改输出 x=${count}：${ranked.slice(0, count).join("、") || "无人"}\n`,
    );
    const fullRuns = await Promise.all(
      seeds.map((seed) =>
        simPool.run({
          snapshot: slimSnapshot(team[0].snapshot),
          boss: fixtureBoss,
          members: slimMembers(team),
          seed,
          durationSeconds: finalSeconds,
          includeMembers: true,
        }),
      ),
    );
    for (const run of fullRuns) {
      process.stdout.write(
        `  ${boss.bossName} x=${count} seed ${run.seed}: 层=${run.wavesCleared} ` +
          `末层=${run.finalProgressPercent}% DPS=${Math.round(run.teamDps)} ` +
          `死亡=${run.totalDeaths}\n`,
      );
    }
    boss.roster = team.map((member) => ({
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
        member.abilities.map((ability) => [ability.abilityHrid, ability.level]),
      ),
      auraHrid: member.auraHrid ?? null,
    }));
    const duties = { ...(boss.team?.duties ?? {}) };
    duties.healer = boss.roster.filter((row) => row.duty === "healer").length;
    duties.dps = boss.roster.filter((row) => row.duty === "dps").length;
    if (boss.team) boss.team.duties = duties;
    boss.runs = fullRuns.map((run) => ({
      seed: run.seed,
      wavesCleared: run.wavesCleared,
      finalMonsterHp: run.finalMonsterHp,
      finalMonsterMaxHp: run.finalMonsterMaxHp,
      finalProgressPercent: run.finalProgressPercent,
      teamDps: run.teamDps,
      totalDeaths: run.totalDeaths,
      oomMembers: run.oomMembers,
    }));
    boss.memberAverages = averageMembers(fullRuns, finalSeconds);
    boss.averageScore =
      fullRuns.reduce((sum, run) => sum + score(run), 0) / fullRuns.length;
    boss.averageDeaths =
      fullRuns.reduce((sum, run) => sum + Number(run.totalDeaths ?? 0), 0) /
      fullRuns.length;
    boss.natureHealersConvertedToDps = count;
    boss.natureHealersConvertedNames = ranked.slice(0, count);
  }
  lab.generatedAt = new Date().toISOString();
  lab.rules = {
    ...lab.rules,
    natureDpsFromHealers: counts,
    natureDpsKit: NATURE_DPS_FIXED_KIT,
    healerKit: "remaining-healers-rejuvenate-pollen-veil-entangle",
    natureDpsKitLabel: "elemental-affinity-pollen-veil-entangle",
  };
  lab.summaryText = rebuildSummaryText(lab);
  await writeFile(labPath, JSON.stringify(lab, null, 2));
  process.stdout.write(`\n已写入 ${labPath}\n`);
}

function rebuildSummaryText(assignment) {
  const header = String(assignment.summaryText ?? "").split("\n").slice(0, 2);
  const natureCounts = assignment.rules?.natureDpsFromHealers ?? {};
  const pairStrategy = pairStrategyForStKey(weekly.stKey);
  const stCountKey = weekly.stKey;
  const insanity = assignment.rules?.insanityTopDps ?? {};
  const lines = [
    ...header,
    `规则：${pairStrategy.ruleNote}；两边各留至少2个必要覆盖（烟爆/法力喷泉/冰霜爆裂/粉尘/疫病/破甲/碎裂/致残/血刃）；自然奶按武器强化/魔法改输出 x（${stCountKey}=${natureCounts[stCountKey] ?? 0}，swarm=${natureCounts.swarm ?? 0}），输出技能元素增幅/粉尘/菌幕/缠绕，剩余自然仍群疗；非光环默认复活、前x输出改疯狂（${stCountKey}=${insanity[stCountKey] ?? 0}，swarm=${insanity.swarm ?? 0}）；攻击≥110；双 Boss 人员互斥；无复制人。`,
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
        (converted ? `；${converted}名自然奶改输出` : ""),
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

function mean(values) {
  return values.reduce((sum, value) => sum + Number(value ?? 0), 0) /
    Math.max(1, values.length);
}

async function simulateRoster(boss, roster, seed, durationSeconds) {
  const team = roster.map((entry) => buildCombatMember(entry));
  return simPool.run({
    snapshot: slimSnapshot(team[0].snapshot),
    boss,
    members: slimMembers(team),
    seed,
    durationSeconds,
    includeMembers: false,
  });
}

function snapshotForMember(memberId, combatType) {
  const cacheKey = `${memberId}:${combatType}`;
  if (snapshotCache.has(cacheKey)) return snapshotCache.get(cacheKey);
  const latest = memberMap.get(memberId)?.latestSnapshot;
  if (!latest) throw new Error(`${memberId} missing snapshot`);
  const prepared = prepareSnapshotForCombat(latest, combatType);
  if (selectCombatBuild(prepared, combatType).build) {
    snapshotCache.set(cacheKey, latest);
    return latest;
  }
  const previous = previousSnapshotWithGear(memberId, combatType);
  if (previous) {
    process.stdout.write(
      `  警告：${memberId} 当前快照无战斗装备，改用上一次有配装的快照\n`,
    );
    snapshotCache.set(cacheKey, previous);
    return previous;
  }
  throw new Error(`${memberId} missing usable combat equipment`);
}

function previousSnapshotWithGear(memberId, combatType) {
  const dbPath = process.env.MWI_GUILD_API_DB_PATH;
  if (!dbPath) return null;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        "SELECT payload_json FROM snapshots WHERE guild_id = ? AND member_id = ? ORDER BY id DESC LIMIT 8",
      )
      .all("TMD", memberId);
    for (const row of rows) {
      const snap = JSON.parse(row.payload_json);
      const prepared = prepareSnapshotForCombat(snap, combatType);
      if (selectCombatBuild(prepared, combatType).build) return snap;
    }
  } catch {
    return null;
  } finally {
    db?.close?.();
  }
  return null;
}

function buildCombatMember(entry) {
  const memberId = String(entry.memberId);
  const combatType = entry.combatType;
  const snapshot = snapshotForMember(memberId, combatType);
  const prepared = prepareSnapshotForCombat(snapshot, combatType);
  const buildSelection = selectCombatBuild(prepared, combatType);
  if (!Array.isArray(entry.abilityHrids) || entry.abilityHrids.length !== 5) {
    throw new Error(`${memberId} missing abilityHrids in roster`);
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

function averageMembers(runs, durationSeconds = 3600) {
  const byMember = new Map();
  for (const run of runs) {
    for (const member of run.members ?? []) {
      const key = member.memberId;
      const row = byMember.get(key) ?? {
        memberId: key,
        label: member.label,
        role: member.role,
        damageDone: 0,
        damageTaken: 0,
        healingDone: 0,
        healingReceived: 0,
        deaths: 0,
        oomRuns: 0,
        manaSpent: 0,
        manaRestored: 0,
        oomDurationSeconds: 0,
        abilityDamage: {},
      };
      row.damageDone += Number(member.damageDone ?? 0);
      row.damageTaken += Number(member.damageTaken ?? 0);
      row.healingDone += Number(member.healingDone ?? 0);
      row.healingReceived += Number(
        member.healingReceived ?? member.healing ?? 0,
      );
      row.deaths += Number(member.deaths ?? 0);
      row.oomRuns += member.ranOutOfMana ? 1 : 0;
      row.manaSpent += Number(member.manaSpent ?? 0);
      row.manaRestored += Number(member.manaRestored ?? 0);
      row.oomDurationSeconds += Number(member.oomDurationSeconds ?? 0);
      for (const [abilityHrid, damage] of Object.entries(
        member.abilityDamage ?? {},
      )) {
        row.abilityDamage[abilityHrid] =
          (row.abilityDamage[abilityHrid] ?? 0) + Number(damage ?? 0);
      }
      byMember.set(key, row);
    }
  }
  return [...byMember.values()].map((row) => {
    const topAbilities = Object.entries(row.abilityDamage)
      .map(([abilityHrid, damage]) => ({
        abilityHrid,
        nameZh: officialAbilityNameZh(abilityHrid) ?? abilityHrid,
        averageDamage: Number((damage / runs.length).toFixed(1)),
        averageDps: Number((damage / runs.length / durationSeconds).toFixed(2)),
      }))
      .sort((left, right) => right.averageDamage - left.averageDamage)
      .slice(0, 5);
    return {
      memberId: row.memberId,
      label: row.label,
      role: row.role,
      averageDps: Number((row.damageDone / runs.length / durationSeconds).toFixed(2)),
      averageDamageTaken: Number((row.damageTaken / runs.length).toFixed(2)),
      averageHealingDone: Number((row.healingDone / runs.length).toFixed(2)),
      averageHealingReceived: Number(
        (row.healingReceived / runs.length).toFixed(2),
      ),
      averageHealing: Number((row.healingDone / runs.length).toFixed(2)),
      deaths: row.deaths,
      oomRuns: row.oomRuns,
      averageOomDurationSeconds: Number(
        (row.oomDurationSeconds / runs.length).toFixed(2),
      ),
      averageManaSpent: Number((row.manaSpent / runs.length).toFixed(2)),
      averageManaRestored: Number((row.manaRestored / runs.length).toFixed(2)),
      topAbilities,
    };
  });
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
