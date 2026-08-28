import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  abilityDetail,
  buildPlayerMember,
  defaultAbility,
  runGuildTrial,
} from "../packages/shykai-full-runtime/src/guild-trial-runner.mjs";
import {
  canDefaultMissingSkillLevel,
  DEFAULT_MISSING_SKILL_LEVEL,
  resolveLearnedAbilityLevel,
} from "../packages/shykai-full-runtime/src/ability-level-defaults.mjs";
import { officialAbilityNameZh } from "../packages/mwi-data/official-zh-ability-names.mjs";
import { selectCombatBuild } from "../packages/optimizer/src/combat-build-selection.mjs";
import {
  assessCombatMemberReadiness,
  prepareSnapshotForCombat,
} from "../packages/optimizer/src/combat-member-readiness.mjs";

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
  "fixtures/monsters/guild-trial-2026-07-31-badger-hedgehog.json",
);
const outputPath = path.join(
  projectDirectory,
  ".local/tmd-registered-roster-composition-lab.json",
);
const screeningDurationSeconds = Number(
  process.env.MWI_GUILD_SCREEN_DURATION_SECONDS ?? 600,
);
const finalDurationSeconds = Number(
  process.env.MWI_GUILD_FINAL_DURATION_SECONDS ?? 3600,
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

const packageCandidates = [
  {
    id: "balanced-heal-frost",
    crossbowSupportCount: 1,
    bowFourth: "frenzy",
    natureOptional: "quick_aid",
    waterUtility: "frost_surge",
  },
  {
    id: "nature-veil-frost",
    crossbowSupportCount: 1,
    bowFourth: "frenzy",
    natureOptional: "natures_veil",
    waterUtility: "frost_surge",
  },
  {
    id: "nature-elemental-mana",
    crossbowSupportCount: 1,
    bowFourth: "steady_shot",
    natureOptional: "elemental_affinity",
    waterUtility: "mana_spring",
  },
  {
    id: "two-pestilent-heal",
    crossbowSupportCount: 2,
    bowFourth: "frenzy",
    natureOptional: "quick_aid",
    waterUtility: "frost_surge",
  },
  {
    id: "nature-veil-mana",
    crossbowSupportCount: 2,
    bowFourth: "steady_shot",
    natureOptional: "natures_veil",
    waterUtility: "mana_spring",
  },
];

if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required");

const headers = { "x-admin-key": adminKey };
const [membersRes, bindingsRes, regsRes, fixture] = await Promise.all([
  fetch(`${apiBase}/api/guilds/${encodeURIComponent(guildId)}/members`, {
    headers,
  }),
  fetch(`${apiBase}/api/guilds/${encodeURIComponent(guildId)}/qq-bindings`, {
    headers,
  }),
  fetch(
    `${apiBase}/api/guilds/${encodeURIComponent(guildId)}/trial-registrations/current`,
    { headers },
  ),
  readFile(fixturePath, "utf8").then(JSON.parse),
]);
if (!membersRes.ok || !bindingsRes.ok || !regsRes.ok) {
  throw new Error("failed to load guild API inputs");
}
const membersData = await membersRes.json();
const bindingsData = await bindingsRes.json();
const regsData = await regsRes.json();
const memberMap = new Map(membersData.members.map((m) => [m.memberId, m]));
const bindingMap = new Map(bindingsData.bindings.map((b) => [b.memberId, b]));

const bossResults = [];
const unavailableByBoss = [];

for (const boss of fixture.bosses) {
  const registration = (regsData.trials ?? []).find(
    (trial) => trial.trialHrid === boss.hrid,
  );
  if (!registration) {
    throw new Error(`No registration snapshot for ${boss.hrid}`);
  }

  const usableByRole = new Map(roleOrder.map((role) => [role, []]));
  const unavailable = [];
  for (const reg of registration.members) {
    const binding = bindingMap.get(reg.memberId);
    const member = memberMap.get(reg.memberId);
    const combatType = binding?.combatType;
    const snapshot = member?.latestSnapshot;
    const readiness = assessCombatMemberReadiness(snapshot, combatType);
    if (!readiness.ok) {
      unavailable.push({
        memberId: reg.memberId,
        combatType: combatType ?? null,
        level: reg.level,
        reason: readiness.reason,
      });
      continue;
    }
    const preparedSnapshot = prepareSnapshotForCombat(snapshot, combatType);
    const buildSelection = selectCombatBuild(preparedSnapshot, combatType);
    usableByRole.get(combatType).push({
      memberId: reg.memberId,
      combatType,
      qqNumber: binding.qqNumber,
      level: reg.level,
      gameRole: reg.roleHrid,
      snapshot: preparedSnapshot,
      build: buildSelection.build,
      buildSelectionSource: buildSelection.source,
      defaultedAbilityHrids: readiness.defaultedAbilityHrids ?? [],
    });
  }
  for (const rows of usableByRole.values()) {
    rows.sort((left, right) => left.memberId.localeCompare(right.memberId));
  }

  const roleTargets = Object.fromEntries(
    roleOrder.map((role) => [role, usableByRole.get(role)?.length ?? 0]),
  );
  const teamSize = Object.values(roleTargets).reduce((sum, n) => sum + n, 0);
  if (teamSize < 1) throw new Error(`${boss.nameZh} has no usable members`);

  process.stdout.write(
    `\n【${boss.nameZh}】报名 ${registration.members.length}，可用 ${teamSize}，` +
      `不可用 ${unavailable.length}；职业 ${formatCounts(roleTargets)}\n`,
  );
  unavailableByBoss.push({ bossId: boss.hrid, bossName: boss.nameZh, unavailable });

  const screened = [];
  for (const baseDefinition of packageCandidates) {
    const definition = { ...baseDefinition, roleTargets };
    const team = createRegisteredTeam(definition, usableByRole);
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
  finalists.sort(compareCandidates);
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
        `DPS=${Math.round(run.teamDps)}，死亡=${run.totalDeaths}\n`,
    );
  }

  bossResults.push({
    bossId: boss.hrid,
    bossName: boss.nameZh,
    participantCount: teamSize,
    enemiesPerEncounter: boss.enemiesPerEncounter ?? 1,
    roleTargets,
    selectedCandidate: selected.definition.id,
    team: summarizeTeam(selected.team),
    roster: selected.team.map((member) => ({
      memberId: member.sourceMemberId,
      combatType: member.combatType,
      duty: member.role,
      aura: member.auraHrid
        ? officialAbilityNameZh(member.auraHrid) ?? member.auraHrid
        : null,
      abilities: member.abilities.map(
        (ability) =>
          `${officialAbilityNameZh(ability.abilityHrid) ?? ability.abilityHrid}` +
          `Lv${ability.level}`,
      ),
    })),
    runs: fullRuns.map(compactRun),
    searchCandidates: screened.map((candidate) => ({
      name: candidate.definition.id,
      run: candidate.run,
    })),
  });
}

