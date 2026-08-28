import assert from "node:assert/strict";
import test from "node:test";

import {
  CommandHandler,
  type BotImage,
  type CommandContext,
  type CommandServicePort,
  type ServiceContent,
  type ServiceResult,
} from "../../../apps/qq-bot/src/core/index.ts";

interface Fake {
  services: CommandServicePort;
  calls: Array<{ method: string; input?: unknown }>;
}

const ok = (
  text: string,
  extra: Partial<ServiceContent> = {},
): ServiceResult<ServiceContent> => ({
  ok: true,
  value: { text, ...extra },
});

function fakeServices(
  overrides: Partial<CommandServicePort> = {},
): Fake {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const record = <T>(method: string, value: T) =>
    async (input?: unknown): Promise<T> => {
      calls.push({ method, input });
      return value;
    };
  const content = (method: string) => record(method, ok(method));
  const services: CommandServicePort = {
    getLockedOfficialAssignment: content("getLockedOfficialAssignment"),
    getGuildBottleneck: content("getGuildBottleneck"),
    getProfessionDistribution: content("getProfessionDistribution"),
    getGuildRoster: content("getGuildRoster"),
    getUnregisteredTrialMembers: content("getUnregisteredTrialMembers"),
    getSignupAssignmentMismatches: content("getSignupAssignmentMismatches"),
    getAuraAssignment: content("getAuraAssignment"),
    getGuildBosses: content("getGuildBosses"),
    getPluginInstallInfo: content("getPluginInstallInfo"),
    getLatestPluginArtifact: async () => {
      calls.push({ method: "getLatestPluginArtifact" });
      return {
        ok: true,
        value: {
          version: "0.6.11",
          installUrl: "https://update.greasyfork.org/scripts/588902/example.user.js",
          fileName: "MWI公会试炼资料同步助手-v0.6.11.user.js",
          file: "https://api.test/mwi-guild-trial-exporter.user.js",
        },
      };
    },
    getLifeTrials: content("getLifeTrials"),
    generateLifeAssignment: content("generateLifeAssignment"),
    getLatestLifeAssignment: content("getLatestLifeAssignment"),
    simulateLifeTrial: content("simulateLifeTrial"),
    startTestLifeAssignment: content("startTestLifeAssignment"),
    getGuildProfessionReport: content("getGuildProfessionReport"),
    getAssignmentProgress: content("getAssignmentProgress"),
    getOptimizationAudit: content("getOptimizationAudit"),
    getUnavailableRoster: content("getUnavailableRoster"),
    getEquipmentCheck: content("getEquipmentCheck"),
    getLatestCombatAssignment: content("getLatestCombatAssignment"),
    getSkillRecommendation: content("getSkillRecommendation"),
    getMissingUploads: content("getMissingUploads"),
    getExpiredUploads: content("getExpiredUploads"),
    getProductionSimulationAvailability: record(
      "getProductionSimulationAvailability",
      { available: true },
    ),
    getTestSimulationAvailability: record(
      "getTestSimulationAvailability",
      { available: true },
    ),
    startOfficialAssignment: content("startOfficialAssignment"),
    startTestAssignment: content("startTestAssignment"),
    stopActiveAssignment: content("stopActiveAssignment"),
    simulateLockedOfficialAssignment: content(
      "simulateLockedOfficialAssignment",
    ),
    promoteLatestTestWithoutSimulation: content(
      "promoteLatestTestWithoutSimulation",
    ),
    isCurrentGuildMember: async (name: string) => {
      calls.push({ method: "isCurrentGuildMember", input: name });
      return {
        ok: true,
        value: { current: true, canonicalName: name },
      };
    },
    getCombatBindingsForUser: record("getCombatBindingsForUser", {
      ok: true,
      value: [],
    }),
    bindCombat: content("bindCombat"),
    unbindCombat: content("unbindCombat"),
    rebindCombat: content("rebindCombat"),
    setAura: content("setAura"),
    ...overrides,
  };
  return { services, calls };
}

function context(
  text: string,
  options: Partial<CommandContext> = {},
): CommandContext {
  return {
    source: "onebot",
    chatKind: "group",
    groupId: "guild-group",
    userId: "user-1",
    isAdmin: false,
    text,
    ...options,
  };
}

