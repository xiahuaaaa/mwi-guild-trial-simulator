import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { formatBeijingTimestamp } from "./beijing-time.ts";

export const AGENT_PATH_PREFIX =
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

export function withAgentPath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const current = env.PATH ?? "";
  if (current.split(":").includes("/opt/homebrew/bin")) {
    return { ...env };
  }
  return {
    ...env,
    PATH: current ? `${AGENT_PATH_PREFIX}:${current}` : AGENT_PATH_PREFIX,
  };
}

export const COMBAT_ASSIGNMENT_PIPELINE_SCRIPT =
  "scripts/run-and-publish-combat-assignment.mjs";
export const COMBAT_TEST_JOB_SCRIPT = "scripts/run-qq-combat-test-job.mjs";

export type CombatTestRunStatus = "running" | "succeeded" | "failed";
export type CombatTestChatKind = "private" | "group";

export interface CombatTestRunNotifyTarget {
  chatKind: CombatTestChatKind;
  userId: string;
  groupId?: string;
}

export interface CombatTestRunState {
  status: CombatTestRunStatus;
  pid?: number;
  startedAt: string;
  requestedBy: string;
  excludedCharacterNames: string[];
  logPath: string;
  notify: CombatTestRunNotifyTarget;
  error?: string;
  finishedAt?: string;
  notified?: boolean;
}

export interface CombatTestRunPaths {
  simulatorRoot: string;
  pipelineScript: string;
  jobScript: string;
  statePath: string;
  logPath: string;
}

export function defaultSimulatorRoot(projectRoot: string): string {
  const fromEnv = process.env.MWI_GUILD_SIMULATOR_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const localPipeline = path.join(projectRoot, COMBAT_ASSIGNMENT_PIPELINE_SCRIPT);
  if (existsSync(localPipeline)) return path.resolve(projectRoot);
  const workspace = "/Users/xhy/Downloads/mwi/guild-trial-simulator";
  if (existsSync(path.join(workspace, COMBAT_ASSIGNMENT_PIPELINE_SCRIPT))) {
    return workspace;
  }
  return path.resolve(projectRoot);
}

export function resolveCombatTestPaths(
  simulatorRoot: string,
  options: { statePath?: string; logPath?: string } = {},
): CombatTestRunPaths {
  const root = path.resolve(simulatorRoot);
  const localDir = path.join(root, ".local");
  return {
    simulatorRoot: root,
    pipelineScript: path.join(root, COMBAT_ASSIGNMENT_PIPELINE_SCRIPT),
    jobScript: path.join(root, COMBAT_TEST_JOB_SCRIPT),
    statePath: options.statePath ??
      process.env.MWI_COMBAT_TEST_RUN_STATE?.trim() ??
      path.join(localDir, "combat-test-run.json"),
    logPath: options.logPath ??
      process.env.MWI_COMBAT_TEST_RUN_LOG?.trim() ??
      path.join(localDir, "combat-test-run.log"),
  };
}

export function combatTestPipelineAvailability(
  paths: CombatTestRunPaths,
): { available: true } | { available: false; reason: string } {
  if (!existsSync(paths.pipelineScript) || !existsSync(paths.jobScript)) {
    return {
      available: false,
      reason:
        "战斗模拟脚本未找到。请设置 MWI_GUILD_SIMULATOR_ROOT 指向含 scripts/run-and-publish-combat-assignment.mjs 的工程目录。",
    };
  }
  return { available: true };
}

