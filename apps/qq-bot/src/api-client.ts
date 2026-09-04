import { access, readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CombatBinding,
  CommandServicePort,
  PluginArtifact,
  ServiceContent,
  ServiceResult,
  SimulationAvailability,
} from "./core/service-port.ts";
import type { AuraType, CombatType } from "./core/types.ts";
import {
  combatTestPipelineAvailability,
  defaultSimulatorRoot,
  formatCombatTestRunProgress,
  formatCombatTestRunStarted,
  reconcileCombatTestRunState,
  resolveCombatTestPaths,
  startCombatTestRun,
  startCombatTestRunPoller,
  stopCombatTestRun,
  type CombatTestRunPaths,
  type CombatTestRunState,
} from "./combat-test-run.ts";
import { formatAuraAssignments } from "./aura-assignment.ts";
import {
  combatRegistrationTrials,
  filterActiveRegistrationTrials,
  formatSignupAssignmentMismatches,
  formatUnassignedAssignmentMembers,
  pickLifeAssignmentForWeek,
} from "./trial-signup-check.ts";
import {
  formatLifeAssignmentRun,
  formatLifeTrialsOverview,
  generateLifeAssignmentRun,
  resolveLifeAssignmentEnvOverrides,
  resolveLifeTrialByToken,
  simulateLifeTrialForRoster,
  weeklySkillingTrialsFromCatalog,
} from "./life-assignment.ts";
import {
  formatLifeAssignmentReportSummary,
  renderLifeAssignmentReportPng,
  writeLifeAssignmentReportArtifacts,
} from "./life-assignment-report.ts";
import type { LifeAssignmentRun } from "../../packages/guild-trial-core/src/life-trial-optimizer.ts";
import { publishLifeAssignmentReportToGithub } from "./life-assignment-publish.ts";
import {
  formatCombatAssignmentReportSummary,
  LIFE_ASSIGNMENT_GALLERY_LABEL,
} from "./combat-assignment-report.ts";
import { fuzzyMatchMemberInGroup } from "./group-member-match.ts";
import {
  buildGuildProfessionReport,
  formatGuildProfessionReport,
  formatGuildProfessionReportSummary,
  renderGuildProfessionReportPngBase64,
} from "./guild-profession-report.ts";
import {
  formatProfessionRatingSummary,
  formatProfessionRatingText,
  loadProfessionRatingDataset,
  renderProfessionRatingPngBase64,
} from "./profession-rating-report.ts";
import { computeWorkforce, LIFE_SKILLS } from "./life-workforce.ts";
import { formatBeijingTimestamp } from "./beijing-time.ts";
import { guildMessageLabel } from "./guild-group-routing.ts";
import { resolveGuildReportPaths } from "./guild-report-paths.ts";
import {
  greasyForkScriptPageUrl,
  resolveWiGreasyForkScriptId,
  WI_GITHUB_DIST,
  wiGuildPluginInstallLinks,
} from "./wi-plugin-install-urls.ts";
import { assessCombatMemberReadiness, GUILD_TRIAL_MIN_ATTACK_LEVEL } from "../../../packages/optimizer/src/combat-member-readiness.mjs";
import { formatWeaponEnhancementCheck } from "../../../packages/optimizer/src/combat-weapon-check.mjs";
import {
  combatReadinessOptionsForGuild,
  formatShieldCapReason,
  keepTopShieldsByDefense,
  shieldsPerSideForGuild,
} from "../../../packages/optimizer/src/combat-eligibility-policy.mjs";

const BOTTLENECK_TOP_N = 40;
const PROFESSION_DISTRIBUTION_ATTACK_LEVEL_THRESHOLD = GUILD_TRIAL_MIN_ATTACK_LEVEL;

const QQ_BOT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const WI_GREASYFORK_ID_FILE = path.join(
  QQ_BOT_ROOT,
  ".local/wi-greasyfork-script-id",
);

export const WI_GUILD_PLUGIN_INSTALL_URL = WI_GITHUB_DIST;

const TMD_GUILD_PLUGIN_INSTALL_LINKS = [
  [
    "油叉（Greasy Fork）",
    greasyForkScriptPageUrl("588902"),
  ],
  [
    "Gitee",
    "https://gitee.com/lxxxhhyy/TMD-guild-trial-sync/raw/master/TMD-guild-trial-sync.user.js",
  ],
  [
    "GitHub",
    "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/dist/mwi-guild-trial-sync.user.js",
  ],
] as const;

function readWiGreasyForkScriptId(): string {
  const fileValue = existsSync(WI_GREASYFORK_ID_FILE)
    ? readFileSync(WI_GREASYFORK_ID_FILE, "utf8")
    : "";
  return resolveWiGreasyForkScriptId(
    process.env.WI_GREASYFORK_SCRIPT_ID ??
      process.env.MWI_WI_GREASYFORK_SCRIPT_ID,
    fileValue,
  );
}

function publicGuildPluginInstallLinks(apiSlug: string) {
  if (apiSlug === "WI") {
    const scriptId = readWiGreasyForkScriptId();
    if (!scriptId) {
      return [["GitHub", WI_GUILD_PLUGIN_INSTALL_URL]] as const;
    }
    return wiGuildPluginInstallLinks(scriptId);
  }
  return TMD_GUILD_PLUGIN_INSTALL_LINKS;
}

interface GuildApiClientConfig {
  baseUrl: string;
  adminKey: string;
  guildId: string;
  pluginId?: string;
  testReportDirectory?: string;
  memberPluginPath?: string;
  /** Workspace with combat lab scripts; defaults to MWI_GUILD_SIMULATOR_ROOT. */
  simulatorRoot?: string;
  combatTestStatePath?: string;
  combatTestLogPath?: string;
}

interface ApiFailure {
  error?: { code?: string; message?: string };
}

type Json = Record<string, unknown>;

/** Armor, elemental resist, and five-way evasion for guild boss command output. */
export function formatGuildBossDefenseLine(monster: Json): string {
  const resist = monster.resistance as Json | undefined;
  const evasion = monster.evasion as Json | undefined;
  const armorResist = [
    `护甲 ${String(monster.armor ?? "?")}`,
    `水/自然/火抗 ${String(resist?.water ?? "?")}/${String(resist?.nature ?? "?")}/${String(resist?.fire ?? "?")}`,
  ].join("；");
  const evasionLine = [
    `刺/斩/钝/远程/魔法闪避 ${String(evasion?.stab ?? "?")}`,
    String(evasion?.slash ?? "?"),
    String(evasion?.smash ?? "?"),
    String(evasion?.ranged ?? "?"),
    String(evasion?.magic ?? "?"),
  ].join("/");
  return `${armorResist}；${evasionLine}`;
}

/** Trial label plus distinct monster name (e.g. 试炼虫群·试炼蜻蜓). */
export function formatGuildBossMonsterLabel(
  trialName: string,
  monster: Json,
  options: { multiMonsterTrial?: boolean } = {},
): string {
  const trial = trialName.trim();
  const monsterName = String(monster.name ?? monster.nameZh ?? "").trim();
  if (!trial) return monsterName;
  if (!options.multiMonsterTrial || !monsterName || monsterName === trial) {
    return trial;
  }
  return `${trial}·${monsterName}`;
}

export function formatGuildBossMonsterPanelLine(
  trialName: string,
  monster: Json,
  options: {
    multiMonsterTrial?: boolean;
    participantCap?: string;
    showParticipantCap?: boolean;
  } = {},
): string {
  const accuracy = monster.accuracy as Json | undefined;
  const damage = monster.damage as Json | undefined;
  const style = Array.isArray(monster.combatStyleHrids)
    ? monster.combatStyleHrids.map((hrid) => String(hrid).split("/").at(-1)).join("/")
    : "";
  const attack = Object.entries(accuracy ?? {})
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => `${key}精准 ${String(value)}`)
    .join("、");
  const maxDamage = Object.entries(damage ?? {})
    .filter(([key, value]) => key !== "defensive" && typeof value === "number" && Number(value) > 10)
    .map(([key, value]) => `${key}伤害 ${String(value)}`)
    .join("、");
  const cap = options.showParticipantCap ? (options.participantCap ?? "") : "";
  const label = formatGuildBossMonsterLabel(trialName, monster, {
    multiMonsterTrial: options.multiMonsterTrial,
  });
  return [
    `${label} Lv.${String(monster.level ?? 100)}${style ? `（${style}）` : ""}${cap}`,
    `HP/MP ${String(monster.maxHp ?? "?")}/${String(monster.maxMp ?? "?")}`,
    formatGuildBossDefenseLine(monster),
    [attack, maxDamage].filter(Boolean).join("；"),
  ].filter(Boolean).join("；");
}