test("help aliases return the member menu without calling a service", async () => {
  for (const command of ["帮助", "菜单", "指令"]) {
    const fake = fakeServices();
    const response = await new CommandHandler(fake.services).handle(
      context(command),
    );
    assert.match(response?.text ?? "", /TMD's MWI 公会台/u);
    assert.match(response?.text ?? "", /看本周/u);
    assert.match(response?.text ?? "", /公会boss/u);
    assert.match(response?.text ?? "", /公会名单/u);
    assert.match(response?.text ?? "", /光环分配/u);
    assert.match(response?.text ?? "", /报名检查/u);
    assert.match(response?.text ?? "", /未覆盖名单/u);
    assert.match(response?.text ?? "", /#战斗绑定/u);
    assert.match(response?.text ?? "", /本周分工/u);
    assert.match(response?.text ?? "", /本周生活分工/u);
    assert.match(response?.text ?? "", /管理员发送：管理/u);
    assert.doesNotMatch(response?.text ?? "", /未上传名单/u);
    assert.doesNotMatch(response?.text ?? "", /试跑战斗/u);
    assert.doesNotMatch(response?.text ?? "", /重算生活/u);
    assert.doesNotMatch(response?.text ?? "", /战斗模拟/u);
    assert.doesNotMatch(response?.text ?? "", /生活模拟/u);
    assert.equal(fake.calls.length, 0);
  }
});

test("admin help menus are admin-only and layered", async () => {
  const denied = await new CommandHandler(fakeServices().services).handle(
    context("管理"),
  );
  assert.match(denied?.text ?? "", /权限不足/u);

  const fake = fakeServices();
  const admin = await new CommandHandler(fake.services).handle(
    context("管理", { isAdmin: true }),
  );
  assert.match(admin?.text ?? "", /管理控制台/u);
  assert.match(admin?.text ?? "", /生活模拟/u);
  assert.match(admin?.text ?? "", /战斗模拟/u);
  assert.match(admin?.text ?? "", /数据体检/u);
  assert.match(admin?.text ?? "", /不可用名单/u);
  assert.match(admin?.text ?? "", /装备检查/u);
  assert.match(admin?.text ?? "", /管理进阶/u);
  assert.doesNotMatch(admin?.text ?? "", /试跑战斗/u);
  assert.doesNotMatch(admin?.text ?? "", /重算生活/u);
  assert.doesNotMatch(admin?.text ?? "", /转正方案/u);
  assert.doesNotMatch(admin?.text ?? "", /\[生活模拟\]/u);
  assert.doesNotMatch(admin?.text ?? "", /\[战斗模拟\]/u);
  assert.doesNotMatch(admin?.text ?? "", /开始正式分工/u);
  assert.equal(fake.calls.length, 0);

  const advanced = await new CommandHandler(fakeServices().services).handle(
    context("管理进阶", { isAdmin: true }),
  );
  assert.match(advanced?.text ?? "", /管理进阶/u);
  assert.match(advanced?.text ?? "", /开始正式分工/u);
  assert.match(advanced?.text ?? "", /生活模拟/u);
  assert.match(advanced?.text ?? "", /私聊本周分工/u);
});

test("all common queries call read-only endpoints and never recalculate", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services);
  for (const command of [
    "公会短板",
    "职业分布",
    "公会名单",
    "未报名名单",
    "报名检查",
    "光环分配",
    "公会boss",
    "公会插件",
  ]) {
    assert.ok(await handler.handle(context(command)));
  }
  assert.deepEqual(fake.calls.map((call) => call.method), [
    "getGuildBottleneck",
    "getProfessionDistribution",
    "getGuildRoster",
    "getUnregisteredTrialMembers",
    "getSignupAssignmentMismatches",
    "getAuraAssignment",
    "getGuildBosses",
    "getPluginInstallInfo",
  ]);
});

test("正式分工 aliases to the published weekly combat assignment", async () => {
  const fake = fakeServices();
  const response = await new CommandHandler(fake.services).handle(
    context("正式分工"),
  );
  assert.equal(response?.text, "getLatestCombatAssignment");
  assert.deepEqual(fake.calls.map((call) => call.method), [
    "getLatestCombatAssignment",
  ]);
});

