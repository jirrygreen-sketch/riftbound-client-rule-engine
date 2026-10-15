#!/usr/bin/env node

// Offline verifier for the tracked rule-source manifest.
//
// It validates docs/rule-source-manifest.json (schema, https URLs, dates,
// sha256 shape) and, when the gitignored local PDFs happen to exist, recomputes
// their SHA-256 and compares it against the manifest. It never touches the
// network and never downloads anything.
//
// Modes:
//   default        validate the manifest AND hash any local file that exists.
//                  Files that are absent are reported as "missing" but do not
//                  fail the run (pass --require-local to make them fatal).
//   manifest-only  validate the manifest only; local files are skipped, so the
//                  run passes even when no local PDF is present.
//
// --require-local is meaningless with --manifest-only (nothing is checked), so
// combining them is rejected as a conflicting-argument error instead of
// silently reporting success.

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const MANIFEST_SCHEMA_VERSION = 1;
export const SOURCE_KINDS = Object.freeze([
  "core-rules",
  "tournament-rules",
  "official-announcement",
  "official-faq"
]);
export const SOURCE_STATUSES = Object.freeze(["active", "published-future"]);
export const HASH_STATUSES = Object.freeze(["verified", "pending"]);
export const MODES = Object.freeze(["default", "manifest-only"]);

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIRECTORY, "../../..");
export const DEFAULT_MANIFEST_PATH = path.resolve(
  SCRIPT_DIRECTORY,
  "../../../docs/rule-source-manifest.json"
);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^riftbound\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const URL_ROLE_PATTERN = /^[a-z][a-z0-9-]*$/;
const UNKNOWN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const SOURCE_ALLOWED_KEYS = new Set([
  "id",
  "title",
  "kind",
  "version",
  "status",
  "lastUpdated",
  "effectiveDate",
  "sha256",
  "hashStatus",
  "urls",
  "localFiles",
  "sourcesCited",
  "notes"
]);
const SOURCE_REQUIRED_KEYS = [
  "id",
  "title",
  "kind",
  "version",
  "status",
  "lastUpdated",
  "effectiveDate",
  "sha256",
  "hashStatus",
  "urls",
  "localFiles"
];
const URL_ALLOWED_KEYS = new Set(["role", "url"]);
const LOCAL_FILE_ALLOWED_KEYS = new Set(["path", "sha256"]);
const TOP_LEVEL_ALLOWED_KEYS = new Set([
  "schemaVersion",
  "generatedAt",
  "description",
  "sources"
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.length > 0;
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (path.isAbsolute(value) || value.startsWith("~")) {
    return false;
  }
  const segments = value.split(/[\\/]+/);
  return !segments.some((segment) => segment === ".." || segment === "");
}

function pushExtraKeyErrors(value, allowed, pathPrefix, errors, context) {
  for (const key of Object.keys(value)) {
    if (UNKNOWN_KEYS.has(key) || !allowed.has(key)) {
      errors.push({
        path: `${pathPrefix}.${key}`,
        message: `unexpected key "${key}" in ${context}`
      });
    }
  }
}

export function validateManifest(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return {
      ok: false,
      errors: [{ path: "$", message: "manifest must be a JSON object" }]
    };
  }

  pushExtraKeyErrors(manifest, TOP_LEVEL_ALLOWED_KEYS, "$", errors, "manifest");

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push({
      path: "$.schemaVersion",
      message: `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`
    });
  }
  if (
    manifest.generatedAt !== undefined &&
    !isValidCalendarDate(manifest.generatedAt)
  ) {
    errors.push({
      path: "$.generatedAt",
      message: "generatedAt must be a YYYY-MM-DD calendar date"
    });
  }
  if (
    manifest.description !== undefined &&
    (typeof manifest.description !== "string" || manifest.description.length === 0)
  ) {
    errors.push({
      path: "$.description",
      message: "description must be a non-empty string"
    });
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    errors.push({
      path: "$.sources",
      message: "sources must be a non-empty array"
    });
    return { ok: false, errors };
  }

  const seenIds = new Set();
  manifest.sources.forEach((source, index) => {
    const prefix = `$.sources[${index}]`;
    if (!isPlainObject(source)) {
      errors.push({ path: prefix, message: "source must be a JSON object" });
      return;
    }

    pushExtraKeyErrors(source, SOURCE_ALLOWED_KEYS, prefix, errors, "source");

    for (const key of SOURCE_REQUIRED_KEYS) {
      if (!(key in source)) {
        errors.push({ path: `${prefix}.${key}`, message: `missing required key "${key}"` });
      }
    }

    if (typeof source.id !== "string" || !ID_PATTERN.test(source.id)) {
      errors.push({
        path: `${prefix}.id`,
        message: 'id must match "riftbound.<name>" (lowercase, dot/dash separated)'
      });
    } else if (seenIds.has(source.id)) {
      errors.push({ path: `${prefix}.id`, message: `duplicate source id "${source.id}"` });
    } else {
      seenIds.add(source.id);
    }

    if (typeof source.title !== "string" || source.title.length === 0) {
      errors.push({ path: `${prefix}.title`, message: "title must be a non-empty string" });
    }
    if (!SOURCE_KINDS.includes(source.kind)) {
      errors.push({
        path: `${prefix}.kind`,
        message: `kind must be one of ${SOURCE_KINDS.join(", ")}`
      });
    }
    if (typeof source.version !== "string" || source.version.length === 0) {
      errors.push({ path: `${prefix}.version`, message: "version must be a non-empty string" });
    }
    if (!SOURCE_STATUSES.includes(source.status)) {
      errors.push({
        path: `${prefix}.status`,
        message: `status must be one of ${SOURCE_STATUSES.join(", ")}`
      });
    }
    for (const dateKey of ["lastUpdated", "effectiveDate"]) {
      const value = source[dateKey];
      if (value !== null && !isValidCalendarDate(value)) {
        errors.push({
          path: `${prefix}.${dateKey}`,
          message: `${dateKey} must be null or a YYYY-MM-DD calendar date`
        });
      }
    }

    if (source.sha256 !== null && !SHA256_PATTERN.test(String(source.sha256))) {
      errors.push({
        path: `${prefix}.sha256`,
        message: "sha256 must be null or 64 lowercase hex characters"
      });
    }
    if (!HASH_STATUSES.includes(source.hashStatus)) {
      errors.push({
        path: `${prefix}.hashStatus`,
        message: `hashStatus must be one of ${HASH_STATUSES.join(", ")}`
      });
    } else if (source.sha256 === null && source.hashStatus !== "pending") {
      errors.push({
        path: `${prefix}.hashStatus`,
        message: 'hashStatus must be "pending" when sha256 is null'
      });
    } else if (source.sha256 !== null && source.hashStatus !== "verified") {
      errors.push({
        path: `${prefix}.hashStatus`,
        message: 'hashStatus must be "verified" when sha256 is set'
      });
    }

    if (!Array.isArray(source.urls) || source.urls.length === 0) {
      errors.push({ path: `${prefix}.urls`, message: "urls must be a non-empty array" });
    } else {
      source.urls.forEach((entry, urlIndex) => {
        const urlPrefix = `${prefix}.urls[${urlIndex}]`;
        if (!isPlainObject(entry)) {
          errors.push({ path: urlPrefix, message: "url entry must be a JSON object" });
          return;
        }
        pushExtraKeyErrors(entry, URL_ALLOWED_KEYS, urlPrefix, errors, "url entry");
        if (typeof entry.role !== "string" || !URL_ROLE_PATTERN.test(entry.role)) {
          errors.push({
            path: `${urlPrefix}.role`,
            message: "role must be a lowercase dash-separated identifier"
          });
        }
        if (!isHttpsUrl(entry.url)) {
          errors.push({
            path: `${urlPrefix}.url`,
            message: "url must be an absolute https URL"
          });
        }
      });
    }

    if (!Array.isArray(source.localFiles)) {
      errors.push({ path: `${prefix}.localFiles`, message: "localFiles must be an array" });
    } else {
      source.localFiles.forEach((entry, fileIndex) => {
        const filePrefix = `${prefix}.localFiles[${fileIndex}]`;
        if (!isPlainObject(entry)) {
          errors.push({ path: filePrefix, message: "local file entry must be a JSON object" });
          return;
        }
        pushExtraKeyErrors(entry, LOCAL_FILE_ALLOWED_KEYS, filePrefix, errors, "local file entry");
        if (!isSafeRelativePath(entry.path)) {
          errors.push({
            path: `${filePrefix}.path`,
            message: "path must be a repo-relative path without traversal"
          });
        }
        if (
          entry.sha256 !== undefined &&
          entry.sha256 !== null &&
          !SHA256_PATTERN.test(String(entry.sha256))
        ) {
          errors.push({
            path: `${filePrefix}.sha256`,
            message: "sha256 must be null or 64 lowercase hex characters"
          });
        }
      });
    }

    if (source.sourcesCited !== undefined) {
      if (
        !Array.isArray(source.sourcesCited) ||
        source.sourcesCited.some((item) => typeof item !== "string" || item.length === 0)
      ) {
        errors.push({
          path: `${prefix}.sourcesCited`,
          message: "sourcesCited must be an array of non-empty strings"
        });
      }
    }
    if (source.notes !== undefined && typeof source.notes !== "string") {
      errors.push({ path: `${prefix}.notes`, message: "notes must be a string" });
    }
  });

  return { ok: errors.length === 0, errors };
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function defaultReadText(filePath) {
  return readFile(filePath, "utf8");
}

