#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_SOURCE = "LouisCourrian/riftbound-cards";
export const DEFAULT_TIMEOUT_MS = 30_000;
const COLLECTION_ID = "collection.riftbound-cards";
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RELEASE_DATE_PATTERN = /(?:^|\/)v?(\d{4}-\d{2}-\d{2})(?:\/|$)/;
const CARD_TYPES = new Set([
  "battlefield",
  "gear",
  "legend",
  "rune",
  "spell",
  "token",
  "unit"
]);

const usage = `Usage:
  node scripts/sync-cards.mjs [options]

Downloads the cards.json asset from the latest GitHub release of
${DEFAULT_SOURCE}, preserves the complete source records, and writes a
package-compatible card data bundle plus download metadata.

Options:
  --output <file>             Output JSON file. Default: dist/cards.json
                              inside this package.
  --source <owner/repo|url>   GitHub repository slug or HTTPS URL to a
                              cards.json release asset. Default:
                              ${DEFAULT_SOURCE}
  --timeout-ms <milliseconds> Per-request timeout. Default: 30000
  --dry-run                   Download and validate data without writing.
  -h, --help                  Show this help.

The output is ignored safely when written to the package's dist directory.
It contains:
  source  actual download URL, repository/release details, download time,
          byte length, and SHA-256 of the downloaded payload
  cards   the complete, unmodified card records from cards.json
  bundle  a CardDataBundle accepted by @riftbound/card-data

Examples:
  pnpm --filter @riftbound/card-data sync:cards
  pnpm --filter @riftbound/card-data sync:cards --dry-run
  node scripts/sync-cards.mjs --source LouisCourrian/riftbound-cards --dry-run

Run the package build before invoking the script directly. The package script
does this automatically.
`;

export class SyncCardsError extends Error {
  constructor(message) {
    super(message);
    this.name = "SyncCardsError";
  }
}

function readOptionValue(argv, index, argument, optionName) {
  const equalsPrefix = `${optionName}=`;
  if (argument.startsWith(equalsPrefix)) {
    return {
      value: argument.slice(equalsPrefix.length),
      nextIndex: index
    };
  }

  const next = argv[index + 1];
  if (next === undefined || next === "-h" || next.startsWith("--")) {
    throw new SyncCardsError(`${optionName} requires a value`);
  }
  return {
    value: next,
    nextIndex: index + 1
  };
}

export function parseArguments(argv) {
  const options = {
    output: undefined,
    source: DEFAULT_SOURCE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--output" || argument.startsWith("--output=")) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--output"
      );
      if (value.trim() === "") {
        throw new SyncCardsError("--output requires a non-empty file path");
      }
      options.output = value;
      index = nextIndex;
    } else if (argument === "--source" || argument.startsWith("--source=")) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--source"
      );
      if (value.trim() === "") {
        throw new SyncCardsError("--source requires a non-empty value");
      }
      options.source = value.trim();
      index = nextIndex;
    } else if (
      argument === "--timeout-ms" ||
      argument.startsWith("--timeout-ms=")
    ) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--timeout-ms"
      );
      if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 3_600_000) {
        throw new SyncCardsError(
          "--timeout-ms must be an integer between 1 and 3600000"
        );
      }
      options.timeoutMs = Number(value);
      index = nextIndex;
    } else {
      throw new SyncCardsError(`Unknown option: ${argument}`);
    }
  }

  return options;
}

export function resolveOutputPath(output) {
  if (output === undefined) {
    return fileURLToPath(new URL("../dist/cards.json", import.meta.url));
  }
  return path.resolve(process.cwd(), output);
}

function requestInit(timeoutMs) {
  return {
    headers: {
      "User-Agent": "@riftbound/card-data sync-cards",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  };
}

function isTimeoutError(error) {
  return error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      error.code === "ABORT_ERR");
}

async function readResponseBody(response, url) {
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).trim().slice(0, 500);
    } catch (error) {
      if (isTimeoutError(error)) throw error;
      detail = "the error response body could not be read";
    }
    const suffix = detail === "" ? "" : `: ${detail}`;
    throw new SyncCardsError(`Request to ${url} failed (${response.status})${suffix}`);
  }
}

export async function fetchJson(url, timeoutMs) {
  const init = requestInit(timeoutMs);
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Accept: "application/vnd.github+json"
    }
  });
  await readResponseBody(response, url);

  let parsed;
  try {
    parsed = await response.json();
  } catch (error) {
    if (isTimeoutError(error)) throw error;
    throw new SyncCardsError(`Response from ${url} is not valid JSON`);
  }
  return parsed;
}

