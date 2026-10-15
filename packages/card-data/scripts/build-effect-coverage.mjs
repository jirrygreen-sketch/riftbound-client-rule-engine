#!/usr/bin/env node

import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildEffectCoverageReport } from "../dist/index.js";

export const DEFAULT_CATALOG_PATH = fileURLToPath(
  new URL("../data/deck-catalog.json", import.meta.url)
);
export const DEFAULT_OUTPUT_PATH = fileURLToPath(
  new URL("../data/effect-coverage.json", import.meta.url)
);

const usage = `Usage:
  node scripts/build-effect-coverage.mjs [options]

Builds the conservative effect coverage report from the persisted deck catalog.
Unknown ability text is always reported as judgeRequired.

Options:
  --catalog <file>    Catalog input. Default: data/deck-catalog.json.
  --output <file>     Report output. Default: data/effect-coverage.json.
  --dry-run          Validate and print totals without writing.
  -h, --help         Show this help.
`;

export class BuildEffectCoverageError extends Error {
  constructor(message) {
    super(message);
    this.name = "BuildEffectCoverageError";
  }
}

export function parseArguments(argv) {
  const options = {
    catalog: undefined,
    output: undefined,
    dryRun: false,
    help: false
  };

  function value(index, optionName) {
    const argument = argv[index];
    const prefix = `${optionName}=`;
    if (argument.startsWith(prefix)) {
      return { value: argument.slice(prefix.length), nextIndex: index };
    }
    const next = argv[index + 1];
    if (next === undefined || next === "-h" || next.startsWith("--")) {
      throw new BuildEffectCoverageError(`${optionName} requires a value`);
    }
    return { value: next, nextIndex: index + 1 };
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--catalog" || argument.startsWith("--catalog=")) {
      const result = value(index, "--catalog");
      options.catalog = result.value;
      index = result.nextIndex;
    } else if (argument === "--output" || argument.startsWith("--output=")) {
      const result = value(index, "--output");
      options.output = result.value;
      index = result.nextIndex;
    } else {
      throw new BuildEffectCoverageError(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function resolvePath(candidate, fallback) {
  return path.resolve(process.cwd(), candidate ?? fallback);
}

async function readJson(filePath) {
  let contents;
  try {
    contents = await (await import("node:fs/promises")).readFile(
      filePath,
      "utf8"
    );
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") {
      throw new BuildEffectCoverageError(
        `Catalog not found: ${filePath}\n` +
        "Run the deck-catalog build first to create it:\n" +
        "  pnpm --filter @riftbound/card-data build:catalog\n" +
        `  node scripts/build-deck-catalog.mjs --output ${filePath}`
      );
    }
    throw error;
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new BuildEffectCoverageError(`Catalog is not valid JSON: ${filePath}`);
  }
}

async function writeAtomically(filePath, contents) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    const handle = await open(temporaryPath, "wx");
    try {
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function coverageCard(card) {
  return {
    id: card.id,
    ...(card.canonicalCardId === undefined
      ? {}
      : { canonicalCardId: card.canonicalCardId }),
    ability: card.ability ?? ""
  };
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;

  try {
    const options = parseArguments(argv);
    if (options.help) {
      log(usage.trimEnd());
      return 0;
    }

    const catalogPath = resolvePath(options.catalog, DEFAULT_CATALOG_PATH);
    const outputPath = resolvePath(options.output, DEFAULT_OUTPUT_PATH);
    const catalog = await readJson(catalogPath);
    if (catalog === null || typeof catalog !== "object" ||
        !Array.isArray(catalog.cards)) {
      throw new BuildEffectCoverageError("Catalog must contain a cards array");
    }

    const report = buildEffectCoverageReport(
      catalog.cards.map((card, index) => {
        if (card === null || typeof card !== "object") {
          throw new BuildEffectCoverageError(`Catalog card ${index} is not an object`);
        }
        return coverageCard(card);
      })
    );
    const summary =
      `printings=${report.printingCount} ` +
      `canonicalIdentities=${report.canonicalIdentityCount} ` +
      `executable=${report.executableCount} ` +
      `judgeRequired=${report.judgeRequiredCount} ` +
      `noAbility=${report.noAbilityCount}`;

    if (options.dryRun) {
      log(`Effect coverage dry run: ${summary}`);
      return 0;
    }

    await writeAtomically(
      outputPath,
      `${JSON.stringify(report, null, 2)}\n`
    );
    log(`Effect coverage written to ${outputPath}. ${summary}`);
    return 0;
  } catch (caught) {
    error(
      `build-effect-coverage failed: ${
        caught instanceof Error ? caught.message : String(caught)
      }`
    );
    return 1;
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  process.exitCode = await main();
}
