/**
 * Dual-boss composition lab (heal ratio + ST/AOE packages + 3-seed final).
 * Weekly screening playbook: docs/WEEKLY_COMBAT_SCREENING.md
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  abilityDetail,
  buildPlayerMember,
  defaultAbility,
} from "../packages/shykai-full-runtime/src/guild-trial-runner.mjs";
import {
  COMBAT_RULES_VERSION,
  PERMANENT_BUFFS_ENABLED,
} from "../packages/shykai-full-runtime/src/combat-rules-version.mjs";
import {
  defaultLevelForMissingAbility,
  resolveLearnedAbilityLevel,
} from "../packages/shykai-full-runtime/src/ability-level-defaults.mjs";
import { officialAbilityNameZh } from "../packages/mwi-data/official-zh-ability-names.mjs";
import { selectCombatBuild, weaponFor } from "../packages/optimizer/src/combat-build-selection.mjs";
import {
  assessCombatMemberReadiness,
  GUILD_TRIAL_MIN_ATTACK_LEVEL,
  prepareSnapshotForCombat,
} from "../packages/optimizer/src/combat-member-readiness.mjs";
import { PRIMARY_SKILL_BY_ROLE } from "../packages/optimizer/src/combat-weapon-check.mjs";
import {
  NATURE_DPS_MIDDLE_SLOTS,
  WATER_DPS_MIDDLE_SLOTS,
  WATER_SUPPORT_COUNTS,
  isSingleTargetBossKey,
  ordinaryAbilityHridsForTemplate,
} from "../packages/optimizer/src/combat-ability-templates.mjs";
import { rankedReviveDpsIds } from "../packages/optimizer/src/combat-insanity-top-dps.mjs";
import { Worker } from "node:worker_threads";
import os from "node:os";
import {
  partitionBossByKey,
  publicBossKey,
  resolveWeeklyCombatBossPair,
} from "./weekly-combat-boss-pair.mjs";
import {
  applyTeamCaps,
  pairStrategyForStKey,
  partitionPoliciesForStrategy,
  preferHighestMysticAuraOn,
  rebalancePhysicalToward,
} from "./weekly-combat-partition.mjs";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiBase = (
  process.env.MWI_GUILD_API_BASE ?? "https://adudu.tailab136f.ts.net"
).replace(/\/$/, "");
const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY;
const guildId = process.env.MWI_GUILD_ID ?? "TMD";
const fixturePath = path.join(
  projectDirectory,
  process.env.MWI_GUILD_TRIAL_FIXTURE ??
    "fixtures/monsters/guild-trial-2026-08-28-chameleon-swarm.json",
);
const outputPath = path.join(
  projectDirectory,
  ".local/tmd-available-roster-composition-lab.json",
);
const screeningDurationSeconds = Number(
  process.env.MWI_GUILD_SCREEN_DURATION_SECONDS ?? 180,
);
const finalDurationSeconds = Number(
  process.env.MWI_GUILD_FINAL_DURATION_SECONDS ?? 3600,
);
const teamCap = Number(process.env.MWI_GUILD_TEAM_CAP ?? 52);
const excludedMemberIds = new Set(
  String(process.env.MWI_GUILD_EXCLUDE_MEMBERS ?? "xlsx,LBDYS,sh1ro")
    .split(/[,，\s]+/u)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name.toLocaleLowerCase()),
);
const workerCount = Math.max(
  1,
  Number(process.env.MWI_GUILD_SIM_WORKERS ?? Math.min(8, os.cpus().length || 4)),
);
const onlyPartition = process.env.MWI_GUILD_ONLY_PARTITION ?? "";
const insanityTopDpsCounts = parseInsanityTopDpsCounts(
  process.env.MWI_GUILD_INSANITY_TOP_DPS ?? "",
);
const seeds = [1297565953, 1297565954, 1297565955];
const roleOrder = ["弓", "弩", "火", "水", "自", "盾", "枪", "剑", "锤"];
const roleSlug = {
  弓: "bow",
  弩: "crossbow",
  火: "fire",
  水: "water",
  自: "nature",
  盾: "shield",
  枪: "spear",
  剑: "sword",
  锤: "hammer",
};
const auraHrids = [
  "/abilities/speed_aura",
  "/abilities/guardian_aura",
  "/abilities/fierce_aura",
  "/abilities/critical_aura",
  "/abilities/mystic_aura",
];

/** Multi-enemy AOE packages. Coverage (烟爆/疫病) is locked to 2 carriers. */
const aoePackageCandidates = [
  {
    id: "aoe-precision-rain-smoke2",
    rangedDpsKit: "precision_rain",
    fireSmokeBurstCount: 2,
    rangedDebuffCount: 2,
  },
  {
    id: "aoe-frenzy-rain-smoke2",
    rangedDpsKit: "frenzy_rain",
    fireSmokeBurstCount: 2,
    rangedDebuffCount: 2,
  },
];

/** Chameleon / single-target packages. */
const stPackageCandidates = [
  {
    id: "st-ranged-pestilent-smoke",
    crossbowSupportCount: 2,
    rangedOptional: "pestilent_shot",
    fireOptional: "firestorm",
    spearOptional: "frenzy",
  },
  {
    id: "st-ranged-pestilent-flameblast",
    crossbowSupportCount: 2,
    rangedOptional: "pestilent_shot",
    fireOptional: "flame_blast",
    spearOptional: "frenzy",
  },
  {
    id: "st-ranged-steady-smoke",
    crossbowSupportCount: 2,
    rangedOptional: "steady_shot",
    fireOptional: "firestorm",
    spearOptional: "frenzy",
  },
  {
    id: "st-ranged-frenzy-pestilent",
    crossbowSupportCount: 1,
    rangedOptional: "frenzy",
    fireOptional: "firestorm",
    spearOptional: "frenzy",
  },
];

function packageCandidatesForBoss(publicKey) {
  return isSingleTargetBossKey(publicKey)
    ? stPackageCandidates
    : aoePackageCandidates;
}

if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required");

const headers = { "x-admin-key": adminKey };
const [membersRes, bindingsRes, fixture] = await Promise.all([
  fetch(`${apiBase}/api/guilds/${encodeURIComponent(guildId)}/members`, {
    headers,
  }),
  fetch(`${apiBase}/api/guilds/${encodeURIComponent(guildId)}/qq-bindings`, {
    headers,
  }),
  readFile(fixturePath, "utf8").then(JSON.parse),
]);
if (!membersRes.ok || !bindingsRes.ok) {
  throw new Error("failed to load guild API inputs");
}
const membersData = await membersRes.json();
const bindingsData = await bindingsRes.json();
const memberMap = new Map(membersData.members.map((m) => [m.memberId, m]));

