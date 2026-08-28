import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { GuildApiCommandService } from "../../apps/qq-bot/src/api-client.ts";

test("guild boss command prefers the current uploaded weekly trial catalog", async (t) => {
  const server = createServer((req, res) => {
    assert.equal(req.headers["x-admin-key"], "test-admin");
    if (req.url === "/api/guilds/TMD/weekly-trials/current") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        weekStartAt: "2026-07-24T00:00:00.000Z",
        trials: [
          { trialHrid: "/guild_skilling/milking", trialName: "挤奶", kind: "skilling", monsters: [] },
          {
            trialHrid: "/guild_combat/jellyfish",
            trialName: "试炼水母",
            kind: "combat",
            monsters: [{
              level: 100,
              maxHp: 495000,
              maxMp: 495000,
              armor: 200,
              combatStyleHrids: ["/combat_styles/magic"],
              accuracy: { magic: 418 },
              damage: { defensive: 110, magic: 352 },
              resistance: { water: 280, nature: 160, fire: 280 },
            }],
          },
        ],
      }));
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "unexpected fallback request" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const service = new GuildApiCommandService({
    baseUrl: `http://127.0.0.1:${address.port}`,
    adminKey: "test-admin",
    guildId: "TMD",
  });
  const result = await service.getGuildBosses();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.text ?? "", /生活：挤奶/u);
  assert.match(result.value.text ?? "", /试炼水母 Lv\.100/u);
  assert.match(result.value.text ?? "", /HP\/MP 495000\/495000/u);
  assert.match(result.value.text ?? "", /magic精准 418/u);
});

test("guild boss command keeps the static fixture as a missing-panel fallback", async (t) => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/guilds/TMD/weekly-trials/current") {
      res.end(JSON.stringify({
        weekStartAt: "2026-07-24T00:00:00.000Z",
        trials: [{
          trialHrid: "/guild_combat/hedgehog",
          trialName: "试炼刺猬",
          kind: "combat",
          monsters: [],
        }],
      }));
      return;
    }
    if (req.url === "/api/boss-fixture/current") {
      res.end(JSON.stringify({
        bosses: [{
          nameZh: "试炼刺猬",
          level: 100,
          maxHp: 440000,
          maxMp: 440000,
          armor: 270,
          resistance: { water: 270, nature: 270, fire: 160 },
        }],
      }));
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: "unexpected request" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const service = new GuildApiCommandService({
    baseUrl: `http://127.0.0.1:${address.port}`,
    adminKey: "test-admin",
    guildId: "TMD",
  });
  const result = await service.getGuildBosses();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.text ?? "", /静态备用数据/u);
  assert.match(result.value.text ?? "", /试炼刺猬/u);
});
