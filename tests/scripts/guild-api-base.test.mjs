import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_COMBAT_ROSTER_API_BASE,
  combatRosterApiIsLoopback,
  resolveCombatRosterApiBase,
} from "../../scripts/guild-api-base.mjs";

const weeklyPlaybook = await readFile(
  new URL("../../docs/WEEKLY_COMBAT_SCREENING.md", import.meta.url),
  "utf8",
);
const labSource = await readFile(
  new URL("../../scripts/run-available-roster-composition-lab.mjs", import.meta.url),
  "utf8",
);
const insanitySource = await readFile(
  new URL("../../scripts/ab-insanity-top-dps.mjs", import.meta.url),
  "utf8",
);
const natureSource = await readFile(
  new URL("../../scripts/ab-nature-healer-to-dps.mjs", import.meta.url),
  "utf8",
);
const publishSource = await readFile(
  new URL("../../scripts/run-and-publish-combat-assignment.mjs", import.meta.url),
  "utf8",
);

test("combat roster API defaults to the public host QQ uses", () => {
  assert.equal(DEFAULT_COMBAT_ROSTER_API_BASE, "https://api.adudu.lol");
  assert.equal(resolveCombatRosterApiBase({}), "https://api.adudu.lol");
  assert.equal(
    resolveCombatRosterApiBase({ MWI_GUILD_API_BASE: " https://api.adudu.lol/ " }),
    "https://api.adudu.lol",
  );
  assert.equal(
    resolveCombatRosterApiBase({ MWI_GUILD_API_BASE: "http://127.0.0.1:8787" }),
    "http://127.0.0.1:8787",
  );
  assert.equal(combatRosterApiIsLoopback("http://127.0.0.1:8787"), true);
  assert.equal(combatRosterApiIsLoopback("https://api.adudu.lol"), false);
});

test("weekly combat playbook and lab scripts do not default to local 8787", () => {
  assert.match(
    weeklyPlaybook,
    /MWI_GUILD_API_BASE="\$\{MWI_GUILD_API_BASE:-https:\/\/api\.adudu\.lol\}"/,
  );
  assert.doesNotMatch(
    weeklyPlaybook,
    /MWI_GUILD_API_BASE="\$\{MWI_GUILD_API_BASE:-http:\/\/127\.0\.0\.1:8787\}"/,
  );
  for (const [name, source] of [
    ["lab", labSource],
    ["insanity", insanitySource],
    ["nature", natureSource],
    ["publish", publishSource],
  ]) {
    assert.match(source, /resolveCombatRosterApiBase/, `${name} should use shared public API helper`);
    assert.doesNotMatch(
      source,
      /MWI_GUILD_API_BASE \?\? "http:\/\/127\.0\.0\.1:8787"/,
      `${name} must not default to loopback`,
    );
  }
});
