import assert from "node:assert/strict";
import test from "node:test";

import {
  formatProfessionDistribution,
} from "../../apps/qq-bot/src/api-client.ts";

function member(memberId, attackLevel) {
  if (attackLevel === undefined) {
    return { memberId };
  }
  return {
    memberId,
    latestSnapshot: {
      skills: { "/skills/attack": attackLevel },
    },
  };
}

test("profession distribution counts only bound members meeting attack threshold", () => {
  const text = formatProfessionDistribution(
    [
      member("a", 130),
      member("b", 119),
      member("c"),
    ],
    [
      { memberId: "a", combatType: "水" },
      { memberId: "b", combatType: "水" },
      { memberId: "outsider", combatType: "锤" },
    ],
  );

  assert.match(text, /攻击≥110：2\/3 人，已绑定 2 人/u);
  assert.match(text, /水：2（100\.0%）/u);
  assert.match(text, /锤：0（0\.0%）/u);
  assert.match(text, /未绑定：1/u);
  assert.doesNotMatch(text, /已绑定未达门槛/u);
  assert.match(text, /快照攻击等级≥110/u);
});

test("profession distribution lists bound members without snapshots as ineligible", () => {
  const text = formatProfessionDistribution(
    [
      member("a", 130),
      { memberId: "b", displayName: "Beta" },
    ],
    [
      { memberId: "a", combatType: "水" },
      { memberId: "b", combatType: "火" },
    ],
  );

  assert.match(text, /已绑定未达门槛（1 人）：/u);
  assert.match(text, /1\. Beta（未上传）/u);
});

test("profession distribution includes members exactly at attack threshold", () => {
  const text = formatProfessionDistribution(
    [member("a", 110)],
    [{ memberId: "a", combatType: "枪" }],
  );

  assert.match(text, /攻击≥110：1\/1 人，已绑定 1 人/u);
  assert.match(text, /枪：1（100\.0%）/u);
  assert.doesNotMatch(text, /已绑定未达门槛/u);
});
