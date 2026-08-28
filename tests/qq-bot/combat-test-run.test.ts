import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  combatTestPipelineAvailability,
  formatCombatTestRunProgress,
  formatCombatTestRunStarted,
  peekPendingCombatTestRunNotification,
  readCombatTestRunState,
  resolveCombatTestPaths,
  startCombatTestRun,
  withAgentPath,
  writeCombatTestRunState,
} from "../../apps/qq-bot/src/combat-test-run.ts";
import { GuildApiCommandService } from "../../apps/qq-bot/src/api-client.ts";
import { createServer } from "node:http";

const combatTestRunModule = pathToFileURL(
  fileURLToPath(new URL("../../apps/qq-bot/src/combat-test-run.ts", import.meta.url)),
).href;

function fakeSimulatorRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "mwi-combat-test-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, ".local"), { recursive: true });
  writeFileSync(
    path.join(root, "scripts/run-and-publish-combat-assignment.mjs"),
    "process.exit(0);\n",
  );
  writeFileSync(
    path.join(root, "scripts/run-qq-combat-test-job.mjs"),
    `import { markCombatTestRunFinished } from ${JSON.stringify(combatTestRunModule)};
const statePath = process.env.MWI_COMBAT_TEST_RUN_STATE;
markCombatTestRunFinished(statePath, { ok: true });
`,
  );
  return resolveCombatTestPaths(root);
}

test("combat test pipeline is unavailable without scripts", () => {
  const root = mkdtempSync(path.join(tmpdir(), "mwi-combat-empty-"));
  const paths = resolveCombatTestPaths(root);
  const availability = combatTestPipelineAvailability(paths);
  assert.equal(availability.available, false);
  assert.match(availability.reason, /战斗模拟脚本未找到/u);
});

test("combat test progress displays timestamps in Beijing time", () => {
  const text = formatCombatTestRunProgress({
    status: "succeeded",
    startedAt: "2026-08-14T02:48:46.162Z",
    finishedAt: "2026-08-14T03:00:00.000Z",
    requestedBy: "admin-1",
    excludedCharacterNames: [],
    logPath: "/tmp/combat-test.log",
    notify: { chatKind: "private", userId: "admin-1" },
  });
  assert.match(text, /开始：2026-08-14 10:48:46 北京时间/u);
  assert.match(text, /结束：2026-08-14 11:00:00 北京时间/u);
  assert.doesNotMatch(text, /2026-08-14T02:48:46\.162Z/u);
});

test("combat test availability does not follow /health.simulationEngine", async (t) => {
  const paths = fakeSimulatorRoot();
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        service: "mwi-guild-api",
        simulationEngine: "unavailable",
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const service = new GuildApiCommandService({
    baseUrl: `http://127.0.0.1:${address.port}`,
    adminKey: "test-admin",
    guildId: "TMD",
    simulatorRoot: paths.simulatorRoot,
    combatTestStatePath: paths.statePath,
    combatTestLogPath: paths.logPath,
  });
  const production = await service.getProductionSimulationAvailability();
  const testRun = await service.getTestSimulationAvailability();
  assert.equal(production.available, false);
  assert.equal(testRun.available, true);
});

test("startCombatTestRun rejects a second job while one is running", () => {
  const paths = fakeSimulatorRoot();
  writeCombatTestRunState(paths.statePath, {
    status: "running",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    requestedBy: "admin-1",
    excludedCharacterNames: [],
    logPath: paths.logPath,
    notify: { chatKind: "group", userId: "admin-1", groupId: "g" },
  });
  const conflict = startCombatTestRun({
    paths,
    requestedBy: "admin-2",
    excludedCharacterNames: [],
    notify: { chatKind: "private", userId: "admin-2" },
  });
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.code, "conflict");
  assert.match(conflict.message, /已有战斗模拟/u);
});

test("startCombatTestRun writes started text and a detached job can finish", async () => {
  const paths = fakeSimulatorRoot();
  const started = startCombatTestRun({
    paths,
    requestedBy: "admin-1",
    excludedCharacterNames: [],
    notify: { chatKind: "group", userId: "admin-1", groupId: "532133273" },
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.match(formatCombatTestRunStarted(started.state), /视为正式方案/u);
  assert.doesNotMatch(formatCombatTestRunStarted(started.state), /不覆盖正式分工/u);
  assert.equal(started.state.excludedCharacterNames.length, 0);

  const deadline = Date.now() + 5_000;
  let done = readCombatTestRunState(paths.statePath);
  while (Date.now() < deadline && done?.status === "running") {
    await new Promise((resolve) => setTimeout(resolve, 50));
    done = readCombatTestRunState(paths.statePath);
  }
  assert.equal(done?.status, "succeeded");
  const pending = peekPendingCombatTestRunNotification(paths.statePath);
  assert.equal(pending?.status, "succeeded");
});

test("finished state can be marked without a live process", () => {
  const paths = fakeSimulatorRoot();
  writeCombatTestRunState(paths.statePath, {
    status: "succeeded",
    startedAt: new Date().toISOString(),
    requestedBy: "1",
    excludedCharacterNames: [],
    logPath: paths.logPath,
    notify: { chatKind: "group", userId: "1", groupId: "g" },
    finishedAt: new Date().toISOString(),
  });
  const pending = peekPendingCombatTestRunNotification(paths.statePath);
  assert.equal(pending?.status, "succeeded");
  assert.equal(pending?.notified, undefined);
});

test("withAgentPath prepends Homebrew when LaunchAgent PATH is empty", () => {
  const env = withAgentPath({ PATH: "/usr/bin:/bin" });
  assert.match(env.PATH ?? "", /^\/opt\/homebrew\/bin:/u);
  assert.match(env.PATH ?? "", /\/usr\/bin:\/bin/u);
});

test("combat publish pipeline invokes nested scripts with process.execPath", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../scripts/run-and-publish-combat-assignment.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /run\(process\.execPath/u);
  assert.equal(source.includes('run("node"'), false);
});
