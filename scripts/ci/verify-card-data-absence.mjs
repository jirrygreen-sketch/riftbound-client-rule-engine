#!/usr/bin/env node
/**
 * RIFT-14 CI guard: a CI checkout must not contain the locally synchronized
 * official card data.
 *
 * `packages/card-data/data/*.json` and `packages/card-data/dist/cards.json` are
 * gitignored generated outputs of the official sync scripts. CI runs from a
 * clean checkout where they are absent, and `skip-data-dependent-tests.mjs`
 * reclassifies data-dependent failures as explicit skips exactly because of
 * that state. If any of those files were present, reclassification would hide
 * real results, so fail loudly instead of guessing.
 */

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  OFFICIAL_CARD_DATA_PATHS,
  presentOfficialCardData,
  resolveRepoRoot
} from "./official-card-data.mjs";

function main() {
  const repoRoot = resolveRepoRoot(process.env.RIFTBOUND_REPO_ROOT);
  const present = presentOfficialCardData(repoRoot);
  if (present.length === 0) {
    console.log(
      "CI checkout contains no locally synchronized official card data " +
        `(checked ${OFFICIAL_CARD_DATA_PATHS.length} gitignored paths in ${repoRoot}).`
    );
    return 0;
  }

  console.error(
    "CI checkout contains locally synchronized official card data, which is " +
      "gitignored and must never be committed:"
  );
  for (const relativePath of present) console.error(`  - ${relativePath}`);
  console.error(
    "Run CI against a clean clone. Data-dependent suites are reported as " +
      "explicit skips only when the official data is verifiably absent; " +
      "otherwise this gate would hide real failures."
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

export { main };
