import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  abilityDetail,
  buildPlayerMember,
  defaultAbility,
  equipmentDetail,
  runGuildTrial,
} from "../packages/shykai-full-runtime/src/guild-trial-runner.mjs";
import {
  officialAbilityNameZh,
} from "../packages/mwi-data/official-zh-ability-names.mjs";
import {
  selectCombatBuild,
} from "../packages/optimizer/src/combat-build-selection.mjs";
import {
  assessCombatMemberReadiness,
  prepareSnapshotForCombat,
} from "../packages/optimizer/src/combat-member-readiness.mjs";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const databasePath =
  process.env.MWI_GUILD_API_DB_PATH ??
  "/Users/xhy/.local/share/mwi-guild-server/.local/qq-test.sqlite";
const guildId = process.env.MWI_GUILD_ID ?? "TMD";
const fixturePath = path.join(
  projectDirectory,
  "fixtures/monsters/guild-trial-2026-07-24-jellyfish-hedgehog.json",
);
const outputPath = path.join(
  projectDirectory,
  ".local/tmd-bound-roster-full-engine-lab.json",
);
const screeningDurationSeconds = Number(
  process.env.MWI_GUILD_SCREEN_DURATION_SECONDS ?? 900,
);
const finalDurationSeconds = Number(
  process.env.MWI_GUILD_FINAL_DURATION_SECONDS ?? 3600,
);
const persistAssignment =
  process.env.MWI_GUILD_PERSIST_ASSIGNMENT !== "0";
const controlledOutputExperiment =
  process.env.MWI_CONTROLLED_OUTPUT_EXPERIMENT === "1";
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
const trackedDebuffs = [
  "/abilities/puncture",
  "/abilities/pestilent_shot",
  "/abilities/fracturing_impact",
  "/abilities/maim",
  "/abilities/crippling_slash",
  "/abilities/toxic_pollen",
  "/abilities/frost_surge",
  "/abilities/smoke_burst",
];

const db = new DatabaseSync(databasePath);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const bindings = readBindings(db, guildId);
if (!bindings.length) throw new Error(`No bindings found for guild ${guildId}`);

const usableByRole = new Map(roleOrder.map((role) => [role, []]));
const unavailable = [];
for (const binding of bindings) {
  if (!binding.snapshot) {
    unavailable.push({
      memberId: binding.memberId,
      combatType: binding.combatType,
      reason: "尚未上传成员快照",
    });
    continue;
  }
  const readiness = assessCombatMemberReadiness(
    binding.snapshot,
    binding.combatType,
  );
  if (!readiness.ok) {
    unavailable.push({
      memberId: binding.memberId,
      combatType: binding.combatType,
      reason: readiness.reason,
    });
    continue;
  }
  const preparedSnapshot = prepareSnapshotForCombat(
    binding.snapshot,
    binding.combatType,
  );
  const buildSelection = selectCombatBuild(
    preparedSnapshot,
    binding.combatType,
  );
  usableByRole.get(binding.combatType)?.push({
    ...binding,
    snapshot: preparedSnapshot,
    build: buildSelection.build,
    buildSelectionSource: buildSelection.source,
    defaultedAbilityHrids: readiness.defaultedAbilityHrids ?? [],
  });
}

for (const rows of usableByRole.values()) {
  rows.sort((left, right) => left.memberId.localeCompare(right.memberId));
}
const adudu = bindings.find((binding) => binding.memberId === "adudu");
const shieldBuild = adudu?.snapshot
  ? selectCombatBuild(adudu.snapshot, "盾").build
  : null;
if (!adudu?.snapshot || !shieldBuild) {
  throw new Error("adudu 的迷宫盾配装不可用，无法按要求补临时坦克");
}
const shieldSource = {
  ...adudu,
  combatType: "盾",
  build: shieldBuild,
  proxyReason: "Q17 已绑定盾但未上传快照，按用户要求临时使用 adudu 迷宫盾",
};
const bossSourcePools = createDisjointBossSourcePools(
  usableByRole,
  shieldSource,
);

const boundDistribution = count(bindings, (binding) => binding.combatType);
const proportionalTargets = proportionalRoleTargets(boundDistribution, 40);
for (const role of roleOrder) {
  if (
    role !== "盾" &&
    (proportionalTargets[role] ?? 0) > 0 &&
    !usableByRole.get(role)?.length
  ) {
    throw new Error(`No usable bound source for required role ${role}`);
  }
}
const candidateDefinitions = [
  {
    id: "one-shield-balanced",
    shieldCount: 1,
    crossbowSupportCount: 1,
    bowFourth: "frenzy",
    natureOptional: "quick_aid",
    waterUtility: "frost_surge",
    shieldControl: "provoke",
    shieldPackage: "survival",
  },
  {
    id: "two-shield-balanced",
    shieldCount: 2,
    crossbowSupportCount: 1,
    bowFourth: "frenzy",
    natureOptional: "quick_aid",
    waterUtility: "frost_surge",
    shieldControl: "provoke",
    shieldPackage: "survival",
  },
  {
    id: "two-shield-bow-steady",
    shieldCount: 2,
    crossbowSupportCount: 1,
    bowFourth: "steady_shot",
    natureOptional: "quick_aid",
    waterUtility: "frost_surge",
    shieldControl: "provoke",
    shieldPackage: "survival",
  },
  {
    id: "two-shield-two-pestilent",
    shieldCount: 2,
    crossbowSupportCount: 2,
    bowFourth: "frenzy",
    natureOptional: "quick_aid",
    waterUtility: "frost_surge",
    shieldControl: "provoke",
    shieldPackage: "survival",
  },
  {
    id: "two-shield-nature-veil",
    shieldCount: 2,
    crossbowSupportCount: 1,
    bowFourth: "frenzy",
    natureOptional: "natures_veil",
    waterUtility: "frost_surge",
    shieldControl: "provoke",
    shieldPackage: "survival",
  },
  {
    id: "two-shield-nature-elemental",
    shieldCount: 2,
    crossbowSupportCount: 1,
    bowFourth: "frenzy",
    natureOptional: "elemental_affinity",
    waterUtility: "frost_surge",
    shieldControl: "provoke",
    shieldPackage: "survival",
  },
  {
    id: "two-shield-mana-spring",
    shieldCount: 2,
    crossbowSupportCount: 1,
    bowFourth: "frenzy",
    natureOptional: "quick_aid",
    waterUtility: "mana_spring",
    shieldControl: "provoke",
    shieldPackage: "survival",
  },
  {
    id: "two-shield-damage",
    shieldCount: 2,
    crossbowSupportCount: 1,
    bowFourth: "frenzy",
    natureOptional: "elemental_affinity",
    waterUtility: "frost_surge",
    shieldControl: "provoke",
    shieldPackage: "precision",
  },
  {
    id: "two-shield-survival",
    shieldCount: 2,
    crossbowSupportCount: 2,
    bowFourth: "steady_shot",
    natureOptional: "natures_veil",
    waterUtility: "mana_spring",
    shieldControl: "taunt",
    shieldPackage: "survival",
  },
];

