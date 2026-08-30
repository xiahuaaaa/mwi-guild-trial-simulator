import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";

import {
  COMBAT_RULES_VERSION,
  PERMANENT_BUFFS_ENABLED,
  assertCombatRulesVersion,
} from "../../packages/shykai-full-runtime/src/combat-rules-version.mjs";

test("combat lab contract accepts only the current rules version and disabled permanent buffs", () => {
  const lab = {
    combatRulesVersion: COMBAT_RULES_VERSION,
    permanentBuffsEnabled: PERMANENT_BUFFS_ENABLED,
  };
  assert.equal(assertCombatRulesVersion(lab, "fixture"), lab);
  assert.throws(
    () => assertCombatRulesVersion({ ...lab, combatRulesVersion: "old" }, "fixture"),
    /combatRulesVersion/,
  );
  assert.throws(
    () => assertCombatRulesVersion(
      { ...lab, combatRulesVersion: "guild-trial-rules-2026-08-30.1" },
      "old .1 lab",
    ),
    /expected guild-trial-rules-2026-08-30\.2/,
  );
  assert.throws(
    () => assertCombatRulesVersion({ ...lab, permanentBuffsEnabled: true }, "fixture"),
    /permanentBuffsEnabled/,
  );
});

test("run-and-publish rejects a missing version before rendering or publishing", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "combat-rules-version-"));
  const assignmentPath = path.join(temporaryDirectory, "old-lab.json");
  await writeFile(assignmentPath, JSON.stringify({ generatedAt: "2026-08-30T00:00:00Z" }));
  try {
    const result = await runNode(
      ["scripts/run-and-publish-combat-assignment.mjs", "--skip-sim", "--skip-publish"],
      {
        MWI_AVAILABLE_REPORT_JSON: assignmentPath,
      },
    );
    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /combatRulesVersion/);
    assert.equal(await readFile(assignmentPath, "utf8"), JSON.stringify({ generatedAt: "2026-08-30T00:00:00Z" }));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("run-and-publish rejects a .1 lab before rendering or publishing", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "combat-rules-version-"));
  const assignmentPath = path.join(temporaryDirectory, "old-lab.json");
  const oldLab = {
    combatRulesVersion: "guild-trial-rules-2026-08-30.1",
    permanentBuffsEnabled: false,
  };
  await writeFile(assignmentPath, JSON.stringify(oldLab));
  try {
    const result = await runNode(
      ["scripts/run-and-publish-combat-assignment.mjs", "--skip-sim", "--skip-publish"],
      {
        MWI_AVAILABLE_REPORT_JSON: assignmentPath,
      },
    );
    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /expected guild-trial-rules-2026-08-30\.2/);
    assert.equal(await readFile(assignmentPath, "utf8"), JSON.stringify(oldLab));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(import.meta.dirname, "../.."),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
