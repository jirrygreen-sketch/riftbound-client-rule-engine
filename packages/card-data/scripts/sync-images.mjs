#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 8;
export const DEFAULT_RETRIES = 2;
export const OFFICIAL_IMAGE_HOST = "cmsassets.rgpub.io";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG_PATH = path.resolve(
  SCRIPT_DIRECTORY,
  "../data/catalog.json"
);
const DEFAULT_OUTPUT_DIRECTORY = path.resolve(
  SCRIPT_DIRECTORY,
  "../data/images"
);
const DEFAULT_MANIFEST_PATH = path.resolve(
  SCRIPT_DIRECTORY,
  "../data/images-manifest.json"
);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 250;

const IMAGE_TYPES = {
  jpeg: {
    extension: "jpg",
    contentTypes: new Set(["image/jpeg", "image/jpg"])
  },
  png: {
    extension: "png",
    contentTypes: new Set(["image/png"])
  },
  webp: {
    extension: "webp",
    contentTypes: new Set(["image/webp"])
  },
  avif: {
    extension: "avif",
    contentTypes: new Set(["image/avif"])
  }
};

const usage = `Usage:
  node scripts/sync-images.mjs [options]

Downloads card images referenced by a catalog and writes an image manifest.

Options:
  --catalog <file>            Catalog JSON file. Default:
                              ../data/catalog.json relative to this script.
  --output <directory>        Image output directory. Default:
                              ../data/images relative to this script.
  --manifest <file>           Manifest output file. Default:
                              ../data/images-manifest.json relative to this
                              script.
  --concurrency <number>      Parallel downloads (1-8). Default: 4.
  --timeout-ms <milliseconds> Per-request timeout. Default: 30000.
  --retries <number>          Retries after the first attempt (0-5).
                              Default: 2.
  --limit <number>            Download only the first N catalog entries and
                              mark the manifest as partial.
  --dry-run                   Read the catalog and check existing files
                              without downloads or writes.
  -h, --help                  Show this help.

Only HTTPS URLs on ${OFFICIAL_IMAGE_HOST} are accepted. Existing files are
resumed only when their SHA-256, byte length, URL, and content type match the
previous manifest. Downloads are validated before an atomic same-directory
rename.
`;

export class SyncImagesError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SyncImagesError";
  }
}

class ImageRequestError extends SyncImagesError {
  constructor(message, retryable, options = {}) {
    super(message, options);
    this.name = "ImageRequestError";
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    throw new SyncImagesError(`${optionName} requires a value`);
  }
  return {
    value: next,
    nextIndex: index + 1
  };
}

function parseIntegerOption(
  value,
  optionName,
  minimum,
  maximum,
  description
) {
  if (!/^[0-9]+$/.test(value)) {
    throw new SyncImagesError(
      `${optionName} must be ${description}`
    );
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new SyncImagesError(
      `${optionName} must be ${description}`
    );
  }
  return parsed;
}

export function parseArguments(argv) {
  const options = {
    catalog: undefined,
    output: undefined,
    manifest: undefined,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: DEFAULT_RETRIES,
    limit: undefined,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--catalog" || argument.startsWith("--catalog=")) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--catalog"
      );
      if (value.trim() === "") {
        throw new SyncImagesError("--catalog requires a non-empty file path");
      }
      options.catalog = value;
      index = nextIndex;
    } else if (argument === "--output" || argument.startsWith("--output=")) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--output"
      );
      if (value.trim() === "") {
        throw new SyncImagesError(
          "--output requires a non-empty directory path"
        );
      }
      options.output = value;
      index = nextIndex;
    } else if (
      argument === "--manifest" ||
      argument.startsWith("--manifest=")
    ) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--manifest"
      );
      if (value.trim() === "") {
        throw new SyncImagesError(
          "--manifest requires a non-empty file path"
        );
      }
      options.manifest = value;
      index = nextIndex;
    } else if (
      argument === "--concurrency" ||
      argument.startsWith("--concurrency=")
    ) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--concurrency"
      );
      options.concurrency = parseIntegerOption(
        value,
        "--concurrency",
        1,
        MAX_CONCURRENCY,
        `an integer between 1 and ${MAX_CONCURRENCY}`
      );
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
      options.timeoutMs = parseIntegerOption(
        value,
        "--timeout-ms",
        1,
        3_600_000,
        "an integer between 1 and 3600000"
      );
      index = nextIndex;
    } else if (
      argument === "--retries" ||
      argument.startsWith("--retries=")
    ) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--retries"
      );
      options.retries = parseIntegerOption(
        value,
        "--retries",
        0,
        MAX_RETRIES,
        `an integer between 0 and ${MAX_RETRIES}`
      );
      index = nextIndex;
    } else if (argument === "--limit" || argument.startsWith("--limit=")) {
      const { value, nextIndex } = readOptionValue(
        argv,
        index,
        argument,
        "--limit"
      );
      options.limit = parseIntegerOption(
        value,
        "--limit",
        1,
        100_000,
        "an integer between 1 and 100000"
      );
      index = nextIndex;
    } else {
      throw new SyncImagesError(`Unknown option: ${argument}`);
    }
  }

  return options;
}

