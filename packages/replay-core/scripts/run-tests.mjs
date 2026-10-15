#!/usr/bin/env node
// Default replay-core test entrypoint.
//
// It compiles the package with the local TypeScript into a throwaway directory
// (never the shared ./dist), redirects every suite import that would otherwise
// resolve inside ./dist at that isolated build through a resolver hook anchored
// on this package root, and refuses to report a result when that redirect did
// not cover the imports the suites declare. Build/run terminations and ordinary
// failures are reported distinctly, and a run that is cut short is exited on its
// own terms (a run timeout still exits 124) before the hits guard can fold it
// into a plain exit 1. Children are spawned without Node's module-injection
// environment variables, so an inherited NODE_OPTIONS cannot preload code into
// the isolated process and read the shared ./dist. The isolated directory is
// removed on normal exit and on SIGINT/SIGTERM/SIGHUP.
//
// This module is also imported by the POSIX-only suites (for `suiteRunsOnThisHost`)
// and by the fault-injection scripts, so it must not do anything on import: all
// side effects live in `main()`, which only runs when this file is the entry point.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { constants as osConstants, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// POSIX-only suites assert private file modes, symlink/FIFO handling and other
// POSIX-only filesystem semantics. On other hosts they are excluded from the
// file list entirely (never test.skip), so those runs still report zero skips.
// This set is the single source of truth: the suites themselves import
// `suiteRunsOnThisHost` from this module for their own platform guard, so the
// runner's selection and the per-file guards cannot drift apart.
export const POSIX_ONLY_SUITES = new Set([
  "private-file-permissions.test.mjs",
  "ignored-directory-cache.test.mjs"
]);

const POSIX_PLATFORMS = new Set(["darwin", "linux", "freebsd", "openbsd", "netbsd"]);

// RIFTBOUND_REPLAY_TEST_PLATFORM is a test-only override (same values as
// process.platform) so the non-POSIX selection can be exercised on a POSIX host.
export function hostPlatform() {
  return process.env.RIFTBOUND_REPLAY_TEST_PLATFORM || process.platform;
}

export function isPosixHost(platform = hostPlatform()) {
  return POSIX_PLATFORMS.has(platform);
}

export function isPosixOnlySuite(file) {
  return POSIX_ONLY_SUITES.has(path.basename(file));
}

