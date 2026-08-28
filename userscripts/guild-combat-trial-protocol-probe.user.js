// ==UserScript==
// @name         MWI Guild Combat Trial Protocol Probe (Phase 0A)
// @namespace    https://github.com/xiahuaaaa/mwi-guild-trial-helper/guild-combat-trial-calibrator
// @version      0.1.0
// @description  Phase 0A ONLY — temporary memory-only WS schema discovery for guild combat trial calibrator. Delete after protocol freeze.
// @author       adudu
// @license      MIT
// @match        https://*.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @run-at       document-start
// ==/UserScript==
/*
 * PHASE 0A TEMPORARY PROBE — NOT the formal calibrator.
 *
 * Purpose: discover guild combat WebSocket event shapes in page memory only.
 * Delete this file after GUILD_COMBAT_TRIAL_CALIBRATOR_PROTOCOL.md is frozen.
 *
 * Privacy:
 * - No fetch / XHR / GM_xmlhttpRequest / WebSocket.send
 * - No raw frame write to disk, localStorage, GM storage, or postMessage
 * - No pMap value dumps; pMap reported as boolean + keyCount only
 * - Skips keys matching /token|cookie|password|authorization|characterId|name/i
 *
 * Console API:
 *   window.__MWI_GUILD_COMBAT_PROTOCOL_PROBE__.exportSchemaSummary()
 */
