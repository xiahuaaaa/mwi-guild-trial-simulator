import { pathToFileURL } from "node:url";
import { handleSimulatorRequest } from "../workers/simulator/src/worker.ts";

const AURA_NAMES = {
  "/abilities/speed_aura": "速度",
  "/abilities/guardian_aura": "守护",
  "/abilities/fierce_aura": "物理",
  "/abilities/critical_aura": "暴击",
  "/abilities/mystic_aura": "元素",
};

const ROLE_LABELS = {
  tank: "坦克",
  healer: "治疗",
  debuffer: "减益",
  dps: "输出",
};

function weaponProfile(build) {
  const weapon = build.equipment.find((entry) =>
    entry.locationHrid === "/item_locations/main_hand"
  )?.itemHrid ?? "";
  if (weapon.includes("sundering_crossbow")) {
    return { style: "ranged", damageType: "physical" };
  }
  if (weapon.includes("blooming_trident")) {
    return { style: "magic", damageType: "nature" };
  }
  if (weapon.includes("rippling_trident")) {
    return { style: "magic", damageType: "water" };
  }
  if (weapon.includes("blazing_trident")) {
    return { style: "magic", damageType: "fire" };
  }
  if (weapon.includes("spear")) {
    return { style: "stab", damageType: "physical" };
  }
  if (weapon.includes("flail") || weapon.includes("hammer")) {
    return { style: "smash", damageType: "physical" };
  }
  return { style: "slash", damageType: "physical" };
}

function candidateScore(build, boss, skills) {
  const profile = weaponProfile(build);
  const avoidance = boss.evasion[profile.style] ?? 0;
  const mitigation = profile.damageType === "physical"
    ? boss.armor
    : boss.resistance[profile.damageType];
  const skillHrid = profile.style === "magic"
    ? "/skills/magic"
    : profile.style === "ranged"
      ? "/skills/ranged"
      : "/skills/attack";
  return 10_000 * (1 + (skills[skillHrid] ?? 0) / 1000) /
    (1000 + avoidance + mitigation);
}

function pickBuild(builds, predicate, fallback) {
  return builds.find(predicate) ?? fallback;
}

function abilityTemplate(role, profile, auraHrid, learned) {
  const tail = role === "tank"
    ? ["provoke", "toughness", "spike_shell", "precision"]
    : role === "healer"
      ? ["rejuvenate", "quick_aid", "heal", "mana_spring"]
      : profile.style === "ranged"
        ? role === "debuffer"
          ? ["frenzy", "precision", "pestilent_shot", "silencing_shot"]
          : ["frenzy", "berserk", "penetrating_shot", "rain_of_arrows"]
        : profile.damageType === "nature"
          ? ["elemental_affinity", "toxic_pollen", "natures_veil", "entangle"]
          : profile.damageType === "fire"
            ? ["elemental_affinity", "precision", "smoke_burst", "fireball"]
            : ["elemental_affinity", "precision", "ice_spear", "water_strike"];
  return [auraHrid, ...tail.map((name) => `/abilities/${name}`)].map((hrid) => {
    const level = learned[hrid];
    if (!Number.isFinite(level)) {
      throw new Error(`adudu has not learned required ability: ${hrid}`);
    }
    return { abilityHrid: hrid, level };
  });
}

function auraPlan(boss, count) {
  const magicPreferred = boss.resistance.fire < boss.armor;
  const weighted = magicPreferred
    ? [
        ["/abilities/guardian_aura", 2],
        ["/abilities/speed_aura", 12],
        ["/abilities/critical_aura", 16],
        ["/abilities/mystic_aura", 10],
      ]
    : [
        ["/abilities/guardian_aura", 2],
        ["/abilities/speed_aura", 8],
        ["/abilities/critical_aura", 12],
        ["/abilities/fierce_aura", 18],
      ];
  const result = weighted.flatMap(([hrid, amount]) => Array(amount).fill(hrid));
  if (result.length !== count) throw new Error("aura plan must cover every clone");
  return result;
}