export class GuildApiCommandService implements CommandServicePort {
  readonly #config: GuildApiClientConfig;
  readonly #combatTestPaths: CombatTestRunPaths;

  constructor(config: GuildApiClientConfig) {
    const simulatorRoot = path.resolve(
      config.simulatorRoot ?? defaultSimulatorRoot(process.cwd()),
    );
    const guildPaths = resolveGuildReportPaths(config.guildId, simulatorRoot);
    this.#config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, ""),
      pluginId: config.pluginId ?? "guild-trial-member-exporter",
      testReportDirectory:
        config.testReportDirectory ??
        process.env.MWI_TEST_REPORT_DIR ??
        guildPaths.testReportArtifactsDir,
      memberPluginPath:
        config.memberPluginPath ??
        process.env.MWI_MEMBER_PLUGIN_PATH,
    };
    this.#combatTestPaths = resolveCombatTestPaths(simulatorRoot, {
      statePath: config.combatTestStatePath,
      logPath: config.combatTestLogPath,
      apiSlug: config.guildId,
    });
  }

  watchCombatTestRun(
    onNotify: (state: CombatTestRunState) => Promise<void> | void,
  ): () => void {
    return startCombatTestRunPoller({
      statePath: this.#combatTestPaths.statePath,
      onNotify,
    });
  }

  async #request(path: string, init: RequestInit = {}): Promise<Json> {
    const response = await fetch(`${this.#config.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-admin-key": this.#config.adminKey,
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => ({})) as Json & ApiFailure;
    if (!response.ok) {
      const error = new Error(payload.error?.message ?? `Guild API HTTP ${response.status}`);
      Object.assign(error, { status: response.status, code: payload.error?.code });
      throw error;
    }
    return payload;
  }

  #path(suffix: string): string {
    return `/api/guilds/${encodeURIComponent(this.#config.guildId)}${suffix}`;
  }

  async #safe<T>(operation: () => Promise<T>): Promise<ServiceResult<T>> {
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      const row = error as { status?: number; code?: string; message?: string };
      return {
        ok: false,
        code: row.status === 404 ? "not-found" : row.status === 409 ? "conflict" : "unavailable",
        message: row.message ?? "中央 API 请求失败。",
      };
    }
  }

  #missing(message: string): Promise<ServiceResult<ServiceContent>> {
    return Promise.resolve({ ok: false, code: "unavailable", message });
  }

  async #assignment(kind: "formal" | "test"): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const data = await this.#request(this.#path(`/assignments/${kind}`));
      const assignment = data.assignment as Json | undefined;
      const summaryText = typeof assignment?.summaryText === "string"
        ? assignment.summaryText
        : JSON.stringify(data.assignment, null, 2);
      return {
        text: `${kind === "formal" ? "本周正式分工" : "本周战斗分工"}（#${String(data.id)}，${formatBeijingTimestamp(data.createdAt)}）\n${summaryText}`,
      };
    });
  }

  getLockedOfficialAssignment(): Promise<ServiceResult<ServiceContent>> {
    return this.#assignment("formal");
  }

  async getGuildBottleneck(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const memberData = await this.#request(this.#path("/members"));
      const members = Array.isArray(memberData.members) ? memberData.members as Json[] : [];
      return { text: formatGuildBottleneck(members) };
    });
  }

  getProfessionDistribution(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const [memberData, bindingData] = await Promise.all([
        this.#request(this.#path("/members")),
        this.#request(this.#path("/qq-bindings")),
      ]);
      const members = Array.isArray(memberData.members)
        ? memberData.members as Json[]
        : [];
      const bindings = Array.isArray(bindingData.bindings)
        ? bindingData.bindings as Json[]
        : [];
      return {
        text: formatProfessionDistribution(
          members,
          bindings,
          this.#config.guildId,
        ),
      };
    });
  }

  async getGuildRoster(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const [memberData, bindingData] = await Promise.all([
        this.#request(this.#path("/members")),
        this.#request(this.#path("/qq-bindings")),
      ]);
      const members = Array.isArray(memberData.members) ? memberData.members as Json[] : [];
      const bindings = Array.isArray(bindingData.bindings) ? bindingData.bindings as Json[] : [];
      const bindingByMember = new Map(bindings.map((binding) => [
        String(binding.memberId),
        String(binding.combatType),
      ]));
      const uploadedCount = members.filter((member) => Boolean(member.latestSnapshot)).length;
      const boundCount = members.filter((member) => bindingByMember.has(String(member.memberId))).length;
      const lines = members.map((member, index) => {
        const memberId = String(member.displayName ?? member.memberId);
        const upload = member.latestSnapshot ? "已上传" : "未上传";
        const combatType = bindingByMember.get(String(member.memberId));
        return `${index + 1}. ${memberId}｜${upload}｜${combatType ? `职业 ${combatType}` : "未绑定职业"}`;
      });
      return {
        text: [
          `${guildMessageLabel(this.#config.guildId)} 当前公会名单（${members.length} 人）`,
          `已上传 ${uploadedCount}｜已绑定 ${boundCount}`,
          ...(lines.length ? lines : ["当前名单为空。"]),
        ].join("\n"),
      };
    });
  }

  async getUnregisteredTrialMembers(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const [memberData, lifeFormal, lifeTest, combatData, weeklyData] =
        await Promise.all([
          this.#request(this.#path("/members")),
          this.#request(this.#path("/life-assignments/formal")).catch(
            (error: unknown) => {
              if ((error as { status?: number }).status === 404) return null;
              throw error;
            },
          ),
          this.#request(this.#path("/life-assignments/test")).catch(
            (error: unknown) => {
              if ((error as { status?: number }).status === 404) return null;
              throw error;
            },
          ),
          this.#request(this.#path("/assignments/test")).catch(
            (error: unknown) => {
              if ((error as { status?: number }).status === 404) return null;
              throw error;
            },
          ),
          this.#request(this.#path("/weekly-trials/current")).catch(
            (error: unknown) => {
              if ((error as { status?: number }).status === 404) return null;
              throw error;
            },
          ),
        ]);

      const members = Array.isArray(memberData.members)
        ? memberData.members as Json[]
        : [];
      const expectedWeekStartAt = typeof weeklyData?.weekStartAt === "string"
        ? weeklyData.weekStartAt
        : typeof lifeTest?.weekStartAt === "string"
          ? lifeTest.weekStartAt
          : typeof lifeFormal?.weekStartAt === "string"
            ? lifeFormal.weekStartAt
            : undefined;
      const life = pickLifeAssignmentForWeek({
        expectedWeekStartAt,
        formal: lifeFormal,
        test: lifeTest,
      });

      return {
        text: formatUnassignedAssignmentMembers({
          rosterMembers: members,
          lifeAssignment: life.assignment,
          combatAssignment: (combatData?.assignment as Json | undefined) ?? null,
          lifeWeekStartAt: life.weekStartAt,
          combatGeneratedAt: typeof (combatData?.assignment as Json | undefined)?.generatedAt ===
              "string"
            ? String((combatData?.assignment as Json).generatedAt)
            : undefined,
          lifeSource: life.source,
          expectedWeekStartAt,
        }),
      };
    });
  }

  async getSignupAssignmentMismatches(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const ignoreMissing = (error: unknown) => {
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      };
      const [lifeFormal, lifeTest, combatData, registrationData, weeklyData] =
        await Promise.all([
          this.#request(this.#path("/life-assignments/formal")).catch(ignoreMissing),
          this.#request(this.#path("/life-assignments/test")).catch(ignoreMissing),
          this.#request(this.#path("/assignments/test")).catch(ignoreMissing),
          this.#request(this.#path("/trial-registrations/current")).catch(ignoreMissing),
          this.#request(this.#path("/weekly-trials/current")).catch(ignoreMissing),
        ]);

      const trials = Array.isArray(registrationData?.trials)
        ? registrationData.trials as Json[]
        : [];
      const weeklyTrials = Array.isArray(weeklyData?.trials)
        ? weeklyData.trials as Json[]
        : [];
      const activeTrialHrids = weeklyTrials
        .map((trial) => String(trial.trialHrid ?? "").trim())
        .filter(Boolean);
      const catalogWeekStartAt = typeof weeklyData?.weekStartAt === "string"
        ? weeklyData.weekStartAt
        : undefined;
      const publishedGeneratedAt = await this.#readLifeReportGeneratedAt();
      const life = pickLifeAssignmentForWeek({
        expectedWeekStartAt: catalogWeekStartAt,
        preferGeneratedAt: publishedGeneratedAt,
        formal: lifeFormal,
        test: lifeTest,
      });
      const weekStartAt = catalogWeekStartAt ?? life.weekStartAt;
      const activeTrials = filterActiveRegistrationTrials(trials, {
        weekStartAt,
        activeTrialHrids,
      });
      const capturedAts = activeTrials
        .map((trial) => String(trial.capturedAt ?? "").trim())
        .filter(Boolean)
        .sort();
      const registrationCapturedAt = capturedAts.at(-1);
      const lifeGeneratedAt = typeof life.assignment?.generatedAt === "string"
        ? life.assignment.generatedAt
        : undefined;

      return {
        text: formatSignupAssignmentMismatches({
          registrationTrials: activeTrials,
          lifeAssignment: life.assignment,
          combatAssignment: (combatData?.assignment as Json | undefined) ?? null,
          weekStartAt,
          activeTrialHrids,
          lifeWeekStartAt: life.weekStartAt,
          lifeGeneratedAt,
          lifeSource: life.source,
          combatGeneratedAt: typeof (combatData?.assignment as Json | undefined)
              ?.generatedAt === "string"
            ? String((combatData?.assignment as Json).generatedAt)
            : undefined,
          registrationCapturedAt,
        }),
      };
    });
  }

  async getAuraAssignment(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      let registrationData: Json;
      try {
        registrationData = await this.#request(
          this.#path("/trial-registrations/current"),
        );
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          return {
            text:
              "还没有本周战斗试炼报名数据。请让 adudu 更新插件并打开“公会 → 试炼”，等待自动同步完成后再发送“光环分配”。",
          };
        }
        throw error;
      }
      const memberData = await this.#request(this.#path("/members"));
      const trials = combatRegistrationTrials(
        Array.isArray(registrationData.trials)
          ? registrationData.trials as Json[]
          : [],
      );
      const members = Array.isArray(memberData.members)
        ? memberData.members as Json[]
        : [];
      return { text: formatAuraAssignments(trials, members) };
    });
  }

  async getGuildBosses(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      try {
        const current = await this.#request(this.#path("/weekly-trials/current"));
        const trials = Array.isArray(current.trials) ? current.trials as Json[] : [];
        const skilling = trials.filter((trial) => trial.kind === "skilling");
        const combat = trials.filter((trial) => trial.kind === "combat");
        if (!combat.length || combat.some((trial) =>
          !Array.isArray(trial.monsters) || trial.monsters.length === 0
        )) {
          throw Object.assign(new Error("weekly monster panels are incomplete"), { status: 404 });
        }
        const skillLine = skilling.map((trial) => {
          const cap = trial.maxParticipants != null ? `/${trial.maxParticipants}` : "";
          const signed = trial.signedUpCount != null ? ` ${trial.signedUpCount}${cap}` : "";
          return `${String(trial.trialName ?? trial.trialHrid)}${signed}`;
        }).join("、");
        const combatLines = combat.flatMap((trial) => {
          const trialName = String(trial.trialName ?? trial.trialHrid);
          const cap = trial.maxParticipants != null ? ` 上限${trial.maxParticipants}` : "";
          const monsters = Array.isArray(trial.monsters) ? trial.monsters as Json[] : [];
          if (!monsters.length) return [`${trialName}：怪物基础面板尚未随登录数据到达`];
          const multiMonsterTrial = monsters.length > 1;
          return monsters.map((monster, index) =>
            formatGuildBossMonsterPanelLine(trialName, monster, {
              multiMonsterTrial,
              participantCap: cap,
              showParticipantCap: index === 0,
            }),
          );
        });
        return {
          text: [
            `本周公会试炼（${String(current.weekStartAt ?? "未知周")}）`,
            `生活：${skillLine || "尚未同步"}`,
            "战斗：",
            ...(combatLines.length ? combatLines : ["尚未同步"]),
          ].join("\n"),
        };
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
      const fixture = await this.#request("/api/boss-fixture/current");
      const bosses = Array.isArray(fixture.bosses) ? fixture.bosses as Json[] : [];
      const lines = bosses.map((boss) => {
        return [
          `${String(boss.nameZh)} Lv.${String(boss.level)}`,
          `HP/MP ${String(boss.maxHp)}/${String(boss.maxMp)}`,
          formatGuildBossDefenseLine(boss),
        ].join("；");
      });
      return { text: `公会试炼 Boss（静态备用数据）\n${lines.join("\n")}` };
    });
  }

  getProfessionRating(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const dataset = loadProfessionRatingDataset();
      try {
        const images = [];
        for (const level of dataset.levels) {
          const base64 = await renderProfessionRatingPngBase64(level, {
            apiSlug: this.#config.guildId,
          });
          images.push({
            base64,
            alt: `职业评级 Lv.${level.startLevel}`,
          });
        }
        return {
          text: formatProfessionRatingSummary(dataset),
          images,
        };
      } catch (error) {
        console.error(
          "[profession-rating] image render failed, falling back to text:",
          (error as Error).message ?? error,
        );
        return { text: formatProfessionRatingText(dataset) };
      }
    });
  }

  async getPluginInstallInfo(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const data = await this.#request("/api/plugin-versions");
      const plugins = Array.isArray(data.plugins) ? data.plugins as Json[] : [];
      const selected = plugins.find((plugin) => plugin.pluginId === this.#config.pluginId);
      if (!selected) throw Object.assign(new Error("尚未登记公会插件安装地址。"), { status: 404 });
      return {
        text: [
          `公会插件 v${String(selected.version)}`,
          ...publicGuildPluginInstallLinks(this.#config.guildId).map(
            ([label, url]) => `${label}：${url}`,
          ),
          selected.notes ? String(selected.notes) : "",
        ].filter(Boolean).join("\n"),
      };
    });
  }

  async getLatestPluginArtifact(): Promise<ServiceResult<PluginArtifact>> {
    return this.#safe(async () => {
      const data = await this.#request("/api/plugin-versions");
      const plugins = Array.isArray(data.plugins) ? data.plugins as Json[] : [];
      const selected = plugins.find((plugin) => plugin.pluginId === this.#config.pluginId);
      if (!selected) throw Object.assign(new Error("尚未登记公会插件安装地址。"), { status: 404 });
      const version = String(selected.version);
      const registeredInstallUrl = String(selected.installUrl);
      const installUrl = publicGuildPluginInstallLinks(this.#config.guildId)
        .find(([label]) => label === "油叉（Greasy Fork）")?.[1]
        ?? registeredInstallUrl;
      const fileName = `MWI公会试炼资料同步助手-v${version}.user.js`;
      const memberPluginPath = this.#config.memberPluginPath?.trim();
      if (memberPluginPath) {
        await access(memberPluginPath);
        return {
          version,
          installUrl,
          fileName,
          file: memberPluginPath,
        };
      }
      // The API direct artifact is a legacy fallback and may lag behind the
      // plugin version metadata. Use the guild's public Gitee raw artifact
      // for the actual file transfer; the Greasy Fork URL above is a web page.
      const fileUrl = publicGuildPluginInstallLinks(this.#config.guildId)
        .find(([label]) => label === "Gitee")?.[1]
        ?? registeredInstallUrl;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw Object.assign(new Error("无法读取最新插件文件。"), { status: 502 });
      }
      return {
        version,
        installUrl,
        fileName,
        file: fileUrl,
      };
    });
  }

  async getLifeTrials(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const current = await this.#request(this.#path("/weekly-trials/current"));
      const staleCapacityTrials = Array.isArray(current.staleCapacityTrials)
        ? current.staleCapacityTrials as string[]
        : [];
      return {
        text: formatLifeTrialsOverview(current, staleCapacityTrials),
      };
    });
  }

  async generateLifeAssignment(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      // Always rebuild from the latest member snapshots, then render + publish.
      const run = await this.#buildAndSaveLifeAssignment("formal");
      return this.#presentLifeAssignment(run);
    });
  }

  getLatestLifeAssignment(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const data = await this.#request(this.#path("/life-assignments/formal")).catch(
        (error: unknown) => {
          const row = error as { status?: number };
          if (row.status === 404) {
            throw Object.assign(
              new Error("还没有本周生活分工推荐。请管理员发送「生活模拟」生成。"),
              { status: 404 },
            );
          }
          throw error;
        },
      );
      const run = data.assignment as LifeAssignmentRun | undefined;
      if (!run?.generatedAt || !Array.isArray(run.trials)) {
        throw Object.assign(
          new Error("本周生活分工数据不完整。请管理员发送「生活模拟」重新生成。"),
          { status: 409 },
        );
      }

      const png = await this.#readLifeAssignmentPng(run.generatedAt).catch(
        async () => {
          const rendered = await renderLifeAssignmentReportPng(run);
          await this.#writeLifeAssignmentArtifacts(run, rendered);
          return rendered;
        },
      );

      return {
        text: formatLifeAssignmentReportSummary(run),
        images: [{ base64: png.toString("base64"), alt: "本周生活分工" }],
      };
    });
  }

  async simulateLifeTrial(input: {
    trialToken: string;
    memberIds: string[];
  }): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const [catalog, membersData, assignmentData] = await Promise.all([
        this.#request(this.#path("/weekly-trials/current")),
        this.#request(this.#path("/members")),
        this.#request(this.#path("/life-assignments/formal")).catch(() => ({ assignment: null })),
      ]);
      const trials = weeklySkillingTrialsFromCatalog(catalog);
      const trial = resolveLifeTrialByToken(trials, input.trialToken);
      if (!trial) {
        throw Object.assign(new Error(`未找到生活试炼“${input.trialToken}”。`), { status: 404 });
      }
      const members = Array.isArray(membersData.members)
        ? membersData.members as Json[]
        : [];
      const snapshotsByMemberId = Object.fromEntries(
        members
          .filter((member) => member.latestSnapshot)
          .map((member) => [String(member.memberId), member.latestSnapshot as Json]),
      );
      let roster = input.memberIds;
      if (!roster.length) {
        const assignment = assignmentData.assignment as Json | undefined;
        const trialAssignment = Array.isArray(assignment?.trials)
          ? (assignment.trials as Json[]).find((row) => row.trialHrid === trial.trialHrid)
          : null;
        roster = Array.isArray(trialAssignment?.roster)
          ? trialAssignment.roster.map((name) => String(name))
          : [];
        if (!roster.length) {
          throw Object.assign(new Error("还没有该场生活试炼推荐名单。请先发送「本周生活分工」。"), { status: 404 });
        }
      }
      return {
        text: simulateLifeTrialForRoster({
          trial,
          memberIds: roster,
          snapshotsByMemberId,
        }),
      };
    });
  }

  async startTestLifeAssignment(input: {
    requestedBy: string;
    excludedCharacterNames: string[];
  }): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const excluded = new Set(
        input.excludedCharacterNames.map((name) => name.toLocaleLowerCase()),
      );
      const [catalog, membersData] = await Promise.all([
        this.#request(this.#path("/weekly-trials/current")),
        this.#request(this.#path("/members")),
      ]);
      const trials = weeklySkillingTrialsFromCatalog(catalog);
      if (trials.length !== 4) {
        throw Object.assign(new Error("本周生活试炼或人数上限尚未同步完整。"), { status: 404 });
      }
      const members = (Array.isArray(membersData.members) ? membersData.members as Json[] : [])
        .map((member) => ({
          memberId: String(member.memberId),
          displayName: String(member.displayName ?? member.memberId),
          latestSnapshot: member.latestSnapshot as Json | undefined,
        }))
        .filter((member) => !excluded.has(member.memberId.toLocaleLowerCase()));
      const run = generateLifeAssignmentRun({
        weekStartAt: String(catalog.weekStartAt ?? new Date().toISOString()),
        trials,
        members,
      });
      await this.#request(`/api/admin/guilds/${encodeURIComponent(this.#config.guildId)}/life-assignments/test`, {
        method: "PUT",
        body: JSON.stringify({ assignment: run }),
      });
      const presented = await this.#presentLifeAssignment(run, {
        textPrefix: "测试生活分工已保存。\n\n",
        publish: false,
      });
      return presented;
    });
  }

  async #buildAndSaveLifeAssignment(kind: "formal" | "test") {
    const [catalog, membersData] = await Promise.all([
      this.#request(this.#path("/weekly-trials/current")),
      this.#request(this.#path("/members")),
    ]);
    const trials = weeklySkillingTrialsFromCatalog(catalog);
    if (trials.length !== 4) {
      throw Object.assign(new Error("本周生活试炼或人数上限尚未同步完整。"), { status: 404 });
    }
    const members = (Array.isArray(membersData.members) ? membersData.members as Json[] : [])
      .map((member) => ({
        memberId: String(member.memberId),
        displayName: String(member.displayName ?? member.memberId),
        latestSnapshot: member.latestSnapshot as Json | undefined,
      }));
    const overrides = resolveLifeAssignmentEnvOverrides(this.#config.guildId, trials);
    const run = generateLifeAssignmentRun({
      weekStartAt: String(catalog.weekStartAt ?? new Date().toISOString()),
      trials,
      members,
      ...overrides,
    });
    await this.#request(`/api/admin/guilds/${encodeURIComponent(this.#config.guildId)}/life-assignments/${kind}`, {
      method: "PUT",
      body: JSON.stringify({ assignment: run }),
    });
    return run;
  }

  async #presentLifeAssignment(
    run: Parameters<typeof formatLifeAssignmentRun>[0],
    options: { textPrefix?: string; publish?: boolean } = {},
  ): Promise<ServiceContent> {
    const shouldPublish = options.publish !== false &&
      process.env.MWI_LIFE_REPORT_PUBLISH !== "0";
    const reportDirectory = resolveLifeReportDirectory(this.#config.guildId);
    let images: Array<{ base64: string; alt?: string }> | undefined;
    let publicUrl = resolveGuildReportPaths(this.#config.guildId).lifePublicPngUrl;
    let publishNote = "";

    try {
      const png = await renderLifeAssignmentReportPng(run);
      mkdirSync(reportDirectory, { recursive: true });
      const artifacts = writeLifeAssignmentReportArtifacts(
        run,
        png,
        reportDirectory,
        { apiSlug: this.#config.guildId },
      );
      images = [{ base64: png.toString("base64"), alt: "本周生活分工" }];

      if (shouldPublish) {
        try {
          const published = publishLifeAssignmentReportToGithub({
            run,
            pngPath: artifacts.pngPath,
            jsonPath: artifacts.jsonPath,
            apiSlug: this.#config.guildId,
          });
          publicUrl = published.publicPngUrl;
          if (published.published) {
            publishNote = "已推送到 GitHub 公网。";
          } else if (published.skipped) {
            publishNote = "公网图片已是最新。";
          }
        } catch (error) {
          console.error(
            "[life-assignment] github publish failed:",
            (error as Error).message ?? error,
          );
          publishNote =
            "图片已生成；GitHub 公网推送失败，请稍后由脚本补推。";
        }
      }
    } catch (error) {
      console.error(
        "[life-assignment] render failed, falling back to text:",
        (error as Error).message ?? error,
      );
      return {
        text:
          `${options.textPrefix ?? ""}${formatLifeAssignmentRun(run)}\n\n` +
          `（结果图渲染失败：${(error as Error).message ?? "unknown"}）`,
      };
    }

    const summary = formatLifeAssignmentReportSummary(run, {
      publicUrl,
      apiSlug: this.#config.guildId,
    });
    const text = `${options.textPrefix ?? ""}${summary}${
      publishNote ? `\n${publishNote}` : ""
    }`;
    return { text, images };
  }

  getGuildProfessionReport(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const memberData = await this.#request(this.#path("/members"));
      const members = Array.isArray(memberData.members) ? memberData.members as Json[] : [];
      const report = buildGuildProfessionReport(members);
      if (!report) {
        return { text: formatGuildProfessionReport(members) };
      }
      try {
        const base64 = await renderGuildProfessionReportPngBase64(report, {
          apiSlug: this.#config.guildId,
        });
        return {
          text: formatGuildProfessionReportSummary(report),
          images: [{ base64, alt: "公会专业技能 Top 20" }],
        };
      } catch (error) {
        console.error(
          "[guild-report] image render failed, falling back to text:",
          (error as Error).message ?? error,
        );
        return { text: formatGuildProfessionReport(members) };
      }
    });
  }

  getAssignmentProgress(): Promise<ServiceResult<ServiceContent>> {
    const state = reconcileCombatTestRunState(this.#combatTestPaths.statePath);
    return Promise.resolve({
      ok: true,
      value: { text: formatCombatTestRunProgress(state) },
    });
  }

  async getOptimizationAudit(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const [memberData, bindingData] = await Promise.all([
        this.#request(this.#path("/members")),
        this.#request(this.#path("/qq-bindings")),
      ]);
      const members = Array.isArray(memberData.members) ? memberData.members as Json[] : [];
      const bindings = Array.isArray(bindingData.bindings) ? bindingData.bindings as Json[] : [];
      return { text: formatOptimizationAudit(members, bindings) };
    });
  }

  async getUnavailableRoster(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const [memberData, bindingData] = await Promise.all([
        this.#request(this.#path("/members")),
        this.#request(this.#path("/qq-bindings")),
      ]);
      const members = Array.isArray(memberData.members) ? memberData.members as Json[] : [];
      const bindings = Array.isArray(bindingData.bindings) ? bindingData.bindings as Json[] : [];
      const prunedMemberIds = await this.#pruneStaleBindings(members, bindings);
      const activeBindings = filterBindingsToActiveRoster(members, bindings);
      return {
        text: formatUnavailableRoster(members, activeBindings, {
          prunedMemberIds,
          guildId: this.#config.guildId,
        }),
      };
    });
  }

  async getEquipmentCheck(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const [memberData, bindingData] = await Promise.all([
        this.#request(this.#path("/members")),
        this.#request(this.#path("/qq-bindings")),
      ]);
      const members = Array.isArray(memberData.members) ? memberData.members as Json[] : [];
      const bindings = Array.isArray(bindingData.bindings) ? bindingData.bindings as Json[] : [];
      await this.#pruneStaleBindings(members, bindings);
      const activeBindings = filterBindingsToActiveRoster(members, bindings);
      return { text: formatWeaponEnhancementCheck(members, activeBindings) };
    });
  }

  async getMissingUploads(groupMemberNames?: string[]): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const [memberData, bindingData] = await Promise.all([
        this.#request(this.#path("/members")),
        this.#request(this.#path("/qq-bindings")),
      ]);
      const members = Array.isArray(memberData.members) ? memberData.members as Json[] : [];
      const bindings = Array.isArray(bindingData.bindings) ? bindingData.bindings as Json[] : [];
      await this.#pruneStaleBindings(members, bindings);
      return { text: formatMissingUploads(members, groupMemberNames) };
    });
  }

  async getExpiredUploads(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const memberData = await this.#request(this.#path("/members"));
      const members = Array.isArray(memberData.members) ? memberData.members as Json[] : [];
      return { text: formatExpiredUploads(members) };
    });
  }

  getLatestCombatAssignment(): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const data = await this.#request(this.#path("/assignments/test"));
      const assignment = data.assignment as Json | undefined;
      if (typeof assignment?.generatedAt !== "string") {
        throw Object.assign(
          new Error("最近战斗分工缺少 generatedAt，无法匹配结果图。"),
          { status: 409 },
        );
      }

      const summaryText = typeof assignment.summaryText === "string"
        ? assignment.summaryText
        : JSON.stringify(assignment, null, 2);

      let images:
        | Array<{ base64: string; alt?: string }>
        | undefined;
      let files: Array<{ title: string; fileName: string }> = [];

      const fromDirectory = await this.#readTestAssetsFromDirectory(
        assignment.generatedAt,
      ).catch((error: unknown) => {
        if (isMissingOrStaleTestReportError(error)) {
          return null;
        }
        throw error;
      });
      if (fromDirectory) {
        images = fromDirectory.images;
        files = fromDirectory.files;
      } else {
        try {
          const fromApi = await this.#readTestAssetsFromApi(assignment.generatedAt);
          images = fromApi.images;
          files = fromApi.files;
        } catch (error) {
          const row = error as { status?: number };
          if (isAbsentTestReportFileError(error) || row.status === 404) {
            throw Object.assign(
              new Error(
                missingTestReportAssetsMessage(this.#config.testReportDirectory),
              ),
              { status: 404 },
            );
          }
          throw error;
        }
      }

      const lifeImage = await this.#readLifeAssignmentImage().catch(() => null);
      if (lifeImage) {
        images = [lifeImage, ...(images ?? [])];
      }

      const guildPaths = resolveGuildReportPaths(this.#config.guildId);
      return {
        text: formatCombatAssignmentReportSummary({
          assignmentId: data.id as string | number | undefined,
          createdAtLabel: formatBeijingTimestamp(data.createdAt),
          summaryText,
          files,
          publicIndexUrl: guildPaths.combatPublicIndexUrl,
          includeLifeLink: true,
          apiSlug: this.#config.guildId,
        }),
        images,
      };
    });
  }

  async #readLifeAssignmentImage(): Promise<{ base64: string; alt: string } | null> {
    const png = await this.#readLifeAssignmentPng().catch(() => null);
    if (!png) return null;
    return {
      base64: png.toString("base64"),
      alt: LIFE_ASSIGNMENT_GALLERY_LABEL,
    };
  }

  async #readLifeReportGeneratedAt(): Promise<string | undefined> {
    try {
      const manifestPath = path.join(
        resolveLifeReportDirectory(this.#config.guildId),
        "manifest.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        generatedAt?: string;
      };
      return typeof manifest.generatedAt === "string" && manifest.generatedAt.trim()
        ? manifest.generatedAt
        : undefined;
    } catch {
      return undefined;
    }
  }

  async #writeLifeAssignmentArtifacts(
    run: LifeAssignmentRun,
    png: Buffer,
  ): Promise<void> {
    const reportDirectory = resolveLifeReportDirectory(this.#config.guildId);
    mkdirSync(reportDirectory, { recursive: true });
    writeLifeAssignmentReportArtifacts(run, png, reportDirectory, {
      apiSlug: this.#config.guildId,
    });
  }

  async #readLifeAssignmentPng(expectedGeneratedAt?: string): Promise<Buffer> {
    const reportDirectory = resolveLifeReportDirectory(this.#config.guildId);
    const pngPath = path.join(reportDirectory, "latest.png");
    const manifestPath = path.join(reportDirectory, "manifest.json");
    if (expectedGeneratedAt) {
      try {
        const manifest = JSON.parse(
          await readFile(manifestPath, "utf8"),
        ) as { generatedAt?: string };
        if (manifest.generatedAt !== expectedGeneratedAt) {
          throw Object.assign(new Error("life report png is stale"), { status: 409 });
        }
      } catch (error) {
        const row = error as { status?: number };
        if (row.status === 409) throw error;
        throw Object.assign(new Error("life report manifest missing"), { status: 404 });
      }
    }
    await access(pngPath);
    return readFile(pngPath);
  }

  async #readTestAssetsFromDirectory(
    assignmentGeneratedAt: string,
  ): Promise<{
    images: Array<{ base64: string; alt?: string }>;
    files: Array<{ title: string; fileName: string }>;
  }> {
    const reportDirectory = this.#config.testReportDirectory;
    if (!reportDirectory) {
      throw Object.assign(
        new Error("机器人尚未配置测试结果图片目录。"),
        { status: 404 },
      );
    }
    const manifestPath = path.join(reportDirectory, "manifest.json");
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as {
      assignmentGeneratedAt?: string;
      files?: Array<{ title?: string; fileName?: string }>;
    };
    if (manifest.assignmentGeneratedAt !== assignmentGeneratedAt) {
      throw Object.assign(
        new Error("现有图片与最近战斗分工不一致，请先重新生成结果图。"),
        { status: 409 },
      );
    }
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (
      files.length !== 4 ||
      files.some(
        (entry) =>
          !entry.fileName ||
          path.basename(entry.fileName) !== entry.fileName ||
          !isAllowedTestReportFileName(entry.fileName),
      )
    ) {
      throw Object.assign(
        new Error("战斗结果图片清单不完整。"),
        { status: 404 },
      );
    }
    const images = [];
    const normalizedFiles: Array<{ title: string; fileName: string }> = [];
    for (const entry of files) {
      const imagePath = path.join(reportDirectory, entry.fileName!);
      await access(imagePath);
      images.push({
        base64: await readFile(imagePath, "base64"),
        alt: entry.title ?? entry.fileName,
      });
      normalizedFiles.push({
        title: entry.title ?? entry.fileName!,
        fileName: entry.fileName!,
      });
    }
    return { images, files: normalizedFiles };
  }

  async #readTestAssetsFromApi(
    assignmentGeneratedAt: string,
  ): Promise<{
    images: Array<{ base64: string; alt?: string }>;
    files: Array<{ title: string; fileName: string }>;
  }> {
    const payload = await this.#request(this.#path("/test-report-assets"));
    if (payload.assignmentGeneratedAt !== assignmentGeneratedAt) {
      throw Object.assign(
        new Error("现有图片与最近战斗分工不一致，请先重新生成结果图。"),
        { status: 409 },
      );
    }
    const files = Array.isArray(payload.files) ? payload.files as Array<{
      fileName?: string;
      title?: string;
      base64?: string;
    }> : [];
    if (
      files.length !== 4 ||
      files.some(
        (entry) =>
          !entry.fileName ||
          !entry.base64 ||
          path.basename(entry.fileName) !== entry.fileName ||
          !isAllowedTestReportFileName(entry.fileName),
      )
    ) {
      throw Object.assign(
        new Error("战斗结果图片清单不完整。"),
        { status: 404 },
      );
    }
    return {
      images: files.map((entry) => ({
        base64: entry.base64!,
        alt: entry.title ?? entry.fileName,
      })),
      files: files.map((entry) => ({
        title: entry.title ?? entry.fileName!,
        fileName: entry.fileName!,
      })),
    };
  }

  getSkillRecommendation(): Promise<ServiceResult<ServiceContent>> {
    return this.#missing("技能图需要完整战斗模拟结果；当前生产模拟引擎尚未达到可用标准。");
  }

  async getProductionSimulationAvailability(): Promise<SimulationAvailability> {
    try {
      const health = await this.#request("/health");
      return health.simulationEngine === "available"
        ? { available: true }
        : { available: false, reason: "完整技能、触发器和公会试炼规则尚未完成校准" };
    } catch {
      return { available: false, reason: "中央 API 不可达" };
    }
  }

  getTestSimulationAvailability(): Promise<SimulationAvailability> {
    const availability = combatTestPipelineAvailability(this.#combatTestPaths);
    return Promise.resolve(
      availability.available
        ? { available: true }
        : { available: false, reason: availability.reason },
    );
  }

  startOfficialAssignment(): Promise<ServiceResult<ServiceContent>> {
    return this.#missing("生产模拟引擎尚未接入。");
  }

  startTestAssignment(input: {
    requestedBy: string;
    excludedCharacterNames: string[];
    chatKind: "private" | "group";
    groupId?: string;
  }): Promise<ServiceResult<ServiceContent>> {
    const started = startCombatTestRun({
      paths: this.#combatTestPaths,
      requestedBy: input.requestedBy,
      excludedCharacterNames: input.excludedCharacterNames,
      notify: {
        chatKind: input.chatKind,
        userId: input.requestedBy,
        groupId: input.groupId,
      },
      env: {
        MWI_GUILD_API_ADMIN_KEY: this.#config.adminKey,
        MWI_GUILD_API_BASE: this.#config.baseUrl,
        MWI_GUILD_ID: this.#config.guildId,
        ...(this.#config.testReportDirectory
          ? {
              MWI_TEST_REPORT_DIR: this.#config.testReportDirectory,
              MWI_RUNTIME_TEST_REPORT_DIR: this.#config.testReportDirectory,
            }
          : {}),
      },
    });
    if (!started.ok) {
      return Promise.resolve({
        ok: false,
        code: started.code,
        message: started.message,
      });
    }
    return Promise.resolve({
      ok: true,
      value: { text: formatCombatTestRunStarted(started.state) },
    });
  }

  stopActiveAssignment(): Promise<ServiceResult<ServiceContent>> {
    const stopped = stopCombatTestRun(this.#combatTestPaths.statePath);
    if (!stopped.ok) {
      return Promise.resolve({
        ok: false,
        code: stopped.code,
        message: stopped.message,
      });
    }
    return Promise.resolve({ ok: true, value: { text: stopped.message } });
  }

  simulateLockedOfficialAssignment(): Promise<ServiceResult<ServiceContent>> {
    return this.#missing("生产模拟引擎尚未接入。");
  }

  async promoteLatestTestWithoutSimulation(input: { requestedBy: string }): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      const test = await this.#request(this.#path("/assignments/test"));
      const created = await this.#request(`/api/admin/guilds/${encodeURIComponent(this.#config.guildId)}/assignments/formal`, {
        method: "PUT",
        body: JSON.stringify({ assignment: test.assignment, locked: true }),
      });
      return { text: `测试方案已原样转正并锁定为正式分工（#${String(created.id)}），未重新模拟。` };
    });
  }

  async isCurrentGuildMember(characterName: string): Promise<ServiceResult<{ current: boolean; canonicalName: string }>> {
    return this.#safe(async () => {
      const data = await this.#request(this.#path("/members"));
      const members = Array.isArray(data.members) ? data.members as Json[] : [];
      const member = members.find((row) =>
        String(row.memberId).toLocaleLowerCase() === characterName.toLocaleLowerCase() ||
        String(row.displayName).toLocaleLowerCase() === characterName.toLocaleLowerCase()
      );
      return { current: Boolean(member), canonicalName: member ? String(member.memberId) : characterName };
    });
  }

  async getCombatBindingsForUser(qqUserId: string): Promise<ServiceResult<CombatBinding[]>> {
    return this.#safe(async () => {
      const data = await this.#request(`${this.#path("/qq-bindings")}?qqNumber=${encodeURIComponent(qqUserId)}`);
      const rows = Array.isArray(data.bindings) ? data.bindings as Json[] : [];
      return rows.map((row) => ({
        characterName: String(row.memberId),
        qqUserId: String(row.qqNumber),
        combatType: String(row.combatType) as CombatType,
      }));
    });
  }

  bindCombat(input: { requestedBy: string; characterName: string; qqUserId: string; combatType: CombatType }): Promise<ServiceResult<ServiceContent>> {
    return this.#putBinding(input.characterName, input.qqUserId, input.combatType);
  }

  async unbindCombat(input: { requestedBy: string; characterName: string }): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      await this.#request(`/api/admin/guilds/${encodeURIComponent(this.#config.guildId)}/qq-bindings/by-member/${encodeURIComponent(input.characterName)}`, { method: "DELETE" });
      return { text: `已解除角色 ${input.characterName} 的战斗绑定。` };
    });
  }

  rebindCombat(input: { requestedBy: string; characterName: string; qqUserId: string; combatType: CombatType }): Promise<ServiceResult<ServiceContent>> {
    return this.#putBinding(input.characterName, input.qqUserId, input.combatType);
  }

  async #putBinding(characterName: string, qqUserId: string, combatType: CombatType): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      await this.#request(`/api/admin/guilds/${encodeURIComponent(this.#config.guildId)}/qq-bindings/${encodeURIComponent(qqUserId)}`, {
        method: "PUT",
        body: JSON.stringify({ memberId: characterName, combatType }),
      });
      return { text: `已绑定：${characterName} → QQ ${qqUserId} → ${combatType}` };
    });
  }

  async #pruneStaleBindings(
    members: readonly Json[],
    bindings: readonly Json[],
  ): Promise<string[]> {
    const staleMemberIds = listStaleBindingMemberIds(members, bindings);
    const removed: string[] = [];
    for (const memberId of staleMemberIds) {
      try {
        await this.#request(
          `/api/admin/guilds/${encodeURIComponent(this.#config.guildId)}/qq-bindings/by-member/${encodeURIComponent(memberId)}`,
          { method: "DELETE" },
        );
        removed.push(memberId);
      } catch (error) {
        console.error(
          "[prune-stale-bindings] failed:",
          memberId,
          (error as Error).message ?? error,
        );
      }
    }
    return removed;
  }

  async setAura(input: { requestedBy: string; characterName: string; auraType: AuraType; level: number }): Promise<ServiceResult<ServiceContent>> {
    return this.#safe(async () => {
      await this.#request(`/api/admin/guilds/${encodeURIComponent(this.#config.guildId)}/auras/${encodeURIComponent(input.characterName)}`, {
        method: "PUT",
        body: JSON.stringify({ auraType: input.auraType, level: input.level }),
      });
      return { text: `已更新：${input.characterName} 的${input.auraType}光环 Lv.${input.level}` };
    });
  }
}