process.stdout.write(
  `TMD 绑定 ${bindings.length} 人；可直接模拟 ${sumMap(usableByRole)} 人；` +
    `需由同职业复制人补位 ${unavailable.length} 人。\n`,
);
process.stdout.write(
  `绑定职业：${formatCounts(boundDistribution)}；40 人比例目标：` +
    `${formatCounts(proportionalTargets)}。\n`,
);

if (controlledOutputExperiment) {
  await runControlledOutputRoleExperiment();
  db.close();
  process.exit(0);
}

const bossResults = [];
for (const [bossIndex, boss] of fixture.bosses.entries()) {
  process.stdout.write(`\n【${boss.nameZh}】筛选 ${candidateDefinitions.length} 套方案...\n`);
  const screened = [];
  const targetCandidates = roleTargetCandidates(bossIndex);
  for (const [definitionIndex, baseDefinition] of candidateDefinitions.entries()) {
    const definition = {
      ...baseDefinition,
      roleTargets: targetCandidates[definitionIndex],
    };
    const team = createTeam(
      definition,
      definition.roleTargets,
      bossSourcePools[bossIndex],
    );
    const run = await runGuildTrial({
      snapshot: team[0].snapshot,
      boss,
      members: team,
      seed: seeds[0],
      durationSeconds: screeningDurationSeconds,
    });
    const row = {
      definition,
      team,
      score: score(run),
      run: compactRun(run),
    };
    screened.push(row);
    process.stdout.write(
      `  ${definition.id}: 层=${row.run.wavesCleared}，` +
        `末层=${row.run.finalProgressPercent}%，DPS=${Math.round(row.run.teamDps)}\n`,
    );
  }
  screened.sort(compareCandidates);

  const finalists = [];
  for (const candidate of screened.slice(0, 3)) {
    const run = await runGuildTrial({
      snapshot: candidate.team[0].snapshot,
      boss,
      members: candidate.team,
      seed: seeds[0],
      durationSeconds: finalDurationSeconds,
    });
    finalists.push({ ...candidate, score: score(run), fullRun: run });
    process.stdout.write(
      `  完整候选 ${candidate.definition.id}: 层=${run.wavesCleared}，` +
        `末层=${progressPercent(run)}%，DPS=${Math.round(run.teamDps)}\n`,
    );
  }
  finalists.sort(
    (left, right) =>
      right.score - left.score ||
      right.fullRun.teamDps - left.fullRun.teamDps ||
      left.definition.id.localeCompare(right.definition.id),
  );
  const selected = finalists[0];
  const fullRuns = [selected.fullRun];
  for (const seed of seeds.slice(1)) {
    const run = await runGuildTrial({
      snapshot: selected.team[0].snapshot,
      boss,
      members: selected.team,
      seed,
      durationSeconds: finalDurationSeconds,
    });
    fullRuns.push(run);
    process.stdout.write(
      `  Seed ${seed}: 层=${run.wavesCleared}，末层=${progressPercent(run)}%，` +
        `DPS=${Math.round(run.teamDps)}，死亡=${run.totalDeaths}，曾缺蓝=${run.oomMembers}\n`,
    );
  }

  bossResults.push({
    bossId: boss.hrid,
    bossName: boss.nameZh,
    selectedCandidate: selected.definition.id,
    team: summarizeTeam(selected.team),
    debuffPlan: summarizeDebuffPlan(selected.team),
    runs: fullRuns.map(compactRun),
    memberAverages: averageMembers(fullRuns),
    searchCandidates: screened.map((candidate) => ({
      name: candidate.definition.id,
      run: candidate.run,
    })),
  });
}

const assignment = {
  schemaVersion: 2,
  kind: "tmd-bound-roster-40-full-engine-lab",
  developmentOnly: true,
  promotable: false,
  guildId,
  generatedAt: new Date().toISOString(),
  engine: "shykai-full-event-runtime",
  rules: {
    durationSeconds: 3600,
    startLevel: 100,
    levelStep: 10,
    maxLevel: 300,
    participantCount: 40,
    bossHpMultiplier: 1.4,
    consumables: "disabled",
    passiveHpMpRegenFlatBonus: 0.03,
    refillHpMpOnLevelTransition: true,
    maxParryAttemptsPerIncomingAttack: 5,
    seeds,
  },
    source: {
    bindingCount: bindings.length,
    usableSnapshotCount: sumMap(usableByRole),
    boundDistribution,
    proportionalTargets,
    disjointBossSourcePools: bossSourcePools.map((pool, bossIndex) => ({
      bossId: fixture.bosses[bossIndex].hrid,
      members: Object.fromEntries(
        roleOrder.map((role) => [
          role,
          (pool.get(role) ?? []).map((row) => row.memberId),
        ]),
      ),
    })),
    unavailable,
    temporaryShield:
    "当前有效盾成员分配给水母；刺猬使用 adudu 的盾配装作为职业模板占位。两边的真实来源角色互不重复。",
  },
  assumptions: [
    "每个真实来源角色只分配给水母或刺猬其中一边；不足 80 个报名位的部分由该边已分配成员循环复制为职业模板占位。",
    "水母优先比较远程/自然阵容，刺猬优先比较火系阵容；剑、枪、锤保留必要的增伤与减益覆盖。",
    "五种光环各由一名具备该技能的最高等级可选复制人携带。",
    "其余输出优先疯狂，治疗/减益优先复活；盾特殊槽固定守护光环（不带无敌）；精确属于普通技能槽。",
    "法师零冷却技能缠绕、流水冲击、火球固定放在第 5 格，避免阻塞前面的冷却技能。",
    "完整事件引擎已计入装备与武器被动、技能、触发器、Buff/Debuff、治疗、仇恨、死亡、CD、MP。",
    "换层时 HP/MP 按已确认规则补满；冷却、Buff、Debuff、护盾和施法状态暂由上游事件引擎保留。",
    "Lv.110+ 属性成长、公会神殿与死亡细节仍需正式服实测校准。",
  ],
  bosses: bossResults,
};
assignment.summaryText = formatSummary(assignment);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(assignment, null, 2)}\n`, "utf8");
if (persistAssignment) {
  const createdAt = new Date().toISOString();
  const inserted = db
    .prepare(
      "INSERT INTO assignments (guild_id, kind, locked, created_at, payload_json) VALUES (?, 'test', 0, ?, ?)",
    )
    .run(guildId, createdAt, JSON.stringify(assignment));
  process.stdout.write(
    `\n已保存测试方案 #${inserted.lastInsertRowid}：${outputPath}\n${assignment.summaryText}\n`,
  );
} else {
  process.stdout.write(
    `\n已生成未入库测试方案：${outputPath}\n${assignment.summaryText}\n`,
  );
}