function buildTeam(snapshot, boss, count = 40) {
  const readyBuilds = snapshot.loadoutCatalog.filter((build) =>
    build.category === "combat" &&
    build.equipment?.length &&
    build.abilities?.length &&
    (build.issues?.length ?? 0) === 0
  );
  if (!readyBuilds.length) throw new Error("no usable adudu combat loadouts");
  const ranked = readyBuilds
    .map((build) => ({
      build,
      profile: weaponProfile(build),
      score: candidateScore(build, boss, snapshot.skills),
    }))
    .sort((left, right) => right.score - left.score || left.build.name.localeCompare(right.build.name));
  const best = ranked[0].build;
  const nature = pickBuild(readyBuilds, (build) =>
    weaponProfile(build).damageType === "nature", best);
  const fire = pickBuild(readyBuilds, (build) =>
    weaponProfile(build).damageType === "fire", best);
  const shielded = pickBuild(readyBuilds, (build) => build.name.includes("盾"), [...readyBuilds].sort((left, right) => {
    const shield = (build) => build.equipment.some((entry) =>
      entry.locationHrid === "/item_locations/off_hand" &&
      entry.itemHrid.includes("shield")
    ) ? 1000 : 0;
    const enhancements = (build) => build.equipment.reduce((sum, entry) =>
      sum + (entry.enhancementLevel ?? 0), 0);
    return shield(right) + enhancements(right) - shield(left) - enhancements(left);
  })[0]);
  const debuffBuild = boss.resistance.nature === Math.min(...Object.values(boss.resistance))
    ? nature
    : boss.resistance.fire === Math.min(...Object.values(boss.resistance))
      ? fire
      : best;
  const roles = Array.from({ length: count }, (_, index) =>
    index < 2 ? "tank" : index < 6 ? "healer" : index < 8 ? "debuffer" : "dps"
  );
  const auras = auraPlan(boss, count);
  const baselineBuild = pickBuild(readyBuilds, (build) => build.name === "弩", best);
  const baselineBoss = {
    evasion: { ...boss.evasion, ranged: 396 },
    armor: 200,
    resistance: { water: 280, nature: 160, fire: 280 },
  };
  const baselineScore = candidateScore(baselineBuild, baselineBoss, snapshot.skills);
  const roleMultiplier = { tank: 0.45, healer: 0.35, debuffer: 0.82, dps: 1 };

  const members = roles.map((role, index) => {
    const build = role === "tank"
      ? shielded
      : role === "healer"
        ? nature
        : role === "debuffer"
          ? debuffBuild
          : best;
    const profile = weaponProfile(build);
    const auraHrid = auras[index];
    const auraLevel = snapshot.learnedAbilities[auraHrid] ?? 0;
    const estimatedDps = 65 *
      (candidateScore(build, boss, snapshot.skills) / baselineScore) *
      roleMultiplier[role] *
      (1 + auraLevel / 1000);
    const averageHit = estimatedDps * 2;
    return {
      memberId: `adudu-${boss.hrid.split("/").at(-1)}-${String(index + 1).padStart(2, "0")}`,
      role,
      buildId: build.sourceLoadoutId,
      buildName: build.name,
      profile,
      auraHrid,
      abilities: abilityTemplate(role, profile, auraHrid, snapshot.learnedAbilities),
      estimatedDps,
      staticInput: {
        memberId: `adudu-${boss.hrid.split("/").at(-1)}-${String(index + 1).padStart(2, "0")}`,
        attackIntervalMs: 2000,
        minimumDamage: Math.max(0, Math.floor(averageHit * 0.9)),
        maximumDamage: Math.max(0, Math.ceil(averageHit * 1.1)),
        manaCostPerAttack: 0,
        maxHitpoints: 10_000,
        maxManapoints: 10_000,
      },
    };
  });

  return {
    readyBuilds,
    ranking: ranked.map((entry) => ({
      buildId: entry.build.sourceLoadoutId,
      name: entry.build.name,
      ...entry.profile,
      heuristicScore: Number(entry.score.toFixed(4)),
    })),
    members,
  };
}

function counts(rows, key) {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const value = typeof key === "function" ? key(row) : row[key];
    map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  }, new Map())].sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

function formatCounts(input) {
  return Object.entries(input).map(([name, value]) => `${name}×${value}`).join("、");
}

function compactRun(run) {
  const teamDps = run.members.reduce((sum, member) => sum + member.dps, 0);
  return {
    seed: run.seed,
    wavesCleared: run.wavesCleared,
    finalMonsterLevel: run.finalMonsterLevel,
    finalMonsterHp: run.finalMonsterHp,
    finalMonsterMaxHp: run.finalMonsterMaxHp,
    finalProgressPercent: Number(((1 - run.finalMonsterHp / run.finalMonsterMaxHp) * 100).toFixed(2)),
    teamDps: Number(teamDps.toFixed(2)),
  };
}

