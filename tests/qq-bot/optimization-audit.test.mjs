import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOptimizationAudit,
  formatMissingUploads,
  formatExpiredUploads,
  formatUnavailableRoster,
  listStaleBindingMemberIds,
  filterBindingsToActiveRoster,
} from "../../apps/qq-bot/src/api-client.ts";

test("optimization audit reports uploaded-unbound and bound-unuploaded members", () => {
  const text = formatOptimizationAudit(
    [
      {
        memberId: "uploaded-bound",
        displayName: "已上传且绑定",
        latestSnapshot: {
          snapshotId: "snapshot-1",
          skills: { "/skills/attack": 130 },
        },
      },
      {
        memberId: "uploaded-only",
        displayName: "只上传",
        latestSnapshot: {
          snapshotId: "snapshot-2",
          skills: { "/skills/attack": 130 },
        },
      },
      {
        memberId: "bound-only",
        displayName: "只绑定",
        latestSnapshot: null,
      },
      {
        memberId: "neither",
        displayName: "两项都缺",
        latestSnapshot: null,
      },
      {
        memberId: "low-attack",
        displayName: "攻击不足",
        latestSnapshot: {
          snapshotId: "snapshot-3",
          skills: { "/skills/attack": 100 },
        },
      },
    ],
    [
      { memberId: "uploaded-bound", combatType: "弓" },
      { memberId: "bound-only", combatType: "盾" },
      { memberId: "low-attack", combatType: "弩" },
    ],
  );

  assert.match(text, /未绑定职业：只上传、两项都缺/u);
  assert.match(text, /未上传配装：只绑定、两项都缺/u);
  assert.match(text, /已上传未绑定：只上传/u);
  assert.match(text, /已绑定未上传：只绑定/u);
  assert.match(text, /攻击<110不可参加试炼：只绑定（未上传攻击）、攻击不足（攻击100）/u);
});

test("optimization audit renders empty cross lists as none", () => {
  const text = formatOptimizationAudit(
    [{
      memberId: "ready",
      displayName: "完整成员",
      latestSnapshot: {
        snapshotId: "snapshot-1",
        skills: { "/skills/attack": 120 },
      },
    }],
    [{ memberId: "ready", combatType: "弩" }],
  );

  assert.match(text, /已上传未绑定：无/u);
  assert.match(text, /已绑定未上传：无/u);
  assert.match(text, /攻击<110不可参加试炼：无/u);
});

test("unavailable roster lists bound members failing combat readiness", () => {
  const text = formatUnavailableRoster(
    [
      {
        memberId: "MRBIRTHDAY",
        latestSnapshot: { skills: { "/skills/attack": 109 } },
      },
      {
        memberId: "DanileKo",
      },
    ],
    [
      { memberId: "MRBIRTHDAY", combatType: "自" },
      { memberId: "DanileKo", combatType: "弩" },
    ],
  );

  assert.match(text, /全库不可用/u);
  assert.match(text, /MRBIRTHDAY\/自\(攻击等级不足（109<110）\)/u);
  assert.match(text, /DanileKo\/弩\(尚未上传成员快照\)/u);
});

test("unavailable roster ignores bindings outside the active roster", () => {
  const text = formatUnavailableRoster(
    [{ memberId: "active", latestSnapshot: { skills: { "/skills/attack": 130 } } }],
    [{ memberId: "yida787", combatType: "剑" }],
  );

  assert.doesNotMatch(text, /yida787/u);
  assert.match(text, /全库不可用：无/u);
});

test("unavailable roster can note auto-pruned stale bindings", () => {
  const text = formatUnavailableRoster(
    [{ memberId: "active", latestSnapshot: { skills: { "/skills/attack": 130 } } }],
    [],
    { prunedMemberIds: ["DanileKo", "yida787"] },
  );

  assert.match(text, /已自动清理离会成员绑定：DanileKo、yida787/u);
});

test("stale binding helpers identify and filter inactive roster bindings", () => {
  const members = [{ memberId: "active" }];
  const bindings = [
    { memberId: "active", combatType: "弩" },
    { memberId: "yida787", combatType: "剑" },
  ];

  assert.deepEqual(listStaleBindingMemberIds(members, bindings), ["yida787"]);
  assert.deepEqual(filterBindingsToActiveRoster(members, bindings), [
    { memberId: "active", combatType: "弩" },
  ]);
});

test("unavailable roster reports none when no bound member fails readiness", () => {
  const text = formatUnavailableRoster([], []);

  assert.match(text, /全库不可用：无（已绑定 0 人/u);
});