function readAttackLevelFromSnapshot(snapshot: Json | null | undefined): number | null {
  const skills = snapshot?.skills as Record<string, unknown> | undefined;
  const level = skills?.["/skills/attack"];
  return typeof level === "number" && Number.isFinite(level) ? level : null;
}

function memberMeetsAttackThreshold(
  member: Json | undefined,
  threshold: number,
): boolean {
  const attackLevel = readAttackLevelFromSnapshot(member?.latestSnapshot as Json | undefined);
  return attackLevel !== null && attackLevel >= threshold;
}

export function formatProfessionDistribution(
  members: readonly Json[],
  allBindings: readonly Json[],
  apiSlug = "TMD",
): string {
  const guildLabel = guildMessageLabel(apiSlug);
  const memberById = new Map(
    members.map((member) => [String(member.memberId), member]),
  );
  const bindings = allBindings.filter((binding) =>
    memberById.has(String(binding.memberId)),
  );
  const eligibleBindings = bindings.filter((binding) =>
    memberMeetsAttackThreshold(
      memberById.get(String(binding.memberId)),
      PROFESSION_DISTRIBUTION_ATTACK_LEVEL_THRESHOLD,
    ),
  );
  const order = ["弓", "弩", "火", "水", "自", "盾", "枪", "剑", "锤"];
  const counts = new Map(order.map((combatType) => [combatType, 0]));
  for (const binding of eligibleBindings) {
    const combatType = String(binding.combatType);
    if (counts.has(combatType)) {
      counts.set(combatType, (counts.get(combatType) ?? 0) + 1);
    }
  }
  const professionLines = order.map((combatType) => {
    const count = counts.get(combatType) ?? 0;
    const percent = eligibleBindings.length === 0
      ? 0
      : count / eligibleBindings.length * 100;
    return `${combatType}：${count}（${percent.toFixed(1)}%）`;
  });
  const threshold = PROFESSION_DISTRIBUTION_ATTACK_LEVEL_THRESHOLD;
  const ineligibleBindings = bindings.filter((binding) =>
    !memberMeetsAttackThreshold(
      memberById.get(String(binding.memberId)),
      threshold,
    ),
  );
  const lines = [
    `${guildLabel} 主职业分布（攻击≥${threshold}：${eligibleBindings.length}/${members.length} 人，已绑定 ${bindings.length} 人）`,
    ...professionLines,
    `未绑定：${Math.max(0, members.length - bindings.length)}`,
  ];
  if (ineligibleBindings.length > 0) {
    const ineligibleEntries = ineligibleBindings
      .map((binding) => {
        const member = memberById.get(String(binding.memberId));
        const name = String(member?.displayName ?? member?.memberId ?? binding.memberId);
        const attackLevel = readAttackLevelFromSnapshot(member?.latestSnapshot as Json | undefined);
        if (attackLevel === null) {
          return `${name}（未上传）`;
        }
        return `${name}（攻击${attackLevel}）`;
      })
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
    lines.push(`已绑定未达门槛（${ineligibleBindings.length} 人）：`);
    for (let index = 0; index < ineligibleEntries.length; index++) {
      lines.push(`${index + 1}. ${ineligibleEntries[index]}`);
    }
  }
  lines.push(
    `口径：当前公会名单中已通过 QQ 绑定、且快照攻击等级≥${threshold} 的主职业。`,
  );
  return lines.join("\n");
}

