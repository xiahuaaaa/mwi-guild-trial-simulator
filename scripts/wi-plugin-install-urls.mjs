/** Shared WI guild plugin install URLs for publish scripts + QQ bot. */

export const WI_GITEE_REPO = "lxxxhhyy/WI-guild-trial-sync";
export const WI_GITEE_FILE = "WI-guild-trial-sync.user.js";
export const WI_GITEE_INSTALL_URL =
  `https://gitee.com/${WI_GITEE_REPO}/raw/master/${WI_GITEE_FILE}`;

export const WI_GITHUB_DIST =
  "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/dist/wi-guild-trial-sync.user.js";

export const WI_GREASYFORK_SCRIPT_ID_DEFAULT = "593342";
export const WI_GREASYFORK_SCRIPT_SLUG = "WI-guild-trial-sync";
export const WI_GREASYFORK_SYNC_SOURCE = WI_GITHUB_DIST;

export function wiGreasyForkInstallUrl(scriptId) {
  return `https://update.greasyfork.org/scripts/${scriptId}/${WI_GREASYFORK_SCRIPT_SLUG}.user.js`;
}

export function wiGreasyForkMetaUrl(scriptId) {
  return `https://update.greasyfork.org/scripts/${scriptId}/${WI_GREASYFORK_SCRIPT_SLUG}.meta.js`;
}

export function wiGreasyForkPageUrl(scriptId) {
  return `https://greasyfork.org/zh-CN/scripts/${scriptId}-wi-guild-trial-sync`;
}

export function wiGuildPluginInstallLinks(scriptId) {
  return [
    ["油叉（Greasy Fork）", wiGreasyForkInstallUrl(scriptId)],
    ["Gitee", WI_GITEE_INSTALL_URL],
    ["GitHub", WI_GITHUB_DIST],
  ];
}

export function resolveWiGreasyForkScriptId(envValue, fileValue) {
  const fromEnv = String(envValue ?? "").trim();
  if (fromEnv) return fromEnv;
  const fromFile = String(fileValue ?? "").trim();
  if (fromFile) return fromFile;
  return WI_GREASYFORK_SCRIPT_ID_DEFAULT;
}

/** @param {string} source @param {string} scriptId */
export function stampWiGreasyForkInstallUrls(source, scriptId) {
  const installUrl = wiGreasyForkInstallUrl(scriptId);
  const metaUrl = wiGreasyForkMetaUrl(scriptId);
  let out = source.replace(/^\/\/ @downloadURL\s+.*\n/m, "");
  out = out.replace(/^\/\/ @updateURL\s+.*\n/m, "");
  return out.replace(
    /^(\/\/ @supportURL\s+.*\n)/m,
    `$1// @downloadURL  ${installUrl}\n// @updateURL    ${metaUrl}\n`,
  );
}

/** @param {string} source */
export function stampWiGiteeInstallUrls(source) {
  let out = source.replace(/^\/\/ @downloadURL\s+.*\n/m, "");
  out = out.replace(/^\/\/ @updateURL\s+.*\n/m, "");
  return out.replace(
    /^(\/\/ @supportURL\s+.*\n)/m,
    `$1// @downloadURL  ${WI_GITEE_INSTALL_URL}\n// @updateURL    ${WI_GITEE_INSTALL_URL}\n`,
  );
}

/** @param {string} source @param {string} version */
export function stampWiGithubInstallUrls(source, version) {
  const cacheBust = encodeURIComponent(version);
  const installUrl = `${WI_GITHUB_DIST}?v=${cacheBust}`;
  let out = source.replace(/^\/\/ @downloadURL\s+.*\n/m, "");
  out = out.replace(/^\/\/ @updateURL\s+.*\n/m, "");
  return out.replace(
    /^(\/\/ @supportURL\s+.*\n)/m,
    `$1// @downloadURL  ${installUrl}\n// @updateURL    ${installUrl}\n`,
  );
}

/** @param {string} source @param {string} scriptId */
export function buildWiGreasyForkDistSource(source, scriptId) {
  return stampWiGreasyForkInstallUrls(source, scriptId);
}

/** @param {string} source */
export function buildWiGiteeDistSource(source) {
  return stampWiGiteeInstallUrls(source);
}
