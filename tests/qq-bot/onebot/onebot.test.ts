import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  OneBot11Client,
  OneBotTransportError,
  createOneBot11Webhook,
  deliverReplies,
  normalizeOneBotEvent,
  replySegments,
} from "../../../apps/qq-bot/src/onebot/index.ts";

async function withOneBotServer(
  responder: (request: import("node:http").IncomingMessage, body: unknown) => { status?: number; payload: unknown },
  run: (baseUrl: string, seen: { url?: string; body?: unknown; headers?: import("node:http").IncomingHttpHeaders }) => Promise<void>,
) {
  const seen: { url?: string; body?: unknown; headers?: import("node:http").IncomingHttpHeaders } = {};
  const server = createServer(async (request, response) => {
    const body = await new Promise<string>((resolve) => {
      let text = "";
      request.on("data", (chunk) => { text += chunk; });
      request.on("end", () => resolve(text));
    });
    seen.url = request.url;
    seen.body = body ? JSON.parse(body) : undefined;
    seen.headers = request.headers;
    const result = responder(request, seen.body);
    response.writeHead(result.status ?? 200, { "content-type": "application/json" });
    response.end(JSON.stringify(result.payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`, seen); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("normalizes group events using string IDs and removes @bot plus prefix", () => {
  const context = normalizeOneBotEvent({
    post_type: "message", message_type: "group", self_id: "90000000000000001", group_id: "80000000000000001",
    user_id: "70000000000000001", message_id: "123", time: 1,
    sender: { role: "owner" },
    message: [{ type: "at", data: { qq: "90000000000000001" } }, { type: "text", data: { text: " #本周分工" } }],
  }, { botId: "90000000000000001" });
  assert.deepEqual(context?.groupId, "80000000000000001");
  assert.equal(context?.mentionedBot, true);
  assert.equal(context?.groupRole, "owner");
  assert.equal(context?.text, "本周分工");
});

test("normalizes private events and preserves text without prefix", () => {
  const context = normalizeOneBotEvent({ post_type: "message", message_type: "private", user_id: 123456, message: [{ type: "text", data: { text: "技能推荐" } }] });
  assert.equal(context?.conversation, "private");
  assert.equal(context?.userId, "123456");
  assert.equal(context?.text, "技能推荐");
});

test("webhook authenticates both access token and event key before invoking handler", async () => {
  let calls = 0;
  const webhook = createOneBot11Webhook({ accessToken: "token-value", eventKey: "event-value" }, async () => { calls += 1; });
  const denied = await webhook(new Request("http://bot/webhook", { method: "POST", headers: { authorization: "Bearer wrong", "x-event-key": "event-value" }, body: "{}" }));
  assert.equal(denied.status, 401);
  const accepted = await webhook(new Request("http://bot/webhook", {
    method: "POST", headers: { authorization: "Bearer token-value", "x-event-key": "event-value", "content-type": "application/json" },
    body: JSON.stringify({ post_type: "message", message_type: "private", user_id: "1", message: [] }),
  }));
  assert.equal(accepted.status, 204);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(calls, 1);
});

test("sends group replies as segment arrays, including URL and base64 images", async () => {
  await withOneBotServer(() => ({ payload: { status: "ok", retcode: 0 } }), async (baseUrl, seen) => {
    const client = new OneBot11Client({ apiBaseUrl: baseUrl, apiToken: "outgoing", timeoutMs: 500 });
    await client.send("send_group_msg", "80000000000000001", { text: "结果", images: [{ url: "https://example.test/result.png" }] });
    assert.equal(seen.url, "/send_group_msg");
    assert.deepEqual(seen.body, { group_id: "80000000000000001", message: [
      { type: "text", data: { text: "结果" } }, { type: "image", data: { file: "https://example.test/result.png" } },
    ] });
    assert.equal(seen.headers?.authorization, "Bearer outgoing");
  });
  assert.deepEqual(replySegments({ images: [{ base64: "YWJj" }] }), [{ type: "image", data: { file: "base64://YWJj" } }]);
});

test("serializes non-2xx and OneBot retcode failures without remote wording", async () => {
  await withOneBotServer(() => ({ status: 503, payload: { status: "failed", retcode: 9, wording: "sensitive text" } }), async (baseUrl) => {
    await assert.rejects(() => new OneBot11Client({ apiBaseUrl: baseUrl }).send("send_private_msg", "7", { text: "x" }), (error: unknown) => {
      assert.ok(error instanceof OneBotTransportError);
      assert.equal(error.status, 503);
      assert.equal(error.retcode, undefined);
      assert.equal(error.message.includes("sensitive"), false);
      return true;
    });
  });
  await withOneBotServer(() => ({ payload: { status: "failed", retcode: 1404, wording: "not for logs" } }), async (baseUrl) => {
    await assert.rejects(() => new OneBot11Client({ apiBaseUrl: baseUrl }).send("send_private_msg", "7", { text: "x" }), (error: unknown) => {
      assert.ok(error instanceof OneBotTransportError);
      assert.equal(error.retcode, 1404);
      assert.equal(error.message.includes("logs"), false);
      return true;
    });
  });
});

test("delivers group acknowledgement and chunks private multi-image followups", async () => {
  const calls: Array<{ action: string; targetId: string; reply: unknown }> = [];
  const client = {
    async send(action: string, targetId: string, reply: unknown) {
      calls.push({ action, targetId, reply });
    },
  } as unknown as OneBot11Client;
  await deliverReplies({
    platform: "qq",
    protocol: "onebot-11",
    conversation: "group",
    groupId: "group-1",
    userId: "admin-1",
    text: "当前测试",
    mentionedBot: true,
  }, {
    text: "已发送到私聊",
    images: [],
    privateFollowups: [{
      userId: "admin-1",
      text: "测试资料",
      images: [
        { url: "https://assets/assignment.png" },
        { url: "https://assets/skills.png" },
      ],
    }],
  }, client);
  assert.deepEqual(calls, [{
    action: "send_group_msg",
    targetId: "group-1",
    reply: {
      text: "已发送到私聊",
      images: [],
      privateFollowups: [{
        userId: "admin-1",
        text: "测试资料",
        images: [
          { url: "https://assets/assignment.png" },
          { url: "https://assets/skills.png" },
        ],
      }],
    },
  }, {
    action: "send_private_msg",
    targetId: "admin-1",
    reply: {
      text: "测试资料",
      images: [],
    },
  }, {
    action: "send_private_msg",
    targetId: "admin-1",
    reply: {
      text: undefined,
      images: [{ url: "https://assets/assignment.png" }],
    },
  }, {
    action: "send_private_msg",
    targetId: "admin-1",
    reply: {
      text: undefined,
      images: [{ url: "https://assets/skills.png" }],
    },
  }]);
});

test("uploads group files before sending the acknowledgement text", async () => {
  const calls: Array<{ action: string; targetId?: string; body?: unknown; reply?: unknown }> = [];
  const client = {
    async uploadGroupFile(groupId: string, file: string, name: string) {
      calls.push({ action: "upload_group_file", targetId: groupId, body: { group_id: groupId, file, name } });
    },
    async send(action: string, targetId: string, reply: unknown) {
      calls.push({ action, targetId, reply });
    },
  } as unknown as OneBot11Client;
  await deliverReplies({
    platform: "qq",
    protocol: "onebot-11",
    conversation: "group",
    groupId: "group-1",
    userId: "admin-1",
    text: "上传最新插件",
    mentionedBot: true,
  }, {
    text: "正在上传…",
    groupFileUploads: [{
      groupId: "532133273",
      fileName: "plugin.user.js",
      file: "https://api.test/mwi-guild-trial-exporter.user.js",
    }],
  }, client);
  assert.equal(calls[0]?.action, "upload_group_file");
  assert.equal(calls[1]?.action, "send_group_msg");
  assert.match(String((calls[1]?.reply as { text?: string })?.text ?? ""), /已上传到 TMD 群文件/u);
});

test("reports upload failures without leaking remote wording", async () => {
  const client = {
    async uploadGroupFile() {
      throw new OneBotTransportError("upload_group_file returned an error (retcode=1200)");
    },
    async send() {},
  } as unknown as OneBot11Client;
  const calls: Array<{ action: string; reply?: unknown }> = [];
  (client as { send: typeof client.send }).send = async (action, _targetId, reply) => {
    calls.push({ action, reply });
  };
  await deliverReplies({
    platform: "qq",
    protocol: "onebot-11",
    conversation: "private",
    userId: "admin-1",
    text: "上传最新插件",
    mentionedBot: true,
  }, {
    text: "正在上传…",
    groupFileUploads: [{
      groupId: "532133273",
      fileName: "plugin.user.js",
      file: "/tmp/plugin.user.js",
    }],
  }, client);
  assert.match(String((calls[0]?.reply as { text?: string })?.text ?? ""), /群文件上传失败/u);
  assert.equal(String((calls[0]?.reply as { text?: string })?.text ?? "").includes("retcode"), false);
});
