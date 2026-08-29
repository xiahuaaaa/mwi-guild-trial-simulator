import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const sourcePath = new URL("../../userscripts/member-candidate-loadout-exporter.user.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");

/** Local WI build: swap compile-time guild identity without Greasy Fork publish. */
function wiBuildSource(tmdSource) {
  return tmdSource.replace(
    /const GUILD_IDENTITY = Object\.freeze\(\{\s*apiSlug: "[^"]+",\s*gameGuildName: "[^"]+",\s*gameGuildId: \d+,\s*\}\);/,
    `const GUILD_IDENTITY = Object.freeze({
    apiSlug: "WI",
    gameGuildName: "Wandering ICarus",
    gameGuildId: 667,
  });`,
  );
}

function resolvedReportUrls(buildSource) {
  const start = buildSource.indexOf("const GUILD_IDENTITY");
  const end = buildSource.indexOf("const COMBAT_ABILITY_ICON_BASE");
  assert.ok(start >= 0 && end > start);
  const sandbox = {};
  runInNewContext(
    `${buildSource.slice(start, end)}; combatUrl = COMBAT_ASSIGNMENT_JSON_URL; lifeUrl = LIFE_ASSIGNMENT_JSON_URL;`,
    sandbox,
  );
  return { combat: sandbox.combatUrl, life: sandbox.lifeUrl };
}

test("member exporter retries hydration and watches character changes", () => {
  assert.match(source, /HYDRATION_RETRY_DELAYS_MS/);
  assert.match(source, /setTimeout\(\(\) => requestCharacterData\(\), delay\)/);
  assert.match(source, /currentCharacterId\(\) !== hydration\.characterId/);
});

test("page bridge normalizes real MWI wearable and ability maps", () => {
  assert.match(source, /loadout\?\.wearableMap/);
  assert.match(source, /loadout\?\.abilityMap/);
  assert.match(source, /abilityCombatTriggersMap/);
  assert.match(source, /reference\.itemHash/);
  assert.match(source, /abilityReference\.abilityHrid/);
  assert.match(source, /actionTypeHrid/);
});

