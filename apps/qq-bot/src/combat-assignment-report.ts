/**
 * Public URLs and summary helpers for weekly guild assignment reports
 * (生活 + 战斗). Combat PNGs are rendered by
 * scripts/render-and-send-available-roster-report.mjs; life PNG by
 * life-assignment-report.ts. The GitHub Pages gallery is the member-facing hub.
 */

/** Keep in sync with life-assignment-report.ts LIFE_ASSIGNMENT_PUBLIC_PNG_URL. */
const LIFE_ASSIGNMENT_PUBLIC_PNG_URL =
  "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/reports/life-assignment/latest.png";

/** Raw file CDN for combat PNGs/JSON. Directory listing is not browsable here. */
export const COMBAT_ASSIGNMENT_PUBLIC_BASE_URL =
  "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/reports/combat-assignment";

/**
 * Member-facing gallery (GitHub Pages). Includes 生活分工 + 獾/刺猬四张战斗图。
 * Keep this path stable — it is the public “本周分工” browse URL.
 */
export const COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL =
  "https://xiahuaaaa.github.io/mwi-guild-trial-helper/reports/combat-assignment/";

/** Alias used in member-facing copy. */
export const WEEKLY_ASSIGNMENT_PUBLIC_INDEX_URL =
  COMBAT_ASSIGNMENT_PUBLIC_INDEX_URL;

/** Relative path from the gallery page to the life PNG in the helper repo. */
export const LIFE_ASSIGNMENT_GALLERY_SRC = "../life-assignment/latest.png";

export const LIFE_ASSIGNMENT_GALLERY_LABEL = "生活分工";
export const LIFE_ASSIGNMENT_GALLERY_LABEL_EN = "Life Trials";

export const COMBAT_ASSIGNMENT_PUBLIC_MANIFEST_URL =
  `${COMBAT_ASSIGNMENT_PUBLIC_BASE_URL}/manifest.json`;

export const COMBAT_ASSIGNMENT_PUBLIC_JSON_URL =
  `${COMBAT_ASSIGNMENT_PUBLIC_BASE_URL}/latest.json`;

export function combatAssignmentPublicFileUrl(fileName: string): string {
  return `${COMBAT_ASSIGNMENT_PUBLIC_BASE_URL}/${fileName}`;
}

export function combatAssignmentEnglishFileName(fileName: string): string {
  if (fileName.endsWith(".en.png")) return fileName;
  if (fileName.endsWith(".png")) return `${fileName.slice(0, -4)}.en.png`;
  return `${fileName}.en.png`;
}

export interface CombatAssignmentReportManifest {
  kind: "combat-assignment-report";
  schemaVersion: 1;
  assignmentGeneratedAt: string;
  assignmentKind?: string;
  generatedAt: string;
  publicBaseUrl: string;
  publicIndexUrl: string;
  publicManifestUrl: string;
  publicJsonUrl: string;
  files: Array<{ title: string; fileName: string; publicUrl: string }>;
  englishFiles?: Array<{ title: string; fileName: string; publicUrl: string }>;
}

/** Short labels for the gallery nav (獾 · 阵容与技能, …). */
export function shortCombatReportTitle(title: string): string {
  return String(title ?? "")
    .replace(/^试炼/u, "")
    .replace(/\s*·\s*\d+\s*人贡献明细$/u, " · 成员明细")
    .replace(/\s*·\s*成员贡献明细$/u, " · 成员明细")
    .replace(/\s*·\s*\d+\s*人明细$/u, " · 成员明细")
    .trim();
}

export function shortCombatReportTitleEn(title: string, fileName = ""): string {
  const lower = `${title} ${fileName}`.toLowerCase();
  const isMembers = /members|明细|贡献/.test(lower);
  if (/swarm|虫群/.test(lower)) {
    return isMembers ? "Swarm · Members" : "Swarm · Roster & Skills";
  }
  if (/chameleon|变色龙/.test(lower)) {
    return isMembers ? "Chameleon · Members" : "Chameleon · Roster & Skills";
  }
  if (/hedgehog|刺猬/.test(lower)) {
    return isMembers ? "Hedgehog · Members" : "Hedgehog · Roster & Skills";
  }
  if (/badger|獾|jellyfish/.test(lower)) {
    // legacy jellyfish slug is still Trial Badger content
    return isMembers ? "Badger · Members" : "Badger · Roster & Skills";
  }
  return isMembers ? "Members" : "Roster & Skills";
}

