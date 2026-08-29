import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildGuildPluginArtifacts } from "../../scripts/publish-guild-plugins.mjs";
import {
  TMD_GITEE_INSTALL_URL,
  TMD_GREASYFORK_INSTALL,
  TMD_GREASYFORK_NAME,
  buildTmdGiteeDistSource,
  buildTmdGreasyForkDistSource,
} from "../../scripts/tmd-plugin-install-urls.mjs";

const tmdSource = await readFile(
  new URL("../../userscripts/member-candidate-loadout-exporter.user.js", import.meta.url),
  "utf8",
);
const memberPublish = await readFile(new URL("../../scripts/publish-member-plugin.mjs", import.meta.url), "utf8");
const wiPublish = await readFile(new URL("../../scripts/publish-wi-member-plugin.mjs", import.meta.url), "utf8");

test("TMD Greasy Fork dist keeps Chinese GF identity and 588902 install URLs", () => {
  const out = buildTmdGreasyForkDistSource(tmdSource);
  assert.match(out, new RegExp(`^// @name         ${TMD_GREASYFORK_NAME}$`, "m"));
  assert.match(out, new RegExp(`^// @downloadURL  ${TMD_GREASYFORK_INSTALL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(out, /588902.*meta\.js/m);
});

test("TMD Gitee dist points @downloadURL/@updateURL at gitee raw", () => {
  const out = buildTmdGiteeDistSource(tmdSource);
  assert.match(out, new RegExp(`^// @downloadURL  ${TMD_GITEE_INSTALL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(out, /^\/\/ @name\s+TMD-guild-trial-sync/m);
});

test("guild plugin publish builds TMD and WI artifacts for all three channels", () => {
  const artifacts = buildGuildPluginArtifacts(tmdSource, "593342");
  assert.equal(artifacts.tmdVersion, "0.6.22");
  assert.equal(artifacts.wiVersion, "0.6.22-wi.1");
  assert.match(artifacts.tmdGithub, /requestJsonWithFetch/);
  assert.match(artifacts.wiGithub, /requestJsonWithFetch/);
  assert.match(artifacts.tmdGithub, /588902/);
  assert.match(artifacts.wiGithub, /593342/);
  assert.equal(artifacts.channels.tmd.github.endsWith("mwi-guild-trial-sync.user.js"), true);
  assert.equal(artifacts.channels.wi.github.endsWith("wi-guild-trial-sync.user.js"), true);
  assert.match(artifacts.channels.tmd.gitee, /TMD-guild-trial-sync/);
  assert.match(artifacts.channels.wi.gitee, /WI-guild-trial-sync/);
  assert.match(artifacts.channels.tmd.greasyFork, /588902/);
  assert.match(artifacts.channels.wi.greasyFork, /593342/);
});

test("legacy TMD and WI publish entries always delegate to the dual-guild publisher", () => {
  assert.match(memberPublish, /publish-guild-plugins\.mjs/);
  assert.match(wiPublish, /publish-guild-plugins\.mjs/);
  assert.doesNotMatch(memberPublish, /HELPER_REPO/);
  assert.doesNotMatch(wiPublish, /HELPER_REPO/);
});
