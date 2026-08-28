#!/usr/bin/env node
/**
 * Compatibility entry: always publishes TMD and WI to Greasy Fork, Gitee, and GitHub.
 * Prefer: node scripts/publish-guild-plugins.mjs --notes "..."
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const child = spawn(
  process.execPath,
  [join(dirname(fileURLToPath(import.meta.url)), "publish-guild-plugins.mjs"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
