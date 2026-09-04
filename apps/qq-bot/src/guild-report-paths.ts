import path from "node:path";
import { fileURLToPath } from "node:url";

export const HELPER_REPO_RAW_BASE =
  "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main";
export const HELPER_PAGES_BASE =
  "https://xiahuaaaa.github.io/mwi-guild-trial-helper";

/** Relative path from combat-assignment/index.html to the life PNG (same for TMD and WI). */
export const LIFE_ASSIGNMENT_GALLERY_SRC = "../life-assignment/latest.png";

export interface GuildReportPaths {
  apiSlug: string;
  combatReportDirInRepo: string;
  lifeReportDirInRepo: string;
  combatPublicBaseUrl: string;
  combatPublicIndexUrl: string;
  combatPublicManifestUrl: string;
  combatPublicJsonUrl: string;
  lifePublicPngUrl: string;
  lifePublicJsonUrl: string;
  testReportArtifactsDir: string;
  lifeReportArtifactsDir: string;
  combatTestRunStatePath: string;
  combatTestRunLogPath: string;
  backupRootDir: string;
  professionReportCacheDir: string | undefined;
  availableRosterLabJsonPath: string;
  registeredRosterLabJsonPath: string;
  boundRosterFullEngineLabJsonPath: string;
}

export function normalizeApiSlug(guildId?: string): string {
  const raw = (guildId ?? process.env.MWI_GUILD_ID ?? "TMD").trim();
  return raw || "TMD";
}

/** Pages/raw path prefix inside helper repo `reports/`. TMD stays unprefixed; WI uses `WI/`. */
export function reportsPathPrefix(apiSlug: string): string {
  return apiSlug === "WI" ? "WI/" : "";
}

export function combatAssignmentReportDirInRepo(apiSlug: string): string {
  return `reports/${reportsPathPrefix(apiSlug)}combat-assignment`;
}

export function lifeAssignmentReportDirInRepo(apiSlug: string): string {
  return `reports/${reportsPathPrefix(apiSlug)}life-assignment`;
}

export function combatAssignmentPublicBaseUrl(apiSlug: string): string {
  return `${HELPER_REPO_RAW_BASE}/${combatAssignmentReportDirInRepo(apiSlug)}`;
}

export function combatAssignmentPublicIndexUrl(apiSlug: string): string {
  return `${HELPER_PAGES_BASE}/${combatAssignmentReportDirInRepo(apiSlug)}/`;
}

export function lifeAssignmentPublicPngUrl(apiSlug: string): string {
  return `${HELPER_REPO_RAW_BASE}/${lifeAssignmentReportDirInRepo(apiSlug)}/latest.png`;
}

export function lifeAssignmentPublicJsonUrl(apiSlug: string): string {
  return `${HELPER_REPO_RAW_BASE}/${lifeAssignmentReportDirInRepo(apiSlug)}/latest.json`;
}

function localFilePrefix(apiSlug: string): string {
  return apiSlug === "TMD" ? "tmd" : apiSlug.toLowerCase();
}

export const TMD_DEFAULT_EXCLUDE_MEMBERS = "xlsx,sh1ro";

/** Default comma-separated exclude list when `MWI_GUILD_EXCLUDE_MEMBERS` is unset. */
export function defaultExcludeMembersForSlug(apiSlug: string): string {
  return apiSlug === "TMD" ? TMD_DEFAULT_EXCLUDE_MEMBERS : "";
}

/**
 * Resolve exclude-member env for weekly lab / combat-test pipelines.
 * Unset env → slug default; empty string → exclude nobody (explicit).
 */
export function resolveExcludeMembersEnv(
  apiSlugInput?: string,
  envValue: string | undefined = process.env.MWI_GUILD_EXCLUDE_MEMBERS,
): string {
  if (envValue !== undefined) {
    return String(envValue).trim();
  }
  return defaultExcludeMembersForSlug(normalizeApiSlug(apiSlugInput));
}

export function parseExcludedMemberIds(
  apiSlugInput?: string,
  envValue?: string,
): Set<string> {
  return new Set(
    resolveExcludeMembersEnv(apiSlugInput, envValue)
      .split(/[,，\s]+/u)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => name.toLocaleLowerCase()),
  );
}

export function labArtifactKind(apiSlug: string, stem: string): string {
  return `${localFilePrefix(apiSlug)}-${stem}`;
}

