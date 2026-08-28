import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeWorkforce, LIFE_SKILLS } from "./life-workforce.ts";
import { screenshotHtmlToPng } from "./html-screenshot.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

type Json = Record<string, unknown>;

export const PROFESSION_REPORT_TOP_N = 20;

export const PROFESSION_REPORT_FOOTNOTE =
  "口径：工作力 = floor(技能等级 × (1 + 装备效率加成))；生活分工优化目标为四场生活基础点数之和";

export interface ProfessionReportEntry {
  rank: number;
  name: string;
  workforce: number;
}

export interface ProfessionReportSection {
  name: string;
  entries: ProfessionReportEntry[];
}

export interface GuildProfessionReport {
  topN: number;
  snapshotCount: number;
  sections: ProfessionReportSection[];
}

const REPORT_WIDTH = 1600;
const GRID_COLUMNS = 5;

export function buildGuildProfessionReport(
  members: readonly Json[],
): GuildProfessionReport | null {
  const withSnapshot = members.filter((member) => Boolean(member.latestSnapshot));
  if (!withSnapshot.length) return null;

  const nameOf = (member: Json) =>
    String(member.displayName ?? member.memberId);

  const sections: ProfessionReportSection[] = [];
  for (const skill of LIFE_SKILLS) {
    const entries: Array<{ name: string; workforce: number }> = [];
    for (const member of withSnapshot) {
      const workforce = computeWorkforce(
        member.latestSnapshot as Json,
        skill.hrid,
        skill.actionType,
        skill.efficiencyKey,
      );
      if (workforce > 0) entries.push({ name: nameOf(member), workforce });
    }
    entries.sort((left, right) => right.workforce - left.workforce);
    sections.push({
      name: skill.name,
      entries: entries.slice(0, PROFESSION_REPORT_TOP_N).map((entry, index) => ({
        rank: index + 1,
        name: entry.name,
        workforce: entry.workforce,
      })),
    });
  }

  return {
    topN: PROFESSION_REPORT_TOP_N,
    snapshotCount: withSnapshot.length,
    sections,
  };
}

export function formatGuildProfessionReport(members: readonly Json[]): string {
  const report = buildGuildProfessionReport(members);
  if (!report) {
    return "暂无成员快照数据，无法生成公会专业技能表。";
  }
  return formatGuildProfessionReportText(report);
}

export function formatGuildProfessionReportText(report: GuildProfessionReport): string {
  const lines = [
    `公会专业技能查询（每专业 Top ${report.topN}）`,
    `共 ${report.snapshotCount} 人已有快照`,
    "",
  ];

  for (const section of report.sections) {
    const row = section.entries
      .map((entry) => `${entry.rank}.${entry.name}(${entry.workforce.toFixed(1)})`)
      .join(" ");
    lines.push(`${section.name}：${row || "无数据"}`);
    lines.push("");
  }

  lines.push(PROFESSION_REPORT_FOOTNOTE);
  return lines.join("\n");
}

export function formatGuildProfessionReportSummary(report: GuildProfessionReport): string {
  return [
    `公会专业技能查询（每专业 Top ${report.topN}）`,
    `共 ${report.snapshotCount} 人已有快照`,
    "",
    "完整排行见下图。",
    PROFESSION_REPORT_FOOTNOTE,
  ].join("\n");
}

