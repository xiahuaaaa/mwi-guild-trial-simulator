import type { MemberCapabilitySnapshotV2 } from "../../mwi-adapter/src/model.ts";
import type {
  BuildCandidate,
  CandidateGenerationOptions,
  CombatRole,
  OffensiveDamageType,
  OffensiveStyle,
  OptimizerBoss,
} from "./model.ts";

const HEALING_ABILITIES = new Set([
  "/abilities/rejuvenate",
  "/abilities/quick_aid",
  "/abilities/heal",
  "/abilities/minor_heal",
]);

const TANK_ABILITIES = new Set([
  "/abilities/provoke",
  "/abilities/taunt",
  "/abilities/toughness",
  "/abilities/guardian_aura",
  "/abilities/spike_shell",
]);

function weaponProfile(itemHrid: string): {
  role?: CombatRole;
  style: OffensiveStyle;
  damageType: OffensiveDamageType;
} {
  const id = itemHrid.toLowerCase();
  if (id.includes("griffin_bulwark") || id.includes("shield")) {
    return { role: "tank", style: "smash", damageType: "physical" };
  }
  if (id.includes("blooming_trident")) {
    return { role: "healer", style: "magic", damageType: "nature" };
  }
  if (id.includes("blazing") || id.includes("fire_staff")) {
    return { style: "magic", damageType: "fire" };
  }
  if (id.includes("rippling") || id.includes("water_staff")) {
    return { style: "magic", damageType: "water" };
  }
  if (id.includes("nature_staff")) {
    return { style: "magic", damageType: "nature" };
  }
  if (id.includes("bow") || id.includes("crossbow")) {
    return { style: "ranged", damageType: "physical" };
  }
  if (id.includes("spear") || id.includes("rapier")) {
    return { style: "stab", damageType: "physical" };
  }
  if (id.includes("flail") || id.includes("hammer") || id.includes("mace")) {
    return { style: "smash", damageType: "physical" };
  }
  return { style: "slash", damageType: "physical" };
}

function matchesBoundCombatType(itemHrid: string, combatType: string): boolean {
  const id = itemHrid.toLowerCase();
  const patterns: Record<string, RegExp> = {
    弓: /bow(?!.*crossbow)/,
    弩: /crossbow/,
    火: /fire|blazing/,
    水: /water|rippling/,
    自: /nature|blooming/,
    盾: /shield|bulwark/,
    枪: /spear/,
    剑: /sword|rapier/,
    锤: /hammer|flail|mace/,
  };
  return patterns[combatType]?.test(id) ?? false;
}

function candidateBuilds(
  member: MemberCapabilitySnapshotV2,
  options: CandidateGenerationOptions,
) {
  const combatType = options.memberCombatTypes?.[member.memberId];
  if (!combatType) return member.approvedBuilds;
  return (member.loadoutCatalog ?? []).flatMap((loadout, index) => {
    if (loadout.category !== "combat" || loadout.issues.length || !loadout.equipment.length) return [];
    const weapon = loadout.equipment.find((item) =>
      item.locationHrid.includes("main_hand")
      || item.locationHrid.includes("weapon")
    ) ?? loadout.equipment[0];
    if (!weapon || !matchesBoundCombatType(weapon.itemHrid, combatType)) return [];
    return [{
      buildId: `catalog:${loadout.sourceLoadoutId ?? index + 1}`,
      ...(loadout.sourceLoadoutId == null ? {} : { sourceLoadoutId: loadout.sourceLoadoutId }),
      name: loadout.name,
      approvedByMember: true,
      capturedAt: member.capturedAt,
      equipment: loadout.equipment,
      abilities: loadout.abilities,
      weapon,
      simulationReady: true,
      issues: [],
    }];
  });
}

function classifyRole(
  weaponRole: CombatRole | undefined,
  abilityHrids: string[],
  damageType: OffensiveDamageType,
): CombatRole {
  if (weaponRole) return weaponRole;
  if (abilityHrids.some((hrid) => HEALING_ABILITIES.has(hrid))) return "healer";
  if (abilityHrids.some((hrid) => TANK_ABILITIES.has(hrid))) return "tank";
  const auraCount = abilityHrids.filter((hrid) => hrid.endsWith("_aura")).length;
  if (auraCount >= 2) return "support";
  return damageType === "physical" ? "physicalDps" : "magicDps";
}

function heuristicScore(
  boss: OptimizerBoss,
  style: OffensiveStyle,
  damageType: OffensiveDamageType,
  member: MemberCapabilitySnapshotV2,
): number {
  const avoidance = boss.evasion[style] ?? 0;
  const mitigation = damageType === "physical"
    ? boss.armor
    : boss.resistance[damageType];
  const relevantSkill = style === "magic"
    ? member.skills["/skills/magic"]
    : style === "ranged"
      ? member.skills["/skills/ranged"]
      : member.skills["/skills/attack"];
  const skillFactor = 1 + Math.max(0, relevantSkill ?? 0) / 1000;

  // This is deliberately only a pruning heuristic. The combat engine, not
  // this formula, decides the final ordering.
  return Number((
    10_000
    * skillFactor
    / (1_000 + avoidance + mitigation)
  ).toFixed(6));
}

function coverageTags(
  role: CombatRole,
  abilityHrids: string[],
  options: CandidateGenerationOptions,
): string[] {
  const tags = new Set<string>([`role:${role}`]);
  for (const abilityHrid of abilityHrids) {
    if (abilityHrid.endsWith("_aura")) tags.add(`aura:${abilityHrid}`);
    if (HEALING_ABILITIES.has(abilityHrid)) tags.add("capability:healing");
    if (TANK_ABILITIES.has(abilityHrid)) tags.add("capability:tanking");
    for (const effect of options.abilityEffectTags?.[abilityHrid] ?? []) {
      tags.add(`effect:${effect}`);
    }
  }
  return [...tags].sort();
}

export function generateBuildCandidates(
  members: MemberCapabilitySnapshotV2[],
  bosses: OptimizerBoss[],
  options: CandidateGenerationOptions = {},
): BuildCandidate[] {
  const result: BuildCandidate[] = [];
  for (const member of members) {
    if (member.freshness === "expired") continue;
    if (member.participation.maxBossAssignments < 1) continue;
    for (const build of candidateBuilds(member, options)) {
      if (!build.approvedByMember || !build.simulationReady || !build.weapon) continue;
      const profile = weaponProfile(build.weapon.itemHrid);
      const abilityHrids = build.abilities.map((ability) => ability.abilityHrid);
      const role = classifyRole(profile.role, abilityHrids, profile.damageType);
      for (const boss of bosses) {
        if (
          member.participation.eligibleBossHrids.length
          && !member.participation.eligibleBossHrids.includes(boss.hrid)
        ) continue;
        result.push({
          candidateId: `${member.memberId}:${boss.hrid}:${build.buildId}`,
          memberId: member.memberId,
          bossHrid: boss.hrid,
          buildId: build.buildId,
          build,
          role,
          style: profile.style,
          damageType: profile.damageType,
          coverageTags: coverageTags(role, abilityHrids, options),
          heuristicScore: heuristicScore(
            boss,
            profile.style,
            profile.damageType,
            member,
          ),
          heuristicOnly: true,
        });
      }
    }
  }
  return result.sort((left, right) =>
    left.memberId.localeCompare(right.memberId)
    || left.bossHrid.localeCompare(right.bossHrid)
    || right.heuristicScore - left.heuristicScore
    || left.candidateId.localeCompare(right.candidateId)
  );
}
