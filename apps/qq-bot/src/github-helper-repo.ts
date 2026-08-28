export const HELPER_REPO_HTTPS =
  "https://github.com/xiahuaaaa/mwi-guild-trial-helper.git";

/** Clone/push URL with token when GH_TOKEN/GITHUB_TOKEN is set (LaunchAgent-safe). */
export function resolveHelperRepoCloneUrl(
  repoUrl = HELPER_REPO_HTTPS,
): string {
  const token = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (!token) return repoUrl;
  const url = new URL(repoUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}