export function formatOptimizationAudit(
  members: readonly Json[],
  bindings: readonly Json[],
): string {
  const bound = new Set(bindings.map((binding) => String(binding.memberId)));
  const nameOf = (member: Json) =>
    String(member.displayName ?? member.memberId);
  const missingBinding = members
    .filter((member) => !bound.has(String(member.memberId)))
    .map(nameOf);
  const missingSnapshot = members
    .filter((member) => !member.latestSnapshot)
    .map(nameOf);
  const uploadedWithoutBinding = members
    .filter(
      (member) =>
        Boolean(member.latestSnapshot) &&
        !bound.has(String(member.memberId)),
    )
    .map(nameOf);
  const boundWithoutUpload = members
    .filter(
      (member) =>
        !member.latestSnapshot &&
        bound.has(String(member.memberId)),
    )
    .map(nameOf);
  const belowAttackThreshold = members
    .filter((member) => {
      if (!bound.has(String(member.memberId))) return false;
      const attackLevel = readAttackLevelFromSnapshot(
        member.latestSnapshot as Json | undefined,
      );
      return attackLevel === null || attackLevel < GUILD_TRIAL_MIN_ATTACK_LEVEL;
    })
    .map((member) => {
      const attackLevel = readAttackLevelFromSnapshot(
        member.latestSnapshot as Json | undefined,
      );
      const name = nameOf(member);
      return attackLevel === null
        ? `${name}（未上传攻击）`
        : `${name}（攻击${attackLevel}）`;
    });
  const names = (rows: string[]) => rows.length ? rows.join("、") : "无";

  return [
    `优化检查：成员 ${members.length}，已绑定 ${bound.size}`,
    `未绑定职业：${names(missingBinding)}`,
    `未上传配装：${names(missingSnapshot)}`,
    `已上传未绑定：${names(uploadedWithoutBinding)}`,
    `已绑定未上传：${names(boundWithoutUpload)}`,
    `攻击<${GUILD_TRIAL_MIN_ATTACK_LEVEL}不可参加试炼：${names(belowAttackThreshold)}`,
    "插件版本逐成员校验：快照尚未保存独立插件版本字段，暂不可用",
  ].join("\n");
}