async function defaultStat(filePath) {
  try {
    const info = await stat(filePath);
    return { exists: info.isFile() };
  } catch {
    return { exists: false };
  }
}

async function defaultHashFile(filePath) {
  return sha256Hex(await readFile(filePath));
}

export async function verifyRuleSources({
  manifestPath = DEFAULT_MANIFEST_PATH,
  repoRoot = DEFAULT_REPO_ROOT,
  mode = "default",
  requireLocal = false,
  readText = defaultReadText,
  fileStat = defaultStat,
  hashFile = defaultHashFile
} = {}) {
  if (!MODES.includes(mode)) {
    throw new Error(`unsupported mode "${mode}" (expected ${MODES.join(" or ")})`);
  }
  if (mode === "manifest-only" && requireLocal) {
    throw new Error(
      "conflicting options: manifest-only skips local file checks, so requireLocal cannot be honored"
    );
  }

  const result = {
    ok: false,
    mode,
    requireLocal: Boolean(requireLocal),
    manifestPath,
    repoRoot,
    schema: { ok: false, errors: [] },
    sources: [],
    errors: [],
    summary: {
      sources: 0,
      verifiedHashes: 0,
      pendingHashes: 0,
      filesPresent: 0,
      filesMissing: 0,
      filesSkipped: 0,
      mismatches: 0
    }
  };

  let manifest;
  try {
    manifest = JSON.parse(await readText(manifestPath));
  } catch (error) {
    const reason = error && error.message ? error.message : String(error);
    // Always name the manifest path: fs errors usually embed it, JSON parse
    // errors do not, and the path is what makes the failure actionable.
    result.errors.push(
      reason.includes(manifestPath)
        ? `cannot read manifest: ${reason}`
        : `cannot read manifest: ${manifestPath}: ${reason}`
    );
    return result;
  }

  result.schema = validateManifest(manifest);
  if (!result.schema.ok) {
    result.errors.push(...result.schema.errors.map((e) => `${e.path}: ${e.message}`));
    return result;
  }

  result.summary.sources = manifest.sources.length;

  for (const source of manifest.sources) {
    const sourceReport = {
      id: source.id,
      sha256: source.sha256,
      hashStatus: source.hashStatus,
      files: []
    };
    if (source.sha256 === null) {
      result.summary.pendingHashes += 1;
    } else {
      result.summary.verifiedHashes += 1;
    }

    for (const localFile of source.localFiles) {
      const fileReport = {
        path: localFile.path,
        expectedSha256: localFile.sha256 ?? source.sha256,
        status: "skipped",
        actualSha256: null
      };

      if (mode === "manifest-only") {
        result.summary.filesSkipped += 1;
        sourceReport.files.push(fileReport);
        continue;
      }

      const absolutePath = path.resolve(repoRoot, localFile.path);
      const info = await fileStat(absolutePath);
      if (!info || !info.exists) {
        fileReport.status = "missing";
        result.summary.filesMissing += 1;
        if (requireLocal) {
          result.errors.push(`missing local file: ${localFile.path}`);
        }
        sourceReport.files.push(fileReport);
        continue;
      }

      result.summary.filesPresent += 1;
      fileReport.actualSha256 = await hashFile(absolutePath);
      if (fileReport.expectedSha256 === null) {
        fileReport.status = "unverifiable";
      } else if (fileReport.actualSha256 === fileReport.expectedSha256) {
        fileReport.status = "match";
      } else {
        fileReport.status = "mismatch";
        result.summary.mismatches += 1;
        result.errors.push(
          `sha256 mismatch for ${localFile.path}: expected ${fileReport.expectedSha256}, got ${fileReport.actualSha256}`
        );
      }
      sourceReport.files.push(fileReport);
    }

    result.sources.push(sourceReport);
  }

  result.ok =
    result.schema.ok &&
    result.summary.mismatches === 0 &&
    (!requireLocal || result.summary.filesMissing === 0) &&
    result.errors.length === 0;
  return result;
}