const usableByRole = new Map(roleOrder.map((role) => [role, []]));
const unavailable = [];
for (const binding of bindingsData.bindings) {
  if (excludedMemberIds.has(String(binding.memberId).toLocaleLowerCase())) {
    unavailable.push({
      memberId: binding.memberId,
      combatType: binding.combatType,
      reason: "手动排除（不参加）",
    });
    continue;
  }
  const snapshot = memberMap.get(binding.memberId)?.latestSnapshot;
  const readiness = assessCombatMemberReadiness(snapshot, binding.combatType);
  if (!readiness.ok) {
    unavailable.push({
      memberId: binding.memberId,
      combatType: binding.combatType,
      reason: readiness.reason,
    });
    continue;
  }
  const preparedSnapshot = prepareSnapshotForCombat(
    snapshot,
    binding.combatType,
  );
  const buildSelection = selectCombatBuild(
    preparedSnapshot,
    binding.combatType,
  );
  usableByRole.get(binding.combatType).push({
    memberId: binding.memberId,
    combatType: binding.combatType,
    qqNumber: binding.qqNumber,
    snapshot: preparedSnapshot,
    build: buildSelection.build,
    buildSelectionSource: buildSelection.source,
    defaultedAbilityHrids: readiness.defaultedAbilityHrids ?? [],
  });
}
for (const rows of usableByRole.values()) {
  rows.sort((left, right) => left.memberId.localeCompare(right.memberId));
}

const availableCount = sumMap(usableByRole);
const boundDistribution = Object.fromEntries(
  roleOrder.map((role) => [role, usableByRole.get(role)?.length ?? 0]),
);
const weekly = resolveWeeklyCombatBossPair(fixture);
const bossByKey = partitionBossByKey(weekly);
const pairStrategy = pairStrategyForStKey(weekly.stKey);
const partitionPolicies = partitionPoliciesForStrategy(pairStrategy);
process.stdout.write(
  `可用绑定 ${availableCount} 人（不可用 ${unavailable.length}）；` +
    `职业 ${formatCounts(boundDistribution)}；每场上限 ${teamCap}；并行 ${workerCount}。\n` +
    `说明：不按报名；排除 ${[...excludedMemberIds].join("/")}；${pairStrategy.ruleNote}；两边各留至少2个必要覆盖；自然全治疗；非光环默认复活、前x输出改疯狂；攻击≥${GUILD_TRIAL_MIN_ATTACK_LEVEL}。\n`,
);

