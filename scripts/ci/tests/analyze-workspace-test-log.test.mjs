import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeWorkspaceTestLog,
  parseNodeTestOutput,
  parseVitestOutput,
  renderReport,
  stripAnsi
} from "../analyze-workspace-test-log.mjs";

/** A throwaway checkout with only the package manifests the parser reads. */
function scaffoldRepo(manifestNames) {
  const root = mkdtempSync(path.join(os.tmpdir(), "riftbound-ci-fixture-"));
  for (const [group, name, packageName] of manifestNames) {
    const directory = path.join(root, group, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ name: packageName, version: "0.0.0" }),
      "utf8"
    );
  }
  return root;
}

const SCAFFOLD = [
  ["packages", "card-dsl", "@riftbound/card-dsl"],
  ["apps", "game-server", "@riftbound/game-server"]
];

test("stripAnsi removes colour codes from runner output", () => {
  assert.equal(stripAnsi("\u001B[31mFAIL\u001B[39m suite"), "FAIL suite");
});

test("node:test module-load failures are attributed to their file", () => {
  const text = [
    "# Error: ENOENT: no such file or directory, open '/x/packages/card-data/data/deck-catalog.json'",
    "#     at readFileSync (node:fs:440:20)",
    "# Subtest: test/duel/equip-official-source-v1.test.mjs",
    "not ok 13 - test/duel/equip-official-source-v1.test.mjs",
    "  ---",
    "  duration_ms: 64.5",
    "  type: 'test'",
    "  location: '/x/packages/card-dsl/test/duel/equip-official-source-v1.test.mjs:1:1'",
    "  error: 'test failed'",
    "  ...",
    "1..13",
    "# tests 13",
    "# pass 12",
    "# fail 1",
    "# skipped 0",
    "# todo 0"
  ].join("\n");

  const parsed = parseNodeTestOutput({
    packageDir: "packages/card-dsl",
    text,
    repoRoot: "/x"
  });
  assert.equal(parsed.counters.fail, 1);
  assert.equal(parsed.entries.length, 1);
  assert.equal(
    parsed.entries[0].file,
    "packages/card-dsl/test/duel/equip-official-source-v1.test.mjs"
  );
  assert.match(parsed.entries[0].evidence, /ENOENT/);
});

test("vitest output aggregates every failing file once, with its evidence", () => {
  const rule = "\u2500".repeat(6);
  const text = [
    " FAIL  tests/duel/hold-recruit-executor-v1.test.ts > native Hold Recruit V1 > binds decks",
    " Error: Card catalog file not found: /x/packages/card-data/data/deck-catalog.json",
    " " + rule + "[14/32]" + rule,
    " FAIL  tests/duel/hold-recruit-executor-v1.test.ts > native Hold Recruit V1 > accepts decision",
    " Error: Card catalog file not found: /x/packages/card-data/data/deck-catalog.json",
    " " + rule + "[15/32]" + rule,
    " FAIL  tests/duel/optional-unit-room-p4.test.ts [ tests/duel/optional-unit-room-p4.test.ts ]",
    " Error: Card catalog file not found: /x/packages/card-data/data/deck-catalog.json",
    " " + rule + "[16/32]" + rule,
    " Test Files  2 failed | 1 passed (3)",
    "      Tests  3 failed | 1 passed (4)"
  ].join("\n");

  const parsed = parseVitestOutput({
    packageDir: "apps/game-server",
    text,
    repoRoot: "/x"
  });
  assert.equal(parsed.counters.failingFiles, 2);
  assert.equal(parsed.counters.failingTests, 3);
  assert.equal(parsed.entries.length, 2);
  const hold = parsed.entries.find((entry) =>
    entry.file.endsWith("hold-recruit-executor-v1.test.ts")
  );
  assert.equal(hold.evidence.match(/FAIL/g).length, 2, "both failing cases are kept");
  assert.equal(hold.failingCases, 2, "failing tests are counted, not files");
  const parsedCases = parsed.entries.reduce(
    (total, entry) => total + entry.failingCases,
    0
  );
  assert.equal(
    parsedCases >= parsed.counters.failingTests,
    true,
    "parsed FAIL entries must cover the runner's own failing-test total"
  );
});

test("a passing vitest run reports zero failing files rather than unknown", () => {
  const parsed = parseVitestOutput({
    packageDir: "packages/integration-tests",
    text: " Test Files  7 passed (7)\n      Tests  39 passed (39)\n",
    repoRoot: "/x"
  });
  assert.equal(parsed.counters.failingFiles, 0);
  assert.equal(parsed.entries.length, 0);
});

