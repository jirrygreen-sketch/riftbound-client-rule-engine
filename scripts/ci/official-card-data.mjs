/**
 * RIFT-14 shared helpers for the CI official-card-data policy.
 *
 * The official Riftbound catalog, deck catalog, image manifest and image cache
 * are gitignored on purpose: they are locally synchronized, copyright-bearing
 * generated outputs. A CI checkout therefore never contains them, and the
 * suites that read them cannot run there.
 *
 * These helpers only report facts. Reclassification of a failure into an
 * explicit skip is decided in \`analyze-workspace-test-log.mjs\`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Gitignored generated outputs that a CI checkout must never contain. */
export const OFFICIAL_CARD_DATA_PATHS = [
  "packages/card-data/data/deck-catalog.json",
  "packages/card-data/data/catalog.json",
  "packages/card-data/data/images-manifest.json",
  "packages/card-data/data/effect-coverage.json",
  "packages/card-data/dist/cards.json",
  "packages/card-data/data/images"
];

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function resolveRepoRoot(repoRoot) {
  return path.resolve(repoRoot ?? REPO_ROOT);
}

export function presentOfficialCardData(repoRoot) {
  const root = resolveRepoRoot(repoRoot);
  return OFFICIAL_CARD_DATA_PATHS.filter((relativePath) =>
    existsSync(path.join(root, relativePath))
  );
}

export function missingOfficialCardData(repoRoot) {
  const root = resolveRepoRoot(repoRoot);
  return OFFICIAL_CARD_DATA_PATHS.filter(
    (relativePath) => !existsSync(path.join(root, relativePath))
  );
}

/**
 * Strong markers name an absent file explicitly. A weak marker is only trusted
 * when it sits on the same line as the official data path, because the
 * game-server loader reports "Card catalog file not found: <path>".
 */
const STRONG_ABSENCE_MARKERS = [
  /ENOENT/i,
  /ERR_MODULE_NOT_FOUND/,
  /Cannot find module/i,
  /no such file or directory/i,
  /is required for this audit/i,
  /required official catalog missing/i
];

const WEAK_ABSENCE_MARKERS = [/not found/i, /missing/i];

function officialDataPathsMentioned(text) {
  return OFFICIAL_CARD_DATA_PATHS.filter(
    (relativePath) =>
      text.includes(relativePath) ||
      text.includes(relativePath.replace(/\//g, "\\"))
  );
}

function hasStrongAbsenceMarker(text) {
  return STRONG_ABSENCE_MARKERS.some((pattern) => pattern.test(text));
}

function hasAnyAbsenceMarker(text) {
  return (
    hasStrongAbsenceMarker(text) ||
    WEAK_ABSENCE_MARKERS.some((pattern) => pattern.test(text))
  );
}

/**
 * Every stderr-echo line (\`# ...\`) inside one TAP entry's evidence. Node echoes
 * module-load failures there, including multi-line blocks such as
 * \`code: 'ERR_MODULE_NOT_FOUND'\` on one line and \`url: 'file:///...'\` on the
 * next, so the reason and the path are not always on the same line. The evidence
 * belongs to exactly one entry, because the parser resets its context at each
 * entry, so joining these lines cannot pull in a neighbour's output.
 */
export function hashPrefixedEvidenceBlock(text, maxLines = 200) {
  return text
    .split("\n")
    .filter((line) => /^#/.test(line))
    .slice(0, maxLines)
    .join("\n");
}

/**
 * Report whether a failure's own evidence attributes it to official card data
 * that is verifiably absent in this checkout. Requires the same text to name an
 * official data path and to state an absence reason, either on one line or
 * within the immediately preceding \`#\` stderr block. A real assertion failure
 * matches neither form and stays a real failure.
 */
export function classifyFailureEvidence(text, repoRoot) {
  const root = resolveRepoRoot(repoRoot);
  const mentioned = officialDataPathsMentioned(text);
  if (mentioned.length === 0) return { missingData: false, evidence: [] };

  const absent = mentioned.filter(
    (relativePath) => !existsSync(path.join(root, relativePath))
  );
  if (absent.length === 0) return { missingData: false, evidence: [] };

  const block = hashPrefixedEvidenceBlock(text);
  const evidence = [];
  const lines = text.split("\n");
  for (const relativePath of absent) {
    const sameLine = lines.some(
      (line) => line.includes(relativePath) && hasAnyAbsenceMarker(line)
    );
    const inStderrBlock =
      block.includes(relativePath) && hasStrongAbsenceMarker(block);
    if (sameLine || inStderrBlock) {
      evidence.push(relativePath);
    }
  }

  if (evidence.length === 0) return { missingData: false, evidence: [] };
  return { missingData: true, evidence };
}

/**
 * The snapshot envelope that the tracked test fixture and the compiled
 * constants pin. Read-only: CI never edits tracked sources, this only reports
 * what the repository itself declares.
 */
const PINNED_ENVELOPE_SOURCES = [
  "packages/card-dsl/test/fixtures/official-catalog.mjs",
  "packages/card-dsl/src/duel/official-programs.ts"
];

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}

export function readPinnedOfficialEnvelope(repoRoot) {
  const root = resolveRepoRoot(repoRoot);
  const result = { dataVersion: null, digest: null, sources: [] };
  for (const relativePath of PINNED_ENVELOPE_SOURCES) {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath)) continue;
    const text = readFileSync(absolutePath, "utf8");
    if (result.dataVersion === null) {
      result.dataVersion = firstMatch(text, [
        /(?:BASIC_RUNE_CATALOG_VERSION|DATA_VERSION)\s*=\s*["']([^"']+)["']/
      ]);
    }
    if (result.digest === null) {
      result.digest = firstMatch(text, [
        /(?:BASIC_RUNE_CATALOG_DIGEST|DIGEST)\s*=\s*["']([^"']+)["']/
      ]);
    }
    result.sources.push(relativePath);
  }
  return result;
}
