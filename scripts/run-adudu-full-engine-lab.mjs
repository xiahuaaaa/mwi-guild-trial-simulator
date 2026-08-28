import { readFile, writeFile } from "node:fs/promises";
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
  healerAbilityNames,
  healerWeaponPolicy,
} from "../packages/optimizer/src/healer-trigger-policy.mjs";
import {
  CROSSBOW_SUPPORT_MODES,
  DEFAULT_CROSSBOW_SUPPORT_MODE,
  DEFAULT_SHIELD_PACKAGE_ID,
  HAMMER_DEBUFFER_ABILITIES,
  SHIELD_ABILITY_PACKAGES,
  SWORD_DEBUFFER_ABILITIES,
  crossbowDebufferAbilityNames,
  shieldAbilityNames,
  shieldPackageNameZh,
} from "../packages/optimizer/src/combat-role-policies.mjs";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const databasePath =
  process.env.MWI_GUILD_API_DB_PATH ??
  path.join(projectDirectory, ".local/qq-test.sqlite");
const guildId = process.env.MWI_GUILD_ID ?? "test-guild";
const memberId = process.env.MWI_CLONE_SOURCE_MEMBER_ID ?? "195739";
const fixturePath = path.join(
  projectDirectory,
  "fixtures/monsters/guild-trial-2026-07-24-jellyfish-hedgehog.json",
);
const outputPath = path.join(
  projectDirectory,
  ".local/adudu-full-engine-lab.json",
);
const seeds = [1297565953, 1297565954, 1297565955];

const db = new DatabaseSync(databasePath);
const snapshotRow = db
  .prepare(
    "SELECT payload_json FROM snapshots WHERE guild_id = ? AND member_id = ? ORDER BY id DESC LIMIT 1",
  )
  .get(guildId, memberId);
if (!snapshotRow) throw new Error(`No snapshot for ${guildId}/${memberId}`);
const snapshot = JSON.parse(snapshotRow.payload_json);
const fixture = JSON.parse(await readText(fixturePath));
const builds = snapshot.loadoutCatalog.filter(
  (build) =>
    build.category === "combat" &&
    build.equipment?.length &&
    (build.issues?.length ?? 0) === 0,
);
const byName = new Map(builds.map((build) => [build.name, build]));
const screening = [];
const bosses = [];

