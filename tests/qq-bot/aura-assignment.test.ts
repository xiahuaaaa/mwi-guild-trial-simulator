import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateUniqueAuras,
  formatAuraAssignments,
} from "../../apps/qq-bot/src/aura-assignment.ts";

function member(
  memberId: string,
  auras?: Record<string, number>,
): Record<string, unknown> {
  return {
    memberId,
    displayName: memberId,
    latestSnapshot: auras ? { auras } : null,
  };
}

test("unique aura allocation never assigns two auras to one member", () => {
  const registrations = [
    { memberId: "Alice", roleHrid: "damage_dealer" },
    { memberId: "Bob", roleHrid: "support" },
    { memberId: "Carol", roleHrid: "tank" },
    { memberId: "Dan", roleHrid: "support" },
    { memberId: "Eve", roleHrid: "damage_dealer" },
  ];
  const directory = [
    member("Alice", {
      "/abilities/speed_aura": 100,
      "/abilities/critical_aura": 100,
    }),
    member("Bob", {
      "/abilities/speed_aura": 90,
      "/abilities/guardian_aura": 80,
    }),
    member("Carol", { "/abilities/guardian_aura": 70 }),
    member("Dan", { "/abilities/fierce_aura": 60 }),
    member("Eve", { "/abilities/mystic_aura": 50 }),
  ];
  const result = allocateUniqueAuras(registrations, directory);
  const selected = result.choices.filter(Boolean).map((choice) =>
    choice!.memberId
  );
  assert.equal(selected.length, 5);
  assert.equal(new Set(selected).size, 5);
  assert.equal(result.choices[0]?.memberId, "Bob");
  assert.equal(result.choices[3]?.memberId, "Alice");
});

test("aura assignment is computed separately for each registered boss roster", () => {
  const directory = [
    member("WaterMember", {
      "/abilities/speed_aura": 60,
      "/abilities/guardian_aura": 50,
    }),
    member("HedgeMember", {
      "/abilities/speed_aura": 70,
      "/abilities/guardian_aura": 40,
    }),
  ];
  const text = formatAuraAssignments([
    {
      trialHrid: "/guild_combat/jellyfish",
      trialName: "试炼水母",
      weekStartAt: "2026-07-24T00:00:00.000Z",
      registeredCount: 1,
      members: [{ memberId: "WaterMember", roleHrid: "support" }],
    },
    {
      trialHrid: "/guild_combat/hedgehog",
      trialName: "试炼刺猬",
      weekStartAt: "2026-07-24T00:00:00.000Z",
      registeredCount: 1,
      members: [{ memberId: "HedgeMember", roleHrid: "damage_dealer" }],
    },
  ], directory, new Date("2026-07-27T00:00:00.000Z"));
  assert.match(text, /试炼水母（报名 1 人）[\s\S]*速度光环：WaterMember Lv\.60/u);
  assert.match(text, /试炼刺猬（报名 1 人）[\s\S]*速度光环：HedgeMember Lv\.70/u);
  assert.match(text, /每人最多一种/u);
});

test("aura assignment reports members whose skill snapshot is missing", () => {
  const text = formatAuraAssignments([{
    trialName: "试炼水母",
    weekStartAt: "2026-07-24T00:00:00.000Z",
    registeredCount: 1,
    members: [{ memberId: "NoUpload" }],
  }], [member("NoUpload")], new Date("2026-07-27T00:00:00.000Z"));
  assert.match(text, /未上传技能 1 人：NoUpload/u);
});