const simPool = createSimPool(workerCount);
const screenedPartitions = [];
try {
  for (const policy of partitionPolicies) {
    if (onlyPartition && policy.id !== onlyPartition) continue;
    const pools = partitionAvailableMembers(usableByRole, policy);
    const cappedPools = applyTeamCaps(pools, teamCap, {
      capTeamPool,
      leftoversAfterCap,
      mergeRolePools,
      sumMap,
    });
    const capped = preferHighestMysticAuraOn(
      pairStrategy.mysticAuraSide,
      rebalancePhysicalToward(pairStrategy.physicalRebalanceSide, cappedPools, {
        roleOrder,
        physicalCombatLevel,
        targetLabel:
          pairStrategy.physicalRebalanceSide === "chameleon"
            ? weekly.stLabel
            : weekly.swarmLabel,
        log: (text) => process.stdout.write(text),
      }),
      {
        roleOrder,
        mysticAuraLevel,
        targetLabel:
          pairStrategy.mysticAuraSide === "chameleon"
            ? weekly.stLabel
            : weekly.swarmLabel,
        log: (text) => process.stdout.write(text),
      },
    );
    const overflowNote = [
      cappedPools.overflow.chameleon
        ? `${weekly.stLabel}溢出${cappedPools.overflow.chameleon}`
        : "",
      cappedPools.overflow.swarm
        ? `${weekly.swarmLabel}溢出${cappedPools.overflow.swarm}`
        : "",
    ]
      .filter(Boolean)
      .join("，");
    process.stdout.write(
      `\n## 分区 ${policy.id}\n` +
        `  ${weekly.stLabel}候选 ${sumMap(pools.chameleon)}` +
        `→上场 ${sumMap(capped.chameleon)} ${formatCounts(countRoles(capped.chameleon))}\n` +
        `  ${weekly.swarmLabel}候选 ${sumMap(pools.swarm)}` +
        `→上场 ${sumMap(capped.swarm)} ${formatCounts(countRoles(capped.swarm))}` +
        (overflowNote ? `（${overflowNote}）` : "") +
        `\n`,
    );

    const bossBest = {};
    const bossScores = {};
    await Promise.all(
      Object.entries(bossByKey).map(async ([partitionKey, boss]) => {
        const publicKey = publicBossKey(partitionKey, weekly);
        const sources = capped[partitionKey];
        const roleTargets = countRoles(sources);
        const teamSize = Object.values(roleTargets).reduce((sum, n) => sum + n, 0);
        if (teamSize < 1) throw new Error(`${boss.nameZh} empty after partition`);

        const stKit = isSingleTargetBossKey(publicKey);
        const packageDurationSeconds = stKit
          ? screeningDurationSeconds
          : Number(
            process.env.MWI_GUILD_AOE_SCREEN_DURATION_SECONDS ??
              finalDurationSeconds,
          );
        const packageRuns = await Promise.all(
          packageCandidatesForBoss(publicKey).map(async (baseDefinition) => {
            const definition = {
              ...baseDefinition,
              roleTargets,
              bossKey: publicKey,
            };
            const team = createTeamFromSources(definition, sources);
            const run = await simPool.run({
              snapshot: slimSnapshot(team[0].snapshot),
              boss,
              members: slimMembers(team),
              seed: seeds[0],
              durationSeconds: packageDurationSeconds,
              includeMembers: false,
            });
            return { definition, team, score: score(run), run };
          }),
        );
        packageRuns.sort(compareCandidates);
        for (const row of packageRuns) {
          process.stdout.write(
            `  [${boss.nameZh}/${policy.id}] ${row.definition.id}: 层=${row.run.wavesCleared}，` +
              `末层=${row.run.finalProgressPercent}%，DPS=${Math.round(row.run.teamDps)}，` +
              `死亡=${row.run.totalDeaths}` +
              (stKit ? `\n` : `（AOE包筛 ${packageDurationSeconds}s）\n`),
          );
        }
        const tuned = await tuneRoleKits({
          bossKey: publicKey,
          boss,
          sources,
          base: packageRuns[0],
          simPool,
          screeningDurationSeconds,
          seed: seeds[0],
        });
        bossBest[partitionKey] = tuned;
        bossScores[partitionKey] = tuned.score;
      }),
    );
    screenedPartitions.push({
      policy,
      capped,
      bossBest,
      jointScore: bossScores.chameleon + bossScores.swarm,
      jointDeaths:
        Number(bossBest.chameleon.run.totalDeaths ?? 0) +
        Number(bossBest.swarm.run.totalDeaths ?? 0),
    });
  }

  screenedPartitions.sort(
    (left, right) =>
      right.jointScore - left.jointScore ||
      left.jointDeaths - right.jointDeaths ||
      left.policy.id.localeCompare(right.policy.id),
  );

  const topPartitions = screenedPartitions.slice(
    0,
    Math.max(1, Number(process.env.MWI_GUILD_FULL_VALIDATE_PARTITIONS ?? 2)),
  );
  process.stdout.write(
    `\n将完整验证 ${topPartitions.length}/${screenedPartitions.length} 个分区…\n`,
  );
  const finalized = [];
  for (const partition of topPartitions) {
    process.stdout.write(`\n## 完整验证分区 ${partition.policy.id}\n`);
    const bosses = [];
    for (const [bossKey, boss] of Object.entries(bossByKey)) {
      const selected = partition.bossBest[bossKey];
      const publicKey = publicBossKey(bossKey, weekly);
      let team = selected.team;
      let fullRuns = await Promise.all(
        seeds.map((seed) =>
          simPool.run({
            snapshot: slimSnapshot(team[0].snapshot),
            boss,
            members: slimMembers(team),
            seed,
            durationSeconds: finalDurationSeconds,
            includeMembers: true,
          }),
        ),
      );
      for (const run of fullRuns) {
        process.stdout.write(
          `  ${boss.nameZh} seed ${run.seed}: 层=${run.wavesCleared}，` +
            `末层=${run.finalProgressPercent}%，DPS=${Math.round(run.teamDps)}，` +
            `死亡=${run.totalDeaths}\n`,
        );
      }
      const insanityCount = Number(insanityTopDpsCounts[publicKey] ?? 0);
      if (insanityCount > 0) {
        const rankingAverages = averageMembers(fullRuns, finalDurationSeconds);
        const ranked = rankedReviveDpsIds(
          team.map((member) => ({
            memberId: member.sourceMemberId,
            duty: member.role,
            auraHrid: member.auraHrid ?? null,
            abilityHrids: member.abilities.map((ability) => ability.abilityHrid),
          })),
          new Map(
            rankingAverages.map((row) => [
              String(row.memberId),
              Number(row.averageDps ?? 0),
            ]),
          ),
        );
        const insanityMemberIds = new Set(ranked.slice(0, insanityCount));
        team = createTeamFromSources(
          { ...selected.definition, insanityMemberIds },
          partition.capped[bossKey],
        );
        process.stdout.write(
          `  ${boss.nameZh} 前${insanityCount}输出/减益改疯狂：${ranked.slice(0, insanityCount).join("、") || "无人"}\n`,
        );
        fullRuns = await Promise.all(
          seeds.map((seed) =>
            simPool.run({
              snapshot: slimSnapshot(team[0].snapshot),
              boss,
              members: slimMembers(team),
              seed,
              durationSeconds: finalDurationSeconds,
              includeMembers: true,
            }),
          ),
        );
        for (const run of fullRuns) {
          process.stdout.write(
            `  ${boss.nameZh} 疯狂x=${insanityCount} seed ${run.seed}: 层=${run.wavesCleared}，` +
              `末层=${run.finalProgressPercent}%，DPS=${Math.round(run.teamDps)}，` +
              `死亡=${run.totalDeaths}\n`,
          );
        }
      }
      const memberAverages = averageMembers(fullRuns, finalDurationSeconds);
      bosses.push({
        bossId: boss.hrid,
        bossName: boss.nameZh,
        bossKey: publicKey,
        participantCount: team.length,
      enemiesPerEncounter:
          boss.enemiesPerEncounter ??
          boss.enemyHrids?.length ??
          boss.enemies?.length ??
          1,
        roleTargets: countRoles(partition.capped[bossKey]),
        selectedCandidate: selected.definition.id,
        team: summarizeTeam(team),
        roster: team.map((member) => ({
          memberId: member.sourceMemberId,
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
        })),
        runs: fullRuns.map((run) => ({
          seed: run.seed,
          stopReason: run.stopReason,
          endedAt: run.endedAt,
          simulatedTime: run.simulatedTime,
          finalMonsterLevel: run.finalMonsterLevel,
          livingEnemies: run.livingEnemies,
          wavesCleared: run.wavesCleared,
          finalMonsterHp: run.finalMonsterHp,
          finalMonsterMaxHp: run.finalMonsterMaxHp,
          finalProgressPercent: run.finalProgressPercent,
          teamDps: run.teamDps,
          totalDeaths: run.totalDeaths,
          oomMembers: run.oomMembers,
        })),
        memberAverages,
        supportContributions: buildSupportContributions(
          team,
          memberAverages,
          fullRuns,
        ),
        insanityTopDpsCount: Number(insanityTopDpsCounts[publicKey] ?? 0),
        averageScore:
          fullRuns.reduce((sum, run) => sum + score(run), 0) / fullRuns.length,
        averageDeaths:
          fullRuns.reduce((sum, run) => sum + Number(run.totalDeaths ?? 0), 0) /
          fullRuns.length,
      });
    }
    finalized.push({
      partitionId: partition.policy.id,
      jointScore: bosses.reduce((sum, boss) => sum + boss.averageScore, 0),
      jointDeaths: bosses.reduce((sum, boss) => sum + boss.averageDeaths, 0),
      bosses,
    });
  }

  finalized.sort(
    (left, right) =>
      right.jointScore - left.jointScore ||
      left.jointDeaths - right.jointDeaths ||
      left.partitionId.localeCompare(right.partitionId),
  );
  const winner = finalized[0];

  const assignment = {
    schemaVersion: 1,
    kind: "tmd-available-roster-composition-lab",
    developmentOnly: true,
    promotable: false,
    guildId,
    generatedAt: new Date().toISOString(),
    combatRulesVersion: COMBAT_RULES_VERSION,
    permanentBuffsEnabled: PERMANENT_BUFFS_ENABLED,
    engine: "shykai-full-event-runtime",
    rules: {
      durationSeconds: finalDurationSeconds,
      startLevel: 100,
      levelStep: 10,
      maxLevel: 300,
      teamCap,
      consumables: "disabled",
      passiveHpMpRegenFlatBonus: 0.03,
      refillHpMpOnLevelTransition: true,
      maxParryAttemptsPerIncomingAttack: 5,
      missingOrdinarySkillsDefaultLevel: 40,
      missingReviveInsanityDefaultLevel: 1,
      minAttackLevel: GUILD_TRIAL_MIN_ATTACK_LEVEL,
      abilityTemplates: {
        [weekly.stKey]: isSingleTargetBossKey(weekly.stKey)
          ? `${weekly.stKey}-st-2026-08-28`
          : `${weekly.stKey}-aoe-2026-08-21`,
        swarm: "swarm-aoe-2026-08-28",
      },
      specialAndAuraAssignment: Object.keys(insanityTopDpsCounts).length
        ? "aura-carriers-then-revive-top-dps-insanity"
        : "aura-carriers-then-revive",
      insanityTopDps: insanityTopDpsCounts,
      auraAssignment: "guardian-on-shield-highest-level-elsewhere",
      healerKit:
        "st-rejuvenate-affinity-life_drain-entangle (lowest-3 pollen) / aoe-rejuvenate-pollen-veil-entangle",
      seeds,
      workerCount,
    },
    source: {
      mode: "all-available-bound-members-reassigned",
      availableCount,
      boundDistribution,
      unavailable,
      note:
        `不使用报名名单。排除 xlsx/LBDYS/sh1ro。${pairStrategy.ruleNote}；两边各留至少2个必要覆盖；自然全治疗；非光环默认复活、前x输出改疯狂${formatInsanityCounts(insanityTopDpsCounts)}；攻击≥${GUILD_TRIAL_MIN_ATTACK_LEVEL}。`,
    },
    partitionSearch: screenedPartitions.map((row) => ({
      id: row.policy.id,
      jointScore: row.jointScore,
      jointDeaths: row.jointDeaths,
      chameleon: formatCounts(countRoles(row.capped.chameleon)),
      swarm: formatCounts(countRoles(row.capped.swarm)),
      chameleonPackage: row.bossBest.chameleon.definition.id,
      swarmPackage: row.bossBest.swarm.definition.id,
    })),
    selectedPartition: winner.partitionId,
    bosses: winner.bosses,
    summaryText: buildSummary(winner, availableCount, unavailable),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(assignment, null, 2));
  process.stdout.write(`\n${assignment.summaryText}\n\n已写入 ${outputPath}\n`);
} finally {
  await simPool.close();
}