test("administrator commands are rejected before any service call", async () => {
  const commands = [
    "管理",
    "管理进阶",
    "公会查询",
    "生活top20",
    "重算生活",
    "生活分工",
    "生活模拟",
    "[生活模拟]",
    "试跑生活",
    "生活模拟 1",
    "开始分工",
    "开始完全分工",
    "开始正式分工",
    "完全搜索分工",
    "分工进度",
    "终止分工",
    "当前分工模拟",
    "模拟正式",
    "优化",
    "数据体检",
    "不可用名单",
    "装备检查",
    "技能推荐",
    "测试分工",
    "试跑战斗",
    "战斗模拟",
    "[战斗模拟]",
    "当前测试",
    "私聊本周分工",
    "测试分工转正",
    "转正方案",
    "#战斗解绑 角色甲",
    "#战斗改绑 角色甲 123456 火",
    "未上传名单",
    "上传过期名单",
    "上传最新插件",
  ];
  for (const command of commands) {
    const fake = fakeServices();
    const response = await new CommandHandler(fake.services).handle(
      context(command),
    );
    assert.match(response?.text ?? "", /权限不足/u, command);
    assert.equal(fake.calls.length, 0, command);
  }
});

test("equipment check is an admin read-only query", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services);
  const allowed = await handler.handle(context("装备检查", { isAdmin: true }));
  assert.equal(allowed?.text, "getEquipmentCheck");
  assert.equal(fake.calls[0]?.method, "getEquipmentCheck");
});

test("skill recommendation requires administrator private chat", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services);
  const denied = await handler.handle(context("技能推荐", { isAdmin: true }));
  assert.match(denied?.text ?? "", /仅支持私聊/u);
  assert.equal(fake.calls.length, 0);

  const allowed = await handler.handle(context("技能推荐", {
    isAdmin: true,
    chatKind: "private",
    groupId: undefined,
  }));
  assert.equal(allowed?.text, "getSkillRecommendation");
  assert.equal(fake.calls[0]?.method, "getSkillRecommendation");
  assert.equal(fake.calls[0]?.input, "user-1");
});

test("production simulation unavailable explicitly blocks official mutation", async () => {
  const fake = fakeServices({
    getProductionSimulationAvailability: async () => ({
      available: false,
      reason: "战斗内核尚未通过生产校验",
    }),
  });
  const handler = new CommandHandler(fake.services);
  const response = await handler.handle(context("开始完全分工", {
    isAdmin: true,
  }));
  assert.match(response?.text ?? "", /生产模拟当前不可用/u);
  assert.match(response?.text ?? "", /正式分工未变更/u);
  assert.match(response?.text ?? "", /战斗内核/u);
  assert.equal(
    fake.calls.some((call) => call.method === "startOfficialAssignment"),
    false,
  );
});

test("official start modes and current simulation preserve their semantics", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services);
  await handler.handle(context("开始分工", {
    isAdmin: true,
    userId: "admin-1",
  }));
  await handler.handle(context("开始完全分工", {
    isAdmin: true,
    userId: "admin-1",
  }));
  await handler.handle(context("当前分工模拟", {
    isAdmin: true,
    userId: "admin-1",
  }));
  const starts = fake.calls.filter((call) =>
    call.method === "startOfficialAssignment"
  );
  assert.deepEqual(starts.map((call) => call.input), [
    { requestedBy: "admin-1", exhaustive: false },
    { requestedBy: "admin-1", exhaustive: true },
  ]);
  assert.deepEqual(
    fake.calls.find((call) =>
      call.method === "simulateLockedOfficialAssignment"
    )?.input,
    { requestedBy: "admin-1", runsPerBoss: 3 },
  );
});

test("combat simulation starts without an exclusion list", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services);
  await handler.handle(context("战斗模拟", {
    isAdmin: true,
    userId: "admin-1",
  }));
  assert.deepEqual(
    fake.calls.find((call) => call.method === "startTestAssignment")?.input,
    {
      requestedBy: "admin-1",
      excludedCharacterNames: [],
      chatKind: "group",
      groupId: "guild-group",
    },
  );
  assert.equal(
    fake.calls.some((call) => call.method === "startOfficialAssignment"),
    false,
  );
});

