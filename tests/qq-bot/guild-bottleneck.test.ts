import assert from "node:assert/strict";
import test from "node:test";

import { formatGuildBottleneck } from "../../apps/qq-bot/src/api-client.ts";

interface Json {
  [key: string]: unknown;
}

function member(overrides: Json = {}): Json {
  return {
    memberId: "test-1",
    displayName: "测试角色",
    latestSnapshot: {
      skills: {
        "/skills/alchemy": 80,
        "/skills/brewing": 70,
        "/skills/cheesesmithing": 60,
        "/skills/cooking": 90,
        "/skills/crafting": 100,
        "/skills/enhancing": 50,
        "/skills/foraging": 85,
        "/skills/milking": 75,
        "/skills/tailoring": 65,
        "/skills/woodcutting": 95,
      },
      loadoutCatalog: [
        {
          name: "炼金装",
          category: "profession",
          actionTypeHrid: "/action_types/alchemy",
          equipment: [
            { itemHrid: "/items/alchemists_bottoms", enhancementLevel: 5 },
            { itemHrid: "/items/alchemists_top", enhancementLevel: 10 },
          ],
        },
        {
          name: "战斗装",
          category: "combat",
          actionTypeHrid: "/action_types/combat",
          equipment: [],
        },
      ],
    },
    ...overrides,
  };
}

test("formatGuildBottleneck handles empty members", () => {
  const text = formatGuildBottleneck([]);
  assert.match(text, /暂无成员快照数据/u);
});

test("formatGuildBottleneck computes work force with equipment efficiency", () => {
  // Single member with 炼金 gear:
  // alchemists_bottoms: base 0.1 + 5*0.002 = 0.11
  // alchemists_top: base 0.1 + 10*0.002 = 0.12
  // total efficiency = 0.23
  // work force = floor(80 * (1 + 0.23)) = 98
  const text = formatGuildBottleneck([member()]);
  assert.match(text, /公会生活专业短板/u);
  assert.match(text, /共 1 人已有快照/u);
  assert.match(text, /制作/u);
  assert.match(text, /短板/u);
  // Check 炼金 work force appears
  assert.match(text, /98\.0/u);
});

test("formatGuildBottleneck ranks by work force and marks bottleneck", () => {
  const members = [];
  // Generate 50 members with varying skill levels
  for (let i = 0; i < 50; i++) {
    members.push(member({
      memberId: `member-${i}`,
      latestSnapshot: {
        skills: {
          "/skills/alchemy": 50 + i,
          "/skills/brewing": 60 + i,
          "/skills/cheesesmithing": 40 + i,
          "/skills/cooking": 70 + i,
          "/skills/crafting": 80 + i,
          "/skills/enhancing": 30 + i,
          "/skills/foraging": 55 + i,
          "/skills/milking": 45 + i,
          "/skills/tailoring": 65 + i,
          "/skills/woodcutting": 75 + i,
        },
        loadoutCatalog: [],
      },
    }));
  }
  const text = formatGuildBottleneck(members);
  // Enhancing should be the lowest (base 30-79, avg of top 40) — marked as bottleneck
  assert.match(text, /短板/u);
  assert.match(text, /共 50 人已有快照/u);
  // Bottleneck marker should be on the first line (lowest avg = enhancing)
  const lines = text.split("\n");
  const firstDataLine = lines.find(l => /^\s*\d/.test(l)) ?? "";
  assert.match(firstDataLine, /短板/u, "bottleneck should be on lowest-average profession");
  // All 10 professions should appear
  for (const name of ["炼金", "冲泡", "奶酪锻造", "烹饪", "制作", "强化", "采集", "挤奶", "裁缝", "伐木"]) {
    assert.match(text, new RegExp(name, "u"), `should include ${name}`);
  }
});

test("formatGuildBottleneck uses all members when fewer than TOP_N", () => {
  const members = [];
  for (let i = 0; i < 10; i++) {
    members.push(member({
      memberId: `member-${i}`,
      latestSnapshot: {
        skills: {
          "/skills/alchemy": 50 + i,
          "/skills/brewing": 55,
          "/skills/cheesesmithing": 45,
          "/skills/cooking": 65,
          "/skills/crafting": 75,
          "/skills/enhancing": 35,
          "/skills/foraging": 60,
          "/skills/milking": 40,
          "/skills/tailoring": 70,
          "/skills/woodcutting": 80,
        },
        loadoutCatalog: [],
      },
    }));
  }
  const text = formatGuildBottleneck(members);
  assert.match(text, /共 10 人已有快照/u);
  // Should still work with fewer than 40
  assert.match(text, /短板/u);
});

test("formatGuildBottleneck skips members without snapshots", () => {
  const members = [
    member(),
    { memberId: "no-snapshot", displayName: "无快照", latestSnapshot: null },
  ];
  const text = formatGuildBottleneck(members);
  assert.match(text, /共 1 人已有快照/u);
});

test("formatGuildBottleneck handles members with zero skill level", () => {
  const members = [
    member({
      latestSnapshot: {
        skills: {
          "/skills/alchemy": 0,
        },
        loadoutCatalog: [],
      },
    }),
  ];
  const text = formatGuildBottleneck(members);
  // Zero level → zero work force → filtered out → avg = 0
  assert.match(text, /—/u);
});
