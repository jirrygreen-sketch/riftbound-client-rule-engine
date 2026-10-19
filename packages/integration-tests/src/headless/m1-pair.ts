import type {
  HeadlessBattleStats,
  HeadlessDeckPair,
  HeadlessFailure,
  HeadlessJournal,
  HeadlessStats,
} from "./duel.js";
import type { M1PreconId } from "./decks.js";
import { performance } from "node:perf_hooks";

const { replayHeadlessJournal, runHeadlessGame } = await import(
  new URL("./duel.ts", import.meta.url).href,
);

export const M1_PAIR = Object.freeze({
  A: "rumble-sfd" as const,
  B: "fiora-sfd" as const,
});

export const M1_ACCEPTANCE_GAMES = 100;
export const M1_ACCEPTANCE_GAMES_PER_SIDE = 50;

export type M1Orientation = "rumble-a" | "fiora-a";

export interface M1AcceptanceCase {
  readonly index: number;
  readonly seed: string;
  readonly decks: HeadlessDeckPair;
  readonly orientation: M1Orientation;
}

function acceptanceCase(index: number): M1AcceptanceCase {
  const rumbleOnA = index < M1_ACCEPTANCE_GAMES_PER_SIDE;
  return Object.freeze({
    index,
    seed: `RIFT-857-m1-seed-${String(index + 1).padStart(3, "0")}`,
    decks: Object.freeze(rumbleOnA
      ? { A: M1_PAIR.A, B: M1_PAIR.B }
      : { A: M1_PAIR.B, B: M1_PAIR.A }),
    orientation: rumbleOnA ? "rumble-a" : "fiora-a",
  });
}

/** Pure data: importing this module never starts a game. */
export const M1_ACCEPTANCE_PLAN: readonly M1AcceptanceCase[] = Object.freeze(
  Array.from({ length: M1_ACCEPTANCE_GAMES }, (_, index) => acceptanceCase(index)),
);

const COMMITTED_BATTLE_TIMINGS = new Set([
  "showdown-open",
  "combat-start",
  "attack-declared",
  "defense-declared",
  "conquer",
  "score",
  "points-gained",
]);

export interface M1GameEvidence {
  readonly caseIndex: number;
  readonly seed: string;
  readonly decks: HeadlessDeckPair;
  readonly orientation: M1Orientation;
  readonly termination: HeadlessStats["termination"];
  readonly guardReason: HeadlessStats["guardReason"];
  readonly winner: HeadlessStats["winner"];
  readonly scores: HeadlessStats["scores"];
  readonly victoryScore: number;
  readonly battleStats: HeadlessBattleStats;
  readonly committedBattleEvents: readonly unknown[];
  readonly eventCount: number;
  readonly journalDigest: string;
  readonly projectionDigests: HeadlessStats["projectionDigests"];
  readonly spectatorProjectionDigest: string | null;
  readonly replayMatches: boolean;
  readonly freshWorldReplayMatches: boolean;
  readonly privacySafe: boolean;
  readonly privacyChecks: number;
  readonly exceptions: readonly string[];
  readonly blockers: readonly HeadlessFailure[];
  readonly concedeCommands: number;
  readonly naturalTermination: boolean;
}

export interface M1FailureDiagnostic {
  readonly phase: "initialization" | "execution";
  readonly caseIndex: number;
  readonly seed: string;
  readonly decks: HeadlessDeckPair;
  readonly orientation: M1Orientation;
  readonly errorName: string;
  readonly errorCode: string | null;
  readonly message: string;
  readonly canonicalCardId: string | null;
  readonly cardProgramStatus: string | null;
  readonly rulesetVersion: string | null;
  readonly judgeReason: string | null;
}

export interface M1ProbeTiming {
  readonly importMs: number;
  readonly executionMs: number;
  readonly totalMs: number;
}

export interface M1AcceptanceRun {
  readonly expectedGames: number;
  readonly attemptedGames: number;
  readonly passed: boolean;
  readonly naturalGames: number;
  readonly nonNaturalGames: number;
  readonly terminationReasons: Readonly<Record<HeadlessStats["termination"], number>>;
  readonly replayMismatches: number;
  readonly freshWorldReplayMismatches: number;
  readonly privacyLeaks: number;
  readonly planMismatches: number;
  readonly exceptionGames: number;
  readonly blockedGames: number;
  readonly guardGames: number;
  readonly concessionGames: number;
  readonly committedBattleEvents: number;
  readonly battleStats: HeadlessBattleStats;
  readonly results: readonly M1GameEvidence[];
  readonly failure: M1FailureDiagnostic | null;
  readonly timing?: M1ProbeTiming;
}

