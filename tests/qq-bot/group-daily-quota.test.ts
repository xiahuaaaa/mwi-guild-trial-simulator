import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createGroupDailyQuotaStore,
  parseGroupDailyReplyLimit,
  shanghaiDayKey,
} from "../../apps/qq-bot/src/group-daily-quota.ts";
import {
  deliverReplies,
  OneBot11Client,
} from "../../apps/qq-bot/src/onebot/index.ts";

test("parseGroupDailyReplyLimit defaults to 500 and treats 0 as disabled", () => {
  assert.equal(parseGroupDailyReplyLimit(undefined), 500);
  assert.equal(parseGroupDailyReplyLimit(""), 500);
  assert.equal(parseGroupDailyReplyLimit("500"), 500);
  assert.equal(parseGroupDailyReplyLimit("0"), 0);
  assert.throws(() => parseGroupDailyReplyLimit("-1"));
});

test("group daily quota rolls by Asia/Shanghai day and persists", () => {
  const dir = mkdtempSync(join(tmpdir(), "mwi-quota-"));
  const statePath = join(dir, "quota.json");
  let nowMs = Date.parse("2026-07-29T04:00:00+08:00");
  const store = createGroupDailyQuotaStore({
    limit: 2,
    statePath,
    now: () => new Date(nowMs),
  });
  assert.equal(shanghaiDayKey(new Date(nowMs)), "2026-07-29");
  assert.equal(store.tryConsume("g1").ok, true);
  assert.equal(store.tryConsume("g1").used, 2);
  assert.equal(store.tryConsume("g1").ok, false);
  assert.equal(store.tryConsume("g2").ok, true);

  const reloaded = createGroupDailyQuotaStore({
    limit: 2,
    statePath,
    now: () => new Date(nowMs),
  });
  assert.equal(reloaded.peek("g1").used, 2);
  assert.equal(reloaded.tryConsume("g1").ok, false);

  nowMs = Date.parse("2026-07-30T00:30:00+08:00");
  assert.equal(store.tryConsume("g1").ok, true);
  assert.equal(store.peek("g1").used, 1);
  assert.equal(store.peek("g1").day, "2026-07-30");
  const saved = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(saved.day, "2026-07-30");
});

test("deliverReplies stops group sends after daily quota", async () => {
  const calls: string[] = [];
  const client = {
    async send(action: string, targetId: string) {
      calls.push(`${action}:${targetId}`);
    },
  } as unknown as OneBot11Client;
  const quota = createGroupDailyQuotaStore({ limit: 1 });
  await deliverReplies(
    {
      platform: "qq",
      protocol: "onebot-11",
      conversation: "group",
      groupId: "group-1",
      userId: "u1",
      text: "生活分工",
      mentionedBot: false,
    },
    { text: "first" },
    client,
    quota,
  );
  await deliverReplies(
    {
      platform: "qq",
      protocol: "onebot-11",
      conversation: "group",
      groupId: "group-1",
      userId: "u1",
      text: "生活分工",
      mentionedBot: false,
    },
    { text: "second" },
    client,
    quota,
  );
  assert.deepEqual(calls, ["send_group_msg:group-1"]);
  // Private followups are not limited by the group quota.
  await deliverReplies(
    {
      platform: "qq",
      protocol: "onebot-11",
      conversation: "private",
      userId: "u1",
      text: "帮助",
      mentionedBot: false,
    },
    { text: "private ok" },
    client,
    quota,
  );
  assert.deepEqual(calls, ["send_group_msg:group-1", "send_private_msg:u1"]);
});
