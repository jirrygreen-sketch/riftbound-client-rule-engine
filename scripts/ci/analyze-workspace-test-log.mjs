#!/usr/bin/env node
/**
 * RIFT-14: turn a raw "pnpm -r --no-bail --if-present run test" log into a
 * truthful CI verdict.
 *
 * Why this exists
 * ---------------
 * The official Riftbound catalog, deck catalog, image manifest and image cache
 * are gitignored, so a CI checkout never contains them. A number of suites read
 * them directly: some at module load, some in a single "real catalog" census.
 * Without handling, those suites fail on ENOENT and CI is red for a reason that
 * has nothing to do with the change under test.
 *
 * What this does
 * --------------
 * 1. Splits the recursive pnpm log per workspace package and parses both
 *    node:test TAP output and vitest output.
 * 2. Cross-checks parsed failures against each runner's own counters, so a
 *    parsing miss cannot become a silent pass.
 * 3. Reclassifies a failing suite as an explicit skip only when its own
 *    evidence names a gitignored official data path that is verifiably absent
 *    and states an absence reason. Everything else stays a failure.
 * 4. Fails when a real failure remains, when a failed package has no parseable
 *    evidence, or when the log contradicts its own exit code.
 * 5. Writes the skip counts and the skipped suites to the job summary
 *    (GITHUB_STEP_SUMMARY) so skips are visible, never silent.
 *
 * This script never edits a test or a source file.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  classifyFailureEvidence,
  presentOfficialCardData,
  readPinnedOfficialEnvelope,
  resolveRepoRoot
} from "./official-card-data.mjs";

const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/g;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:mjs|js|cjs|mts|ts|tsx|jsx)$/;
const PACKAGE_PREFIX_PATTERN =
  /^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+) test[$:] ?(.*)$/;
const TAP_ENTRY_PATTERN = /^\s*(ok|not ok)\s+\d+\s+-\s+(.*?)\s*$/;
const TAP_BLOCK_START_PATTERN = /^\s*---\s*$/;
const TAP_BLOCK_END_PATTERN = /^\s*\.\.\.\s*$/;
const TAP_LOCATION_PATTERN = /^\s*location: '(.+?)'\s*$/;
// vitest prints either "FAIL path [ path ]" (suite/module failure) or
// "FAIL path > suite > name" (single test). Paths never contain whitespace, so
// the first token is the owning file in both forms.
const VITEST_FAIL_PATTERN = /^\s*FAIL\s+(\S+)/;
const VITEST_SEPARATOR_PATTERN = /^\s*(?:\u23AF|-){4,}\s*\[\d+\/\d+\]\s*$/;
const PNPM_FAILED_PACKAGE_PATTERN = /^\[ERROR\] (@?[^\s@]+)@\S+ test:/gm;

export function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, "");
}

function readJsonIfPresent(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/** Workspace packages as pnpm sees them: apps/* and packages/*. */
export function discoverWorkspacePackages(repoRoot) {
  const packages = new Map();
  for (const group of ["apps", "packages"]) {
    const groupPath = path.join(repoRoot, group);
    if (!existsSync(groupPath)) continue;
    for (const entry of readdirSync(groupPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(groupPath, entry.name, "package.json");
      const manifest = readJsonIfPresent(manifestPath);
      if (manifest === null) continue;
      const relativeDir = group + "/" + entry.name;
      packages.set(relativeDir, {
        dir: relativeDir,
        name: manifest.name ?? relativeDir
      });
    }
  }
  return packages;
}

/** Split the recursive pnpm log into per-package sections by name prefix. */
export function splitPackageOutputs(logText, packagesByDir) {
  const sections = new Map();
  for (const dir of packagesByDir.keys()) sections.set(dir, []);
  const unprefixed = [];
  for (const line of stripAnsi(logText).split("\n")) {
    const match = PACKAGE_PREFIX_PATTERN.exec(line);
    if (match !== null && packagesByDir.has(match[1])) {
      sections.get(match[1]).push(match[2]);
      continue;
    }
    unprefixed.push(line);
  }
  for (const [dir, lines] of sections) sections.set(dir, lines.join("\n"));
  return { sections, unprefixed: unprefixed.join("\n") };
}

function toRepoRelative(candidate, repoRoot) {
  const withoutLocation = candidate.replace(/:\d+(?::\d+)?$/, "");
  if (path.isAbsolute(withoutLocation)) {
    const relative = path.relative(repoRoot, withoutLocation);
    if (!relative.startsWith("..")) return relative.split(path.sep).join("/");
  }
  // A log may have been produced in another checkout (for example when the
  // harness is replayed against a captured log). Normalise to the workspace
  // relative path so reports and evidence are comparable across checkouts.
  const marker = /(?:^|[\\/])((?:apps|packages)\/[^\\/]+\/.*)$/.exec(withoutLocation);
  if (marker !== null) return marker[1].split(path.sep).join("/");
  if (path.isAbsolute(withoutLocation)) return withoutLocation;
  return withoutLocation.split(path.sep).join("/");
}

function readTapCounters(text) {
  const counters = {};
  for (const key of ["tests", "pass", "fail", "skipped", "todo"]) {
    const match = new RegExp("^# " + key + " (\\d+)", "m").exec(text);
    if (match !== null) counters[key] = Number(match[1]);
  }
  return counters;
}

/**
 * Parse node:test TAP output. Every failing entry carries the file that owns it:
 * either its location field, or the file name for a module-load failure (where
 * the entry name is the test file itself).
 */
export function parseNodeTestOutput({ packageDir, text, repoRoot }) {
  const lines = text.split("\n");
  const entries = [];
  let context = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = TAP_ENTRY_PATTERN.exec(lines[index]);
    if (match === null) {
      context.push(lines[index]);
      continue;
    }

    const status = match[1];
    const name = match[2];
    const block = [];
    if (index + 1 < lines.length && TAP_BLOCK_START_PATTERN.test(lines[index + 1])) {
      index += 1;
      while (index + 1 < lines.length) {
        index += 1;
        if (TAP_BLOCK_END_PATTERN.test(lines[index])) break;
        block.push(lines[index]);
      }
    }

    if (status === "not ok") {
      const locationLine = block.find((line) => TAP_LOCATION_PATTERN.test(line));
      const location =
        locationLine === undefined ? null : TAP_LOCATION_PATTERN.exec(locationLine)[1];
      const fallback = TEST_FILE_PATTERN.test(name) ? name : null;
      const file = location ?? fallback;
      entries.push({
        packageDir,
        name,
        file: file === null ? null : toRepoRelative(file, repoRoot),
        // One TAP failure entry is one failing case (a file-level failure is
        // itself one entry, and its own module error is not counted twice).
        failingCases: 1,
        evidence: context.concat(block).join("\n")
      });
    }
    context = [];
  }

  return {
    runner: "node-test",
    entries,
    counters: readTapCounters(text),
    countersFound: /^# tests \d+/m.test(text)
  };
}