for (const boss of fixture.bosses) {
  const healerBuilds = uniqueBuilds([
    requiredBuild(byName, "自然", "迷宫自然"),
    requiredBuild(byName, "迷宫水"),
  ]);
  process.stdout.write(`筛选 ${boss.nameZh} 的 ${builds.length} 套装备...\n`);
  const screened = [];
  for (const build of builds) {
    const team = createTeam({
      snapshot,
      byName,
      primaryBuild: build,
      secondaryBuild: null,
      primarySkillMode: "revive",
      secondarySkillMode: "revive",
      healerBuild: healerBuilds[0],
      variant: "baseline",
      shieldPackageId: DEFAULT_SHIELD_PACKAGE_ID,
      crossbowSupportMode: DEFAULT_CROSSBOW_SUPPORT_MODE,
      supportVariant: "baseline",
    });
    const run = await runGuildTrial({
      snapshot,
      boss,
      members: team,
      seed: seeds[0],
      durationSeconds: 900,
    });
    const row = {
      buildName: build.name,
      score: score(run),
      run: compactRun(run),
    };
    screened.push(row);
    process.stdout.write(
      `  ${build.name}: 层=${row.run.wavesCleared} 进度=${row.run.finalProgressPercent}% DPS=${Math.round(row.run.teamDps)}\n`,
    );
  }
  screened.sort(
    (left, right) =>
      right.score - left.score ||
      right.run.teamDps - left.run.teamDps ||
      left.buildName.localeCompare(right.buildName),
  );
  screening.push({ bossId: boss.hrid, rows: screened });

  const topBuilds = screened
    .slice(0, 4)
    .map((row) => byName.get(row.buildName));
  const fullCandidates = [];
  for (const build of topBuilds) {
    for (const skillMode of ["revive", "insanity"]) {
      for (const healerBuild of healerBuilds) {
        const team = createTeam({
          snapshot,
          byName,
          primaryBuild: build,
          secondaryBuild: null,
          primarySkillMode: skillMode,
          secondarySkillMode: skillMode,
          healerBuild,
          variant: "baseline",
          shieldPackageId: DEFAULT_SHIELD_PACKAGE_ID,
          crossbowSupportMode: DEFAULT_CROSSBOW_SUPPORT_MODE,
          supportVariant: "baseline",
        });
        const run = await runGuildTrial({
          snapshot,
          boss,
          members: team,
          seed: seeds[0],
        });
        fullCandidates.push({
          name:
            `baseline:${build.name}:${skillMode}` +
            `:heal=${healerBuild.name}`,
          primaryBuild: build,
          secondaryBuild: null,
          primarySkillMode: skillMode,
          secondarySkillMode: skillMode,
          healerBuild,
          variant: "baseline",
          shieldPackageId: DEFAULT_SHIELD_PACKAGE_ID,
          crossbowSupportMode: DEFAULT_CROSSBOW_SUPPORT_MODE,
          supportVariant: "baseline",
          score: score(run),
          run: compactRun(run),
        });
      }
    }
  }

  const baselineCandidates = [...fullCandidates];
  process.stdout.write(
    `  完整基线 ${baselineCandidates.length} 项完成；比较治疗/坦度配置...\n`,
  );
  fullCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.run.teamDps - left.run.teamDps ||
      left.name.localeCompare(right.name),
  );
  const preliminaryBest = fullCandidates[0];
  const secondaryCandidate =
    fullCandidates.find(
      (candidate) =>
        candidate.primaryBuild.name !== preliminaryBest.primaryBuild.name,
    ) ?? fullCandidates[1];
  const primaryBuild = preliminaryBest.primaryBuild;
  const primarySkillMode = preliminaryBest.primarySkillMode;
  const secondaryBuild = secondaryCandidate?.primaryBuild ?? null;
  const secondarySkillMode =
    secondaryCandidate?.primarySkillMode ?? primarySkillMode;
  // Healing and tank counts interact strongly with Bloom/Ripple, so these two
  // variants must be evaluated for every finalist rather than only the best
  // baseline. This prevents candidate pruning from hiding a superior weapon +
  // healer pairing.
  for (const finalist of baselineCandidates) {
    for (const variant of ["healing", "fortified"]) {
      const team = createTeam({
        snapshot,
        byName,
        primaryBuild: finalist.primaryBuild,
        secondaryBuild: null,
        primarySkillMode: finalist.primarySkillMode,
        secondarySkillMode: finalist.primarySkillMode,
        healerBuild: finalist.healerBuild,
        variant,
        shieldPackageId: finalist.shieldPackageId,
        crossbowSupportMode: finalist.crossbowSupportMode,
        supportVariant: finalist.supportVariant,
      });
      const run = await runGuildTrial({
        snapshot,
        boss,
        members: team,
        seed: seeds[0],
      });
      fullCandidates.push({
        name:
          `${variant}:${finalist.primaryBuild.name}:` +
          `${finalist.primarySkillMode}:heal=${finalist.healerBuild.name}`,
        primaryBuild: finalist.primaryBuild,
        secondaryBuild: null,
        primarySkillMode: finalist.primarySkillMode,
        secondarySkillMode: finalist.primarySkillMode,
        healerBuild: finalist.healerBuild,
        variant,
        shieldPackageId: finalist.shieldPackageId,
        crossbowSupportMode: finalist.crossbowSupportMode,
        supportVariant: finalist.supportVariant,
        score: score(run),
        run: compactRun(run),
      });
    }
  }
  for (const variant of ["lean", "mixed-top-two"]) {
    const healerBuild = preliminaryBest.healerBuild;
    const team = createTeam({
      snapshot,
      byName,
      primaryBuild,
      secondaryBuild,
      primarySkillMode,
      secondarySkillMode,
      healerBuild,
      variant,
      shieldPackageId: preliminaryBest.shieldPackageId,
      crossbowSupportMode: preliminaryBest.crossbowSupportMode,
      supportVariant: preliminaryBest.supportVariant,
    });
    const run = await runGuildTrial({
      snapshot,
      boss,
      members: team,
      seed: seeds[0],
    });
    fullCandidates.push({
      name:
        `${variant}:${primaryBuild.name}:${primarySkillMode}` +
        (variant === "mixed-top-two" && secondaryBuild
          ? `+${secondaryBuild.name}:${secondarySkillMode}`
          : "") +
        `:heal=${healerBuild.name}`,
      primaryBuild,
      secondaryBuild,
      primarySkillMode,
      secondarySkillMode,
      healerBuild,
      variant,
      shieldPackageId: preliminaryBest.shieldPackageId,
      crossbowSupportMode: preliminaryBest.crossbowSupportMode,
      supportVariant: preliminaryBest.supportVariant,
      score: score(run),
      run: compactRun(run),
    });
  }
  fullCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.run.teamDps - left.run.teamDps ||
      left.name.localeCompare(right.name),
  );
  process.stdout.write(
    "  治疗/坦度配置完成；比较减益覆盖与输出位取舍...\n",
  );
  // Compare extra support against the DPS slot it replaces. The upstream
  // event engine applies the actual hit checks, cooldown gaps and refreshes,
  // so the score captures effective debuff coverage rather than assuming
  // perfect uptime from tooltip duration alone.
  const supportSearchBases = fullCandidates.slice(0, 3);
  for (const base of supportSearchBases) {
    for (const supportVariant of [
      "debuff-fracture",
      "debuff-shred",
      "debuff-survival",
      "debuff-heavy",
    ]) {
      const team = createTeam({
        snapshot,
        byName,
        primaryBuild: base.primaryBuild,
        secondaryBuild: base.secondaryBuild,
        primarySkillMode: base.primarySkillMode,
        secondarySkillMode: base.secondarySkillMode,
        healerBuild: base.healerBuild,
        variant: base.variant,
        shieldPackageId: base.shieldPackageId,
        crossbowSupportMode: base.crossbowSupportMode,
        supportVariant,
      });
      const run = await runGuildTrial({
        snapshot,
        boss,
        members: team,
        seed: seeds[0],
      });
      fullCandidates.push({
        ...base,
        name: `${base.name}:support=${supportVariant}`,
        crossbowSupportMode: base.crossbowSupportMode,
        supportVariant,
        score: score(run),
        run: compactRun(run),
      });
    }
  }
  fullCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.run.teamDps - left.run.teamDps ||
      left.name.localeCompare(right.name),
  );
  process.stdout.write(
    "  减益覆盖配置完成；比较减益弩狂暴/狂速...\n",
  );
  const crossbowSearchBases = fullCandidates.slice(0, 3);
  for (const base of crossbowSearchBases) {
    for (const crossbowSupportMode of CROSSBOW_SUPPORT_MODES) {
      if (crossbowSupportMode === base.crossbowSupportMode) continue;
      const team = createTeam({
        snapshot,
        byName,
        primaryBuild: base.primaryBuild,
        secondaryBuild: base.secondaryBuild,
        primarySkillMode: base.primarySkillMode,
        secondarySkillMode: base.secondarySkillMode,
        healerBuild: base.healerBuild,
        variant: base.variant,
        shieldPackageId: base.shieldPackageId,
        crossbowSupportMode,
        supportVariant: base.supportVariant,
      });
      const run = await runGuildTrial({
        snapshot,
        boss,
        members: team,
        seed: seeds[0],
      });
      fullCandidates.push({
        ...base,
        name: `${base.name}:crossbow=${crossbowSupportMode}`,
        crossbowSupportMode,
        supportVariant: base.supportVariant,
        score: score(run),
        run: compactRun(run),
      });
    }
  }
  fullCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.run.teamDps - left.run.teamDps ||
      left.name.localeCompare(right.name),
  );
  process.stdout.write(
    "  减益弩配置完成；比较盾击/惩戒/狂速/荆棘方案...\n",
  );
  // The shield's damage, retaliation and survival packages interact with the
  // winning team composition. Re-evaluate the best few compositions with
  // every legal package instead of declaring Shield Bash mandatory.
  const shieldSearchBases = fullCandidates.slice(0, 3);
  for (const base of shieldSearchBases) {
    for (const shieldPackage of SHIELD_ABILITY_PACKAGES) {
      if (shieldPackage.id === base.shieldPackageId) continue;
      const team = createTeam({
        snapshot,
        byName,
        primaryBuild: base.primaryBuild,
        secondaryBuild: base.secondaryBuild,
        primarySkillMode: base.primarySkillMode,
        secondarySkillMode: base.secondarySkillMode,
        healerBuild: base.healerBuild,
        variant: base.variant,
        shieldPackageId: shieldPackage.id,
        crossbowSupportMode: base.crossbowSupportMode,
        supportVariant: base.supportVariant,
      });
      const run = await runGuildTrial({
        snapshot,
        boss,
        members: team,
        seed: seeds[0],
      });
      fullCandidates.push({
        ...base,
        name: `${base.name}:shield=${shieldPackage.id}`,
        shieldPackageId: shieldPackage.id,
        score: score(run),
        run: compactRun(run),
      });
    }
  }
  fullCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.run.teamDps - left.run.teamDps ||
      left.name.localeCompare(right.name),
  );
  const best = fullCandidates[0];
  process.stdout.write(
    `完整搜索胜出 ${boss.nameZh}: ${best.name}，层=${best.run.wavesCleared} 进度=${best.run.finalProgressPercent}%\n`,
  );
  const bestTeam = createTeam({
    snapshot,
    byName,
    primaryBuild: best.primaryBuild,
    secondaryBuild: best.secondaryBuild,
    primarySkillMode: best.primarySkillMode,
    secondarySkillMode: best.secondarySkillMode,
    healerBuild: best.healerBuild,
    variant: best.variant,
    shieldPackageId: best.shieldPackageId,
    crossbowSupportMode: best.crossbowSupportMode,
    supportVariant: best.supportVariant,
  });
  const runs = [];
  for (const seed of seeds) {
    runs.push(
      await runGuildTrial({
        snapshot,
        boss,
        members: bestTeam,
        seed,
      }),
    );
  }
  bosses.push({
    bossId: boss.hrid,
    bossName: boss.nameZh,
    selectedCandidate: best.name,
    team: summarizeTeam(bestTeam),
    debuffPlan: summarizeDebuffPlan(bestTeam),
    searchCandidates: fullCandidates.map((candidate) => ({
      name: candidate.name,
      score: candidate.score,
      run: candidate.run,
    })),
    runs: runs.map(compactRun),
    memberAverages: averageMembers(runs),
  });
}