function readBindings(database, selectedGuildId) {
  const rows = database
    .prepare(
      `SELECT q.member_id, q.combat_type, q.qq_number,
              s.payload_json, s.received_at
       FROM qq_bindings q
       LEFT JOIN snapshots s ON s.id = (
         SELECT id FROM snapshots
         WHERE guild_id = q.guild_id AND member_id = q.member_id
         ORDER BY id DESC LIMIT 1
       )
       WHERE q.guild_id = ?
       ORDER BY q.member_id`,
    )
    .all(selectedGuildId);
  return rows.map((row) => ({
    memberId: row.member_id,
    combatType: row.combat_type,
    qqNumber: row.qq_number,
    receivedAt: row.received_at,
    snapshot: row.payload_json ? JSON.parse(row.payload_json) : null,
  }));
}

function proportionalRoleTargets(distribution, total) {
  const entries = roleOrder
    .map((role, index) => {
      const countValue = distribution[role] ?? 0;
      const exact = (countValue * total) / bindings.length;
      return {
        role,
        index,
        exact,
        value: Math.floor(exact),
        remainder: exact - Math.floor(exact),
      };
    })
    .filter((entry) => entry.exact > 0);
  let remaining =
    total - entries.reduce((sum, entry) => sum + entry.value, 0);
  entries
    .sort(
      (left, right) =>
        right.remainder - left.remainder || left.index - right.index,
    )
    .forEach((entry) => {
      if (remaining > 0) {
        entry.value += 1;
        remaining -= 1;
      }
    });
  return Object.fromEntries(
    roleOrder.map((role) => [
      role,
      entries.find((entry) => entry.role === role)?.value ?? 0,
    ]),
  );
}

function createTeam(definition, selectedTargets, selectedSources) {
  const targets = { ...selectedTargets };
  const targetTotal = Object.values(targets).reduce(
    (total, value) => total + value,
    0,
  );
  if (targetTotal !== 40) {
    throw new Error(
      `${definition.id} role targets must total 40, received ${targetTotal}`,
    );
  }
  const raw = [];
  for (const role of roleOrder) {
    if (role === "盾") {
      const shieldSources = selectedSources.get(role) ?? [];
      if (!shieldSources.length && targets.盾 > 0) {
        throw new Error(`No shield source assigned for ${definition.id}`);
      }
      for (let index = 0; index < targets.盾; index += 1) {
        raw.push(
          rawMember(
            shieldSources[index % shieldSources.length],
            role,
            index,
            targets.盾,
          ),
        );
      }
      continue;
    }
    const sources = [...(selectedSources.get(role) ?? [])];
    if (role === "弩") {
      sources.sort(
        (left, right) =>
          Number(
            Number.isFinite(
              right.snapshot.learnedAbilities["/abilities/pestilent_shot"],
            ),
          ) -
            Number(
              Number.isFinite(
                left.snapshot.learnedAbilities["/abilities/pestilent_shot"],
              ),
            ) ||
          left.memberId.localeCompare(right.memberId),
      );
    }
    const fixedCount = Math.min(
      targets[role] ?? 0,
      definition.fixedSupportTargets?.[role] ?? targets[role] ?? 0,
    );
    const variableCount = (targets[role] ?? 0) - fixedCount;
    const expandedSources = definition.fixedSupportTargets
      ? [
          ...expandSources(sources, fixedCount),
          ...expandSources(sources.filter(hasReusableSpecial), variableCount),
        ]
      : expandSources(sources, targets[role] ?? 0);
    const cloneCounts = new Map();
    for (let index = 0; index < expandedSources.length; index += 1) {
      const source = expandedSources[index];
      const cloneIndex = (cloneCounts.get(source.memberId) ?? 0) + 1;
      cloneCounts.set(source.memberId, cloneIndex);
      const row = rawMember(
          source,
          role,
          index,
          targets[role],
          cloneIndex,
        );
      row.isVariableOutputSlot =
        Boolean(definition.fixedSupportTargets) && index >= fixedCount;
      raw.push(row);
    }
  }
  if (raw.length !== 40) {
    throw new Error(`Team construction produced ${raw.length} members`);
  }
  if (definition.enhancementProfile) {
    for (const row of raw) {
      row.build = normalizeBuildEnhancements(
        row.build,
        definition.enhancementProfile,
      );
    }
  }
  assignDuties(raw, definition);
  assignAuras(raw, {
    fixedOnly: Boolean(definition.fixedSupportTargets),
  });
  return raw.map((row, index) => {
    const ordinary = ordinaryAbilityHrids(row, definition);
    const special = row.auraHrid ?? preferredSpecialHrid(row);
    const selectedOrdinary = enforceZeroCooldownLast(
      selectLearnedOrdinary(row.snapshot, ordinary, 4),
    );
    const selected = [special, ...selectedOrdinary];
    if (selected.length !== 5) {
      throw new Error(
        `${row.sourceMemberId}/${row.combatType} only produced ${selected.length} abilities`,
      );
    }
    assertAbilityOrder(row, selected);
    return buildPlayerMember({
      build: row.build,
      label:
        `${row.sourceMemberId}${row.cloneIndex > 1 ? `#${row.cloneIndex}` : ""}` +
        `·${row.combatType}·${dutyName(row.duty)}`,
      role: row.duty,
      memberId:
        `${roleSlug[row.combatType]}_${String(index + 1).padStart(2, "0")}`,
      snapshot: row.snapshot,
      abilities: selected.map((abilityHrid) =>
        normalizeAbilityLevel(
          defaultAbility(abilityHrid, row.snapshot.learnedAbilities),
          definition.abilityLevel,
        ),
      ),
      combatType: row.combatType,
      sourceMemberId: row.sourceMemberId,
    });
  }).map((member, index) => {
    const row = raw[index];
    member.combatType = row.combatType;
    member.sourceMemberId = row.sourceMemberId;
    member.buildSelectionSource = row.buildSelectionSource;
    member.cloneIndex = row.cloneIndex;
    member.auraHrid = row.auraHrid ?? null;
    return member;
  });
}

