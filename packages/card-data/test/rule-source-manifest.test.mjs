import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_SCHEMA_VERSION,
  formatReport,
  parseArguments,
  verifyRuleSources,
  validateManifest
} from "../scripts/verify-rule-sources.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "../../..");
const MANIFEST_PATH = path.resolve(REPO_ROOT, "docs/rule-source-manifest.json");

const DOCUMENTED_CORE_1_4_SHA256 =
  "9c5fb8b8638f2cd19ceda237929fa2c37aac23c797cc7410294993470ba5a30b";

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
}

function baseSource(overrides = {}) {
  return {
    id: "riftbound.test-source",
    title: "Test source",
    kind: "core-rules",
    version: "1.4",
    status: "active",
    lastUpdated: "2026-07-16",
    effectiveDate: null,
    sha256: "a".repeat(64),
    hashStatus: "verified",
    urls: [{ role: "rules-hub", url: "https://playriftbound.com/en-us/rules-hub/" }],
    localFiles: [],
    ...overrides
  };
}

function manifestWith(sourceOverrides = {}) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: "2026-10-13",
    sources: [baseSource(sourceOverrides)]
  };
}

function fixtureReader(manifest) {
  return async () => JSON.stringify(manifest);
}

const neverTouchesFilesystem = {
  fileStat: async () => {
    throw new Error("fileStat must not be called");
  },
  hashFile: async () => {
    throw new Error("hashFile must not be called");
  }
};

test("tracked manifest is schema-valid", async () => {
  const manifest = await readManifest();
  const result = validateManifest(manifest);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);
});

test("manifest-only verification of the tracked manifest passes without touching local files", async () => {
  const report = await verifyRuleSources({
    manifestPath: MANIFEST_PATH,
    mode: "manifest-only",
    ...neverTouchesFilesystem
  });
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.summary.filesSkipped > 0, true);
  assert.equal(report.summary.mismatches, 0);
});

test("tracked manifest records the documented Core v1.4 sha256 and only documented hashes", async () => {
  const manifest = await readManifest();
  const core = manifest.sources.find((source) => source.id === "riftbound.core-rules");
  assert.ok(core, "riftbound.core-rules source must exist");
  assert.equal(core.version, "1.4");
  assert.equal(core.lastUpdated, "2026-07-16");
  assert.equal(core.sha256, DOCUMENTED_CORE_1_4_SHA256);
  assert.equal(core.hashStatus, "verified");

  for (const source of manifest.sources) {
    if (source.sha256 === null) {
      assert.equal(source.hashStatus, "pending", `${source.id} must mark pending`);
      assert.equal(source.localFiles.every((file) => file.sha256 === undefined), true);
    } else {
      assert.match(source.sha256, /^[a-f0-9]{64}$/);
      assert.equal(source.hashStatus, "verified");
    }
  }
});