export function formatReport(report) {
  const lines = [];
  lines.push(
    `rule-source-manifest: mode=${report.mode} sources=${report.summary.sources} ok=${report.ok}`
  );
  if (!report.schema.ok) {
    lines.push("  schema: INVALID");
    for (const error of report.schema.errors) {
      lines.push(`    - ${error.path}: ${error.message}`);
    }
    // A manifest that could not be read at all leaves schema.errors empty and
    // carries the real (path-bearing) cause in report.errors; print those too
    // instead of exiting with a bare "schema: INVALID". Errors already shown as
    // per-field schema errors are skipped to avoid double reporting.
    const shownSchemaErrors = new Set(
      report.schema.errors.map((error) => `${error.path}: ${error.message}`)
    );
    for (const error of report.errors) {
      if (!shownSchemaErrors.has(error)) {
        lines.push(`  error: ${error}`);
      }
    }
    return lines.join("\n");
  }
  lines.push(
    `  hashes: verified=${report.summary.verifiedHashes} pending=${report.summary.pendingHashes}`
  );
  for (const source of report.sources) {
    lines.push(`  - ${source.id} [hashStatus=${source.hashStatus}]`);
    for (const file of source.files) {
      const actual = file.actualSha256 ? ` actual=${file.actualSha256}` : "";
      const expected = file.expectedSha256 ? ` expected=${file.expectedSha256}` : " expected=(pending)";
      lines.push(`      ${file.status.padEnd(11)} ${file.path}${expected}${actual}`);
    }
  }
  lines.push(
    `  files: present=${report.summary.filesPresent} missing=${report.summary.filesMissing} skipped=${report.summary.filesSkipped} mismatches=${report.summary.mismatches}`
  );
  for (const error of report.errors) {
    lines.push(`  error: ${error}`);
  }
  return lines.join("\n");
}