function createDisjointBossSourcePools(allSourcesByRole, fallbackShieldSource) {
  const jellyfish = new Map(roleOrder.map((role) => [role, []]));
  const hedgehog = new Map(roleOrder.map((role) => [role, []]));
  for (const role of roleOrder) {
    const sources = [...(allSourcesByRole.get(role) ?? [])].filter(
      (source) => source.memberId !== fallbackShieldSource.memberId,
    );
    if (role === "弓") {
      jellyfish.set(role, sources);
      continue;
    }
    if (role === "火") {
      hedgehog.set(role, sources);
      continue;
    }
    if (role === "盾") {
      jellyfish.set(role, sources);
      hedgehog.set(role, [fallbackShieldSource]);
      continue;
    }
    const splitAt = Math.ceil(sources.length / 2);
    jellyfish.set(role, sources.slice(0, splitAt));
    hedgehog.set(role, sources.slice(splitAt));
  }

  const jellyfishIds = new Set(
    [...jellyfish.values()].flat().map((source) => source.memberId),
  );
  const duplicated = [...hedgehog.values()]
    .flat()
    .map((source) => source.memberId)
    .filter((memberId) => jellyfishIds.has(memberId));
  if (duplicated.length > 0) {
    throw new Error(
      `Boss source pools are not disjoint: ${[...new Set(duplicated)].join(", ")}`,
    );
  }
  return [jellyfish, hedgehog];
}

function roleTargetCandidates(bossIndex) {
  const jellyfish = [
    { 弓: 3, 弩: 11, 火: 0, 水: 2, 自: 14, 盾: 1, 枪: 4, 剑: 1, 锤: 4 },
    { 弓: 2, 弩: 8, 火: 0, 水: 2, 自: 18, 盾: 2, 枪: 3, 剑: 1, 锤: 4 },
    { 弓: 5, 弩: 15, 火: 0, 水: 2, 自: 8, 盾: 2, 枪: 4, 剑: 1, 锤: 3 },
    { 弓: 3, 弩: 10, 火: 0, 水: 4, 自: 12, 盾: 2, 枪: 4, 剑: 2, 锤: 3 },
    { 弓: 4, 弩: 12, 火: 0, 水: 2, 自: 10, 盾: 2, 枪: 4, 剑: 2, 锤: 4 },
    { 弓: 2, 弩: 12, 火: 0, 水: 2, 自: 14, 盾: 2, 枪: 4, 剑: 1, 锤: 3 },
    { 弓: 4, 弩: 10, 火: 0, 水: 2, 自: 14, 盾: 2, 枪: 3, 剑: 1, 锤: 4 },
    { 弓: 3, 弩: 14, 火: 0, 水: 2, 自: 10, 盾: 2, 枪: 4, 剑: 1, 锤: 4 },
    { 弓: 2, 弩: 9, 火: 0, 水: 3, 自: 16, 盾: 2, 枪: 4, 剑: 1, 锤: 3 },
  ];
  const hedgehog = [
    { 弓: 0, 弩: 3, 火: 19, 水: 2, 自: 8, 盾: 1, 枪: 3, 剑: 1, 锤: 3 },
    { 弓: 0, 弩: 3, 火: 14, 水: 3, 自: 12, 盾: 2, 枪: 3, 剑: 1, 锤: 2 },
    { 弓: 0, 弩: 7, 火: 14, 水: 2, 自: 8, 盾: 2, 枪: 3, 剑: 1, 锤: 3 },
    { 弓: 0, 弩: 2, 火: 22, 水: 2, 自: 6, 盾: 2, 枪: 3, 剑: 1, 锤: 2 },
    { 弓: 0, 弩: 4, 火: 16, 水: 4, 自: 8, 盾: 2, 枪: 3, 剑: 1, 锤: 2 },
    { 弓: 0, 弩: 3, 火: 18, 水: 2, 自: 10, 盾: 2, 枪: 3, 剑: 1, 锤: 1 },
    { 弓: 0, 弩: 5, 火: 16, 水: 2, 自: 8, 盾: 2, 枪: 3, 剑: 2, 锤: 2 },
    { 弓: 0, 弩: 2, 火: 20, 水: 3, 自: 8, 盾: 2, 枪: 3, 剑: 1, 锤: 1 },
    { 弓: 0, 弩: 4, 火: 12, 水: 4, 自: 12, 盾: 2, 枪: 3, 剑: 1, 锤: 2 },
  ];
  const candidates = bossIndex === 0 ? jellyfish : hedgehog;
  for (const targets of candidates) {
    const total = Object.values(targets).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (total !== 40) {
      throw new Error(`Boss ${bossIndex} role targets total ${total}`);
    }
  }
  return candidates;
}

