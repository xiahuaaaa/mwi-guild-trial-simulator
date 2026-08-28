export interface ShykaiTriggerDto {
  readonly dependencyHrid: string;
  readonly conditionHrid: string;
  readonly comparatorHrid: string;
  readonly value: number;
}

export interface ShykaiAbilityDto {
  readonly hrid: string;
  readonly level: number;
  readonly triggers: readonly ShykaiTriggerDto[];
}

export interface ShykaiConsumableDto {
  readonly hrid: string;
  readonly triggers: readonly ShykaiTriggerDto[];
}

export interface ShykaiEquipmentDto {
  readonly hrid: string;
  readonly enhancementLevel?: number;
  readonly [field: string]: unknown;
}

export interface ShykaiPlayerDto {
  readonly hrid: string;
  readonly staminaLevel: number;
  readonly intelligenceLevel: number;
  readonly attackLevel: number;
  readonly meleeLevel: number;
  readonly defenseLevel: number;
  readonly rangedLevel: number;
  readonly magicLevel: number;
  readonly equipment: Readonly<Record<string, ShykaiEquipmentDto | null>>;
  readonly food: readonly (ShykaiConsumableDto | null)[];
  readonly drinks: readonly (ShykaiConsumableDto | null)[];
  readonly abilities: readonly (ShykaiAbilityDto | null)[];
  readonly houseRooms: Readonly<Record<string, number>>;
  readonly achievements: Readonly<Record<string, number>>;
  readonly debuffOnLevelGap: number;
}

export interface SanitizedGuildTrialPlayerDto extends ShykaiPlayerDto {
  readonly food: readonly [];
  readonly drinks: readonly [];
}