const assignment = {
  schemaVersion: 1,
  kind: "tmd-registered-roster-composition-lab",
  developmentOnly: true,
  promotable: false,
  guildId,
  generatedAt: new Date().toISOString(),
  engine: "shykai-full-event-runtime",
  rules: {
    durationSeconds: finalDurationSeconds,
    startLevel: 100,
    levelStep: 10,
    maxLevel: 300,
    consumables: "disabled",
    passiveHpMpRegenFlatBonus: 0.03,
    refillHpMpOnLevelTransition: true,
    maxParryAttemptsPerIncomingAttack: 5,
    missingOrdinarySkillsDefaultLevel: 40,
    seeds,
  },
  source: {
    mode: "registered-ready-members-only",
    unavailableByBoss,
    note:
      "仅使用本周战斗试炼报名且通过可用性检查的成员；不使用复制人补位。疯狂/复活按游戏基准缺省 Lv1。",
  },
  bosses: bossResults,
  summaryText: buildSummary(bossResults, unavailableByBoss),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(assignment, null, 2));
process.stdout.write(`\n${assignment.summaryText}\n\n已写入 ${outputPath}\n`);

function createRegisteredTeam(definition, usableByRole) {
  const raw = [];
  for (const role of roleOrder) {
    const sources = usableByRole.get(role) ?? [];
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
  assignDuties(raw, definition);
  assignAuras(raw);
  return raw.map((row, index) => {
    const ordinary = ordinaryAbilityHrids(row, definition);
    const special = row.auraHrid ?? preferredSpecialHrid(row);
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
      memberId: `${roleSlug[row.combatType]}_${String(index + 1).padStart(2, "0")}`,
      snapshot: row.snapshot,
      abilities: selected.map((abilityHrid) =>
        defaultAbility(abilityHrid, row.snapshot.learnedAbilities),
      ),
      combatType: row.combatType,
      sourceMemberId: row.memberId,
    });
    member.combatType = row.combatType;
    member.sourceMemberId = row.memberId;
    member.auraHrid = row.auraHrid ?? null;
    return member;
  });
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
    if (member.combatType === "剑") member.duty = "debuffer";
    if (member.combatType === "火") member.duty = "debuffer";
  }
}

/**
 * Assign each aura to the unused eligible member with the highest learned level.
 * Insanity/revive baseline Lv1 means members without uploaded specials still have a
 * reusable special slot, so we do not force-consume unique aura slots first.
 */