export function listStaleBindingMemberIds(
  members: readonly Json[],
  bindings: readonly Json[],
): string[] {
  const activeIds = new Set(members.map((member) => String(member.memberId)));
  return bindings
    .map((binding) => String(binding.memberId))
    .filter((memberId) => !activeIds.has(memberId))
    .sort((left, right) => left.localeCompare(right));
}

export function filterBindingsToActiveRoster(
  members: readonly Json[],
  bindings: readonly Json[],
): Json[] {
  const activeIds = new Set(members.map((member) => String(member.memberId)));
  return bindings.filter((binding) => activeIds.has(String(binding.memberId)));
}

export function formatUnavailableRoster(
  members: readonly Json[],
  bindings: readonly Json[],
  options: { prunedMemberIds?: readonly string[]; guildId?: string } = {},
): string {
  const guildId = options.guildId ?? "TMD";
  const readinessOptions = combatReadinessOptionsForGuild(guildId);
  const shieldsPerSide = shieldsPerSideForGuild(guildId);
  const memberMap = new Map(
    members.map((member) => [String(member.memberId), member]),
  );
  const unavailable: Array<{
    memberId: string;
    combatType: string;
    reason: string;
  }> = [];
  const usableShields: Array<{
    memberId: string;
    combatType: string;
    snapshot: Json | null;
  }> = [];

  for (const binding of bindings) {
    const memberId = String(binding.memberId);
    const combatType = String(binding.combatType ?? "");
    const member = memberMap.get(memberId);
    if (!member) continue;
    const snapshot = member.latestSnapshot ?? null;
    const readiness = assessCombatMemberReadiness(
      snapshot,
      combatType,
      readinessOptions,
    );
    if (!readiness.ok) {
      unavailable.push({
        memberId,
        combatType,
        reason: readiness.reason,
      });
      continue;
    }
    if (combatType === "盾") {
      usableShields.push({ memberId, combatType, snapshot });
    }
  }

  if (shieldsPerSide != null) {
    const { dropped } = keepTopShieldsByDefense(
      usableShields,
      shieldsPerSide * 2,
    );
    for (const row of dropped) {
      unavailable.push({
        memberId: row.memberId,
        combatType: "盾",
        reason: formatShieldCapReason(row, shieldsPerSide),
      });
    }
  }

  unavailable.sort((left, right) => left.memberId.localeCompare(right.memberId));

  const lines: string[] = [];
  if (!unavailable.length) {
    lines.push(
      `全库不可用：无（已绑定 ${bindings.length} 人均满足战斗试炼模拟门槛）`,
    );
  } else {
    lines.push(
      `全库不可用：${unavailable
        .map((row) => `${row.memberId}/${row.combatType}(${row.reason})`)
        .join("、")}`,
    );
  }
  if (options.prunedMemberIds?.length) {
    lines.push(
      `已自动清理离会成员绑定：${options.prunedMemberIds.join("、")}`,
    );
  }
  return lines.join("\n");
}

