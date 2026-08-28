import assert from "node:assert/strict";
import test from "node:test";
import { createGuildApi } from "../../apps/api/server.mjs";

const fixture = { fixtureId: "test-fixture", bosses: [] };

async function harness(t) {
  const api = await createGuildApi({ adminKey: "test-admin-key", fixture, dbPath: ":memory:" });
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  const address = api.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => api.close());
  const request = async (path, options = {}) => {
    const headers = { ...(options.headers ?? {}) };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${base}${path}`, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    return { response, body: await response.json() };
  };
  const admin = (path, options = {}) => request(path, { ...options, headers: { "x-admin-key": "test-admin-key", ...(options.headers ?? {}) } });
  await admin("/api/admin/guilds/guild-1", { method: "PUT", body: { name: "Test Guild" } });
  await admin("/api/admin/guilds/guild-1/members", { method: "PUT", body: { memberId: "member-1", displayName: "Tester", memberToken: "member-secret" } });
  return { request, admin, db: api.db };
}

function countTmdTableRows(db) {
  return {
    members: Number(db.prepare("SELECT COUNT(*) AS count FROM members WHERE guild_id = 'TMD'").get().count),
    qqBindings: Number(db.prepare("SELECT COUNT(*) AS count FROM qq_bindings WHERE guild_id = 'TMD'").get().count),
    assignments: Number(db.prepare("SELECT COUNT(*) AS count FROM assignments WHERE guild_id = 'TMD'").get().count),
  };
}

function snapshot(extra = {}) {
  return {
    schemaVersion: "2", memberId: "member-1", guildId: "guild-1", displayName: "Tester", capturedAt: "2026-07-24T00:00:00.000Z",
    source: "manual", sourceSchemaVersion: "mwi-local-exporter-v1", freshness: "fresh", confidence: "simulation-ready",
    skills: { "/skills/attack": 100 }, learnedAbilities: {}, auras: {},
    loadoutCatalog: [
      { sourceLoadoutId: 1, name: "Build 1", category: "combat", actionTypeHrid: "/action_types/combat", equipment: [{ locationHrid: "/item_locations/main_hand", itemHrid: "/items/wand", enhancementLevel: 5 }], abilities: [{ slot: 0, abilityHrid: "/abilities/fireball", level: 60, triggers: [] }], issues: [] },
      { sourceLoadoutId: 2, name: "Tailoring", category: "profession", actionTypeHrid: "/action_types/tailoring", equipment: [{ locationHrid: "/item_locations/body", itemHrid: "/items/tailors_top", enhancementLevel: 7 }], abilities: [], issues: [] },
    ],
    approvedBuilds: [{ buildId: "build-1", name: "Build 1", approvedByMember: true, simulationReady: true, capturedAt: "2026-07-24T00:00:00.000Z", equipment: [{ locationHrid: "/item_locations/main_hand", itemHrid: "/items/wand", enhancementLevel: 5 }], abilities: [{ slot: 0, abilityHrid: "/abilities/fireball", level: 60, triggers: [] }], issues: [] }],
    participation: { eligibleBossHrids: [], preferredBossHrids: [], maxBossAssignments: 1, allowRoleChange: true, allowSkillChange: true }, issues: [], ...extra,
  };
}

test("member snapshots require the exact member token", async (t) => {
  const { request } = await harness(t);
  const denied = await request("/api/guilds/guild-1/members/member-1/snapshots", { method: "POST", body: snapshot() });
  assert.equal(denied.response.status, 401);
  const accepted = await request("/api/guilds/guild-1/members/member-1/snapshots", { method: "POST", headers: { authorization: "Bearer member-secret" }, body: snapshot() });
  assert.equal(accepted.response.status, 201);
  assert.equal(typeof accepted.body.snapshotId, "number");
  const impersonation = await request("/api/guilds/guild-1/members/member-1/snapshots", { method: "POST", headers: { authorization: "Bearer member-secret" }, body: snapshot({ memberId: "another-member" }) });
  assert.equal(impersonation.response.status, 403);
  assert.equal(impersonation.body.error.code, "member_mismatch");
});

test("member snapshots cannot replace real loadouts with an empty capture", async (t) => {
  const { request } = await harness(t);
  const emptyCatalog = snapshot({
    confidence: "capability-only",
    approvedBuilds: [],
    loadoutCatalog: snapshot().loadoutCatalog.map((loadout) => ({
      ...loadout,
      equipment: [],
      abilities: [],
    })),
  });
  const rejected = await request("/api/guilds/guild-1/members/member-1/snapshots", {
    method: "POST",
    headers: { authorization: "Bearer member-secret" },
    body: emptyCatalog,
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.error.code, "empty_loadout_catalog");
});

test("skills-only snapshots with an empty loadout catalog are rejected", async (t) => {
  const { request } = await harness(t);
  const rejected = await request("/api/guilds/guild-1/members/member-1/snapshots", {
    method: "POST",
    headers: { authorization: "Bearer member-secret" },
    body: snapshot({
      confidence: "capability-only",
      approvedBuilds: [],
      loadoutCatalog: [],
    }),
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.error.code, "empty_loadout_catalog");
});

test("an empty loadout catalog cannot overwrite a previously equipped snapshot", async (t) => {
  const { request, admin } = await harness(t);
  const accepted = await request("/api/guilds/guild-1/members/member-1/snapshots", {
    method: "POST",
    headers: { authorization: "Bearer member-secret" },
    body: snapshot(),
  });
  assert.equal(accepted.response.status, 201);
  const rejected = await request("/api/guilds/guild-1/members/member-1/snapshots", {
    method: "POST",
    headers: { authorization: "Bearer member-secret" },
    body: snapshot({
      confidence: "capability-only",
      approvedBuilds: [],
      loadoutCatalog: [],
      capturedAt: "2026-07-24T01:00:00.000Z",
    }),
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.error.code, "empty_loadout_catalog");
  const members = await admin("/api/guilds/guild-1/members");
  assert.equal(members.response.status, 200);
  assert.equal(members.body.members[0].latestSnapshot.loadoutCatalog.length, 2);
  assert.equal(
    members.body.members[0].latestSnapshot.loadoutCatalog[0].equipment[0].itemHrid,
    "/items/wand",
  );
});

test("TMD public uploader accepts roster members without a token and rate limits abuse", async (t) => {
  const { request, admin } = await harness(t);
  await admin("/api/admin/guilds/TMD", { method: "PUT", body: { name: "TMD" } });
  await admin("/api/admin/guilds/TMD/members", { method: "PUT", body: { memberId: "adudu", displayName: "adudu", memberToken: "unused-public-path-secret" } });

  const eligible = await request("/api/public/guilds/TMD/members/adudu/eligibility");
  assert.equal(eligible.response.status, 200);
  assert.equal(eligible.body.eligible, true);
  assert.equal(eligible.body.rosterSyncAllowed, true);
  const outsider = await request("/api/public/guilds/TMD/members/outsider/eligibility");
  assert.equal(outsider.body.eligible, false);
  assert.equal(outsider.body.rosterSyncAllowed, false);

  const publicSnapshot = snapshot({
    guildId: "TMD",
    memberId: "adudu",
    displayName: "adudu",
    approvedBuilds: [],
    confidence: "capability-only",
  });
  const accepted = await request("/api/public/guilds/TMD/members/adudu/snapshots", { method: "POST", body: publicSnapshot });
  assert.equal(accepted.response.status, 201);
  const rejected = await request("/api/public/guilds/TMD/members/outsider/snapshots", { method: "POST", body: { ...publicSnapshot, memberId: "outsider", displayName: "outsider" } });
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.body.error.code, "member_not_in_tmd");

  for (let index = 0; index < 19; index += 1) {
    const result = await request("/api/public/guilds/TMD/members/adudu/snapshots", { method: "POST", body: publicSnapshot });
    assert.equal(result.response.status, 201);
  }
  const limited = await request("/api/public/guilds/TMD/members/adudu/snapshots", { method: "POST", body: publicSnapshot });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.body.error.code, "upload_rate_limited");
});

test("TMD roster sync verifies the game guild and replaces the active member list", async (t) => {
  const { request, admin } = await harness(t);
  await admin("/api/admin/guilds/TMD", { method: "PUT", body: { name: "TMD" } });
  await admin("/api/admin/guilds/TMD/members", { method: "PUT", body: { memberId: "adudu", displayName: "adudu", memberToken: "unused-roster-reporter-secret" } });
  const roster = {
    guild: { id: 369, name: "TMD" },
    reporter: { playerId: 1, memberId: "adudu" },
    members: [
      { playerId: 1, memberId: "adudu", status: "ACTIVE", guildRole: "LEADER" },
      { playerId: 2, memberId: "sh1ro", status: "ACTIVE", guildRole: "MEMBER" },
      { playerId: 3, memberId: "kogge", status: "ACTIVE", guildRole: "MEMBER" },
      { playerId: 4, memberId: "花花", status: "ACTIVE", guildRole: "MEMBER" },
    ],
    capturedAt: "2026-07-24T15:30:00.000Z",
  };

  const accepted = await request("/api/public/guilds/TMD/roster", { method: "POST", body: roster });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.memberCount, 4);
  assert.equal((await request("/api/public/guilds/TMD/members/%E8%8A%B1%E8%8A%B1/eligibility")).body.eligible, true);

  const wrongGuild = await request("/api/public/guilds/TMD/roster", {
    method: "POST",
    body: { ...roster, guild: { id: 369, name: "NOT-TMD" } },
  });
  assert.equal(wrongGuild.response.status, 403);
  assert.equal(wrongGuild.body.error.code, "not_tmd_guild");

  const wrongGameId = await request("/api/public/guilds/TMD/roster", {
    method: "POST",
    body: { ...roster, guild: { id: 370, name: "TMD" } },
  });
  assert.equal(wrongGameId.response.status, 403);
  assert.equal(wrongGameId.body.error.code, "game_guild_mismatch");

  const wrongReporter = await request("/api/public/guilds/TMD/roster", {
    method: "POST",
    body: { ...roster, reporter: { playerId: 2, memberId: "sh1ro" } },
  });
  assert.equal(wrongReporter.response.status, 403);
  assert.equal(wrongReporter.body.error.code, "roster_reporter_not_allowed");

  await admin("/api/admin/guilds/TMD/qq-bindings/99990001", {
    method: "PUT",
    body: { memberId: "花花", combatType: "弓" },
  });
  const replacement = await request("/api/public/guilds/TMD/roster", {
    method: "POST",
    body: { ...roster, members: roster.members.slice(0, 3), capturedAt: "2026-07-24T15:31:00.000Z" },
  });
  assert.equal(replacement.response.status, 200);
  assert.equal((await request("/api/public/guilds/TMD/members/%E8%8A%B1%E8%8A%B1/eligibility")).body.eligible, false);
  const bindingsAfterPrune = await admin("/api/guilds/TMD/qq-bindings");
  assert.equal(
    bindingsAfterPrune.body.bindings.some((row) => row.memberId === "花花"),
    false,
  );
});

test("unregistered public ingest slug returns 404", async (t) => {
  const { request } = await harness(t);
  const roster = {
    guild: { id: 369, name: "TMD" },
    reporter: { playerId: 1, memberId: "adudu" },
    members: [{ playerId: 1, memberId: "adudu", status: "ACTIVE", guildRole: "LEADER" }],
    capturedAt: "2026-07-24T15:30:00.000Z",
  };
  const rosterResult = await request("/api/public/guilds/UNREG/roster", { method: "POST", body: roster });
  assert.equal(rosterResult.response.status, 404);
  assert.equal(rosterResult.body.error.code, "guild_not_found");

  const trialsResult = await request("/api/public/guilds/UNREG/trial-registrations", {
    method: "POST",
    body: {
      guild: { id: 667, name: "Wandering ICarus" },
      reporter: { playerId: 1, memberId: "erdols" },
      weekStartAt: "2026-07-21T00:00:00.000Z",
      trials: [],
      capturedAt: "2026-07-24T15:30:00.000Z",
    },
  });
  assert.equal(trialsResult.response.status, 404);

  const weeklyResult = await request("/api/public/guilds/UNREG/weekly-trials", {
    method: "POST",
    body: { guild: { id: 667, name: "Wandering ICarus" } },
  });
  assert.equal(weeklyResult.response.status, 404);
});

test("WI reporters are eligible and can bootstrap roster without a prior admin member", async (t) => {
  const { request, db } = await harness(t);
  const eligibility = await request("/api/public/guilds/WI/members/adiudiu/eligibility");
  assert.equal(eligibility.response.status, 200);
  assert.equal(eligibility.body.eligible, true);
  assert.equal(eligibility.body.rosterSyncAllowed, true);

  const outsider = await request("/api/public/guilds/WI/members/not-in-wi/eligibility");
  assert.equal(outsider.body.eligible, false);
  assert.equal(outsider.body.rosterSyncAllowed, false);

  db.prepare("UPDATE members SET active = 0 WHERE guild_id = 'WI'").run();
  const afterPrune = await request("/api/public/guilds/WI/members/adiudiu/eligibility");
  assert.equal(afterPrune.body.eligible, true);
  assert.equal(afterPrune.body.rosterSyncAllowed, true);

  const roster = {
    guild: { id: 667, name: "Wandering ICarus" },
    reporter: { playerId: 219761, memberId: "adiudiu" },
    members: [
      { playerId: 219761, memberId: "adiudiu", status: "ACTIVE", guildRole: "MEMBER" },
      { playerId: 2, memberId: "erdols", status: "ACTIVE", guildRole: "LEADER" },
    ],
    capturedAt: "2026-08-28T00:00:00.000Z",
  };
  const synced = await request("/api/public/guilds/WI/roster", { method: "POST", body: roster });
  assert.equal(synced.response.status, 200);
  assert.equal(synced.body.memberCount, 2);

  const restored = await request("/api/public/guilds/WI/members/erdols/eligibility");
  assert.equal(restored.body.eligible, true);
  assert.equal(restored.body.rosterSyncAllowed, true);
});

test("WI public ingest succeeds and does not mutate TMD rows", async (t) => {
  const { request, admin, db } = await harness(t);
  await admin("/api/admin/guilds/TMD", { method: "PUT", body: { name: "TMD" } });
  await admin("/api/admin/guilds/TMD/members", {
    method: "PUT",
    body: { memberId: "adudu", displayName: "adudu", memberToken: "tmd-member-secret" },
  });
  await admin("/api/admin/guilds/TMD/qq-bindings/99990001", {
    method: "PUT",
    body: { memberId: "adudu", combatType: "弓" },
  });
  await admin("/api/admin/guilds/TMD/assignments/formal", {
    method: "PUT",
    body: { locked: true, assignment: { name: "formal-plan" } },
  });
  await admin("/api/admin/guilds/TMD/assignments/test", {
    method: "PUT",
    body: { locked: false, assignment: { name: "test-plan" } },
  });
  await admin("/api/admin/guilds/WI", { method: "PUT", body: { name: "WI" } });
  await admin("/api/admin/guilds/WI/members", {
    method: "PUT",
    body: { memberId: "erdols", displayName: "erdols", memberToken: "wi-member-secret" },
  });

  const tmdRowsBefore = countTmdTableRows(db);
  const wiGuild = { id: 667, name: "Wandering ICarus" };
  const roster = {
    guild: wiGuild,
    reporter: { playerId: 1, memberId: "erdols" },
    members: [
      { playerId: 1, memberId: "erdols", status: "ACTIVE", guildRole: "LEADER" },
      { playerId: 2, memberId: "adiudiu", status: "ACTIVE", guildRole: "MEMBER" },
    ],
    capturedAt: "2026-07-24T15:30:00.000Z",
  };
  assert.equal((await request("/api/public/guilds/WI/roster", { method: "POST", body: roster })).response.status, 200);

  const rejectedOnTmd = await request("/api/public/guilds/TMD/roster", { method: "POST", body: roster });
  assert.notEqual(rejectedOnTmd.response.status, 200);
  assert.notEqual(rejectedOnTmd.response.status, 201);
  assert.equal(rejectedOnTmd.body.error.code, "not_tmd_guild");

  const registrations = {
    guild: wiGuild,
    reporter: { playerId: 1, memberId: "erdols" },
    weekStartAt: "2026-07-24T00:00:00.000Z",
    capturedAt: "2026-07-27T05:01:00.000Z",
    trials: [{
      trialHrid: "/guild_combat/jellyfish",
      trialName: "Trial Jellyfish",
      registeredCount: 1,
      members: [{ playerId: 1, memberId: "erdols", roleHrid: "damage_dealer", level: 140 }],
    }],
  };
  assert.equal(
    (await request("/api/public/guilds/WI/trial-registrations", { method: "POST", body: registrations })).response.status,
    201,
  );
  const trialsRejectedOnTmd = await request("/api/public/guilds/TMD/trial-registrations", { method: "POST", body: registrations });
  assert.notEqual(trialsRejectedOnTmd.response.status, 200);
  assert.notEqual(trialsRejectedOnTmd.response.status, 201);
  assert.equal(trialsRejectedOnTmd.body.error.code, "not_tmd_guild");

  const monster = (monsterHrid, name, maxHp, resistance) => ({
    monsterHrid,
    name,
    level: 100,
    combatStyleHrids: ["/combat_styles/magic"],
    damageTypeHrid: "/damage_types/water",
    attackIntervalSeconds: 1.9,
    castSpeedPercent: 55,
    abilityHaste: 80,
    maxHp,
    maxMp: maxHp,
    accuracy: { magic: 418 },
    damage: { defensive: 110, magic: 352 },
    evasion: { stab: 770, slash: 770, smash: 770, ranged: 396, magic: 517 },
    armor: 200,
    resistance,
    tenacity: 3000,
    threat: 100,
    abilities: [{ abilityHrid: "/abilities/water_strike", level: 60, minDifficultyTier: 0 }],
  });
  const weeklyTrials = {
    guild: wiGuild,
    reporter: { playerId: 1, memberId: "erdols" },
    weekStartAt: "2026-07-24T00:00:00.000Z",
    weeklyTrialSet: {
      skillHrids: [
        "/guild_skilling/milking",
        "/guild_skilling/woodcutting",
        "/guild_skilling/crafting",
        "/guild_skilling/alchemy",
      ],
      combatHrids: ["/guild_combat/jellyfish", "/guild_combat/hedgehog"],
    },
    trials: [
      ...[
        ["/guild_skilling/milking", "Milking", "/skills/milking", "/action_types/milking", 24, 20],
        ["/guild_skilling/woodcutting", "Woodcutting", "/skills/woodcutting", "/action_types/woodcutting", 24, 18],
        ["/guild_skilling/crafting", "Crafting", "/skills/crafting", "/action_types/crafting", 24, 22],
        ["/guild_skilling/alchemy", "Alchemy", "/skills/alchemy", "/action_types/alchemy", 24, 19],
      ].map(([trialHrid, trialName, skillHrid, actionTypeHrid, maxParticipants, signedUpCount]) => ({
        trialHrid,
        trialName,
        kind: "skilling",
        skillHrid,
        actionTypeHrid,
        maxParticipants,
        signedUpCount,
        monsterHrids: [],
        monsters: [],
      })),
      {
        trialHrid: "/guild_combat/jellyfish",
        trialName: "Trial Jellyfish",
        kind: "combat",
        skillHrid: "",
        actionTypeHrid: "",
        monsterHrids: ["/monsters/guild_trial_jellyfish"],
        monsters: [monster("/monsters/guild_trial_jellyfish", "Trial Jellyfish", 495000, { water: 280, nature: 160, fire: 280 })],
        maxParticipants: 48,
        signedUpCount: 40,
      },
      {
        trialHrid: "/guild_combat/hedgehog",
        trialName: "Trial Hedgehog",
        kind: "combat",
        skillHrid: "",
        actionTypeHrid: "",
        monsterHrids: ["/monsters/guild_trial_hedgehog"],
        monsters: [monster("/monsters/guild_trial_hedgehog", "Trial Hedgehog", 440000, { water: 270, nature: 270, fire: 160 })],
        maxParticipants: 48,
        signedUpCount: 35,
      },
    ],
    capturedAt: "2026-07-27T08:00:01.000Z",
  };
  assert.equal(
    (await request("/api/public/guilds/WI/weekly-trials", { method: "POST", body: weeklyTrials })).response.status,
    201,
  );
  const weeklyRejectedOnTmd = await request("/api/public/guilds/TMD/weekly-trials", { method: "POST", body: weeklyTrials });
  assert.notEqual(weeklyRejectedOnTmd.response.status, 200);
  assert.notEqual(weeklyRejectedOnTmd.response.status, 201);
  assert.equal(weeklyRejectedOnTmd.body.error.code, "not_tmd_guild");

  const wiSnapshot = snapshot({
    guildId: "WI",
    memberId: "erdols",
    displayName: "erdols",
    approvedBuilds: [],
    confidence: "capability-only",
  });
  assert.equal(
    (await request("/api/public/guilds/WI/members/erdols/snapshots", { method: "POST", body: wiSnapshot })).response.status,
    201,
  );
  const snapshotRejectedOnTmd = await request("/api/public/guilds/TMD/members/erdols/snapshots", { method: "POST", body: wiSnapshot });
  assert.notEqual(snapshotRejectedOnTmd.response.status, 200);
  assert.notEqual(snapshotRejectedOnTmd.response.status, 201);

  assert.deepEqual(countTmdTableRows(db), tmdRowsBefore);

  const wiReporterOnTmd = await request("/api/public/guilds/TMD/roster", {
    method: "POST",
    body: {
      guild: { id: 369, name: "TMD" },
      reporter: { playerId: 1, memberId: "erdols" },
      members: [{ playerId: 1, memberId: "erdols", status: "ACTIVE", guildRole: "LEADER" }],
      capturedAt: "2026-07-24T15:31:00.000Z",
    },
  });
  assert.equal(wiReporterOnTmd.response.status, 403);
  assert.equal(wiReporterOnTmd.body.error.code, "roster_reporter_not_allowed");

  const tmdReporterOnWi = await request("/api/public/guilds/WI/roster", {
    method: "POST",
    body: {
      ...roster,
      reporter: { playerId: 99, memberId: "adudu" },
      members: [
        { playerId: 99, memberId: "adudu", status: "ACTIVE", guildRole: "LEADER" },
        ...roster.members,
      ],
      capturedAt: "2026-07-24T15:32:00.000Z",
    },
  });
  assert.equal(tmdReporterOnWi.response.status, 403);
  assert.equal(tmdReporterOnWi.body.error.code, "roster_reporter_not_allowed");
});

test("TMD roster sync accepts guilds larger than one hundred members", async (t) => {
  const { request, admin } = await harness(t);
  await admin("/api/admin/guilds/TMD", { method: "PUT", body: { name: "TMD" } });
  await admin("/api/admin/guilds/TMD/members", { method: "PUT", body: { memberId: "adudu", displayName: "adudu", memberToken: "large-roster-reporter-secret" } });
  const members = [
    { playerId: 1, memberId: "adudu", status: "ACTIVE", guildRole: "LEADER" },
    ...Array.from({ length: 119 }, (_, index) => ({
      playerId: index + 2,
      memberId: `member${String(index + 2).padStart(3, "0")}`,
      status: "ACTIVE",
      guildRole: "MEMBER",
    })),
  ];
  const result = await request("/api/public/guilds/TMD/roster", {
    method: "POST",
    body: {
      guild: { id: 369, name: "TMD" },
      reporter: { playerId: 1, memberId: "adudu" },
      members,
      capturedAt: "2026-07-24T15:35:00.000Z",
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.memberCount, 120);
});

test("TMD trial registration sync stores complete current boss rosters", async (t) => {
  const { request, admin } = await harness(t);
  await admin("/api/admin/guilds/TMD", {
    method: "PUT",
    body: { name: "TMD" },
  });
  await admin("/api/admin/guilds/TMD/members", {
    method: "PUT",
    body: {
      memberId: "adudu",
      displayName: "adudu",
      memberToken: "trial-reporter-secret",
    },
  });
  const roster = {
    guild: { id: 369, name: "TMD" },
    reporter: { playerId: 1, memberId: "adudu" },
    members: [
      { playerId: 1, memberId: "adudu", status: "ACTIVE", guildRole: "LEADER" },
      { playerId: 2, memberId: "sh1ro", status: "ACTIVE", guildRole: "MEMBER" },
      { playerId: 3, memberId: "kogge", status: "ACTIVE", guildRole: "MEMBER" },
    ],
    capturedAt: "2026-07-27T05:00:00.000Z",
  };
  assert.equal(
    (await request("/api/public/guilds/TMD/roster", {
      method: "POST",
      body: roster,
    })).response.status,
    200,
  );
  const registrations = {
    guild: { id: 369, name: "TMD" },
    reporter: { playerId: 1, memberId: "adudu" },
    weekStartAt: "2026-07-24T00:00:00.000Z",
    capturedAt: "2026-07-27T05:01:00.000Z",
    trials: [
      {
        trialHrid: "/guild_combat/jellyfish",
        trialName: "客户端翻译不作为信任来源",
        registeredCount: 2,
        members: [
          {
            playerId: 1,
            memberId: "adudu",
            roleHrid: "damage_dealer",
            level: 145,
          },
          {
            playerId: 2,
            memberId: "sh1ro",
            roleHrid: "support",
            level: 144,
          },
        ],
      },
      {
        trialHrid: "/guild_combat/hedgehog",
        trialName: "Trial Hedgehog",
        registeredCount: 1,
        members: [{
          playerId: 3,
          memberId: "kogge",
          roleHrid: "",
          level: 140,
        }],
      },
    ],
  };
  const accepted = await request(
    "/api/public/guilds/TMD/trial-registrations",
    { method: "POST", body: registrations },
  );
  assert.equal(accepted.response.status, 201);
  assert.deepEqual(
    accepted.body.trials.map((trial) => trial.registeredCount),
    [2, 1],
  );

  const current = await admin(
    "/api/guilds/TMD/trial-registrations/current",
  );
  assert.equal(current.response.status, 200);
  assert.equal(current.body.trials.length, 2);
  const jellyfish = current.body.trials.find((trial) =>
    trial.trialHrid === "/guild_combat/jellyfish"
  );
  assert.equal(jellyfish.trialName, "试炼水母");
  assert.deepEqual(
    jellyfish.members.map((member) => member.memberId),
    ["adudu", "sh1ro"],
  );

  const partial = await request(
    "/api/public/guilds/TMD/trial-registrations",
    {
      method: "POST",
      body: {
        ...registrations,
        trials: [{
          ...registrations.trials[0],
          registeredCount: 47,
        }],
      },
    },
  );
  assert.equal(partial.response.status, 400);
  assert.equal(partial.body.error.code, "incomplete_trial_roster");
});

test("trial registrations accept skilling member lists alongside combat", async (t) => {
  const { request, admin } = await harness(t);
  await admin("/api/admin/guilds/TMD", { method: "PUT", body: { name: "TMD" } });
  await admin("/api/admin/guilds/TMD/members", {
    method: "PUT",
    body: {
      memberId: "adudu",
      displayName: "adudu",
      memberToken: "trial-reporter-secret",
    },
  });
  const roster = {
    guild: { id: 369, name: "TMD" },
    reporter: { playerId: 1, memberId: "adudu" },
    members: [
      { playerId: 1, memberId: "adudu", status: "ACTIVE", guildRole: "LEADER" },
      { playerId: 2, memberId: "sh1ro", status: "ACTIVE", guildRole: "MEMBER" },
      { playerId: 3, memberId: "kogge", status: "ACTIVE", guildRole: "MEMBER" },
    ],
    capturedAt: "2026-08-07T05:00:00.000Z",
  };
  assert.equal(
    (await request("/api/public/guilds/TMD/roster", {
      method: "POST",
      body: roster,
    })).response.status,
    200,
  );
  const registrations = {
    guild: { id: 369, name: "TMD" },
    reporter: { playerId: 1, memberId: "adudu" },
    weekStartAt: "2026-08-07T00:00:00.000Z",
    capturedAt: "2026-08-07T05:01:00.000Z",
    trials: [
      {
        trialHrid: "/guild_combat/chameleon",
        trialName: "试炼变色龙",
        registeredCount: 1,
        members: [{
          playerId: 1,
          memberId: "adudu",
          roleHrid: "damage_dealer",
          level: 145,
        }],
      },
      {
        trialHrid: "/guild_skilling/cooking",
        trialName: "烹饪",
        registeredCount: 2,
        members: [
          {
            playerId: 2,
            memberId: "sh1ro",
            roleHrid: "",
            level: 120,
          },
          {
            playerId: 3,
            memberId: "kogge",
            roleHrid: "",
            level: 110,
          },
        ],
      },
    ],
  };
  const accepted = await request(
    "/api/public/guilds/TMD/trial-registrations",
    { method: "POST", body: registrations },
  );
  assert.equal(accepted.response.status, 201);

  const current = await admin("/api/guilds/TMD/trial-registrations/current");
  assert.equal(current.response.status, 200);
  const cooking = current.body.trials.find((trial) =>
    trial.trialHrid === "/guild_skilling/cooking"
  );
  assert.equal(cooking.kind, "skilling");
  assert.equal(cooking.trialName, "烹饪");
  assert.deepEqual(
    cooking.members.map((member) => member.memberId),
    ["sh1ro", "kogge"],
  );

  // Same member may join one combat + one skilling trial.
  const sameMemberBoth = await request(
    "/api/public/guilds/TMD/trial-registrations",
    {
      method: "POST",
      body: {
        ...registrations,
        trials: [
          {
            trialHrid: "/guild_combat/swarm",
            trialName: "试炼虫群",
            registeredCount: 1,
            members: [{
              playerId: 2,
              memberId: "sh1ro",
              roleHrid: "support",
              level: 140,
            }],
          },
          {
            trialHrid: "/guild_skilling/crafting",
            trialName: "制作",
            registeredCount: 1,
            members: [{
              playerId: 2,
              memberId: "sh1ro",
              roleHrid: "",
              level: 130,
            }],
          },
        ],
      },
    },
  );
  assert.equal(sameMemberBoth.response.status, 201);
});

test("adudu login sync stores this week's skilling/combat trials and monster panels", async (t) => {
  const { request, admin } = await harness(t);
  await admin("/api/admin/guilds/TMD", { method: "PUT", body: { name: "TMD" } });
  await admin("/api/admin/guilds/TMD/members", {
    method: "PUT",
    body: { memberId: "adudu", displayName: "adudu", memberToken: "weekly-trial-reporter-secret" },
  });
  const roster = {
    guild: { id: 369, name: "TMD" },
    reporter: { playerId: 195739, memberId: "adudu" },
    members: [{ playerId: 195739, memberId: "adudu", status: "ACTIVE", guildRole: "LEADER" }],
    capturedAt: "2026-07-27T08:00:00.000Z",
  };
  assert.equal((await request("/api/public/guilds/TMD/roster", { method: "POST", body: roster })).response.status, 200);
  const monster = (monsterHrid, name, maxHp, resistance) => ({
    monsterHrid,
    name,
    level: 100,
    combatStyleHrids: ["/combat_styles/magic"],
    damageTypeHrid: "/damage_types/water",
    attackIntervalSeconds: 1.9,
    castSpeedPercent: 55,
    abilityHaste: 80,
    maxHp,
    maxMp: maxHp,
    accuracy: { magic: 418 },
    damage: { defensive: 110, magic: 352 },
    evasion: { stab: 770, slash: 770, smash: 770, ranged: 396, magic: 517 },
    armor: 200,
    resistance,
    tenacity: 3000,
    threat: 100,
    abilities: [{ abilityHrid: "/abilities/water_strike", level: 60, minDifficultyTier: 0 }],
  });
  const payload = {
    guild: { id: 369, name: "TMD" },
    reporter: { playerId: 195739, memberId: "adudu" },
    weekStartAt: "2026-07-24T00:00:00.000Z",
    weeklyTrialSet: {
      skillHrids: [
        "/guild_skilling/milking",
        "/guild_skilling/woodcutting",
        "/guild_skilling/crafting",
        "/guild_skilling/alchemy",
      ],
      combatHrids: ["/guild_combat/jellyfish", "/guild_combat/hedgehog"],
    },
    trials: [
      ...[
        ["/guild_skilling/milking", "挤奶", "/skills/milking", "/action_types/milking", 24, 23],
        ["/guild_skilling/woodcutting", "伐木", "/skills/woodcutting", "/action_types/woodcutting", 24, 18],
        ["/guild_skilling/crafting", "制作", "/skills/crafting", "/action_types/crafting", 24, 23],
        ["/guild_skilling/alchemy", "炼金", "/skills/alchemy", "/action_types/alchemy", 24, 21],
      ].map(([trialHrid, trialName, skillHrid, actionTypeHrid, maxParticipants, signedUpCount]) => ({
        trialHrid,
        trialName,
        kind: "skilling",
        skillHrid,
        actionTypeHrid,
        maxParticipants,
        signedUpCount,
        monsterHrids: [],
        monsters: [],
      })),
      {
        trialHrid: "/guild_combat/jellyfish",
        trialName: "试炼水母",
        kind: "combat",
        skillHrid: "",
        actionTypeHrid: "",
        monsterHrids: ["/monsters/guild_trial_jellyfish"],
        monsters: [monster("/monsters/guild_trial_jellyfish", "Trial Jellyfish", 495000, { water: 280, nature: 160, fire: 280 })],
        maxParticipants: 48,
        signedUpCount: 47,
      },
      {
        trialHrid: "/guild_combat/hedgehog",
        trialName: "试炼刺猬",
        kind: "combat",
        skillHrid: "",
        actionTypeHrid: "",
        monsterHrids: ["/monsters/guild_trial_hedgehog"],
        monsters: [monster("/monsters/guild_trial_hedgehog", "Trial Hedgehog", 440000, { water: 270, nature: 270, fire: 160 })],
        maxParticipants: 48,
        signedUpCount: 48,
      },
    ],
    capturedAt: "2026-07-27T08:00:01.000Z",
  };
  const accepted = await request("/api/public/guilds/TMD/weekly-trials", { method: "POST", body: payload });
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.body.skillTrialCount, 4);
  assert.equal(accepted.body.combatTrialCount, 2);
  assert.equal(accepted.body.monsterCount, 2);

  const current = await admin("/api/guilds/TMD/weekly-trials/current");
  assert.equal(current.response.status, 200);
  assert.equal(current.body.weeklyTrialSet.skillHrids.length, 4);
  assert.equal(current.body.trials.filter((trial) => trial.kind === "combat").length, 2);
  assert.equal(
    current.body.trials.find((trial) => trial.trialHrid === "/guild_combat/jellyfish").monsters[0].maxHp,
    495000,
  );
  assert.equal(
    current.body.trials.find((trial) => trial.trialHrid === "/guild_skilling/milking").maxParticipants,
    24,
  );
  assert.equal(
    current.body.trials.find((trial) => trial.trialHrid === "/guild_combat/jellyfish").maxParticipants,
    48,
  );
  assert.equal(
    current.body.trials.find((trial) => trial.trialHrid === "/guild_skilling/milking").signedUpCount,
    23,
  );

  const missingMonsterPanels = await request("/api/public/guilds/TMD/weekly-trials", {
    method: "POST",
    body: {
      ...payload,
      trials: payload.trials.map((trial) => trial.kind === "combat"
        ? { ...trial, monsterHrids: [], monsters: [] }
        : trial),
    },
  });
  assert.equal(missingMonsterPanels.response.status, 400);
  assert.equal(missingMonsterPanels.body.error.code, "incomplete_weekly_monsters");

  const incomplete = await request("/api/public/guilds/TMD/weekly-trials", {
    method: "POST",
    body: {
      ...payload,
      weeklyTrialSet: { ...payload.weeklyTrialSet, skillHrids: payload.weeklyTrialSet.skillHrids.slice(0, 3) },
      trials: payload.trials.slice(1),
    },
  });
  assert.equal(incomplete.response.status, 400);
  assert.equal(incomplete.body.error.code, "incomplete_weekly_trial_set");
});

test("member userscript is served from the public API origin without caching", async (t) => {
  const source = "// ==UserScript==\n// @version 9.9.9\n";
  const pluginUrl = new URL("../../.local/test-member-plugin.user.js", import.meta.url);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(pluginUrl, source));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(pluginUrl, { force: true })));
  const api = await createGuildApi({
    adminKey: "test-admin-key",
    fixture,
    dbPath: ":memory:",
    memberPluginPath: pluginUrl,
  });
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/mwi-guild-trial-exporter.user.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/javascript/);
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.equal(await response.text(), source);
});

test("public guild routes allow CORS from MWI game origins for iOS Focus fetch", async (t) => {
  const api = await createGuildApi({ adminKey: "test-admin-key", fixture, dbPath: ":memory:" });
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const eligibility = `${base}/api/public/guilds/TMD/members/adudu/eligibility`;
  const gameOrigin = "https://www.milkywayidlecn.com";

  const preflight = await fetch(eligibility, {
    method: "OPTIONS",
    headers: {
      origin: gameOrigin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), gameOrigin);
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /content-type/i);
  assert.equal(await preflight.text(), "");

  const allowed = await fetch(eligibility, { headers: { origin: gameOrigin } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), gameOrigin);

  const intl = await fetch(eligibility, { headers: { origin: "https://test.milkywayidle.com" } });
  assert.equal(intl.headers.get("access-control-allow-origin"), "https://test.milkywayidle.com");

  const blocked = await fetch(eligibility, { headers: { origin: "https://evil.example" } });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);

  const httpOrigin = await fetch(eligibility, { headers: { origin: "http://www.milkywayidle.com" } });
  assert.equal(httpOrigin.headers.get("access-control-allow-origin"), null);

  const snapshotResponse = await fetch(`${base}/api/public/guilds/TMD/members/outsider/snapshots`, {
    method: "POST",
    headers: { origin: gameOrigin, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(snapshotResponse.status, 403);
  assert.equal(snapshotResponse.headers.get("access-control-allow-origin"), gameOrigin);
});

test("sensitive snapshot fields are rejected rather than persisted", async (t) => {
  const { request } = await harness(t);
  const result = await request("/api/guilds/guild-1/members/member-1/snapshots", { method: "POST", headers: { authorization: "Bearer member-secret" }, body: snapshot({ discordToken: "must-not-store" }) });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "sensitive_field_rejected");
});

test("formal and test assignments remain isolated", async (t) => {
  const { admin } = await harness(t);
  await admin("/api/admin/guilds/guild-1/assignments/formal", { method: "PUT", body: { locked: true, assignment: { name: "formal-plan" } } });
  await admin("/api/admin/guilds/guild-1/assignments/test", { method: "PUT", body: { locked: false, assignment: { name: "test-plan" } } });
  const formal = await admin("/api/guilds/guild-1/assignments/formal");
  const preview = await admin("/api/guilds/guild-1/assignments/test");
  assert.deepEqual(formal.body.assignment, { name: "formal-plan" });
  assert.equal(formal.body.locked, true);
  assert.deepEqual(preview.body.assignment, { name: "test-plan" });
  assert.equal(preview.body.locked, false);
});

test("development or invalidated test assignments cannot be promoted to formal", async (t) => {
  const { admin } = await harness(t);
  const rejected = await admin("/api/admin/guilds/guild-1/assignments/formal", {
    method: "PUT",
    body: {
      locked: true,
      assignment: { kind: "development-lab", promotable: false },
    },
  });
  assert.equal(rejected.response.status, 409);
  assert.equal(rejected.body.error.code, "assignment_not_promotable");
});

test("cancelling a blocked job safely finalizes without publishing a partial assignment", async (t) => {
  const { admin } = await harness(t);
  const started = await admin("/api/guilds/guild-1/jobs", { method: "POST", body: { mode: "test" } });
  assert.equal(started.response.status, 202);
  assert.equal(started.body.status, "blocked");
  const stopped = await admin(`/api/guilds/guild-1/jobs/${started.body.id}`, { method: "DELETE" });
  assert.equal(stopped.response.status, 200);
  assert.equal(stopped.body.status, "cancelled");
  assert.equal(stopped.body.cancellation, "safe-finalized");
  assert.equal(stopped.body.result.finalization, "safe-no-partial-assignment-published");
  const full = await admin("/api/guilds/guild-1/jobs", { method: "POST", body: { mode: "full" } });
  assert.equal(full.response.status, 409);
  assert.equal(full.body.error.code, "simulation_unsupported");
});

test("one QQ may bind multiple current guild characters, including the same combat type", async (t) => {
  const { admin } = await harness(t);
  await admin("/api/admin/guilds/guild-1/members", {
    method: "PUT",
    body: {
      memberId: "member-2",
      displayName: "Second",
      memberToken: "member-secret-2",
    },
  });
  const first = await admin("/api/admin/guilds/guild-1/qq-bindings/12345678", {
    method: "PUT",
    body: { memberId: "member-1", combatType: "火" },
  });
  const second = await admin("/api/admin/guilds/guild-1/qq-bindings/12345678", {
    method: "PUT",
    body: { memberId: "member-2", combatType: "火" },
  });
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.qqNumber, "12345678");

  const listed = await admin("/api/guilds/guild-1/qq-bindings?qqNumber=12345678");
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.body.bindings.map((row) => row.memberId), [
    "member-1",
    "member-2",
  ]);

  const removed = await admin("/api/admin/guilds/guild-1/qq-bindings/by-member/member-1", {
    method: "DELETE",
  });
  assert.equal(removed.response.status, 200);
  const after = await admin("/api/guilds/guild-1/qq-bindings?qqNumber=12345678");
  assert.deepEqual(after.body.bindings.map((row) => row.memberId), ["member-2"]);
});

test("member directory exposes latest snapshots without credential hashes", async (t) => {
  const { request, admin } = await harness(t);
  await request("/api/guilds/guild-1/members/member-1/snapshots", {
    method: "POST",
    headers: { authorization: "Bearer member-secret" },
    body: snapshot(),
  });
  const result = await admin("/api/guilds/guild-1/members");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.members[0].memberId, "member-1");
  assert.equal(result.body.members[0].latestSnapshot.schemaVersion, "2");
  assert.equal(result.body.members[0].latestSnapshot.loadoutCatalog.length, 2);
  assert.equal(result.body.members[0].latestSnapshot.loadoutCatalog[1].category, "profession");
  assert.equal(JSON.stringify(result.body).includes("member-secret"), false);
  assert.equal(JSON.stringify(result.body).includes("member_token"), false);
});

test("NapCat QR routes require Tailscale identity and reject Funnel-style requests", async (t) => {
  const { mkdtemp, writeFile: writeTemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "mwi-napcat-qr-"));
  const qrPath = join(dir, "qrcode.png");
  await writeTemp(qrPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });

  let restartCount = 0;
  const api = await createGuildApi({
    adminKey: "test-admin-key",
    fixture,
    dbPath: ":memory:",
    napcatQrToken: "qr-secret",
    napcatQrPath: qrPath,
    napcatQrAllowedLogins: "alice@example.com,bob@example.com",
    napcatQrRunner: async () => { restartCount += 1; return { code: 0, stderr: "" }; },
  });
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${api.server.address().port}`;
  t.after(() => api.close());

  const funnel = await fetch(`${base}/napcat-qr?token=qr-secret`);
  assert.equal(funnel.status, 403);
  assert.equal((await funnel.json()).error.code, "tailscale_only");

  const badToken = await fetch(`${base}/napcat-qr?token=wrong`, {
    headers: { "tailscale-user-login": "alice@example.com" },
  });
  assert.equal(badToken.status, 401);

  const deniedUser = await fetch(`${base}/napcat-qr?token=qr-secret`, {
    headers: { "tailscale-user-login": "carol@example.com" },
  });
  assert.equal(deniedUser.status, 403);
  assert.equal((await deniedUser.json()).error.code, "tailscale_user_not_allowed");

  const page = await fetch(`${base}/napcat-qr?token=qr-secret`, {
    headers: { "tailscale-user-login": "Alice@example.com" },
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /仅 Tailscale 成员可访问/);

  const png = await fetch(`${base}/napcat-qr.png?token=qr-secret`, {
    headers: { "tailscale-user-login": "alice@example.com" },
  });
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.equal((await png.arrayBuffer()).byteLength, 8);

  const refreshed = await fetch(`${base}/napcat-qr/refresh?token=qr-secret`, {
    method: "POST",
    headers: { "tailscale-user-login": "bob@example.com" },
  });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).ok, true);
  assert.equal(restartCount, 1);
});

