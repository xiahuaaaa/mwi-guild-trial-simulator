import assert from "node:assert/strict";
import test from "node:test";
import { CommandHandler } from "../../apps/qq-bot/src/core/command-handler.ts";
import type { CommandServicePort } from "../../apps/qq-bot/src/core/service-port.ts";
import { createOneBotCommandHandler } from "../../apps/qq-bot/src/integration.ts";

test("OneBot integration maps the administrator allowlist and preserves multi-image private followups", async () => {
  const unavailable = async () => ({
    ok: false as const,
    code: "unavailable" as const,
    message: "unused",
  });
  const services = {
    getLatestCombatAssignment: async () => ({
      ok: true as const,
      value: {
        text: "测试资料",
        images: [{ url: "https://assets/assignment.png" }],
        skillDetailImages: [{ url: "https://assets/skills.png" }],
      },
    }),
  } as Partial<CommandServicePort> as CommandServicePort;
  const integrated = createOneBotCommandHandler(
    new CommandHandler(new Proxy(services, {
      get(target, property) {
        return Reflect.get(target, property) ?? unavailable;
      },
    })),
    new Set(["admin-1"]),
  );
  const response = await integrated({
    platform: "qq",
    protocol: "onebot-11",
    conversation: "group",
    groupId: "group-1",
    userId: "admin-1",
    text: "当前测试",
    mentionedBot: true,
  });
  assert.ok(response && !Array.isArray(response));
  assert.match(response.text ?? "", /私聊/u);
  assert.deepEqual(response.privateFollowups, [{
    userId: "admin-1",
    text: "测试资料",
    images: [
      { url: "https://assets/assignment.png" },
      { url: "https://assets/skills.png" },
    ],
  }]);
});

test("OneBot group owner/admin gets bot admin rights only in the configured group", async () => {
  const services = {
    getOptimizationAudit: async () => ({
      ok: true as const,
      value: { text: "管理员查询成功" },
    }),
  } as Partial<CommandServicePort> as CommandServicePort;
  const integrated = createOneBotCommandHandler(
    new CommandHandler(new Proxy(services, {
      get(target, property) {
        return Reflect.get(target, property);
      },
    })),
    new Set(),
    new Set(["5321332735"]),
  );
  const base = {
    platform: "qq" as const,
    protocol: "onebot-11" as const,
    conversation: "group" as const,
    userId: "group-owner",
    text: "优化",
    mentionedBot: true,
    groupRole: "owner" as const,
  };
  const allowed = await integrated({ ...base, groupId: "5321332735" });
  assert.equal(Array.isArray(allowed) ? undefined : allowed?.text, "管理员查询成功");

  const denied = await integrated({ ...base, groupId: "other-group" });
  assert.match(
    Array.isArray(denied) ? "" : denied?.text ?? "",
    /权限不足/u,
  );
});

test("OneBot private commands can use a verified configured-group role", async () => {
  const services = {
    getSkillRecommendation: async () => ({
      ok: true as const,
      value: { text: "私聊管理员结果" },
    }),
  } as Partial<CommandServicePort> as CommandServicePort;
  const integrated = createOneBotCommandHandler(
    new CommandHandler(services),
    new Set(),
    new Set(["532133273"]),
    async (event) => event.userId === "verified-admin",
  );
  const response = await integrated({
    platform: "qq",
    protocol: "onebot-11",
    conversation: "private",
    userId: "verified-admin",
    text: "技能推荐",
    mentionedBot: false,
  });
  assert.equal(Array.isArray(response) ? undefined : response?.text, "私聊管理员结果");
});