/**
 * 上传过期阈值（毫秒）。超过此时间未更新快照视为上传过期。
 * 当前设为 7 天，与公会周重置节奏对齐。
 */
const UPLOAD_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function formatMissingUploads(
  members: readonly Json[],
  groupMemberNames?: string[],
): string {
  const nameOf = (member: Json) =>
    String(member.displayName ?? member.memberId);
  const missing = members
    .filter((member) => !member.latestSnapshot)
    .map(nameOf);
  const uploadedCount = members.length - missing.length;

  const lines: string[] = [
    `未上传配装名单（${missing.length} 人，仅当前在册成员）`,
  ];

  if (missing.length) {
    for (let i = 0; i < missing.length; i++) {
      lines.push(`${i + 1}. ${missing[i]}`);
    }
  } else {
    lines.push("无");
  }

  lines.push(`已上传：${uploadedCount} / 共 ${members.length} 人`);

  // When group member names are available, cross-reference with fuzzy matching.
  if (groupMemberNames && groupMemberNames.length > 0) {
    const notInGroup = missing.filter(
      (memberName) => !fuzzyMatchMemberInGroup(memberName, groupMemberNames),
    );

    lines.push("");
    if (notInGroup.length) {
      lines.push(`⚠ 以下 ${notInGroup.length} 人未上传且未在群内匹配到（可能不在群里或群名片与游戏ID不一致）：`);
      for (let i = 0; i < notInGroup.length; i++) {
        lines.push(`  ${i + 1}. ${notInGroup[i]}`);
      }
    } else {
      lines.push("✓ 所有未上传成员均在群内匹配到，可能尚未安装插件。");
    }
  }

  lines.push("请安装公会插件上传配装，发送“公会插件”获取安装地址。");
  return lines.join("\n");
}

