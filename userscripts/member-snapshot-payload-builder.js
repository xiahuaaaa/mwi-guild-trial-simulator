/**
 * MIT License
 * Copyright (c) 2026 MWI Guild Trial Simulator contributors
 *
 * Small, dependency-free data boundary for the local candidate-loadout exporter.
 * It deliberately accepts only the fields needed by MemberCapabilitySnapshotV2.
 */
(function exposeMemberSnapshotPayloadBuilder(root) {
  "use strict";

  const MAX_BUILDS = 4;
  const SENSITIVE_KEY = /(?:token|authorization|cookie|secret|password|credential|session|gm_)/i;
  const CONSUMABLE = /(?:food|drink|consumable|potion)/i;
  const HOUSE_ROOM_HRIDS = new Set([
    "/house_rooms/archery_range", "/house_rooms/armory", "/house_rooms/brewery", "/house_rooms/dairy_barn",
    "/house_rooms/dining_room", "/house_rooms/dojo", "/house_rooms/forge", "/house_rooms/garden",
    "/house_rooms/gym", "/house_rooms/kitchen", "/house_rooms/laboratory", "/house_rooms/library",
    "/house_rooms/log_shed", "/house_rooms/mystical_study", "/house_rooms/observatory",
    "/house_rooms/sewing_parlor", "/house_rooms/workshop",
  ]);
  const ACHIEVEMENT_HRIDS = new Set([
    "/achievements/bestiary_points_100", "/achievements/bestiary_points_20", "/achievements/bestiary_points_200",
    "/achievements/bestiary_points_40", "/achievements/bestiary_points_400", "/achievements/brew_gourmet_tea",
    "/achievements/brew_ultra_magic_coffee", "/achievements/build_room_level_1", "/achievements/build_room_level_3",
    "/achievements/build_room_level_6", "/achievements/build_room_level_8", "/achievements/buy_trainee_charm",
    "/achievements/cheesesmith_azure_tool", "/achievements/clear_chimerical_den", "/achievements/clear_enchanted_fortress",
    "/achievements/clear_pirate_cove", "/achievements/clear_sinister_circus", "/achievements/clear_t1_dungeon_10_times",
    "/achievements/coinify_coins_1m", "/achievements/collect_branch_of_insight", "/achievements/collect_butter_of_proficiency",
    "/achievements/collect_thread_of_expertise", "/achievements/collection_points_100", "/achievements/collection_points_1000",
    "/achievements/collection_points_200", "/achievements/collection_points_2000", "/achievements/collection_points_500",
    "/achievements/complete_tutorial", "/achievements/cook_apple_gummy", "/achievements/cook_peach_yogurt",
    "/achievements/cook_spaceberry_cake", "/achievements/craft_celestial_tool_or_outfit", "/achievements/craft_dungeon_equipment",
    "/achievements/craft_jewelry", "/achievements/craft_master_charm", "/achievements/craft_wooden_bow",
    "/achievements/decompose_bamboo_gloves", "/achievements/defeat_chronofrost_sorcerer", "/achievements/defeat_crystal_colossus",
    "/achievements/defeat_demonic_overlord_t1", "/achievements/defeat_dusk_revenant", "/achievements/defeat_gobo_chieftain",
    "/achievements/defeat_jerry", "/achievements/defeat_jerry_t5", "/achievements/defeat_luna_empress",
    "/achievements/defeat_marine_huntress", "/achievements/defeat_red_panda", "/achievements/defeat_shoebill",
    "/achievements/defeat_stalactite_golem_t5", "/achievements/defeat_the_watcher", "/achievements/enhance_level_80_to_10",
    "/achievements/enhance_level_90_to_10", "/achievements/enhance_to_10", "/achievements/enhance_to_3",
    "/achievements/enhance_to_6", "/achievements/equip_expert_task_badge", "/achievements/equip_ginkgo_weapon",
    "/achievements/gather_milk", "/achievements/labyrinth_floor_2", "/achievements/labyrinth_floor_4",
    "/achievements/labyrinth_floor_6", "/achievements/labyrinth_floor_8", "/achievements/learn_ability",
    "/achievements/learn_special_ability", "/achievements/refine_dungeon_equipment",
    "/achievements/tailor_gluttonous_or_guzzling_pouch", "/achievements/tailor_medium_pouch",
    "/achievements/tailor_umbral_tunic", "/achievements/task_tokens_10", "/achievements/total_level_100",
    "/achievements/total_level_1000", "/achievements/total_level_1500", "/achievements/total_level_1800",
    "/achievements/total_level_250", "/achievements/total_level_500", "/achievements/transmute_philosophers_stone",
    "/achievements/woodcut_arcane_tree",
  ]);
  const SHRINE_HRIDS = Object.freeze({
    "/guild_shrines/force": "/shrines/force",
    "/guild_shrines/tempo": "/shrines/tempo",
    "/guild_shrines/spirit": "/shrines/spirit",
    "/guild_shrines/scholar": "/shrines/scholar",
    "/shrines/force": "/shrines/force",
    "/shrines/tempo": "/shrines/tempo",
    "/shrines/spirit": "/shrines/spirit",
    "/shrines/scholar": "/shrines/scholar",
  });

  const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const array = (value) => Array.isArray(value) ? value : [];
  const text = (value) => typeof value === "string" ? value.trim() : (Number.isFinite(value) ? String(value) : "");
  const integer = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : fallback;
  const first = (row, names) => names.map((name) => row[name]).find((value) => value != null);

  function cleanValue(value) {
    if (Array.isArray(value)) return value.map(cleanValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, child]) => [key, cleanValue(child)]));
    }
    return value;
  }

  function equipmentFrom(value, maxItems = 20) {
    const byLocation = new Map();
    for (const entry of array(value)) {
      const row = object(entry);
      const locationHrid = text(first(row, ["locationHrid", "itemLocationHrid", "location_hrid", "slot"]));
      const itemHrid = text(first(row, ["itemHrid", "item_hrid", "hrid"]));
      if (!locationHrid || !itemHrid || CONSUMABLE.test(locationHrid) || CONSUMABLE.test(itemHrid)) continue;
      byLocation.set(locationHrid, { locationHrid, itemHrid, enhancementLevel: integer(first(row, ["enhancementLevel", "enhancement_level"])) });
    }
    return [...byLocation.values()]
      .sort((a, b) => a.locationHrid.localeCompare(b.locationHrid))
      .slice(0, Math.max(0, integer(maxItems, 20)));
  }

  function mapEntries(value) {
    if (!value || typeof value !== "object") return [];
    if (typeof value.entries === "function" && Number.isFinite(Number(value.size))) return [...value.entries()];
    return Object.entries(value);
  }

  function sourceEntries(value) {
    return Array.isArray(value) ? value.map((entry, index) => [String(index), entry]) : mapEntries(value);
  }

  function boundedInteger(value, max) {
    if (value == null || (typeof value === "string" && value.trim() === "")) return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= max ? number : null;
  }

  function houseRoomsFrom(value) {
    const result = {};
    for (const [mapKey, raw] of sourceEntries(value)) {
      const row = object(raw);
      const hrid = text(row.houseRoomHrid ?? mapKey);
      const level = boundedInteger(row.level ?? raw, 8);
      if (HOUSE_ROOM_HRIDS.has(hrid) && level != null) result[hrid] = level;
    }
    return result;
  }

  function achievementsFrom(value) {
    const result = {};
    for (const [mapKey, raw] of sourceEntries(value)) {
      const row = object(raw);
      const hrid = text(row.achievementHrid ?? mapKey);
      const completed = raw && typeof raw === "object" && !Array.isArray(raw) && Object.hasOwn(raw, "isCompleted")
        ? raw.isCompleted
        : raw;
      if (!ACHIEVEMENT_HRIDS.has(hrid)) continue;
      if (completed !== true && completed !== false && completed !== 0 && completed !== 1) continue;
      result[hrid] = completed === true || completed === 1;
    }
    return result;
  }

  function shrinesFrom(value) {
    const result = {};
    for (const [mapKey, raw] of sourceEntries(value)) {
      const hrid = SHRINE_HRIDS[text(mapKey)];
      const row = object(raw);
      const level = boundedInteger(row.level ?? raw, 20);
      if (hrid && level != null) result[hrid] = level;
    }
    return result;
  }

  function permanentCaptureFields(source, character) {
    const houseSource = source.characterHouseRoomMap ?? source.characterHouseRoomDict
      ?? character.characterHouseRoomMap ?? character.characterHouseRoomDict;
    const achievementSource = source.characterAchievements ?? source.characterAchievementMap
      ?? character.characterAchievements ?? character.characterAchievementMap;
    const shrineSource = source.guildBuildingLevelDict ?? source.guildBuildingLevelMap
      ?? character.guildBuildingLevelDict ?? character.guildBuildingLevelMap;
    const result = {};
    if (houseSource != null) result.houseRooms = houseRoomsFrom(houseSource);
    if (achievementSource != null) result.achievements = achievementsFrom(achievementSource);
    if (shrineSource != null) result.shrines = shrinesFrom(shrineSource);
    if (houseSource != null && achievementSource != null && shrineSource != null) result.permanentBuffsCaptured = true;
    return result;
  }

  function equipmentFromLoadout(loadout) {
    const row = object(loadout);
    const direct = equipmentFrom(first(row, ["equipment", "items", "loadoutItems"]));
    if (direct.length) return direct;
    return equipmentFrom(mapEntries(row.wearableMap).flatMap(([locationHrid, reference]) => {
      if (!reference) return [];
      const parts = String(reference ?? "").split("::");
      let itemHrid = text(
        typeof reference === "object"
          ? first(object(reference), ["itemHrid", "hrid"])
          : ""
      );
      if (!itemHrid && parts.length >= 4 && String(parts[2]).startsWith("/items/")) {
        itemHrid = text(parts[2]);
      }
      if (!itemHrid) {
        itemHrid = text(parts.find((part) => String(part).startsWith("/items/")) || "");
      }
      if (!itemHrid) return [];
      const enhancementLevel = integer(
        typeof reference === "object"
          ? first(object(reference), ["enhancementLevel", "enhancement_level"])
          : (parts.length >= 4 ? parts[3] : parts.at(-1))
      );
      return [{ locationHrid: text(locationHrid), itemHrid, enhancementLevel }];
    }));
  }

  function abilitiesFromLoadout(loadout) {
    const row = object(loadout);
    const direct = abilitiesFrom(first(row, ["abilities", "combatAbilities", "combat_abilities"]));
    if (direct.length) return direct;
    const triggerMap = row.abilityCombatTriggersMap || {};
    return abilitiesFrom(mapEntries(row.abilityMap).flatMap(([slot, abilityReference]) => {
      if (!abilityReference) return [];
      const abilityHrid = text(
        typeof abilityReference === "object"
          ? first(object(abilityReference), ["abilityHrid", "hrid"])
          : abilityReference
      );
      if (!abilityHrid.startsWith("/")) return [];
      const slotNumber = Number(String(slot).match(/\d+/)?.[0] ?? slot);
      return [{
        slot: Math.max(0, slotNumber - 1),
        abilityHrid,
        level: Math.max(1, integer(object(abilityReference).level, 1)),
        triggers: array(triggerMap instanceof Map ? triggerMap.get(abilityHrid) : triggerMap[abilityHrid]),
      }];
    }));
  }

  function triggersFrom(value) {
    return array(value).flatMap((entry) => {
      const row = object(entry);
      const trigger = {
        dependencyHrid: text(first(row, ["dependencyHrid", "combatTriggerDependencyHrid", "dependency_hrid"])),
        conditionHrid: text(first(row, ["conditionHrid", "combatTriggerConditionHrid", "condition_hrid"])),
        comparatorHrid: text(first(row, ["comparatorHrid", "combatTriggerComparatorHrid", "comparator_hrid"])),
        value: Number(row.value ?? 0),
      };
      const haystack = `${trigger.dependencyHrid} ${trigger.conditionHrid} ${trigger.comparatorHrid}`;
      return !CONSUMABLE.test(haystack) && trigger.dependencyHrid && trigger.conditionHrid && trigger.comparatorHrid && Number.isFinite(trigger.value) ? [trigger] : [];
    }).slice(0, 16);
  }

  function abilitiesFrom(value) {
    return array(value).slice(0, 5).flatMap((entry, index) => {
      const row = object(entry);
      const abilityHrid = text(first(row, ["abilityHrid", "ability_hrid", "hrid"]));
      if (!abilityHrid || CONSUMABLE.test(abilityHrid)) return [];
      return [{
        slot: integer(row.slot, index),
        abilityHrid,
        level: Math.max(1, integer(row.level, 1)),
        triggers: triggersFrom(first(row, ["triggers", "combatTriggers", "combat_triggers"])),
      }];
    }).sort((a, b) => a.slot - b.slot);
  }

  function authorizationIndex(value) {
    const result = new Map();
    for (const entry of array(value)) {
      const row = object(entry);
      const itemHrid = text(first(row, ["itemHrid", "item_hrid", "hrid"]));
      if (!itemHrid || CONSUMABLE.test(itemHrid)) continue;
      const enhancementLevel = integer(first(row, ["enhancementLevel", "enhancement_level"]));
      const itemLevels = result.get(itemHrid) ?? [];
      if (!itemLevels.includes(enhancementLevel)) itemLevels.push(enhancementLevel);
      result.set(itemHrid, itemLevels);
    }
    for (const itemLevels of result.values()) itemLevels.sort((a, b) => a - b);
    return result;
  }

  function resolveOwnedEquipment(items, authorized) {
    let missing = false;
    const equipment = items.map((item) => {
      const itemLevels = authorized.get(item.itemHrid) ?? [];
      const enhancementLevel = itemLevels.at(-1);
      if (enhancementLevel == null) {
        missing = true;
        return item;
      }
      return { ...item, enhancementLevel };
    });
    return { equipment, missing };
  }

  function levels(value) {
    const result = {};
    if (Array.isArray(value)) {
      for (const raw of value) {
        const row = object(raw);
        const hrid = text(first(row, [
          "hrid",
          "skillHrid",
          "skill_hrid",
          "abilityHrid",
          "ability_hrid",
        ]));
        if (hrid.startsWith("/")) {
          result[hrid] = Math.max(result[hrid] ?? 0, integer(row.level));
        }
      }
      return result;
    }
    for (const [hrid, raw] of Object.entries(object(value))) {
      if (hrid.startsWith("/")) result[hrid] = integer(object(raw).level ?? raw);
    }
    return result;
  }

  function approvedBuild(loadout, index, authorized, capturedAt) {
    const row = object(loadout);
    const resolved = resolveOwnedEquipment(equipmentFromLoadout(row), authorized);
    const abilities = abilitiesFromLoadout(row);
    if (!resolved.equipment.length || !abilities.length || resolved.missing) return null;
    const sourceLoadoutId = first(row, ["loadoutId", "loadout_id", "id"]);
    const buildId = text(row.buildId) || `loadout:${text(sourceLoadoutId) || index + 1}`;
    return {
      buildId,
      ...(sourceLoadoutId == null ? {} : { sourceLoadoutId: integer(sourceLoadoutId) }),
      name: text(row.name) || `Combat loadout ${index + 1}`,
      approvedByMember: true,
      capturedAt,
      equipment: resolved.equipment,
      abilities,
      simulationReady: true,
      issues: [],
    };
  }

  function loadoutCatalogEntry(loadout, index, authorized) {
    const row = object(loadout);
    const rawActionTypeHrid = text(first(row, ["actionTypeHrid", "action_type_hrid"]));
    const actionTypeHrid = rawActionTypeHrid || "/action_types/all";
    const category = actionTypeHrid === "/action_types/combat"
      ? "combat"
      : actionTypeHrid === "/action_types/all"
        ? "all"
      : actionTypeHrid.startsWith("/action_types/")
        ? "profession"
        : "unknown";
    const resolved = resolveOwnedEquipment(equipmentFromLoadout(row), authorized);
    const abilities = abilitiesFromLoadout(row);
    const sourceLoadoutId = first(row, ["loadoutId", "loadout_id", "id"]);
    return {
      ...(sourceLoadoutId == null ? {} : { sourceLoadoutId: integer(sourceLoadoutId) }),
      name: text(row.name) || `Loadout ${index + 1}`,
      category,
      actionTypeHrid,
      equipment: resolved.equipment,
      abilities,
      issues: resolved.missing ? ["contains-equipment-not-found-in-current-inventory"] : [],
    };
  }

  const PLAYER_SKILL_FIELDS = Object.freeze([
    ["attackLevel", "/skills/attack"],
    ["meleeLevel", "/skills/melee"],
    ["defenseLevel", "/skills/defense"],
    ["rangedLevel", "/skills/ranged"],
    ["magicLevel", "/skills/magic"],
    ["staminaLevel", "/skills/stamina"],
    ["intelligenceLevel", "/skills/intelligence"],
  ]);

  function skillsFromPlayer(player) {
    const row = object(player);
    const result = {};
    for (const [field, hrid] of PLAYER_SKILL_FIELDS) {
      if (row[field] == null || row[field] === "") continue;
      result[hrid] = integer(row[field]);
    }
    return result;
  }

  function isAuraHrid(hrid) {
    return /_aura$/u.test(hrid) || /\/abilities\/(?:critical|speed|guardian|fierce|mystic)_aura$/u.test(hrid);
  }

  function isToolLocation(locationHrid) {
    return /_tool$/u.test(locationHrid);
  }

  /**
   * Convert a manually pasted MWI character/combat blob into the snapshot
   * export format. Accepts either an already-built schemaVersion=2 snapshot,
   * the builder's normal input, or a compact paste shaped like:
   * { player:{*Level, equipment}, abilities, triggerMap }.
   */
  function buildMemberSnapshotFromGamePaste(input) {
    const source = object(input);
    if (String(source.schemaVersion) === "2" && source.memberId && source.loadoutCatalog) {
      return cleanValue(source);
    }
    if (array(source.loadouts).length || source.character || source.authorizedEquipment) {
      return buildMemberSnapshot(source);
    }

    const player = object(source.player);
    const memberId = text(source.memberId ?? source.characterName ?? source.name);
    const displayName = text(source.displayName ?? source.characterName ?? source.name) || memberId;
    const triggerMap = object(source.triggerMap ?? source.abilityCombatTriggersMap);
    const equipment = equipmentFrom(player.equipment ?? source.equipment, 40);
    const rawAbilities = array(source.abilities).map((entry, index) => {
      const row = object(entry);
      const abilityHrid = text(first(row, ["abilityHrid", "ability_hrid", "hrid"]));
      return {
        slot: integer(row.slot, index),
        abilityHrid,
        level: Math.max(1, integer(row.level, 1)),
        triggers: array(
          first(row, ["triggers", "combatTriggers"]) ??
          (triggerMap instanceof Map ? triggerMap.get(abilityHrid) : triggerMap[abilityHrid])
        ),
      };
    });
    const abilities = abilitiesFrom(rawAbilities);
    const learnedAbilities = {
      ...Object.fromEntries(abilities.map((ability) => [ability.abilityHrid, ability.level])),
      ...levels(source.learnedAbilities),
    };
    const auras = {
      ...Object.fromEntries(
        Object.entries(learnedAbilities).filter(([hrid]) => isAuraHrid(hrid))
      ),
      ...levels(source.auras),
    };
    const combatEquipment = equipment.filter((item) => !isToolLocation(item.locationHrid));
    const toolEquipment = equipment.filter((item) => isToolLocation(item.locationHrid));
    const approveCombat = source.approveCombat !== false && combatEquipment.length > 0 && abilities.length > 0;
    const loadouts = [
      {
        loadoutId: 1,
        name: text(source.loadoutName) || "手动粘贴-战斗配装",
        actionTypeHrid: "/action_types/combat",
        equipment: combatEquipment.length ? combatEquipment : equipment.slice(0, 20),
        abilities,
      },
    ];
    if (toolEquipment.length) {
      loadouts.push({
        loadoutId: 2,
        name: "手动粘贴-生活工具",
        actionTypeHrid: "/action_types/all",
        equipment: toolEquipment.slice(0, 20),
        abilities: [],
      });
    }

    const snapshot = buildMemberSnapshot({
      memberId,
      displayName,
      guildId: text(source.guildId) || "TMD",
      capturedAt: source.capturedAt,
      skills: { ...skillsFromPlayer(player), ...levels(source.skills) },
      learnedAbilities,
      auras,
      authorizedEquipment: equipment,
      loadouts,
      selectedLoadoutIds: approveCombat ? ["1"] : [],
      eligibleBossHrids: source.eligibleBossHrids,
      preferredBossHrids: source.preferredBossHrids,
    });
    const extraIssues = ["manual-game-paste"];
    if (!Object.keys(skillsFromPlayer(player)).length && !Object.keys(levels(source.skills)).length) {
      extraIssues.push("missing-skills");
    } else if (!levels(source.skills)["/skills/milking"] && !levels(source.skills)["/skills/foraging"]) {
      // Heuristic: paste usually only has combat *Level fields.
      if (Object.keys(skillsFromPlayer(player)).length && !Object.keys(object(source.skills)).length) {
        extraIssues.push("partial-skills-combat-only");
      }
    }
    if (Object.keys(learnedAbilities).length <= abilities.length) {
      extraIssues.push("learned-abilities-from-equipped-only");
    }
    snapshot.issues = [...new Set([...(snapshot.issues || []), ...extraIssues])];
    if (!snapshot.memberId || snapshot.memberId === "unknown-member") {
      snapshot.issues.push("missing-member-id");
    }
    return snapshot;
  }

  /** Builds the only export format. No source object is spread into the result. */
  function buildMemberSnapshot(input) {
    const source = object(input);
    const character = object(source.character);
    const selectedIds = [...new Set(array(source.selectedLoadoutIds).map(text).filter(Boolean))].slice(0, MAX_BUILDS);
    const allLoadouts = array(source.loadouts);
    const selected = selectedIds.length
      ? allLoadouts.filter((loadout) => selectedIds.includes(text(first(object(loadout), ["loadoutId", "loadout_id", "id", "buildId"]))))
      : [];
    const capturedAt = new Date(source.capturedAt ?? Date.now());
    const capturedAtIso = Number.isNaN(capturedAt.getTime()) ? new Date(0).toISOString() : capturedAt.toISOString();
    const authorized = authorizationIndex(source.authorizedEquipment ?? character.equipment ?? character.inventory);
    const approvedBuilds = selected.map((loadout, index) => approvedBuild(loadout, index, authorized, capturedAtIso)).filter(Boolean);
    const loadoutCatalog = allLoadouts.slice(0, 64).map((loadout, index) => loadoutCatalogEntry(loadout, index, authorized));
    const memberId = text(source.memberId ?? character.memberId ?? character.characterId ?? character.id);
    const displayName = text(source.displayName ?? character.displayName ?? character.name) || memberId || "Unknown member";
    return cleanValue({
      schemaVersion: "2",
      memberId: memberId || "unknown-member",
      displayName,
      guildId: text(source.guildId ?? character.guildId),
      capturedAt: capturedAtIso,
      source: "manual",
      sourceSchemaVersion: "mwi-local-exporter-v1",
      freshness: "fresh",
      confidence: approvedBuilds.length ? "simulation-ready" : "capability-only",
      skills: levels(source.skills ?? character.skills),
      learnedAbilities: levels(source.learnedAbilities ?? character.learnedAbilities),
      auras: levels(source.auras ?? character.auras),
      ...permanentCaptureFields(source, character),
      loadoutCatalog,
      approvedBuilds,
      participation: {
        eligibleBossHrids: array(source.eligibleBossHrids).map(text).filter((value) => value.startsWith("/")),
        preferredBossHrids: array(source.preferredBossHrids).map(text).filter((value) => value.startsWith("/")),
        maxBossAssignments: 1,
        allowRoleChange: true,
        allowSkillChange: true,
      },
      issues: approvedBuilds.length === selected.length ? [] : ["some-selected-loadouts-were-incomplete-or-not-owned"],
    });
  }

  root.MwiTrialPayloadBuilder = Object.freeze({
    MAX_BUILDS,
    buildMemberSnapshot,
    buildMemberSnapshotFromGamePaste,
    equipmentFrom,
    abilitiesFrom,
  });
})(globalThis);