function partitionAvailableMembers(allSourcesByRole, policy) {
  const chameleon = new Map(roleOrder.map((role) => [role, []]));
  const swarm = new Map(roleOrder.map((role) => [role, []]));
  for (const role of roleOrder) {
    const sources = [...(allSourcesByRole.get(role) ?? [])];
    for (let index = 0; index < sources.length; index += 1) {
      const side = policy.assign(role, index, sources.length);
      (side === "chameleon" ? chameleon : swarm).get(role).push(sources[index]);
    }
  }
  const chameleonIds = new Set(
    [...chameleon.values()].flat().map((row) => row.memberId),
  );
  const overlap = [...swarm.values()]
    .flat()
    .map((row) => row.memberId)
    .filter((memberId) => chameleonIds.has(memberId));
  if (overlap.length) {
    throw new Error(`Partition overlap: ${[...new Set(overlap)].join(", ")}`);
  }
  return { chameleon, swarm };
}

function capTeamPool(poolByRole, cap) {
  // Prefer members who already own insanity/revive/invincible so unique aura
  // slots are enough for the few who lack a reusable special.
  const rankedByRole = new Map(
    roleOrder.map((role) => {
      const rows = [...(poolByRole.get(role) ?? [])].sort((left, right) => {
        const leftSpecial = Number(hasReusableSpecial(left));
        const rightSpecial = Number(hasReusableSpecial(right));
        return (
          rightSpecial - leftSpecial ||
          left.memberId.localeCompare(right.memberId)
        );
      });
      return [role, rows];
    }),
  );
  const total = sumMap(rankedByRole);
  let capped;
  if (total <= cap) {
    capped = new Map(
      roleOrder.map((role) => [role, [...(rankedByRole.get(role) ?? [])]]),
    );
  } else {
    const counts = countRoles(rankedByRole);
    const targets = proportionalRoleTargets(counts, cap);
    capped = new Map(roleOrder.map((role) => [role, []]));
    for (const role of roleOrder) {
      capped.set(
        role,
        (rankedByRole.get(role) ?? []).slice(0, targets[role] ?? 0),
      );
    }
    let size = sumMap(capped);
    if (size < cap) {
      const leftovers = roleOrder.flatMap((role) =>
        (rankedByRole.get(role) ?? [])
          .slice(capped.get(role).length)
          .map((row) => ({ role, row })),
      );
      for (const entry of leftovers) {
        if (size >= cap) break;
        capped.get(entry.role).push(entry.row);
        size += 1;
      }
    }
  }
  return limitMembersWithoutSpecial(capped, rankedByRole, cap);
}

/** Members present in fullPool but not selected into capped. */
function leftoversAfterCap(fullPool, capped) {
  const used = new Set(
    [...capped.values()].flat().map((row) => row.memberId),
  );
  return new Map(
    roleOrder.map((role) => [
      role,
      (fullPool.get(role) ?? []).filter((row) => !used.has(row.memberId)),
    ]),
  );
}

/** Append extra role pools without duplicating memberIds. */
function mergeRolePools(primary, extra) {
  const merged = new Map(
    roleOrder.map((role) => [role, [...(primary.get(role) ?? [])]]),
  );
  const used = new Set(
    [...merged.values()].flat().map((row) => row.memberId),
  );
  for (const role of roleOrder) {
    for (const row of extra.get(role) ?? []) {
      if (used.has(row.memberId)) continue;
      merged.get(role).push(row);
      used.add(row.memberId);
    }
  }
  return merged;
}

function mysticAuraLevel(member) {
  const value = member?.snapshot?.learnedAbilities?.["/abilities/mystic_aura"];
  return Number.isFinite(value) ? value : 0;
}