function assignAuras(team) {
  for (const member of team) member.auraHrid = null;
  const unused = new Set(
    team.filter((member) => member.combatType !== "盾"),
  );
  const remainingAuras = [...auraHrids];
  while (remainingAuras.length) {
    let best = null;
    for (const auraHrid of remainingAuras) {
      for (const member of unused) {
        const level = Number(member.snapshot.learnedAbilities[auraHrid]);
        if (!Number.isFinite(level)) continue;
        if (
          !best ||
          level > best.level ||
          (level === best.level &&
            (auraHrid.localeCompare(best.auraHrid) < 0 ||
              (auraHrid === best.auraHrid &&
                member.memberId.localeCompare(best.member.memberId) < 0)))
        ) {
          best = { auraHrid, member, level };
        }
      }
    }
    if (!best) {
      throw new Error(
        `No carrier left for remaining auras: ${remainingAuras.join(",")}`,
      );
    }
    best.member.auraHrid = best.auraHrid;
    unused.delete(best.member);
    remainingAuras.splice(remainingAuras.indexOf(best.auraHrid), 1);
  }
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

function preferredSpecialHrid(member) {
  const learned = member.snapshot.learnedAbilities;
  const levelOf = (hrid) => resolveLearnedAbilityLevel(hrid, learned);
  if (member.duty === "tank") {
    if (!Number.isFinite(learned["/abilities/invincible"])) {
      throw new Error(`${member.memberId} tank missing invincible`);
    }
    return "/abilities/invincible";
  }
  const insanity = levelOf("/abilities/insanity");
  const revive = levelOf("/abilities/revive");
  if (insanity == null && revive == null) {
    throw new Error(`${member.memberId} has no usable special`);
  }
  if (member.duty === "healer") {
    if (revive != null && (insanity == null || revive >= insanity)) {
      return "/abilities/revive";
    }
    return "/abilities/insanity";
  }
  if (insanity != null && (revive == null || insanity >= revive)) {
    return "/abilities/insanity";
  }
  return "/abilities/revive";
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
      ];
    case "弩":
      return member.duty === "debuffer"
        ? [
            "/abilities/berserk",
            "/abilities/frenzy",
            "/abilities/precision",
            "/abilities/pestilent_shot",
            "/abilities/steady_shot",
          ]
        : [
            "/abilities/berserk",
            "/abilities/frenzy",
            "/abilities/precision",
            "/abilities/steady_shot",
            "/abilities/pestilent_shot",
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
      ];
    case "剑":
      return [
        "/abilities/berserk",
        "/abilities/precision",
        "/abilities/maim",
        "/abilities/crippling_slash",
        "/abilities/frenzy",
      ];
    case "锤":
      return [
        "/abilities/berserk",
        "/abilities/frenzy",
        "/abilities/precision",
        "/abilities/fracturing_impact",
        "/abilities/stunning_blow",
      ];
    case "火":
      return [
        "/abilities/elemental_affinity",
        "/abilities/rejuvenate",
        "/abilities/smoke_burst",
        "/abilities/fireball",
      ];
    default:
      throw new Error(`Unsupported combat type ${member.combatType}`);
  }
}

function selectLearnedOrdinary(snapshot, preferred, limit) {
  const result = [];
  const seen = new Set();
  const learned = snapshot.learnedAbilities;
  for (const hrid of preferred) {
    if (seen.has(hrid) || abilityDetail(hrid)?.isSpecialAbility) continue;
    if (!Number.isFinite(learned[hrid])) {
      if (!canDefaultMissingSkillLevel(hrid)) continue;
      learned[hrid] = DEFAULT_MISSING_SKILL_LEVEL;
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
  return (
    run.wavesCleared +
    (run.finalMonsterMaxHp > 0
      ? 1 - run.finalMonsterHp / run.finalMonsterMaxHp
      : 0)
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
    (right.fullRun?.teamDps ?? right.run.teamDps) -
      (left.fullRun?.teamDps ?? left.run.teamDps) ||
    left.definition.id.localeCompare(right.definition.id)
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

function buildSummary(bosses, unavailableByBoss) {
  const lines = [
    "TMD 本周报名可用人员组合搜索（开发实验，不可转正）",
    "规则：缺普通技能默认 Lv40；复活/疯狂缺省按游戏基准 Lv1；光环不默认；不使用复制人。",
  ];
  for (const boss of bosses) {
    const layers = boss.runs.map((run) => run.wavesCleared);
    const dps =
      boss.runs.reduce((sum, run) => sum + run.teamDps, 0) / boss.runs.length;
    const progress =
      boss.runs.reduce((sum, run) => sum + run.finalProgressPercent, 0) /
      boss.runs.length;
    lines.push(
      `【${boss.bossName}】${boss.participantCount}人` +
        (boss.enemiesPerEncounter > 1
          ? `（每层${boss.enemiesPerEncounter}只）`
          : "") +
        `；3次 ${Math.min(...layers)}–${Math.max(...layers)} 层；` +
        `DPS≈${Math.round(dps)}；末层平均${progress.toFixed(1)}%`,
      `最优包：${boss.selectedCandidate}`,
      `职业：${formatCounts(boss.team.roles)}`,
      `职责：坦克${boss.team.duties.tank ?? 0} 奶${boss.team.duties.healer ?? 0} ` +
        `减${boss.team.duties.debuffer ?? 0} 输出${boss.team.duties.dps ?? 0}`,
      `名单：${boss.roster.map((row) => `${row.memberId}(${row.combatType})`).join("、")}`,
    );
    const unavailable = unavailableByBoss.find(
      (row) => row.bossId === boss.bossId,
    )?.unavailable;
    if (unavailable?.length) {
      lines.push(
        `不可用：${unavailable
          .map((row) => `${row.memberId}(${row.reason})`)
          .join("、")}`,
      );
    }
  }
  return lines.join("\n");
}
