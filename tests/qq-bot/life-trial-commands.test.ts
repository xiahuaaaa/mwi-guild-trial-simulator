import assert from "node:assert/strict";
import test from "node:test";

import { parseCommand } from "../../apps/qq-bot/src/core/parser.ts";

test("life trial read command remains publicly parseable", () => {
  const parsed = parseCommand("生活试炼");
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.command.kind, "life-trials");
});

test("life write and simulate commands parse under new and legacy names", () => {
  for (const [text, kind] of [
    ["重算生活", "generate-life-assignment"],
    ["生活分工", "generate-life-assignment"],
    ["本周生活分工", "latest-life-assignment"],
    ["生活模拟", "generate-life-assignment"],
    ["[生活模拟]", "generate-life-assignment"],
    ["试跑生活", "generate-life-assignment"],
    ["测试生活分工", "generate-life-assignment"],
    ["生活模拟 挤奶", "simulate-life-trial"],
    ["生活模拟 1 #alice,bob", "simulate-life-trial"],
  ] as const) {
    const parsed = parseCommand(text);
    assert.equal(parsed.ok, true, text);
    if (parsed.ok) assert.equal(parsed.command.kind, kind, text);
  }
});

test("bare 生活模拟 regenerates the published life assignment", () => {
  const parsed = parseCommand("生活模拟");
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.command.kind, "generate-life-assignment");
});