async function runControlledOutputRoleExperiment() {
  const experimentOutputPath =
    process.env.MWI_CONTROLLED_OUTPUT_PATH ??
    path.join(
      projectDirectory,
      ".local/controlled-output-role-experiment.json",
    );
  const durationSeconds = Number(
    process.env.MWI_CONTROLLED_DURATION_SECONDS ?? 3600,
  );
  const outputRoles = (
    process.env.MWI_CONTROLLED_OUTPUT_ROLES ??
    "弓,弩,火,水,自,枪,剑,锤"
  ).split(",").map((role) => role.trim()).filter(Boolean);
  const fixedSupportTargets = {
    弓: 0,
    弩: 2,
    火: 1,
    水: 2,
    自: 6,
    盾: 2,
    枪: 3,
    剑: 1,
    锤: 2,
  };
  const fixedSupportCount = Object.values(fixedSupportTargets).reduce(
    (sum, value) => sum + value,
    0,
  );
  const variableOutputSlots = 40 - fixedSupportCount;
  const experimentSources = new Map(
    roleOrder.map((role) => [
      role,
      role === "盾"
        ? (usableByRole.get(role)?.length
            ? [...usableByRole.get(role)]
            : [shieldSource])
        : [...(usableByRole.get(role) ?? [])],
    ]),
  );
  const definition = {
    ...candidateDefinitions.find((row) => row.id === "two-shield-balanced"),
    id: "controlled-output-role",
    crossbowSupportCount: 2,
    bowFourth: "frenzy",
    natureOptional: "quick_aid",
    waterUtility: "frost_surge",
    shieldControl: "provoke",
    shieldPackage: "survival",
  };
  const bosses = [];
  for (const boss of fixture.bosses) {
    process.stdout.write(
      `\n【${boss.nameZh}】控制变量：固定辅助 ${fixedSupportCount} 人，` +
        `替换输出位 ${variableOutputSlots} 人。\n`,
    );
    const rows = [];
    for (const outputRole of outputRoles) {
      const roleTargets = { ...fixedSupportTargets };
      roleTargets[outputRole] += variableOutputSlots;
      const outputDefinition = {
        ...definition,
        fixedSupportTargets,
        enhancementProfile: {
          weapon: 12,
          armor: 10,
          accessory: 5,
        },
        abilityLevel: 80,
        natureOptional:
          outputRole === "自" ? "elemental_affinity" : "quick_aid",
      };
      const team = createTeam(
        { ...outputDefinition, roleTargets },
        roleTargets,
        experimentSources,
      );
      assertNormalizedEnhancements(
        team,
        outputDefinition.enhancementProfile,
      );
      assertNormalizedAbilityLevels(team, outputDefinition.abilityLevel);
      const runs = [];
      for (const seed of seeds) {
        runs.push(
          await runGuildTrial({
            snapshot: team[0].snapshot,
            boss,
            members: team,
            seed,
            durationSeconds,
          }),
        );
      }
      const row = {
        outputRole,
        variableOutputSlots,
        roleTargets,
        team: summarizeTeam(team),
        debuffPlan: summarizeDebuffPlan(team),
        runs: runs.map(compactRun),
        averages: {
          wavesCleared: Number(
            (
              runs.reduce((sum, run) => sum + run.wavesCleared, 0) /
              runs.length
            ).toFixed(2),
          ),
          finalProgressPercent: Number(
            (
              runs.reduce(
                (sum, run) => sum + progressPercent(run),
                0,
              ) / runs.length
            ).toFixed(2),
          ),
          teamDps: Number(
            (
              runs.reduce((sum, run) => sum + run.teamDps, 0) /
              runs.length
            ).toFixed(2),
          ),
          totalDeaths: Number(
            (
              runs.reduce((sum, run) => sum + run.totalDeaths, 0) /
              runs.length
            ).toFixed(2),
          ),
          oomMembers: Number(
            (
              runs.reduce((sum, run) => sum + run.oomMembers, 0) /
              runs.length
            ).toFixed(2),
          ),
        },
        score: runs.reduce((sum, run) => sum + score(run), 0) / runs.length,
      };
      rows.push(row);
      process.stdout.write(
        `  ${outputRole}：${row.averages.wavesCleared} 层，` +
          `末层 ${row.averages.finalProgressPercent}%，` +
          `DPS ${Math.round(row.averages.teamDps)}，` +
          `死亡 ${row.averages.totalDeaths}，缺蓝 ${row.averages.oomMembers}\n`,
      );
    }
    rows.sort(
      (left, right) =>
        right.score - left.score ||
        right.averages.teamDps - left.averages.teamDps ||
        left.outputRole.localeCompare(right.outputRole),
    );
    bosses.push({
      bossId: boss.hrid,
      bossName: boss.nameZh,
      ranking: rows,
    });
  }
  const result = {
    schemaVersion: 1,
    kind: "controlled-output-role-experiment",
    generatedAt: new Date().toISOString(),
    engine: "shykai-full-event-runtime",
    design: {
      durationSeconds,
      seeds,
      participantCount: 40,
      fixedSupportCount,
      variableOutputSlots,
      fixedSupportTargets,
      controlledVariables: [
        "Boss、总人数、战斗时长、随机种子固定",
        "坦克、治疗、五光环与主要 Debuff 岗位固定",
        "每次只把 21 个输出位置替换成一种绑定职业",
        "每个职业使用当前已上传的有效战斗配装与既定单体技能模板",
        "所有装备强化统一为武器+12、防具+10、首饰及其他配件+5",
        "所有实际装入的技能（含光环类技能）统一为Lv.80",
      ],
      enhancementProfile: {
        weapon: 12,
        armor: 10,
        accessory: 5,
      },
      abilityLevel: 80,
    },
    bosses,
  };
  await mkdir(path.dirname(experimentOutputPath), { recursive: true });
  await writeFile(
    experimentOutputPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`\n控制变量结果：${experimentOutputPath}\n`);
}

function normalizeBuildEnhancements(build, profile) {
  return {
    ...build,
    name: `${build.name}｜标准强化`,
    equipment: build.equipment.map((entry) => {
      const type = equipmentDetail(entry.itemHrid)?.equipmentDetail?.type;
      const enhancementLevel = targetEnhancementLevel(type, profile);
      return { ...entry, enhancementLevel };
    }),
  };
}

function targetEnhancementLevel(type, profile) {
  const weaponTypes = new Set([
    "/equipment_types/main_hand",
    "/equipment_types/two_hand",
  ]);
  const accessoryTypes = new Set([
    "/equipment_types/charm",
    "/equipment_types/earrings",
    "/equipment_types/necklace",
    "/equipment_types/ring",
    "/equipment_types/pouch",
    "/equipment_types/task_badge",
  ]);
  if (weaponTypes.has(type)) return profile.weapon;
  if (accessoryTypes.has(type)) return profile.accessory;
  if (typeof type !== "string" || !type.startsWith("/equipment_types/")) {
    throw new Error(`Unknown equipment type during normalization: ${type}`);
  }
  return profile.armor;
}

function assertNormalizedEnhancements(team, profile) {
  for (const member of team) {
    for (const entry of member.build.equipment) {
      const type = equipmentDetail(entry.itemHrid)?.equipmentDetail?.type;
      const expected = targetEnhancementLevel(type, profile);
      if (entry.enhancementLevel !== expected) {
        throw new Error(
          `${member.label}/${entry.itemHrid} enhancement mismatch: ` +
            `expected +${expected}, received +${entry.enhancementLevel}`,
        );
      }
    }
  }
}

function normalizeAbilityLevel(ability, abilityLevel) {
  if (!Number.isFinite(abilityLevel)) return ability;
  return { ...ability, level: abilityLevel };
}

