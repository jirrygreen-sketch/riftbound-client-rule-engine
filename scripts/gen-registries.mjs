#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

const REGISTRY_FILENAME = "registry.generated.ts";
const DEFAULT_ID_PROPERTIES = ["id", "op", "keyword", "canonicalCardId"];

const TARGET_DEFINITIONS = [
  {
    directory: ["packages", "engine-core", "src", "effects", "instructions"],
    kind: "instructions",
    exportNames: [
      ["instructionDefinitions", "instructionDefinitionsById"],
      ["instructionRegistry", "instructionRegistryById"]
    ]
  },
  {
    directory: ["packages", "engine-core", "src", "effects", "keywords"],
    kind: "keywords",
    exportNames: [
      ["keywordDefinitions", "keywordDefinitionsById"],
      ["keywordRegistry", "keywordRegistryById"]
    ]
  }
];

export class RegistryGenerationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RegistryGenerationError";
  }
}

function maskSource(source, { preserveStrings }) {
  const result = [...source];
  let state = "code";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") state = "code";
      else result[index] = " ";
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && nextCharacter === "/") {
        result[index] = " ";
        result[index + 1] = " ";
        index += 1;
        state = "code";
      } else if (character !== "\n") {
        result[index] = " ";
      }
      continue;
    }

    if (state === "string") {
      if (!preserveStrings) {
        if (character !== "\n") result[index] = " ";
      }
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        state = "code";
      }
      continue;
    }

    if (state === "template") {
      if (!preserveStrings && character !== "\n") result[index] = " ";
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "`") {
        state = "code";
      }
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      result[index] = " ";
      result[index + 1] = " ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && nextCharacter === "*") {
      result[index] = " ";
      result[index + 1] = " ";
      index += 1;
      state = "block-comment";
    } else if (character === "'" || character === '"') {
      quote = character;
      state = "string";
    } else if (character === "`") {
      state = "template";
    }
  }

  return result.join("");
}

