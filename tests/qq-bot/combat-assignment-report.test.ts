import assert from "node:assert/strict";
import test from "node:test";

import {
  COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL,
  LIFE_ASSIGNMENT_GALLERY_SRC,
  buildCombatAssignmentIndexHtml,
  buildCombatAssignmentManifest,
  formatCombatAssignmentReportSummary,
  shortCombatReportTitle,
  shortCombatReportTitleEn,
} from "../../apps/qq-bot/src/combat-assignment-report.ts";

test("shortCombatReportTitle maps to gallery labels", () => {
  assert.equal(shortCombatReportTitle("试炼獾 · 阵容与技能"), "獾 · 阵容与技能");
  assert.equal(
    shortCombatReportTitle("试炼獾 · 48 人贡献明细"),
    "獾 · 成员明细",
  );
  assert.equal(
    shortCombatReportTitleEn("试炼獾 · 阵容与技能", "1-jellyfish-summary.png"),
    "Badger · Roster & Skills",
  );
  assert.equal(
    shortCombatReportTitleEn("试炼刺猬 · 44 人贡献明细", "2-hedgehog-members.png"),
    "Hedgehog · Members",
  );
});

test("formatCombatAssignmentReportSummary includes public browse index", () => {
  const text = formatCombatAssignmentReportSummary({
    assignmentId: 20,
    createdAtLabel: "2026-08-04 10:00",
    summaryText: "獾 14 层 / 刺猬 9 层",
    files: [
      { title: "试炼獾 · 阵容与技能", fileName: "1-jellyfish-summary.png" },
      { title: "试炼獾 · 成员明细", fileName: "1-jellyfish-members.png" },
    ],
  });
  assert.match(text, /本周分工 \/ Weekly Assignments（#20，2026-08-04 10:00）/u);
  assert.match(text, /獾 14 层/u);
  assert.match(text, /中\/英/u);
  assert.match(
    text,
    new RegExp(COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL.replaceAll(".", "\\."), "u"),
  );
  assert.match(text, /生活分工/u);
  assert.match(text, /1-jellyfish-summary\.png/u);
});

test("buildCombatAssignmentIndexHtml offers language switch and EN assets", () => {
  const html = buildCombatAssignmentIndexHtml({
    assignmentGeneratedAt: "2026-08-04T02:36:11.645Z",
    files: [
      { title: "试炼獾 · 阵容与技能", fileName: "1-jellyfish-summary.png" },
      { title: "试炼獾 · 48 人贡献明细", fileName: "1-jellyfish-members.png" },
      { title: "试炼刺猬 · 阵容与技能", fileName: "2-hedgehog-summary.png" },
      { title: "试炼刺猬 · 44 人贡献明细", fileName: "2-hedgehog-members.png" },
    ],
    englishFiles: [
      { title: "Badger · Roster & Skills", fileName: "1-jellyfish-summary.en.png" },
      { title: "Badger · Members", fileName: "1-jellyfish-members.en.png" },
      { title: "Hedgehog · Roster & Skills", fileName: "2-hedgehog-summary.en.png" },
      { title: "Hedgehog · Members", fileName: "2-hedgehog-members.en.png" },
    ],
    summaryText: "demo",
  });
  assert.match(html, /data-lang="zh"/u);
  assert.match(html, /data-lang="en"/u);
  assert.match(html, /data-src-en="1-jellyfish-summary\.en\.png"/u);
  assert.match(html, new RegExp(LIFE_ASSIGNMENT_GALLERY_SRC.replaceAll(".", "\\."), "u"));
  assert.match(html, /data-label-en="Life Trials"/u);
  assert.match(html, /data-label-zh="生活分工"/u);
  assert.match(html, /2026-08-04 10:36:11 北京时间/u);
  assert.doesNotMatch(html, /2026-08-04T02:36:11\.645Z/u);
  assert.match(html, /localStorage/u);
});

test("buildCombatAssignmentManifest stamps public URLs on each file", () => {
  const manifest = buildCombatAssignmentManifest({
    assignmentGeneratedAt: "2026-08-04T03:00:00.000Z",
    assignmentKind: "tmd-available-roster-composition-lab",
    files: [
      { title: "a", fileName: "1-jellyfish-summary.png" },
      { title: "b", fileName: "2-hedgehog-summary.png" },
    ],
  });
  assert.equal(manifest.kind, "combat-assignment-report");
  assert.equal(manifest.publicIndexUrl, COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.englishFiles?.length, 2);
  assert.match(manifest.files[0].publicUrl, /1-jellyfish-summary\.png$/u);
  assert.match(manifest.englishFiles![0].fileName, /\.en\.png$/u);
});
