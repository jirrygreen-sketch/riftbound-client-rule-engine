#!/usr/bin/env node
/**
 * RIFT-14 evidence probe (read-only, opt-in, never run by ci.yml).
 *
 * Requirement 2 of RIFT-14 prefers installing the official card data in CI from
 * the upstream sources ("option a") over skipping data-dependent tests. This
 * probe measures whether that is still possible: it compares the snapshot the
 * repository pins (declared in tracked test/compiled constants) with what the
 * live upstream sources currently produce.
 *
 * It never writes to the repository: the sync runs with --dry-run, which
 * downloads and validates without writing cards.json or the catalogs, then the
 * deck catalog is built in memory.
 *
 * Usage:
 *   node scripts/ci/probe-official-data-drift.mjs                # live probe
 *   node scripts/ci/probe-official-data-drift.mjs --recorded   # offline replay
 *
 * --recorded replays the 2026-10-15 observation captured in
 * scripts/ci/official-data-drift.json so the drift rationale is reproducible
 * without network access.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readPinnedOfficialEnvelope, resolveRepoRoot } from "./official-card-data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_DATA_DIR = "packages/card-data";
const RECORDED_PATH = path.join(HERE, "official-data-drift.json");

async function loadCardDataScripts(repoRoot) {
  const scriptsDirectory = path.join(repoRoot, CARD_DATA_DIR, "scripts");
  return {
    sync: await import(
      pathToFileURL(path.join(scriptsDirectory, "sync-current-cards.mjs")).href
    ),
    catalog: await import(
      pathToFileURL(path.join(scriptsDirectory, "build-deck-catalog.mjs")).href
    )
  };
}

/**
 * Runs the real sync with --dry-run: it downloads and validates the live
 * sources and builds the deck catalog in memory, but writes no file at all.
 */
async function probeLive(repoRoot, timeoutMs) {
  const { sync, catalog } = await loadCardDataScripts(repoRoot);
  const options = sync.parseArguments([
    "--dry-run",
    "--timeout-ms",
    String(timeoutMs)
  ]);
  const snapshot = await sync.run(options, { log: () => {} });
  const deckCatalog = catalog.buildDeckCatalog(snapshot);
  return {
    cardCount: snapshot.cards.length,
    dataVersion: deckCatalog.dataVersion,
    digest: deckCatalog.digest
  };
}

function report(pinned, observed, label) {
  const sameVersion = pinned.dataVersion === observed.dataVersion;
  const sameDigest = pinned.digest === observed.digest;
  console.log("Official card data drift probe (" + label + ")");
  console.log("");
  console.log("  pinned   : " + pinned.dataVersion + " / " + pinned.digest);
  console.log("  observed : " + observed.dataVersion + " / " + observed.digest +
    " (" + observed.cardCount + " printings)");
  console.log("");
  if (sameVersion && sameDigest) {
    console.log("RESULT: the repository-pinned snapshot is still reproducible.");
    console.log("CI could install the official data instead of skipping those suites.");
    return 0;
  }
  console.log("RESULT: drift detected. The live sources no longer reproduce the");
  console.log("pinned snapshot, so installing them in CI would break the pinned");
  console.log("suites instead of running them. Data-dependent suites are reported");
  console.log("as explicit skips (see reviewed-official-data-suites.json).");
  return 0;
}

function main() {
  const repoRoot = resolveRepoRoot(process.env.RIFTBOUND_REPO_ROOT);
  const pinned = readPinnedOfficialEnvelope(repoRoot);
  if (pinned.dataVersion === null || pinned.digest === null) {
    console.error("Could not read the pinned snapshot envelope from tracked sources.");
    return 1;
  }

  const recorded = process.argv.includes("--recorded");
  if (recorded || !existsSync(path.join(repoRoot, CARD_DATA_DIR, "scripts"))) {
    if (!existsSync(RECORDED_PATH)) {
      console.error("No recorded probe observation at " + RECORDED_PATH + ".");
      return 1;
    }
    const observation = JSON.parse(readFileSync(RECORDED_PATH, "utf8"));
    return report(pinned, observation.observed, "recorded " + observation.observedAt);
  }

  return probeLive(repoRoot, 120_000)
    .then((observed) => report(pinned, observed, "live"))
    .catch((error) => {
      console.error("Live probe failed: " + (error?.message ?? error));
      console.error("");
      console.error("Run with --recorded to replay the captured observation.");
      return 1;
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