const assignment = {
  schemaVersion: 2,
  kind: "adudu-40-clone-shykai-full-engine-lab",
  developmentOnly: true,
  promotable: false,
  sourceMember: {
    memberId: snapshot.memberId,
    displayName: snapshot.displayName,
    capturedAt: snapshot.capturedAt,
  },
  generatedAt: new Date().toISOString(),
  fixtureId: fixture.fixtureId,
  engine: {
    source: "Shykai MWICombatSimulatorTest recovered worker source",
    mode: "full-event-engine",
    mechanics: [
      "equipment-and-weapon-passives",
      "abilities-and-trigger-priority",
      "buffs-debuffs-and-expiration",
      "auras-with-skill-level-scaling",
      "healing-revive-threat-targeting",
      "boss-attacks-damage-taken-death-respawn",
      "cooldowns-mana-oom",
    ],
  },
  assumptions: {
    totalDurationSeconds: 3600,
    startLevel: 100,
    levelStepOnKill: 10,
    spawnDelaySeconds: 0,
    consumables: "disabled",
    passiveHpMpRegenFlatBonusPercent: 3,
    playerStateAcrossWaves: "preserved-by-upstream-event-engine",
    playerDeathRespawnSeconds: 150,
    unresolvedCalibration: [
      "guild-trial-level-growth-needs-lv110-lv120-panel-verification",
      "wave-transition-and-death-rules-need-live-verification",
      "guild-shrine-buffs-not-in-source-snapshot",
    ],
  },
  screening,
  bosses,
};
assignment.summaryText = formatSummary(assignment);
await writeFile(outputPath, `${JSON.stringify(assignment, null, 2)}\n`, "utf8");