export function resolveDefaultPaths() {
  return {
    catalog: DEFAULT_CATALOG_PATH,
    output: DEFAULT_OUTPUT_DIRECTORY,
    manifest: DEFAULT_MANIFEST_PATH
  };
}

function resolveUserPath(value, fallback) {
  return value === undefined
    ? fallback
    : path.resolve(process.cwd(), value);
}

export function resolvePaths(options = {}) {
  const defaults = resolveDefaultPaths();
  return {
    catalog: resolveUserPath(options.catalog, defaults.catalog),
    output: resolveUserPath(options.output, defaults.output),
    manifest: resolveUserPath(options.manifest, defaults.manifest)
  };
}

export function isSafeImageId(id) {
  return typeof id === "string" && SAFE_ID_PATTERN.test(id);
}

function normalizeDigest(value) {
  if (typeof value !== "string") return null;
  if (SHA256_PATTERN.test(value)) return value;
  if (/^[a-f0-9]{64}$/.test(value)) return `sha256:${value}`;
  return null;
}

function firstNonEmptyString(records, keys) {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
      }
    }
  }
  return null;
}

function extractCatalogReference(catalog) {
  const nestedRecords = [
    catalog.sourceCatalog,
    catalog.catalog,
    catalog.manifest,
    catalog.source
  ].filter(isRecord);
  const records = [catalog, ...nestedRecords];
  const dataVersion = firstNonEmptyString(records, [
    "dataVersion",
    "catalogDataVersion"
  ]);
  const rawDigest = firstNonEmptyString(records, [
    "digest",
    "catalogDigest",
    "sourceDigest"
  ]);
  const digest = normalizeDigest(rawDigest);

  if (dataVersion === null) {
    throw new SyncImagesError(
      "catalog must provide a non-empty dataVersion"
    );
  }
  if (digest === null) {
    throw new SyncImagesError(
      "catalog must provide a SHA-256 digest"
    );
  }
  return { dataVersion, digest };
}

function validateOfficialImageUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return {
      url: null,
      error: "imageUrl must be a non-empty HTTPS URL"
    };
  }

  const urlText = value.trim();
  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    return {
      url: null,
      error: "imageUrl is not a valid URL"
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      url: null,
      error: "imageUrl must use HTTPS"
    };
  }
  if (parsed.hostname !== OFFICIAL_IMAGE_HOST) {
    return {
      url: null,
      error: `imageUrl host must be ${OFFICIAL_IMAGE_HOST}`
    };
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.port !== "" && parsed.port !== "443")
  ) {
    return {
      url: null,
      error: `imageUrl must target the official ${OFFICIAL_IMAGE_HOST} HTTPS endpoint`
    };
  }

  return { url: urlText, error: null };
}