test("every manifest URL is https and every date is well-formed", async () => {
  const manifest = await readManifest();
  for (const source of manifest.sources) {
    assert.equal(source.urls.length > 0, true, `${source.id} needs at least one url`);
    for (const entry of source.urls) {
      assert.equal(new URL(entry.url).protocol, "https:");
    }
    for (const dateKey of ["lastUpdated", "effectiveDate"]) {
      const value = source[dateKey];
      if (value !== null) {
        assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${source.id}.${dateKey}`);
      }
    }
  }
});

test("rejects non-https urls", () => {
  const result = validateManifest(
    manifestWith({ urls: [{ role: "rules-hub", url: "http://playriftbound.com/" }] })
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.path.endsWith(".url")), true);
});

test("rejects malformed sha256", () => {
  const result = validateManifest(manifestWith({ sha256: "not-a-hash" }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.path.endsWith(".sha256")), true);
});

test("rejects malformed dates", () => {
  const result = validateManifest(manifestWith({ effectiveDate: "2026-13-40" }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.path.endsWith(".effectiveDate")), true);
});

test("requires pending hashStatus when sha256 is null", () => {
  const bad = validateManifest(manifestWith({ sha256: null, hashStatus: "verified" }));
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.some((error) => error.path.endsWith(".hashStatus")), true);

  const good = validateManifest(manifestWith({ sha256: null, hashStatus: "pending" }));
  assert.equal(good.ok, true, JSON.stringify(good.errors));
});

test("rejects unknown keys and duplicate ids", () => {
  const extra = validateManifest(manifestWith({ unexpected: true }));
  assert.equal(extra.ok, false);

  const duplicated = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sources: [baseSource(), baseSource()]
  };
  const result = validateManifest(duplicated);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.message.includes("duplicate")), true);
});

test("default mode hashes present local files and reports matches", async () => {
  const manifest = manifestWith({
    localFiles: [{ path: "work/rules/CR-v1.4.pdf" }]
  });
  const report = await verifyRuleSources({
    readText: fixtureReader(manifest),
    repoRoot: "/virtual-root",
    fileStat: async () => ({ exists: true }),
    hashFile: async () => "a".repeat(64)
  });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.summary.filesPresent, 1);
  assert.equal(report.sources[0].files[0].status, "match");
});

test("default mode fails on a sha256 mismatch", async () => {
  const manifest = manifestWith({
    localFiles: [{ path: "work/rules/CR-v1.4.pdf" }]
  });
  const report = await verifyRuleSources({
    readText: fixtureReader(manifest),
    fileStat: async () => ({ exists: true }),
    hashFile: async () => "b".repeat(64)
  });
  assert.equal(report.ok, false);
  assert.equal(report.summary.mismatches, 1);
  assert.equal(report.sources[0].files[0].status, "mismatch");
});

test("default mode reports missing local files without failing", async () => {
  const manifest = manifestWith({
    localFiles: [{ path: "work/rules/CR-v1.4.pdf" }]
  });
  const report = await verifyRuleSources({
    readText: fixtureReader(manifest),
    fileStat: async () => ({ exists: false }),
    hashFile: async () => {
      throw new Error("hashFile must not be called for a missing file");
    }
  });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.summary.filesMissing, 1);
  assert.equal(report.sources[0].files[0].status, "missing");
});

test("--require-local makes missing files fatal", async () => {
  const manifest = manifestWith({
    localFiles: [{ path: "work/rules/CR-v1.4.pdf" }]
  });
  const report = await verifyRuleSources({
    readText: fixtureReader(manifest),
    requireLocal: true,
    fileStat: async () => ({ exists: false })
  });
  assert.equal(report.ok, false);
});

test("manifest-only mode skips local checks even when hashing would throw", async () => {
  const manifest = manifestWith({
    localFiles: [{ path: "work/rules/CR-v1.4.pdf" }]
  });
  const report = await verifyRuleSources({
    readText: fixtureReader(manifest),
    mode: "manifest-only",
    ...neverTouchesFilesystem
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.filesSkipped, 1);
  assert.equal(report.sources[0].files[0].status, "skipped");
});

test("per-file sha256 overrides the source-level hash", async () => {
  const manifest = manifestWith({
    localFiles: [{ path: "work/rules/CR-v1.4.txt", sha256: "c".repeat(64) }]
  });
  const report = await verifyRuleSources({
    readText: fixtureReader(manifest),
    fileStat: async () => ({ exists: true }),
    hashFile: async () => "c".repeat(64)
  });
  assert.equal(report.ok, true);
  assert.equal(report.sources[0].files[0].expectedSha256, "c".repeat(64));
});

test("an unreadable manifest is reported, not thrown", async () => {
  const report = await verifyRuleSources({
    readText: async () => "{ not json",
    ...neverTouchesFilesystem
  });
  assert.equal(report.ok, false);
  assert.equal(report.errors.some((error) => error.startsWith("cannot read manifest")), true);
});

test("text report surfaces the manifest read failure with path and reason (F1)", async () => {
  const missingPath = path.resolve("/virtual-root/docs/typo.json");
  const report = await verifyRuleSources({
    manifestPath: missingPath,
    readText: async () => {
      const error = new Error(`ENOENT: no such file or directory, open '${missingPath}'`);
      error.code = "ENOENT";
      throw error;
    },
    ...neverTouchesFilesystem
  });

  assert.equal(report.ok, false);
  const text = formatReport(report);
  assert.equal(text.includes("cannot read manifest"), true, text);
  assert.equal(text.includes(missingPath), true, text);
  assert.equal(text.includes("ENOENT: no such file or directory"), true, text);
  assert.equal(text.includes("schema: INVALID"), true, text);
});

test("text report includes the manifest path even when the underlying error omits it (F1)", async () => {
  const brokenPath = path.resolve("/virtual-root/docs/broken.json");
  const report = await verifyRuleSources({
    manifestPath: brokenPath,
    readText: async () => "{ not json",
    ...neverTouchesFilesystem
  });

  assert.equal(report.ok, false);
  const text = formatReport(report);
  assert.match(text, /cannot read manifest/);
  assert.equal(text.includes(brokenPath), true, text);
});

test("text report keeps per-field errors for a readable but schema-invalid manifest (F1)", async () => {
  const report = await verifyRuleSources({
    readText: fixtureReader(manifestWith({ sha256: "not-a-hash" })),
    ...neverTouchesFilesystem
  });

  assert.equal(report.ok, false);
  assert.equal(report.schema.errors.length > 0, true);
  const text = formatReport(report);
  assert.equal(text.includes("schema: INVALID"), true, text);
  assert.equal(
    text.includes("$.sources[0].sha256: sha256 must be null or 64 lowercase hex characters"),
    true,
    text
  );
  assert.equal(text.includes("cannot read manifest"), false, text);
  // The schema error must not be repeated as a top-level "error:" line.
  const occurrences = text.split("sha256 must be null or 64 lowercase hex characters").length - 1;
  assert.equal(occurrences, 1, text);
});

test("--manifest-only conflicts with --require-local instead of silently succeeding (F3)", () => {
  assert.throws(() => parseArguments(["--manifest-only", "--require-local"]), /conflicting/);
  assert.throws(() => parseArguments(["--require-local", "--manifest-only"]), /--manifest-only/);
});

test("verifyRuleSources rejects manifest-only + requireLocal at the API boundary (F3)", async () => {
  await assert.rejects(
    () => verifyRuleSources({ mode: "manifest-only", requireLocal: true, ...neverTouchesFilesystem }),
    /conflicting options/
  );
});

test("single-flag argument parsing keeps its existing defaults", () => {
  const defaults = parseArguments([]);
  assert.equal(defaults.mode, "default");
  assert.equal(defaults.requireLocal, false);

  const manifestOnly = parseArguments(["--manifest-only"]);
  assert.equal(manifestOnly.mode, "manifest-only");
  assert.equal(manifestOnly.requireLocal, false);

  const requireLocal = parseArguments(["--require-local"]);
  assert.equal(requireLocal.mode, "default");
  assert.equal(requireLocal.requireLocal, true);
});
