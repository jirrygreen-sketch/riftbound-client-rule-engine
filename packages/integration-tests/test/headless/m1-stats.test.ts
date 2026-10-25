import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  M1_STATS_GAMES,
  M1_STATS_GAMES_PER_SIDE,
  classifyGame,
  commandTimingSource,
  commandTimings,
  durationDistribution,
  m1StatsCases,
  parsePersistedHeadlessJournal,
  runIsolatedM1Game,
  runM1StatsCases,
  summarizeM1Games,
  summarizeM1GamesWithJournals,
  type M1GameStats,
  type M1StatsCase,
} from "../../src/headless/stats.js";
import type { HeadlessJournal, HeadlessStats } from "../../src/headless/duel.js";

const ZERO_COMMANDS = { play: 0, idle: 0, pass: 0, advance: 0, move: 0,
  "rune-energy": 0, "combat-damage": 0, concede: 0 } as const;

function stats(overrides: Partial<HeadlessStats> = {}): HeadlessStats {
  return {
    seed: "stats-test", decks: { A: "rumble-sfd", B: "fiora-sfd" }, winner: "A", turnNumber: 9,
    termination: "winner", guardReason: null, blockers: [], scores: { A: 8, B: 4 }, victoryScore: 8,
    battleStats: { showdowns: 1, combats: 1, attacks: 1, defenses: 1, conquers: 1, scores: 1, points: 8 },
    privacyChecks: 3, exceptions: [], judgeRequiredRejections: 0, judgeRequiredCards: [],
    judgeRequiredCardCounts: [], judgeRequiredTop: [],
    actionCoverage: { commands: { ...ZERO_COMMANDS }, choices: { optional: 0, mode: 0, number: 0,
      "select-objects": 0, order: 0 } },
    observedActions: { commands: { ...ZERO_COMMANDS }, choices: { optional: 0, mode: 0, number: 0,
      "select-objects": 0, order: 0 }, committedPlays: 0, rejectedPlays: 0 },
    eventCount: 40, journalDigest: "a".repeat(64),
    projectionDigests: { A: "b".repeat(64), B: "c".repeat(64) },
    replayMatches: true, privacySafe: true, ...overrides,
  };
}

function journal(count = 4): HeadlessJournal {
  return { seed: "stats-test", decks: { A: "rumble-sfd", B: "fiora-sfd" }, mulligans: [[], []],
    commands: Array.from({ length: count }, () => ({ command: { type: "advance" as const }, failure: null })),
    events: [], final: {} };
}

function game(testCase: M1StatsCase, outcome: M1GameStats["outcome"]): M1GameStats {
  const completed = outcome !== "timeout";
  return { caseIndex: testCase.index, seed: testCase.seed, orientation: testCase.orientation,
    decks: [testCase.decks.A, testCase.decks.B], outcome,
    termination: outcome === "natural-win" ? "winner" : outcome === "blocked" ? "blocked" :
      outcome === "exception" ? "exception" : outcome === "command-limit" || outcome === "no-progress" ||
        outcome === "turn-limit" ? "guard" :
        outcome === "timeout" ? "timeout" : "winner",
    guardReason: outcome === "command-limit" ? "action-limit" : outcome === "no-progress" ? "no-progress" :
      outcome === "turn-limit" ? "turn-limit" : null,
    winner: outcome === "natural-win" ? "A" : null, turns: completed ? 2 : null,
    commands: completed ? 2 : null, eventCount: completed ? 4 : 0, elapsedMs: 10,
    score: completed ? { A: 8, B: 3 } : null, victoryScore: completed ? 8 : null,
    battleStats: completed ? { showdowns: 1, combats: 1, attacks: 1, defenses: 1, conquers: 1, scores: 1, points: 8 } : null,
    commandTimings: completed ? [{ index: 0, indexInJournal: 0, type: "advance", player: null, elapsedMs: 3 }] :
      [], commandDuration: completed ? durationDistribution([3]) : durationDistribution([]),
    commandTimingSource: completed ? "journal" : "none", cards: [], judgeRequiredCards: [],
    unhandledChoices: [], blockers: [], exceptions: outcome === "exception" ? ["Error: failed"] : [],
    replayChecked: completed, replayMatches: completed, privacySafe: completed, journalDigest: completed ? "a".repeat(64) : null,
    journalPath: completed ? "journal.json" : null, lastCommands: [],
    error: outcome === "timeout" ? { name: "TimeoutError", code: "worker-error", message: "limit",
      stack: null } : null };
}