export function formatExpiredUploads(
  members: readonly Json[],
): string {
  const now = Date.now();
  const nameOf = (member: Json) =>
    String(member.displayName ?? member.memberId);
  const expired = members
    .filter((member) => {
      if (!member.latestSnapshot) return false; // 从未上传的不计入过期
      const receivedAt = member.snapshotReceivedAt;
      if (typeof receivedAt !== "string") return false;
      const timestamp = new Date(receivedAt).getTime();
      if (Number.isNaN(timestamp)) return false;
      return now - timestamp > UPLOAD_EXPIRY_MS;
    })
    .map((member) => ({
      name: nameOf(member),
      receivedAt: String(member.snapshotReceivedAt ?? "").slice(0, 10),
    }));
  const hasSnapshot = members.filter((m) => Boolean(m.latestSnapshot)).length;
  const lines = expired.length
    ? expired.map(
        (entry, index) =>
          `${index + 1}. ${entry.name}（最后上传：${entry.receivedAt}）`,
      )
    : ["无"];

  return [
    `上传过期名单（超过 7 天未更新，${expired.length} 人）`,
    ...lines,
    `已上传：${hasSnapshot} / 共 ${members.length} 人`,
    "请更新插件后重新上传配装，发送“公会插件”获取最新版本。",
  ].join("\n");
}

