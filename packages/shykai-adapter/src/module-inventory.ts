export interface ShykaiModuleInventoryEntry {
  readonly upstreamPath: string;
  readonly upstreamSha256: string;
  readonly adapterPath: string;
  readonly status: "ported-subset" | "interface-only" | "blocked";
  readonly pending: readonly string[];
}

export const SHYKAI_MODULE_INVENTORY: readonly ShykaiModuleInventoryEntry[] = [
  {
    upstreamPath: "src/combatsimulator/combatUtilities.js",
    upstreamSha256:
      "806c4e64153a590c918dfccd9c6e8abf5ae3aaf92ff57cb232a8746cd580ca12",
    adapterPath: "src/combat-utilities.ts",
    status: "ported-subset",
    pending: ["ability effects", "thorns", "retaliation", "lifesteal", "mana leech"],
  },
  {
    upstreamPath: "src/combatsimulator/player.js",
    upstreamSha256:
      "9f8e5c02ec583f4d093d634c544b83c755143dea54d53ca2d6d6f1565a614ef1",
    adapterPath: "src/player.ts",
    status: "interface-only",
    pending: ["equipment data lookup", "CombatUnit stat recomputation"],
  },
  {
    upstreamPath: "src/combatsimulator/monster.js",
    upstreamSha256:
      "0c9e74545a038a80a91a6c2c7e764499cdfd188a31cd44eac07fa2974174e345",
    adapterPath: "src/monster.ts",
    status: "ported-subset",
    pending: ["CombatUnit stat recomputation", "current trial monster data"],
  },
  {
    upstreamPath: "src/combatsimulator/ability.js",
    upstreamSha256:
      "cc8c07cc7c883eeb1acca8dacf2e2b864027c7b42a75e9e2872d6377a2ea1c43",
    adapterPath: "src/ability.ts",
    status: "ported-subset",
    pending: ["current ability data map", "event execution"],
  },
  {
    upstreamPath: "src/combatsimulator/buff.js",
    upstreamSha256:
      "33d6ac40fa568f9d7047c4b76b4cd689e7e50b432faae1d8b665a466966d28eb",
    adapterPath: "src/buff.ts",
    status: "ported-subset",
    pending: ["buff lifecycle integration"],
  },
  {
    upstreamPath: "src/combatsimulator/trigger.js",
    upstreamSha256:
      "c2d4ff1e445c09d0d83813346296b9bd958c485a71f6a71e0e1c5b6636744601",
    adapterPath: "src/trigger.ts",
    status: "ported-subset",
    pending: ["full buff-condition catalog", "multi-target aggregate conditions"],
  },
] as const;