export function readCombatTestRunState(
  statePath: string,
): CombatTestRunState | null {
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as CombatTestRunState;
    if (!parsed || typeof parsed.status !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCombatTestRunState(
  statePath: string,
  state: CombatTestRunState,
): void {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function isPidAlive(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || !pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRecentlyStarted(state: CombatTestRunState): boolean {
  const started = Date.parse(state.startedAt);
  return Number.isFinite(started) && Date.now() - started < 15_000;
}

export function isCombatTestRunActive(
  state: CombatTestRunState | null,
): boolean {
  if (!state || state.status !== "running") return false;
  if (isPidAlive(state.pid)) return true;
  return !state.pid && isRecentlyStarted(state);
}

export function reconcileCombatTestRunState(
  statePath: string,
): CombatTestRunState | null {
  const state = readCombatTestRunState(statePath);
  if (!state) return null;
  if (state.status === "running" && !isCombatTestRunActive(state)) {
    const crashed: CombatTestRunState = {
      ...state,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: state.error ?? "战斗模拟进程已退出，可能崩溃或被重启打断。",
    };
    writeCombatTestRunState(statePath, crashed);
    return crashed;
  }
  return state;
}

export function formatCombatTestRunProgress(
  state: CombatTestRunState | null,
): string {
  if (!state) {
    return "当前没有进行中的战斗模拟。";
  }
  const lines = [
    `战斗模拟状态：${statusLabel(state.status)}`,
    `发起 QQ：${state.requestedBy}`,
    `开始：${formatBeijingTimestamp(state.startedAt)}`,
  ];
  if (state.finishedAt) {
    lines.push(`结束：${formatBeijingTimestamp(state.finishedAt)}`);
  }
  if (state.error) lines.push(`原因：${state.error}`);
  if (state.status === "running") {
    lines.push("完成后会发布为正式方案并把结果图发到原对话。可用「终止分工」取消。");
  }
  if (state.status === "succeeded") {
    lines.push("已发布为正式方案。可发送「本周分工」再次查看结果图。");
  }
  return lines.join("\n");
}

function statusLabel(status: CombatTestRunStatus): string {
  if (status === "running") return "进行中";
  if (status === "succeeded") return "已完成";
  return "失败";
}

export function formatCombatTestRunFinished(state: CombatTestRunState): string {
  if (state.status === "succeeded") {
    return "战斗模拟完成，已发布为正式方案。";
  }
  return [
    "战斗模拟失败。",
    state.error ? `原因：${state.error}` : "",
    "可发「分工进度」查看状态。",
  ].filter(Boolean).join("\n");
}

export function formatCombatTestRunStarted(_state: CombatTestRunState): string {
  return [
    "战斗模拟已启动。完成后会上传到公网页并视为正式方案。",
    "完整模拟通常需要数分钟到十几分钟；完成后会把结果图发到本对话。",
    "期间可发「分工进度」查看状态，或「终止分工」取消。",
  ].join("\n");
}

export function startCombatTestRun(input: {
  paths: CombatTestRunPaths;
  requestedBy: string;
  excludedCharacterNames: string[];
  notify: CombatTestRunNotifyTarget;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
}):
  | { ok: true; state: CombatTestRunState }
  | { ok: false; code: "conflict" | "unavailable"; message: string } {
  const availability = combatTestPipelineAvailability(input.paths);
  if (!availability.available) {
    return { ok: false, code: "unavailable", message: availability.reason };
  }
  const current = reconcileCombatTestRunState(input.paths.statePath);
  if (isCombatTestRunActive(current)) {
    return {
      ok: false,
      code: "conflict",
      message: "已有战斗模拟在进行，未启动新任务。请先发「分工进度」或「终止分工」。",
    };
  }

  mkdirSync(path.dirname(input.paths.logPath), { recursive: true });
  const state: CombatTestRunState = {
    status: "running",
    startedAt: new Date().toISOString(),
    requestedBy: input.requestedBy,
    excludedCharacterNames: input.excludedCharacterNames,
    logPath: input.paths.logPath,
    notify: input.notify,
  };
  writeCombatTestRunState(input.paths.statePath, state);

  const logFd = openSync(input.paths.logPath, "w");
  const spawnImpl = input.spawnImpl ?? spawn;
  let child: ChildProcess;
  try {
    child = spawnImpl(
      process.execPath,
      [input.paths.jobScript],
      {
        cwd: input.paths.simulatorRoot,
        env: withAgentPath({
          ...process.env,
          ...input.env,
          MWI_COMBAT_TEST_RUN_STATE: input.paths.statePath,
          MWI_COMBAT_TEST_PIPELINE_SCRIPT: input.paths.pipelineScript,
          MWI_GUILD_EXCLUDE_MEMBERS: input.excludedCharacterNames.join(","),
        }),
        detached: true,
        stdio: ["ignore", logFd, logFd],
      },
    );
  } catch (error) {
    const failed: CombatTestRunState = {
      ...state,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    writeCombatTestRunState(input.paths.statePath, failed);
    return { ok: false, code: "unavailable", message: failed.error ?? "无法启动战斗模拟。" };
  }

  if (!child.pid) {
    const failed: CombatTestRunState = {
      ...state,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "战斗模拟进程没有 PID。",
    };
    writeCombatTestRunState(input.paths.statePath, failed);
    return { ok: false, code: "unavailable", message: failed.error };
  }

  const started = { ...state, pid: child.pid };
  writeCombatTestRunState(input.paths.statePath, started);
  child.unref();
  return { ok: true, state: started };
}

export function stopCombatTestRun(
  statePath: string,
): { ok: true; message: string } | { ok: false; code: "not-found"; message: string } {
  const state = reconcileCombatTestRunState(statePath);
  if (!isCombatTestRunActive(state) || !state) {
    return {
      ok: false,
      code: "not-found",
      message: "当前没有可终止的战斗模拟。",
    };
  }
  try {
    process.kill(-state.pid!, "SIGTERM");
  } catch {
    try {
      process.kill(state.pid!, "SIGTERM");
    } catch {
      // Process may have exited between reconcile and kill.
    }
  }
  const stopped: CombatTestRunState = {
    ...state,
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: "管理员终止了这次战斗模拟。",
    notified: true,
  };
  writeCombatTestRunState(statePath, stopped);
  return { ok: true, message: "已终止战斗模拟。" };
}

export function markCombatTestRunFinished(
  statePath: string,
  result: { ok: boolean; error?: string },
): CombatTestRunState | null {
  const current = readCombatTestRunState(statePath);
  if (!current) return null;
  const next: CombatTestRunState = {
    ...current,
    status: result.ok ? "succeeded" : "failed",
    finishedAt: new Date().toISOString(),
    error: result.ok ? undefined : (result.error ?? "战斗模拟失败。"),
  };
  writeCombatTestRunState(statePath, next);
  return next;
}

export function peekPendingCombatTestRunNotification(
  statePath: string,
): CombatTestRunState | null {
  const state = reconcileCombatTestRunState(statePath);
  if (!state || state.status === "running" || state.notified) return null;
  return state;
}

export function markCombatTestRunNotified(statePath: string): void {
  const state = readCombatTestRunState(statePath);
  if (!state || state.notified) return;
  writeCombatTestRunState(statePath, { ...state, notified: true });
}

export function startCombatTestRunPoller(options: {
  statePath: string;
  intervalMs?: number;
  onNotify: (state: CombatTestRunState) => Promise<void> | void;
}): () => void {
  const intervalMs = options.intervalMs ?? 5_000;
  let ticking = false;
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const pending = peekPendingCombatTestRunNotification(options.statePath);
      if (!pending) return;
      await options.onNotify(pending);
      markCombatTestRunNotified(options.statePath);
    } catch (error) {
      console.error(
        "[combat-test-run] notify failed:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      ticking = false;
    }
  }

  return () => clearInterval(timer);
}