export function localLabJsonPath(
  projectRoot: string,
  apiSlug: string,
  stem: string,
): string {
  return path.join(projectRoot, `.local/${localFilePrefix(apiSlug)}-${stem}.json`);
}

export function combatTestRunBasename(apiSlug: string): string {
  return apiSlug === "TMD"
    ? "combat-test-run"
    : `${apiSlug.toLowerCase()}-combat-test-run`;
}

export function defaultSimulatorProjectRoot(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
}

export function resolveLifeReportDirectory(
  apiSlugInput?: string,
  projectRoot = defaultSimulatorProjectRoot(),
): string {
  const apiSlug = normalizeApiSlug(apiSlugInput);
  const suffix = apiSlug === "TMD" ? "" : `_${apiSlug}`;
  const fromEnv =
    process.env[`MWI_LIFE_REPORT_DIR${suffix}`]?.trim() ??
    (apiSlug === "TMD" ? process.env.MWI_LIFE_REPORT_DIR?.trim() : undefined);
  if (fromEnv) return fromEnv;
  const simulatorRoot = process.env.MWI_GUILD_SIMULATOR_ROOT?.trim();
  return resolveGuildReportPaths(apiSlug, simulatorRoot || projectRoot)
    .lifeReportArtifactsDir;
}

export function resolveGuildReportPaths(
  apiSlugInput?: string,
  projectRoot = defaultSimulatorProjectRoot(),
): GuildReportPaths {
  const apiSlug = normalizeApiSlug(apiSlugInput);
  const combatReportDirInRepo = combatAssignmentReportDirInRepo(apiSlug);
  const lifeReportDirInRepo = lifeAssignmentReportDirInRepo(apiSlug);
  const combatPublicBaseUrl = combatAssignmentPublicBaseUrl(apiSlug);
  const localDir = path.join(projectRoot, ".local");
  const combatBasename = combatTestRunBasename(apiSlug);
  const cacheRoot = process.env.MWI_QQ_PROFESSION_REPORT_CACHE_DIR?.trim();
  let professionReportCacheDir: string | undefined;
  if (cacheRoot === "") {
    professionReportCacheDir = undefined;
  } else {
    const root = cacheRoot ?? "/var/lib/mwi-guild-server/qq-profession-report-cache";
    professionReportCacheDir = apiSlug === "TMD"
      ? root
      : path.join(root, apiSlug);
  }

  const artifactsSlug = apiSlug === "TMD" ? null : apiSlug;
  const testReportArtifactsDir = artifactsSlug
    ? path.join(projectRoot, "artifacts", artifactsSlug, "test-report")
    : path.join(projectRoot, "artifacts/test-report");
  const lifeReportArtifactsDir = artifactsSlug
    ? path.join(projectRoot, "artifacts", artifactsSlug, "life-report")
    : path.join(projectRoot, "artifacts/life-report");

  const backupSlug = apiSlug === "TMD" ? "tmd" : apiSlug.toLowerCase();

  return {
    apiSlug,
    combatReportDirInRepo,
    lifeReportDirInRepo,
    combatPublicBaseUrl,
    combatPublicIndexUrl: combatAssignmentPublicIndexUrl(apiSlug),
    combatPublicManifestUrl: `${combatPublicBaseUrl}/manifest.json`,
    combatPublicJsonUrl: `${combatPublicBaseUrl}/latest.json`,
    lifePublicPngUrl: lifeAssignmentPublicPngUrl(apiSlug),
    lifePublicJsonUrl: lifeAssignmentPublicJsonUrl(apiSlug),
    testReportArtifactsDir,
    lifeReportArtifactsDir,
    combatTestRunStatePath: path.join(localDir, `${combatBasename}.json`),
    combatTestRunLogPath: path.join(localDir, `${combatBasename}.log`),
    backupRootDir: path.join(projectRoot, "backups", backupSlug),
    professionReportCacheDir,
    availableRosterLabJsonPath: localLabJsonPath(
      projectRoot,
      apiSlug,
      "available-roster-composition-lab",
    ),
    registeredRosterLabJsonPath: localLabJsonPath(
      projectRoot,
      apiSlug,
      "registered-roster-composition-lab",
    ),
    boundRosterFullEngineLabJsonPath: localLabJsonPath(
      projectRoot,
      apiSlug,
      "bound-roster-full-engine-lab",
    ),
  };
}