test("missing uploads lists members without snapshots and counts uploaded", () => {
  const text = formatMissingUploads([
    {
      memberId: "uploaded",
      displayName: "已上传甲",
      latestSnapshot: { snapshotId: "snap-1" },
    },
    {
      memberId: "missing1",
      displayName: "缺失乙",
      latestSnapshot: null,
    },
    {
      memberId: "missing2",
      displayName: "缺失丙",
      latestSnapshot: null,
    },
  ]);

  assert.match(text, /未上传配装名单（2 人，仅当前在册成员）/u);
  assert.match(text, /缺失乙/u);
  assert.match(text, /缺失丙/u);
  assert.match(text, /已上传：1 \/ 共 3 人/u);
  assert.match(text, /公会插件/u);
});

test("missing uploads shows none when all members uploaded", () => {
  const text = formatMissingUploads([
    {
      memberId: "a",
      displayName: "甲",
      latestSnapshot: { snapshotId: "snap-1" },
    },
    {
      memberId: "b",
      displayName: "乙",
      latestSnapshot: { snapshotId: "snap-2" },
    },
  ]);

  assert.match(text, /未上传配装名单（0 人，仅当前在册成员）/u);
  assert.match(text, /无/u);
  assert.match(text, /已上传：2 \/ 共 2 人/u);
});

test("missing uploads with group members shows fuzzy match results", () => {
  const text = formatMissingUploads(
    [
      {
        memberId: "uploaded",
        displayName: "已上传甲",
        latestSnapshot: { snapshotId: "snap-1" },
      },
      {
        memberId: "missingInGroup",
        displayName: "缺失在群",
        latestSnapshot: null,
      },
      {
        memberId: "missingNotInGroup",
        displayName: "缺失不在群",
        latestSnapshot: null,
      },
    ],
    ["缺失在群(备注)", "其他群友", "另一个"],
  );

  assert.match(text, /未上传配装名单（2 人，仅当前在册成员）/u);
  assert.match(text, /缺失在群/u);
  assert.match(text, /缺失不在群/u);
  // "缺失在群" should fuzzy-match "缺失在群(备注)"
  assert.match(text, /⚠.*未在群内匹配到/u);
  assert.match(text, /缺失不在群/u);
  // "缺失在群" should NOT appear in the "not in group" section
  const afterWarning = text.slice(text.indexOf("⚠"));
  assert.ok(!afterWarning.includes("缺失在群"), "fuzzy-matched member should not appear in not-in-group list");
});

test("missing uploads with group members shows all matched when everyone matches", () => {
  const text = formatMissingUploads(
    [
      {
        memberId: "a",
        displayName: "玩家甲",
        latestSnapshot: null,
      },
      {
        memberId: "b",
        displayName: "玩家乙",
        latestSnapshot: null,
      },
    ],
    ["TMD丨玩家甲", "玩家乙-备注", "其他群友"],
  );

  assert.match(text, /未上传配装名单（2 人，仅当前在册成员）/u);
  assert.match(text, /✓.*所有未上传成员均在群内匹配到/u);
  assert.ok(!text.includes("⚠"));
});

test("missing uploads ignores single-letter group card false positives", () => {
  const text = formatMissingUploads(
    [
      {
        memberId: "atlus",
        displayName: "Atlus",
        latestSnapshot: null,
      },
    ],
    ["T", "m", "其他群友"],
  );

  const afterWarning = text.slice(text.indexOf("⚠"));
  assert.match(afterWarning, /Atlus/u);
});

test("expired uploads lists members with snapshots older than 7 days", () => {
  const now = new Date();
  const freshDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const staleDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const text = formatExpiredUploads([
    {
      memberId: "fresh",
      displayName: "新上传",
      latestSnapshot: { snapshotId: "snap-1" },
      snapshotReceivedAt: freshDate,
    },
    {
      memberId: "stale",
      displayName: "过期上传",
      latestSnapshot: { snapshotId: "snap-2" },
      snapshotReceivedAt: staleDate,
    },
    {
      memberId: "never",
      displayName: "从未上传",
      latestSnapshot: null,
      snapshotReceivedAt: null,
    },
  ]);

  assert.match(text, /上传过期名单（超过 7 天未更新，1 人）/u);
  assert.match(text, /过期上传/u);
  // 从未上传的不应出现在过期名单中
  assert.ok(!text.includes("从未上传"));
  assert.match(text, /已上传：2 \/ 共 3 人/u);
  assert.match(text, /公会插件/u);
});

test("expired uploads shows none when all snapshots are recent", () => {
  const now = new Date();
  const recentDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

  const text = formatExpiredUploads([
    {
      memberId: "a",
      displayName: "甲",
      latestSnapshot: { snapshotId: "snap-1" },
      snapshotReceivedAt: recentDate,
    },
  ]);

  assert.match(text, /上传过期名单（超过 7 天未更新，0 人）/u);
  assert.match(text, /无/u);
});