test("NapCat QR returns 503 when token is not configured", async (t) => {
  const api = await createGuildApi({ adminKey: "test-admin-key", fixture, dbPath: ":memory:" });
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${api.server.address().port}`;
  t.after(() => api.close());
  const response = await fetch(`${base}/napcat-qr?token=anything`, {
    headers: { "tailscale-user-login": "alice@example.com" },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "napcat_qr_unconfigured");
});

test("admin can upload and read test report assets from MWI_TEST_REPORT_DIR", async (t) => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const reportDirectory = await mkdtemp(join(tmpdir(), "mwi-test-report-"));
  const api = await createGuildApi({
    adminKey: "test-admin-key",
    fixture,
    dbPath: ":memory:",
    testReportDirectory: reportDirectory,
  });
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const admin = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-admin-key": "test-admin-key",
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { response, body: await response.json() };
  };
  await admin("/api/admin/guilds/guild-1", { method: "PUT", body: { name: "Test Guild" } });

  const png = Buffer.alloc(12_000, 1).toString("base64");
  const uploaded = await admin("/api/guilds/guild-1/test-report-assets", {
    method: "PUT",
    body: {
      assignmentGeneratedAt: "2026-07-31T10:17:46.697Z",
      files: [
        { title: "A summary", fileName: "1-jellyfish-summary.png", base64: png },
        { title: "A members", fileName: "1-jellyfish-members.png", base64: png },
        { title: "B summary", fileName: "2-hedgehog-summary.png", base64: png },
        { title: "B members", fileName: "2-hedgehog-members.png", base64: png },
      ],
    },
  });
  assert.equal(uploaded.response.status, 200);
  assert.equal(uploaded.body.files.length, 4);

  const fetched = await admin("/api/guilds/guild-1/test-report-assets");
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.assignmentGeneratedAt, "2026-07-31T10:17:46.697Z");
  assert.equal(fetched.body.files[0].fileName, "1-jellyfish-summary.png");
  assert.equal(fetched.body.files[0].base64, png);
});