function physicalCombatLevel(member) {
  const skills = member?.snapshot?.skills ?? {};
  const hrid = member.combatType === "弓" || member.combatType === "弩"
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

function limitMembersWithoutSpecial(capped, fullPool, cap) {
  const flat = roleOrder.flatMap((role) =>
    (capped.get(role) ?? []).map((row) => ({ role, row })),
  );
  const without = flat.filter((entry) => !hasReusableSpecial(entry.row));
  if (!without.length) return capped;

  const keepIds = new Set(
    selectAssignableAuraMembers(without.map((entry) => entry.row)).map(
      (member) => member.memberId,
    ),
  );
  const dropIds = new Set(
    without
      .filter((entry) => !keepIds.has(entry.row.memberId))
      .map((entry) => entry.row.memberId),
  );
  if (!dropIds.size) return capped;

  const next = new Map(
    roleOrder.map((role) => [
      role,
      (capped.get(role) ?? []).filter((row) => !dropIds.has(row.memberId)),
    ]),
  );
  let size = sumMap(next);
  if (size < Math.min(cap, sumMap(fullPool))) {
    const used = new Set(
      [...next.values()].flat().map((row) => row.memberId),
    );
    const replacements = roleOrder.flatMap((role) =>
      (fullPool.get(role) ?? [])
        .filter(
          (row) => !used.has(row.memberId) && hasReusableSpecial(row),
        )
        .map((row) => ({ role, row })),
    );
    for (const entry of replacements) {
      if (size >= cap) break;
      next.get(entry.role).push(entry.row);
      used.add(entry.row.memberId);
      size += 1;
    }
  }
  return next;
}

/**
 * Pick at most 5 no-special members whose learned auras can be uniquely assigned.
 * Preference: fewer aura options first, then higher best aura level.
 */
function selectAssignableAuraMembers(members) {
  const ranked = [...members].sort((left, right) => {
    const leftOptions = knownAuras(left).length;
    const rightOptions = knownAuras(right).length;
    return (
      leftOptions - rightOptions ||
      bestAuraLevel(right) - bestAuraLevel(left) ||
      left.memberId.localeCompare(right.memberId)
    );
  });
  const selected = [];
  const usedAuras = new Set();
  for (const member of ranked) {
    if (selected.length >= auraHrids.length) break;
    const choice = knownAuras(member)
      .filter((hrid) => !usedAuras.has(hrid))
      .sort(
        (left, right) =>
          member.snapshot.learnedAbilities[right] -
            member.snapshot.learnedAbilities[left] ||
          left.localeCompare(right),
      )[0];
    if (!choice) continue;
    selected.push(member);
    usedAuras.add(choice);
  }
  return selected;
}

function knownAuras(member) {
  return auraHrids.filter((hrid) =>
    Number.isFinite(member.snapshot.learnedAbilities[hrid]),
  );
}

function bestAuraLevel(member) {
  return Math.max(
    0,
    ...auraHrids.map(
      (hrid) => Number(member.snapshot.learnedAbilities[hrid]) || 0,
    ),
  );
}

function proportionalRoleTargets(distribution, total) {
  const entries = roleOrder.map((role, index) => {
    const countValue = distribution[role] ?? 0;
    return {
      role,
      index,
      countValue,
      exact: (countValue / Math.max(1, Object.values(distribution).reduce((a, b) => a + b, 0))) * total,
      value: 0,
    };
  });
  let assigned = 0;
  for (const entry of entries) {
    entry.value = Math.floor(entry.exact);
    assigned += entry.value;
  }
  let remaining = total - assigned;
  entries
    .map((entry) => ({
      ...entry,
      frac: entry.exact - entry.value,
    }))
    .sort(
      (left, right) =>
        right.frac - left.frac ||
        right.countValue - left.countValue ||
        left.index - right.index,
    )
    .forEach((entry) => {
      if (remaining > 0 && entry.countValue > entry.value) {
        const target = entries.find((row) => row.role === entry.role);
        target.value += 1;
        remaining -= 1;
      }
    });
  // Ensure we never request more than available for a role.
  for (const entry of entries) {
    entry.value = Math.min(entry.value, entry.countValue);
  }
  let size = entries.reduce((sum, entry) => sum + entry.value, 0);
  if (size < total) {
    for (const entry of entries.sort(
      (left, right) =>
        right.countValue - right.value - (left.countValue - left.value) ||
        left.index - right.index,
    )) {
      while (size < total && entry.value < entry.countValue) {
        entry.value += 1;
        size += 1;
      }
    }
  }
  return Object.fromEntries(entries.map((entry) => [entry.role, entry.value]));
}

/**
 * A/B kit variants after the best ranged package is chosen.
 * Chameleon (ST): nature DPS middle, water DPS middle, water support count.
 * Swarm (AOE): keep 6 nature healers; only A/B healer free slot.
 *   Do NOT cut healers on short/mid screens — early waves have little
 *   survival pressure and will falsely prefer all-DPS natures.
 */
async function tuneRoleKits({
  bossKey,
  boss,
  sources,
  base,
  simPool,
  screeningDurationSeconds,
  seed,
}) {
  const variants = isSingleTargetBossKey(bossKey)
    ? buildSingleTargetKitVariants()
    : buildAoeKitVariants(base.definition);
  const aoeKit = !isSingleTargetBossKey(bossKey);
  // Healer count is locked at 6; free-slot A/B is secondary and can use the
  // short screen. Package choice already ran at full AOE duration.
  const kitDurationSeconds = aoeKit
    ? Number(
      process.env.MWI_GUILD_AOE_KIT_DURATION_SECONDS ?? screeningDurationSeconds,
    )
    : screeningDurationSeconds;

  const runs = await Promise.all(
    variants.map(async (variant) => {
      const definition = {
        ...base.definition,
        ...variant,
      };
      const team = createTeamFromSources(definition, sources);
      const run = await simPool.run({
        snapshot: slimSnapshot(team[0].snapshot),
        boss,
        members: slimMembers(team),
        seed,
        durationSeconds: kitDurationSeconds,
        includeMembers: true,
      });
      const healDone = (run.members ?? []).reduce(
        (sum, member) => sum + Number(member.healingDone ?? member.healing ?? 0),
        0,
      );
      const damageTaken = (run.members ?? []).reduce(
        (sum, member) => sum + Number(member.damageTaken ?? 0),
        0,
      );
      return {
        definition,
        team,
        run,
        score: score(run),
        healDone,
        damageTaken,
        healRatio: damageTaken > 0 ? healDone / damageTaken : 1,
        variant,
      };
    }),
  );
  runs.sort(
    (left, right) =>
      right.score - left.score ||
      left.run.totalDeaths - right.run.totalDeaths ||
      right.run.teamDps - left.run.teamDps,
  );
  for (const row of runs) {
    process.stdout.write(
      `    技能 ${formatKitVariant(row.variant)}: ` +
        `层=${row.run.wavesCleared} 末层=${row.run.finalProgressPercent}% ` +
        `DPS=${Math.round(row.run.teamDps)} 死亡=${row.run.totalDeaths} ` +
        `治疗/承伤=${(row.healRatio * 100).toFixed(0)}%\n`,
    );
  }
  const best = runs[0];
  process.stdout.write(
    `    → 选用 ${formatKitVariant(best.variant)}` +
      (aoeKit ? `（虫群技能筛 ${kitDurationSeconds}s）\n` : `\n`),
  );
  return best;
}

function buildSingleTargetKitVariants() {
  const variants = [];
  for (const natureDpsMiddle of NATURE_DPS_MIDDLE_SLOTS) {
    for (const waterDpsMiddle of WATER_DPS_MIDDLE_SLOTS) {
      for (const waterSupportCount of WATER_SUPPORT_COUNTS) {
        variants.push({ natureDpsMiddle, waterDpsMiddle, waterSupportCount });
      }
    }
  }
  return variants;
}

function buildAoeKitVariants(baseDefinition = {}) {
  return [
    {
      rangedDpsKit: baseDefinition.rangedDpsKit ?? "precision_rain",
      fireSmokeBurstCount: Number(baseDefinition.fireSmokeBurstCount ?? 2),
      rangedDebuffCount: Number(baseDefinition.rangedDebuffCount ?? 2),
    },
  ];
}

function formatKitVariant(variant) {
  if (variant.rangedDpsKit || variant.natureHealerCount != null) {
    return (
      `弓弩DPS=${variant.rangedDpsKit ?? "—"} 火烟爆=${variant.fireSmokeBurstCount ?? 0}人 ` +
      `减益=${variant.rangedDebuffCount ?? "—"} ` +
      `奶人数=${variant.natureHealerCount ?? "—"} ` +
      `奶槽=${variant.natureHealerFreeSlot ?? "群疗/粉尘/菌幕/缠绕"}`
    );
  }
  if (variant.natureDpsMiddle) {
    return (
      `自中=${variant.natureDpsMiddle} 水中=${variant.waterDpsMiddle} ` +
      `水支援=${variant.waterSupportCount}`
    );
  }
  return `奶自由=${variant.natureHealerFreeSlot ?? "—"}`;
}

/**
 * @deprecated use tuneRoleKits
 */
async function tuneNatureFreeSlots(args) {
  return tuneRoleKits(args);
}

function createTeamFromSources(definition, sourcesByRole) {
  const raw = [];
  const aoeBoss = !isSingleTargetBossKey(definition.bossKey);
  for (const role of roleOrder) {
    const sources = [...(sourcesByRole.get(role) ?? [])];
    if ((aoeBoss && role === "火") || (!aoeBoss && role === "自")) {
      sources.sort(compareLowDpsCoverageFirst);
    }
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      raw.push({
        ...source,
        roleIndex: index,
        totalForRole: sources.length,
        cloneIndex: 1,
        duty: "dps",
        auraHrid: null,
      });
    }
  }
  if (!raw.length) throw new Error("empty team");
  assignDuties(raw, definition);
  assignAuras(raw);
  // Members who neither carry an aura nor own insanity/revive/invincible cannot
  // fill the special slot — drop them rather than forcing a low-level aura.
  const kept = raw.filter(
    (member) =>
      member.combatType === "盾" ||
      member.auraHrid ||
      hasReusableSpecial(member),
  );
  if (!kept.length) throw new Error("team empty after aura assignment");
  return kept.map((row, index) => {
    const ordinary = ordinaryAbilityHrids(row, definition);
    const special = row.auraHrid ?? preferredSpecialHrid(row, definition);
    const selectedOrdinary = enforceZeroCooldownLast(
      selectLearnedOrdinary(row.snapshot, ordinary, 4),
    );
    const selected = [special, ...selectedOrdinary];
    if (selected.length !== 5) {
      throw new Error(
        `${row.memberId}/${row.combatType} only produced ${selected.length} abilities`,
      );
    }
    const member = buildPlayerMember({
      build: row.build,
      label: `${row.memberId}·${row.combatType}·${dutyName(row.duty)}`,
      role: row.duty,
      memberId: row.memberId,
      snapshot: row.snapshot,
      abilities: selected.map((abilityHrid) =>
        defaultAbility(abilityHrid, row.snapshot.learnedAbilities),
      ),
      combatType: row.combatType,
      sourceMemberId: row.memberId,
    });
    member.combatType = row.combatType;
    member.sourceMemberId = row.memberId;
    member.cloneIndex = 1;
    member.auraHrid = row.auraHrid ?? null;
    return member;
  });
}

