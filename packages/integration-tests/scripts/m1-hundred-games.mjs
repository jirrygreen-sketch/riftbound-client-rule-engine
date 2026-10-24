import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";

const SCRIPT_URL = new URL(import.meta.url);

if (parentPort && workerData?.kind === "game") {
  try {
    const { testCase, maxTurns, maxCommands } = workerData;
    const { replayHeadlessJournal, runHeadlessGame } = await import(
      new URL("../src/headless/duel.ts", import.meta.url).href,
    );
    let journal;
    const stats = runHeadlessGame(testCase.seed, {
        decks: [testCase.decks.A, testCase.decks.B], maxTurns, maxActions: maxCommands,
        onJournal: value => { journal = value; },
      });
    if (journal === undefined) throw new Error("Headless journal callback was not invoked");
    const replayMatches = stats.replayMatches && replayHeadlessJournal(journal);
    parentPort.postMessage({ ok: true, stats, journal, replayMatches });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: {
      name: error instanceof Error ? error.name : "Error",
      code: error instanceof Error && "code" in error ? String(error.code) : "worker-error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
    } });
  }
} else if (process.argv[1] && fileURLToPath(SCRIPT_URL) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const { runM1HundredGameStats, m1StatsMarkdown, M1_STATS_DEFAULT_MAX_COMMANDS,
    M1_STATS_DEFAULT_MAX_TURNS, M1_STATS_DEFAULT_WALL_MS } = await import(
    new URL("../src/headless/stats.ts", import.meta.url).href,
  );
  const directory = process.env.RIFT_990_EVIDENCE_DIR ?? "/tmp/RIFT-990-m1-hundred-game-stats";
  await mkdir(directory, { recursive: true });
  const games = positiveFlag("--games", 100);
  const scriptUrl = new URL(import.meta.url);
  const workerUrl = scriptUrl;
  const summary = await runM1HundredGameStats({
    games,
    wallTimeoutMs: positiveFlag("--wall-ms", M1_STATS_DEFAULT_WALL_MS),
    maxTurns: positiveFlag("--max-turns", M1_STATS_DEFAULT_MAX_TURNS),
    maxCommands: positiveFlag("--max-actions", M1_STATS_DEFAULT_MAX_COMMANDS),
    maxConcurrency: positiveFlag("--concurrency", 1),
    workerUrl,
    journalDirectory: `${directory}/journals`,
    onResult: result => process.stderr.write(`[m1-stats] ${result.caseIndex + 1}/${games} ${result.seed} ${result.outcome} ${Math.round(result.elapsedMs)}ms\n`),
  });
  await writeFile(`${directory}/m1-stats-summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(`${directory}/m1-stats-summary.md`, `${m1StatsMarkdown(summary)}\n`);
  console.log(`games=${summary.games} outcomes=${JSON.stringify(summary.outcomes)} wallMs=${Math.round(summary.wallMs)}`);
}

function positiveFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  const raw = process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ??
    (index >= 0 ? process.argv[index + 1] : undefined) ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}
