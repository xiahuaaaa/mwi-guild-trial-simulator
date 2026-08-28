import type {
  AuraType,
  BotImage,
  ChatKind,
  CombatType,
} from "./types.ts";

export type ServiceResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "unavailable" | "conflict" | "not-found" | "invalid";
      message: string;
    };

export interface ServiceContent {
  text: string;
  images?: BotImage[];
  /**
   * Optional private-only five-skill details returned with test artifacts.
   */
  skillDetailImages?: BotImage[];
}

export interface SimulationAvailability {
  available: boolean;
  reason?: string;
}

export interface PluginArtifact {
  version: string;
  installUrl: string;
  fileName: string;
  /** Local path, file://, or http(s):// URI for the transport upload action. */
  file: string;
}

export interface CombatBinding {
  characterName: string;
  qqUserId: string;
  combatType: CombatType;
}

/**
 * Central API boundary. Implementations call HTTP/RPC endpoints; the command
 * core must never import a database client or repository.
 */
export interface CommandServicePort {
  // Read-only queries. These methods must return stored/current data and must
  // never start optimization or mutate assignment state.
  getLockedOfficialAssignment(): Promise<ServiceResult<ServiceContent>>;
  getGuildBottleneck(): Promise<ServiceResult<ServiceContent>>;
  getProfessionDistribution(): Promise<ServiceResult<ServiceContent>>;
  getGuildRoster(): Promise<ServiceResult<ServiceContent>>;
  getUnregisteredTrialMembers(): Promise<ServiceResult<ServiceContent>>;
  /** Actual trial signups vs latest life/combat simulated assignment rosters. */
  getSignupAssignmentMismatches(): Promise<ServiceResult<ServiceContent>>;
  getAuraAssignment(): Promise<ServiceResult<ServiceContent>>;
  getGuildBosses(): Promise<ServiceResult<ServiceContent>>;
  getPluginInstallInfo(): Promise<ServiceResult<ServiceContent>>;
  getLatestPluginArtifact(): Promise<ServiceResult<PluginArtifact>>;
  getLifeTrials(): Promise<ServiceResult<ServiceContent>>;
  generateLifeAssignment(): Promise<ServiceResult<ServiceContent>>;
  /** Stored formal life assignment summary + latest rendered PNG. */
  getLatestLifeAssignment(): Promise<ServiceResult<ServiceContent>>;
  simulateLifeTrial(input: {
    trialToken: string;
    memberIds: string[];
  }): Promise<ServiceResult<ServiceContent>>;
  startTestLifeAssignment(input: {
    requestedBy: string;
    excludedCharacterNames: string[];
  }): Promise<ServiceResult<ServiceContent>>;
  getGuildProfessionReport(): Promise<ServiceResult<ServiceContent>>;
  getAssignmentProgress(): Promise<ServiceResult<ServiceContent>>;
  getOptimizationAudit(): Promise<ServiceResult<ServiceContent>>;
  getUnavailableRoster(): Promise<ServiceResult<ServiceContent>>;
  /** Available combat roster whose main weapon enhancement is below ★+12. */
  getEquipmentCheck(): Promise<ServiceResult<ServiceContent>>;
  /** Text summary + rendered weekly images (本周分工 = 生活 + 战斗). */
  getLatestCombatAssignment(): Promise<ServiceResult<ServiceContent>>;
  getSkillRecommendation(userId: string): Promise<ServiceResult<ServiceContent>>;
  getMissingUploads(groupMemberNames?: string[]): Promise<ServiceResult<ServiceContent>>;
  getExpiredUploads(): Promise<ServiceResult<ServiceContent>>;

  getProductionSimulationAvailability(): Promise<SimulationAvailability>;
  getTestSimulationAvailability(): Promise<SimulationAvailability>;

  // Official and test state have intentionally separate endpoints.
  startOfficialAssignment(input: {
    requestedBy: string;
    exhaustive: boolean;
  }): Promise<ServiceResult<ServiceContent>>;
  startTestAssignment(input: {
    requestedBy: string;
    excludedCharacterNames: string[];
    chatKind: ChatKind;
    groupId?: string;
  }): Promise<ServiceResult<ServiceContent>>;
  stopActiveAssignment(input: {
    requestedBy: string;
  }): Promise<ServiceResult<ServiceContent>>;
  simulateLockedOfficialAssignment(input: {
    requestedBy: string;
    runsPerBoss: 3;
  }): Promise<ServiceResult<ServiceContent>>;
  promoteLatestTestWithoutSimulation(input: {
    requestedBy: string;
  }): Promise<ServiceResult<ServiceContent>>;

  isCurrentGuildMember(
    characterName: string,
  ): Promise<ServiceResult<{ current: boolean; canonicalName: string }>>;
  getCombatBindingsForUser(
    qqUserId: string,
  ): Promise<ServiceResult<CombatBinding[]>>;
  bindCombat(input: {
    requestedBy: string;
    characterName: string;
    qqUserId: string;
    combatType: CombatType;
  }): Promise<ServiceResult<ServiceContent>>;
  unbindCombat(input: {
    requestedBy: string;
    characterName: string;
  }): Promise<ServiceResult<ServiceContent>>;
  rebindCombat(input: {
    requestedBy: string;
    characterName: string;
    qqUserId: string;
    combatType: CombatType;
  }): Promise<ServiceResult<ServiceContent>>;
  setAura(input: {
    requestedBy: string;
    characterName: string;
    auraType: AuraType;
    level: number;
  }): Promise<ServiceResult<ServiceContent>>;
}