function assignDuties(team, definition) {
  const waterSupportCount = Number(definition.waterSupportCount ?? 1);
  for (const member of team) {
    if (member.combatType === "盾") member.duty = "tank";
    if (member.combatType === "水") {
      member.waterRole =
        member.roleIndex < waterSupportCount ? "support" : "dps";
    }
    if (member.combatType === "自") {
      member.duty = "healer";
    }
    if (member.combatType === "枪" && member.roleIndex < 2) {
      member.duty = "debuffer";
    }
    if (member.combatType === "锤" && member.roleIndex < 2) {
      member.duty = "debuffer";
    }
    if (member.combatType === "剑") member.duty = "debuffer";
    if (member.combatType === "火") member.duty = "debuffer";
  }

  if (definition.rangedDebuffCount != null) {
    assignSwarmRangedDebuffers(team, definition.rangedDebuffCount);
    return;
  }

  for (const member of team) {
    if (
      member.combatType === "弩" &&
      member.roleIndex < definition.crossbowSupportCount
    ) {
      member.duty = "debuffer";
    }
  }
}

function assignSwarmRangedDebuffers(team, rangedDebuffCount) {
  const ranged = team
    .filter((member) => member.combatType === "弓" || member.combatType === "弩")
    .sort(compareLowDpsCoverageFirst);
  for (const [index, member] of ranged.entries()) {
    member.duty = index < rangedDebuffCount ? "debuffer" : "dps";
  }
}

function snapshotSkillLevel(snapshot, skillHrid) {
  const value = snapshot?.skills?.[skillHrid];
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object") {
    const level = Number(value.level ?? value.buffedLevel);
    return Number.isFinite(level) ? level : 0;
  }
  return 0;
}

/** Lower primary skill / weapon enhance first so coverage kits sit on weaker DPS. */
function coverageDpsProxy(member) {
  const primary = PRIMARY_SKILL_BY_ROLE[member.combatType] ?? {
    skillHrid: "/skills/attack",
  };
  const skill = snapshotSkillLevel(member.snapshot, primary.skillHrid);
  const weapon = member.build ? weaponFor(member.build) : null;
  const enhance = Number(weapon?.enhancementLevel ?? 0);
  return skill * 100 + enhance;
}

function compareLowDpsCoverageFirst(left, right) {
  return (
    coverageDpsProxy(left) - coverageDpsProxy(right) ||
    left.memberId.localeCompare(right.memberId)
  );
}

/**
 * Guardian Aura is fixed on 盾; remaining auras go to highest-level carriers.
 */
function assignAuras(team) {
  for (const member of team) member.auraHrid = null;
  const unused = new Set(team);
  const remainingAuras = new Set(auraHrids);

  const shields = team.filter((member) => member.combatType === "盾");
  for (const member of shields) {
    if (
      !Number.isFinite(
        member.snapshot.learnedAbilities["/abilities/guardian_aura"],
      )
    ) {
      throw new Error(
        `${member.memberId} is bound as 盾 but has not learned Guardian Aura`,
      );
    }
    member.auraHrid = "/abilities/guardian_aura";
    unused.delete(member);
  }
  if (shields.length) {
    remainingAuras.delete("/abilities/guardian_aura");
  }

  const forcedAuraMembers = team.filter(
    (member) => !hasReusableSpecial(member) && member.combatType !== "盾",
  );
  for (const member of forcedAuraMembers) {
    const selectedAura = [...remainingAuras]
      .filter((auraHrid) =>
        Number.isFinite(member.snapshot.learnedAbilities[auraHrid]),
      )
      .sort(
        (left, right) =>
          member.snapshot.learnedAbilities[right] -
            member.snapshot.learnedAbilities[left] ||
          left.localeCompare(right),
      )[0];
    if (!selectedAura) {
      throw new Error(
        `${member.memberId} requires an aura slot but no unique aura remains`,
      );
    }
    member.auraHrid = selectedAura;
    remainingAuras.delete(selectedAura);
    unused.delete(member);
  }

  const orderedAuras = [...remainingAuras]
    .map((auraHrid) => ({
      auraHrid,
      candidates: team.filter(
        (member) =>
          member.combatType !== "盾" &&
          Number.isFinite(member.snapshot.learnedAbilities[auraHrid]),
      ),
    }))
    .sort(
      (left, right) =>
        left.candidates.length - right.candidates.length ||
        left.auraHrid.localeCompare(right.auraHrid),
    );

  for (const { auraHrid, candidates } of orderedAuras) {
    const eligible = candidates
      .filter((member) => unused.has(member))
      .sort(
        (left, right) =>
          right.snapshot.learnedAbilities[auraHrid] -
            left.snapshot.learnedAbilities[auraHrid] ||
          auraDutyPreference(auraHrid, right) -
            auraDutyPreference(auraHrid, left) ||
          left.memberId.localeCompare(right.memberId),
      );
    const selected = eligible[0];
    if (!selected) {
      throw new Error(`No unique carrier for ${auraHrid}`);
    }
    selected.auraHrid = auraHrid;
    unused.delete(selected);
  }
}

