/**
 * Combat labs and QQ「公会名单」must share the public API.
 * Local 8787 sqlite has diverged (2026-09-11: missing AAshadow and others).
 */
export const DEFAULT_COMBAT_ROSTER_API_BASE = "https://api.adudu.lol";

export function resolveCombatRosterApiBase(env = process.env) {
  const configured = env.MWI_GUILD_API_BASE;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim().replace(/\/$/u, "");
  }
  return DEFAULT_COMBAT_ROSTER_API_BASE;
}

export function combatRosterApiIsLoopback(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return ["127.0.0.1", "localhost", "::1"].includes(hostname);
  } catch {
    return false;
  }
}
