#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

// TypeScript is an existing engine-core dependency, not a root dependency.
const ts = createRequire(new URL("../packages/engine-core/package.json", import.meta.url))(
  "typescript"
);

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

function unwrapExpression(expression) {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function findDefaultExport(source, filePath) {
  const file = ts.createSourceFile(
    filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS
  );
  const diagnostic = file.parseDiagnostics[0];
  if (diagnostic) {
    const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    throw new RegistryGenerationError(
      `Invalid TypeScript syntax in ${filePath}:${line + 1}:${character + 1}: ` +
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    );
  }

  const declarations = new Map();
  const defaultExports = [];
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExports.push(statement.expression);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause && ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== "default") continue;
        if (statement.moduleSpecifier || statement.isTypeOnly || element.isTypeOnly) {
          throw new RegistryGenerationError(
            `Unsupported default export in ${filePath}; expected a local value export`
          );
        }
        defaultExports.push(element.propertyName ?? element.name);
      }
    } else if (ts.getModifiers(statement)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword
    )) {
      throw new RegistryGenerationError(
        `Unsupported default export in ${filePath}; expected an object literal`
      );
    }
  }

  if (defaultExports.length === 0) {
    throw new RegistryGenerationError(
      `Missing default export in ${filePath}; each registry source file must ` +
        "export its definition as default"
    );
  }
  if (defaultExports.length > 1) {
    throw new RegistryGenerationError(`Multiple default exports in ${filePath}`);
  }

  let expression = unwrapExpression(defaultExports[0]);
  const visited = new Set();
  while (ts.isIdentifier(expression)) {
    const name = expression.text;
    if (visited.has(name) || !declarations.has(name)) {
      throw new RegistryGenerationError(
        `Cannot resolve default export in ${filePath}: ${name}; ` +
          "expected a local variable initialized with an object literal"
      );
    }
    visited.add(name);
    expression = unwrapExpression(declarations.get(name));
  }
  if (!ts.isObjectLiteralExpression(expression)) {
    throw new RegistryGenerationError(
      `Unsupported default export in ${filePath}; expected an object literal`
    );
  }
  return expression;
}

function extractRegistryId(source, filePath, kind) {
  const definition = findDefaultExport(source, filePath);
  const preferredProperties =
    kind === "instructions"
      ? ["op", ...DEFAULT_ID_PROPERTIES.filter((name) => name !== "op")]
      : kind === "cards"
        ? [
            "canonicalCardId",
            ...DEFAULT_ID_PROPERTIES.filter((name) => name !== "canonicalCardId")
          ]
        : DEFAULT_ID_PROPERTIES;

  const properties = new Map();
  for (const property of definition.properties) {
    // A spread or computed key can override an id without a visible declaration.
    if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) {
      throw new RegistryGenerationError(
        `Cannot statically read registry id in ${filePath}; ` +
          "object spreads and computed properties are unsupported"
      );
    }
    const name = property.name.text;
    if (!preferredProperties.includes(name)) continue;
    if (properties.has(name)) {
      throw new RegistryGenerationError(
        `Duplicate registry id property ${name} in ${filePath}`
      );
    }
    properties.set(name, property);
  }

  for (const propertyName of preferredProperties) {
    const property = properties.get(propertyName);
    if (!property) continue;
    const value = ts.isPropertyAssignment(property)
      ? unwrapExpression(property.initializer)
      : undefined;
    if (!value || !(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) {
      throw new RegistryGenerationError(
        `Invalid registry id in ${filePath}: ${propertyName} must be a static string`
      );
    }
    if (value.text.length === 0) {
      throw new RegistryGenerationError(
        `Empty registry id in ${filePath}: ${propertyName} must be a non-empty string`
      );
    }
    return { propertyName, value: value.text };
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