/**
 * Parse vitest output. Evidence for one failing file is aggregated, because a
 * module-load failure prints once per file while ordinary failures print once
 * per test.
 */
export function parseVitestOutput({ packageDir, text, repoRoot }) {
  const lines = text.split("\n");
  const buckets = new Map();
  let current = null;

  for (const line of lines) {
    const match = VITEST_FAIL_PATTERN.exec(line);
    if (match !== null) {
      const relativePath = match[1].replace(/:\d+(?::\d+)?$/, "");
      const absolute = path.isAbsolute(relativePath)
        ? relativePath
        : path.join(repoRoot, packageDir, relativePath);
      const file = toRepoRelative(absolute, repoRoot);
      let bucket = buckets.get(file);
      if (bucket === undefined) {
        bucket = { packageDir, name: file, file, lines: [] };
        buckets.set(file, bucket);
      }
      bucket.lines.push(line);
      current = bucket;
      continue;
    }
    if (VITEST_SEPARATOR_PATTERN.test(line)) {
      current = null;
      continue;
    }
    if (current !== null) current.lines.push(line);
  }

  // vitest prints either "Test Files 3 failed | 57 passed (60)" or
  // "Test Files 7 passed (7)". Both forms must yield a number so that a
  // silently truncated log cannot masquerade as "no failures".
  const parseCounter = (label) => {
    const failed = new RegExp("^\\s*" + label + "\\s+(\\d+) failed", "m").exec(text);
    if (failed !== null) return Number(failed[1]);
    const passed = new RegExp("^\\s*" + label + "\\s+(\\d+) passed", "m").exec(text);
    if (passed !== null) return 0;
    return null;
  };
  return {
    runner: "vitest",
    entries: [...buckets.values()].map((entry) => ({
      packageDir: entry.packageDir,
      name: entry.name,
      file: entry.file,
      // vitest prints one FAIL line per failing test, and one for a module-load
      // failure. Counting them keeps the reported numbers equal to the runner's
      // own "Tests N failed" figure.
      failingCases: entry.lines.filter((line) => /^\s*FAIL\s/.test(line)).length,
      evidence: entry.lines.join("\n")
    })),
    counters: {
      failingFiles: parseCounter("Test Files"),
      failingTests: parseCounter("Tests")
    },
    countersFound:
      /Test Files\s+\d+ (?:failed|passed)/.test(text) ||
      // A passing vitest run prints "Test Files 7 passed (7)"; a run with no
      // failing files but a nonzero exit still prints that line, so absence of
      // the line means the output is truncated and must not be trusted.
      /Tests\s+\d+ (?:failed|passed)/.test(text)
  };
}