(function mwiGuildCombatProtocolProbe() {
  "use strict";

  const PROBE_FLAG = "__MWI_GUILD_COMBAT_PROTOCOL_PROBE__";
  const OBSERVER_FLAG = "__MWI_GUILD_COMBAT_PROTOCOL_PROBE_MESSAGE_OBSERVER__";
  const PROBE_VERSION = "0.1.0";
  const MAX_DEPTH = 6;
  const DEDUPE_WINDOW_MS = 500;

  const GUILD_COMBAT_MARKERS = Object.freeze([
    "guildCombatBattle",
    "new_guild_battle",
    "guild_battle_updated",
    "guild_updated",
  ]);

  const SENSITIVE_KEY_RE = /token|cookie|password|authorization|characterId|name/i;
  const HP_LIKE_KEY_RE = /^(cHP|mHP|currentHp|maxHp|remainingHp|hp|hitpoints?)$/i;
  const TOKENISH_STRING_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[A-Za-z0-9+/]{20,}={0,2}|[A-Za-z0-9_-]{24,})$/;
  const NAMEISH_STRING_RE = /^[A-Za-z][A-Za-z0-9 _.'-]{2,}$/;

  const MWI_GAME_WS_RE = /api(?:-test)?\.milkywayidle(?:cn)?\.com\/ws(?:\?|$|\/)/i;

  function isMwiGameWsUrl(url) {
    return typeof url === "string" && MWI_GAME_WS_RE.test(url);
  }

  function includesGuildCombatMarker(raw) {
    if (typeof raw !== "string") return false;
    for (let index = 0; index < GUILD_COMBAT_MARKERS.length; index += 1) {
      if (raw.includes(GUILD_COMBAT_MARKERS[index])) return true;
    }
    return false;
  }

  function stableHash(raw) {
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index += 1) {
      hash ^= raw.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function isSafeEnumString(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= 64
      && /^[a-z][a-z0-9_]*$/i.test(value)
      && !TOKENISH_STRING_RE.test(value)
      && !NAMEISH_STRING_RE.test(value);
  }

  function redactString(value) {
    if (typeof value !== "string") return "<non-string>";
    if (TOKENISH_STRING_RE.test(value)) return "<redacted-token>";
    if (NAMEISH_STRING_RE.test(value) && !value.startsWith("/")) return "<redacted-string>";
    if (value.includes("@")) return "<redacted-string>";
    if (isSafeEnumString(value)) return value;
    return "<redacted-string>";
  }

  function createSchemaState() {
    return {
      phase: "0A",
      probeVersion: PROBE_VERSION,
      startedAt: new Date().toISOString(),
      framesSeen: 0,
      dedupedFrames: 0,
      eventTypes: Object.create(null),
      hpLikeNumberObservations: {
        count: 0,
        pathHints: new Set(),
      },
      pMapPresence: {
        seen: false,
        keyCounts: new Set(),
      },
      topLevelKeys: new Set(),
      notes: "Phase 0A memory-only schema discovery. Delete probe after protocol freeze.",
    };
  }

  function ensureEventBucket(state, eventType) {
    if (!state.eventTypes[eventType]) {
      state.eventTypes[eventType] = {
        count: 0,
        topLevelKeys: new Set(),
        paths: Object.create(null),
        arrayLengths: Object.create(null),
      };
    }
    return state.eventTypes[eventType];
  }

  function recordPath(bucket, path, value, parentKey) {
    if (!path) return;
    if (parentKey && SENSITIVE_KEY_RE.test(parentKey)) return;

    let entry = bucket.paths[path];
    if (!entry) {
      entry = bucket.paths[path] = {
        types: new Set(),
        examples: new Set(),
      };
    }

    if (value === null) {
      entry.types.add("null");
      return;
    }

    const valueType = Array.isArray(value) ? "array" : typeof value;
    entry.types.add(valueType);

    if (valueType === "number" && Number.isFinite(value)) {
      if (parentKey && HP_LIKE_KEY_RE.test(parentKey)) {
        return;
      }
      entry.examples.add(value);
      return;
    }

    if (valueType === "boolean") {
      entry.examples.add(value);
      return;
    }

    if (valueType === "string" && isSafeEnumString(value)) {
      entry.examples.add(value);
    }
  }

  function walkValue(state, bucket, value, path, depth, parentKey) {
    if (depth > MAX_DEPTH) return;
    if (parentKey && SENSITIVE_KEY_RE.test(parentKey)) return;

    if (value === null || value === undefined) {
      recordPath(bucket, path, value, parentKey);
      return;
    }

    if (Array.isArray(value)) {
      recordPath(bucket, path, value, parentKey);
      if (path) {
        const lengths = bucket.arrayLengths[path] || (bucket.arrayLengths[path] = new Set());
        lengths.add(value.length);
      }
      for (let index = 0; index < Math.min(value.length, 12); index += 1) {
        walkValue(state, bucket, value[index], `${path}[${index}]`, depth + 1, String(index));
      }
      return;
    }

    if (typeof value !== "object") {
      recordPath(bucket, path, value, parentKey);
      if (typeof value === "number" && parentKey && HP_LIKE_KEY_RE.test(parentKey)) {
        state.hpLikeNumberObservations.count += 1;
        if (path) state.hpLikeNumberObservations.pathHints.add(path);
      }
      return;
    }

    recordPath(bucket, path, value, parentKey);

    if (parentKey === "pMap" || path.endsWith(".pMap") || path === "pMap") {
      state.pMapPresence.seen = true;
      const keyCount = typeof value.size === "number"
        ? value.size
        : Object.keys(value).length;
      state.pMapPresence.keyCounts.add(keyCount);
      return;
    }

    const keys = Object.keys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (SENSITIVE_KEY_RE.test(key)) continue;
      const childPath = path ? `${path}.${key}` : key;
      walkValue(state, bucket, value[key], childPath, depth + 1, key);
    }
  }

  function detectEventTypes(packet) {
    const types = [];
    if (!packet || typeof packet !== "object") return types;

    const topType = typeof packet.type === "string" ? packet.type : null;
    if (topType) types.push(topType);

    if (topType === "init_character_data" && packet.guildCombatBattle != null) {
      types.push("init_character_data.guildCombatBattle");
    }

    for (let index = 0; index < GUILD_COMBAT_MARKERS.length; index += 1) {
      const marker = GUILD_COMBAT_MARKERS[index];
      if (marker === "guildCombatBattle") continue;
      if (packet[marker] != null || topType === marker) {
        if (!types.includes(marker)) types.push(marker);
      }
    }

    return types.length ? types : ["<unknown-envelope>"];
  }

  function ingestPacket(state, dedupeMap, raw) {
    if (!includesGuildCombatMarker(raw)) return;

    const now = Date.now();
    const hash = stableHash(raw);
    const lastSeen = dedupeMap.get(hash);
    if (lastSeen != null && now - lastSeen < DEDUPE_WINDOW_MS) {
      state.dedupedFrames += 1;
      return;
    }
    dedupeMap.set(hash, now);

    let packet;
    try {
      packet = JSON.parse(raw);
    } catch {
      return;
    }

    state.framesSeen += 1;
    const topKeys = Object.keys(packet);
    for (let index = 0; index < topKeys.length; index += 1) {
      state.topLevelKeys.add(topKeys[index]);
    }

    const eventTypes = detectEventTypes(packet);
    for (let index = 0; index < eventTypes.length; index += 1) {
      const eventType = eventTypes[index];
      const bucket = ensureEventBucket(state, eventType);
      bucket.count += 1;
      for (let keyIndex = 0; keyIndex < topKeys.length; keyIndex += 1) {
        const key = topKeys[keyIndex];
        bucket.topLevelKeys.add(key);
        if (SENSITIVE_KEY_RE.test(key)) continue;
        walkValue(state, bucket, packet[key], key, 1, key);
      }
    }
  }

  function pruneDedupeMap(dedupeMap, now) {
    for (const [hash, seenAt] of dedupeMap.entries()) {
      if (now - seenAt > DEDUPE_WINDOW_MS * 4) dedupeMap.delete(hash);
    }
  }

  function serializeSchemaSummary(state) {
    const eventTypes = Object.create(null);
    for (const [eventType, bucket] of Object.entries(state.eventTypes)) {
      const paths = Object.create(null);
      for (const [path, entry] of Object.entries(bucket.paths)) {
        const examples = [...entry.examples]
          .slice(0, 5)
          .map((example) => (typeof example === "string" ? redactString(example) : example));
        paths[path] = {
          types: [...entry.types].sort(),
          examples,
        };
      }

      const arrayLengths = Object.create(null);
      for (const [path, lengths] of Object.entries(bucket.arrayLengths)) {
        arrayLengths[path] = [...lengths].sort((left, right) => left - right).slice(0, 8);
      }

      eventTypes[eventType] = {
        count: bucket.count,
        topLevelKeys: [...bucket.topLevelKeys].sort(),
        paths,
        arrayLengths,
      };
    }

    return {
      phase: state.phase,
      probeVersion: state.probeVersion,
      startedAt: state.startedAt,
      exportedAt: new Date().toISOString(),
      framesSeen: state.framesSeen,
      dedupedFrames: state.dedupedFrames,
      topLevelKeys: [...state.topLevelKeys].sort(),
      eventTypes,
      hpLikeNumberObservations: {
        count: state.hpLikeNumberObservations.count,
        pathHints: [...state.hpLikeNumberObservations.pathHints].sort(),
      },
      pMapPresence: {
        seen: state.pMapPresence.seen,
        keyCounts: [...state.pMapPresence.keyCounts].sort((left, right) => left - right),
      },
      whitelistVersion: "draft-0",
      notes: state.notes,
    };
  }

  function installProbe(page) {
    if (!page || page[PROBE_FLAG]) return page[PROBE_FLAG];

    const state = createSchemaState();
    const dedupeMap = new Map();
    const seenEvents = new WeakSet();

    function handleRaw(raw) {
      ingestPacket(state, dedupeMap, raw);
      pruneDedupeMap(dedupeMap, Date.now());
    }

    function installMessageEventHook() {
      if (page[OBSERVER_FLAG]) return;
      const prototype = page.MessageEvent?.prototype;
      const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "data");
      if (!descriptor?.get || descriptor.configurable === false) return;

      const originalGet = descriptor.get;
      Object.defineProperty(prototype, "data", {
        ...descriptor,
        get() {
          const message = originalGet.call(this);
          if (typeof message === "string" && !seenEvents.has(this) && includesGuildCombatMarker(message)) {
            seenEvents.add(this);
            queueMicrotask(() => {
              try { handleRaw(message); } catch { /* schema-only probe */ }
            });
          }
          return message;
        },
      });
      page[OBSERVER_FLAG] = true;
    }

    function installWebSocketListener() {
      const NativeWebSocket = page.WebSocket;
      if (typeof NativeWebSocket !== "function" || NativeWebSocket.__MWI_GUILD_COMBAT_PROTOCOL_PROBE_PATCHED__) {
        return;
      }

      class ProbeObservedWebSocket extends NativeWebSocket {
        constructor(url, protocols) {
          super(url, protocols);
          if (!isMwiGameWsUrl(this.url || String(url || ""))) return;
          this.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            try { handleRaw(event.data); } catch { /* schema-only probe */ }
          });
        }
      }

      ProbeObservedWebSocket.__MWI_GUILD_COMBAT_PROTOCOL_PROBE_PATCHED__ = true;
      page.WebSocket = ProbeObservedWebSocket;
    }

    function exportSchemaSummary() {
      return serializeSchemaSummary(state);
    }

    function resetSchemaSummary() {
      const next = createSchemaState();
      Object.assign(state, next);
      dedupeMap.clear();
      return exportSchemaSummary();
    }

    function installUi() {
      if (page.document?.getElementById("mwi-guild-combat-protocol-probe")) return;

      const mount = () => {
        if (!page.document?.body || page.document.getElementById("mwi-guild-combat-protocol-probe")) return;
        const button = page.document.createElement("button");
        button.id = "mwi-guild-combat-protocol-probe";
        button.type = "button";
        button.textContent = "Export guild combat schema (0A)";
        button.title = "Copies anonymized in-memory schema summary to clipboard";
        Object.assign(button.style, {
          position: "fixed",
          right: "12px",
          bottom: "72px",
          zIndex: "2147483000",
          padding: "8px 10px",
          borderRadius: "8px",
          border: "1px solid #355f9f",
          background: "#10233f",
          color: "#e7f1ff",
          font: "12px/1.2 system-ui, sans-serif",
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
        });
        button.addEventListener("click", async () => {
          const summary = exportSchemaSummary();
          const text = JSON.stringify(summary, null, 2);
          try {
            await page.navigator.clipboard.writeText(text);
            button.textContent = "Schema copied (0A)";
          } catch {
            button.textContent = "See console exportSchemaSummary()";
          }
          console.info("[MWI Guild Combat Protocol Probe] schema summary ready", summary);
        });
        page.document.body.appendChild(button);
      };

      if (page.document?.readyState === "loading") {
        page.document.addEventListener("DOMContentLoaded", mount, { once: true });
      } else {
        mount();
      }
    }

    installMessageEventHook();
    installWebSocketListener();
    installUi();

    const api = Object.freeze({
      version: PROBE_VERSION,
      exportSchemaSummary,
      resetSchemaSummary,
      getStats() {
        return {
          framesSeen: state.framesSeen,
          dedupedFrames: state.dedupedFrames,
          eventTypeCount: Object.keys(state.eventTypes).length,
        };
      },
    });

    page[PROBE_FLAG] = api;
    return api;
  }

  function installInPageContext() {
    const page = window;
    if (page[PROBE_FLAG]) return page[PROBE_FLAG];

    const source = `(${installProbe.toString()})(window);`;
    const script = document.createElement("script");
    script.textContent = source;
    (document.documentElement || document.head || document).appendChild(script);
    script.remove();
    return page[PROBE_FLAG];
  }

  if (typeof window === "object") {
    try {
      installProbe(window);
    } catch {
      installInPageContext();
    }
    if (!window[PROBE_FLAG]) installInPageContext();
  }
})();
