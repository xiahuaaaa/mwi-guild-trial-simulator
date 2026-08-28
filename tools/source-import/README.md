# Source import

Verify the pinned deployment artifacts without writing recovered sources:

```sh
node guild-trial-simulator/tools/source-import/import-shykai.mjs --verify-only
```

Recover every `sourcesContent` entry into the combat-core third-party area:

```sh
node guild-trial-simulator/tools/source-import/import-shykai.mjs
```

The importer fails closed on SHA-256 drift, missing source-map content, unsafe
paths, or a changed local SoloSim snapshot. It does not copy SoloSim into the
project; SoloSim is reference-only in this phase.
