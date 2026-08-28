#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const recoveredDirectory = path.join(
  projectDirectory,
  "packages/combat-core/third_party/shykai/recovered",
);
const sourceMapPath = path.join(
  recoveredDirectory,
  "src_worker_js.bundle.js.map/src_worker_js.bundle.js.map",
);
const outputDirectory = path.join(
  projectDirectory,
  "packages/shykai-full-runtime/generated",
);
const bundleUrl =
  "https://shykai.github.io/MWICombatSimulatorTest/dist/src_worker_js.bundle.js";

const sourceMap = JSON.parse(await readFile(sourceMapPath, "utf8"));
const bundle = await fetchText(bundleUrl);
const generated = [];

for (let index = 0; index < sourceMap.sources.length; index += 1) {
  const sourceName = normalizeSourceName(sourceMap.sources[index]);
  const sourceContent = sourceMap.sourcesContent[index];
  if (!sourceName || typeof sourceContent !== "string") continue;
  const destination = path.join(outputDirectory, sourceName);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, rewriteImports(sourceContent), "utf8");
  generated.push(sourceName);
}

const jsonModulePattern =
  /\/\*\*\*\/ "(\.\/src\/combatsimulator\/data\/[^"]+\.json)":([\s\S]*?)(?=\/\*\*\*\/ "(?:\.\/|webpack\/runtime))/g;
for (const match of bundle.matchAll(jsonModulePattern)) {
  const moduleName = match[1];
  const literalMatch = match[2].match(
    /module\.exports = \/\*#__PURE__\*\/JSON\.parse\(('(?:\\.|[^'\\])*')\);/,
  );
  if (!literalMatch) {
    throw new Error(`Could not extract JSON module ${moduleName}`);
  }
  const jsonText = Function(`"use strict"; return ${literalMatch[1]};`)();
  const data = JSON.parse(jsonText);
  const destination = path.join(
    outputDirectory,
    moduleName.replace(/^\.\//, "") + ".js",
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(
    destination,
    `const data = ${JSON.stringify(data)};\nexport default data;\n`,
    "utf8",
  );
  generated.push(moduleName.replace(/^\.\//, "") + ".js");
}

const heapPath = path.join(
  outputDirectory,
  "src/combatsimulator/heap.js",
);
await writeFile(
  heapPath,
  `export default class Heap {
  constructor(compare) { this.compare = compare; this.values = []; }
  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(values[parent], value) <= 0) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }
  pop() {
    const values = this.values;
    if (values.length === 0) return undefined;
    const first = values[0];
    const last = values.pop();
    if (values.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= values.length) break;
        const right = left + 1;
        const child = right < values.length &&
          this.compare(values[right], values[left]) < 0 ? right : left;
        if (this.compare(values[child], last) >= 0) break;
        values[index] = values[child];
        index = child;
      }
      values[index] = last;
    }
    return first;
  }
  toArray() { return [...this.values]; }
  remove(value) {
    const index = this.values.indexOf(value);
    if (index < 0) return false;
    const last = this.values.pop();
    if (index < this.values.length) {
      this.values[index] = last;
      const copy = [...this.values];
      this.values = [];
      for (const entry of copy) this.push(entry);
    }
    return true;
  }
}
`,
  "utf8",
);
generated.push("src/combatsimulator/heap.js");

process.stdout.write(
  `${JSON.stringify(
    { ok: true, outputDirectory, filesGenerated: generated.length },
    null,
    2,
  )}\n`,
);

function normalizeSourceName(input) {
  const marker = "/./";
  const index = input.indexOf(marker);
  return index >= 0 ? input.slice(index + marker.length) : null;
}

function rewriteImports(source) {
  let rewritten = source
    .replace(
      /from "(\.[^"]+\.json)"/g,
      'from "$1.js"',
    )
    .replace(
      /from "(\.[^"]+?)(?<!\.js)"/g,
      'from "$1.js"',
    )
    .replace(
      'import Heap from "heap-js";',
      'import Heap from "../heap.js";',
    );
  if (source.includes("class CombatSimulator extends EventTarget")) {
    rewritten = rewritten
      .replace(
        "this.enableHpMpVisualization = options.enableHpMpVisualization || false;",
        `this.enableHpMpVisualization = options.enableHpMpVisualization || false;
        this.enemyRespawnInterval = options.enemyRespawnInterval ?? ENEMY_RESPAWN_INTERVAL;
        this.passiveRegenMultiplier = options.passiveRegenMultiplier ?? 1;
        this.passiveRegenFlatBonus = options.passiveRegenFlatBonus ?? 0;
        this.maxParryAttempts = options.maxParryAttempts ?? 1;`,
      )
      .replace(
        /let nextEvent = this\.eventQueue\.getNextEvent\(\);\r?\n\s+await this\.processEvent\(nextEvent\);/,
        `let nextEvent = this.eventQueue.getNextEvent();
            if (!nextEvent || nextEvent.time > simulationTimeLimit) {
                this.simulationTime = simulationTimeLimit;
                break;
            }
            await this.processEvent(nextEvent);`,
      )
      .replace(
        "new EnemyRespawnEvent(this.simulationTime + ENEMY_RESPAWN_INTERVAL)",
        "new EnemyRespawnEvent(this.simulationTime + this.enemyRespawnInterval)",
      )
      .replace(
        /let enemyRespawnEvent = new EnemyRespawnEvent\(this\.simulationTime \+ this\.enemyRespawnInterval\);\r?\n\s*this\.eventQueue\.addEvent\(enemyRespawnEvent\);/,
        `let trialComplete = this.zone?.isComplete?.() ?? false;
            if (!trialComplete) {
                let enemyRespawnEvent = new EnemyRespawnEvent(this.simulationTime + this.enemyRespawnInterval);
                this.eventQueue.addEvent(enemyRespawnEvent);
            }`,
      )
      .replace(
        "this.simResult.lastEncounterFinishTime = this.simulationTime;",
        `this.simResult.lastEncounterFinishTime = this.simulationTime;
            if (trialComplete) {
                this.eventQueue.clear();
            }`,
      )
      .replace(
        /let randomIndex = Math\.floor\(Math\.random\(\) \* parryUnits\.length\);\r?\n\s*if \(parryUnits\[randomIndex\]\.combatDetails\.combatStats\.parry > Math\.random\(\)\) \{\r?\n\s*return parryUnits\[randomIndex\];\r?\n\s*\}/,
        `const attempts = Math.min(this.maxParryAttempts, parryUnits.length);
        for (let attempt = 0; attempt < attempts; attempt++) {
            const randomIndex = Math.floor(Math.random() * parryUnits.length);
            const [parryUnit] = parryUnits.splice(randomIndex, 1);
            if (parryUnit.combatDetails.combatStats.parry > Math.random()) {
                return parryUnit;
            }
        }`,
      )
      .replace(
        "Math.floor(unit.combatDetails.maxHitpoints * unit.combatDetails.combatStats.hpRegenPer10)",
        "Math.floor(unit.combatDetails.maxHitpoints * (unit.combatDetails.combatStats.hpRegenPer10 * this.passiveRegenMultiplier + this.passiveRegenFlatBonus))",
      )
      .replace(
        "Math.floor(unit.combatDetails.maxManapoints * (unit.combatDetails.combatStats.mpRegenPer10 * this.passiveRegenMultiplier + this.passiveRegenFlatBonus))",
      )
      .replace(
        'console.log("Fury Timeout");',
        "// Upstream debug log intentionally suppressed in batch simulations.",
      );
  }
  return rewritten;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "mwi-guild-trial-runtime-materializer/0.1" },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  return response.text();
}
