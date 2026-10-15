#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { buildDeckCatalog, DEFAULT_OUTPUT_PATH as DECK_CATALOG_PATH } from "./build-deck-catalog.mjs";
import {
  DEFAULT_SOURCE as DEFAULT_COMMUNITY_SOURCE,
  fetchBuffer,
  parseRawCards,
  resolveSource
} from "./sync-cards.mjs";

const DEFAULT_GALLERY_URL =
  "https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=en_US";
const DEFAULT_LOCALIZED_GALLERY_URL =
  "https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN";
const DEFAULT_TIMEOUT_MS = 30_000;
const API_PAGE_SIZE = 200;
const SNAPSHOT_LIMIT = 2_000;
const COLLECTION_ID = "collection.riftbound-cards";
const SUPPORTED_CARD_TYPES = new Set([
  "battlefield",
  "gear",
  "legend",
  "rune",
  "spell",
  "token",
  "unit"
]);

const usage = `Usage:
  node scripts/sync-current-cards.mjs [options]

Downloads the latest community card records and the current official card
records from the Riot Publishing API, then writes one merged, versioned
card-data snapshot.

Options:
  --output <file>             Output JSON file. Default: dist/cards.json
                              inside this package.
  --catalog-output <file>     Image catalog file. Default:
                              data/catalog.json inside this package.
  --community-source <value>  GitHub owner/repo or HTTPS cards.json URL.
                              Default: ${DEFAULT_COMMUNITY_SOURCE}
  --gallery-url <url>         Official English API URL. Default:
                              ${DEFAULT_GALLERY_URL}
  --localized-gallery-url <url>
                              Official Chinese API URL. Default:
                              ${DEFAULT_LOCALIZED_GALLERY_URL}
  --timeout-ms <milliseconds> Per-request timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --dry-run                   Download and validate data without writing.
  -h, --help                  Show this help.

The output keeps:
  cards           the current official record coverage, enriched with the
                  community source's corrected fields where available
  officialGallery the raw English records from the official Publishing API
  localizedGalleries raw localized API records (English and Chinese)
  sources         URLs, API metadata, byte counts and SHA-256 values
  bundle          a CardDataBundle accepted by @riftbound/card-data

Card images are kept as source URLs. Binary image caching is a separate,
opt-in operation.
`;

export class CurrentCardsSyncError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "CurrentCardsSyncError";
    this.retryable = options.retryable ?? false;
  }
}

function safeUrl(url) {
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function wrapFetchError(error, url) {
  if (error instanceof CurrentCardsSyncError) return error;
  const cause = error instanceof Error
    ? [error.message, error.cause?.code, error.cause?.message].filter(Boolean).join(": ")
    : String(error);
  return new CurrentCardsSyncError(
    `Request to ${safeUrl(url)} failed: ${cause}`,
    { cause: error, retryable: true }
  );
}

async function withRequestRetries(operation, url) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const failure = wrapFetchError(error, url);
      if (!failure.retryable || attempt >= 3) throw failure;
      await delay(200 * 2 ** attempt);
    }
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
    throw new CurrentCardsSyncError(`${optionName} requires a value`);
  }
  return {
    value: next,
    nextIndex: index + 1
  };
}