export function suiteRunsOnThisHost(file, platform = hostPlatform()) {
  return !isPosixOnlySuite(file) || isPosixHost(platform);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const HANDLED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const SIGNAL_NUMBERS = osConstants.signals;
const DEFAULT_BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;
// GNU timeouts use 124 for "timed out"; 128+n covers "terminated by signal n".
const TIMEOUT_EXIT_CODE = 124;

// Node's module-injection environment variables. An inherited NODE_OPTIONS can
// `--import`/`--require`/`--loader` arbitrary code into every process we spawn,
// and NODE_PATH redirects CommonJS resolution. The ESM redirect loader below
// only intercepts ESM loads, so it cannot stop such an injected module from
// reading the shared build; the only place the runner can enforce isolation is
// by never handing these variables to the children it starts. The runner's own
// loader/format/warning flags are CLI arguments, so stripping the environment
// does not touch them.
export const INHERITED_MODULE_INJECTION_VARS = ["NODE_OPTIONS", "NODE_PATH"];

// Budget for the POSIX FIFO children spawned by the private-file-permissions and
// ignored-directory-cache suites. Each child boots node, dynamically imports the
// isolated build and then inspects a FIFO (one scenario additionally spawns
// python3 to create it), so a loaded host can spend well over a second on
// startup alone; the former 1300/1600ms budgets produced false reds under load.
// It stays a finite upper bound (never an unbounded wait and never a blind
// retry) and is overridable for slow hosts. Both suites read it from here so
// their budgets cannot drift apart.
const DEFAULT_FIFO_CHILD_TIMEOUT_MS = 20 * 1000;

function resolveTsc() {
  const packageJson = require.resolve("typescript/package.json");
  return path.join(path.dirname(packageJson), "lib", "tsc.js");
}

function readTimeoutMs(envName, fallback) {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${envName} must be a positive integer number of milliseconds, received ${JSON.stringify(raw)}`);
  }
  return value;
}

export function fifoChildTimeoutMs() {
  return readTimeoutMs("RIFTBOUND_REPLAY_FIFO_TIMEOUT_MS", DEFAULT_FIFO_CHILD_TIMEOUT_MS);
}

// Strips the module-injection variables above from the ambient environment and
// folds in the runner's own overrides. Every child the runner spawns (build and
// run) goes through this, so an inherited NODE_OPTIONS cannot silently preload
// code into the isolated test process.
export function resolveChildEnvironment(extra) {
  const env = { ...process.env, ...(extra ?? {}) };
  for (const name of INHERITED_MODULE_INJECTION_VARS) delete env[name];
  return env;
}

function collectTestFiles() {
  const files = [];
  const add = (relativeDir) => {
    const absoluteDir = path.join(packageRoot, relativeDir);
    if (!existsSync(absoluteDir)) return;
    for (const name of readdirSync(absoluteDir).sort()) {
      if (!name.endsWith(".test.mjs")) continue;
      if (!suiteRunsOnThisHost(name)) continue;
      files.push(path.join(relativeDir, name));
    }
  };
  add("test");
  add(path.join("test", "full-product"));
  return files;
}

// The suites reach the package build through relative specifiers such as
// `../dist/index.js`. Collecting them here gives the runner an explicit list of
// the imports the redirect below MUST cover; a redirect that silently stops
// matching (package relocated, layout reshaped) fails the run instead of
// quietly reading the shared ./dist.
const DIST_SPECIFIER = /["'](\.[^"']*\/dist\/[^"']*)["']/g;

function distKeyFor(absolute) {
  return path.relative(path.join(packageRoot, "dist"), absolute).split(path.sep).join("/");
}

function isInsideSharedDist(absolute) {
  const distDir = path.join(packageRoot, "dist");
  return absolute === distDir || absolute.startsWith(distDir + path.sep);
}

function collectExpectedDistImports(testFiles) {
  const expected = new Map();
  for (const file of testFiles) {
    const absoluteFile = path.join(packageRoot, file);
    const source = readFileSync(absoluteFile, "utf8");
    for (const match of source.matchAll(DIST_SPECIFIER)) {
      const resolved = path.resolve(path.dirname(absoluteFile), match[1]);
      if (!isInsideSharedDist(resolved)) continue;
      const key = distKeyFor(resolved);
      if (!expected.has(key)) expected.set(key, new Set());
      expected.get(key).add(file);
    }
  }
  return expected;
}

function readRedirectHits(hitsFile) {
  if (!existsSync(hitsFile)) return new Set();
  return new Set(
    readFileSync(hitsFile, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
}

// Routes the suites' relative `../dist/...` and `../../dist/...` imports at the
// isolated build so the default run never reads or writes the shared ./dist.
// The anchor is the package root handed over in the environment, not a literal
// path segment, so a relocated/renamed package keeps working; every redirect is
// recorded so the runner can prove the mapping was exercised, and any load that
// still lands inside the shared ./dist is refused outright.
export const LOADER_SOURCE = `import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = process.env.RIFTBOUND_REPLAY_PACKAGE_ROOT;
const isolatedDist = process.env.RIFTBOUND_REPLAY_TEST_DIST;
const hitsFile = process.env.RIFTBOUND_REPLAY_TEST_DIST_HITS;
if (!packageRoot || !isolatedDist || !hitsFile) {
  throw new Error(
    "replay-core dist redirect loader requires RIFTBOUND_REPLAY_PACKAGE_ROOT, RIFTBOUND_REPLAY_TEST_DIST and RIFTBOUND_REPLAY_TEST_DIST_HITS"
  );
}

const sharedDist = path.join(packageRoot, "dist");
const sharedDistPrefix = sharedDist + path.sep;

function localPathFor(specifier, parentURL) {
  if (typeof specifier !== "string") return null;
  if (specifier.startsWith("file:")) {
    try {
      return fileURLToPath(specifier);
    } catch {
      return null;
    }
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    typeof parentURL === "string" &&
    parentURL.startsWith("file:")
  ) {
    try {
      return fileURLToPath(new URL(specifier, parentURL));
    } catch {
      return null;
    }
  }
  return null;
}

function formatFor(filePath) {
  if (filePath.endsWith(".mjs") || filePath.endsWith(".js")) return "module";
  if (filePath.endsWith(".cjs")) return "commonjs";
  return null;
}

function redirect(filePath, resolved) {
  const relative = path.relative(sharedDist, filePath).split(path.sep).join("/");
  appendFileSync(hitsFile, relative + "\\n");
  const target = path.join(isolatedDist, ...relative.split("/"));
  const url = pathToFileURL(target).href;
  const format = formatFor(target) || (resolved && resolved.format);
  return format ? { url, format, shortCircuit: true } : { url, shortCircuit: true };
}

// The mapping is plain path arithmetic anchored on the package root: it is
// applied before the default resolver runs, so it also covers layouts where the
// shared ./dist does not exist (a relocated or renamed package).
export async function resolve(specifier, context, nextResolve) {
  const parentURL = context && context.parentURL;
  const direct = localPathFor(specifier, parentURL);
  if (direct && direct.startsWith(sharedDistPrefix)) {
    return redirect(direct, null);
  }
  const resolved = await nextResolve(specifier, context);
  const url = resolved && resolved.url;
  if (typeof url === "string" && url.startsWith("file:")) {
    let filePath = null;
    try {
      filePath = fileURLToPath(url);
    } catch {
      filePath = null;
    }
    if (filePath && filePath.startsWith(sharedDistPrefix)) {
      return redirect(filePath, resolved);
    }
  }
  return resolved;
}

export async function load(url, context, nextLoad) {
  if (typeof url === "string" && url.startsWith("file:")) {
    let filePath;
    try {
      filePath = fileURLToPath(url);
    } catch {
      filePath = null;
    }
    if (filePath && filePath.startsWith(sharedDistPrefix)) {
      throw new Error(
        "refusing to load the shared replay-core build during an isolated test run: " + filePath
      );
    }
  }
  return nextLoad(url, context);
}
`;

function runChild({ command, args, label, cwd, env, timeoutMs, state }) {
  return new Promise((resolve) => {
    // `env` here is only the runner's own overrides; resolveChildEnvironment
    // rebuilds from the ambient environment with the module-injection variables
    // removed, so no caller can leak NODE_OPTIONS into a child by omission.
    const child = spawn(command, args, { cwd, env: resolveChildEnvironment(env), stdio: "inherit" });
    state.child = child;

    let timedOut = false;
    let settled = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      // SIGTERM first so a node --test parent can tear its own children down,
      // SIGKILL if it does not react.
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      if (typeof killTimer.unref === "function") killTimer.unref();
    }, timeoutMs);

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);
      if (state.child === child) state.child = null;
      resolve({ label, timeoutMs, timedOut, ...result });
    };

    child.once("error", (error) => settle({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => settle({ code, signal, error: null }));
  });
}

function stopChild(state, signal) {
  const child = state.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // Already gone: nothing to stop.
  }
}

function describeFailure(result) {
  if (result.timedOut) {
    return `${result.label} timed out after ${result.timeoutMs}ms and had to be killed (${result.signal ?? "no signal reported"})`;
  }
  if (result.error) return `${result.label} could not be started: ${result.error.message}`;
  if (result.signal) return `${result.label} was terminated by signal ${result.signal}`;
  if (result.code !== 0) return `${result.label} failed with exit code ${result.code}`;
  return null;
}

function exitCodeFor(result) {
  if (result.timedOut) return TIMEOUT_EXIT_CODE;
  if (result.error) return 1;
  if (result.signal) return 128 + (SIGNAL_NUMBERS[result.signal] ?? 0);
  return result.code ?? 1;
}

// Removes the isolated directory and then dies from the very signal we caught,
// so callers still observe an interrupted run as interrupted (128+n), not as a
// plain failure exit.
function interrupt(signal, cleanup) {
  cleanup();
  for (const name of HANDLED_SIGNALS) process.removeAllListeners(name);
  process.kill(process.pid, signal);
  return 128 + (SIGNAL_NUMBERS[signal] ?? 0);
}

async function main() {
  const buildTimeoutMs = readTimeoutMs("RIFTBOUND_REPLAY_TEST_BUILD_TIMEOUT_MS", DEFAULT_BUILD_TIMEOUT_MS);
  const runTimeoutMs = readTimeoutMs("RIFTBOUND_REPLAY_TEST_RUN_TIMEOUT_MS", DEFAULT_RUN_TIMEOUT_MS);

  const isolatedRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "replay-core-test-")));
  const isolatedDist = path.join(isolatedRoot, "dist");
  const hitsFile = path.join(isolatedRoot, "dist-redirect-hits.txt");
  const childState = { child: null, signal: null };

  for (const signal of HANDLED_SIGNALS) {
    process.on(signal, () => {
      childState.signal = signal;
      stopChild(childState, signal);
    });
  }

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    rmSync(isolatedRoot, { recursive: true, force: true });
  };

  try {
    writeFileSync(hitsFile, "");

    const build = await runChild({
      command: process.execPath,
      args: [
        resolveTsc(),
        "-p", path.join(packageRoot, "tsconfig.json"),
        "--outDir", isolatedDist,
        "--tsBuildInfoFile", path.join(isolatedRoot, "tsconfig.tsbuildinfo")
      ],
      label: "replay-core isolated build",
      cwd: packageRoot,
      timeoutMs: buildTimeoutMs,
      state: childState
    });
    if (childState.signal) return interrupt(childState.signal, cleanup);
    const buildFailure = describeFailure(build);
    if (buildFailure) {
      console.error(buildFailure);
      return exitCodeFor(build);
    }

    const loaderPath = path.join(isolatedRoot, "dist-redirect-loader.mjs");
    writeFileSync(loaderPath, LOADER_SOURCE);
    // The isolated build lives outside the package, so give it the module type
    // the suites expect instead of relying on filesystem-based detection.
    writeFileSync(path.join(isolatedRoot, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);

    const testFiles = collectTestFiles();
    if (testFiles.length === 0) {
      console.error("replay-core: no test files matched the current platform");
      return 1;
    }

    const expectedDistImports = collectExpectedDistImports(testFiles);
    if (expectedDistImports.size === 0) {
      console.error("replay-core: no ./*dist imports were found in the collected test files, so the isolated build cannot be verified");
      return 1;
    }

    const run = await runChild({
      command: process.execPath,
      args: [
        "--disable-warning=ExperimentalWarning",
        "--experimental-loader", loaderPath,
        // Serial file execution: the POSIX suites spawn bounded child processes
        // with tight timeouts, so cross-file CPU contention makes them flaky.
        "--test-concurrency=1",
        "--test",
        ...testFiles
      ],
      label: "replay-core test run",
      cwd: packageRoot,
      timeoutMs: runTimeoutMs,
      state: childState,
      // Only the runner's own overrides; resolveChildEnvironment adds the
      // ambient environment minus the module-injection variables.
      env: {
        RIFTBOUND_REPLAY_PACKAGE_ROOT: packageRoot,
        RIFTBOUND_REPLAY_TEST_DIST: isolatedDist,
        RIFTBOUND_REPLAY_TEST_DIST_HITS: hitsFile
      }
    });
    if (childState.signal) return interrupt(childState.signal, cleanup);

    // A termination or ordinary failure of the run is reported (and exited) on
    // its own terms BEFORE the hits guard: when the run is cut short, the
    // redirect hits are legitimately incomplete, and letting the guard run first
    // would fold a real timeout (exit 124) into a misleading exit 1.
    const runFailure = describeFailure(run);
    if (runFailure) {
      console.error(runFailure);
      return exitCodeFor(run);
    }

    // The redirect is only trustworthy if it covered every dist import the
    // suites declare; otherwise the suites could have read the shared ./dist.
    const hits = readRedirectHits(hitsFile);
    const missing = [...expectedDistImports].filter(([key]) => !hits.has(key));
    if (missing.length > 0) {
      console.error(
        "replay-core: the ./dist redirect did not cover every import the suites declare; refusing to report this run as isolated:"
      );
      for (const [key, importers] of missing) {
        console.error(`  - dist/${key} (imported by ${[...importers].join(", ")})`);
      }
      return 1;
    }

    return 0;
  } finally {
    cleanup();
  }
}

function isEntryPoint() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  try {
    return realpathSync(path.resolve(entry)) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`replay-core test runner failed: ${error && error.stack ? error.stack : error}`);
      process.exitCode = 1;
    }
  );
}
