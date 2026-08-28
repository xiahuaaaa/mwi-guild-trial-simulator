import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { GuildApiCommandService } from "../../apps/qq-bot/src/api-client.ts";

test("公会插件 returns all three public installation links", async (t) => {
  const server = createServer((req, res) => {
    assert.equal(req.url, "/api/plugin-versions");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      plugins: [{
        pluginId: "guild-trial-member-exporter",
        version: "0.6.17",
        installUrl: "https://gitee.com/lxxxhhyy/TMD-guild-trial-sync/raw/master/TMD-guild-trial-sync.user.js",
        notes: "Gitee 国内公开安装源",
      }],
    }));
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
  const result = await service.getPluginInstallInfo();

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.text,
    [
      "公会插件 v0.6.17",
      "油叉（Greasy Fork）：https://update.greasyfork.org/scripts/588902/MWI%20%E5%85%AC%E4%BC%9A%E8%AF%95%E7%82%BC%E8%B5%84%E6%96%99%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B.user.js",
      "Gitee：https://gitee.com/lxxxhhyy/TMD-guild-trial-sync/raw/master/TMD-guild-trial-sync.user.js",
      "GitHub：https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/dist/mwi-guild-trial-sync.user.js",
      "Gitee 国内公开安装源",
    ].join("\n"),
  );
});