export function parseFailedPackages(unprefixedText, packagesByDir) {
  const dirByName = new Map();
  for (const [dir, entry] of packagesByDir) dirByName.set(entry.name, dir);
  const failed = [];
  for (const match of unprefixedText.matchAll(PNPM_FAILED_PACKAGE_PATTERN)) {
    const dir = dirByName.get(match[1]);
    if (dir !== undefined && !failed.includes(dir)) failed.push(dir);
  }
  return failed;
}

/**
 * Classify every parsed failing suite. A suite is skipped only when all of its
 * failing entries are attributed to verified-absent official data; one real
 * failing entry keeps the whole suite a failure.
 */
export function analyzeWorkspaceTestLog({
  logText,
  repoRoot,
  exitCode,
  reviewedSuites = [],
  excludedSuites = []
}) {
  const packagesByDir = discoverWorkspacePackages(repoRoot);
  const { sections, unprefixed } = splitPackageOutputs(logText, packagesByDir);
  const structuralErrors = [];
  const parsedSections = [];

  for (const [dir, text] of sections) {
    const isTap = /^# tests \d+/m.test(text) || /^TAP version \d+/m.test(text);
    const isVitest =
      /Test Files\s+\d+ (?:failed|passed)/.test(text) ||
      /^\s*[✓×]\s/m.test(text) ||
      /^\s*FAIL\s+\S+/m.test(text);
    if (!isTap && !isVitest) continue;

    const result = isTap
      ? parseNodeTestOutput({ packageDir: dir, text, repoRoot })
      : parseVitestOutput({ packageDir: dir, text, repoRoot });
    parsedSections.push({ dir, ...result });

    if (!result.countersFound) {
      structuralErrors.push(
        dir + ": no runner counters found in its output; refusing to trust this log"
      );
      continue;
    }
    const declared = isTap ? result.counters.fail : result.counters.failingFiles;
    if (declared !== result.entries.length) {
      structuralErrors.push(
        dir + ": the runner reports " + declared + " failing " +
          (isTap ? "TAP entr(ies)" : "file(s)") + " but " + result.entries.length +
          " were parsed; refusing to trust this log"
      );
    }
    if (isVitest) {
      const declaredCases = result.counters.failingTests;
      const parsedCases = result.entries.reduce(
        (total, entry) => total + (entry.failingCases ?? 1),
        0
      );
      // "Tests N failed" counts failing tests, while a FAIL line can also report
      // a failing suite/module for the same file. The parsed count must therefore
      // cover the declared one, but is allowed to be higher.
      if (declaredCases !== null && declaredCases > parsedCases) {
        structuralErrors.push(
          dir + ": vitest reports " + declaredCases + " failing test(s) but " +
            parsedCases + " FAIL entries were parsed; refusing to trust this log"
        );
      }
    }
  }

  const failedPackages = parseFailedPackages(unprefixed, packagesByDir);
  for (const dir of failedPackages) {
    const section = parsedSections.find((entry) => entry.dir === dir);
    if (section === undefined || section.entries.length === 0) {
      structuralErrors.push(
        dir + ": its test command failed but no failing entry could be parsed " +
          "from its output; see the raw log"
      );
    }
  }

  const skipped = [];
  const failures = [];
  for (const section of parsedSections) {
    const byFile = new Map();
    for (const entry of section.entries) {
      const key = entry.file ?? "<unattributed in " + section.dir + ">";
      if (!byFile.has(key)) byFile.set(key, { all: [], dataCaused: [], real: [] });
      const bucket = byFile.get(key);
      bucket.all.push(entry);
      const classified = classifyFailureEvidence(entry.evidence, repoRoot);
      if (classified.missingData) bucket.dataCaused.push(entry);
      else bucket.real.push(entry);
    }

    for (const [file, bucket] of byFile) {
      const failingCases = bucket.all.reduce(
        (total, entry) => total + (entry.failingCases ?? 1),
        0
      );
      if (bucket.real.length > 0) {
        failures.push({
          package: section.dir,
          runner: section.runner,
          file,
          count: bucket.real.reduce(
            (total, entry) => total + (entry.failingCases ?? 1),
            0
          ),
          evidence: bucket.real.map((entry) => entry.evidence).join("\n")
        });
        continue;
      }
      skipped.push({
        package: section.dir,
        runner: section.runner,
        file,
        count: failingCases,
        names: bucket.all.map((entry) => entry.name),
        evidence: bucket.dataCaused[0].evidence
      });
    }
  }

  const reviewed = new Set(reviewedSuites);
  const excluded = new Set(excludedSuites);
  for (const item of skipped) {
    item.reviewed = reviewed.has(item.file);
    item.excluded = excluded.has(item.file);
  }

  // A suite that was explicitly reviewed and rejected must never be quietly
  // absorbed as a data skip later: if it ever looks data-caused, the decision
  // behind its exclusion has to be re-examined rather than trusted.
  for (const item of skipped) {
    if (item.excluded !== true) continue;
    structuralErrors.push(
      item.file + ": this suite was reviewed and excluded from the reviewed " +
        "list because its failure is not data-caused, but it now classifies as " +
        "a data skip; re-examine the exclusion instead of trusting this log"
    );
  }

  if (exitCode === 0 && (failures.length > 0 || skipped.length > 0)) {
    structuralErrors.push(
      "the test command exited 0 but the log contains failures; refusing to trust this log"
    );
  }
  if (exitCode !== 0 && failures.length === 0 && skipped.length === 0) {
    structuralErrors.push(
      "the test command exited " + exitCode +
        " but no failing entry was found; see the raw log"
    );
  }

  return {
    repoRoot,
    exitCode,
    failedPackages,
    failures,
    skipped,
    structuralErrors,
    ok: failures.length === 0 && structuralErrors.length === 0
  };
}