function decodeStringLiteral(value, filePath) {
  const quote = value[0];
  const body = value.slice(1, -1);

  if (quote === '"') {
    try {
      return JSON.parse(value);
    } catch {
      throw new RegistryGenerationError(
        `Invalid registry id string in ${filePath}: ${value}`
      );
    }
  }

  return body.replace(/\\([\\'"`])/g, "$1").replace(/\\n/g, "\n");
}

function findPropertyValue(source, searchStart, propertyName, filePath) {
  const sourceWithoutComments = maskSource(source, { preserveStrings: true });
  const propertyPattern = new RegExp(
    `(?:\\b${propertyName}\\b|["']${propertyName}["'])\\s*:\\s*((?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'))`,
    "g"
  );
  propertyPattern.lastIndex = searchStart;
  const match = propertyPattern.exec(sourceWithoutComments);
  if (!match) return undefined;

  const value = decodeStringLiteral(match[1], filePath);
  if (value.length === 0) {
    throw new RegistryGenerationError(
      `Empty registry id in ${filePath}: ${propertyName} must be a non-empty string`
    );
  }
  return { propertyName, value };
}

function findDefaultExport(source, filePath) {
  const code = maskSource(source, { preserveStrings: false });
  const defaultExport = /\bexport\s+default\b/.exec(code);
  if (!defaultExport) {
    throw new RegistryGenerationError(
      `Missing default export in ${filePath}; each registry source file must ` +
        "export its definition as default"
    );
  }

  const expressionStart = defaultExport.index + defaultExport[0].length;
  const expression = code.slice(expressionStart);
  const identifier = /^\s*([A-Za-z_$][\w$]*)/.exec(expression)?.[1];
  if (!identifier) return expressionStart;

  const declarationPattern = new RegExp(
    `\\b(?:const|let|var)\\s+${identifier}\\s*=`
  );
  const declaration = declarationPattern.exec(code);
  return declaration?.index ?? expressionStart;
}

function extractRegistryId(source, filePath, kind) {
  const searchStart = findDefaultExport(source, filePath);
  const preferredProperties =
    kind === "instructions"
      ? ["op", ...DEFAULT_ID_PROPERTIES.filter((name) => name !== "op")]
      : kind === "cards"
        ? [
            "canonicalCardId",
            ...DEFAULT_ID_PROPERTIES.filter((name) => name !== "canonicalCardId")
          ]
        : DEFAULT_ID_PROPERTIES;

  for (const propertyName of preferredProperties) {
    const property = findPropertyValue(source, searchStart, propertyName, filePath);
    if (property) return property;
  }

  throw new RegistryGenerationError(
    `Missing registry id in ${filePath}; the default export must contain a ` +
      `static string property named ${preferredProperties.join(", ")}`
  );
}

function toImportPath(filePath, directory) {
  const relativePath = path.relative(directory, filePath).split(path.sep).join("/");
  return `./${relativePath.slice(0, -3)}.js`;
}

function registryVariableNames(kind) {
  if (kind === "cards") {
    return [
      ["cardPrograms", "cardProgramsById"],
      ["cardRegistry", "cardRegistryById"]
    ];
  }
  return TARGET_DEFINITIONS.find((target) => target.kind === kind).exportNames;
}

function renderRegistry({ directory, entries, kind }) {
  const imports = entries
    .map(
      (entry, index) =>
        `import entry${index} from ${JSON.stringify(toImportPath(entry.filePath, directory))};`
    )
    .join("\n");
  const entryNames = entries.map((_, index) => `entry${index}`).join(", ");
  const aliases = registryVariableNames(kind)
    .flatMap(([arrayName, mapName]) => [
      `export const ${arrayName} = registry;`,
      `export const ${mapName} = registryById;`
    ])
    .join("\n");
  const idExpression =
    kind === "instructions"
      ? "candidate.op ?? candidate.id ?? candidate.keyword ?? candidate.canonicalCardId"
      : kind === "cards"
        ? "candidate.canonicalCardId ?? candidate.id ?? candidate.op ?? candidate.keyword"
        : "candidate.id ?? candidate.keyword ?? candidate.op ?? candidate.canonicalCardId";

  return [
    "// Generated by scripts/gen-registries.mjs. Do not edit.",
    "",
    imports,
    imports ? "" : undefined,
    "type RegistryEntry = {",
    "  readonly id?: unknown;",
    "  readonly op?: unknown;",
    "  readonly keyword?: unknown;",
    "  readonly canonicalCardId?: unknown;",
    "};",
    "",
    "function registryId(entry: unknown): string {",
    "  if (typeof entry !== \"object\" || entry === null) {",
    "    throw new Error(\"Registry entries must be objects\");",
    "  }",
    "  const candidate = entry as RegistryEntry;",
    `  const id = ${idExpression};`,
    "  if (typeof id !== \"string\" || id.length === 0) {",
    "    throw new Error(\"Registry entries must expose a non-empty string id\");",
    "  }",
    "  return id;",
    "}",
    "",
    `export const registry = Object.freeze([${entryNames}] as const);`,
    "export const registryById: ReadonlyMap<string, (typeof registry)[number]> = new Map(",
    "  registry.map((entry) => [registryId(entry), entry] as const)"
      + ");",
    aliases,
    "",
    ""
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

async function listSourceFiles(directory) {
  const fileNames = await readdir(directory, { withFileTypes: true });
  return fileNames
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        entry.name !== REGISTRY_FILENAME
    )
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function listCardSourceFiles(cardsRoot) {
  const children = await readdir(cardsRoot, { withFileTypes: true });
  const cardSets = children
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const files = [];
  for (const setName of cardSets) {
    files.push(...(await listSourceFiles(path.join(cardsRoot, setName))));
  }
  return files.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function validateUniqueIds(entries) {
  const locations = new Map();
  for (const entry of entries) {
    const previous = locations.get(entry.id);
    if (previous) {
      throw new RegistryGenerationError(
        `Duplicate registry id \"${entry.id}\" in ${entry.filePath}; ` +
          `already defined by ${previous}`
      );
    }
    locations.set(entry.id, entry.filePath);
  }
}

async function collectTargetAsync({ directory, kind, sourceDirectory = directory }) {
  await mkdir(directory, { recursive: true });
  const files =
    kind === "cards"
      ? await listCardSourceFiles(sourceDirectory)
      : await listSourceFiles(sourceDirectory);
  const entries = [];
  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    const { value: id } = extractRegistryId(source, filePath, kind);
    entries.push({ filePath, id });
  }
  validateUniqueIds(entries);
  return { directory, entries, kind };
}

async function discoverTargets(repoRoot) {
  const targets = TARGET_DEFINITIONS.map((target) => ({
    directory: path.join(repoRoot, ...target.directory),
    kind: target.kind
  }));
  const cardsRoot = path.join(repoRoot, "packages", "card-dsl", "src", "cards");
  await mkdir(cardsRoot, { recursive: true });
  targets.push({ directory: cardsRoot, kind: "cards", sourceDirectory: cardsRoot });
  return targets;
}

export async function generateRegistries({ repoRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  const absoluteRoot = path.resolve(repoRoot);
  const targets = await discoverTargets(absoluteRoot);
  const collected = [];

  for (const target of targets) {
    collected.push(await collectTargetAsync(target));
  }

  const results = [];
  for (const target of collected) {
    const outputPath = path.join(target.directory, REGISTRY_FILENAME);
    const contents = renderRegistry(target);
    let previousContents;
    try {
      previousContents = await readFile(outputPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const changed = previousContents !== contents;
    if (changed) await writeFile(outputPath, contents, "utf8");
    results.push({ changed, directory: target.directory, outputPath });
  }
  return results;
}

function parseArguments(argv) {
  let repoRoot = DEFAULT_REPOSITORY_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new RegistryGenerationError("--root requires a directory");
      repoRoot = value;
      index += 1;
    } else if (argument.startsWith("--root=")) {
      repoRoot = argument.slice("--root=".length);
      if (!repoRoot) throw new RegistryGenerationError("--root requires a directory");
    } else if (argument === "--help" || argument === "-h") {
      console.log("Usage: node scripts/gen-registries.mjs [--root <repository-root>]");
      return undefined;
    } else {
      throw new RegistryGenerationError(`Unknown option: ${argument}`);
    }
  }
  return { repoRoot };
}

const isMainModule = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options) await generateRegistries(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Registry generation failed: ${message}`);
    process.exitCode = 1;
  }
}