export function parseArguments(argv) {
  const options = {
    output: undefined,
    catalogOutput: undefined,
    communitySource: DEFAULT_COMMUNITY_SOURCE,
    galleryUrl: DEFAULT_GALLERY_URL,
    localizedGalleryUrl: DEFAULT_LOCALIZED_GALLERY_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      continue;
    } else if (argument === "-h" || argument === "--help") {
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
        throw new CurrentCardsSyncError(
          "--output requires a non-empty file path"
        );
      }
      options.output = value;
      index = nextIndex;
    } else if (
      argument === "--catalog-output" ||
      argument.startsWith("--catalog-output=")
    ) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--catalog-output"
      );
      if (value.trim() === "") {
        throw new CurrentCardsSyncError(
          "--catalog-output requires a non-empty file path"
        );
      }
      options.catalogOutput = value;
      index = nextIndex;
    } else if (
      argument === "--community-source" ||
      argument.startsWith("--community-source=")
    ) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--community-source"
      );
      if (value.trim() === "") {
        throw new CurrentCardsSyncError(
          "--community-source requires a non-empty value"
        );
      }
      options.communitySource = value.trim();
      index = nextIndex;
    } else if (
      argument === "--gallery-url" ||
      argument.startsWith("--gallery-url=")
    ) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--gallery-url"
      );
      if (value.trim() === "") {
        throw new CurrentCardsSyncError(
          "--gallery-url requires a non-empty value"
        );
      }
      options.galleryUrl = value.trim();
      index = nextIndex;
    } else if (
      argument === "--localized-gallery-url" ||
      argument.startsWith("--localized-gallery-url=")
    ) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--localized-gallery-url"
      );
      if (value.trim() === "") {
        throw new CurrentCardsSyncError(
          "--localized-gallery-url requires a non-empty value"
        );
      }
      options.localizedGalleryUrl = value.trim();
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
        throw new CurrentCardsSyncError(
          "--timeout-ms must be an integer between 1 and 3600000"
        );
      }
      options.timeoutMs = Number(value);
      index = nextIndex;
    } else {
      throw new CurrentCardsSyncError(`Unknown option: ${argument}`);
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

export function resolveCatalogOutputPath(output) {
  if (output === undefined) {
    return fileURLToPath(new URL("../data/catalog.json", import.meta.url));
  }
  return path.resolve(process.cwd(), output);
}

function requireHttpsUrl(value, optionName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CurrentCardsSyncError(`${optionName} must be an HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new CurrentCardsSyncError(`${optionName} must be an HTTPS URL`);
  }
  return url;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function htmlText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

export function extractOfficialPage(payload, sourceUrl) {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new CurrentCardsSyncError(
      `Official API response from ${sourceUrl} has no data array`
    );
  }

  for (const [index, card] of payload.data.entries()) {
    if (!isRecord(card) || typeof card.id !== "string" || card.id === "") {
      throw new CurrentCardsSyncError(
        `Official API record at index ${index} has no stable id`
      );
    }
  }

  return {
    cards: payload.data,
    metadata: isRecord(payload.metadata) ? payload.metadata : {}
  };
}

export async function fetchOfficialGallery(url, timeoutMs, fetchImpl = fetch) {
  const baseUrl = requireHttpsUrl(url, "--gallery-url");
  const byId = new Map();
  const pages = [];
  let bytes = 0;
  let combinedText = "";

  const request = async (from, limit) => {
    const requestUrl = new URL(baseUrl);
    requestUrl.searchParams.set("from", String(from));
    requestUrl.searchParams.set("limit", String(limit));
    requestUrl.searchParams.sort();
    const text = await withRequestRetries(async () => {
      const response = await fetchImpl(requestUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "@riftbound/card-data sync-current-cards"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) {
        throw new CurrentCardsSyncError(
          `Request to ${requestUrl} failed (${response.status})`,
          { retryable: response.status === 429 || response.status >= 500 }
        );
      }
      return await response.text();
    }, requestUrl);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new CurrentCardsSyncError(
        `Official API response from ${requestUrl} is not valid JSON`
      );
    }
    const page = extractOfficialPage(payload, requestUrl);
    const previousSize = byId.size;
    for (const card of page.cards) {
      const existing = byId.get(card.id);
      if (existing === undefined) {
        byId.set(card.id, card);
        continue;
      }

      if (!isDeepStrictEqual(existing, card)) {
        throw new CurrentCardsSyncError(
          `Official API pages from ${baseUrl} contain conflicting records ` +
          `for id ${card.id} (from=${from})`
        );
      }
    }

    pages.push({
      ...page,
      sourceUrl: requestUrl.toString(),
      purpose: from === 0 && limit === SNAPSHOT_LIMIT ? "snapshot" : "page"
    });
    bytes += Buffer.byteLength(text);
    combinedText += text;
    return {
      newRecords: byId.size - previousSize,
      recordCount: new Set(page.cards.map((card) => card.id)).size,
      requestUrl
    };
  };

  let from = 0;
  while (true) {
    const result = await request(from, API_PAGE_SIZE);
    if (result.newRecords === 0) break;
    from += API_PAGE_SIZE;
  }

  const pagedCount = byId.size;
  const snapshot = await request(0, SNAPSHOT_LIMIT);

  if (byId.size === 0) {
    throw new CurrentCardsSyncError(
      `Official API responses from ${baseUrl} contain no card records`
    );
  }

  return {
    url: baseUrl.toString(),
    cards: [...byId.values()],
    sets: {},
    metadata: pages.at(-1)?.metadata ?? {},
    resultsUpdatedAt: pages.at(-1)?.metadata?.resultsUpdatedAt ?? null,
    buildId: null,
    byteLength: bytes,
    sha256: sha256(combinedText),
    pages,
    reconciliation: {
      pagedRecordCount: pagedCount,
      snapshotRecordCount: snapshot.recordCount,
      finalRecordCount: byId.size,
      snapshotAddedRecordCount: byId.size - pagedCount
    }
  };
}

function compareCardIds(left, right, leftLabel, rightLabel) {
  const leftIds = new Set(left.cards.map((card) => card.id));
  const rightIds = new Set(right.cards.map((card) => card.id));
  const onlyLeft = [...leftIds].filter((id) => !rightIds.has(id));
  const onlyRight = [...rightIds].filter((id) => !leftIds.has(id));
  return { onlyLeft, onlyRight };
}

function assertSameCardIds(left, right, leftLabel, rightLabel) {
  const { onlyLeft, onlyRight } = compareCardIds(left, right, leftLabel, rightLabel);
  if (onlyLeft.length === 0 && onlyRight.length === 0) return;

  throw new CurrentCardsSyncError(
    `Official gallery ID mismatch between ${leftLabel} (${left.url}) and ` +
    `${rightLabel} (${right.url}): only ${leftLabel}=` +
    `${onlyLeft.slice(0, 10).join(",") || "none"}; only ${rightLabel}=` +
    `${onlyRight.slice(0, 10).join(",") || "none"}`
  );
}

export async function fetchOfficialGalleries(
  urls,
  timeoutMs,
  io = {}
) {
  const log = io.log ?? (() => {});
  const fetchImpl = io.fetchImpl ?? fetch;

  const load = async (url, label) => {
    log(`Downloading ${label} official cards from ${safeUrl(url)}...`);
    const gallery = await fetchOfficialGallery(url, timeoutMs, fetchImpl);
    log(
      `${label} official cards: ${gallery.cards.length} records; ` +
      `paged=${gallery.reconciliation.pagedRecordCount}; ` +
      `snapshot added=${gallery.reconciliation.snapshotAddedRecordCount}.`
    );
    return gallery;
  };

  let official = await load(urls.galleryUrl, "English");
  let localized = await load(urls.localizedGalleryUrl, "Chinese");
  const firstMismatch = compareCardIds(
    official,
    localized,
    "en-US official gallery",
    "zh-CN official gallery"
  );
  let retried = false;
  if (
    firstMismatch.onlyLeft.length > 0 ||
    firstMismatch.onlyRight.length > 0
  ) {
    retried = true;
    log(
      `Locale ID mismatch detected; retrying each locale once. ` +
      `Only en-US=${firstMismatch.onlyLeft.join(",") || "none"}; ` +
      `only zh-CN=${firstMismatch.onlyRight.join(",") || "none"}.`
    );
    official = await load(urls.galleryUrl, "English retry");
    localized = await load(urls.localizedGalleryUrl, "Chinese retry");
  }

  assertSameCardIds(
    official,
    localized,
    "en-US official gallery",
    "zh-CN official gallery"
  );
  return {
    official: { ...official, localeMismatchRetried: retried },
    localized: { ...localized, localeMismatchRetried: retried }
  };
}

function firstLabel(values) {
  return Array.isArray(values) && values.length > 0
    ? values[0]?.label
    : undefined;
}

function firstId(values) {
  return Array.isArray(values) && values.length > 0
    ? values[0]?.id
    : undefined;
}

function officialCardType(card) {
  const direct = firstId(card.cardType?.type);
  if (SUPPORTED_CARD_TYPES.has(direct)) return direct;

  const superType = firstId(card.cardType?.superType);
  if (superType === "token") return "token";
  return undefined;
}

function officialCardNumber(card) {
  if (typeof card.publicCode !== "string") {
    return String(card.collectorNumber ?? "");
  }
  const [printed = "", total = ""] = card.publicCode.split("/");
  const number = printed.replace(/^[^-]+-/, "");
  return total === "" ? number : `${number}-${total}`;
}

export function normalizeOfficialCard(card, fetchedAt) {
  if (!isRecord(card) || typeof card.id !== "string" || card.id === "") {
    throw new CurrentCardsSyncError("Official card is missing id");
  }

  const set = card.set?.value;
  const domains = card.domain?.values ?? [];
  const tags = card.tags?.tags;
  const type = officialCardType(card);
  if (type === undefined) {
    throw new CurrentCardsSyncError(
      `Official card ${card.id} has no supported card type`
    );
  }

  const ability = htmlText(card.text?.richText?.body);
  const cardSet = typeof set?.label === "string" ? set.label : "";
  const name = typeof card.name === "string" ? card.name : card.id;
  const subtitle =
    typeof card.subtitle === "string" && card.subtitle !== ""
      ? card.subtitle
      : null;

  return {
    cardCode: card.id,
    name,
    subtitle,
    fullName: subtitle === null ? name : `${name}, ${subtitle}`,
    setCode: typeof set?.id === "string" ? set.id.toLowerCase() : "unknown",
    cardSet,
    cardNumber: officialCardNumber(card),
    rarity: card.rarity?.value?.label ?? null,
    domain: firstLabel(domains) ?? null,
    domains: domains
      .map((domain) => domain?.label)
      .filter((value) => typeof value === "string" && value !== ""),
    cardType: type[0].toUpperCase() + type.slice(1),
    cardTypeLabels: [
      ...(card.cardType?.type ?? []),
      ...(card.cardType?.superType ?? [])
    ]
      .map((entry) => entry?.label)
      .filter((value) => typeof value === "string" && value !== ""),
    tags: Array.isArray(tags) ? tags : [],
    energy: card.energy?.value?.id ?? null,
    power: card.power?.value?.id ?? null,
    might: card.might?.value?.id ?? null,
    abilityOriginal: ability,
    artist: firstLabel(card.illustrator?.values) ?? null,
    imageUrl: card.cardImage?.url ?? null,
    sourceUrl:
      `https://playriftbound.com/en-us/card-gallery/#card-gallery--${card.id}`,
    scrapedAt: fetchedAt,
    abilityCorrected: null,
    abilityEffective: ability,
    hasErrata: false,
    matchedErrataCode: null
  };
}

export function mergeCards(officialCards, communityCards, fetchedAt) {
  const communityByCode = new Map();
  for (const [index, card] of communityCards.entries()) {
    if (
      card === null ||
      typeof card !== "object" ||
      typeof card.cardCode !== "string" ||
      card.cardCode === ""
    ) {
      throw new CurrentCardsSyncError(
        `Community card ${index} is missing a non-empty cardCode`
      );
    }
    if (communityByCode.has(card.cardCode)) {
      throw new CurrentCardsSyncError(
        `Community source contains duplicate cardCode ${card.cardCode}`
      );
    }
    communityByCode.set(card.cardCode, card);
  }
  const officialIds = new Set();
  const missingFromCommunity = [];
  const cards = officialCards.map((officialCard) => {
    officialIds.add(officialCard.id);
    const existing = communityByCode.get(officialCard.id);
    if (existing !== undefined) return existing;
    missingFromCommunity.push(officialCard.id);
    return normalizeOfficialCard(officialCard, fetchedAt);
  });
  const communityOnly = communityCards
    .filter((card) => !officialIds.has(card.cardCode))
    .map((card) => card.cardCode);

  return {
    cards,
    missingFromCommunity,
    communityOnly
  };
}

function setCounts(cards, getSetCode) {
  const counts = new Map();
  for (const card of cards) {
    const key = getSetCode(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
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
  } catch {
    throw new CurrentCardsSyncError(
      "Unable to import ../dist/index.js. Run `pnpm --filter @riftbound/card-data build` first."
    );
  }
}

export async function run(options, io = {}) {
  const log = io.log ?? console.log;
  log("Resolving community card source...");
  const sourceUrl = options.communitySource.startsWith("https://")
    ? options.communitySource
    : `https://api.github.com/repos/${options.communitySource}/releases/latest`;
  const communitySource = await withRequestRetries(
    () => resolveSource(options.communitySource, options.timeoutMs),
    sourceUrl
  );
  log(`Downloading community cards from ${safeUrl(communitySource.url)}...`);
  let communityPayload;
  try {
    communityPayload = await withRequestRetries(
      () => fetchBuffer(communitySource.url, options.timeoutMs),
      communitySource.url
    );
  } catch (error) {
    throw wrapFetchError(error, communitySource.url);
  }
  const communitySha256 = sha256(communityPayload);
  if (
    communitySource.expectedDigest !== null &&
    communitySha256 !== communitySource.expectedDigest
  ) {
    throw new CurrentCardsSyncError(
      `SHA-256 mismatch for ${communitySource.url}: expected ` +
      `${communitySource.expectedDigest}, got ${communitySha256}`
    );
  }
  const communityCards = parseRawCards(
    communityPayload,
    communitySource.url
  );
  log(`Loaded ${communityCards.length} community cards.`);

  const { official, localized } = await fetchOfficialGalleries(
    {
      galleryUrl: options.galleryUrl,
      localizedGalleryUrl: options.localizedGalleryUrl
    },
    options.timeoutMs,
    { log, fetchImpl: fetch }
  );
  const fetchedAt = new Date().toISOString();
  log("Merging official and community records...");
  const merged = mergeCards(official.cards, communityCards, fetchedAt);
  const api = await loadCardDataApi();
  const dataVersion =
    (typeof official.resultsUpdatedAt === "string"
      ? official.resultsUpdatedAt.slice(0, 10)
      : fetchedAt.slice(0, 10)) + "-official-gallery";
  const bundle = (await import("./sync-cards.mjs")).transformCards(
    merged.cards,
    dataVersion,
    api.createCardDataBundle
  );
  if (!api.isCardDataBundle(bundle)) {
    throw new CurrentCardsSyncError(
      "The generated current card data bundle failed validation"
    );
  }
  log(`Generated bundle for ${merged.cards.length} cards.`);

  const output = {
    schemaVersion: 1,
    source: {
      sourceType: "official-gallery-plus-community-release",
      url: communitySource.url,
      downloadedAt: fetchedAt,
      byteLength: communityPayload.byteLength,
      sha256: communitySha256,
      expectedSha256: communitySource.expectedDigest,
      digestVerified: communitySource.expectedDigest === null
        ? "not-provided"
        : "verified"
    },
    sources: {
      community: {
        ...communitySource.metadata,
        url: communitySource.url,
        byteLength: communityPayload.byteLength,
        sha256: communitySha256,
        expectedSha256: communitySource.expectedDigest,
        digestVerified: communitySource.expectedDigest === null
          ? "not-provided"
          : "verified"
      },
      officialGallery: {
        sourceType: "official-card-gallery",
        url: official.url,
        buildId: official.buildId,
        metadata: official.metadata,
        resultsUpdatedAt: official.resultsUpdatedAt,
        localeMismatchRetried: official.localeMismatchRetried,
        recordCount: official.cards.length,
        setRecordCounts: setCounts(
          official.cards,
          (card) => card.set?.value?.id ?? "unknown"
        ),
        reconciliation: official.reconciliation,
        byteLength: official.byteLength,
        sha256: official.sha256,
        fetchedAt
      },
      officialGalleryZhCn: {
        sourceType: "official-card-gallery",
        url: localized.url,
        buildId: localized.buildId,
        metadata: localized.metadata,
        resultsUpdatedAt: localized.resultsUpdatedAt,
        localeMismatchRetried: localized.localeMismatchRetried,
        recordCount: localized.cards.length,
        setRecordCounts: setCounts(
          localized.cards,
          (card) => card.set?.value?.id ?? "unknown"
        ),
        reconciliation: localized.reconciliation,
        byteLength: localized.byteLength,
        sha256: localized.sha256,
        fetchedAt
      }
    },
    coverage: {
      officialCardCount: official.cards.length,
      localizedOfficialCardCount: localized.cards.length,
      communityCardCount: communityCards.length,
      mergedCardCount: merged.cards.length,
      errataAnnotationCount: merged.cards.filter(
        (card) => card.hasErrata
      ).length,
      missingFromCommunity: merged.missingFromCommunity,
      communityOnly: merged.communityOnly,
      officialSetCounts: setCounts(
        official.cards,
        (card) => card.set?.value?.id ?? "unknown"
      ),
      mergedSetCounts: setCounts(merged.cards, (card) => card.setCode)
    },
    cards: merged.cards,
    officialGallery: {
      url: official.url,
      buildId: official.buildId,
      resultsUpdatedAt: official.resultsUpdatedAt,
      metadata: official.metadata,
      reconciliation: official.reconciliation,
      setRecordCounts: setCounts(
        official.cards,
        (card) => card.set?.value?.id ?? "unknown"
      ),
      pages: official.pages,
      sets: official.sets,
      cards: official.cards
    },
    localizedGalleries: {
      "en-US": {
        url: official.url,
        buildId: official.buildId,
        resultsUpdatedAt: official.resultsUpdatedAt,
        metadata: official.metadata,
        reconciliation: official.reconciliation,
        setRecordCounts: setCounts(
          official.cards,
          (card) => card.set?.value?.id ?? "unknown"
        ),
        pages: official.pages,
        sets: official.sets,
        cards: official.cards
      },
      "zh-CN": {
        url: localized.url,
        buildId: localized.buildId,
        resultsUpdatedAt: localized.resultsUpdatedAt,
        metadata: localized.metadata,
        reconciliation: localized.reconciliation,
        setRecordCounts: setCounts(
          localized.cards,
          (card) => card.set?.value?.id ?? "unknown"
        ),
        pages: localized.pages,
        sets: localized.sets,
        cards: localized.cards
      }
    },
    bundle
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  const outputPath = resolveOutputPath(options.output);
  const catalogPath = resolveCatalogOutputPath(options.catalogOutput);
  const catalog = {
    schemaVersion: 1,
    dataVersion,
    digest: bundle.dataSet.digest,
    source: {
      officialGalleryUrl: official.url,
      localizedGalleryUrl: localized.url,
      generatedAt: fetchedAt
    },
    cards: merged.cards.map((card) => ({
      id: card.cardCode,
      cardCode: card.cardCode,
      imageUrl: card.imageUrl
    }))
  };
  const catalogSerialized = `${JSON.stringify(catalog, null, 2)}\n`;
  const errataReports = [];
  const deckCatalog = buildDeckCatalog(output, { errata: errataReports });
  const errataReport = errataReports[0];
  if (errataReport !== undefined) {
    log(
      `Errata: ${errataReport.stats.annotations} annotated printings; ` +
      `${errataReport.stats.changed} resolved to corrected text; ` +
      `${errataReport.stats.unchanged} already match their printed text; ` +
      `${errataReport.stats.propagated} inherited by an identical sibling ` +
      `printing; ${errataReport.stats.unresolved} left printed.`
    );
    if (errataReport.unresolved.length > 0) {
      log(
        `Errata left printed (judge-required): ` +
        errataReport.unresolved
          .map((entry) => `${entry.printingId} (${entry.reason})`)
          .join(", ") + "."
      );
    }
  }

  if (options.dryRun) {
    log(
      `Dry run complete: ${merged.cards.length} current cards; ` +
      `${merged.missingFromCommunity.length} filled from official gallery. ` +
      `No file written. Output would be ${outputPath}; ` +
      `image catalog would be ${catalogPath}.`
    );
    return { ...output, catalog, errata: errataReport };
  }

  await writeAtomically(outputPath, serialized);
  await writeAtomically(catalogPath, catalogSerialized);
  await writeAtomically(DECK_CATALOG_PATH, `${JSON.stringify(deckCatalog, null, 2)}\n`);
  log(
    `Synced ${merged.cards.length} current cards to ${outputPath}; ` +
    `${merged.missingFromCommunity.length} official-only records merged. ` +
    `Image catalog written to ${catalogPath}; deck catalog written to ${DECK_CATALOG_PATH}.`
  );
  return { ...output, catalog, errata: errataReport };
}

function formatError(error, timeoutMs) {
  if (error instanceof CurrentCardsSyncError) return error.message;
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      error.code === "ABORT_ERR")
  ) {
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
    await run(options, { log });
    return 0;
  } catch (error) {
    logError(`sync-current-cards failed: ${formatError(error, options.timeoutMs)}`);
    return 1;
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  process.exitCode = await main();
}