export function normalizeCatalog(catalog) {
  if (!isRecord(catalog)) {
    throw new SyncImagesError("catalog must be a JSON object");
  }
  if (!Array.isArray(catalog.cards) || catalog.cards.length === 0) {
    throw new SyncImagesError("catalog.cards must be a non-empty array");
  }

  const sourceCatalog = extractCatalogReference(catalog);
  const ids = new Set();
  const cards = catalog.cards.map((card, index) => {
    if (!isRecord(card)) {
      throw new SyncImagesError(`catalog.cards[${index}] must be an object`);
    }
    if (!isSafeImageId(card.id)) {
      throw new SyncImagesError(
        `catalog.cards[${index}]: id must match the safe image id whitelist`
      );
    }
    if (ids.has(card.id)) {
      throw new SyncImagesError(
        `catalog.cards[${index}]: duplicate id ${card.id}`
      );
    }
    ids.add(card.id);

    if (card.imageUrl === null || card.imageUrl === undefined) {
      return {
        id: card.id,
        imageUrl: null,
        missing: true,
        urlError: null,
        index
      };
    }

    const validated = validateOfficialImageUrl(card.imageUrl);
    return {
      id: card.id,
      imageUrl: validated.url,
      missing: false,
      urlError: validated.error,
      index
    };
  });

  return { sourceCatalog, cards };
}

export function detectImageType(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }

  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const boxSize = bytes.readUInt32BE(0);
    if (boxSize >= 16 && boxSize <= bytes.length && boxSize % 4 === 0) {
      for (let offset = 8; offset < boxSize; offset += 4) {
        if (offset !== 12 && bytes.toString("ascii", offset, offset + 4) === "avif") {
          return "avif";
        }
      }
    }
  }

  return null;
}

function hasValidPngStructure(bytes) {
  if (detectImageType(bytes) !== "png") return false;

  let offset = 8;
  let sawHeader = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return false;

    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    if (!sawHeader) {
      if (chunkType !== "IHDR" || length !== 13) return false;
      sawHeader = true;
    } else if (chunkType === "IHDR") {
      return false;
    }
    if (chunkType === "IEND") {
      if (length !== 0 || chunkEnd !== bytes.length) return false;
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
  }

  return sawHeader && sawEnd;
}

function hasValidJpegStructure(bytes) {
  return (
    detectImageType(bytes) === "jpeg" &&
    bytes.length >= 4 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

function hasValidWebpStructure(bytes) {
  if (detectImageType(bytes) !== "webp" || bytes.length < 12) {
    return false;
  }
  const declaredLength = bytes.readUInt32LE(4);
  return declaredLength + 8 === bytes.length;
}

function hasValidAvifStructure(bytes) {
  if (detectImageType(bytes) !== "avif") return false;
  let offset = 0;
  let sawMetadata = false;
  let sawData = false;
  // Check the ISO BMFF box boundaries before caching the CDN's AVIF response.
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) return false;
      const extendedSize = bytes.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = bytes.length - offset;
    }
    if (size < headerSize || offset + size > bytes.length) return false;
    if (type === "meta" && size > headerSize + 4) sawMetadata = true;
    if (type === "mdat" && size > headerSize) sawData = true;
    offset += size;
  }
  return offset === bytes.length && sawMetadata && sawData;
}

function hasValidImageStructure(type, bytes) {
  if (type === "png") return hasValidPngStructure(bytes);
  if (type === "jpeg") return hasValidJpegStructure(bytes);
  if (type === "webp") return hasValidWebpStructure(bytes);
  if (type === "avif") return hasValidAvifStructure(bytes);
  return false;
}

