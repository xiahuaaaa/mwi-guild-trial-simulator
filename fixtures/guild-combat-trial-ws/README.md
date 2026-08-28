# Guild combat trial WebSocket fixtures

**Status:** scaffolding only — no frozen frames yet.

This directory will hold **desensitized, whitelisted** WebSocket projections for guild combat trial calibration replay tests. It does **not** store raw WebSocket text.

## Phase gate

1. **Phase 0A** — Run `userscripts/guild-combat-trial-protocol-probe.user.js` in memory on a live trial; review `exportSchemaSummary()` output; lock fail-closed whitelist.
2. **Phase 0B** — Capture with the approved whitelist-only assistant; desensitize; human review.
3. **Freeze** — Update `manifest.json`, `docs/GUILD_COMBAT_TRIAL_CALIBRATOR_PROTOCOL.md`, then enable Core replay tests.

Do not add invented or synthetic “real capture” fixtures before Phase 0B review.

## Minimum sample set (A–D)

| Tag | Scenario | Used for |
|-----|----------|----------|
| **A** | Full trial from Lv.100 to end, no page refresh | `verified` start, layer timing, `endReason`, `calibrationDps` |
| **B** | Refresh or disconnect mid-trial | Persistence recovery, `observationGapMs`, non-auto verified |
| **C** | Plugin installed mid-trial or in-progress `init_character_data` | Sequence C → `trialStartProvenance: weak` |
| **D** | At least one dual-monster layer (prefer trial badger) | Multi-`mMap` fixture; if unavailable, protocol marks `enemiesPerEncounter: unknown` |

## Desensitization rules

Each frame file under `frames/` must:

- Contain **only** whitelisted fields confirmed in `GUILD_COMBAT_TRIAL_CALIBRATOR_PROTOCOL.md`
- Exclude character names, IDs, tokens, cookies, `pMap` slot contents, and full WS payloads
- Use anonymous numeric/boolean/enum examples only
- Be reviewed before merge to `main`

## Layout

```text
fixtures/guild-combat-trial-ws/
├── README.md           # this file
├── manifest.json         # protocolVersion, sample tags, frame index
└── frames/               # created in Phase 0B (empty until then)
    └── *.json
```

## manifest.json

Tracks `protocolVersion`, `whitelistVersion`, per-sample status (`missing` | `captured` | `reviewed`), and the `frames` array with tags and file paths.