test("absent official data reclassifies only the suites that name it", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    const suitePath = "packages/card-dsl/test/duel/equip-official-source-v1.test.mjs";
    const logText = [
      "packages/card-dsl test$ pnpm build && node --test test/*.test.mjs",
      "packages/card-dsl test: # Error: ENOENT: no such file or directory, open '" +
        path.join(root, "packages/card-data/data/deck-catalog.json") + "'",
      "packages/card-dsl test: # Subtest: " + suitePath,
      "packages/card-dsl test: not ok 13 - " + suitePath,
      "packages/card-dsl test:   ---",
      "packages/card-dsl test:   location: '" + path.join(root, suitePath) + ":1:1'",
      "packages/card-dsl test:   error: 'test failed'",
      "packages/card-dsl test:   ...",
      "packages/card-dsl test: 1..13",
      "packages/card-dsl test: # tests 13",
      "packages/card-dsl test: # fail 1",
      "packages/card-dsl test: # skipped 0",
      "[ERR_PNPM_RECURSIVE_FAIL]",
      "",
      "Summary: 1 fails, 0 passes",
      "",
      path.join(root, "packages/card-dsl") + ":",
      "[ERROR] @riftbound/card-dsl@0.1.0 test: pnpm build && node --test",
      "Exit status 1"
    ].join("\n");

    const report = analyzeWorkspaceTestLog({
      logText,
      repoRoot: root,
      exitCode: 1,
      reviewedSuites: [suitePath]
    });
    assert.deepEqual(report.structuralErrors, []);
    assert.equal(report.failures.length, 0);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].file, suitePath);
    assert.equal(report.skipped[0].reviewed, true);
    assert.equal(report.ok, true);
    const markdown = renderReport(report, { dataVersion: "v", digest: "sha256:x" });
    assert.match(markdown, /Skipped because the official card data is absent: \*\*1\*\*/);
    assert.match(markdown, /Verdict: PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a real assertion failure is never reclassified, even beside data failures", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    const censusSuite = "packages/card-dsl/test/duel/shield-description-v1.test.mjs";
    const realSuite = "packages/card-dsl/test/duel/other.test.mjs";
    const logText = [
      "packages/card-dsl test: # Subtest: real 1381-printing census",
      "packages/card-dsl test: not ok 75 - real 1381-printing census",
      "packages/card-dsl test:   ---",
      "packages/card-dsl test:   location: '" + path.join(root, censusSuite) + ":390:1'",
      "packages/card-dsl test:   error: \"ENOENT: no such file or directory, open '" +
        path.join(root, "packages/card-data/data/deck-catalog.json") + "'\"",
      "packages/card-dsl test:   ...",
      "packages/card-dsl test: # Subtest: a real logic assertion",
      "packages/card-dsl test: not ok 76 - a real logic assertion",
      "packages/card-dsl test:   ---",
      "packages/card-dsl test:   location: '" + path.join(root, realSuite) + ":3:1'",
      "packages/card-dsl test:   error: |-",
      "packages/card-dsl test:     Expected values to be strictly equal:",
      "packages/card-dsl test:     1 !== 2",
      "packages/card-dsl test:   ...",
      "packages/card-dsl test: # tests 14",
      "packages/card-dsl test: # fail 2",
      "packages/card-dsl test: # skipped 0",
      "[ERROR] @riftbound/card-dsl@0.1.0 test: pnpm build",
      "Exit status 1"
    ].join("\n");

    const report = analyzeWorkspaceTestLog({ logText, repoRoot: root, exitCode: 1 });
    assert.equal(report.ok, false);
    assert.equal(report.failures.length, 1);
    assert.match(report.failures[0].file, /other\.test\.mjs$/);
    assert.equal(report.skipped.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("data present in the checkout means no reclassification at all", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    const catalogPath = path.join(root, "packages/card-data/data/deck-catalog.json");
    mkdirSync(path.dirname(catalogPath), { recursive: true });
    writeFileSync(catalogPath, "{}", "utf8");

    const suitePath = "packages/card-dsl/test/duel/equip-official-source-v1.test.mjs";
    const logText = [
      "packages/card-dsl test: # Subtest: census",
      "packages/card-dsl test: not ok 13 - " + suitePath,
      "packages/card-dsl test:   ---",
      "packages/card-dsl test:   location: '" + path.join(root, suitePath) + ":1:1'",
      "packages/card-dsl test:   error: \"ENOENT: no such file or directory, open '" +
        catalogPath + "'\"",
      "packages/card-dsl test:   ...",
      "packages/card-dsl test: # tests 13",
      "packages/card-dsl test: # fail 1",
      "Exit status 1"
    ].join("\n");

    const report = analyzeWorkspaceTestLog({ logText, repoRoot: root, exitCode: 1 });
    assert.equal(report.skipped.length, 0);
    assert.equal(report.failures.length, 1);
    assert.equal(report.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreviewed data-dependent suite is surfaced, not silently accepted", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    const suitePath = "packages/card-dsl/test/duel/newly-added.test.mjs";
    const logText = [
      "packages/card-dsl test: # Error: ENOENT: no such file or directory, open '" +
        path.join(root, "packages/card-data/data/deck-catalog.json") + "'",
      "packages/card-dsl test: not ok 1 - " + suitePath,
      "packages/card-dsl test:   ---",
      "packages/card-dsl test:   location: '" + path.join(root, suitePath) + ":1:1'",
      "packages/card-dsl test:   error: 'test failed'",
      "packages/card-dsl test:   ...",
      "packages/card-dsl test: # tests 1",
      "packages/card-dsl test: # fail 1",
      "Exit status 1"
    ].join("\n");

    const report = analyzeWorkspaceTestLog({ logText, repoRoot: root, exitCode: 1, reviewedSuites: [] });
    assert.equal(report.ok, true);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].reviewed, false);
    const markdown = renderReport(report, { dataVersion: "v", digest: "sha256:x" });
    assert.match(markdown, /Newly observed data-dependent suites/);
    assert.match(markdown, /\*\*no\*\*/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a suite reviewed and excluded is never quietly absorbed as a data skip", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    const suitePath = "apps/game-server/tests/card-api.test.ts";
    const logText = [
      "apps/game-server test: # Error: ENOENT: no such file or directory, open '" +
        path.join(root, "packages/card-data/data/deck-catalog.json") + "'",
      "apps/game-server test: not ok 1 - " + suitePath,
      "apps/game-server test:   ---",
      "apps/game-server test:   location: '" + path.join(root, suitePath) + ":1:1'",
      "apps/game-server test:   error: 'test failed'",
      "apps/game-server test:   ...",
      "apps/game-server test: # tests 1",
      "apps/game-server test: # fail 1",
      "Exit status 1"
    ].join("\n");

    const report = analyzeWorkspaceTestLog({
      logText,
      repoRoot: root,
      exitCode: 1,
      reviewedSuites: [],
      excludedSuites: [suitePath]
    });
    assert.equal(report.ok, false, "an excluded suite must not pass as a data skip");
    assert.match(report.structuralErrors.join("\n"), /reviewed and excluded/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a counter mismatch makes the log untrusted instead of green", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    const logText = [
      "packages/card-dsl test: # tests 13",
      "packages/card-dsl test: # fail 3",
      "packages/card-dsl test: # skipped 0",
      "Exit status 1"
    ].join("\n");

    const report = analyzeWorkspaceTestLog({ logText, repoRoot: root, exitCode: 1 });
    assert.equal(report.ok, false);
    assert.match(report.structuralErrors.join("\n"), /refusing to trust this log/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed package with no parseable failure is untrusted, not green", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    const logText = [
      "Summary: 1 fails, 0 passes",
      "[ERROR] @riftbound/card-dsl@0.1.0 test: pnpm build",
      "Exit status 1"
    ].join("\n");

    const report = analyzeWorkspaceTestLog({ logText, repoRoot: root, exitCode: 1 });
    assert.equal(report.ok, false);
    assert.match(report.structuralErrors.join("\n"), /no failing entry could be parsed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an assertion that merely mentions an official path is never reclassified", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    // The suite legitimately references the official catalog path in a message,
    // but the failure is a real assertion, not an absence: no absence reason is
    // stated on the path's own line nor in a strong stderr block.
    const logText = [
      "packages/card-dsl test: # Subtest: compares the expected catalog path",
      "packages/card-dsl test: not ok 9 - compares the expected catalog path",
      "packages/card-dsl test:   ---",
      "packages/card-dsl test:   location: 'packages/card-dsl/test/duel/meta.test.mjs:12:1'",
      "packages/card-dsl test:   error: |-",
      "packages/card-dsl test:     Expected values to be strictly equal:",
      "packages/card-dsl test:     'packages/card-data/data/deck-catalog.json' !== 'packages/card-data/DATA/deck-catalog.json'",
      "packages/card-dsl test:   ...",
      "packages/card-dsl test: # tests 9",
      "packages/card-dsl test: # fail 1",
      "Exit status 1"
    ].join("\n");

    const report = analyzeWorkspaceTestLog({ logText, repoRoot: root, exitCode: 1 });
    assert.equal(report.skipped.length, 0);
    assert.equal(report.failures.length, 1);
    assert.equal(report.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a zero exit code beside failing output is untrusted", () => {
  const root = scaffoldRepo(SCAFFOLD);
  try {
    const logText = [
      "packages/card-dsl test: # tests 1",
      "packages/card-dsl test: # fail 1",
      "packages/card-dsl test: not ok 1 - packages/card-dsl/test/a.test.mjs",
      "packages/card-dsl test:   ---",
      "packages/card-dsl test:   location: 'packages/card-dsl/test/a.test.mjs:1:1'",
      "packages/card-dsl test:   error: 'boom'",
      "packages/card-dsl test:   ..."
    ].join("\n");

    const report = analyzeWorkspaceTestLog({ logText, repoRoot: root, exitCode: 0 });
    assert.equal(report.ok, false);
    assert.match(
      report.structuralErrors.join("\n"),
      /exited 0 but the log contains failures/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