const createdAt = new Date().toISOString();
const inserted = db
  .prepare(
    "INSERT INTO assignments (guild_id, kind, locked, created_at, payload_json) VALUES (?, 'test', 0, ?, ?)",
  )
  .run(guildId, createdAt, JSON.stringify(assignment));

process.stdout.write(
  `${JSON.stringify(
    {
      savedAssignmentId: Number(inserted.lastInsertRowid),
      outputPath,
      summaryText: assignment.summaryText,
    },
    null,
    2,
  )}\n`,
);

function createTeam({
  snapshot,
  byName,
  primaryBuild,
  secondaryBuild,
  primarySkillMode,
  secondarySkillMode,
  healerBuild,
  variant,
  shieldPackageId = DEFAULT_SHIELD_PACKAGE_ID,
  crossbowSupportMode = DEFAULT_CROSSBOW_SUPPORT_MODE,
  supportVariant = "baseline",
}) {
  const shield = requiredBuild(byName, "迷宫盾");
  const nature = requiredBuild(byName, "自然", "迷宫自然");
  const healer = healerBuild ?? nature;
  const spear = requiredBuild(byName, "枪", "迷宫枪");
  const crossbow = requiredBuild(byName, "弩", "迷宫弩");
  const hammer = requiredBuild(byName, "公会", "锤子", "迷宫锤");
  const sword = requiredBuild(byName, "迷宫剑");
  const water = requiredBuild(byName, "迷宫水");
  const fire = requiredBuild(byName, "迷宫火");
  const members = [
    member(
      snapshot,
      shield,
      `坦克·守护·${shieldPackageNameZh(shieldPackageId)}`,
      "tank",
      shieldAbilityNames("guardian_aura", shieldPackageId),
    ),
    member(
      snapshot,
      shield,
      `坦克·速度·${shieldPackageNameZh(shieldPackageId)}`,
      "tank",
      shieldAbilityNames("speed_aura", shieldPackageId),
    ),
    member(
      snapshot,
      healer,
      healerLabel("治疗·元素", healer),
      "healer",
      healerAbilityNames(healer, "mystic_aura", equipmentDetail),
    ),
    member(
      snapshot,
      healer,
      healerLabel("治疗·群疗", healer),
      "healer",
      healerAbilityNames(healer, "revive", equipmentDetail),
    ),
    member(
      snapshot,
      healer,
      healerLabel("治疗·群疗", healer),
      "healer",
      healerAbilityNames(healer, "revive", equipmentDetail),
    ),
    member(snapshot, spear, "减益·破甲枪", "debuffer", [
      "fierce_aura",
      "frenzy",
      "berserk",
      "puncture",
      "penetrating_strike",
    ]),
    member(
      snapshot,
      crossbow,
      "减益·腐蚀弩",
      "debuffer",
      crossbowDebufferAbilityNames("critical_aura", crossbowSupportMode),
    ),
    member(
      snapshot,
      hammer,
      "减益·碎裂锤",
      "debuffer",
      HAMMER_DEBUFFER_ABILITIES,
    ),
    member(
      snapshot,
      sword,
      "减益·重伤剑",
      "debuffer",
      SWORD_DEBUFFER_ABILITIES,
    ),
    member(snapshot, nature, "减益·毒粉", "debuffer", [
      "revive",
      "elemental_affinity",
      "toxic_pollen",
      "natures_veil",
      "entangle",
    ]),
    member(snapshot, water, "减益·冰控", "debuffer", [
      "revive",
      "elemental_affinity",
      "frost_surge",
      "ice_spear",
      "water_strike",
    ]),
    member(snapshot, fire, "减益·烟雾", "debuffer", [
      "revive",
      "elemental_affinity",
      "smoke_burst",
      "fireball",
      "flame_blast",
    ]),
  ];

  if (variant === "lean") {
    // Keep the five unique aura carriers and every distinct debuff source.
    // The lean variant removes only one duplicate non-aura healer.
    members.splice(4, 1);
  }
  if (variant === "healing" || variant === "fortified") {
    members.push(
      member(
        snapshot,
        healer,
        healerLabel("治疗·追加", healer),
        "healer",
        healerAbilityNames(healer, "revive", equipmentDetail),
      ),
      member(
        snapshot,
        healer,
        healerLabel("治疗·追加", healer),
        "healer",
        healerAbilityNames(healer, "revive", equipmentDetail),
      ),
    );
  }
  if (variant === "fortified") {
    members.push(
      member(
        snapshot,
        shield,
        `坦克·追加·${shieldPackageNameZh(shieldPackageId)}`,
        "tank",
        shieldAbilityNames("revive", shieldPackageId),
      ),
    );
  }
  if (
    supportVariant === "debuff-fracture" ||
    supportVariant === "debuff-heavy"
  ) {
    members.push(
      member(
        snapshot,
        hammer,
        "减益·碎裂追加",
        "debuffer",
        HAMMER_DEBUFFER_ABILITIES,
      ),
    );
  }
  if (
    supportVariant === "debuff-shred" ||
    supportVariant === "debuff-heavy"
  ) {
    members.push(
      member(snapshot, spear, "减益·破甲追加", "debuffer", [
        "revive",
        "precision",
        "frenzy",
        "puncture",
        "penetrating_strike",
      ]),
      member(snapshot, crossbow, "减益·腐蚀追加", "debuffer", [
        ...crossbowDebufferAbilityNames("revive", crossbowSupportMode),
      ]),
    );
  }
  if (
    supportVariant === "debuff-survival" ||
    supportVariant === "debuff-heavy"
  ) {
    members.push(
      member(
        snapshot,
        sword,
        "减益·重伤追加",
        "debuffer",
        SWORD_DEBUFFER_ABILITIES,
      ),
      member(snapshot, fire, "减益·烟雾追加", "debuffer", [
        "revive",
        "precision",
        "elemental_affinity",
        "smoke_burst",
        "fireball",
      ]),
    );
  }

  let index = 0;
  while (members.length < 40) {
    const useSecondary =
      variant === "mixed-top-two" && secondaryBuild && index % 2 === 1;
    const build = useSecondary ? secondaryBuild : primaryBuild;
    members.push(
      member(
        snapshot,
        build,
        `输出·${build.name}`,
        "dps",
      dpsAbilityNames(
        build,
        useSecondary ? secondarySkillMode : primarySkillMode,
      ),
      ),
    );
    index += 1;
  }
  if (members.length !== 40) {
    throw new Error(`Team construction produced ${members.length} members`);
  }
  assertUniqueAuraCoverage(members);
  return members;
}

