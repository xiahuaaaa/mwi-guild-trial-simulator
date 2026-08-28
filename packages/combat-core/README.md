# Combat Core

Deterministic, scenario-neutral primitives for the MWI guild-trial simulator.

This first-stage package intentionally does **not** claim parity with the full
Shykai combat formula implementation. It provides the invariants that the
recovered upstream kernel must plug into:

- a stable, seedable random source;
- a stable priority event queue with lazy token cancellation;
- a synchronous event loop with a strict inclusive deadline;
- dynamic per-member streaming statistics;
- explicit consumable and passive-regeneration policies.

The recovered Shykai modules remain third-party material and are imported by
`tools/source-import/import-shykai.mjs`. Their provenance and hashes are
recorded alongside that tool.