export function parseArguments(argv) {
  const options = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    repoRoot: DEFAULT_REPO_ROOT,
    mode: "default",
    requireLocal: false,
    json: false,
    help: false
  };
  for (const arg of argv) {
    if (arg === "--manifest-only") {
      options.mode = "manifest-only";
    } else if (arg === "--require-local") {
      options.requireLocal = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--manifest=")) {
      options.manifestPath = path.resolve(arg.slice("--manifest=".length));
    } else if (arg.startsWith("--repo-root=")) {
      options.repoRoot = path.resolve(arg.slice("--repo-root=".length));
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  if (options.mode === "manifest-only" && options.requireLocal) {
    throw new Error(
      "conflicting arguments: --manifest-only skips local file checks, so --require-local cannot be honored (run without --manifest-only to enforce local files)"
    );
  }
  return options;
}

const HELP_TEXT = `Usage: node scripts/verify-rule-sources.mjs [options]

Validate docs/rule-source-manifest.json and re-check local (gitignored) rule PDFs.
No network access; files are never downloaded.

Options:
  --manifest-only     validate the manifest only; skip local file checks
                      (mutually exclusive with --require-local)
  --require-local     fail when a listed local file is absent
                      (mutually exclusive with --manifest-only)
  --manifest=<path>   manifest path (default: docs/rule-source-manifest.json)
  --repo-root=<path>  repository root used to resolve local file paths
  --json              print the report as JSON
  --help, -h          show this help
`;

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const report = await verifyRuleSources(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(report)}\n`);
  }
  return report.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`verify-rule-sources: ${error.message}\n`);
      process.exitCode = 2;
    });
}
