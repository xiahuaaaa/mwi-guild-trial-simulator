import type {
  ApprovedCombatBuild,
  MemberCapabilitySnapshotV2,
} from "../../mwi-adapter/src/model.ts";

export type CombatRole =
  | "tank"
  | "healer"
  | "support"
  | "physicalDps"
  | "magicDps";

export type OffensiveStyle = "stab" | "slash" | "smash" | "ranged" | "magic";
export type OffensiveDamageType = "physical" | "water" | "nature" | "fire";

export interface OptimizerBoss {
  hrid: string;
  name: string;
  evasion: Record<OffensiveStyle, number>;
  armor: number;
  resistance: Record<"water" | "nature" | "fire", number>;
  capacity: number;
}

export interface BuildCandidate {
  candidateId: string;
  memberId: string;
  bossHrid: string;
  buildId: string;
  build: ApprovedCombatBuild;
  role: CombatRole;
  style: OffensiveStyle;
  damageType: OffensiveDamageType;
  coverageTags: string[];
  heuristicScore: number;
  heuristicOnly: true;
}

export interface CandidateGenerationOptions {
  abilityEffectTags?: Record<string, string[]>;
  memberCombatTypes?: Record<string, string>;
}

export interface CoverageRequirement {
  tag: string;
  minimumProviders: number;
  minimumUptime: number;
  critical: boolean;
}

export interface BossTeamConstraint {
  bossHrid: string;
  capacity: number;
  minimumMembers: number;
  minimumTanks: number;
  minimumHealers: number;
  coverage: CoverageRequirement[];
}

export interface TeamAssignment {
  bossHrid: string;
  candidates: BuildCandidate[];
  heuristicScore: number;
  coverageProviders: Record<string, string[]>;
  issues: string[];
}

export interface InitialAssignmentResult {
  phase: "initial-feasible-assignment";
  feasible: boolean;
  teams: TeamAssignment[];
  unassignedMemberIds: string[];
  objective: {
    weakerTeamScore: number;
    totalScore: number;
  };
  warnings: string[];
}

export interface CandidateSource {
  member: MemberCapabilitySnapshotV2;
  builds: ApprovedCombatBuild[];
}