function assertNormalizedAbilityLevels(team, abilityLevel) {
  for (const member of team) {
    if (member.abilities.length !== 5) {
      throw new Error(
        `${member.label} must have exactly 5 abilities, received ${member.abilities.length}`,
      );
    }
    for (const ability of member.abilities) {
      if (ability.level !== abilityLevel) {
        throw new Error(
          `${member.label}/${ability.abilityHrid} ability level mismatch: ` +
            `expected Lv.${abilityLevel}, received Lv.${ability.level}`,
        );
      }
    }
  }
}

function enforceZeroCooldownLast(abilityHrids) {
  const zeroCooldown = new Set([
    "/abilities/entangle",
    "/abilities/water_strike",
    "/abilities/fireball",
  ]);
  return [
    ...abilityHrids.filter((hrid) => !zeroCooldown.has(hrid)),
    ...abilityHrids.filter((hrid) => zeroCooldown.has(hrid)),
  ];
}

function assertAbilityOrder(member, selected) {
  for (const zeroCooldownHrid of [
    "/abilities/entangle",
    "/abilities/water_strike",
    "/abilities/fireball",
  ]) {
    const index = selected.indexOf(zeroCooldownHrid);
    if (index >= 0 && index !== 4) {
      throw new Error(
        `${member.sourceMemberId}/${member.combatType} must place ${zeroCooldownHrid} in slot 5`,
      );
    }
  }
  if (member.combatType === "弓" && selected.includes("/abilities/rain_of_arrows")) {
    throw new Error("Single-target bow must not use Rain Of Arrows");
  }
  if (
    member.combatType === "枪" &&
    selected.includes("/abilities/penetrating_strike")
  ) {
    throw new Error("Guild Trial spear must not use Penetrating Strike");
  }
  if (member.combatType === "盾" && selected[0] !== "/abilities/guardian_aura") {
    throw new Error("Shield slot 1 must be Guardian Aura");
  }
  if (
    member.combatType === "盾" &&
    selected.join("|") !==
      [
        "/abilities/guardian_aura",
        "/abilities/provoke",
        "/abilities/toughness",
        "/abilities/spike_shell",
        "/abilities/precision",
      ].join("|")
  ) {
    throw new Error(
      "Shield must use Guardian Aura/Provoke/Toughness/Spike Shell/Precision",
    );
  }
}

function expandSources(sources, targetCount) {
  if (!targetCount) return [];
  if (!sources.length) throw new Error("Cannot expand an empty source list");
  const result = sources.slice(0, targetCount);
  const cloneable = sources.filter(hasReusableSpecial);
  if (!cloneable.length && result.length < targetCount) {
    throw new Error("No source with Revive/Insanity is available for cloning");
  }
  let index = 0;
  while (result.length < targetCount) {
    result.push(cloneable[index % cloneable.length]);
    index += 1;
  }
  return result;
}

function hasReusableSpecial(source) {
  return [
    "/abilities/revive",
    "/abilities/insanity",
    "/abilities/guardian_aura",
  ].some((hrid) =>
    Number.isFinite(source.snapshot.learnedAbilities[hrid]),
  );
}

function rawMember(source, role, index, totalForRole, cloneIndex = 1) {
  if (!source) throw new Error(`No source available for ${role}`);
  return {
    snapshot: source.snapshot,
    build: source.build,
    sourceMemberId: source.memberId,
    buildSelectionSource: source.buildSelectionSource ?? "proxy-build",
    combatType: role,
    cloneIndex,
    roleIndex: index,
    totalForRole,
    duty: "dps",
    auraHrid: null,
  };
}

function assignDuties(team, definition) {
  for (const member of team) {
    if (member.combatType === "盾") member.duty = "tank";
    if (member.combatType === "自") {
      member.duty =
        member.roleIndex < Math.min(6, member.totalForRole)
          ? "healer"
          : member.roleIndex === Math.min(6, member.totalForRole)
            ? "debuffer"
            : "dps";
    }
    if (
      member.combatType === "弩" &&
      member.roleIndex < definition.crossbowSupportCount
    ) {
      member.duty = "debuffer";
    }
    if (member.combatType === "枪" && member.roleIndex < 2) {
      member.duty = "debuffer";
    }
    if (member.combatType === "锤" && member.roleIndex < 2) {
      member.duty = "debuffer";
    }
    if (member.combatType === "剑") {
      member.duty = "debuffer";
    }
    if (member.combatType === "火") {
      member.duty = "debuffer";
    }
  }
}