type NaturalEvidence = Pick<M1GameEvidence,
  "termination" | "winner" | "scores" | "victoryScore" | "exceptions" | "blockers" |
  "concedeCommands" | "replayMatches" | "freshWorldReplayMatches" | "privacySafe" | "privacyChecks">;

export function isNaturalM1Game(result: NaturalEvidence): boolean {
  const { winner } = result;
  return result.termination === "winner" &&
    winner !== null &&
    (result.scores[winner] ?? -1) >= result.victoryScore &&
    result.exceptions.length === 0 &&
    result.blockers.length === 0 &&
    result.concedeCommands === 0 &&
    result.replayMatches &&
    result.freshWorldReplayMatches &&
    result.privacySafe &&
    result.privacyChecks > 0;
}

function zeroBattleStats(): { -readonly [Key in keyof HeadlessBattleStats]: number } {
  return { showdowns: 0, combats: 0, attacks: 0, defenses: 0, conquers: 0, scores: 0, points: 0 };
}

export function aggregateM1Evidence(results: readonly M1GameEvidence[]): M1AcceptanceRun {
  const terminationReasons = { winner: 0, concede: 0, blocked: 0, exception: 0, guard: 0 } satisfies
    Record<HeadlessStats["termination"], number>;
  const battleStats = zeroBattleStats();
  for (const result of results) {
    terminationReasons[result.termination] += 1;
    for (const key of Object.keys(battleStats) as (keyof HeadlessBattleStats)[]) {
      battleStats[key] += result.battleStats[key];
    }
  }
  const naturalGames = results.filter(isNaturalM1Game).length;
  const nonNaturalGames = results.length - naturalGames;
  const replayMismatches = results.filter(result => !result.replayMatches).length;
  const freshWorldReplayMismatches = results.filter(result => !result.freshWorldReplayMatches).length;
  const privacyLeaks = results.filter(result => !result.privacySafe).length;
  const planMismatches = results.filter(result => {
    const expected = M1_ACCEPTANCE_PLAN[result.caseIndex];
    return expected === undefined ||
      expected.seed !== result.seed ||
      expected.orientation !== result.orientation ||
      expected.decks.A !== result.decks.A ||
      expected.decks.B !== result.decks.B;
  }).length;
  const exceptionGames = results.filter(result => result.exceptions.length > 0 || result.termination === "exception").length;
  const concessionGames = results.filter(result => result.termination === "concede" || result.concedeCommands > 0).length;
  return {
    expectedGames: M1_ACCEPTANCE_GAMES,
    attemptedGames: results.length,
    passed: results.length === M1_ACCEPTANCE_GAMES && naturalGames === M1_ACCEPTANCE_GAMES && planMismatches === 0 &&
      replayMismatches === 0 && freshWorldReplayMismatches === 0 && privacyLeaks === 0 &&
      exceptionGames === 0 && concessionGames === 0,
    naturalGames,
    nonNaturalGames,
    terminationReasons,
    replayMismatches,
    freshWorldReplayMismatches,
    privacyLeaks,
    planMismatches,
    exceptionGames,
    blockedGames: terminationReasons.blocked,
    guardGames: terminationReasons.guard,
    concessionGames,
    committedBattleEvents: results.reduce((sum, result) => sum + result.committedBattleEvents.length, 0),
    battleStats,
    results,
    failure: null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function stringField(value: Record<string, unknown> | null, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" ? field : null;
}

function diagnosticFor(
  acceptance: M1AcceptanceCase,
  error: unknown,
  attemptedGames: number,
): M1FailureDiagnostic {
  const outer = record(error);
  const detail = record(outer?.["detail"]);
  return {
    phase: attemptedGames === 1 ? "initialization" : "execution",
    caseIndex: acceptance.index,
    seed: acceptance.seed,
    decks: acceptance.decks,
    orientation: acceptance.orientation,
    errorName: error instanceof Error ? error.name : "Error",
    errorCode: stringField(outer, "code"),
    message: error instanceof Error ? error.message : String(error),
    canonicalCardId: stringField(detail, "canonicalCardId"),
    cardProgramStatus: stringField(detail, "status"),
    rulesetVersion: stringField(detail, "rulesetVersion"),
    judgeReason: stringField(detail, "judgeReason"),
  };
}

function failedRun(results: readonly M1GameEvidence[], failure: M1FailureDiagnostic): M1AcceptanceRun {
  return { ...aggregateM1Evidence(results), passed: false, failure };
}

function executePlan(plan: readonly M1AcceptanceCase[]): M1AcceptanceRun {
  const results: M1GameEvidence[] = [];
  for (const acceptance of plan) {
    let journal: HeadlessJournal | undefined;
    let stats: HeadlessStats;
    try {
      stats = runHeadlessGame(acceptance.seed, {
        decks: [acceptance.decks.A as M1PreconId, acceptance.decks.B as M1PreconId],
        onJournal: (value: HeadlessJournal) => { journal = value; },
      });
    } catch (error) {
      return failedRun(results, diagnosticFor(acceptance, error, results.length + 1));
    }
    const freshWorldReplayMatches = journal ? replayHeadlessJournal(journal) : false;
    const committedBattleEvents = journal?.events.filter(event =>
      COMMITTED_BATTLE_TIMINGS.has(event.timingPoint)) ?? [];
    const finalProjections = record(journal?.final?.["projections"]);
    const spectatorProjectionDigest = typeof finalProjections?.["spectator"] === "string"
      ? finalProjections["spectator"]
      : null;
    const result: M1GameEvidence = {
      caseIndex: acceptance.index,
      seed: acceptance.seed,
      decks: acceptance.decks,
      orientation: acceptance.orientation,
      termination: stats.termination,
      guardReason: stats.guardReason,
      winner: stats.winner,
      scores: stats.scores,
      victoryScore: stats.victoryScore,
      battleStats: stats.battleStats,
      committedBattleEvents,
      eventCount: stats.eventCount,
      journalDigest: stats.journalDigest,
      projectionDigests: stats.projectionDigests,
      spectatorProjectionDigest,
      replayMatches: stats.replayMatches,
      freshWorldReplayMatches,
      privacySafe: stats.privacySafe,
      privacyChecks: stats.privacyChecks,
      exceptions: stats.exceptions,
      blockers: stats.blockers,
      concedeCommands: stats.actionCoverage.commands.concede,
      naturalTermination: false,
    };
    const evidence = Object.freeze({ ...result, naturalTermination: isNaturalM1Game(result) });
    results.push(evidence);
    if (stats.termination === "exception") {
      return failedRun(results, {
        phase: "execution", caseIndex: acceptance.index, seed: acceptance.seed,
        decks: acceptance.decks, orientation: acceptance.orientation,
        errorName: "HeadlessException", errorCode: "exception",
        message: stats.exceptions.join("\n") || "Headless game terminated with an exception",
        canonicalCardId: null, cardProgramStatus: null, rulesetVersion: null, judgeReason: null,
      });
    }
  }
  return aggregateM1Evidence(results);
}

/**
 * Explicit one-game diagnostic. It never advances to a second seed after a
 * thrown setup error and returns the actual termination without predicting a
 * permanent blocker. It is intentionally not part of the automatic unit-test
 * configuration because a full runtime/replay/privacy probe has acceptance
 * cost; callers use this entry or the separately gated runM1Acceptance().
 */
export function probeM1Acceptance(): M1AcceptanceRun {
  const startedAt = performance.now();
  const run = executePlan(M1_ACCEPTANCE_PLAN.slice(0, 1));
  const finishedAt = performance.now();
  return Object.freeze({
    ...run,
    timing: Object.freeze({ importMs: 0, executionMs: Math.round(finishedAt - startedAt), totalMs: Math.round(finishedAt - startedAt) }),
  });
}

/** Explicit full gate. Nothing invokes this at module load or from the existing soak/CLI entry points. */
export function runM1Acceptance(): M1AcceptanceRun {
  return executePlan(M1_ACCEPTANCE_PLAN);
}