test("test run unavailable blocks without starting a job", async () => {
  const fake = fakeServices({
    getTestSimulationAvailability: async () => ({
      available: false,
      reason: "完整技能、触发器和公会试炼规则尚未完成校准",
    }),
  });
  const response = await new CommandHandler(fake.services).handle(
    context("战斗模拟", { isAdmin: true }),
  );
  assert.match(response?.text ?? "", /战斗模拟当前不可用/u);
  assert.doesNotMatch(response?.text ?? "", /未覆盖正式分工/u);
  assert.equal(
    fake.calls.some((call) => call.method === "startTestAssignment"),
    false,
  );
});

test("本周生活分工 returns stored life summary + image to the current chat", async () => {
  const images: BotImage[] = [{ url: "file:///reports/life.png" }];
  const fake = fakeServices({
    getLatestLifeAssignment: async () =>
      ok("本周生活分工", { images }),
  });
  const response = await new CommandHandler(fake.services).handle(
    context("本周生活分工"),
  );
  assert.equal(response?.text, "本周生活分工");
  assert.deepEqual(response?.images, images);
});

test("本周分工 returns stored summary + images to the current chat", async () => {
  const images: BotImage[] = [
    { url: "file:///reports/jellyfish.png" },
    { url: "file:///reports/hedgehog.png" },
  ];
  const fake = fakeServices({
    getLatestCombatAssignment: async () =>
      ok("本周分工", { images }),
  });
  for (const command of ["本周分工", "本周战斗分工", "本周测试分工", "本周测试分工图片"]) {
    const response = await new CommandHandler(fake.services).handle(
      context(command),
    );
    assert.equal(response?.text, "本周分工", command);
    assert.deepEqual(response?.images, images, command);
    assert.deepEqual(response?.privateFollowups, []);
  }
  assert.deepEqual(fake.calls, []);
});

test("retired promotion command explains that published sims are official", async () => {
  const fake = fakeServices();
  const response = await new CommandHandler(fake.services).handle(
    context("测试分工转正", {
      isAdmin: true,
      userId: "admin-1",
    }),
  );
  assert.match(response?.text ?? "", /已取消转正/u);
  assert.match(response?.text ?? "", /战斗模拟/u);
  assert.equal(fake.calls.length, 0);
});

test("current test in a group sends all assets as a private follow-up", async () => {
  const fake = fakeServices({
    getLatestCombatAssignment: async () => ok("测试图和技能组", {
      images: [{ url: "https://assets/assignment.png" }],
      skillDetailImages: [{ url: "https://assets/skills.png" }],
    }),
  });
  const response = await new CommandHandler(fake.services).handle(
    context("当前测试", { isAdmin: true, userId: "admin-1" }),
  );
  assert.match(response?.text ?? "", /已发送到你的私聊/u);
  assert.equal(response?.images.length, 0);
  assert.deepEqual(response?.privateFollowups, [{
    userId: "admin-1",
    text: "测试图和技能组",
    images: [
      { url: "https://assets/assignment.png" },
      { url: "https://assets/skills.png" },
    ],
  }]);
});

test("admin can bind combat for another QQ via four-token bind form", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services);
  await handler.handle(context("#战斗绑定 ky800w 99998888 弩", {
    userId: "admin-qq",
    isAdmin: true,
  }));
  const bindingInputs = fake.calls
    .filter((call) => call.method === "bindCombat")
    .map((call) => call.input);
  assert.deepEqual(bindingInputs, [{
    requestedBy: "admin-qq",
    characterName: "ky800w",
    qqUserId: "99998888",
    combatType: "弩",
  }]);
});

test("non-admin cannot bind combat for another QQ", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services);
  const response = await handler.handle(context("#战斗绑定 角色甲 99998888 弩", {
    userId: "qq-1",
    isAdmin: false,
  }));
  assert.match(response?.text ?? "", /权限不足/u);
  assert.equal(
    fake.calls.filter((call) => call.method === "bindCombat").length,
    0,
  );
});

test("binding accepts current members, uses caller QQ, and supports multiple roles", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services);
  await handler.handle(context("#战斗绑定 角色甲 火", {
    userId: "qq-1",
  }));
  await handler.handle(context("#战斗绑定 角色乙 盾", {
    userId: "qq-1",
  }));
  const bindingInputs = fake.calls
    .filter((call) => call.method === "bindCombat")
    .map((call) => call.input);
  assert.deepEqual(bindingInputs, [
    {
      requestedBy: "qq-1",
      characterName: "角色甲",
      qqUserId: "qq-1",
      combatType: "火",
    },
    {
      requestedBy: "qq-1",
      characterName: "角色乙",
      qqUserId: "qq-1",
      combatType: "盾",
    },
  ]);
});

