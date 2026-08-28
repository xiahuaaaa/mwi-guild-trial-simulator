import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LifeAssignmentRun } from "../../../packages/guild-trial-core/src/life-trial-optimizer.ts";
import { screenshotHtmlToPng } from "./html-screenshot.ts";
import { formatBeijingDate, formatBeijingTimestamp } from "./beijing-time.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export const LIFE_ASSIGNMENT_PUBLIC_PNG_URL =
  "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/reports/life-assignment/latest.png";

export const LIFE_ASSIGNMENT_PUBLIC_JSON_URL =
  "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/reports/life-assignment/latest.json";

const REPORT_WIDTH = 1400;

/** Official EN labels for life skills; fall back to Title Case of the skill slug. */
const SKILL_EN_BY_HRID: Record<string, string> = {
  "/skills/alchemy": "Alchemy",
  "/skills/brewing": "Brewing",
  "/skills/cheesesmithing": "Cheesesmithing",
  "/skills/cooking": "Cooking",
  "/skills/crafting": "Crafting",
  "/skills/enhancing": "Enhancing",
  "/skills/foraging": "Foraging",
  "/skills/milking": "Milking",
  "/skills/tailoring": "Tailoring",
  "/skills/woodcutting": "Woodcutting",
};

export function lifeSkillEnglishName(skillHrid: string, trialName = ""): string {
  if (SKILL_EN_BY_HRID[skillHrid]) return SKILL_EN_BY_HRID[skillHrid];
  const slug = skillHrid.split("/").at(-1) ?? "";
  if (slug) {
    return slug
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return trialName || skillHrid;
}

type LifeAssignmentTrial = LifeAssignmentRun["trials"][number];

export function finalLevelProgressPercent(trial: LifeAssignmentTrial): number {
  if (trial.finalLevelRequired <= 0) return 0;
  return Math.round(
    Math.min(100, Math.max(0, (trial.remainingProgress / trial.finalLevelRequired) * 100)),
  );
}

export function formatFinalLevelProgress(trial: LifeAssignmentTrial): string {
  const pct = finalLevelProgressPercent(trial);
  return `Lv.${trial.finalLevel} ${pct}%（${trial.remainingProgress}/${trial.finalLevelRequired}）`;
}

export function formatLifeAssignmentReportSummary(
  run: LifeAssignmentRun,
  options: { publicUrl?: string; browseUrl?: string } = {},
): string {
  const publicUrl = options.publicUrl ?? LIFE_ASSIGNMENT_PUBLIC_PNG_URL;
  const browseUrl = options.browseUrl ??
    "https://xiahuaaaa.github.io/mwi-guild-trial-helper/reports/combat-assignment/";
  const trialLine = run.trials
    .map((trial) => {
      const en = lifeSkillEnglishName(trial.skillHrid, trial.trialName);
      const tail = formatFinalLevelProgress(trial);
      return `${trial.trialName}/${en} ${trial.expectedLevelsCleared}层+末层${tail}/${trial.basePoints}点（${trial.roster.length}人）`;
    })
    .join(" · ");
  return [
    `本周生活分工推荐 / Weekly Life Trial Assignments（${formatBeijingDate(run.weekStartAt)}）`,
    `生活基础点数合计 / Total base points：${run.totalBasePoints}`,
    trialLine,
    "",
    "完整名单见下图。 / Full roster in the image below.",
    `公网图片 / Public image：${publicUrl}`,
    `本周分工浏览页 / Weekly gallery：${browseUrl}`,
  ].join("\n");
}

export function renderLifeAssignmentReportHtml(run: LifeAssignmentRun): string {
  const trialCards = run.trials
    .map((trial, index) => {
      const en = lifeSkillEnglishName(trial.skillHrid, trial.trialName);
      const finalPct = finalLevelProgressPercent(trial);
      const names = trial.roster.length
        ? trial.roster
          .map(
            (name, memberIndex) =>
              `<li><span class="idx">${memberIndex + 1}</span>${escapeHtml(name)}</li>`,
          )
          .join("")
        : `<li class="empty">（暂无推荐） / None</li>`;
      return `<section class="card">
      <div class="card-head">
        <div class="badge">第 ${index + 1} 场<span class="en">Trial ${index + 1}</span></div>
        <h2>${escapeHtml(trial.trialName)}<span class="en">${escapeHtml(en)}</span></h2>
      </div>
      <div class="meta">
        <span>期望层数 <b>${trial.expectedLevelsCleared}</b> <i style="font-style:normal;color:#7a8f82">/ Levels</i></span>
        <span>末层 <b>Lv.${trial.finalLevel}</b> <b>${finalPct}%</b> <i style="font-style:normal;color:#7a8f82">/ Final floor</i></span>
        <span>基础点数 <b>${trial.basePoints}</b> <i style="font-style:normal;color:#7a8f82">/ Points</i></span>
        <span>人数 <b>${trial.roster.length}</b>/${trial.maxParticipants} <i style="font-style:normal;color:#7a8f82">/ Players</i></span>
      </div>
      <div class="roster-title">推荐名单<span class="en">Recommended roster</span></div>
      <ol class="roster">${names}</ol>
    </section>`;
    })
    .join("");

  const unassigned = run.unassigned.length
    ? `<div class="unassigned"><b>未分配（${run.unassigned.length}）</b>：${
      escapeHtml(run.unassigned.join("、"))
    }<span class="en">Unassigned (${run.unassigned.length}): ${
      escapeHtml(run.unassigned.join(", "))
    }</span></div>`
    : "";

  const trialSummary = run.trials
    .map((trial) => {
      const en = lifeSkillEnglishName(trial.skillHrid, trial.trialName);
      const pct = finalLevelProgressPercent(trial);
      return `${escapeHtml(trial.trialName)}/${escapeHtml(en)} ${trial.expectedLevelsCleared}+Lv.${trial.finalLevel} ${pct}%`;
    })
    .join(" · ");

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${reportFontCss()}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#eef5ef;color:#1b2a1f}
body{font-family:'ReportCJK',-apple-system,BlinkMacSystemFont,'Noto Sans CJK SC','Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif}
.page{width:${REPORT_WIDTH}px;padding:28px 32px 24px;background:linear-gradient(150deg,#f7fbf7 0%,#eef7f0 48%,#f4f8ff 100%)}
header{background:#1f3d2c;color:#fff;border-radius:18px;padding:18px 24px;box-shadow:0 12px 28px #2f5a3d33;margin-bottom:16px}
h1{font-size:28px;margin:0 0 4px;font-weight:700}
.h1-en{display:block;font-size:15px;font-weight:500;color:#c5ddcf;margin-top:6px}
.sub{font-size:14px;color:#d7ebdd;line-height:1.6;margin-top:10px}
.sub b{color:#fff}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.card{background:#fff;border:1px solid #d7e6db;border-radius:14px;padding:14px 14px 12px;box-shadow:0 6px 16px #36507a12;min-width:0}
.card-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.badge{flex:0 0 auto;background:#e7f4ea;color:#2f6b45;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700}
.badge .en{color:#6a8a74;font-weight:600;margin-left:4px}
.card h2{margin:0;font-size:22px;color:#214d33;font-weight:700}
.card h2 .en{display:block;font-size:13px;font-weight:600;color:#5a7a66;margin-top:2px}
.meta{display:flex;flex-wrap:wrap;gap:10px 16px;margin-bottom:8px;font-size:12px;color:#4d6356}
.meta b{color:#1f3d2c;font-variant-numeric:tabular-nums}
.roster-title{font-size:12px;font-weight:700;color:#2f6b45;margin:0 0 6px}
.roster-title .en{font-weight:600;color:#6a8a74;margin-left:6px}
.roster{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 8px}
.roster li{font-size:13px;line-height:1.35;padding:3px 4px;border-radius:6px;background:#f5faf6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.roster .idx{display:inline-block;min-width:18px;margin-right:4px;color:#7a8f82;font-variant-numeric:tabular-nums}
.roster .empty{grid-column:1/-1;text-align:center;color:#788297;background:transparent}
.unassigned{margin-top:14px;padding:12px 16px;border-radius:12px;background:#fff;border:1px solid #d7e6db;color:#3d5245;font-size:13px;line-height:1.5}
.unassigned .en{display:block;color:#6a8a74;font-size:12px;margin-top:2px}
</style></head><body><main class="page">
<header>
  <h1>本周生活分工推荐<span class="h1-en">Weekly Life Trial Assignments</span></h1>
  <div class="sub">
    公会周：${escapeHtml(formatBeijingDate(run.weekStartAt))} · 生成于：${escapeHtml(formatBeijingTimestamp(run.generatedAt))}<br>
    <span style="opacity:.9">Guild week: ${escapeHtml(formatBeijingDate(run.weekStartAt))} · Generated: ${escapeHtml(formatBeijingTimestamp(run.generatedAt))}</span><br>
    生活基础点数合计 <b>${run.totalBasePoints}</b> · 期望层数 ${trialSummary}<br>
    <span style="opacity:.9">Total base points <b>${run.totalBasePoints}</b> · Expected levels ${trialSummary}</span>
  </div>
</header>
<section class="grid">${trialCards}</section>
${unassigned}
</main></body></html>`;
}

export async function renderLifeAssignmentReportPng(
  run: LifeAssignmentRun,
): Promise<Buffer> {
  const html = renderLifeAssignmentReportHtml(run);
  return screenshotHtmlToPng(html, {
    width: REPORT_WIDTH,
    height: estimateLifeAssignmentReportHeight(run),
  });
}

export async function renderLifeAssignmentReportPngBase64(
  run: LifeAssignmentRun,
): Promise<string> {
  const png = await renderLifeAssignmentReportPng(run);
  return png.toString("base64");
}

export function estimateLifeAssignmentReportHeight(run: LifeAssignmentRun): number {
  const header = 160;
  const rosterColumns = 3;
  const maxRoster = Math.max(
    ...run.trials.map((trial) => Math.max(trial.roster.length, 1)),
    1,
  );
  const rosterRows = Math.ceil(maxRoster / rosterColumns);
  // Match .roster li: 13px font, line-height 1.35, padding 3px 4px, gap 4px.
  const rosterRowHeight = Math.ceil(13 * 1.35) + 6;
  const rosterGap = 4;
  const rosterHeight =
    rosterRows * rosterRowHeight + Math.max(0, rosterRows - 1) * rosterGap;
  const cardOverhead = 150;
  const cardHeight = cardOverhead + rosterHeight;
  const gridRows = Math.ceil(Math.max(run.trials.length, 1) / 2);
  const gridGap = Math.max(0, gridRows - 1) * 14;

  let unassignedHeight = 0;
  if (run.unassigned.length > 0) {
    const zhNames = run.unassigned.join("、");
    const enNames = run.unassigned.join(", ");
    const charsPerLine = 72;
    const zhLines = Math.ceil((zhNames.length + 8) / charsPerLine);
    const enLines = Math.ceil((enNames.length + 20) / charsPerLine);
    unassignedHeight = 14 + 24 + zhLines * 20 + enLines * 18;
  }

  const buffer = 56;
  return header + gridRows * cardHeight + gridGap + unassignedHeight + buffer;
}

export function writeLifeAssignmentReportArtifacts(
  run: LifeAssignmentRun,
  png: Buffer,
  outputDirectory: string,
): { pngPath: string; jsonPath: string; manifestPath: string } {
  mkdirSync(outputDirectory, { recursive: true });
  const pngPath = path.join(outputDirectory, "latest.png");
  const jsonPath = path.join(outputDirectory, "latest.json");
  const manifestPath = path.join(outputDirectory, "manifest.json");
  const tempPng = `${pngPath}.${process.pid}.tmp`;
  writeFileSync(tempPng, png);
  renameSync(tempPng, pngPath);
  writeFileSync(`${jsonPath}.tmp`, `${JSON.stringify(run, null, 2)}\n`);
  renameSync(`${jsonPath}.tmp`, jsonPath);
  const manifest = {
    kind: "life-assignment-report",
    weekStartAt: run.weekStartAt,
    generatedAt: run.generatedAt,
    totalBasePoints: run.totalBasePoints,
    publicPngUrl: LIFE_ASSIGNMENT_PUBLIC_PNG_URL,
    publicJsonUrl: LIFE_ASSIGNMENT_PUBLIC_JSON_URL,
    files: [
      { fileName: "latest.png", title: "本周生活分工 / Weekly Life Trial Assignments" },
      { fileName: "latest.json", title: "本周生活分工 JSON" },
    ],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { pngPath, jsonPath, manifestPath };
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let cachedFontCss: string | undefined;

function reportFontCss(): string {
  if (cachedFontCss !== undefined) return cachedFontCss;
  const candidates = [
    process.env.MWI_REPORT_FONT_PATH,
    path.join(projectRoot, ".local/fonts/NotoSansSC-Regular.woff2"),
    path.join(projectRoot, ".local/fonts/NotoSansSC-Regular.otf"),
    "/opt/mwi-guild-server/.local/fonts/NotoSansSC-Regular.woff2",
    "/opt/mwi-guild-server/.local/fonts/NotoSansSC-Regular.otf",
    "D:\\mwi-guild-server\\.local\\fonts\\NotoSansSC-Regular.woff2",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const bytes = readFileSync(candidate);
      if (bytes.length <= 2_500_000) {
        const format = candidate.endsWith(".woff2")
          ? "woff2"
          : candidate.endsWith(".otf")
            ? "opentype"
            : "truetype";
        cachedFontCss =
          `@font-face{font-family:'ReportCJK';font-style:normal;font-weight:400;` +
          `src:url('data:font/${format === "woff2" ? "woff2" : "ttf"};base64,${bytes.toString("base64")}') format('${format}');}`;
        return cachedFontCss;
      }
    } catch {
      // try next candidate
    }
  }

  cachedFontCss = "";
  return cachedFontCss;
}
