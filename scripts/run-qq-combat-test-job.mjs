#!/usr/bin/env node
/**
 * Detached wrapper for QQ「战斗模拟」.
 * Runs the combat assignment pipeline, then writes success/failure onto the
 * combat-test-run state file so the bot can notify the original chat.
 * Published GitHub Pages report is the official plan.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = process.env.MWI_COMBAT_TEST_RUN_STATE?.trim();
if (!statePath) {
  throw new Error("MWI_COMBAT_TEST_RUN_STATE is required");
}

const {
  markCombatTestRunFinished,
  readCombatTestRunState,
  writeCombatTestRunState,
} = await import(
  pathToFileURL(path.join(projectRoot, "apps/qq-bot/src/combat-test-run.ts")).href
);

const current = readCombatTestRunState(statePath);
if (current) {
  writeCombatTestRunState(statePath, { ...current, pid: process.pid });
}

const pipeline = process.env.MWI_COMBAT_TEST_PIPELINE_SCRIPT?.trim()
  ?? path.join(projectRoot, "scripts/run-and-publish-combat-assignment.mjs");

const result = spawnSync(process.execPath, [pipeline], {
  cwd: projectRoot,
  env: process.env,
  encoding: "utf8",
  stdio: "inherit",
});

if (result.status === 0) {
  markCombatTestRunFinished(statePath, { ok: true });
  process.exit(0);
}

markCombatTestRunFinished(statePath, {
  ok: false,
  error: formatJobFailure(result, current?.logPath),
});
process.exit(result.status === null ? 1 : result.status);

function formatJobFailure(result, logPath) {
  const parts = [];
  if (result.error?.message) parts.push(result.error.message);
  if (result.status != null) parts.push(`退出码 ${result.status}`);
  if (result.signal) parts.push(`信号 ${result.signal}`);
  if (logPath) {
    try {
      const tail = readFileSync(logPath, "utf8").trim().slice(-1200);
      if (tail) parts.push(tail);
    } catch {
      // The QQ message still has the exit code even if the log is missing.
    }
  }
  return parts.join("\n") || "战斗模拟失败。";
}