test("binding and aura reject characters outside the current guild", async () => {
  let writes = 0;
  const fake = fakeServices({
    isCurrentGuildMember: async (name: string) => ({
      ok: true,
      value: { current: false, canonicalName: name },
    }),
    bindCombat: async () => {
      writes += 1;
      return ok("should not happen");
    },
    setAura: async () => {
      writes += 1;
      return ok("should not happen");
    },
    getCombatBindingsForUser: async () => ({
      ok: true,
      value: [{
        characterName: "退会角色",
        qqUserId: "qq-1",
        combatType: "火",
      }],
    }),
  });
  const handler = new CommandHandler(fake.services);
  const bind = await handler.handle(context("#战斗绑定 退会角色 火", {
    userId: "qq-1",
  }));
  const aura = await handler.handle(context("#光环 速度 100", {
    userId: "qq-1",
  }));
  assert.match(bind?.text ?? "", /不在当前公会成员名单/u);
  assert.match(aura?.text ?? "", /不在当前公会成员名单/u);
  assert.equal(writes, 0);
});

test("implicit aura needs exactly one bound role; explicit aura needs ownership", async () => {
  const twoBindings = [{
    characterName: "角色甲",
    qqUserId: "qq-1",
    combatType: "火" as const,
  }, {
    characterName: "角色乙",
    qqUserId: "qq-1",
    combatType: "水" as const,
  }];
  const fake = fakeServices({
    getCombatBindingsForUser: async () => ({
      ok: true,
      value: twoBindings,
    }),
  });
  const handler = new CommandHandler(fake.services);
  const ambiguous = await handler.handle(context("#光环 速度 100", {
    userId: "qq-1",
  }));
  assert.match(ambiguous?.text ?? "", /绑定了多个角色/u);

  const foreign = await handler.handle(context("#光环 别人的角色 守护 80", {
    userId: "qq-1",
  }));
  assert.match(foreign?.text ?? "", /只能更新/u);

  await handler.handle(context("#光环 角色乙 元素 200", {
    userId: "qq-1",
  }));
  assert.deepEqual(
    fake.calls.find((call) => call.method === "setAura")?.input,
    {
      requestedBy: "qq-1",
      characterName: "角色乙",
      auraType: "元素",
      level: 200,
    },
  );
});

test("administrator can explicitly update a current member aura", async () => {
  const fake = fakeServices();
  await new CommandHandler(fake.services).handle(
    context("#光环 角色甲 暴击 160", {
      isAdmin: true,
      userId: "admin-1",
    }),
  );
  assert.deepEqual(
    fake.calls.find((call) => call.method === "setAura")?.input,
    {
      requestedBy: "admin-1",
      characterName: "角色甲",
      auraType: "暴击",
      level: 160,
    },
  );
  assert.equal(
    fake.calls.some((call) => call.method === "getCombatBindingsForUser"),
    false,
  );
});

test("upload latest plugin schedules a TMD group file upload for administrators", async () => {
  const fake = fakeServices();
  const handler = new CommandHandler(fake.services, { tmdGuildGroupId: "532133273" });
  const response = await handler.handle(context("上传最新插件", { isAdmin: true }));
  assert.match(response?.text ?? "", /公会插件 v0\.6\.11/u);
  assert.match(response?.text ?? "", /Greasy Fork/u);
  assert.match(response?.text ?? "", /正在上传到 TMD 群文件/u);
  assert.deepEqual(response?.groupFileUploads, [{
    groupId: "532133273",
    fileName: "MWI公会试炼资料同步助手-v0.6.11.user.js",
    file: "https://api.test/mwi-guild-trial-exporter.user.js",
  }]);
  assert.deepEqual(fake.calls, [{ method: "getLatestPluginArtifact" }]);
});

test("unknown messages produce no reply", async () => {
  const fake = fakeServices();
  assert.equal(
    await new CommandHandler(fake.services).handle(context("路过")),
    null,
  );
  assert.equal(fake.calls.length, 0);
});