function member(snapshot, build, label, role, abilityNames) {
  return buildPlayerMember({
    build,
    label,
    role,
    abilities: abilityNames.map((name) =>
      defaultAbility(`/abilities/${name}`, snapshot.learnedAbilities),
    ),
  });
}

function dpsAbilityNames(build, skillMode = "revive") {
  const weapon = weaponFor(build);
  const stats = weapon.equipmentDetail.combatStats;
  const style = stats.combatStyleHrids[0];
  const damageType = stats.damageType;
  const focus = skillMode === "insanity" ? "insanity" : "precision";
  if (style.endsWith("/stab")) {
    if (skillMode === "insanity") {
      return [
        "insanity",
        "precision",
        "frenzy",
        "berserk",
        "penetrating_strike",
      ];
    }
    return [
      "revive",
      "frenzy",
      "berserk",
      focus,
      "penetrating_strike",
    ];
  }
  if (style.endsWith("/slash")) {
    if (skillMode === "insanity") {
      return ["insanity", "precision", "frenzy", "berserk", "maim"];
    }
    return ["revive", "frenzy", "berserk", focus, "maim"];
  }
  if (style.endsWith("/smash")) {
    if (weapon.equipmentDetail.type === "/equipment_types/two_hand") {
      return [
        "revive",
        "provoke",
        "toughness",
        "spike_shell",
        "shield_bash",
      ];
    }
    if (skillMode === "insanity") {
      return [
        "insanity",
        "precision",
        "frenzy",
        "berserk",
        "fracturing_impact",
      ];
    }
    return [
      "revive",
      "frenzy",
      "berserk",
      focus,
      "fracturing_impact",
    ];
  }
  if (style.endsWith("/ranged")) {
    if (skillMode === "insanity") {
      return [
        "insanity",
        "precision",
        "frenzy",
        "berserk",
        "steady_shot",
      ];
    }
    return [
      "revive",
      "frenzy",
      "berserk",
      focus,
      "steady_shot",
    ];
  }
  if (damageType.endsWith("/nature")) {
    if (skillMode === "insanity") {
      return [
        "insanity",
        "precision",
        "elemental_affinity",
        "natures_veil",
        "entangle",
      ];
    }
    return [
      "revive",
      "elemental_affinity",
      focus,
      "natures_veil",
      "entangle",
    ];
  }
  if (damageType.endsWith("/water")) {
    if (skillMode === "insanity") {
      return [
        "insanity",
        "precision",
        "elemental_affinity",
        "ice_spear",
        "water_strike",
      ];
    }
    return [
      "revive",
      "elemental_affinity",
      focus,
      "ice_spear",
      "water_strike",
    ];
  }
  if (skillMode === "insanity") {
    return [
      "insanity",
      "precision",
      "elemental_affinity",
      "smoke_burst",
      "fireball",
    ];
  }
  return [
    "revive",
    "elemental_affinity",
    focus,
    "smoke_burst",
    "fireball",
  ];
}

