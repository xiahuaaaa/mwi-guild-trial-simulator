#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(toolDirectory, "../..");
const repositoryDirectory = path.resolve(projectDirectory, "..");
const manifestPath = path.join(toolDirectory, "sources.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const execFileAsync = promisify(execFile);

const argumentsSet = new Set(process.argv.slice(2));
const verifyOnly = argumentsSet.has("--verify-only");
const outputArgumentIndex = process.argv.indexOf("--out");
const outputDirectory =
  outputArgumentIndex >= 0
    ? path.resolve(process.argv[outputArgumentIndex + 1] ?? "")
    : path.join(
        projectDirectory,
        "packages/combat-core/third_party/shykai/recovered",
      );

const artifactReports = [];
for (const artifact of manifest.shykai.artifacts) {
  const url =
    artifact.url ??
    new URL(artifact.file, manifest.shykai.deploymentBaseUrl).toString();
  const bytes = new Uint8Array(await fetchRequired(url));
  const actualHash = sha256(bytes);
  if (actualHash !== artifact.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${artifact.file}: expected ${artifact.sha256}, got ${actualHash}`,
    );
  }

  const report = {
    file: artifact.file,
    url,
    sha256: actualHash,
    sourcesRecovered: 0,
    sourceModulesVerified: 0,
  };
  let sourceMap = null;
  let sourceContentByPath = null;
  if (artifact.file.endsWith(".map")) {
    sourceMap = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !Array.isArray(sourceMap.sources) ||
      !Array.isArray(sourceMap.sourcesContent) ||
      sourceMap.sources.length !== sourceMap.sourcesContent.length
    ) {
      throw new Error(`${artifact.file} has no complete sourcesContent`);
    }
    sourceContentByPath = new Map();
    for (let index = 0; index < sourceMap.sources.length; index += 1) {
      const sourceName = normalizeWebpackSource(sourceMap.sources[index]);
      const sourceContent = sourceMap.sourcesContent[index];
      if (sourceName !== null && typeof sourceContent === "string") {
        sourceContentByPath.set(sourceName, sourceContent);
      }
    }
    report.sourcesRecovered = sourceContentByPath.size;
    for (const expectedModule of artifact.sourceModules ?? []) {
      const content = sourceContentByPath.get(expectedModule.path);
      if (content === undefined) {
        throw new Error(
          `${artifact.file} is missing pinned module ${expectedModule.path}`,
        );
      }
      assertHash(
        new TextEncoder().encode(content),
        expectedModule.sha256,
        `${artifact.file}:${expectedModule.path}`,
      );
      report.sourceModulesVerified += 1;
    }
  }
  if (!verifyOnly) {
    const artifactDirectory = path.join(
      outputDirectory,
      safeSegment(artifact.file),
    );
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, artifact.file), bytes);

    if (sourceContentByPath !== null) {
      for (const [sourceName, sourceContent] of sourceContentByPath) {
        const destination = path.resolve(artifactDirectory, "sources", sourceName);
        assertInside(destination, path.resolve(artifactDirectory, "sources"));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, sourceContent, "utf8");
      }
    }
  }
  artifactReports.push(report);
}

const localSoloSim = manifest.soloSim.savedPage;
const localPagePath = path.resolve(
  repositoryDirectory,
  localSoloSim.repositoryRelativePath,
);
const localPage = await readFile(localPagePath);
assertHash(localPage, localSoloSim.sha256, "saved SoloSim Greasy Fork page");
const recoveredSoloSim = recoverCodeFromGreasyForkHtml(
  new TextDecoder().decode(localPage),
);
assertHash(
  new TextEncoder().encode(recoveredSoloSim),
  localSoloSim.recoveredCodeSha256,
  "recovered SoloSim code",
);

const soloSimInstallBytes = new Uint8Array(
  await fetchRequired(manifest.soloSim.installArtifact.url),
);
assertHash(
  soloSimInstallBytes,
  manifest.soloSim.installArtifact.sha256,
  "SoloSim install artifact",
);

if (!verifyOnly) {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "provenance.json"),
    `${JSON.stringify(
      {
        importedAt: new Date().toISOString(),
        manifestSha256: sha256(await readFile(manifestPath)),
        artifacts: artifactReports,
        soloSim: {
          savedPageSha256: localSoloSim.sha256,
          recoveredCodeSha256: localSoloSim.recoveredCodeSha256,
          installArtifactSha256: manifest.soloSim.installArtifact.sha256,
          copied: false,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      mode: verifyOnly ? "verify-only" : "import",
      outputDirectory: verifyOnly ? null : outputDirectory,
      artifacts: artifactReports,
      soloSim: {
        localPageVerified: true,
        recoveredCodeVerified: true,
        installArtifactVerified: true,
        copied: false,
      },
    },
    null,
    2,
  )}\n`,
);

async function fetchRequired(url) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "mwi-guild-trial-source-import/0.1" },
    });
    if (!response.ok) {
      throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  } catch (fetchError) {
    // Node's fetch does not honor every corporate/system proxy setup. Curl is
    // the deterministic fallback used by the surrounding repository tooling.
    try {
      const { stdout } = await execFileAsync(
        "curl",
        [
          "--fail",
          "--silent",
          "--show-error",
          "--location",
          "--retry",
          "2",
          "--connect-timeout",
          "15",
          "--user-agent",
          "mwi-guild-trial-source-import/0.1",
          url,
        ],
        { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
      );
      return stdout.buffer.slice(
        stdout.byteOffset,
        stdout.byteOffset + stdout.byteLength,
      );
    } catch (curlError) {
      throw new AggregateError(
        [fetchError, curlError],
        `failed to fetch required source artifact: ${url}`,
      );
    }
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertHash(bytes, expected, name) {
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for ${name}: expected ${expected}, got ${actual}`,
    );
  }
}

function normalizeWebpackSource(sourceName) {
  if (typeof sourceName !== "string") {
    return null;
  }
  const prefix = "webpack://mwicombatsimulator/";
  let relative = sourceName.startsWith(prefix)
    ? sourceName.slice(prefix.length)
    : sourceName;
  relative = relative.replace(/^\.\//, "");
  if (relative.length === 0) {
    return null;
  }
  return relative
    .split("/")
    .map((segment) => safeSegment(segment))
    .join("/");
}

function safeSegment(segment) {
  const normalized = String(segment).replaceAll("\\", "_");
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/")
  ) {
    throw new Error(`unsafe source path segment: ${segment}`);
  }
  return normalized;
}

function assertInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing to write outside source import directory: ${candidate}`);
  }
}

function recoverCodeFromGreasyForkHtml(html) {
  const match = html.match(
    /<pre class="[^"]*lang-js[^"]*"[^>]*>([\s\S]*?)<\/pre>/,
  );
  if (match?.[1] === undefined) {
    throw new Error("saved Greasy Fork page does not contain a JS code block");
  }
  return decodeHtmlEntities(match[1]);
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_match, digits) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
