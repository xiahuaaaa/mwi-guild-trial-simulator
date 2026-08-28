import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWiGreasyForkDistSource,
  buildWiGiteeDistSource,
  stampWiGithubInstallUrls,
  wiGreasyForkInstallUrl,
  WI_GITEE_INSTALL_URL,
} from "../../scripts/wi-plugin-install-urls.mjs";

const SAMPLE = `// ==UserScript==
// @name         WI-guild-trial-sync
// @namespace    https://github.com/xiahuaaaa/mwi-guild-trial-helper/wi
// @version      0.6.20-wi.1
// @supportURL   https://github.com/xiahuaaaa/mwi-guild-trial-helper/issues
// ==/UserScript==
`;

test("WI Greasy Fork dist keeps script identity and GF install URLs", () => {
  const out = buildWiGreasyForkDistSource(SAMPLE, "593342");
  assert.match(out, /^\/\/ @name         WI-guild-trial-sync/m);
  assert.match(out, /^\/\/ @namespace    https:\/\/github\.com\/xiahuaaaa\/mwi-guild-trial-helper\/wi/m);
  assert.match(out, new RegExp(`^// @downloadURL  ${wiGreasyForkInstallUrl("593342").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"));
  assert.match(out, /\.meta\.js/m);
});

test("WI Gitee dist points @downloadURL/@updateURL at gitee raw", () => {
  const out = buildWiGiteeDistSource(SAMPLE);
  assert.match(out, new RegExp(`^// @downloadURL  ${WI_GITEE_INSTALL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"));
  assert.match(out, new RegExp(`^// @updateURL    ${WI_GITEE_INSTALL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"));
});

test("WI GitHub dist keeps cache-busted raw URL", () => {
  const out = stampWiGithubInstallUrls(SAMPLE, "0.6.20-wi.1");
  assert.match(out, /wi-guild-trial-sync\.user\.js\?v=0\.6\.20-wi\.1/m);
});