function parseContentType(value) {
  if (typeof value !== "string") return null;
  return value.split(";", 1)[0].trim().toLowerCase();
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isTimeoutError(error) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      error.code === "ABORT_ERR")
  );
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error) {
  if (error instanceof ImageRequestError) return error.retryable;
  return isTimeoutError(error) || error instanceof TypeError;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatDownloadError(error, timeoutMs, attempts) {
  const attemptSuffix = attempts > 1 ? ` after ${attempts} attempts` : "";
  if (isTimeoutError(error)) {
    return `request timed out after ${timeoutMs}ms${attemptSuffix}`;
  }
  if (error instanceof ImageRequestError) {
    return `${error.message}${attemptSuffix}`;
  }
  if (error instanceof TypeError) {
    return `network request failed${attemptSuffix}`;
  }
  if (error instanceof SyncImagesError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function fetchImageOnce(url, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      Accept: "image/png,image/jpeg,image/webp,image/avif,*/*;q=0.1",
      "User-Agent": "@riftbound/card-data sync-images"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (response.url !== "") {
    const finalUrl = validateOfficialImageUrl(response.url);
    if (finalUrl.error !== null) {
      throw new ImageRequestError(
        `redirected to a non-official image endpoint: ${finalUrl.error}`,
        false
      );
    }
  }

  if (!response.ok) {
    throw new ImageRequestError(
      `upstream returned HTTP ${response.status}`,
      isRetryableStatus(response.status)
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = parseContentType(response.headers.get("content-type"));
  const detectedType = detectImageType(bytes);
  if (contentType === null) {
    throw new ImageRequestError(
      "response is missing a supported image content-type",
      false
    );
  }
  if (detectedType === null) {
    throw new ImageRequestError(
      "response body does not have PNG, JPEG, WebP, or AVIF magic",
      false
    );
  }
  if (!hasValidImageStructure(detectedType, bytes)) {
    throw new ImageRequestError(
      `response body has incomplete ${detectedType.toUpperCase()} structure`,
      false
    );
  }

  const imageType = IMAGE_TYPES[detectedType];
  if (!imageType.contentTypes.has(contentType)) {
    throw new ImageRequestError(
      `response content-type ${contentType} does not match ${detectedType} magic`,
      false
    );
  }

  return {
    bytes,
    contentType,
    extension: imageType.extension,
    sha256: sha256(bytes)
  };
}

export async function downloadImage(url, options) {
  const validated = validateOfficialImageUrl(url);
  if (validated.error !== null) {
    throw new SyncImagesError(validated.error);
  }

  let attempts = 0;
  let lastError;
  while (attempts <= options.retries) {
    attempts += 1;
    try {
      return await fetchImageOnce(validated.url, options.timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempts > options.retries) {
        throw new SyncImagesError(
          formatDownloadError(error, options.timeoutMs, attempts),
          { cause: error }
        );
      }
      await delay(
        Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempts - 1), 1_000)
      );
    }
  }

  throw new SyncImagesError(
    formatDownloadError(lastError, options.timeoutMs, attempts),
    { cause: lastError }
  );
}

function resolveContainedPath(baseDirectory, fileName) {
  if (
    typeof fileName !== "string" ||
    fileName === "" ||
    path.basename(fileName) !== fileName
  ) {
    return null;
  }

  const resolvedBase = path.resolve(baseDirectory);
  const resolvedFile = path.resolve(resolvedBase, fileName);
  const relative = path.relative(resolvedBase, resolvedFile);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return resolvedFile;
}

function imageFileName(id, extension) {
  if (!isSafeImageId(id) || !/^(?:jpg|png|webp|avif)$/.test(extension)) {
    return null;
  }
  return `${id}.${extension}`;
}

function extensionForContentType(contentType) {
  for (const type of Object.values(IMAGE_TYPES)) {
    if (type.contentTypes.has(contentType)) return type.extension;
  }
  return null;
}

async function readPreviousManifest(manifestPath, imagesDirectory) {
  let contents;
  try {
    contents = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw new SyncImagesError(
      `unable to read previous manifest ${manifestPath}: ${error.message}`,
      { cause: error }
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(contents);
  } catch {
    return new Map();
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.images)) {
    return new Map();
  }

  const entries = new Map();
  for (const entry of manifest.images) {
    if (
      !isRecord(entry) ||
      !isSafeImageId(entry.id) ||
      typeof entry.url !== "string" ||
      !SHA256_PATTERN.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.contentType !== "string"
    ) {
      continue;
    }

    const extension = extensionForContentType(entry.contentType);
    const expectedName =
      extension === null ? null : imageFileName(entry.id, extension);
    if (expectedName === null || entry.file !== expectedName) {
      continue;
    }
    const filePath = resolveContainedPath(imagesDirectory, entry.file);
    if (filePath === null) continue;

    entries.set(entry.id, {
      id: entry.id,
      file: entry.file,
      filePath,
      url: entry.url,
      sha256: entry.sha256,
      bytes: entry.bytes,
      contentType: entry.contentType
    });
  }
  return entries;
}

async function resumeImage(card, previous, imagesDirectory) {
  const entry = previous.get(card.id);
  if (
    entry === undefined ||
    entry.url !== card.imageUrl ||
    path.dirname(entry.filePath) !== path.resolve(imagesDirectory)
  ) {
    return null;
  }

  try {
    const fileStat = await stat(entry.filePath);
    if (!fileStat.isFile()) return null;
    const bytes = await readFile(entry.filePath);
    if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) {
      return null;
    }

    const detectedType = detectImageType(bytes);
    const expectedExtension = extensionForContentType(entry.contentType);
    if (
      detectedType === null ||
      expectedExtension === null ||
      IMAGE_TYPES[detectedType].extension !== expectedExtension ||
      !hasValidImageStructure(detectedType, bytes)
    ) {
      return null;
    }

    return {
      id: card.id,
      file: entry.file,
      url: card.imageUrl,
      sha256: entry.sha256,
      bytes: entry.bytes,
      contentType: entry.contentType,
      status: "resumed"
    };
  } catch {
    return null;
  }
}

async function writeAtomically(filePath, contents) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runner()
  );
  await Promise.all(runners);
  return results;
}