function auraDutyPreference(auraHrid, member) {
  if (auraHrid === "/abilities/mystic_aura") {
    return ["healer", "debuffer"].includes(member.duty) ? 2 : 0;
  }
  if (
    ["/abilities/fierce_aura", "/abilities/critical_aura"].includes(auraHrid)
  ) {
    return ["弓", "弩", "枪", "锤"].includes(member.combatType) ? 2 : 0;
  }
  return 1;
}

function hasReusableSpecial(member) {
  // Game baseline: insanity/revive are always at least Lv1.
  return (
    resolveLearnedAbilityLevel(
      "/abilities/insanity",
      member.snapshot.learnedAbilities,
    ) != null ||
    resolveLearnedAbilityLevel(
      "/abilities/revive",
      member.snapshot.learnedAbilities,
    ) != null ||
    Number.isFinite(member.snapshot.learnedAbilities["/abilities/invincible"])
  );
}

function preferredSpecialHrid(member, definition) {
  if (definition?.insanityMemberIds?.has(member.memberId)) {
    return "/abilities/insanity";
  }
  return "/abilities/revive";
}

function parseInsanityTopDpsCounts(raw) {
  const counts = {};
  for (const part of String(raw ?? "").split(/[,，\s]+/u)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [key, value] = trimmed.split(":");
    const count = Number(value);
    if (key && Number.isFinite(count) && count > 0) {
      counts[key] = count;
    }
  }
  return counts;
}

function formatInsanityCounts(counts) {
  const parts = Object.entries(counts).map(
    ([key, count]) => `${key}=${count}`,
  );
  return parts.length ? `（${parts.join("，")}）` : "";
}

function ordinaryAbilityHrids(member, definition) {
  return ordinaryAbilityHridsForTemplate(member, definition);
}

function selectLearnedOrdinary(snapshot, preferred, limit) {
  const result = [];
  const seen = new Set();
  const learned = snapshot.learnedAbilities;
  for (const hrid of preferred) {
    if (seen.has(hrid) || abilityDetail(hrid)?.isSpecialAbility) continue;
    if (!Number.isFinite(learned[hrid])) {
      const fallback = defaultLevelForMissingAbility(hrid);
      if (fallback == null) continue;
      learned[hrid] = fallback;
    }
    result.push(hrid);
    seen.add(hrid);
    if (result.length === limit) return result;
  }
  for (const hrid of Object.keys(learned).sort()) {
    if (!seen.has(hrid) && !abilityDetail(hrid)?.isSpecialAbility) {
      result.push(hrid);
      seen.add(hrid);
      if (result.length === limit) return result;
    }
  }
  return result;
}

function enforceZeroCooldownLast(abilityHrids) {
  const zeroCooldown = new Set([
    "/abilities/entangle",
    "/abilities/water_strike",
    "/abilities/fireball",
  ]);
  const head = abilityHrids.filter((hrid) => !zeroCooldown.has(hrid));
  const tail = abilityHrids.filter((hrid) => zeroCooldown.has(hrid));
  return [...head, ...tail];
}

function summarizeTeam(team) {
  const roles = {};
  const duties = {};
  for (const member of team) {
    roles[member.combatType] = (roles[member.combatType] ?? 0) + 1;
    duties[member.role] = (duties[member.role] ?? 0) + 1;
  }
  return { size: team.length, roles, duties };
}

function compactRun(run) {
  return {
    seed: run.seed,
    wavesCleared: run.wavesCleared,
    finalProgressPercent: progressPercent(run),
    teamDps: run.teamDps,
    totalDeaths: run.totalDeaths,
    oomMembers: run.oomMembers,
  };
}

function score(run) {
  const progress =
    run.finalMonsterMaxHp > 0
      ? 1 - run.finalMonsterHp / run.finalMonsterMaxHp
      : Number(run.finalProgressPercent ?? 0) / 100;
  // Depth first, then heavy death penalty, then leftover progress.
  return (
    Number(run.wavesCleared ?? 0) * 1_000_000 -
    Number(run.totalDeaths ?? 0) * 1_000 +
    progress
  );
}

function progressPercent(run) {
  return Number(
    (
      100 *
      (1 -
        (run.finalMonsterMaxHp > 0
          ? run.finalMonsterHp / run.finalMonsterMaxHp
          : 0))
    ).toFixed(2),
  );
}

function compareCandidates(left, right) {
  return (
    right.score - left.score ||
    Number(left.run?.totalDeaths ?? 0) - Number(right.run?.totalDeaths ?? 0) ||
    (right.run?.teamDps ?? 0) - (left.run?.teamDps ?? 0) ||
    left.definition.id.localeCompare(right.definition.id)
  );
}

function sumMap(map) {
  return [...map.values()].reduce((sum, rows) => sum + rows.length, 0);
}

function countRoles(map) {
  return Object.fromEntries(
    roleOrder.map((role) => [role, map.get(role)?.length ?? 0]),
  );
}

function formatCounts(map) {
  return roleOrder
    .filter((role) => (map[role] ?? 0) > 0)
    .map((role) => `${role}${map[role]}`)
    .join(" ");
}

function dutyName(duty) {
  return (
    {
      tank: "坦",
      healer: "奶",
      debuffer: "减",
      dps: "输出",
    }[duty] ?? duty
  );
}

function buildSummary(winner, availableCount, unavailableRows) {
  const lines = [
    "TMD 可用人员重排组合搜索（不按报名，开发实验不可转正）",
    `可用 ${availableCount} 人；不可用 ${unavailableRows.length} 人；` +
      `最优分区：${winner.partitionId}`,
    `规则：${pairStrategy.ruleNote}；两边各留至少2个必要覆盖（烟爆/法力喷泉/冰霜爆裂/粉尘/疫病/破甲/碎裂/致残/血刃）；变色龙单体、虫群AOE；自然全治疗；非光环默认复活、前x输出改疯狂${formatInsanityCounts(insanityTopDpsCounts)}；攻击≥${GUILD_TRIAL_MIN_ATTACK_LEVEL}；双 Boss 人员互斥；无复制人。`,
  ];
  for (const boss of winner.bosses) {
    const layers = boss.runs.map((run) => run.wavesCleared);
    const dps =
      boss.runs.reduce((sum, run) => sum + run.teamDps, 0) / boss.runs.length;
    const progress =
      boss.runs.reduce((sum, run) => sum + run.finalProgressPercent, 0) /
      boss.runs.length;
    const deaths = boss.runs.map((run) => run.totalDeaths);
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
          : ""),
      `技能包：${boss.selectedCandidate}`,
      `职业：${formatCounts(boss.team.roles)}`,
      `职责：坦克${boss.team.duties.tank ?? 0} 奶${boss.team.duties.healer ?? 0} ` +
        `减${boss.team.duties.debuffer ?? 0} 输出${boss.team.duties.dps ?? 0}`,
      `名单：${boss.roster.map((row) => `${row.memberId}(${row.combatType})`).join("、")}`,
    );
  }
  if (unavailableRows.length) {
    lines.push(
      `全库不可用：${unavailableRows
        .map((row) => `${row.memberId}/${row.combatType}(${row.reason})`)
        .join("、")}`,
    );
  }
  return lines.join("\n");
}