test("member exporter is a zero-configuration TMD uploader", () => {
  assert.match(source, /@version\s+0\.6\.22/);
  assert.match(source, /@name\s+TMD-guild-trial-sync/);
  assert.match(source, /@name:en\s+TMD-guild-trial-sync/);
  assert.match(source, /@match\s+https:\/\/www\.milkywayidlecn\.com\/\*/);
  assert.match(source, /@connect\s+adudu\.tailab136f\.ts\.net/);
  assert.match(source, /@grant\s+GM\.xmlHttpRequest/);
  assert.match(source, /DEFAULT_API_BASE = "https:\/\/adudu\.tailab136f\.ts\.net"/);
  assert.match(source, /GUILD_IDENTITY = Object\.freeze\(\{\s*apiSlug: "TMD",\s*gameGuildName: "TMD",\s*gameGuildId: 369,/);
  assert.match(source, /detectedMemberId\(\)/);
  assert.match(source, /api\/public\/guilds\/\$\{GUILD_IDENTITY\.apiSlug\}/);
  assert.match(source, /scheduleAutomaticUpload/);
  assert.match(source, /ensureTmdGuildConfirmed/);
  assert.match(source, /readPageStorage\(/);
  assert.match(source, /__ADUDU_GUILD_TRIAL_PAGE_MESSAGE_OBSERVER__/);
  assert.match(source, /update\.greasyfork\.org\/scripts\/588902\//);
  assert.match(source, /@namespace\s+https:\/\/greasyfork\.org\/users\/1466859-adudu/);
  assert.match(source, /if \(pageContext\.__ADUDU_GUILD_TRIAL_BRIDGE__\) return;/);
  assert.doesNotMatch(source, /填写成员同步口令/);
  assert.doesNotMatch(source, /actionButton\("连接设置"/);
});

test("automatic sync does not reschedule itself while building a snapshot", () => {
  assert.match(source, /suppressSchedule: false/);
  assert.match(source, /automaticSync\.suppressSchedule = true/);
  assert.match(source, /if \(automaticSync\.suppressSchedule\) return/);
  assert.match(source, /if \(automatic && signature === automaticSync\.lastSignature\) return/);
  const payloadStart = source.indexOf("function payload()");
  const payloadEnd = source.indexOf("\n  function download()", payloadStart);
  assert.ok(payloadStart >= 0 && payloadEnd > payloadStart);
  const payload = source.slice(payloadStart, payloadEnd);
  assert.match(payload, /automaticSync\.suppressSchedule = true/);
  assert.match(payload, /hydrateFromGameCache\(\)/);
  assert.match(payload, /hydrateFromLiveGame\(\)/);
  assert.match(payload, /automaticSync\.suppressSchedule = false/);
});

test("member exporter localizes the panel from game language, not navigator.language", () => {
  assert.match(source, /readPageStorage\("i18nextLng"\)/);
  assert.match(source, /readPageStorage\("i18nextLng-milkywayidle"\)/);
  assert.doesNotMatch(source, /navigator\.language/);
  assert.match(source, /Sync now/);
  assert.match(source, /Export backup/);
  assert.match(source, /Waiting for character data/);
  assert.match(source, /Trial Hedgehog/);
  assert.match(source, /displayCombatTrialName/);
  assert.match(source, /function lang\(\)/);
  assert.match(source, /function tr\(key/);
  // API payload trial names stay Chinese for QQ/API consistency.
  assert.match(source, /"\/guild_combat\/jellyfish": "试炼水母"/);
});

test("member exporter reads and verifies the native TMD guild roster", () => {
  assert.match(source, /guildCharacterMap/);
  assert.match(source, /guildSharableCharacterMap/);
  assert.match(source, /guild\.name === GUILD_IDENTITY\.gameGuildName/);
  assert.match(source, /guild\.id === GUILD_IDENTITY\.gameGuildId/);
  assert.match(source, /api\/public\/guilds\/\$\{GUILD_IDENTITY\.apiSlug\}\/roster/);
  assert.match(source, /rosterSyncAllowed/);
  assert.match(source, /登录后自动同步本周试炼类型/);
  assert.doesNotMatch(source, /FIXED_GUILD_ID/);
});

test("member exporter synchronizes complete combat trial registrations from game state", () => {
  assert.match(source, /guildTrialSignupLevelDict/);
  assert.match(source, /guildWeeklyTrialSet/);
  assert.match(source, /signedUpCombatTrialHrid/);
  assert.match(source, /signedUpCombatRoleHrid/);
  assert.match(source, /signedUpSkillingTrialHrid/);
  assert.match(source, /SKILL_TRIAL_NAMES/);
  assert.match(source, /api\/public\/guilds\/\$\{GUILD_IDENTITY\.apiSlug\}\/trial-registrations/);
  assert.match(source, /registeredCount: members\.length/);
  assert.match(source, /登录后自动同步/);
});

test("member exporter highlights the current public combat assignment and abilities", () => {
  assert.match(source, /COMBAT_ASSIGNMENT_JSON_URL = `https:\/\/raw\.githubusercontent\.com\/xiahuaaaa\/mwi-guild-trial-helper\/main\/reports\/\$\{REPORTS_PREFIX\}combat-assignment\/latest\.json`/);
  assert.match(source, /reports\/\$\{REPORTS_PREFIX\}combat-assignment\/latest\.json/);
  assert.match(source, /REPORTS_PREFIX = GUILD_IDENTITY\.apiSlug === "WI" \? "WI\/" : ""/);
  assert.match(source, /@connect\s+raw\.githubusercontent\.com/);
  assert.match(source, /normalizeCombatAssignment/);
  assert.match(source, /currentGuildWeekStart\(\)/);
  assert.match(source, /data-adudu-guild-assignment="combat"/);
  assert.match(source, /应该携带的战斗技能/);
  assert.match(source, /combatAssignmentCardMatches/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /abilityHrids/);
  assert.match(source, /assignmentUnavailable/);
  assert.match(source, /COMBAT_ASSIGNMENT_POLL_MS = 2 \* 60 \* 1000/);
  assert.match(source, /assignmentAttemptFresh/);
  assert.match(source, /COMBAT_ABILITY_ICON_BASE/);
  assert.match(source, /adudu-guild-sync-skill-icon/);
});

test("member exporter highlights each member's life assignment and warns on wrong signup", () => {
  assert.match(source, /LIFE_ASSIGNMENT_JSON_URL = `https:\/\/raw\.githubusercontent\.com\/xiahuaaaa\/mwi-guild-trial-helper\/main\/reports\/\$\{REPORTS_PREFIX\}life-assignment\/latest\.json`/);
  assert.match(source, /reports\/\$\{REPORTS_PREFIX\}life-assignment\/latest\.json/);
  assert.match(source, /normalizeLifeAssignment/);
  assert.match(source, /lifeAssignmentCardMatches/);
  assert.match(source, /currentSkillingSignupHrid/);
  assert.match(source, /data-adudu-guild-assignment="life"/);
  assert.match(source, /data-adudu-guild-assignment="life-mismatch"/);
  assert.match(source, /adudu-guild-sync-life-warning/);
  assert.match(source, /lifeSignupMismatch/);
  assert.match(source, /lifeSignupMissing/);
  assert.match(source, /signedUpSkillingTrialHrid/);
});

test("adudu login sync includes weekly trial types and normalized monster panels", () => {
  assert.match(source, /guildTrialDetailMap/);
  assert.match(source, /combatMonsterDetailMap/);
  assert.match(source, /weeklyTrialCatalogPayload/);
  assert.match(source, /weeklyTrialSet: \{ skillHrids, combatHrids \}/);
  assert.match(source, /maxParticipants/);
  assert.match(source, /trialMaxParticipants/);
  assert.match(source, /guildBuildingLevelDict/);
  assert.match(source, /guildBuildingDetailMap/);
  assert.match(source, /TRIAL_BASE_PARTICIPANTS/);
  assert.match(source, /compactMonsterDetail/);
  assert.match(source, /attackIntervalSeconds/);
  assert.match(source, /abilityHaste = 0/);
  assert.match(source, /api\/public\/guilds\/\$\{GUILD_IDENTITY\.apiSlug\}\/weekly-trials/);
});

test("WI local build pins Wandering ICarus identity and WI-prefixed assignment URLs", () => {
  const wi = wiBuildSource(source);
  assert.match(wi, /apiSlug: "WI"/);
  assert.match(wi, /gameGuildName: "Wandering ICarus"/);
  assert.match(wi, /gameGuildId: 667/);
  const urls = resolvedReportUrls(wi);
  assert.match(urls.combat, /reports\/WI\/combat-assignment\/latest\.json/);
  assert.match(urls.life, /reports\/WI\/life-assignment\/latest\.json/);
  assert.doesNotMatch(wi, /填写成员同步口令/);
  assert.doesNotMatch(wi, /actionButton\("连接设置"/);
});

test("TMD build keeps assignment JSON URLs without WI prefix", () => {
  const urls = resolvedReportUrls(source);
  assert.match(urls.combat, /reports\/combat-assignment\/latest\.json/);
  assert.match(urls.life, /reports\/life-assignment\/latest\.json/);
  assert.doesNotMatch(urls.combat, /reports\/WI\//);
  assert.doesNotMatch(urls.life, /reports\/WI\//);
});

test("page-context WebSocket observer is installed before game login data and retains static maps", () => {
  assert.match(source, /class AduduObservedWebSocket extends NativeWebSocket/);
  assert.match(source, /observePageMessages\(page, recordPacket\)/);
  assert.match(source, /Object\.getOwnPropertyDescriptor\(prototype, "data"\)/);
  assert.match(source, /message\.includes\('"init_character_data"'\)/);
  assert.match(source, /message\.includes\('"guildCharacterMap"'\)/);
  assert.match(source, /__ADUDU_GUILD_TRIAL_PAGE_MESSAGE_OBSERVER__/);
  assert.match(source, /installDirectMessageObserver\(\);\s*if \(document\.documentElement\)/);
  assert.match(source, /type: "packet", packet/);
  assert.match(source, /if \(document\.documentElement\) \{\s*installPageBridge\(\)/);
  assert.doesNotMatch(source, /state\.guildTrialDetailMap = \{\};/);
  assert.doesNotMatch(source, /state\.combatMonsterDetailMap = \{\};/);
  assert.doesNotMatch(source, /WebSocket\.prototype\.dispatchEvent/);
});

test("direct MessageEvent observer captures init data without changing the payload", async () => {
  const start = source.indexOf("function observePageMessages(page, onPacket)");
  const end = source.indexOf("\n\n  function installDirectMessageObserver()", start);
  assert.ok(start >= 0 && end > start);
  const observePageMessages = new Function(`return (${source.slice(start, end).trim()})`)();
  class FakeMessageEvent {
    constructor(data) { this.rawData = data; }
  }
  Object.defineProperty(FakeMessageEvent.prototype, "data", {
    configurable: true,
    enumerable: true,
    get() { return this.rawData; },
  });
  const page = { MessageEvent: FakeMessageEvent };
  const packets = [];
  assert.equal(observePageMessages(page, (packet) => packets.push(packet)), true);
  const raw = JSON.stringify({
    type: "init_character_data",
    characterLoadoutMap: {
      1: {
        wearableMap: {
          "/item_locations/main_hand": "195739::/item_locations/main_hand::/items/test_bow::12",
        },
      },
    },
  });
  const event = new FakeMessageEvent(raw);
  assert.equal(event.data, raw);
  assert.equal(event.data, raw);
  await Promise.resolve();
  assert.equal(packets.length, 1);
  assert.equal(packets[0].type, "init_character_data");
});

test("weekly monster cache and rich loadouts survive partial React recovery", () => {
  assert.match(source, /decompressUtf16\(initClientRaw\)/);
  assert.match(source, /__sunnyMwi__\?\.lzDecompressUTF16/);
  assert.match(source, /COMBAT_TRIAL_MONSTERS/);
  assert.match(source, /mergeLoadouts\(state\.loadouts, nextLoadouts\)/);
  assert.match(source, /loadout\.equipment\.length \* 1000/);
  assert.match(source, /MWI_QUEUE_PLANNER\?\.getGameCore\?\.\(\)\?\.state/);
  assert.match(source, /if \(fiber\.return\) queue\.push\(fiber\.return\)/);
  assert.match(source, /怪物面板等待读取/);
  assert.doesNotMatch(source, /缺少当前拥有的装备或技能/);
});

test("member exporter localizes the empty loadout guard for members", () => {
  assert.match(source, /apiError\?\.code === "empty_loadout_catalog"/);
  assert.match(source, /waitingEquipmentManual/);
  assert.match(source, /waitingEquipmentAuto/);
  assert.match(source, /function catalogMissingUsableEquipment/);
  assert.match(source, /catalog\.length === 0/);
  assert.match(source, /尚未从游戏读取到可用配装装备/);
  assert.match(source, /尚未读取到可用配装装备，正在等待游戏数据/);
  assert.match(source, /if \(catalogMissingUsableEquipment\(snapshot\)\)/);
  assert.match(source, /equipmentFromLoadout/);
  assert.match(source, /expandedLoadoutEquipment/);
  assert.match(source, /scheduleAutomaticUpload\(1500\)/);
});

test("snapshot builder accepts native wearableMap before page-bridge normalization", () => {
  assert.match(source, /equipmentFromLoadout\(loadout\)/);
  assert.match(source, /abilitiesFromLoadout\(loadout\)/);
  assert.match(source, /mapEntries\(loadout\.wearableMap\)/);
  assert.match(source, /mapEntries\(loadout\.abilityMap\)/);
});

test("page bridge resolves hash-only wearable references via characterItemMap", () => {
  assert.match(source, /parts\.length >= 4 && String\(parts\[2\]\)\.startsWith\("\/items\/"\)/);
  assert.match(source, /for \(const key of \[referenceKey, parts\[0\], parts\[2\], parts\[1\]\]/);
  assert.match(source, /wearableEntries\.length/);
  assert.match(source, /state\.itemByHash/);
});

test("page bridge prefers a hydrated Game Core loadout over a names-only React view", () => {
  const start = source.indexOf("function pageBridgeMain(channel)");
  const end = source.indexOf("\n\n  function installPageBridge()", start);
  assert.ok(start >= 0 && end > start);
  const pageBridgeMain = new Function(`return (${source.slice(start, end).trim()})`)();
  const fullState = {
    character: { id: 195739, name: "adudu", guildName: "TMD" },
    characterItemMap: {
      itemHash: { itemHrid: "/items/test_bow", enhancementLevel: 12 },
      onlyHash: { itemHrid: "/items/hash_sword", enhancementLevel: 8 },
    },
    characterAbilityMap: {
      "/abilities/frenzy": { abilityHrid: "/abilities/frenzy", level: 80 },
    },
    characterLoadoutDict: {
      1: {
        id: 1,
        name: "完整战斗配装",
        actionTypeHrid: "/action_types/combat",
        wearableMap: runInNewContext(`new Map([
          ["/item_locations/main_hand", "195739::/item_locations/main_hand::/items/test_bow::12"],
          ["/item_locations/off_hand", "onlyHash::8"]
        ])`),
        abilityMap: runInNewContext(`new Map([[1, "/abilities/frenzy"]])`),
      },
    },
  };
  const partialState = {
    character: fullState.character,
    characterLoadoutDict: {
      1: { id: 1, name: "完整战斗配装", actionTypeHrid: "/action_types/combat" },
    },
  };
  const fiber = { stateNode: { state: partialState } };
  const root = { "__reactFiber$test": fiber };
  let posted = null;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    location: { origin: "https://www.milkywayidle.com" },
    MWI_QUEUE_PLANNER: { getGameCore: () => ({ state: fullState }) },
    postMessage: (message) => { posted = message; },
    addEventListener: () => {},
  };
  globalThis.document = {
    readyState: "complete",
    querySelector: () => root,
    getElementById: () => null,
    body: null,
    addEventListener: () => {},
  };
  try {
    pageBridgeMain("test-channel");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
  assert.equal(posted?.payload?.loadouts?.[0]?.equipment?.length, 2);
  assert.equal(posted?.payload?.loadouts?.[0]?.abilities?.length, 1);
  assert.equal(posted?.payload?.loadouts?.[0]?.equipment?.[0]?.itemHrid, "/items/test_bow");
  assert.equal(posted?.payload?.loadouts?.[0]?.equipment?.[1]?.itemHrid, "/items/hash_sword");
});

function loadApplyHarness({ search = "", coreCharacter = null } = {}) {
  const start = source.indexOf("  const state = {");
  const end = source.indexOf("  function hydrateFromGameCache()");
  assert.ok(start >= 0 && end > start);
  const sandbox = {
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    Math,
    console,
    URLSearchParams,
    location: { search },
    window: {
      location: { search, origin: "https://www.milkywayidle.com" },
      MWI_QUEUE_PLANNER: coreCharacter
        ? { getGameCore: () => ({ state: { character: coreCharacter } }) }
        : undefined,
    },
  };
  runInNewContext(
    `${source.slice(start, end)}
    this.state = state;
    this.applyCharacterData = applyCharacterData;
    this.currentCharacterId = currentCharacterId;`,
    sandbox,
  );
  return sandbox;
}

function altLoadout(characterId, loadoutId, name) {
  return {
    id: loadoutId,
    name,
    actionTypeHrid: "/action_types/combat",
    characterId,
    wearableMap: {
      "/item_locations/main_hand": `${characterId}::/item_locations/main_hand::/items/gobo_defender::14`,
    },
  };
}

test("member exporter keeps YouCan loadouts when daydayup and NoCan fibers are also in memory", () => {
  const youCan = { id: 200, name: "YouCan" };
  const harness = loadApplyHarness({
    search: "?characterId=200",
    coreCharacter: youCan,
  });
  harness.applyCharacterData({
    character: { id: 100, name: "daydayup" },
    loadouts: [altLoadout(100, 1, "炼金强化"), altLoadout(100, 2, "迷宫枪")],
  });
  harness.applyCharacterData({
    character: youCan,
    loadouts: [altLoadout(200, 11, "炼金强化"), altLoadout(200, 12, "工会战斗")],
  });
  harness.applyCharacterData({
    character: { id: 300, name: "NoCan" },
    loadouts: [altLoadout(300, 21, "制作"), altLoadout(300, 22, "采集")],
  });
  assert.equal(harness.state.character.name, "YouCan");
  assert.equal(harness.state.loadouts.length, 2);
  assert.equal(String(harness.state.loadouts[0].name), "炼金强化");
  assert.equal(String(harness.state.loadouts[1].name), "工会战斗");
  assert.equal(harness.currentCharacterId(), "200");
});

test("member exporter replaces rather than merges when switching alts without a session id yet", () => {
  const harness = loadApplyHarness();
  harness.applyCharacterData({
    character: { id: 100, name: "daydayup" },
    loadouts: [altLoadout(100, 1, "炼金强化")],
  });
  harness.applyCharacterData({
    character: { id: 200, name: "YouCan" },
    loadouts: [altLoadout(200, 11, "工会战斗")],
  });
  assert.equal(String(harness.state.character.name), "YouCan");
  assert.equal(harness.state.loadouts.length, 1);
  assert.equal(String(harness.state.loadouts[0].name), "工会战斗");
});

test("page bridge ignores a richer leftover alt instead of scoring it as the current character", () => {
  const start = source.indexOf("function pageBridgeMain(channel)");
  const end = source.indexOf("\n\n  function installPageBridge()", start);
  assert.ok(start >= 0 && end > start);
  const pageBridgeMain = new Function(`return (${source.slice(start, end).trim()})`)();
  const youCanState = {
    character: { id: 200, name: "YouCan", guildName: "Wandering ICarus" },
    characterLoadoutDict: {
      11: {
        id: 11,
        name: "工会战斗",
        actionTypeHrid: "/action_types/combat",
        wearableMap: { "/item_locations/main_hand": "200::/item_locations/main_hand::/items/gobo_defender::14" },
      },
    },
  };
  const daydayupState = {
    character: { id: 100, name: "daydayup", guildName: "Wandering ICarus" },
    characterLoadoutDict: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [index + 1, {
        id: index + 1,
        name: `daydayup-${index + 1}`,
        actionTypeHrid: "/action_types/combat",
        wearableMap: { "/item_locations/head": `100::/item_locations/head::/items/gobo_defender::${index}` },
      }]),
    ),
  };
  const fiber = { stateNode: { state: daydayupState } };
  const root = { "__reactFiber$test": fiber };
  let posted = null;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    location: { origin: "https://www.milkywayidle.com", search: "?characterId=200" },
    MWI_QUEUE_PLANNER: { getGameCore: () => ({ state: youCanState }) },
    postMessage: (message) => { posted = message; },
    addEventListener: () => {},
  };
  globalThis.document = {
    readyState: "complete",
    querySelector: () => root,
    getElementById: () => null,
    body: null,
    addEventListener: () => {},
  };
  try {
    pageBridgeMain("test-channel");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
  assert.equal(posted?.payload?.character?.name, "YouCan");
  assert.equal(posted?.payload?.loadouts?.length, 1);
  assert.equal(posted?.payload?.loadouts?.[0]?.name, "工会战斗");
});

test("member exporter can persistently collapse into a frog launcher", () => {
  assert.match(source, /UI_COLLAPSED_KEY = "uiCollapsed"/);
  assert.match(source, /UI_POSITION_KEY = "uiCollapsedPosition"/);
  assert.match(source, /toggle\.textContent = collapsed \? "🐸" : "−"/);
  assert.match(source, /GM_setValue\(UI_COLLAPSED_KEY, collapsed\)/);
  assert.match(source, /applyCollapsed\(Boolean\(GM_getValue\(UI_COLLAPSED_KEY, false\)\)\)/);
  assert.match(source, /content\.hidden = collapsed/);
});

test("collapsed frog supports bounded drag without triggering expand", () => {
  assert.match(source, /toggle\.addEventListener\("pointerdown"/);
  assert.match(source, /toggle\.addEventListener\("pointermove"/);
  assert.match(source, /toggle\.addEventListener\("pointerup", finishDrag\)/);
  assert.match(source, /Math\.hypot\(deltaX, deltaY\) >= 4/);
  assert.match(source, /GM_setValue\(UI_POSITION_KEY, position\)/);
  assert.match(source, /suppressNextClick = true/);
  assert.match(source, /window\.addEventListener\("resize"/);
});

test("member exporter merges every equipment source and resolves the highest owned enhancement", () => {
  assert.match(source, /mergeAuthorizedEquipment\(state\.authorizedEquipment, equipment\)/);
  assert.match(source, /loadouts\.flatMap\(\(loadout\) => loadout\.equipment\)/);
  assert.match(source, /loadoutEquipmentPool\(\)/);
  assert.doesNotMatch(source, /level < item\.enhancementLevel/);
  assert.match(source, /\.slice\(0, 20\)/);
  assert.match(source, /所有行动/);
});

test("member exporter falls back to CORS fetch when GM XHR is missing or errors", () => {
  assert.match(source, /function gmXmlHttpRequestFn\(\)/);
  assert.match(source, /function requestJsonWithFetch\(/);
  assert.match(source, /fetch: false/);
  assert.match(source, /mode: "cors"/);
  assert.match(source, /if \(!gmRequest\) return requestJsonWithFetch/);
  assert.match(source, /error\?\.message !== tr\("syncUnreachable"\)/);
  assert.doesNotMatch(source, /headers: \{ "content-type": "application\/json" \}/);
});