describe("RIFT-990 M1 hundred-game statistics", () => {
  it("RIFT-1039: a persisted journal keeps its Maps, including legacy empty counter Maps", async () => {
    const { stringifyPersistedReplayJson } = await import(
      new URL("../../../replay-core/src/canonical-json.ts", import.meta.url).href) as
      typeof import("../../../replay-core/src/canonical-json.ts");
    const object = { ref: { id: "u1", zoneEntryId: 1 }, counters: new Map<string, number>() };
    const charged = { ref: { id: "u2", zoneEntryId: 1 }, counters: new Map([["buff", 2]]) };
    const journal = { seed: "s", events: [{ object }, { object: charged }] } as unknown as HeadlessJournal;
    const persisted = stringifyPersistedReplayJson(journal);
    const restored = parsePersistedHeadlessJournal(persisted) as unknown as typeof journal & {
      events: { object: { counters: Map<string, number> } }[] };
    expect(restored.events[0]!.object.counters).toBeInstanceOf(Map);
    expect(restored.events[0]!.object.counters.size).toBe(0);
    expect([...restored.events[1]!.object.counters]).toEqual([["buff", 2]]);
    // A legacy archive written with plain JSON.stringify lost the empty Map as {}.
    const legacy = parsePersistedHeadlessJournal(JSON.stringify(journal)) as unknown as typeof restored;
    expect(legacy.events[0]!.object.counters).toBeInstanceOf(Map);
    expect(legacy.events[0]!.object.counters.size).toBe(0);
  });

  it("RIFT-1039: the isolated-game writer persists Maps through its disk read path", async () => {
    const testCase = m1StatsCases(1)[0]!;
    const directory = await mkdtemp(join(tmpdir(), "rift-1039-write-roundtrip-"));
    const workerUrl = new URL("data:text/javascript," + encodeURIComponent(`
      import { parentPort } from "node:worker_threads";
      parentPort.postMessage({
        ok: true,
        replayMatches: true,
        stats: ${JSON.stringify(stats({ seed: testCase.seed, decks: testCase.decks }))},
        journal: {
          seed: ${JSON.stringify(testCase.seed)},
          decks: ${JSON.stringify(testCase.decks)},
          mulligans: [[], []],
          commands: [],
          events: [{ object: { counters: new Map([["ready", 2]]) } }],
          final: {}
        }
      });
    `));
    try {
      const result = await runIsolatedM1Game(testCase, {
        wallTimeoutMs: 5_000, maxTurns: 1, maxCommands: 1, journalDirectory: directory, workerUrl,
      });
      expect(result.journalPath).not.toBeNull();
      const serialized = await readFile(result.journalPath!, "utf8");
      expect(serialized).toContain('"map":[["ready",2]]');
      const restored = parsePersistedHeadlessJournal(serialized);
      const counters = (restored.events[0] as unknown as {
        readonly object: { readonly counters: Map<string, number> };
      }).object.counters;
      expect(counters).toBeInstanceOf(Map);
      expect([...counters]).toEqual([["ready", 2]]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("pins the 100-seed plan to 50 games per seat orientation", () => {
    const cases = m1StatsCases();
    expect(cases).toHaveLength(M1_STATS_GAMES);
    expect(new Set(cases.map(value => value.seed)).size).toBe(100);
    expect(cases.filter(value => value.orientation === "rumble-a")).toHaveLength(M1_STATS_GAMES_PER_SIDE);
    expect(cases.filter(value => value.orientation === "fiora-a")).toHaveLength(M1_STATS_GAMES_PER_SIDE);
    for (const value of cases) {
      expect(new Set([value.decks.A, value.decks.B])).toEqual(new Set(["rumble-sfd", "fiora-sfd"]));
      expect(value.decks.A).toBe(value.orientation === "rumble-a" ? "rumble-sfd" : "fiora-sfd");
    }
  });

  it("classifies every terminating evidence class without assuming a natural winner", () => {
    expect(classifyGame(stats(), true)).toBe("natural-win");
    expect(classifyGame(stats({ winner: null, termination: "blocked", blockers: [
      { name: "ProgramBindingError", code: "judge-required", message: "pending" }] }), true)).toBe("blocked");
    expect(classifyGame(stats({ winner: null, termination: "exception", exceptions: ["Error: failed"] }), true)).toBe("exception");
    expect(classifyGame(stats({ winner: null, termination: "guard", guardReason: "action-limit" }), true)).toBe("command-limit");
    expect(classifyGame(stats({ winner: null, termination: "guard", guardReason: "no-progress" }), true)).toBe("no-progress");
    expect(classifyGame(stats(), false)).toBe("replay-mismatch");
    expect(classifyGame(stats({ scores: { A: 7, B: 4 } }), true)).toBe("exception");
  });

  it("uses exact journal timing samples and reports a truthful p50/p95/max", () => {
    const value = journal(4) as HeadlessJournal & { readonly timing?: { readonly commandMs: readonly number[] } };
    Object.defineProperty(value, "timing", { value: { commandMs: [10, 30, 110, 750] } });
    expect(commandTimings(value).map(sample => sample.elapsedMs)).toEqual([10, 30, 110, 750]);
    expect(commandTimingSource(value)).toBe("journal");
    expect(durationDistribution([10, 30, 110, 750])).toEqual({ count: 4, p50Ms: 30, p95Ms: 750, maxMs: 750 });
  });

  it("does not turn whole-game timing into a fabricated per-command distribution", () => {
    const value = journal(2);
    expect(commandTimings(value)).toEqual([]);
    expect(commandTimingSource(value)).toBe("unavailable");
  });

  it("aggregates outcome counts, failures and unavailable limits without natural-win assumptions", () => {
    const cases = m1StatsCases(4);
    const outcomes = ["natural-win", "blocked", "exception", "timeout"] as const;
    const results = cases.map((value, index) => game(value, outcomes[index]!));
    const summary = summarizeM1Games(cases, results, 1234);
    expect(summary.outcomes).toEqual({ "natural-win": 1, blocked: 1, exception: 1, timeout: 1,
      "command-limit": 0, "no-progress": 0, "turn-limit": 0, "replay-mismatch": 0 });
    expect(summary.guardReasons["no-progress"]).toBe(0);
    expect(summary.battleStats.scores).toBe(3);
    expect(summary.matchesWithCommands).toBe(3);
    expect(summary.scope).toEqual({ games: 4, perSide: 2, pair: { A: "rumble-sfd", B: "fiora-sfd" } });
    expect(summary.replayChecks).toBe(3);
    expect(summary.totalCommands).toBeNull();
    expect(summary.failures).toHaveLength(3);
    expect(summary.failureCategories.reduce((sum, category) => sum + category.count, 0)).toBe(3);
    expect(summary.commandTimingUnavailableGames).toBe(0);
    expect(summary.commandTimingGames).toBe(3);
    expect(summary.commandTimingNote).toBeNull();
    expect(summary.commandFailureCategories).toEqual([]);
    expect(summary.stalledCandidates).toEqual([]);

    const withFailures = summarizeM1GamesWithJournals(cases, results, 1234, new Map([
      [0, { ...journal(1), commands: [{ command: { type: "play" as const, player: "A",
        object: { id: "card", zoneEntryId: 0 }, id: "play-1" }, failure: { name: "CostPlanError",
        code: "cannot-pay-cost", message: "insufficient" }, trace: { turn: 1, turnPlayer: "A",
        phase: "main", priority: "A", focus: null, turnState: "neutral-open", canActNormal: true,
        candidateCounts: { play: 1, idle: 0, pass: 0, advance: 0, move: 0, "rune-energy": 0,
          "combat-damage": 0, concede: 0 }, boardUnits: [], basicRunes: [], runePool: { A: { energy: 0, power: [] },
          B: { energy: 0, power: [] } }, battlefields: [], candidates: [{ type: "play", id: "play-1", name: "Test Unit",
          object: { id: "card", zoneEntryId: 0 }, energy: 2, power: null, types: ["unit"], destination: null }],
        canEndTurn: false, emptyRunePoolBlocked: false } }] }],
    ]));
    expect(withFailures.commandFailureCategories[0]).toEqual(expect.objectContaining({ name: "Test Unit",
      code: "cannot-pay-cost", count: 1 }));
  });

  it("runs a four-case injected sample and invokes independent replay for every case", async () => {
    const cases = m1StatsCases(4);
    const seen: string[] = [];
    const replayed: string[] = [];
    const summary = await runM1StatsCases(cases, {
      maxTurns: 2, maxCommands: 1,
      runner: input => {
        seen.push(input.testCase.seed);
        input.onJournal({ ...journal(1), seed: input.testCase.seed, decks: input.testCase.decks });
        const index = cases.findIndex(value => value.seed === input.testCase.seed);
        return stats(index === 0 ? {} : index === 1 ? { winner: null, termination: "blocked", blockers: [
          { name: "ProgramBindingError", code: "judge-required", message: "pending" }] } :
          index === 2 ? { winner: null, termination: "exception", exceptions: ["Error: failed"] } :
            { winner: null, termination: "guard", guardReason: "action-limit" });
      },
      replay: value => { replayed.push(value.seed); return true; },
    });
    expect(seen).toEqual(cases.map(value => value.seed));
    expect(replayed).toEqual(cases.map(value => value.seed));
    expect(summary.games).toBe(4);
    expect(summary.outcomes).toEqual({ "natural-win": 1, blocked: 1, exception: 1,
      timeout: 0, "command-limit": 1, "no-progress": 0, "turn-limit": 0, "replay-mismatch": 0 });
    expect(summary.replayChecks).toBe(4);
  });

  it("classifies a worker error as an exception and preserves its stack evidence", async () => {
    const result = await runIsolatedM1Game(m1StatsCases(1)[0]!, {
      wallTimeoutMs: 2_000, maxTurns: 1, maxCommands: 1, journalDirectory: null,
      workerUrl: new URL("data:text/javascript," + encodeURIComponent(
        "import { parentPort } from 'node:worker_threads'; parentPort.postMessage({ ok: false, error: { name: 'TypeError', code: 'boom', message: 'worker exploded', stack: 'worker-stack' } });")),
    });
    expect(result.outcome).toBe("exception");
    expect(result.termination).toBe("exception");
    expect(result.error).toEqual({ name: "TypeError", code: "boom", message: "worker exploded", stack: "worker-stack" });
    expect(result.replayChecked).toBe(false);
  });

  it("terminates a non-returning worker and records a wall-clock timeout", async () => {
    const result = await runIsolatedM1Game(m1StatsCases(1)[0]!, {
      wallTimeoutMs: 20, maxTurns: 1, maxCommands: 1, journalDirectory: null,
      workerUrl: new URL("data:text/javascript," + encodeURIComponent("while (true) {}")),
    });
    expect(result.outcome).toBe("timeout");
    expect(result.termination).toBe("timeout");
    expect(result.turns).toBeNull();
    expect(result.commands).toBeNull();
    expect(result.replayChecked).toBe(false);
  });

  it("classifies a worker completion as timeout when the completion arrives after the deadline", async () => {
    const result = await runIsolatedM1Game(m1StatsCases(1)[0]!, {
      wallTimeoutMs: 10, maxTurns: 1, maxCommands: 1, journalDirectory: null,
      workerUrl: new URL("data:text/javascript," + encodeURIComponent(
        "setTimeout(() => {}, 50);")),
    });
    expect(result.outcome).toBe("timeout");
    expect(result.error?.name).toBe("TimeoutError");
  });
});