export async function fetchBuffer(url, timeoutMs) {
  const response = await fetch(url, requestInit(timeoutMs));
  await readResponseBody(response, url);
  return Buffer.from(await response.arrayBuffer());
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGitHubDownloadUrl(url) {
  if (url.hostname !== "github.com") return null;

  const match = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\//.exec(
    url.pathname
  );
  if (match === null) return null;
  let releaseTag = match[3];
  try {
    releaseTag = decodeURIComponent(releaseTag);
  } catch {
    // Keep the URL segment when it contains malformed percent escapes.
  }
  return {
    repository: `${match[1]}/${match[2]}`,
    releaseTag
  };
}

function requireHttpsUrl(value, message) {
  if (typeof value !== "string") {
    throw new SyncCardsError(message);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new SyncCardsError(message);
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" ||
      parsed.password !== "") {
    throw new SyncCardsError(message);
  }
  return parsed;
}

export async function resolveSource(source, timeoutMs) {
  if (GITHUB_REPOSITORY_PATTERN.test(source)) {
    const releaseUrl =
      `https://api.github.com/repos/${source}/releases/latest`;
    const release = await fetchJson(releaseUrl, timeoutMs);

    if (!isRecord(release) ||
        typeof release.tag_name !== "string" ||
        release.tag_name.trim() === "" ||
        !Array.isArray(release.assets)) {
      throw new SyncCardsError(
        `Latest release response for ${source} is missing tag_name or assets`
      );
    }

    const assets = release.assets.filter((asset) =>
      isRecord(asset) && asset.name === "cards.json"
    );
    if (assets.length !== 1) {
      throw new SyncCardsError(
        `Expected exactly one cards.json asset in the latest release of ${source}; found ${assets.length}`
      );
    }

    const asset = assets[0];
    const assetUrl = requireHttpsUrl(
      asset.browser_download_url,
      "The cards.json release asset does not provide an HTTPS download URL"
    );

    let expectedDigest = null;
    if (asset.digest !== undefined && asset.digest !== null) {
      if (typeof asset.digest !== "string" ||
          !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
        throw new SyncCardsError(
          "The cards.json release asset has an invalid SHA-256 digest"
        );
      }
      expectedDigest = asset.digest;
    }

    return {
      url: assetUrl.toString(),
      expectedDigest,
      metadata: {
        sourceType: "github-latest-release",
        repository: source,
        releaseTag: release.tag_name,
        releaseUrl: typeof release.html_url === "string"
          ? release.html_url
          : undefined
      }
    };
  }

  const parsedUrl = requireHttpsUrl(
    source,
    "--source must be a GitHub owner/repository slug or an HTTPS URL"
  );

  const github = parseGitHubDownloadUrl(parsedUrl);
  const metadata = { sourceType: "direct-url" };
  if (github !== null) {
    metadata.repository = github.repository;
    metadata.releaseTag = github.releaseTag;
  }

  return {
    url: parsedUrl.toString(),
    expectedDigest: null,
    metadata
  };
}

function releaseDate(metadata, url, downloadedAt) {
  const candidates = [metadata.releaseTag, url];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const match = RELEASE_DATE_PATTERN.exec(candidate);
    if (match !== null) return match[1];
  }
  return downloadedAt.slice(0, 10);
}

function stableSlug(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function stableTag(value) {
  const slug = stableSlug(value);
  if (slug === "") return null;
  return /^[a-z]/.test(slug) ? slug : `tag-${slug}`;
}

function requiredText(record, field, context) {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new SyncCardsError(`${context}: ${field} must be a non-empty string`);
  }
  return value;
}

function optionalTextArray(record, field, context) {
  if (record[field] === undefined || record[field] === null) return [];
  if (!Array.isArray(record[field]) ||
      record[field].some((item) => typeof item !== "string")) {
    throw new SyncCardsError(`${context}: ${field} must be an array of strings`);
  }
  return record[field];
}

function normalizeCost(value, field, context) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < 0 || value > 999) {
    throw new SyncCardsError(
      `${context}: ${field} must be an integer from 0 through 999, or null`
    );
  }
  return value;
}