function assignAuras(team, { fixedOnly = false } = {}) {
  const unused = new Set(team);
  const remainingAuras = new Set(auraHrids);
  const auraEligibleTeam = fixedOnly
    ? team.filter((member) => !member.isVariableOutputSlot)
    : team;

  // Shields always carry Guardian Aura in the special slot; cover the unique
  // aura with tanks first so other roles do not also take it.
  const shields = auraEligibleTeam.filter(
    (member) => member.combatType === "盾",
  );
  for (const member of shields) {
    if (
      !Number.isFinite(
        member.snapshot.learnedAbilities["/abilities/guardian_aura"],
      )
    ) {
      throw new Error(
        `${member.sourceMemberId} is bound as 盾 but has not learned Guardian Aura`,
      );
    }
    member.auraHrid = "/abilities/guardian_aura";
    unused.delete(member);
  }
  if (shields.length) {
    remainingAuras.delete("/abilities/guardian_aura");
  }

  const forcedAuraMembers = auraEligibleTeam.filter(
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
        `${member.sourceMemberId} requires an aura slot but no unique aura remains`,
      );
    }
    member.auraHrid = selectedAura;
    remainingAuras.delete(selectedAura);
    unused.delete(member);
  }
  const orderedAuras = [...remainingAuras]
    .map((auraHrid) => ({
      auraHrid,
      candidates: auraEligibleTeam.filter((member) =>
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
          left.sourceMemberId.localeCompare(right.sourceMemberId),
      );
    const selected = eligible[0];
    if (!selected) throw new Error(`No unique carrier for ${auraHrid}`);
    selected.auraHrid = auraHrid;
    unused.delete(selected);
  }
}

function auraDutyPreference(auraHrid, member) {
  if (
    ["/abilities/guardian_aura", "/abilities/mystic_aura"].includes(auraHrid)
  ) {
    return ["tank", "healer", "debuffer"].includes(member.duty) ? 2 : 0;
  }
  if (
    ["/abilities/fierce_aura", "/abilities/critical_aura"].includes(auraHrid)
  ) {
    return ["弓", "弩", "枪", "锤"].includes(member.combatType) ? 2 : 0;
  }
  return 1;
}

function preferredSpecialHrid(member) {
  const learned = member.snapshot.learnedAbilities;
  const order = member.duty === "tank"
    ? ["/abilities/guardian_aura"]
    : ["healer", "debuffer"].includes(member.duty)
    ? ["/abilities/revive", "/abilities/insanity", "/abilities/guardian_aura"]
    : ["/abilities/insanity", "/abilities/revive", "/abilities/guardian_aura"];
  const selected = order.find((hrid) => Number.isFinite(learned[hrid]));
  if (!selected) throw new Error(`${member.sourceMemberId} has no usable special`);
  return selected;
}

function ordinaryAbilityHrids(member, definition) {
  switch (member.combatType) {
    case "盾":
      return [
        "/abilities/provoke",
        "/abilities/toughness",
        "/abilities/spike_shell",
        "/abilities/precision",
      ];
    case "弓":
      return [
        "/abilities/berserk",
        "/abilities/precision",
        "/abilities/pestilent_shot",
        `/abilities/${definition.bowFourth}`,
        "/abilities/frenzy",
        "/abilities/steady_shot",
        "/abilities/quick_shot",
        "/abilities/flame_arrow",
      ];
    case "弩":
      return member.duty === "debuffer"
        ? [
            "/abilities/berserk",
            "/abilities/frenzy",
            "/abilities/precision",
            "/abilities/pestilent_shot",
            "/abilities/steady_shot",
            "/abilities/penetrating_shot",
          ]
        : [
            "/abilities/berserk",
            "/abilities/frenzy",
            "/abilities/precision",
            "/abilities/steady_shot",
            "/abilities/pestilent_shot",
            "/abilities/quick_shot",
          ];
    case "水":
      return [
        "/abilities/elemental_affinity",
        "/abilities/ice_spear",
        `/abilities/${definition.waterUtility}`,
        "/abilities/water_strike",
        "/abilities/frost_surge",
        "/abilities/mana_spring",
      ];
    case "自":
      return [
        "/abilities/rejuvenate",
        "/abilities/toxic_pollen",
        `/abilities/${definition.natureOptional}`,
        "/abilities/entangle",
        "/abilities/quick_aid",
        "/abilities/natures_veil",
        "/abilities/elemental_affinity",
      ];
    case "枪":
      return [
        "/abilities/berserk",
        "/abilities/frenzy",
        "/abilities/precision",
        "/abilities/puncture",
        "/abilities/impale",
        "/abilities/poke",
      ];
    case "剑":
      return [
        "/abilities/berserk",
        "/abilities/precision",
        "/abilities/maim",
        "/abilities/crippling_slash",
        "/abilities/frenzy",
        "/abilities/cleave",
      ];
    case "锤":
      return [
        "/abilities/berserk",
        "/abilities/frenzy",
        "/abilities/precision",
        "/abilities/fracturing_impact",
        "/abilities/stunning_blow",
        "/abilities/sweep",
        "/abilities/smack",
      ];
    case "火":
      return [
        "/abilities/elemental_affinity",
        "/abilities/rejuvenate",
        "/abilities/smoke_burst",
        "/abilities/fireball",
        "/abilities/flame_blast",
        "/abilities/firestorm",
      ];
    default:
      throw new Error(`Unsupported combat type ${member.combatType}`);
  }
}

function selectLearnedOrdinary(snapshot, preferred, limit) {
  const result = [];
  const seen = new Set();
  for (const hrid of preferred) {
    if (
      !seen.has(hrid) &&
      Number.isFinite(snapshot.learnedAbilities[hrid]) &&
      !abilityDetail(hrid)?.isSpecialAbility
    ) {
      result.push(hrid);
      seen.add(hrid);
      if (result.length === limit) return result;
    }
  }
  for (const hrid of Object.keys(snapshot.learnedAbilities).sort()) {
    if (
      !seen.has(hrid) &&
      !abilityDetail(hrid)?.isSpecialAbility
    ) {
      result.push(hrid);
      seen.add(hrid);
      if (result.length === limit) return result;
    }
  }
  return result;
}

function compareCandidates(left, right) {
  return (
    right.score - left.score ||
    right.run.teamDps - left.run.teamDps ||
    left.definition.id.localeCompare(right.definition.id)
  );
}

function score(run) {
  return run.wavesCleared +
    (run.finalMonsterMaxHp > 0
      ? 1 - run.finalMonsterHp / run.finalMonsterMaxHp
      : 0);
}

function progressPercent(run) {
  return Number(
    (run.finalMonsterMaxHp > 0
      ? (1 - run.finalMonsterHp / run.finalMonsterMaxHp) * 100
      : 0
    ).toFixed(2),
  );
}

function compactRun(run) {
  return {
    seed: run.seed,
    wavesCleared: run.wavesCleared,
    finalMonsterLevel: run.finalMonsterLevel,
    finalMonsterHp: run.finalMonsterHp,
    finalMonsterMaxHp: run.finalMonsterMaxHp,
    finalProgressPercent: progressPercent(run),
    teamDps: Number(run.teamDps.toFixed(2)),
    totalDeaths: run.totalDeaths,
    oomMembers: run.oomMembers,
    participantCount: run.participantCount,
    monsterHpMultiplier: run.monsterHpMultiplier,
  };
}

function summarizeTeam(team) {
  const groupedTemplates = new Map();
  for (const member of team) {
    const abilityKey = member.abilities
      .map((ability) => ability.abilityHrid)
      .join("|");
    const key =
      `${member.sourceMemberId}|${member.combatType}|${member.role}|` +
      `${member.build.name}|${abilityKey}`;
    const row = groupedTemplates.get(key) ?? {
      label: member.label.replace(/#\\d+/, ""),
      role: member.role,
      combatType: member.combatType,
      sourceMemberId: member.sourceMemberId,
      buildName: member.build.name,
      buildSelectionSource: member.buildSelectionSource,
      count: 0,
      abilities: member.abilities.map((ability) => ({
        hrid: ability.abilityHrid,
        level: ability.level,
      })),
    };
    row.count += 1;
    groupedTemplates.set(key, row);
  }
  return {
    roles: count(team, (member) => member.combatType),
    duties: count(team, (member) => dutyName(member.role)),
    sources: count(team, (member) => member.sourceMemberId),
    builds: count(team, (member) => `${member.sourceMemberId}/${member.build.name}`),
    templates: [...groupedTemplates.values()],
  };
}

function summarizeDebuffPlan(team) {
  return trackedDebuffs.map((abilityHrid) => {
    const detail = abilityDetail(abilityHrid);
    const durations = (detail?.abilityEffects ?? [])
      .flatMap((effect) => effect.buffs ?? [])
      .map((buff) => Number(buff.duration) / 1e9)
      .filter(Number.isFinite);
    const durationSeconds = durations.length ? Math.max(...durations) : 0;
    const cooldownSeconds = Number(detail?.cooldownDuration ?? 0) / 1e9;
    const casters = team.filter((member) =>
      member.abilities.some((ability) => ability.abilityHrid === abilityHrid),
    ).length;
    return {
      abilityHrid,
      nameZh: officialAbilityNameZh(abilityHrid),
      casters,
      durationSeconds,
      cooldownSeconds,
      nominalSingleCasterCoveragePercent:
        cooldownSeconds > 0
          ? Number(
              (Math.min(1, durationSeconds / cooldownSeconds) * 100).toFixed(1),
            )
          : 0,
    };
  });
}

function averageMembers(runs) {
  const byMember = new Map();
  for (const run of runs) {
    for (const member of run.members) {
      const row = byMember.get(member.memberId) ?? {
        memberId: member.memberId,
        label: member.label,
        role: member.role,
        damageDone: 0,
        damageTaken: 0,
        healing: 0,
        deaths: 0,
        oomRuns: 0,
        manaSpent: 0,
        manaRestored: 0,
        passiveManaRegen: 0,
        oomDurationSeconds: 0,
      };
      row.damageDone += member.damageDone;
      row.damageTaken += member.damageTaken;
      row.healing += member.healing;
      row.deaths += member.deaths;
      row.oomRuns += member.ranOutOfMana ? 1 : 0;
      row.manaSpent += member.manaSpent;
      row.manaRestored += member.manaRestored;
      row.passiveManaRegen += member.passiveManaRegen;
      row.oomDurationSeconds += member.oomDurationSeconds;
      row.maxMp = member.maxMp;
      byMember.set(member.memberId, row);
    }
  }
  return [...byMember.values()].map((row) => ({
    ...row,
    averageDps: Number((row.damageDone / runs.length / 3600).toFixed(2)),
    averageDamageTaken: Number(
      (row.damageTaken / runs.length).toFixed(2),
    ),
    averageHealing: Number((row.healing / runs.length).toFixed(2)),
    averageManaSpent: Number((row.manaSpent / runs.length).toFixed(2)),
    averageManaRestored: Number((row.manaRestored / runs.length).toFixed(2)),
    averagePassiveManaRegen: Number(
      (row.passiveManaRegen / runs.length).toFixed(2),
    ),
    averageOomDurationSeconds: Number(
      (row.oomDurationSeconds / runs.length).toFixed(2),
    ),
  }));
}

function formatSummary(assignment) {
  const sourcePoolCounts = assignment.source.disjointBossSourcePools.map(
    (pool) =>
      new Set(Object.values(pool.members).flat()).size,
  );
  const lines = [
    "TMD 双 Boss 互斥职业模板测试（完整事件引擎 / 不可转正）",
    `数据：绑定 ${assignment.source.bindingCount} 人；有效职业装备快照 ` +
      `${assignment.source.usableSnapshotCount} 人；水母分配 ${sourcePoolCounts[0]} 个真实来源，` +
      `刺猬分配 ${sourcePoolCounts[1]} 个真实来源，跨 Boss 重复 0 人。`,
    "占位说明：双队合计 80 个报名位，未收齐的部分只用本队成员复制为职业模板估算；这些复制位不是正式成员分工。",
    "坦克：水母使用当前有效盾成员；刺猬暂用 adudu 盾配装作为职业模板占位；盾技能固定守护光环、挑衅、坚韧、尖刺防护、精确（不带无敌）。",
    "规则：总计 1 小时，Lv.100 起每层 +10，最高 Lv.300；进入下一层时 HP/MP 补满；40 人 Boss HP×1.40；禁消耗品；HP/MP 回复率各 +3%；单次攻击最多 5 次格挡判定。",
  ];
  for (const boss of assignment.bosses) {
    const averageDps =
      boss.runs.reduce((total, run) => total + run.teamDps, 0) /
      boss.runs.length;
    const averageProgress =
      boss.runs.reduce(
        (total, run) => total + run.finalProgressPercent,
        0,
      ) / boss.runs.length;
    const layers = boss.runs.map((run) => run.wavesCleared);
    const deaths = boss.runs.map((run) => run.totalDeaths);
    const oom = boss.runs.map((run) => run.oomMembers);
    lines.push(
      `【${boss.bossName}】3次通过 ${Math.min(...layers)}–${Math.max(...layers)} 层；` +
        `末层平均 ${averageProgress.toFixed(1)}%；团队 DPS≈${Math.round(averageDps)}`,
      `方案：${boss.selectedCandidate}`,
      `职业：${formatCounts(boss.team.roles)}`,
      `职责：${formatCounts(boss.team.duties)}`,
      `死亡 ${Math.min(...deaths)}–${Math.max(...deaths)}；` +
        `曾缺蓝人数 ${Math.min(...oom)}–${Math.max(...oom)}`,
    );
  }
  lines.push(
    "提醒：已按完整技能/装备事件运行并在换层时补满 HP/MP；等级成长、其余换层状态、公会神殿和死亡细节仍待正式服校准，因此仅供测试，不能直接转正。",
    "管理员可发送“本周测试分工”或“复制人测试”再次查看。",
  );
  return lines.join("\n");
}

function dutyName(value) {
  return {
    tank: "坦克",
    healer: "治疗",
    debuffer: "减益",
    dps: "输出",
  }[value] ?? value;
}

function count(rows, selector) {
  const result = {};
  for (const row of rows) {
    const key = selector(row);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function formatCounts(row) {
  return roleOrder
    .filter((role) => row[role])
    .map((role) => `${role}×${row[role]}`)
    .concat(
      Object.entries(row)
        .filter(([key]) => !roleOrder.includes(key))
        .map(([key, value]) => `${key}×${value}`),
    )
    .join("、");
}

function sumMap(map) {
  return [...map.values()].reduce((total, rows) => total + rows.length, 0);
}