export function formatGuildBottleneck(members: readonly Json[]): string {
  const withSnapshot = members.filter((m) => Boolean(m.latestSnapshot));
  if (!withSnapshot.length) {
    return "暂无成员快照数据，无法计算公会短板。";
  }

  const results: Array<{ name: string; avg: number }> = [];
  for (const skill of LIFE_SKILLS) {
    const workforces: number[] = [];
    for (const member of withSnapshot) {
      const wf = computeWorkforce(
        member.latestSnapshot as Json,
        skill.hrid,
        skill.actionType,
        skill.efficiencyKey,
      );
      if (wf > 0) workforces.push(wf);
    }
    workforces.sort((a, b) => b - a);
    const topN = workforces.slice(0, BOTTLENECK_TOP_N);
    const avg = topN.length > 0
      ? topN.reduce((sum, v) => sum + v, 0) / topN.length
      : 0;
    results.push({ name: skill.name, avg });
  }

  // Sort by average ascending — bottleneck at the end.
  results.sort((a, b) => a.avg - b.avg);

  const lines = [
    `公会生活专业短板`,
    `共 ${withSnapshot.length} 人已有快照（前${BOTTLENECK_TOP_N}名工作力均值）`,
  ];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const marker = i === 0 ? " ← 短板" : "";
    const avgStr = r.avg > 0 ? r.avg.toFixed(1) : "—";
    lines.push(`${String(i + 1).padStart(2, " ")}. ${r.name.padEnd(4, "　")} ${avgStr}${marker}`);
  }
  lines.push("口径：工作力 = floor(技能等级 × (1 + 装备效率加成))；生活分工优化目标为四场生活基础点数之和");

  return lines.join("\n");
}

/** Bot-readable test report PNGs: `1-badger-summary.png`, `2-hedgehog-members.png`, etc. */
export function isAllowedTestReportFileName(fileName: string): boolean {
  return /^[12]-[a-z0-9-]+-(summary|members)\.png$/.test(fileName);
}

export function isAbsentTestReportFileError(error: unknown): boolean {
  const row = error as NodeJS.ErrnoException & { message?: string };
  if (row?.code === "ENOENT") return true;
  return /ENOENT|no such file or directory/i.test(String(row?.message ?? ""));
}

export function isMissingOrStaleTestReportError(error: unknown): boolean {
  const row = error as { status?: number };
  return (
    isAbsentTestReportFileError(error) ||
    row.status === 404 ||
    row.status === 409
  );
}

export function missingTestReportAssetsMessage(
  reportDirectory = process.env.MWI_TEST_REPORT_DIR,
): string {
  const dir =
    reportDirectory?.trim() ||
    "D:\\mwi-guild-server\\guild-trial-simulator\\artifacts\\test-report";
  return (
    `战斗结果图片目录缺少 manifest.json（当前：${dir}）。` +
    "请确认已跑 `node scripts/run-and-publish-combat-assignment.mjs`，" +
    "git pull 后该目录含 4 张 PNG + manifest.json，" +
    "或把 MWI_TEST_REPORT_DIR 指到 artifacts\\test-report 后重启 QQ Bot。"
  );
}

function resolveLifeReportDirectory(guildId?: string): string {
  const fromEnv = process.env.MWI_LIFE_REPORT_DIR?.trim();
  if (fromEnv) return fromEnv;
  return resolveGuildReportPaths(guildId).lifeReportArtifactsDir;
}

export { formatGuildProfessionReport } from "./guild-profession-report.ts";
