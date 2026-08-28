import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOfficialQqEvent,
  normalizeOneBotEvent,
  parseCommand,
} from "../../../apps/qq-bot/src/core/index.ts";

test("parses every exact query and administrator command", () => {
  const cases: Array<[string, string]> = [
    ["帮助", "help"],
    ["菜单", "help"],
    ["指令", "help"],
    ["管理", "help-admin"],
    ["管理进阶", "help-admin-advanced"],
    ["本周分工", "latest-combat-assignment"],
    ["本周生活分工", "latest-life-assignment"],
    ["正式分工", "latest-combat-assignment"],
    ["本周正式分工", "latest-combat-assignment"],
    ["公会短板", "guild-bottleneck"],
    ["职业分布", "profession-distribution"],
    ["公会名单", "guild-roster"],
    ["未报名名单", "unregistered-trial-members"],
    ["试炼报名检查", "unregistered-trial-members"],
    ["未覆盖名单", "unregistered-trial-members"],
    ["分工未覆盖", "unregistered-trial-members"],
    ["报名检查", "signup-assignment-mismatches"],
    ["[报名检查]", "signup-assignment-mismatches"],
    ["【报名检查】", "signup-assignment-mismatches"],
    ["光环分配", "aura-assignment"],
    ["公会BOSS", "guild-bosses"],
    ["公会插件", "guild-plugin"],
    ["重算生活", "generate-life-assignment"],
    ["生活分工", "generate-life-assignment"],
    ["生活模拟", "generate-life-assignment"],
    ["[生活模拟]", "generate-life-assignment"],
    ["【生活模拟】", "generate-life-assignment"],
    ["试跑生活", "generate-life-assignment"],
    ["测试生活分工", "generate-life-assignment"],
    ["未上传名单", "missing-uploads"],
    ["上传过期名单", "expired-uploads"],
    ["上传最新插件", "upload-latest-plugin"],
    ["生活top20", "guild-report"],
    ["公会查询", "guild-report"],
    ["开始正式分工", "start-assignment"],
    ["开始分工", "start-assignment"],
    ["完全搜索分工", "start-assignment"],
    ["开始完全分工", "start-assignment"],
    ["分工进度", "assignment-progress"],
    ["终止分工", "stop-assignment"],
    ["模拟正式", "simulate-current-assignment"],
    ["当前分工模拟", "simulate-current-assignment"],
    ["数据体检", "optimization-audit"],
    ["优化", "optimization-audit"],
    ["不可用名单", "unavailable-roster"],
    ["装备检查", "equipment-check"],
    ["技能推荐", "skill-recommendation"],
    ["试跑战斗", "start-test-assignment"],
    ["测试分工", "start-test-assignment"],
    ["战斗模拟", "start-test-assignment"],
    ["[战斗模拟]", "start-test-assignment"],
    ["【战斗模拟】", "start-test-assignment"],
    ["本周战斗分工", "latest-combat-assignment"],
    ["本周测试分工", "latest-combat-assignment"],
    ["本周测试分工图片", "latest-combat-assignment"],
    ["测试分工图片", "latest-combat-assignment"],
    ["私聊本周分工", "current-test-assets"],
    ["当前测试", "current-test-assets"],
    ["转正方案", "promote-test-assignment"],
    ["测试分工转正", "promote-test-assignment"],
  ];

  for (const [input, kind] of cases) {
    const result = parseCommand(`  ${input}\n`);
    assert.equal(result.ok, true, input);
    if (result.ok) assert.equal(result.command.kind, kind, input);
  }

  const normal = parseCommand("开始正式分工");
  const exhaustive = parseCommand("完全搜索分工");
  assert.ok(normal.ok && normal.command.kind === "start-assignment");
  assert.ok(exhaustive.ok && exhaustive.command.kind === "start-assignment");
  if (
    normal.ok && normal.command.kind === "start-assignment" &&
    exhaustive.ok && exhaustive.command.kind === "start-assignment"
  ) {
    assert.equal(normal.command.exhaustive, false);
    assert.equal(exhaustive.command.exhaustive, true);
  }
});

test("retired exclusion lists are rejected with the new command names", () => {
  assert.deepEqual(parseCommand("测试分工# Alice，Bob, 陈三 "), {
    ok: false,
    error: "排除角色已取消，请直接发送「战斗模拟」。",
  });
  assert.deepEqual(parseCommand("试跑战斗＃角色甲，角色乙"), {
    ok: false,
    error: "排除角色已取消，请直接发送「战斗模拟」。",
  });
  assert.deepEqual(parseCommand("[战斗模拟]#甲,乙"), {
    ok: false,
    error: "排除角色已取消，请直接发送「战斗模拟」。",
  });
  assert.deepEqual(parseCommand("试跑生活#alice,bob"), {
    ok: false,
    error: "排除角色已取消，请直接发送「生活模拟」。",
  });
  assert.deepEqual(parseCommand("生活模拟#alice"), {
    ok: false,
    error: "排除角色已取消，请直接发送「生活模拟」。",
  });
});

