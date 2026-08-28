/**
 * Fail-closed whitelist projector for guild combat trial WebSocket frames.
 *
 * Phase 0B scaffolding — WHITELIST_VERSION is provisional until Phase 0A schema
 * review locks the field map in GUILD_COMBAT_TRIAL_CALIBRATOR_PROTOCOL.md.
 *
 * Design:
 * - Allowlist-only projection at every object depth (no blacklist-only stripping).
 * - Unknown keys are dropped; sensitive containers (pMap, loadouts, guildCharacterMap, …)
 *   are never whitelisted.
 * - When unsure about a field, omit it here and document in PROVISIONAL_WHITELIST comments.
 */
(function exposeGuildCombatTrialPacketProjector(root) {
  "use strict";

  /** @type {"provisional-unreviewed"} */
  const WHITELIST_VERSION = "provisional-unreviewed";

  /**
   * Top-level packet types that may carry guild-combat trial signal.
   * Phase 0A may extend/rename — update this set after schema review.
   */
  const GUILD_COMBAT_PACKET_TYPES = new Set([
    "new_guild_battle",
    "guild_battle_updated",
    "guild_updated",
    "init_character_data",
  ]);

  /**
   * Keys never emitted even if accidentally added to a future whitelist draft.
   * Defense-in-depth; primary gate remains allowlist-only projection.
   */
  const FORBIDDEN_KEY = /^(?:pMap|guildCharacterMap|loadouts?|characterName|characterId|memberId|displayName|name|token|authorization|cookie|session|rawData)$/i;
  const FORBIDDEN_KEY_PATTERN = /(?:token|authorization|cookie|secret|password|credential|session|gm_)/i;

  /**
   * Provisional allowlist tree.
   * - `true` → keep finite number or non-empty string primitives only
   * - nested object → recurse with that subtree as the schema for child keys
   * - omit keys we are not confident are anonymous (Phase 0A will confirm names)
   */
  const PROVISIONAL_WHITELIST = {
    type: true,
    // Server sequence — numeric only; Phase 0A to confirm presence/semantics.
    seq: true,
    // Layer / encounter level-ish scalars (names provisional).
    level: true,
    guildTrialLevel: true,
    trialLevel: true,
    // Timing-ish scalars (names provisional).
    remainingTimeMs: true,
    activeTimeMs: true,
    elapsedTimeMs: true,
    durationMs: true,
    // init_character_data may nest guild combat battle snapshot.
    guildCombatBattle: {
      level: true,
      guildTrialLevel: true,
      trialLevel: true,
      remainingTimeMs: true,
      activeTimeMs: true,
      seq: true,
      mMap: "monsterMap",
    },
    // Monster HP map — keys are encounter indices; values are anonymous HP structs.
    mMap: "monsterMap",
  };

  const MONSTER_ENTRY_WHITELIST = {
    cHP: true,
    mHP: true,
    level: true,
  };

  const FRAME_HASH_HEX_LENGTH = 32; // 128-bit prefix of SHA-256

  function isForbiddenKey(key) {
    return FORBIDDEN_KEY.test(key) || FORBIDDEN_KEY_PATTERN.test(key);
  }

  function isPrimitiveAllowed(value) {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return value.length > 0 && value.length <= 256;
    if (typeof value === "boolean") return true;
    return false;
  }

  function projectMonsterMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const out = {};
    for (const [index, entry] of Object.entries(value)) {
      if (isForbiddenKey(index)) continue;
      const projected = projectWithSchema(entry, MONSTER_ENTRY_WHITELIST);
      if (projected && Object.keys(projected).length > 0) {
        out[index] = projected;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function projectWithSchema(value, schema) {
    if (!schema) return undefined;

    if (schema === "monsterMap") {
      return projectMonsterMap(value);
    }

    if (schema === true) {
      return isPrimitiveAllowed(value) ? value : undefined;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const out = {};
    for (const [key, childSchema] of Object.entries(schema)) {
      if (isForbiddenKey(key)) continue;
      if (!(key in value)) continue;
      const projected = childSchema === "monsterMap"
        ? projectMonsterMap(value[key])
        : projectWithSchema(value[key], childSchema);
      if (projected !== undefined) {
        out[key] = projected;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function parseRawOrParsed(rawOrParsed) {
    if (typeof rawOrParsed === "string") {
      const trimmed = rawOrParsed.trim();
      if (!trimmed) return null;
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    if (rawOrParsed && typeof rawOrParsed === "object") {
      return rawOrParsed;
    }
    return null;
  }

  function isGuildCombatRelevant(parsed) {
    const type = typeof parsed.type === "string" ? parsed.type : "";
    if (GUILD_COMBAT_PACKET_TYPES.has(type)) return true;
    if (parsed.guildCombatBattle && typeof parsed.guildCombatBattle === "object") return true;
    if (type === "guild_battle_updated" || type === "new_guild_battle") return true;
    return false;
  }

  function hasMeaningfulProjection(projected) {
    if (!projected || typeof projected !== "object") return false;
    const keys = Object.keys(projected);
    if (keys.length === 0) return false;
    if (keys.length === 1 && keys[0] === "type") return false;
    return true;
  }

  /**
   * Whitelist-project a guild combat WS packet. Returns null when input is empty,
   * irrelevant, or projects to nothing useful.
   *
   * @param {string|object} rawOrParsed
   * @returns {object|null}
   */
  function projectGuildCombatPacket(rawOrParsed) {
    const parsed = parseRawOrParsed(rawOrParsed);
    if (!parsed) return null;
    if (!isGuildCombatRelevant(parsed)) return null;

    const projected = projectWithSchema(parsed, PROVISIONAL_WHITELIST);
    if (!projected || !hasMeaningfulProjection(projected)) return null;

    return {
      ...projected,
      _projectorMeta: {
        whitelistVersion: WHITELIST_VERSION,
      },
    };
  }

  // --- synchronous SHA-256 (128-bit hex prefix) ---

  function sha256Bytes(message) {
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const bytes = typeof message === "string"
      ? new TextEncoder().encode(message)
      : message;
    const bitLen = bytes.length * 8;
    const withPadding = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    withPadding.set(bytes);
    withPadding[bytes.length] = 0x80;
    const view = new DataView(withPadding.buffer);
    view.setUint32(withPadding.length - 4, bitLen, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);
    for (let offset = 0; offset < withPadding.length; offset += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = view.getUint32(offset + i * 4, false);
      }
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, h0, false);
    outView.setUint32(4, h1, false);
    outView.setUint32(8, h2, false);
    outView.setUint32(12, h3, false);
    outView.setUint32(16, h4, false);
    outView.setUint32(20, h5, false);
    outView.setUint32(24, h6, false);
    outView.setUint32(28, h7, false);
    return out;
  }

  function rotr(value, shift) {
    return (value >>> shift) | (value << (32 - shift));
  }

  function bytesToHex(bytes, length) {
    let hex = "";
    for (let i = 0; i < length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  }

  function hashWithNodeCrypto(rawString) {
    try {
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      const { createHash } = require("node:crypto");
      return createHash("sha256").update(rawString, "utf8").digest("hex").slice(0, FRAME_HASH_HEX_LENGTH);
    } catch {
      return null;
    }
  }

  /**
   * Synchronous stable 128-bit hash prefix for dedupe keys (not a security MAC).
   *
   * @param {string} rawString
   * @returns {string}
   */
  function hashRawFrame(rawString) {
    if (typeof rawString !== "string") {
      throw new TypeError("hashRawFrame expects a string");
    }
    const nodeHash = hashWithNodeCrypto(rawString);
    if (nodeHash) return nodeHash;
    return bytesToHex(sha256Bytes(rawString), 16);
  }

  const api = Object.freeze({
    WHITELIST_VERSION,
    GUILD_COMBAT_PACKET_TYPES: Object.freeze([...GUILD_COMBAT_PACKET_TYPES]),
    projectGuildCombatPacket,
    hashRawFrame,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.MwiGuildCombatTrialPacketProjector = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
