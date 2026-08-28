import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuildProfessionReport,
  formatGuildProfessionReport,
  formatGuildProfessionReportSummary,
  professionReportCacheKey,
  renderGuildProfessionReportHtml,
} from "../../apps/qq-bot/src/guild-profession-report.ts";

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
      ],
    },
    ...overrides,
  };
}

test("formatGuildProfessionReport handles empty members", () => {
  const text = formatGuildProfessionReport([]);
  assert.match(text, /暂无成员快照数据/u);
});

test("buildGuildProfessionReport ranks alchemy with equipment efficiency", () => {
  const report = buildGuildProfessionReport([member()]);
  assert.ok(report);
  assert.equal(report.snapshotCount, 1);
  const alchemy = report.sections.find((section) => section.name === "炼金");
  assert.ok(alchemy);
  assert.equal(alchemy.entries[0]?.name, "测试角色");
  assert.equal(alchemy.entries[0]?.workforce, 98);
});

test("formatGuildProfessionReport keeps the legacy text layout", () => {
  const text = formatGuildProfessionReport([member()]);
  assert.match(text, /公会专业技能查询（每专业 Top 20）/u);
  assert.match(text, /共 1 人已有快照/u);
  assert.match(text, /炼金：1\.测试角色\(98\.0\)/u);
  assert.match(text, /口径：工作力/u);
});

test("formatGuildProfessionReportSummary points readers to the image", () => {
  const report = buildGuildProfessionReport([member()]);
  assert.ok(report);
  const text = formatGuildProfessionReportSummary(report);
  assert.match(text, /完整排行见下图/u);
  assert.doesNotMatch(text, /炼金：1\.测试角色/u);
});

test("renderGuildProfessionReportHtml includes all professions in a grid", () => {
  const report = buildGuildProfessionReport([member()]);
  assert.ok(report);
  const html = renderGuildProfessionReportHtml(report);
  assert.match(html, /公会专业技能查询（每专业 Top 20）/u);
  assert.match(html, /class="grid"/u);
  assert.match(html, /grid-template-columns:repeat\(5,/u);
  assert.match(html, /font-family:'ReportCJK'/u);
  for (const name of ["炼金", "冲泡", "奶酪锻造", "烹饪", "制作", "强化", "采集", "挤奶", "裁缝", "伐木"]) {
    assert.match(html, new RegExp(`<h2>${name}</h2>`, "u"), `should include ${name}`);
  }
  assert.match(html, /测试角色/u);
  assert.match(html, /98\.0/u);
});

test("profession report cache key is stable for identical reports", () => {
  const report = buildGuildProfessionReport([member()]);
  assert.ok(report);
  assert.equal(professionReportCacheKey(report), professionReportCacheKey(report));
});

test("buildGuildProfessionReport skips members without snapshots", () => {
  const report = buildGuildProfessionReport([
    member(),
    { memberId: "no-snapshot", displayName: "无快照", latestSnapshot: null },
  ]);
  assert.ok(report);
  assert.equal(report.snapshotCount, 1);
});
