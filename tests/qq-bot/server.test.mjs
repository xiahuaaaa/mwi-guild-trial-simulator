import assert from "node:assert/strict";
import test from "node:test";
import {
  createOneBotRoleAdminResolver,
  createQqBotServer,
} from "../../apps/qq-bot/server.mjs";

test("QQ bot server starts from explicit deployment options and exposes health", async (t) => {
  const server = await createQqBotServer({
    guildApiBaseUrl: "http://127.0.0.1:8787",
    guildApiAdminKey: "test-admin",
    guildId: "guild-1",
    oneBotApiBaseUrl: "http://127.0.0.1:13000",
    oneBotAccessToken: "test-onebot-token",
    adminUserIds: ["12345678"],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "mwi-guild-qq-bot",
  });
});

test("private role resolver grants only owner/admin roles returned by OneBot", async (t) => {
  const api = await import("node:http").then(({ createServer }) =>
    createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { user_id: userId } = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          role: userId === "owner-id" ? "owner" : "member",
        },
      }));
    })
  );
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() =>
    new Promise((resolve, reject) =>
      api.close((error) => error ? reject(error) : resolve())
    )
  );
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  const resolveRoleAdmin = createOneBotRoleAdminResolver({
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    groupIds: new Set(["532133273"]),
  });
  const base = {
    platform: "qq",
    protocol: "onebot-11",
    conversation: "private",
    text: "技能推荐",
    mentionedBot: false,
  };
  assert.equal(await resolveRoleAdmin({ ...base, userId: "owner-id" }), true);
  assert.equal(await resolveRoleAdmin({ ...base, userId: "member-id" }), false);
});
