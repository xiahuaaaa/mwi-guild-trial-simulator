import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBeijingDate,
  formatBeijingTimestamp,
} from "../../apps/qq-bot/src/beijing-time.ts";

test("formatBeijingTimestamp converts API ISO time to Asia/Shanghai display", () => {
  assert.equal(
    formatBeijingTimestamp("2026-07-29T07:56:48.614Z"),
    "2026-07-29 15:56:48 北京时间",
  );
});

test("formatBeijingDate keeps the calendar date in Asia/Shanghai", () => {
  assert.equal(
    formatBeijingDate("2026-08-13T16:30:00.000Z"),
    "2026-08-14",
  );
});