export function formatCombatAssignmentReportSummary(input: {
  assignmentId?: string | number;
  createdAtLabel?: string;
  summaryText: string;
  files?: Array<{ title: string; fileName: string }>;
  publicIndexUrl?: string;
  includeLifeLink?: boolean;
}): string {
  const indexUrl = input.publicIndexUrl ?? WEEKLY_ASSIGNMENT_PUBLIC_INDEX_URL;
  const headerParts = ["本周分工 / Weekly Assignments"];
  if (input.assignmentId != null) {
    headerParts.push(`（#${String(input.assignmentId)}`);
    if (input.createdAtLabel) {
      headerParts.push(`，${input.createdAtLabel}`);
    }
    headerParts[headerParts.length - 1] += "）";
  }
  const lines = [
    headerParts.join(""),
    input.summaryText.trim(),
    "",
    "完整名单见下图：生活分工 1 张 + 两个 Boss 阵容/成员图 4 张（公网页可切中/英）。",
    "Full roster below: 1 life image + 4 combat images (gallery supports ZH/EN).",
    `公网浏览 / Browse：${indexUrl}`,
  ];
  if (input.includeLifeLink !== false) {
    lines.push(`- ${LIFE_ASSIGNMENT_GALLERY_LABEL} / Life：${LIFE_ASSIGNMENT_PUBLIC_PNG_URL}`);
  }
  const files = Array.isArray(input.files) ? input.files : [];
  for (const file of files) {
    lines.push(
      `- ${shortCombatReportTitle(file.title)} / ${shortCombatReportTitleEn(file.title, file.fileName)}：${combatAssignmentPublicFileUrl(file.fileName)}`,
    );
  }
  return lines.join("\n");
}

export function buildCombatAssignmentManifest(input: {
  assignmentGeneratedAt: string;
  assignmentKind?: string;
  files: Array<{ title: string; fileName: string }>;
  englishFiles?: Array<{ title: string; fileName: string }>;
  generatedAt?: string;
}): CombatAssignmentReportManifest {
  const englishFiles = (input.englishFiles ?? input.files.map((file) => ({
    title: shortCombatReportTitleEn(file.title, file.fileName),
    fileName: combatAssignmentEnglishFileName(file.fileName),
  })));
  return {
    kind: "combat-assignment-report",
    schemaVersion: 1,
    assignmentGeneratedAt: input.assignmentGeneratedAt,
    assignmentKind: input.assignmentKind,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    publicBaseUrl: COMBAT_ASSIGNMENT_PUBLIC_BASE_URL,
    publicIndexUrl: WEEKLY_ASSIGNMENT_PUBLIC_INDEX_URL,
    publicManifestUrl: COMBAT_ASSIGNMENT_PUBLIC_MANIFEST_URL,
    publicJsonUrl: COMBAT_ASSIGNMENT_PUBLIC_JSON_URL,
    files: input.files.map((file) => ({
      ...file,
      publicUrl: combatAssignmentPublicFileUrl(file.fileName),
    })),
    englishFiles: englishFiles.map((file) => ({
      ...file,
      publicUrl: combatAssignmentPublicFileUrl(file.fileName),
    })),
  };
}

export interface WeeklyGalleryFile {
  title: string;
  titleEn?: string;
  /** Path relative to the gallery index.html (Chinese / bilingual asset). */
  src: string;
  /** Optional English-only asset; falls back to src. */
  srcEn?: string;
  label?: string;
  labelEn?: string;
}

/**
 * Selectable gallery page for GitHub Pages. Always includes 生活分工 first,
 * then combat report PNGs beside this index.html.
 */