export function buildAduduCloneLabAssignment(snapshot, fixture) {
  if (snapshot.memberId !== "195739" && snapshot.displayName !== "adudu") {
    throw new Error("clone lab expects the adudu snapshot");
  }
  const usableCombatBuilds = snapshot.loadoutCatalog.filter((build) =>
    build.category === "combat" &&
    build.equipment?.length &&
    build.abilities?.length &&
    (build.issues?.length ?? 0) === 0
  );
  const bosses = fixture.bosses.map((boss) => {
    const team = buildTeam(snapshot, boss);
    const response = handleSimulatorRequest({
      id: `adudu-clone-lab-${boss.hrid.split("/").at(-1)}`,
      kind: "simulate-static-fixture",
      fixture,
      bossId: boss.hrid,
      members: team.members.map((member) => member.staticInput),
      assumptions: {
        spawnDelayMs: 0,
        passiveRegenRounding: "multiply-before-floor",
        transitionState: "refill-hp-mp",
      },
    });
    if (response.status !== "development-harness") {
      throw new Error(`clone lab failed: ${response.status}`);
    }
    const roleCounts = counts(team.members, (member) => ROLE_LABELS[member.role]);
    const buildCounts = counts(team.members, "buildName");
    const auraCounts = counts(team.members, (member) =>
      `${AURA_NAMES[member.auraHrid]}Lv.${snapshot.learnedAbilities[member.auraHrid]}`
    );
    const skillTemplates = [...new Map(team.members.map((member) => [
      `${member.role}:${member.profile.damageType}`,
      {
        role: ROLE_LABELS[member.role],
        damageType: member.profile.damageType,
        skills: member.abilities.map((ability) =>
          `${ability.abilityHrid.split("/").at(-1)} Lv.${ability.level}`
        ),
      },
    ])).values()];
    return {
      bossId: boss.hrid,
      bossName: boss.nameZh,
      roleCounts,
      buildCounts,
      auraCounts,
      skillTemplates,
      candidateRanking: team.ranking,
      runs: response.result.runs.map(compactRun),
    };
  });
  const lines = [
    "adudu 40复制人测试分工（开发优化，不可转正）",
    `装备：读取全部配装，当前库存完整可用 ${usableCombatBuilds.length} 套；技能/光环允许重组。`,
    ...bosses.flatMap((boss) => {
      const averageDps = boss.runs.reduce((sum, run) => sum + run.teamDps, 0) / boss.runs.length;
      const averageProgress = boss.runs.reduce((sum, run) => sum + run.finalProgressPercent, 0) / boss.runs.length;
      const waves = boss.runs.map((run) => run.wavesCleared);
      return [
        `【${boss.bossName}】3次：${Math.min(...waves)}-${Math.max(...waves)}层；团队DPS≈${Math.round(averageDps)}；末层平均进度${averageProgress.toFixed(1)}%`,
        `职业：${formatCounts(boss.roleCounts)}`,
        `装备：${formatCounts(boss.buildCounts)}`,
        `光环：${formatCounts(boss.auraCounts)}`,
        `技能组：${boss.skillTemplates.map((template) => `${template.role}[${template.skills.join("/")}]`).join("；")}`,
      ];
    }),
    "警告：当前为启发式+静态伤害开发模型，尚未计入真实技能倍率、光环叠加、治疗、仇恨、Boss攻击、死亡与精确成长。",
  ];
  return {
    schemaVersion: 1,
    kind: "adudu-40-clone-development-lab",
    developmentOnly: true,
    promotable: false,
    sourceMember: {
      memberId: snapshot.memberId,
      displayName: snapshot.displayName,
      capturedAt: snapshot.capturedAt,
    },
    generatedAt: new Date().toISOString(),
    fixtureId: fixture.fixtureId,
    assumptions: {
      baseObservedAduduDps: 65,
      fixedEquipment: true,
      skillsRecombinedFromLearnedAbilities: true,
      consumables: "disabled",
      passiveRegenFlatBonus: 0.03,
      unresolvedMechanicsExcluded: true,
    },
    bosses,
    summaryText: lines.join("\n"),
  };
}

async function main() {
  const baseUrl = (process.env.MWI_GUILD_API_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const adminKey = process.env.MWI_GUILD_API_ADMIN_KEY;
  const guildId = process.env.MWI_GUILD_ID ?? "test-guild";
  const memberId = process.env.MWI_CLONE_SOURCE_MEMBER_ID ?? "195739";
  if (!adminKey) throw new Error("MWI_GUILD_API_ADMIN_KEY is required");
  const headers = { "content-type": "application/json", "x-admin-key": adminKey };
  const [membersResponse, fixtureResponse] = await Promise.all([
    fetch(`${baseUrl}/api/guilds/${encodeURIComponent(guildId)}/members`, { headers }),
    fetch(`${baseUrl}/api/boss-fixture/current`, { headers }),
  ]);
  if (!membersResponse.ok || !fixtureResponse.ok) throw new Error("failed to read guild API inputs");
  const members = await membersResponse.json();
  const fixture = await fixtureResponse.json();
  const snapshot = members.members.find((member) => member.memberId === memberId)?.latestSnapshot;
  if (!snapshot) throw new Error(`member snapshot not found: ${memberId}`);
  const assignment = buildAduduCloneLabAssignment(snapshot, fixture);
  const save = await fetch(`${baseUrl}/api/admin/guilds/${encodeURIComponent(guildId)}/assignments/test`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ assignment, locked: false }),
  });
  const saved = await save.json();
  if (!save.ok) throw new Error(saved.error?.message ?? "failed to save test assignment");
  console.log(JSON.stringify({ saved, summaryText: assignment.summaryText }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