export function renderGuildProfessionReportHtml(report: GuildProfessionReport): string {
  const sectionCards = report.sections.map((section) => {
    const rows = section.entries.map((entry) => `<tr>
      <td class="rank">${entry.rank}</td>
      <td class="name">${escapeHtml(entry.name)}</td>
      <td class="wf">${entry.workforce.toFixed(1)}</td>
    </tr>`).join("");
    const emptyRow = section.entries.length
      ? ""
      : `<tr><td colspan="3" class="empty">无数据</td></tr>`;
    return `<section class="card">
      <h2>${escapeHtml(section.name)}</h2>
      <table>
        <thead><tr><th>#</th><th>成员</th><th>工作力</th></tr></thead>
        <tbody>${rows}${emptyRow}</tbody>
      </table>
    </section>`;
  }).join("");

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${reportFontCss()}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#edf3fc;color:#172033}
body{font-family:'ReportCJK',-apple-system,BlinkMacSystemFont,'Noto Sans CJK SC','Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif}
.page{width:${REPORT_WIDTH}px;padding:28px 32px 24px;background:linear-gradient(145deg,#f8faff 0%,#edf5ff 52%,#f7f4ff 100%)}
header{background:#17233d;color:#fff;border-radius:18px;padding:18px 24px;box-shadow:0 12px 28px #334a7a33;margin-bottom:16px}
h1{font-size:28px;margin:0 0 6px;font-weight:700}
.sub{font-size:15px;color:#c9d7f5}
.grid{display:grid;grid-template-columns:repeat(${GRID_COLUMNS},minmax(0,1fr));gap:12px}
.card{background:#fff;border:1px solid #dfe7f5;border-radius:12px;padding:10px 10px 8px;box-shadow:0 6px 16px #36507a12;min-width:0}
.card h2{margin:0 0 6px;font-size:16px;color:#2f4ea8;font-weight:700}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th{background:#e8effd;text-align:left;font-size:11px;padding:4px 5px}
td{border-top:1px solid #e8edf5;padding:3px 5px;font-size:11px;line-height:1.25}
.rank{width:22px;color:#60708c;text-align:center}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf{width:46px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#2f4ea8}
.empty{text-align:center;color:#788297;padding:12px 6px}
.foot{margin-top:14px;padding:12px 16px;border-radius:12px;background:#fff5d8;color:#725817;font-size:13px;line-height:1.5}
</style></head><body><main class="page">
<header>
  <h1>公会专业技能查询（每专业 Top ${report.topN}）</h1>
  <div class="sub">共 ${report.snapshotCount} 人已有快照</div>
</header>
<section class="grid">${sectionCards}</section>
<div class="foot">${escapeHtml(PROFESSION_REPORT_FOOTNOTE)}</div>
</main></body></html>`;
}

export async function renderGuildProfessionReportPngBase64(
  report: GuildProfessionReport,
): Promise<string> {
  const cachePath = resolveCachePath(report);
  if (cachePath && existsSync(cachePath)) {
    try {
      return readFileSync(cachePath).toString("base64");
    } catch {
      // fall through and re-render
    }
  }

  const html = renderGuildProfessionReportHtml(report);
  const png = await screenshotHtmlToPng(html, {
    width: REPORT_WIDTH,
    height: estimateReportHeight(report),
  });
  if (cachePath) {
    try {
      mkdirSync(path.dirname(cachePath), { recursive: true });
      const tempPath = `${cachePath}.${process.pid}.tmp`;
      writeFileSync(tempPath, png);
      renameSync(tempPath, cachePath);
    } catch (error) {
      console.error(
        "[guild-report] failed to cache profession report png:",
        (error as Error).message ?? error,
      );
    }
  }
  return png.toString("base64");
}

export function professionReportCacheKey(report: GuildProfessionReport): string {
  return createHash("sha256")
    .update(JSON.stringify(report))
    .digest("hex")
    .slice(0, 24);
}

function resolveCachePath(report: GuildProfessionReport): string | undefined {
  const raw = process.env.MWI_QQ_PROFESSION_REPORT_CACHE_DIR?.trim();
  const dir = raw === ""
    ? undefined
    : (raw ?? "/var/lib/mwi-guild-server/qq-profession-report-cache");
  if (!dir) return undefined;
  return path.join(dir, `life-top20-${professionReportCacheKey(report)}.png`);
}

export function estimateReportHeight(report: GuildProfessionReport): number {
  const header = 110;
  const footer = 70;
  const rowHeight = 20;
  const cardHeader = 36;
  const rowsPerCard = Math.max(
    ...report.sections.map((section) => Math.max(section.entries.length, 1)),
    1,
  );
  const cardHeight = cardHeader + 24 + rowsPerCard * rowHeight;
  const gridRows = Math.ceil(Math.max(report.sections.length, 1) / GRID_COLUMNS);
  return header + gridRows * cardHeight + Math.max(0, gridRows - 1) * 12 + footer + 40;
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
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const bytes = readFileSync(candidate);
      // Keep data-URI embeds bounded; huge TTC collections are used via local path instead.
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

  // Last resort: hope a system CJK font is installed.
  cachedFontCss = "";
  return cachedFontCss;
}