export function transformCards(rawCards, dataVersion, createCardDataBundle) {
  if (!Array.isArray(rawCards) || rawCards.length === 0) {
    throw new SyncCardsError("cards must be a non-empty JSON array");
  }

  const ids = new Map();
  const cards = rawCards.map((rawCard, index) => {
    if (!isRecord(rawCard)) {
      throw new SyncCardsError(`cards[${index}] must be an object`);
    }
    const context =
      `cards[${index}]${typeof rawCard.cardCode === "string"
        ? ` (${rawCard.cardCode})`
        : ""}`;

    const cardCode = requiredText(rawCard, "cardCode", context);
    const nameValue = rawCard.fullName ?? rawCard.name;
    if (typeof nameValue !== "string" || nameValue.trim() === "") {
      throw new SyncCardsError(`${context}: name or fullName is required`);
    }
    const cardType = requiredText(rawCard, "cardType", context).toLowerCase();
    if (!CARD_TYPES.has(cardType)) {
      throw new SyncCardsError(`${context}: unsupported cardType ${cardType}`);
    }

    const setCode = requiredText(rawCard, "setCode", context);
    const rarity =
      typeof rawCard.rarity === "string" && rawCard.rarity !== ""
        ? rawCard.rarity
        : null;
    const tagSources = [
      setCode,
      cardType,
      rarity,
      ...optionalTextArray(rawCard, "domains", context),
      ...optionalTextArray(rawCard, "tags", context)
    ].filter((value) => value !== null);

    const tags = [...new Set(
      tagSources
        .map(stableTag)
        .filter((tag) => tag !== null)
    )].sort();
    if (tags.length === 0) {
      throw new SyncCardsError(`${context}: at least one stable tag is required`);
    }

    const cardIdSlug = stableSlug(cardCode);
    if (cardIdSlug === "") {
      throw new SyncCardsError(
        `${context}: cardCode must contain at least one letter or digit`
      );
    }
    const id = `card.${cardIdSlug}`;
    const previousIndex = ids.get(id);
    if (previousIndex !== undefined) {
      throw new SyncCardsError(
        `${context}: duplicate card id ${id} (also used by cards[${previousIndex}])`
      );
    }
    ids.set(id, index);

    return {
      id,
      collectionId: COLLECTION_ID,
      name: nameValue,
      cardType,
      cost: {
        energy: normalizeCost(rawCard.energy, "energy", context),
        power: normalizeCost(rawCard.power, "power", context)
      },
      tags
    };
  });

  return createCardDataBundle({
    schemaVersion: 1,
    collectionId: COLLECTION_ID,
    dataVersion,
    cards
  });
}

export function parseRawCards(buffer, sourceUrl) {
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new SyncCardsError(`Downloaded payload from ${sourceUrl} is not valid JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new SyncCardsError(
      `Downloaded payload from ${sourceUrl} must be a non-empty JSON array`
    );
  }
  return parsed;
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

async function loadCardDataApi() {
  try {
    return await import("../dist/index.js");
  } catch (error) {
    throw new SyncCardsError(
      "Unable to import ../dist/index.js. Run `pnpm --filter @riftbound/card-data build` first."
    );
  }
}

async function run(options) {
  const source = await resolveSource(options.source, options.timeoutMs);
  const payload = await fetchBuffer(source.url, options.timeoutMs);
  const downloadedAt = new Date().toISOString();
  const sha256 = `sha256:${createHash("sha256").update(payload).digest("hex")}`;

  if (source.expectedDigest !== null && sha256 !== source.expectedDigest) {
    throw new SyncCardsError(
      `SHA-256 mismatch for ${source.url}: expected ${source.expectedDigest}, got ${sha256}`
    );
  }

  const rawCards = parseRawCards(payload, source.url);
  const api = await loadCardDataApi();
  const dataVersion = releaseDate(source.metadata, source.url, downloadedAt);
  const bundle = transformCards(rawCards, dataVersion, api.createCardDataBundle);
  if (!api.isCardDataBundle(bundle)) {
    throw new SyncCardsError("The generated card data bundle failed validation");
  }

  const output = {
    schemaVersion: 1,
    source: {
      ...source.metadata,
      url: source.url,
      downloadedAt,
      sha256,
      byteLength: payload.byteLength
    },
    cards: rawCards,
    bundle
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const outputPath = resolveOutputPath(options.output);

  if (options.dryRun) {
    console.log(
      `Dry run complete: ${rawCards.length} cards; no file written. ` +
      `Output would be ${outputPath}.`
    );
    return;
  }

  await writeAtomically(outputPath, serialized);
  console.log(`Synced ${rawCards.length} cards to ${outputPath}`);
}

function formatError(error, timeoutMs) {
  if (error instanceof SyncCardsError) {
    return error.message;
  }
  if (isTimeoutError(error)) {
    return `request timed out after ${timeoutMs}ms`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const logError = io.error ?? console.error;
  let options = { timeoutMs: DEFAULT_TIMEOUT_MS };

  try {
    options = parseArguments(argv);
    if (options.help) {
      log(usage);
      return 0;
    }
    await run(options);
    return 0;
  } catch (error) {
    logError(`sync-cards failed: ${formatError(error, options.timeoutMs)}`);
    return 1;
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  process.exitCode = await main();
}