export function renderReport(report, pinnedEnvelope) {
  const skippedEntries = report.skipped.reduce((total, item) => total + item.count, 0);
  const unreviewed = report.skipped.filter((item) => item.reviewed !== true);
  const lines = [];
  lines.push("## Workspace test result");
  lines.push("");
  lines.push("- Real failing suites: **" + report.failures.length + "**");
  lines.push(
    "- Skipped because the official card data is absent: **" + report.skipped.length +
      "** suite(s) / **" + skippedEntries + "** FAIL entr(ies)"
  );
  if (unreviewed.length > 0) {
    lines.push(
      "- Newly observed data-dependent suites (not in " +
        "scripts/ci/reviewed-official-data-suites.json): **" + unreviewed.length + "**"
    );
  }
  if (report.structuralErrors.length > 0) {
    lines.push("- Log/parse contradictions: **" + report.structuralErrors.length + "**");
  }
  if (pinnedEnvelope !== undefined && pinnedEnvelope.dataVersion !== null) {
    lines.push(
      "- Repository-pinned official snapshot: " + pinnedEnvelope.dataVersion +
        " / " + pinnedEnvelope.digest + " (declared in tracked sources)"
    );
  }
  lines.push("");

  if (report.skipped.length > 0) {
    lines.push("### Skipped: official card data absent in this checkout");
    lines.push("");
    lines.push(
      "These suites read packages/card-data/data/*.json, which is gitignored " +
        "generated data and cannot exist in a clean CI checkout. They are listed " +
        "here explicitly instead of failing the job, and instead of silently passing."
    );
    lines.push("");
    lines.push("| Package | Suite | FAIL entries | Reviewed |");
    lines.push("| --- | --- | ---: | --- |");
    for (const item of report.skipped) {
      lines.push(
        "| " + item.package + " | " + item.file + " | " + item.count + " | " +
          (item.reviewed === true ? "yes" : "**no**") + " |"
      );
    }
    lines.push("");
    lines.push("<details><summary>Skipped test names</summary>");
    lines.push("");
    for (const item of report.skipped) {
      lines.push("- " + item.file);
      for (const name of item.names) {
        lines.push("  - " + name.replace(/\n/g, " "));
      }
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
    if (unreviewed.length > 0) {
      lines.push(
        "Suites marked **no** have a data dependency that is not in the reviewed " +
          "list. They do not fail this job, but they are reported here so the " +
          "dependency is either reviewed and added, or the suite is made " +
          "data-independent."
      );
      lines.push("");
    }
  }

  if (report.failures.length > 0) {
    lines.push("### Real failures");
    lines.push("");
    for (const failure of report.failures) {
      lines.push(
        "- " + failure.package + " :: " + failure.file + " - " + failure.count +
          " FAIL entr(ies), runner: " + failure.runner
      );
    }
    lines.push("");
  }

  if (report.structuralErrors.length > 0) {
    lines.push("### Unsound log");
    lines.push("");
    for (const error of report.structuralErrors) lines.push("- " + error);
    lines.push("");
  }

  lines.push(
    report.ok
      ? "**Verdict: PASS** (no real failures)."
      : "**Verdict: FAIL** (real failures or an unsound log)."
  );
  return lines.join("\n") + "\n";
}

function parseArguments(argv) {
  const options = { log: null, repoRoot: null, exitCode: null, summaryOut: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const isFlag = (name) => argument === name || argument.startsWith(name + "=");
    const takeValue = (name) => {
      const prefix = name + "=";
      if (argument.startsWith(prefix)) return argument.slice(prefix.length);
      index += 1;
      if (index >= argv.length) throw new Error(name + " requires a value");
      return argv[index];
    };
    if (isFlag("--log")) options.log = takeValue("--log");
    else if (isFlag("--repo-root")) options.repoRoot = takeValue("--repo-root");
    else if (isFlag("--exit-code")) options.exitCode = Number(takeValue("--exit-code"));
    else if (isFlag("--summary-out")) options.summaryOut = takeValue("--summary-out");
    else throw new Error("Unknown option: " + argument);
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const logPath = options.log ?? process.env.WORKSPACE_TEST_LOG ?? null;
  if (logPath === null) {
    console.error("No test log given; pass --log <file> or set WORKSPACE_TEST_LOG.");
    return 1;
  }
  if (!existsSync(logPath)) {
    console.error("Test log not found: " + logPath);
    return 1;
  }

  const repoRoot = resolveRepoRoot(options.repoRoot ?? process.env.RIFTBOUND_REPO_ROOT);
  const exitCode = options.exitCode ?? Number(process.env.WORKSPACE_TEST_EXIT_CODE ?? "1");
  const reviewedPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "reviewed-official-data-suites.json"
  );
  const reviewed = readJsonIfPresent(reviewedPath);
  const report = analyzeWorkspaceTestLog({
    logText: readFileSync(logPath, "utf8"),
    repoRoot,
    exitCode,
    reviewedSuites: Array.isArray(reviewed?.suites) ? reviewed.suites : [],
    excludedSuites: Array.isArray(reviewed?.excludedAfterReview)
      ? reviewed.excludedAfterReview
          .map((entry) => (typeof entry === "string" ? entry : entry?.suite))
          .filter((suite) => typeof suite === "string")
      : []
  });
  const markdown = renderReport(report, readPinnedOfficialEnvelope(repoRoot));

  const summaryOut = options.summaryOut ?? process.env.GITHUB_STEP_SUMMARY ?? null;
  if (summaryOut !== null) appendFileSync(summaryOut, markdown + "\n", "utf8");
  const reportPath = process.env.WORKSPACE_TEST_REPORT ?? null;
  if (reportPath !== null) writeFileSync(reportPath, markdown, "utf8");
  console.log(markdown);

  const present = presentOfficialCardData(repoRoot);
  if (present.length > 0) {
    console.log(
      "Official card data is present in this checkout (" + present.join(", ") +
        "), so no failure was reclassified as a skip."
    );
  }

  for (const item of report.skipped.filter((entry) => entry.reviewed !== true)) {
    console.log(
      "::warning file=" + item.file + "::This suite failed only because the " +
        "official card data is absent, but it is not listed in " +
        "scripts/ci/reviewed-official-data-suites.json. Review the dependency, " +
        "then add the suite there or make it data-independent."
    );
  }

  return report.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
