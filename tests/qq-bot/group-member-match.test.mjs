import assert from "node:assert/strict";
import test from "node:test";
import {
  fuzzyMatchMemberInGroup,
  normalizeGroupCardName,
} from "../../apps/qq-bot/src/group-member-match.ts";

const NO_ALIASES = {};

test("normalizeGroupCardName strips guild prefix and card suffixes", () => {
  assert.equal(normalizeGroupCardName("TMD丨玩家甲"), "玩家甲");
  assert.equal(normalizeGroupCardName("缺失在群(备注)"), "缺失在群");
  assert.equal(normalizeGroupCardName("name#弓"), "name");
});

test("group card containing full game id matches", () => {
  assert.equal(
    fuzzyMatchMemberInGroup("ishi", ["ishi 水法低手", "其他群友"], NO_ALIASES),
    true,
  );
  assert.equal(
    fuzzyMatchMemberInGroup("玩家甲", ["TMD丨玩家甲", "其他群友"], NO_ALIASES),
    true,
  );
  assert.equal(
    fuzzyMatchMemberInGroup("缺失在群", ["缺失在群(备注)", "另一个"], NO_ALIASES),
    true,
  );
});

test("single-letter group cards do not false-positive", () => {
  const noisyGroup = ["T", "m", "其他群友"];
  for (const memberName of [
    "Atlus",
    "Jotta",
    "MRBIRTHDAY",
    "McYi",
    "Mizuk1",
    "PaternalMilk",
    "demon8901",
    "steffe",
  ]) {
    assert.equal(
      fuzzyMatchMemberInGroup(memberName, noisyGroup, NO_ALIASES),
      false,
      `${memberName} should not match single-letter cards`,
    );
  }
});

test("near-miss ASCII ids match with edit distance tolerance", () => {
  assert.equal(
    fuzzyMatchMemberInGroup("CongeAqua", ["CongeAuqa", "其他群友"], NO_ALIASES),
    true,
  );
});

test("configured aliases match unrelated Chinese group cards", () => {
  assert.equal(
    fuzzyMatchMemberInGroup(
      "yangguangniuzi",
      ["阳光牛子", "其他群友"],
      { yangguangniuzi: ["阳光牛子"] },
    ),
    true,
  );
});

test("unrelated members stay unmatched", () => {
  assert.equal(
    fuzzyMatchMemberInGroup("缺失不在群", ["缺失在群(备注)", "另一个"], NO_ALIASES),
    false,
  );
  assert.equal(
    fuzzyMatchMemberInGroup("Debbie", ["阳光牛子", "CongeAuqa"], NO_ALIASES),
    false,
  );
});