function weaponFor(build) {
  const weapon = build.equipment
    .map((entry) => equipmentDetail(entry.itemHrid))
    .find((item) =>
      ["/equipment_types/main_hand", "/equipment_types/two_hand"].includes(
        item?.equipmentDetail?.type,
      ),
    );
  if (!weapon) throw new Error(`Build has no weapon: ${build.name}`);
  return weapon;
}

function requiredBuild(byName, ...names) {
  for (const name of names) {
    const build = byName.get(name);
    if (build) return build;
  }
  throw new Error(`Required build not found: ${names.join("/")}`);
}

function uniqueBuilds(buildRows) {
  return [
    ...new Map(buildRows.map((build) => [build.sourceLoadoutId, build])).values(),
  ];
}

function healerLabel(prefix, build) {
  const policy = healerWeaponPolicy(build, equipmentDetail);
  const suffix =
    policy?.stat === "bloom"
      ? "绽放·缠绕"
      : policy?.stat === "ripple"
        ? "涟漪·流水冲击"
        : "未知武器";
  return `${prefix}·${suffix}`;
}

function assertUniqueAuraCoverage(members) {
  for (const member of members) {
    if (member.abilities.length > 5) {
      throw new Error(`${member.label} has more than five abilities`);
    }
    const specialIndexes = member.abilities
      .map((ability, index) =>
        abilityDetail(ability.abilityHrid)?.isSpecialAbility ? index : -1,
      )
      .filter((index) => index >= 0);
    if (specialIndexes.length !== 1 || specialIndexes[0] !== 0) {
      throw new Error(
        `${member.label} must have exactly one slot-1 special/aura ability`,
      );
    }
  }
  for (const aura of [
    "speed_aura",
    "guardian_aura",
    "fierce_aura",
    "critical_aura",
    "mystic_aura",
  ]) {
    const count = members.filter((member) =>
      member.abilities.some(
        (ability) => ability.abilityHrid === `/abilities/${aura}`,
      ),
    ).length;
    if (count !== 1) {
      throw new Error(`Aura ${aura} must have exactly one carrier, got ${count}`);
    }
  }
}

