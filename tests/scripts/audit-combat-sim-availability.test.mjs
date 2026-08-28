import assert from "node:assert/strict";
import test from "node:test";
import { classifyBoundMember } from "../../scripts/audit-combat-sim-availability.mjs";
import { GUILD_TRIAL_MIN_ATTACK_LEVEL } from "../../packages/optimizer/src/combat-member-readiness.mjs";

test("classifyBoundMember: unbound", () => {
  const row = classifyBoundMember({
    memberId: "a",
    combatType: null,
    snapshot: { learnedAbilities: {} },
  });
  assert.equal(row.available, false);
  assert.equal(row.reason, "未绑定 QQ 战斗职业");
});

test("classifyBoundMember: missing snapshot", () => {
  const row = classifyBoundMember({
    memberId: "a",
    combatType: "枪",
    snapshot: null,
  });
  assert.equal(row.available, false);
  assert.equal(row.reason, "尚未上传成员快照");
});

test("classifyBoundMember: incomplete combat snapshot is unavailable", () => {
  const row = classifyBoundMember({
    memberId: "a",
    combatType: "盾",
    snapshot: {
      skills: { "/skills/attack": GUILD_TRIAL_MIN_ATTACK_LEVEL },
      learnedAbilities: {},
      loadoutCatalog: [],
      equipment: [],
    },
  });
  assert.equal(row.available, false);
  assert.match(
    row.reason,
    /快照缺少可用的对应职业装备|缺少不可默认技能|攻击等级/,
  );
});

test("classifyBoundMember: attack below guild trial floor is unavailable", () => {
  const row = classifyBoundMember({
    memberId: "a",
    combatType: "枪",
    snapshot: {
      skills: { "/skills/attack": GUILD_TRIAL_MIN_ATTACK_LEVEL - 1 },
      learnedAbilities: {
        "/abilities/berserk": 40,
        "/abilities/precision": 40,
        "/abilities/puncture": 40,
      },
      loadoutCatalog: [],
      equipment: [],
    },
  });
  assert.equal(row.available, false);
  assert.match(row.reason, /攻击等级不足/);
});
