import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import { validateMonsterFixture } from "./runtime.mjs";

export class ContractValidationError extends Error {
  constructor(filePath, errors) {
    super(
      `Invalid monster fixture ${filePath}:\n${errors
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`
    );
    this.name = "ContractValidationError";
    this.filePath = filePath;
    this.errors = errors;
  }
}

function parseAndValidate(text, filePath) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ContractValidationError(filePath, [
      { path: "$", message: `must be valid JSON (${error.message})` }
    ]);
  }

  const result = validateMonsterFixture(value);
  if (!result.ok) {
    throw new ContractValidationError(filePath, result.errors);
  }
  return result.value;
}

export async function loadMonsterFixture(filePath) {
  const text = await readFile(filePath, "utf8");
  return parseAndValidate(text, filePath);
}

export function loadMonsterFixtureSync(filePath) {
  const text = readFileSync(filePath, "utf8");
  return parseAndValidate(text, filePath);
}
