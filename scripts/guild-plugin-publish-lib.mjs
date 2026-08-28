import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const HELPER_REPO = "https://github.com/xiahuaaaa/mwi-guild-trial-helper.git";
export const TMD_HELPER_DIST = "mwi-guild-trial-sync.user.js";
export const WI_HELPER_DIST = "wi-guild-trial-sync.user.js";

export function gitIdentityEnv() {
  const name =
    process.env.GIT_AUTHOR_NAME ||
    process.env.GIT_COMMITTER_NAME ||
    "xiahuaaaa";
  const email =
    process.env.GIT_AUTHOR_EMAIL ||
    process.env.GIT_COMMITTER_EMAIL ||
    "xiahuaaaa@users.noreply.github.com";
  return {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

export function run(cmd, cwd, { allowFail = false, env = process.env } = {}) {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  if (result.status !== 0 && !allowFail) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`command failed (${cmd.join(" ")}):\n${detail}`);
  }
  return result;
}

export function readUserscriptVersion(source) {
  const match = source.match(/^\/\/\s*@version\s+(\S+)/m);
  if (!match) throw new Error("missing @version in userscript header");
  return match[1];
}

export function readGiteeToken(root) {
  const fromEnv = String(process.env.GITEE_TOKEN ?? "").trim();
  if (fromEnv) return fromEnv;
  const tokenFile = join(root, ".local/gitee.token");
  if (existsSync(tokenFile)) return readFileSync(tokenFile, "utf8").trim();
  return "";
}

export async function giteeRequest(path, { method = "GET", token, body } = {}) {
  const url = new URL(`https://gitee.com/api/v5${path}`);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`Gitee API ${method} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return payload;
}

export async function pushGiteeUserscript({
  token,
  repo,
  file,
  content,
  message,
}) {
  const [owner, name] = repo.split("/");
  let sha;
  const current = await giteeRequest(
    `/repos/${owner}/${name}/contents/${encodeURIComponent(file)}`,
    { token },
  ).catch(() => null);
  if (current?.sha) sha = current.sha;
  const body = {
    content: Buffer.from(content, "utf8").toString("base64"),
    message,
    branch: "master",
  };
  if (sha) body.sha = sha;
  await giteeRequest(
    `/repos/${owner}/${name}/contents/${encodeURIComponent(file)}`,
    {
      method: sha ? "PUT" : "POST",
      token,
      body,
    },
  );
}

export async function fetchHeaderVersion(url) {
  let lastError = new Error(`failed to read ${url}`);
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const cacheBusted = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}-${attempt}`;
    try {
      const response = await fetch(cacheBusted, {
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      const text = await response.text();
      if (!text.includes("// ==UserScript==")) {
        throw new Error(`${url} did not return a userscript (got ${text.slice(0, 80).replace(/\s+/g, " ")})`);
      }
      return { version: readUserscriptVersion(text), text };
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}
