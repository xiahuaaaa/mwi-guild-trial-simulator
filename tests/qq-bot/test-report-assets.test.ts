import assert from "node:assert/strict";
import test from "node:test";
import {
  isAbsentTestReportFileError,
  isAllowedTestReportFileName,
  isMissingOrStaleTestReportError,
  missingTestReportAssetsMessage,
} from "../../apps/qq-bot/src/api-client.ts";

test("allows current and legacy dual-boss report filenames", () => {
  assert.equal(isAllowedTestReportFileName("1-jellyfish-summary.png"), true);
  assert.equal(isAllowedTestReportFileName("1-jellyfish-members.png"), true);
  assert.equal(isAllowedTestReportFileName("2-hedgehog-summary.png"), true);
  assert.equal(isAllowedTestReportFileName("2-hedgehog-members.png"), true);
  assert.equal(isAllowedTestReportFileName("1-badger-summary.png"), true);
  assert.equal(isAllowedTestReportFileName("1-badger-members.png"), true);
  assert.equal(isAllowedTestReportFileName("2-hedgehog-summary.png"), true);
});

test("rejects path traversal and unexpected report filenames", () => {
  assert.equal(isAllowedTestReportFileName("../1-badger-summary.png"), false);
  assert.equal(isAllowedTestReportFileName("1-badger-summary.jpg"), false);
  assert.equal(isAllowedTestReportFileName("3-badger-summary.png"), false);
  assert.equal(isAllowedTestReportFileName("1-Badger-summary.png"), false);
  assert.equal(isAllowedTestReportFileName("1-badger-extra.png"), false);
});

test("detects missing report file errors from code or message", () => {
  assert.equal(
    isAbsentTestReportFileError(
      Object.assign(
        new Error(
          "ENOENT: no such file or directory, open 'D:\\mwi-data\\reports\\manifest.json'",
        ),
        { code: "ENOENT" },
      ),
    ),
    true,
  );
  assert.equal(
    isAbsentTestReportFileError(
      new Error(
        "ENOENT: no such file or directory, open 'D:\\mwi-data\\reports\\manifest.json'",
      ),
    ),
    true,
  );
  assert.equal(isMissingOrStaleTestReportError({ status: 404 }), true);
  assert.equal(isMissingOrStaleTestReportError({ status: 409 }), true);
  assert.match(
    missingTestReportAssetsMessage(
      "D:\\mwi-guild-server\\guild-trial-simulator\\artifacts\\test-report",
    ),
    /artifacts\\test-report/,
  );
});
