export type SnapshotSource =
  | "wandering-earth"
  | "cyber-beggar"
  | "tys"
  | "manual";

export type SnapshotFreshness = "fresh" | "stale" | "expired";

export type SnapshotConfidence =
  | "simulation-ready"
  | "current-loadout-only"
  | "capability-only"
  | "estimated";

export interface EquipmentItem {
  locationHrid: string;
  itemHrid: string;
  enhancementLevel: number;
}

export interface CombatTrigger {
  dependencyHrid: string;
  conditionHrid: string;
  comparatorHrid: string;
  value: number;
}

export interface CombatAbility {
  slot: number;
  abilityHrid: string;
  level: number;
  triggers: CombatTrigger[];
}

export interface ApprovedCombatBuild {
  buildId: string;
  sourceLoadoutId?: number;
  name: string;
  approvedByMember: boolean;
  capturedAt: string;
  equipment: EquipmentItem[];
  abilities: CombatAbility[];
  weapon?: EquipmentItem;
  simulationReady: boolean;
  issues: string[];
}

export interface SavedLoadout {
  sourceLoadoutId?: number;
  name: string;
  category: "combat" | "profession" | "unknown";
  actionTypeHrid: string;
  equipment: EquipmentItem[];
  abilities: CombatAbility[];
  issues: string[];
}

export interface MemberCapabilitySnapshotV2 {
  schemaVersion: "2";
  memberId: string;
  displayName: string;
  guildId: string;
  capturedAt: string;
  source: SnapshotSource;
  sourceSchemaVersion: string;
  sourceRevision?: string;
  sourceFingerprint: string;
  freshness: SnapshotFreshness;
  confidence: SnapshotConfidence;
  skills: Record<string, number>;
  learnedAbilities: Record<string, number>;
  auras: Record<string, number>;
  houseRooms?: Record<string, number>;
  achievements?: Record<string, boolean>;
  shrines?: Record<string, number>;
  permanentBuffsCaptured?: boolean;
  loadoutCatalog?: SavedLoadout[];
  approvedBuilds: ApprovedCombatBuild[];
  currentBuild?: ApprovedCombatBuild;
  participation: {
    eligibleBossHrids: string[];
    preferredBossHrids: string[];
    maxBossAssignments: number;
    allowRoleChange: boolean;
    allowSkillChange: boolean;
  };
  issues: string[];
}

export interface AdapterOptions {
  now?: string | Date;
  capturedAt?: string;
  eligibleBossHrids?: string[];
  preferredBossHrids?: string[];
  maxBossAssignments?: number;
  allowRoleChange?: boolean;
  allowSkillChange?: boolean;
}