test("combat maintenance commands validate arity, QQ and combat type", () => {
  assert.deepEqual(parseCommand("#战斗绑定 角色甲 弩"), {
    ok: true,
    command: {
      kind: "bind-combat",
      characterName: "角色甲",
      combatType: "弩",
    },
  });
  assert.deepEqual(parseCommand("战斗绑定 角色甲 弩"), {
    ok: true,
    command: {
      kind: "bind-combat",
      characterName: "角色甲",
      combatType: "弩",
    },
  });
  assert.deepEqual(parseCommand("#战斗绑定 角色甲 12345678 弩"), {
    ok: true,
    command: {
      kind: "bind-combat",
      characterName: "角色甲",
      qqUserId: "12345678",
      combatType: "弩",
    },
  });
  assert.deepEqual(parseCommand("#战斗解绑 角色甲"), {
    ok: true,
    command: { kind: "unbind-combat", characterName: "角色甲" },
  });
  assert.deepEqual(parseCommand("#战斗改绑 角色甲 12345678 火"), {
    ok: true,
    command: {
      kind: "rebind-combat",
      characterName: "角色甲",
      qqUserId: "12345678",
      combatType: "火",
    },
  });

  const badType = parseCommand("#战斗绑定 角色甲 奶");
  assert.ok(!badType.ok && !("ignored" in badType));
  const badQq = parseCommand("#战斗改绑 角色甲 abc 火");
  assert.ok(!badQq.ok && !("ignored" in badQq));
});

test("aura forms and level boundaries are parsed strictly", () => {
  assert.deepEqual(parseCommand("#光环 速度 1"), {
    ok: true,
    command: {
      kind: "set-aura",
      characterName: undefined,
      auraType: "速度",
      level: 1,
    },
  });
  assert.deepEqual(parseCommand("光环 速度 1"), {
    ok: true,
    command: {
      kind: "set-aura",
      characterName: undefined,
      auraType: "速度",
      level: 1,
    },
  });
  assert.deepEqual(parseCommand("#光环 角色甲 元素 200"), {
    ok: true,
    command: {
      kind: "set-aura",
      characterName: "角色甲",
      auraType: "元素",
      level: 200,
    },
  });
  for (const input of [
    "#光环 速度 0",
    "#光环 速度 201",
    "#光环 速度 1.5",
    "#光环 未知 100",
  ]) {
    const result = parseCommand(input);
    assert.ok(!result.ok && !("ignored" in result), input);
  }
});

test("unknown text is ignored while malformed known command gets an error", () => {
  assert.deepEqual(parseCommand("今天天气"), { ok: false, ignored: true });
  const malformed = parseCommand("#战斗绑定 只有角色");
  assert.deepEqual(malformed, {
    ok: false,
    error: "格式：#战斗绑定 角色名 类型；管理员代绑：#战斗绑定 角色名 QQ号 类型",
  });
});

test("normalizes OneBot private/group messages and derives admin securely", () => {
  const group = normalizeOneBotEvent({
    post_type: "message",
    message_type: "group",
    user_id: 123456,
    group_id: 369,
    message: [
      { type: "at", data: { qq: "bot" } },
      { type: "text", data: { text: " 公会短板 " } },
    ],
    sender: { role: "admin" },
  }, {
    adminUserIds: new Set<string>(),
    roleAdminGroupIds: new Set(),
  });
  assert.deepEqual(group, {
    ok: true,
    context: {
      source: "onebot",
      chatKind: "group",
      userId: "123456",
      groupId: "369",
      isAdmin: false,
      text: " 公会短板 ",
    },
  });

  const privateResult = normalizeOneBotEvent({
    post_type: "message",
    message_type: "private",
    user_id: "admin-open-id",
    raw_message: "技能推荐",
  }, { adminUserIds: new Set(["admin-open-id"]) });
  assert.equal(privateResult.ok, true);
  if (privateResult.ok) {
    assert.equal(privateResult.context.chatKind, "private");
    assert.equal(privateResult.context.isAdmin, true);
    assert.equal(privateResult.context.groupId, undefined);
  }
});

test("normalizes official QQ group/C2C events without trusting is_admin", () => {
  const group = normalizeOfficialQqEvent({
    author: { id: "user-1" },
    group_openid: "group-1",
    content: "本周分工",
    is_admin: true,
  }, { adminUserIds: new Set<string>() });
  assert.equal(group.ok, true);
  if (group.ok) {
    assert.equal(group.context.chatKind, "group");
    assert.equal(group.context.groupId, "group-1");
    assert.equal(group.context.isAdmin, false);
  }

  const c2c = normalizeOfficialQqEvent({
    author: { user_openid: "admin-1" },
    message_scene: "c2c",
    content: "技能推荐",
  }, { adminUserIds: new Set(["admin-1"]) });
  assert.equal(c2c.ok, true);
  if (c2c.ok) {
    assert.equal(c2c.context.chatKind, "private");
    assert.equal(c2c.context.isAdmin, true);
  }
});

test("malformed non-message events do not enter command handling", () => {
  assert.deepEqual(normalizeOneBotEvent({
    post_type: "notice",
  }, { adminUserIds: new Set() }), {
    ok: false,
    reason: "不是 OneBot 消息事件。",
  });
  assert.equal(
    normalizeOfficialQqEvent({ content: "hello" }, {
      adminUserIds: new Set(),
    }).ok,
    false,
  );
});