async function processCard(card, context) {
  if (card.missing) {
    return { kind: "missing", id: card.id };
  }
  if (card.urlError !== null) {
    return {
      kind: "failure",
      entry: {
        id: card.id,
        url: typeof card.imageUrl === "string" ? card.imageUrl : null,
        error: card.urlError
      }
    };
  }

  const resumed = await resumeImage(
    card,
    context.previous,
    context.imagesDirectory
  );
  if (resumed !== null) {
    return { kind: "image", entry: resumed, resumed: true };
  }

  try {
    const image = await downloadImage(card.imageUrl, {
      timeoutMs: context.timeoutMs,
      retries: context.retries
    });
    const fileName = imageFileName(card.id, image.extension);
    if (fileName === null) {
      throw new SyncImagesError("generated image filename is not safe");
    }
    const filePath = resolveContainedPath(context.imagesDirectory, fileName);
    if (filePath === null) {
      throw new SyncImagesError("generated image path escaped the output directory");
    }

    await writeAtomically(filePath, image.bytes);
    return {
      kind: "image",
      resumed: false,
      entry: {
        id: card.id,
        file: fileName,
        url: card.imageUrl,
        sha256: image.sha256,
        bytes: image.bytes.byteLength,
        contentType: image.contentType,
        status: "downloaded"
      }
    };
  } catch (error) {
    return {
      kind: "failure",
      entry: {
        id: card.id,
        url: card.imageUrl,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function collectResults(processed) {
  const images = [];
  const missing = [];
  const failures = [];
  let downloaded = 0;
  let resumed = 0;

  for (const result of processed) {
    if (result.kind === "image") {
      images.push(result.entry);
      if (result.resumed) resumed += 1;
      else downloaded += 1;
    } else if (result.kind === "missing") {
      missing.push(result.id);
    } else {
      failures.push(result.entry);
    }
  }

  return { images, missing, failures, downloaded, resumed };
}

async function readCatalog(catalogPath) {
  let contents;
  try {
    contents = await readFile(catalogPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new SyncImagesError(
        `catalog file not found: ${catalogPath}`,
        { cause: error }
      );
    }
    throw new SyncImagesError(
      `unable to read catalog ${catalogPath}: ${error.message}`,
      { cause: error }
    );
  }

  try {
    return JSON.parse(contents);
  } catch {
    throw new SyncImagesError(`catalog is not valid JSON: ${catalogPath}`);
  }
}

function validateRunOptions(options) {
  if (
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > MAX_CONCURRENCY
  ) {
    throw new SyncImagesError(
      `concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`
    );
  }
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 3_600_000
  ) {
    throw new SyncImagesError(
      "timeoutMs must be an integer between 1 and 3600000"
    );
  }
  if (
    !Number.isSafeInteger(options.retries) ||
    options.retries < 0 ||
    options.retries > MAX_RETRIES
  ) {
    throw new SyncImagesError(
      `retries must be an integer between 0 and ${MAX_RETRIES}`
    );
  }
  if (
    options.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100_000)
  ) {
    throw new SyncImagesError(
      "limit must be an integer between 1 and 100000"
    );
  }
}

function createManifest(options, normalized, selected, collected) {
  const partial = options.limit !== undefined;
  const ok = collected.missing.length === 0 &&
    collected.failures.length === 0;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    partial,
    ok,
    sourceCatalog: normalized.sourceCatalog,
    options: {
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
      limit: options.limit ?? null
    },
    counts: {
      catalogCards: normalized.cards.length,
      selectedCards: selected.length,
      downloaded: collected.downloaded,
      resumed: collected.resumed,
      missing: collected.missing.length,
      failed: collected.failures.length
    },
    images: collected.images,
    missing: collected.missing,
    failures: collected.failures
  };
}

export async function runSync(options) {
  validateRunOptions(options);
  const paths = resolvePaths(options);
  const catalog = normalizeCatalog(await readCatalog(paths.catalog));
  const selected = options.limit === undefined
    ? catalog.cards
    : catalog.cards.slice(0, options.limit);
  const previous = await readPreviousManifest(paths.manifest, paths.output);

  if (options.dryRun) {
    let resumed = 0;
    let missing = 0;
    let failures = 0;
    let pending = 0;

    for (const card of selected) {
      if (card.missing) {
        missing += 1;
      } else if (card.urlError !== null) {
        failures += 1;
      } else if (await resumeImage(card, previous, paths.output) !== null) {
        resumed += 1;
      } else {
        pending += 1;
      }
    }

    return {
      dryRun: true,
      ok: missing === 0 && failures === 0,
      partial: options.limit !== undefined,
      paths,
      counts: {
        catalogCards: catalog.cards.length,
        selectedCards: selected.length,
        downloaded: 0,
        resumed,
        missing,
        failed: failures,
        pending,
        total: selected.length
      },
      missingIds: selected.filter((card) => card.missing).map((card) => card.id),
      failedIds: selected
        .filter((card) => !card.missing && card.urlError !== null)
        .map((card) => card.id)
    };
  }

  const processed = await mapWithConcurrency(
    selected,
    options.concurrency,
    (card) => processCard(card, {
      previous,
      imagesDirectory: paths.output,
      timeoutMs: options.timeoutMs,
      retries: options.retries
    })
  );
  const collected = collectResults(processed);
  const manifest = createManifest(options, catalog, selected, collected);
  await writeAtomically(
    paths.manifest,
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  return {
    dryRun: false,
    ok: manifest.ok,
    partial: manifest.partial,
    paths,
    manifest,
    counts: {
      ...manifest.counts,
      pending: 0,
      total: selected.length
    },
    missingIds: manifest.missing,
    failedIds: manifest.failures.map((failure) => failure.id)
  };
}

function summaryText(result) {
  const { counts } = result;
  return (
    `total=${counts.total} downloaded=${counts.downloaded} ` +
    `resumed=${counts.resumed} missing=${counts.missing} ` +
    `failed=${counts.failed} pending=${counts.pending} ` +
    `partial=${result.partial}`
  );
}

function formatError(error, options) {
  if (error instanceof SyncImagesError) return error.message;
  if (isTimeoutError(error)) {
    return `request timed out after ${options.timeoutMs}ms`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log ?? console.log;
  const logError = io.error ?? console.error;
  let options = {
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  try {
    options = parseArguments(argv);
    if (options.help) {
      log(usage);
      return 0;
    }

    const result = await runSync(options);
    const summary = summaryText(result);
    if (result.dryRun) {
      log(`Dry run: ${summary}; no files written`);
      if (result.ok) return 0;
    } else if (result.ok) {
      log(
        `Image sync complete: ${summary}; ` +
        `manifest=${result.paths.manifest}`
      );
      return 0;
    } else {
      log(
        `Image sync incomplete: ${summary}; ` +
        `manifest=${result.paths.manifest}`
      );
    }

    if (result.missingIds.length > 0) {
      logError(`Missing imageUrl for ids: ${result.missingIds.join(", ")}`);
    }
    if (result.failedIds.length > 0) {
      logError(`Failed image ids: ${result.failedIds.join(", ")}`);
      const failureDetails = result.manifest?.failures
        ?.map((failure) => `${failure.id}: ${failure.error}`)
        .join("; ");
      if (failureDetails !== undefined && failureDetails !== "") {
        logError(`Image failures: ${failureDetails}`);
      }
    }
    logError(`sync-images failed: ${summary}`);
    return 1;
  } catch (error) {
    logError(`sync-images failed: ${formatError(error, options)}`);
    return 1;
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  process.exitCode = await main();
}
