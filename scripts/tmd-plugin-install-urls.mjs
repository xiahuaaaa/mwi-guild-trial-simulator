/** Shared TMD guild plugin install URLs for publish scripts + QQ bot. */

export const TMD_GITEE_REPO = "lxxxhhyy/TMD-guild-trial-sync";
export const TMD_GITEE_FILE = "TMD-guild-trial-sync.user.js";
export const TMD_GITEE_INSTALL_URL =
  `https://gitee.com/${TMD_GITEE_REPO}/raw/master/${TMD_GITEE_FILE}`;

export const TMD_GITHUB_DIST =
  "https://raw.githubusercontent.com/xiahuaaaa/mwi-guild-trial-helper/main/dist/mwi-guild-trial-sync.user.js";

export const TMD_GREASYFORK_SCRIPT_ID = "588902";
export const TMD_GREASYFORK_INSTALL =
  "https://update.greasyfork.org/scripts/588902/MWI%20%E5%85%AC%E4%BC%9A%E8%AF%95%E7%82%BC%E8%B5%84%E6%96%99%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B.user.js";
export const TMD_GREASYFORK_META =
  "https://update.greasyfork.org/scripts/588902/MWI%20%E5%85%AC%E4%BC%9A%E8%AF%95%E7%82%BC%E8%B5%84%E6%96%99%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B.meta.js";
export const TMD_GREASYFORK_PAGE =
  "https://greasyfork.org/zh-CN/scripts/588902-mwi-%E5%85%AC%E4%BC%9A%E8%AF%95%E7%82%BC%E8%B5%84%E6%96%99%E5%90%8C%E6%AD%A5%E5%8A%A9%E6%89%8B";
export const TMD_GREASYFORK_NAME = "MWI 公会试炼资料同步助手";
export const TMD_GREASYFORK_NAMESPACE = "https://greasyfork.org/users/1466859-adudu";

export function tmdGuildPluginInstallLinks() {
  return [
    ["油叉（Greasy Fork）", TMD_GREASYFORK_INSTALL],
    ["Gitee", TMD_GITEE_INSTALL_URL],
    ["GitHub", TMD_GITHUB_DIST],
  ];
}

/** @param {string} source */
export function replaceUserscriptDownloadUrls(source, downloadURL, updateURL = downloadURL) {
  let out = source.replace(/^\/\/ @downloadURL\s+.*\n/m, "");
  out = out.replace(/^\/\/ @updateURL\s+.*\n/m, "");
  return out.replace(
    /^(\/\/ @supportURL\s+.*\n)/m,
    `$1// @downloadURL  ${downloadURL}\n// @updateURL    ${updateURL}\n`,
  );
}

/** @param {string} source */
export function stampTmdGreasyForkName(source) {
  return source.replace(
    /^\/\/\s*@name\s+.+$/m,
    `// @name         ${TMD_GREASYFORK_NAME}`,
  );
}

/** @param {string} source */
export function buildTmdGreasyForkDistSource(source) {
  const named = stampTmdGreasyForkName(source);
  return replaceUserscriptDownloadUrls(named, TMD_GREASYFORK_INSTALL, TMD_GREASYFORK_META);
}

/** @param {string} source */
export function buildTmdGiteeDistSource(source) {
  return replaceUserscriptDownloadUrls(source, TMD_GITEE_INSTALL_URL);
}

export function assertTmdGreasyForkIdentity(source) {
  if (!source.includes("update.greasyfork.org/scripts/588902/")) {
    throw new Error(
      "userscript @downloadURL/@updateURL must point at Greasy Fork script 588902",
    );
  }
  if (!source.includes(`@namespace    ${TMD_GREASYFORK_NAMESPACE}`)) {
    throw new Error("do not change @namespace; Tampermonkey treats it as a new script");
  }
  const dist = stampTmdGreasyForkName(source);
  if (!new RegExp(`^//\\s*@name\\s+${TMD_GREASYFORK_NAME}\\s*$`, "m").test(dist)) {
    throw new Error("do not change primary @name; updates would show as Install");
  }
}