function slimSnapshot(snapshot) {
  return {
    skills: snapshot.skills,
    learnedAbilities: snapshot.learnedAbilities,
  };
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
        passiveManaRegen: 0,
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
      row.passiveManaRegen += Number(member.passiveManaRegen ?? 0);
      row.oomDurationSeconds += Number(member.oomDurationSeconds ?? 0);
      row.maxMp = member.maxMp;
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

function buffValue(buff, level) {
  return {
    flat:
      Number(buff.flatBoost ?? 0) +
      Number(buff.flatBoostLevelBonus ?? 0) * level,
    ratio:
      Number(buff.ratioBoost ?? 0) +
      Number(buff.ratioBoostLevelBonus ?? 0) * level,
  };
}

function buildSupportContributions(team, memberAverages, runs) {
  const averageTeamDps =
    runs.reduce((sum, run) => sum + Number(run.teamDps ?? 0), 0) / runs.length;
  const totalHealingDone = memberAverages.reduce(
    (sum, row) => sum + row.averageHealingDone,
    0,
  );
  const byId = new Map(memberAverages.map((row) => [row.memberId, row]));
  const auraRows = [];
  const healerRows = [];
  const debuffRows = [];
  const specialRows = [];

  for (const member of team) {
    const stats = byId.get(member.sourceMemberId) ?? byId.get(member.memberId);
    const auraHrid = member.auraHrid;
    if (auraHrid) {
      const level =
        member.abilities.find((ability) => ability.abilityHrid === auraHrid)
          ?.level ?? 1;
      const detail = abilityDetail(auraHrid);
      const effects = [];
      let estimatedTeamDpsGain = 0;
      let survivalNotes = [];
      for (const effect of detail?.abilityEffects ?? []) {
        for (const buff of effect.buffs ?? []) {
          const value = buffValue(buff, level);
          const type = String(buff.typeHrid ?? "").split("/").at(-1);
          effects.push({
            typeHrid: buff.typeHrid,
            typeZh: type,
            flatPercent: Number((value.flat * 100).toFixed(2)),
            ratioPercent: Number((value.ratio * 100).toFixed(2)),
          });
          if (
            [
              "physical_amplify",
              "water_amplify",
              "nature_amplify",
              "fire_amplify",
              "damage",
              "critical_rate",
              "critical_damage",
              "attack_speed",
              "cast_speed",
            ].includes(type)
          ) {
            // Nominal: convert primary ratio/flat amp into team DPS share.
            const uplift = value.ratio > 0 ? value.ratio : value.flat;
            estimatedTeamDpsGain += averageTeamDps * (uplift / (1 + uplift));
          }
          if (
            ["armor", "evasion", "healing_amplify", "water_resistance", "nature_resistance", "fire_resistance"].includes(
              type,
            )
          ) {
            survivalNotes.push(
              `${type}+${
                value.ratio > 0
                  ? `${(value.ratio * 100).toFixed(1)}%`
                  : value.flat.toFixed(1)
              }`,
            );
          }
        }
      }
      auraRows.push({
        memberId: member.sourceMemberId,
        combatType: member.combatType,
        auraHrid,
        auraNameZh: officialAbilityNameZh(auraHrid) ?? auraHrid,
        level,
        effects,
        estimatedTeamDpsGain: Number(estimatedTeamDpsGain.toFixed(1)),
        estimatedTeamDpsGainPercent: Number(
          ((estimatedTeamDpsGain / Math.max(averageTeamDps, 1)) * 100).toFixed(
            2,
          ),
        ),
        survivalNotes,
        note: "光环按常驻覆盖估算对团队 DPS/生存的名义贡献，非消融实验精确值",
      });
    }

    if (member.role === "healer" || (stats?.averageHealingDone ?? 0) > 0) {
      const healDone = stats?.averageHealingDone ?? 0;
      if (healDone > 0 || member.role === "healer") {
        healerRows.push({
          memberId: member.sourceMemberId,
          combatType: member.combatType,
          averageHealingDone: healDone,
          averageHps: Number((healDone / 3600).toFixed(2)),
          teamHealingSharePercent: Number(
            ((healDone / Math.max(totalHealingDone, 1)) * 100).toFixed(1),
          ),
          averageDamageTaken: stats?.averageDamageTaken ?? 0,
          deaths: stats?.deaths ?? 0,
          note: "治疗量为技能/复活实际抬血（不含被动回血与吸血）",
        });
      }
    }

    if (member.role === "debuffer" || member.role === "tank") {
      const supportAbilityDamage = (stats?.topAbilities ?? [])
        .filter((ability) =>
          [
            "/abilities/entangle",
            "/abilities/smoke_burst",
            "/abilities/flame_blast",
            "/abilities/fireball",
            "/abilities/water_strike",
            "/abilities/taunt",
            "/abilities/provoke",
            "/abilities/invincible",
          ].includes(ability.abilityHrid) ||
          String(ability.nameZh).includes("缠") ||
          String(ability.nameZh).includes("烟") ||
          String(ability.nameZh).includes("挑衅") ||
          String(ability.nameZh).includes("嘲讽"),
        )
        .map((ability) => ({
          ...ability,
          shareOfMemberDpsPercent: Number(
            (
              (ability.averageDps / Math.max(stats?.averageDps ?? 1, 0.01)) *
              100
            ).toFixed(1),
          ),
        }));
      debuffRows.push({
        memberId: member.sourceMemberId,
        combatType: member.combatType,
        duty: member.role,
        averageDps: stats?.averageDps ?? 0,
        averageDamageTaken: stats?.averageDamageTaken ?? 0,
        deaths: stats?.deaths ?? 0,
        supportAbilityDamage,
        note:
          member.role === "tank"
            ? "坦克承伤与无敌/嘲讽相关技能输出"
            : "减益位技能直接伤害（减益对全队增伤需看覆盖，此处列技能伤害贡献）",
      });
    }

    const specialHrid = member.abilities[0]?.abilityHrid;
    if (
      specialHrid &&
      ["/abilities/revive", "/abilities/insanity", "/abilities/invincible"].includes(
        specialHrid,
      )
    ) {
      specialRows.push({
        memberId: member.sourceMemberId,
        combatType: member.combatType,
        specialHrid,
        specialNameZh: officialAbilityNameZh(specialHrid) ?? specialHrid,
        level: member.abilities[0]?.level ?? null,
        averageHealingDone: stats?.averageHealingDone ?? 0,
        averageDps: stats?.averageDps ?? 0,
        deaths: stats?.deaths ?? 0,
      });
    }
  }

  return {
    averageTeamDps: Number(averageTeamDps.toFixed(1)),
    totalAverageHealingDone: Number(totalHealingDone.toFixed(1)),
    auras: auraRows,
    healers: healerRows.sort(
      (left, right) => right.averageHealingDone - left.averageHealingDone,
    ),
    supporters: debuffRows,
    specials: specialRows,
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
    build: {
      equipment: member.build.equipment,
    },
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
