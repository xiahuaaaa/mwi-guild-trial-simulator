import assert from "node:assert/strict";
import test from "node:test";

import {
  HELPER_REPO_HTTPS,
  resolveHelperRepoCloneUrl,
} from "../../apps/qq-bot/src/github-helper-repo.ts";

test("resolveHelperRepoCloneUrl keeps HTTPS URL without token", () => {
  const previousGh = process.env.GH_TOKEN;
  const previousGithub = process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    assert.equal(
      resolveHelperRepoCloneUrl(HELPER_REPO_HTTPS),
      HELPER_REPO_HTTPS,
    );
  } finally {
    if (previousGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGh;
    if (previousGithub === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousGithub;
  }
});

test("resolveHelperRepoCloneUrl injects x-access-token when GH_TOKEN is set", () => {
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "test-token";
  try {
    const url = resolveHelperRepoCloneUrl(HELPER_REPO_HTTPS);
    assert.equal(
      url,
      "https://x-access-token:test-token@github.com/xiahuaaaa/mwi-guild-trial-helper.git",
    );
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
  }
});
