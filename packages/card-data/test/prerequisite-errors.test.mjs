import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Offline-only regression: every CLI that depends on a generated input must
// fail with an actionable, deterministic message that names the missing path
// and the command that produces it, instead of leaking a bare ENOENT.

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.dirname(testDirectory);

const SCRIPT_PATHS = {
  catalog: path.join(packageDirectory, "scripts", "build-deck-catalog.mjs"),
  images: path.join(packageDirectory, "scripts", "sync-images.mjs"),
  coverage: path.join(packageDirectory, "scripts", "build-effect-coverage.mjs")
};

const OFFICIAL_IMAGE_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/card.png?v=42";

function runCli(scriptPath, args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: packageDirectory,
        encoding: "utf8",
        timeout: 20_000
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error?.code ?? 0,
          stdout,
          stderr,
          executionError: error
        });
      }
    );
  });
}

async function withTempDirectory(prefix, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertDeterministicFailure(scriptPath, args) {
  const first = await runCli(scriptPath, args);
  const second = await runCli(scriptPath, args);
  assert.equal(first.exitCode, 1, "a missing prerequisite must exit non-zero");
  assert.equal(second.exitCode, 1);
  assert.equal(
    second.stderr,
    first.stderr,
    "the prerequisite failure message must be deterministic"
  );
  assert.doesNotMatch(
    first.stderr,
    /ENOENT/,
    "the raw ENOENT must be replaced by an actionable message"
  );
  return first;
}

function officialCard(overrides = {}) {
  return {
    id: "fix-001-100",
    name: "Flame Warden",
    subtitle: "Ember Guard",
    set: { value: { id: "FIX", label: "Fixture" } },
    publicCode: "FIX-001/100",
    cardType: {
      type: [{ id: "unit", label: "Unit" }],
      superType: [{ id: "champion", label: "Champion" }]
    },
    domain: { values: [{ id: "ember", label: "Ember" }] },
    cardImage: { url: "https://example.test/flame.png" },
    text: { richText: { body: "<p>First line<br />Second line</p>" } },
    energy: { value: { id: 2 } },
    power: { value: { id: 3 } },
    might: { value: { id: 4 } },
    tags: { tags: ["Flame", "Ember"] },
    ...overrides
  };
}

function minimalSnapshot() {
  const featured = officialCard();
  return {
    schemaVersion: 1,
    source: { releaseTag: "v2026-10-13" },
    cards: [{ cardCode: featured.id, ...featured }],
    localizedGalleries: {
      "en-US": { cards: [featured] },
      "zh-CN": { cards: [] }
    }
  };
}

test("build:catalog reports an actionable missing-snapshot error", async () => {
  await withTempDirectory("riftbound-catalog-prerequisite-", async (directory) => {
    const missing = path.join(directory, "missing-cards.json");
    const result = await assertDeterministicFailure(
      SCRIPT_PATHS.catalog,
      ["--snapshot", missing, "--dry-run"]
    );

    assert.match(result.stderr, /build-deck-catalog failed: Card snapshot not found:/);
    assert.ok(
      result.stderr.includes(missing),
      "the failure must name the missing snapshot path"
    );
    assert.match(
      result.stderr,
      /pnpm --filter @riftbound\/card-data sync:cards/,
      "the failure must name the prerequisite package command"
    );
    assert.match(
      result.stderr,
      /node scripts\/sync-current-cards\.mjs --output/,
      "the failure must name the direct script and its path option"
    );
  });
});

test("sync:images reports an actionable missing-catalog error", async () => {
  await withTempDirectory("riftbound-images-prerequisite-", async (directory) => {
    const missing = path.join(directory, "missing-catalog.json");
    const result = await assertDeterministicFailure(
      SCRIPT_PATHS.images,
      [
        "--catalog", missing,
        "--output", path.join(directory, "images"),
        "--manifest", path.join(directory, "manifest.json"),
        "--dry-run"
      ]
    );

    assert.match(result.stderr, /sync-images failed: catalog file not found:/);
    assert.ok(
      result.stderr.includes(missing),
      "the failure must name the missing catalog path"
    );
    assert.match(
      result.stderr,
      /pnpm --filter @riftbound\/card-data sync:cards/,
      "the failure must name the prerequisite package command"
    );
    assert.match(
      result.stderr,
      /node scripts\/sync-current-cards\.mjs --catalog-output/,
      "the failure must name the direct script and its catalog option"
    );
  });
});

test("build:coverage reports an actionable missing deck-catalog error", async () => {
  await withTempDirectory("riftbound-coverage-prerequisite-", async (directory) => {
    const missing = path.join(directory, "missing-deck-catalog.json");
    const result = await assertDeterministicFailure(
      SCRIPT_PATHS.coverage,
      ["--catalog", missing, "--dry-run"]
    );

    assert.match(result.stderr, /build-effect-coverage failed: Catalog not found:/);
    assert.ok(
      result.stderr.includes(missing),
      "the failure must name the missing deck-catalog path"
    );
    assert.match(
      result.stderr,
      /pnpm --filter @riftbound\/card-data build:catalog/,
      "the failure must name the prerequisite package command"
    );
    assert.match(
      result.stderr,
      /node scripts\/build-deck-catalog\.mjs --output/,
      "the failure must name the direct script and its output option"
    );
  });
});

test("build:catalog still succeeds on a minimal snapshot dry run", async () => {
  await withTempDirectory("riftbound-catalog-positive-", async (directory) => {
    const snapshotPath = path.join(directory, "cards.json");
    const outputPath = path.join(directory, "deck-catalog.json");
    await writeFile(
      snapshotPath,
      `${JSON.stringify(minimalSnapshot())}\n`,
      "utf8"
    );

    const result = await runCli(SCRIPT_PATHS.catalog, [
      "--snapshot", snapshotPath,
      "--output", outputPath,
      "--dry-run"
    ]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Dry run complete: 1 cards and 1 identity groups/);
    assert.equal(
      existsSync(outputPath),
      false,
      "a dry run must not write the catalog"
    );
  });
});

test("sync:images still succeeds on a minimal catalog dry run", async () => {
  await withTempDirectory("riftbound-images-positive-", async (directory) => {
    const catalogPath = path.join(directory, "catalog.json");
    const outputPath = path.join(directory, "images");
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(
      catalogPath,
      `${JSON.stringify({
        dataVersion: "fixture-2026-10-13",
        digest: `sha256:${"1".repeat(64)}`,
        cards: [{ id: "card-001", imageUrl: OFFICIAL_IMAGE_URL }]
      })}\n`,
      "utf8"
    );

    const result = await runCli(SCRIPT_PATHS.images, [
      "--catalog", catalogPath,
      "--output", outputPath,
      "--manifest", manifestPath,
      "--dry-run"
    ]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Dry run: total=1 .*no files written/);
    assert.equal(existsSync(outputPath), false, "a dry run must not write images");
    assert.equal(
      existsSync(manifestPath),
      false,
      "a dry run must not write the manifest"
    );
  });
});

test("build:coverage still succeeds on a minimal deck-catalog dry run", async () => {
  await withTempDirectory("riftbound-coverage-positive-", async (directory) => {
    const catalogPath = path.join(directory, "deck-catalog.json");
    const outputPath = path.join(directory, "effect-coverage.json");
    await writeFile(
      catalogPath,
      `${JSON.stringify({
        dataVersion: "fixture-2026-10-13",
        cards: [
          { id: "card.a", canonicalCardId: "card.hash-1", ability: "" }
        ]
      })}\n`,
      "utf8"
    );

    const result = await runCli(SCRIPT_PATHS.coverage, [
      "--catalog", catalogPath,
      "--output", outputPath,
      "--dry-run"
    ]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Effect coverage dry run:/);
    assert.equal(
      existsSync(outputPath),
      false,
      "a dry run must not write the coverage report"
    );
  });
});