export function buildCombatAssignmentIndexHtml(input: {
  assignmentGeneratedAt: string;
  files: Array<{ title: string; fileName: string }>;
  englishFiles?: Array<{ title: string; fileName: string }>;
  summaryText?: string;
  includeLife?: boolean;
}): string {
  const enByZh = new Map(
    (input.englishFiles ?? []).map((file) => {
      const zhName = file.fileName.replace(/\.en\.png$/u, ".png");
      return [zhName, file];
    }),
  );
  const galleryFiles: WeeklyGalleryFile[] = [];
  if (input.includeLife !== false) {
    galleryFiles.push({
      title: LIFE_ASSIGNMENT_GALLERY_LABEL,
      titleEn: LIFE_ASSIGNMENT_GALLERY_LABEL_EN,
      label: LIFE_ASSIGNMENT_GALLERY_LABEL,
      labelEn: LIFE_ASSIGNMENT_GALLERY_LABEL_EN,
      src: LIFE_ASSIGNMENT_GALLERY_SRC,
      srcEn: LIFE_ASSIGNMENT_GALLERY_SRC,
    });
  }
  for (const file of input.files) {
    const en = enByZh.get(file.fileName);
    galleryFiles.push({
      title: file.title,
      titleEn: en?.title ?? shortCombatReportTitleEn(file.title, file.fileName),
      label: shortCombatReportTitle(file.title),
      labelEn: en?.title ?? shortCombatReportTitleEn(file.title, file.fileName),
      src: file.fileName,
      srcEn: en?.fileName ?? combatAssignmentEnglishFileName(file.fileName),
    });
  }
  return buildWeeklyAssignmentIndexHtml({
    assignmentGeneratedAt: input.assignmentGeneratedAt,
    summaryText: input.summaryText,
    files: galleryFiles,
  });
}