function summarizeDebuffPlan(team) {
  const trackedAbilities = [
    "puncture",
    "pestilent_shot",
    "fracturing_impact",
    "maim",
    "crippling_slash",
    "toxic_pollen",
    "frost_surge",
    "smoke_burst",
  ];
  return trackedAbilities.map((abilityName) => {
    const abilityHrid = `/abilities/${abilityName}`;
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

function score(run) {
  const progress =
    run.finalMonsterMaxHp > 0
      ? 1 - run.finalMonsterHp / run.finalMonsterMaxHp
      : 0;
  return run.wavesCleared + progress;
}

function compactRun(run) {
  const progress =
    run.finalMonsterMaxHp > 0
      ? (1 - run.finalMonsterHp / run.finalMonsterMaxHp) * 100
      : 0;
  return {
    seed: run.seed,
    wavesCleared: run.wavesCleared,
    finalMonsterLevel: run.finalMonsterLevel,
    finalMonsterHp: run.finalMonsterHp,
    finalMonsterMaxHp: run.finalMonsterMaxHp,
    finalProgressPercent: Number(progress.toFixed(2)),
    teamDps: Number(run.teamDps.toFixed(2)),
    totalDeaths: run.totalDeaths,
    oomMembers: run.oomMembers,
  };
}

function summarizeTeam(team) {
  return {
    roles: count(team, (member) => member.role),
    builds: count(team, (member) => member.build.name),
    templates: [
      ...new Map(
        team.map((member) => [
          member.label,
          {
            label: member.label,
            role: member.role,
            buildName: member.build.name,
            abilities: member.abilities.map((ability) => ({
              hrid: ability.abilityHrid,
              level: ability.level,
            })),
          },
        ]),
      ).values(),
    ],
  };
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
      };
      row.damageDone += member.damageDone;
      row.damageTaken += member.damageTaken;
      row.healing += member.healing;
      row.deaths += member.deaths;
      row.oomRuns += member.ranOutOfMana ? 1 : 0;
      byMember.set(member.memberId, row);
    }
  }
  return [...byMember.values()].map((row) => ({
    memberId: row.memberId,
    label: row.label,
    role: row.role,
    averageDps: Number((row.damageDone / runs.length / 3600).toFixed(2)),
    averageDamageTaken: Number(
      (row.damageTaken / runs.length).toFixed(2),
    ),
    averageHealing: Number((row.healing / runs.length).toFixed(2)),
    totalDeaths: row.deaths,
    oomRuns: row.oomRuns,
  }));
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
  return Object.entries(row)
    .map(([key, value]) => `${key}×${value}`)
    .join("、");
}

function formatSummary(assignment) {
  const lines = [
    "adudu 40复制人测试（Shykai 完整事件引擎，不可转正）",
    "已计入：装备/武器被动、技能与触发器、Buff/Debuff、光环、治疗/复活、仇恨、Boss攻击、承伤/死亡、CD/MP/空蓝。",
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
      `【${boss.bossName}】3次：通过${Math.min(...layers)}-${Math.max(...layers)}层，末层平均${averageProgress.toFixed(1)}%，团队DPS≈${Math.round(averageDps)}`,
      `方案：${boss.selectedCandidate}`,
      `职业：${formatCounts(boss.team.roles)}`,
      `装备：${formatCounts(boss.team.builds)}`,
      `死亡：${Math.min(...deaths)}-${Math.max(...deaths)}；空蓝人数：${Math.min(...oom)}-${Math.max(...oom)}`,
    );
  }
  lines.push(
    "仍为测试结果：Lv.110/120成长、换层状态和试炼死亡规则尚需实测校准；公会神殿加成尚未采集。",
  );
  return lines.join("\n");
}

async function readText(filePath) {
  return readFile(filePath, "utf8");
}
