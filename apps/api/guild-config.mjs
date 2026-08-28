/** @typedef {{ slug: string, displayName: string, gameGuildName: string, gameGuildId: number, reporters: Set<string> }} RegisteredGuild */

/** @type {Readonly<{ slug: string, displayName: string, gameGuildName: string, gameGuildId: number }>} */
export const TMD_GUILD_IDENTITY = Object.freeze({
  slug: "TMD",
  displayName: "TMD",
  gameGuildName: "TMD",
  gameGuildId: 369,
});

/** @type {Readonly<{ slug: string, displayName: string, gameGuildName: string, gameGuildId: number }>} */
export const WI_GUILD_IDENTITY = Object.freeze({
  slug: "WI",
  displayName: "WI",
  gameGuildName: "Wandering ICarus",
  gameGuildId: 667,
});

/** @type {Readonly<string[]>} */
export const WI_ROSTER_REPORTERS = Object.freeze([
  "ICrazytrain",
  "adiudiu",
  "erdols",
  "ShrimpPaste",
]);

/**
 * @param {{ tmdReporters: Set<string> }} options
 * @returns {Map<string, RegisteredGuild>}
 */
export function buildGuildRegistry({ tmdReporters }) {
  return new Map([
    [
      TMD_GUILD_IDENTITY.slug,
      {
        ...TMD_GUILD_IDENTITY,
        reporters: tmdReporters,
      },
    ],
    [
      WI_GUILD_IDENTITY.slug,
      {
        ...WI_GUILD_IDENTITY,
        reporters: new Set(WI_ROSTER_REPORTERS),
      },
    ],
  ]);
}

/**
 * @param {Map<string, RegisteredGuild>} registry
 * @param {string} slug
 * @returns {RegisteredGuild | null}
 */
export function resolveRegisteredGuild(registry, slug) {
  return registry.get(slug) ?? null;
}