export function buildWeeklyAssignmentIndexHtml(input: {
  assignmentGeneratedAt: string;
  files: WeeklyGalleryFile[];
  summaryText?: string;
}): string {
  const files = input.files.map((file, index) => ({
    ...file,
    label: file.label ?? shortCombatReportTitle(file.title),
    labelEn: file.labelEn ?? file.titleEn ?? file.label ?? file.title,
    srcEn: file.srcEn ?? file.src,
    index,
  }));
  const nav = files
    .map(
      (file) =>
        `<button type="button" class="tab${file.index === 0 ? " active" : ""}" data-index="${file.index}" data-src-zh="${escapeHtml(file.src)}" data-src-en="${escapeHtml(file.srcEn)}" data-label-zh="${escapeHtml(file.label)}" data-label-en="${escapeHtml(file.labelEn)}"><span class="i18n" data-zh="${escapeHtml(file.label)}" data-en="${escapeHtml(file.labelEn)}">${escapeHtml(file.label)}</span></button>`,
    )
    .join("\n      ");
  const first = files[0];
  const summary = input.summaryText
    ? `<pre class="summary" id="summaryBlock">${escapeHtml(input.summaryText.trim())}</pre>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>本周分工 / Weekly Assignments</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a222c;
      --text: #e8eef5;
      --muted: #93a4b8;
      --accent: #5eb1ff;
      --border: #2b3644;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      padding: 20px 20px 12px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, #17202a, var(--bg));
      display: flex;
      flex-wrap: wrap;
      gap: 12px 18px;
      align-items: flex-start;
      justify-content: space-between;
    }
    .header-text { min-width: 0; flex: 1 1 240px; }
    h1 { margin: 0 0 6px; font-size: 1.35rem; font-weight: 650; }
    .meta { color: var(--muted); font-size: 0.9rem; }
    .lang-switch {
      display: inline-flex;
      gap: 6px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px;
      flex: 0 0 auto;
    }
    .lang-btn {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--muted);
      border-radius: 999px;
      padding: 6px 12px;
      font: inherit;
      cursor: pointer;
    }
    .lang-btn.active {
      background: #243447;
      color: #fff;
      box-shadow: 0 0 0 1px rgba(94, 177, 255, 0.35);
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 14px 20px;
      position: sticky;
      top: 0;
      z-index: 2;
      background: rgba(15, 20, 25, 0.94);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
    }
    .tab {
      appearance: none;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      border-radius: 999px;
      padding: 8px 14px;
      font: inherit;
      cursor: pointer;
    }
    .tab:hover { border-color: var(--accent); }
    .tab.active {
      background: #243447;
      border-color: var(--accent);
      color: #fff;
      box-shadow: 0 0 0 1px rgba(94, 177, 255, 0.35);
    }
    main { padding: 16px 20px 40px; }
    .viewer {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      overflow: auto;
    }
    .viewer img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 0 auto;
      border-radius: 6px;
    }
    .caption {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 0.92rem;
    }
    .summary {
      margin: 12px 20px 0;
      padding: 12px 14px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      white-space: pre-wrap;
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.45;
      max-height: 180px;
      overflow: auto;
    }
    a.raw {
      color: var(--accent);
      text-decoration: none;
    }
    body.lang-en { font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
  </style>
</head>
<body>
  <header>
    <div class="header-text">
      <h1><span class="i18n" data-zh="本周分工" data-en="Weekly Assignments">本周分工</span></h1>
      <div class="meta">
        <span class="i18n" data-zh="战斗方案：" data-en="Combat plan: ">战斗方案：</span>${escapeHtml(input.assignmentGeneratedAt)}
        <span class="i18n" data-zh=" · 点选下方条目浏览生活/战斗图片" data-en=" · Pick a tab to browse life/combat images"> · 点选下方条目浏览生活/战斗图片</span>
      </div>
    </div>
    <div class="lang-switch" role="group" aria-label="Language">
      <button type="button" class="lang-btn active" data-lang="zh">中文</button>
      <button type="button" class="lang-btn" data-lang="en">English</button>
    </div>
  </header>
  ${summary}
  <nav class="tabs" aria-label="Weekly assignment images">
      ${nav}
  </nav>
  <main>
    <p class="caption" id="caption"></p>
    <div class="viewer">
      <img id="preview" src="${first ? escapeHtml(first.src) : ""}" alt="" />
    </div>
  </main>
  <script>
    const LANG_KEY = "mwi-weekly-assignment-lang";
    const tabs = Array.from(document.querySelectorAll(".tab"));
    const langButtons = Array.from(document.querySelectorAll(".lang-btn"));
    const preview = document.getElementById("preview");
    const caption = document.getElementById("caption");
    let lang = localStorage.getItem(LANG_KEY) === "en" ? "en" : "zh";
    let activeIndex = 0;

    function applyI18n() {
      document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
      document.body.classList.toggle("lang-en", lang === "en");
      document.querySelectorAll(".i18n").forEach((node) => {
        const value = node.getAttribute(lang === "en" ? "data-en" : "data-zh");
        if (value != null) node.textContent = value;
      });
      langButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
      });
    }

    function openLinkLabel() {
      return lang === "en" ? "Open original" : "打开原图";
    }

    function select(index) {
      activeIndex = index;
      const tab = tabs[index];
      if (!tab) return;
      tabs.forEach((node, i) => node.classList.toggle("active", i === index));
      const src = tab.getAttribute(lang === "en" ? "data-src-en" : "data-src-zh") || "";
      const label = tab.getAttribute(lang === "en" ? "data-label-en" : "data-label-zh") || "";
      preview.src = src;
      preview.alt = label;
      caption.innerHTML = label + ' · <a class="raw" href="' + src + '" target="_blank" rel="noopener">' + openLinkLabel() + "</a>";
    }

    function setLang(next) {
      lang = next === "en" ? "en" : "zh";
      localStorage.setItem(LANG_KEY, lang);
      applyI18n();
      select(activeIndex);
    }

    tabs.forEach((tab, index) => tab.addEventListener("click", () => select(index)));
    langButtons.forEach((btn) =>
      btn.addEventListener("click", () => setLang(btn.getAttribute("data-lang") || "zh")),
    );
    applyI18n();
    select(0);
  </script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
