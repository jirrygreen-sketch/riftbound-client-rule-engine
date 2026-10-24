import { describe, expect, it } from "vitest";
import {
  DEFAULT_TURN_LIMIT,
  HEADLESS_SEEDS,
  replayHeadlessJournal,
  type HeadlessJournal,
  type HeadlessStats,
  M1_DECK_IDS,
  buildM1Deck,
  runHeadlessGame,
} from "../../src/headless/index.js";
import {
  aggregateHeadlessMatrixGames,
  aggregateHeadlessPairingGames,
  headlessMatrixGameCases,
  headlessTerminationClass,
} from "../../src/headless/duel.js";

function expectBlockedEvidence(result: HeadlessStats): void {
  expect(result.termination).toBe("blocked");
  expect(result.winner).toBeNull();
  expect(result.guardReason).toBeNull();
  expect(result.blockers.length).toBeGreaterThan(0);
  expect(Object.values(result.actionCoverage.commands).every(count => count === 0)).toBe(true);
  expect(result.replayMatches).toBe(true);
  expect(result.privacySafe).toBe(true);
  expect(result.exceptions).toEqual([]);
}

describe("M1 headless dual-bot regression", () => {
  // Six real pairings remain covered: Rumble/Fiora reaches a multi-turn combat
  // finish, while the other five register active judge-required setup sources.
  // On the 2026-10-24 gate host RIFT-857 seed 001 took 500s and ended with a
  // winning A at 13 turns, a passing strict replay and all six refusals intact;
  // one seed per pairing preserves the matrix under the measured worst case.
  const replayableSeed = "RIFT-857-m1-seed-001";
  const matrixCases = headlessMatrixGameCases(M1_DECK_IDS, [replayableSeed]);
  const matrixResults: HeadlessStats[] = [];
  const matrixJournals = new Map<string, HeadlessJournal>();

  it("classifies committed natural wins separately from unfinished guards", () => {
    const noCommands = { play: 0, idle: 0, pass: 0, advance: 0, move: 0, "rune-energy": 0,
      "combat-damage": 0, concede: 0 };
    const natural: HeadlessStats = {
      seed: "classification-natural", decks: { A: "rumble-sfd", B: "fiora-sfd" }, winner: "A", turnNumber: 12,
      termination: "winner", guardReason: null, blockers: [], scores: { A: 8, B: 3 }, victoryScore: 8,
      battleStats: { showdowns: 1, combats: 1, attacks: 1, defenses: 1, conquers: 1, scores: 1, points: 8 },
      privacyChecks: 6, exceptions: [], judgeRequiredRejections: 0, judgeRequiredCards: [],
      judgeRequiredCardCounts: [], judgeRequiredTop: [],
      actionCoverage: { commands: noCommands,
        choices: { optional: 0, mode: 0, number: 0, "select-objects": 0, order: 0 } },
      observedActions: { commands: noCommands, choices: { optional: 0, mode: 0, number: 0, "select-objects": 0, order: 0 },
        committedPlays: 0, rejectedPlays: 0 },
      eventCount: 10, journalDigest: "a".repeat(64), projectionDigests: { A: "b".repeat(64), B: "c".repeat(64) },
      replayMatches: true, privacySafe: true,
    };
    const guard = runHeadlessGame(HEADLESS_SEEDS[0]!, { decks: ["vi-unl", "rumble-sfd"], maxActions: 1 });
    const blocked: HeadlessStats = { ...natural, termination: "blocked", winner: null,
      blockers: [{ name: "ProgramBindingError", code: "judge-required", message: "unsupported" }] };
    const exception: HeadlessStats = { ...natural, termination: "exception", winner: null, exceptions: ["Error: failed"] };
    const concession: HeadlessStats = { ...natural, termination: "concede", scores: { A: 7, B: 3 },
      actionCoverage: { ...natural.actionCoverage, commands: { ...noCommands, concede: 1 } } };
    expect(headlessTerminationClass(natural)).toBe("natural");
    expect(headlessTerminationClass(guard)).toBe("nonNatural");
    expect(headlessTerminationClass(blocked)).toBe("nonNatural");
    expect(headlessTerminationClass(exception)).toBe("nonNatural");
    expect(headlessTerminationClass(concession)).toBe("nonNatural");
    expect(headlessTerminationClass({ ...guard, termination: "winner" })).toBe("invalid");
    expect(["guard", "blocked"]).toContain(guard.termination);
    if (guard.termination === "blocked") expectBlockedEvidence(guard);
    else expect(guard.guardReason).not.toBeNull();
    expect(headlessTerminationClass({ ...guard, winner: "A" })).toBe("invalid");
    expect(headlessTerminationClass({ ...natural, replayMatches: false })).toBe("invalid");
    expect(headlessTerminationClass({ ...natural, privacySafe: false })).toBe("invalid");
    expect(headlessTerminationClass({ ...blocked, blockers: [] })).toBe("invalid");
    expect(headlessTerminationClass({ ...exception, exceptions: [] })).toBe("invalid");
    expect(headlessTerminationClass(concession)).toBe("nonNatural");
  }, 60_000);

  it("keeps the fixed matrix shape without one blocking task", () => {
    expect(matrixCases).toHaveLength(6);
    expect(new Set(matrixCases.map(({ A, B }) => `${A}:${B}`)).size).toBe(6);
    for (const key of new Set(matrixCases.map(({ A, B }) => `${A}:${B}`))) {
      expect(matrixCases.filter(({ A, B }) => `${A}:${B}` === key)).toHaveLength(1);
    }
  });
  it.each(matrixCases)("runs $A versus $B for $seed", game => {
    let journal: HeadlessJournal | undefined;
    const result = runHeadlessGame(game.seed, { deckPair: { A: game.A, B: game.B },
      onJournal: value => { journal = value; } });
    if (journal === undefined) throw new Error("Headless journal callback was not invoked");
    matrixJournals.set(`${game.A}:${game.B}`, journal);
    matrixResults.push(result);
    expect(result.victoryScore).toBe(8);
    expect(result.termination).not.toBe("concede");
    if (result.termination === "blocked") expectBlockedEvidence(result);
    else expect(result.privacyChecks).toBeGreaterThanOrEqual(6);
    expect(["natural", "nonNatural", "invalid"]).toContain(headlessTerminationClass(result));
    if (result.termination === "winner") {
      expect(headlessTerminationClass(result)).toBe("natural");
      expect(result.winner).not.toBeNull();
      expect(result.scores[result.winner!]).toBeGreaterThanOrEqual(8);
      expect(result.battleStats.scores).toBeGreaterThan(0);
    } else {
      expect(headlessTerminationClass(result)).toBe("nonNatural");
      expect(result.winner).toBeNull();
      if (result.termination === "blocked") expect(result.blockers.length).toBeGreaterThan(0);
      if (result.termination === "guard") expect(result.guardReason).not.toBeNull();
    }
    expect(result.judgeRequiredRejections).toBeGreaterThanOrEqual(0);
    expect(result.actionCoverage.commands.concede).toBe(0);
    expect(result.journalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.replayMatches).toBe(true);
    expect(result.privacySafe).toBe(true);
    expect(result.exceptions).toEqual([]);
  }, 900_000);

  it("preserves the matrix aggregate from the same six games", () => {
    expect(matrixResults).toHaveLength(6);
    const summary = aggregateHeadlessMatrixGames(matrixCases, matrixResults);
    expect(summary.games).toBe(6);
    expect(summary.results).toHaveLength(6);
    expect(summary.pairings).toHaveLength(6);
    expect(summary.pairings.every(pairing => pairing.games === 1)).toBe(true);
    expect(summary.exceptions).toBe(0);
    expect(summary.gamesWithReplayMismatch).toBe(0);
    expect(summary.gamesWithPrivacyLeak).toBe(0);
    expect(summary.results.every(result => result.victoryScore === 8)).toBe(true);
    expect(summary.results.every(result => result.termination !== "concede")).toBe(true);
    expect(summary.winners).toBe(summary.terminationReasons.winner);
    expect(summary.winnerRatio).toBe(summary.winners / summary.games);
    expect(summary.completed + summary.blocked + summary.terminationReasons.guard).toBe(6);
    expect(summary.actionCoverage.commands.concede).toBe(0);
    expect(summary.judgeRequiredCardCounts.length).toBeGreaterThan(0);
  }, 60_000);

  it("preserves every pairing summary from the same games", () => {
    expect(matrixResults).toHaveLength(6);
    for (const pair of [
      { A: "rumble-sfd", B: "fiora-sfd" },
      { A: "rumble-sfd", B: "vex-unl" },
      { A: "rumble-sfd", B: "vi-unl" },
      { A: "fiora-sfd", B: "vex-unl" },
      { A: "fiora-sfd", B: "vi-unl" },
      { A: "vex-unl", B: "vi-unl" },
    ] as const) {
      const indexes = matrixCases.flatMap((game, index) => game.A === pair.A && game.B === pair.B ? [index] : []);
      expect(indexes).toHaveLength(1);
      const summary = aggregateHeadlessPairingGames(pair, indexes.map(index => matrixResults[index]!));
      expect(summary.games).toBe(1);
      expect(summary.results).toHaveLength(1);
      expect(summary.exceptions).toBe(0);
      expect(summary.gamesWithReplayMismatch).toBe(0);
      expect(summary.gamesWithPrivacyLeak).toBe(0);
      expect(summary.winners).toBe(summary.terminationReasons.winner);
      expect(summary.winnerRatio).toBe(summary.winners / summary.games);
      for (const result of summary.results) {
        if (result.termination === "blocked") expectBlockedEvidence(result);
        else expect(result.privacyChecks).toBeGreaterThanOrEqual(6);
        expect(["natural", "nonNatural", "invalid"]).toContain(headlessTerminationClass(result));
      }
      expect(summary.results.every(result => result.judgeRequiredRejections >= 0)).toBe(true);
      expect(summary.actionCoverage.commands.concede).toBe(0);
      expect(summary.judgeRequiredCardCounts.length).toBeGreaterThanOrEqual(0);
      expect(summary.results.every(result => /^[0-9a-f]{64}$/.test(result.journalDigest))).toBe(true);
    }
  }, 60_000);

  it("reports real Unit and Rune instructions without an active setup blocker", () => {
    const result = matrixResults[0]!;
    const journal = matrixJournals.get("rumble-sfd:fiora-sfd")!;
    if (result.termination === "blocked") {
      expectBlockedEvidence(result);
      expect(journal.commands).toEqual([]);
      expect(journal.setupBlockers).toEqual(result.blockers);
      return;
    }
    expect(result.blockers).toEqual([]);
    expect(journal.setupBlockers).toBeUndefined();
    expect(journal.commands.some(entry => entry.trace?.phase === "main" &&
      entry.trace.canActNormal && entry.trace.basicRunes.some(rune => !rune.exhausted))).toBe(true);
    expect(journal.commands.some(entry => entry.command.type === "rune-energy" && entry.failure === null)).toBe(true);
    expect(journal.commands.some(entry => entry.trace?.boardUnits.length)).toBe(true);
    expect(result.replayMatches).toBe(true);
    expect(result.privacySafe).toBe(true);
    expect(result.actionCoverage.commands.concede).toBe(0);
    expect(result.observedActions.committedPlays).toBeGreaterThan(0);
    expect(result.termination).toBe("winner");
    expect(result.winner).not.toBeNull();
    expect(result.blockers).toEqual([]);
    expect(headlessTerminationClass(result)).toBe("natural");
  }, 60_000);

  it("requires each scripted Unit feature without an active setup blocker", () => {
    const result = matrixResults[0]!;
    const journal = matrixJournals.get("rumble-sfd:fiora-sfd")!;
    if (result.termination === "blocked") {
      expectBlockedEvidence(result);
      expect(journal.commands).toEqual([]);
      expect(journal.setupBlockers).toEqual(result.blockers);
      return;
    }
    const move = journal.commands.find(entry => (entry.trace?.candidateCounts.move ?? 0) > 0);
    expect(move).toBeDefined();
    expect(move!.trace!.turnState).toBe("neutral-open");
    expect(move!.trace!.canActNormal).toBe(true);
    expect(move!.trace!.canEndTurn).toBe(true);
    expect(move!.trace!.boardUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({ canMove: true, location: expect.objectContaining({ type: "base" }) }),
    ]));
    expect(result.termination).toBe("winner");
    expect(result.winner).not.toBeNull();
    expect(result.blockers).toEqual([]);
    expect(headlessTerminationClass(result)).toBe("natural");
    expect(result.actionCoverage.commands.concede).toBe(0);
  }, 60_000);

  it("holds the reverse seat pair to real Unit, move and Rune coverage", () => {
    let journal: HeadlessJournal | undefined;
    const result = runHeadlessGame(replayableSeed, {
      decks: ["fiora-sfd", "rumble-sfd"], maxActions: 80,
      onJournal: value => { journal = value; },
    });
    if (result.termination === "blocked") {
      expectBlockedEvidence(result);
      expect(journal!.commands).toEqual([]);
      expect(journal!.setupBlockers).toEqual(result.blockers);
      return;
    }
    expect(journal!.commands.some(entry => entry.command.type === "rune-energy" && entry.failure === null)).toBe(true);
    expect(journal!.commands.some(entry => entry.trace?.boardUnits.length)).toBe(true);
    expect(journal!.commands.some(entry => (entry.trace?.candidateCounts.move ?? 0) > 0)).toBe(true);
    expect(result.observedActions.committedPlays).toBeGreaterThan(0);
    expect(result.exceptions).toEqual([]);
    expect(result.actionCoverage.commands.concede).toBe(0);
    expect(result.replayMatches).toBe(true);
    expect(result.privacySafe).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.termination).toBe("guard");
    expect(result.guardReason).toBe("action-limit");
  }, 900_000);

  it("builds the four JSON-backed M1 deck shapes without changing printed null costs", () => {
    for (const [index, id] of M1_DECK_IDS.entries()) {
      const deck = buildM1Deck(id, index % 2 === 0 ? "A" : "B");
      expect(deck.mainDeck).toHaveLength(39);
      expect(deck.runeDeck).toHaveLength(12);
      expect(deck.battlefields).toHaveLength(3);
      expect(deck.championLegend.cardId).toMatch(/^card\.hash-/);
      expect((deck.mainDeck as readonly { readonly energy: number | null; readonly power: number | null }[])
        .some(card => card.energy === null || card.power === null)).toBe(true);
    }
  });

  it("keeps the official blocker pair deterministic across repeated runs", () => {
    const pair = { A: "vex-unl", B: "vi-unl" } as const;
    const first = runHeadlessGame(replayableSeed, { deckPair: pair });
    const second = runHeadlessGame(replayableSeed, { deckPair: pair });
    expect(second.winner).toBe(first.winner);
    expect(second.turnNumber).toBe(first.turnNumber);
    expect(second.termination).toBe(first.termination);
    expect(second.eventCount).toBe(first.eventCount);
    expect(second.journalDigest).toBe(first.journalDigest);
    expect(second.projectionDigests).toEqual(first.projectionDigests);
    expect(first.replayMatches).toBe(true);
    expect(first.privacySafe).toBe(true);
    expect(second.judgeRequiredCards).toEqual(first.judgeRequiredCards);
    expect(second.actionCoverage).toEqual(first.actionCoverage);
    expect(second.replayMatches).toBe(true);
    expect(second.privacySafe).toBe(true);
  }, 120_000);

  it("keeps blocked runs unfinished instead of awarding a concession win", () => {
    const result = runHeadlessGame(replayableSeed, { decks: ["vex-unl", "vi-unl"] });
    expect(result.actionCoverage.commands.concede).toBe(0);
    expect(result.victoryScore).toBe(8);
    expect(result.replayMatches).toBe(true);
    expect(result.exceptions).toEqual([]);
    expect(result.termination).toBe("blocked");
    expect(result.guardReason).toBeNull();
    expect(result.winner).toBeNull();
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers.every(blocker => blocker.code === "judge-required")).toBe(true);
    expect(headlessTerminationClass(result)).toBe("nonNatural");
  }, 60_000);

  it("answers target choices only when setup leaves a live match", () => {
    const result = matrixResults[0]!;
    if (result.termination === "blocked") {
      expectBlockedEvidence(result);
      return;
    }
    expect(result.actionCoverage.choices["select-objects"]).toBeGreaterThan(0);
    expect(result.exceptions).toEqual([]);
    expect(result.replayMatches).toBe(true);
    expect(result.privacySafe).toBe(true);
    expect(result.actionCoverage.commands.concede).toBe(0);
  }, 60_000);

  it("preserves unsupported source-trigger diagnostics without advancing or fabricating a winner", () => {
    const result = runHeadlessGame(replayableSeed, { decks: ["fiora-sfd", "vex-unl"], maxActions: 1 });
    expect(result.replayMatches).toBe(true);
    expect(result.exceptions).toEqual([]);
    expect(result.actionCoverage.commands.concede).toBe(0);
    expect(headlessTerminationClass(result)).toBe(result.termination === "winner" ? "natural" : "nonNatural");
    if (result.termination === "blocked") {
      expect(result.winner).toBeNull();
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.blockers.every(blocker => blocker.code && blocker.message)).toBe(true);
    } else if (result.termination === "guard") {
      expect(result.winner).toBeNull();
      expect(result.guardReason).not.toBeNull();
      expect(result.blockers).toEqual([]);
    } else {
      expect(result.termination).toBe("winner");
      expect(result.winner).not.toBeNull();
      expect(result.scores[result.winner!]).toBeGreaterThanOrEqual(8);
      expect(result.guardReason).toBeNull();
      expect(result.blockers).toEqual([]);
    }
  }, 120_000);

  it("rejects altered journal commands, events and state even when scores and winner still match", () => {
    const journal = matrixJournals.get("rumble-sfd:fiora-sfd")!;
    const result = matrixResults[0]!;
    expect(result.replayMatches).toBe(true);
    expect(replayHeadlessJournal(journal)).toBe(true);
    const wrongCommand = structuredClone(journal);
    const first = wrongCommand.commands[0]!;
    const changedCommand = first.command.type === "play" || first.command.type === "move"
      ? { ...first.command, object: { ...first.command.object, zoneEntryId: -1 } }
      : { type: "pass" as const, player: "unknown-player" };
    expect(replayHeadlessJournal({ ...journal, commands: [{ ...first, command: changedCommand }, ...journal.commands.slice(1)] })).toBe(false);
    expect(replayHeadlessJournal({ ...journal, events: journal.events.slice(1) })).toBe(false);
    expect(replayHeadlessJournal({ ...journal, final: { ...journal.final, stateDigest: "altered" } })).toBe(false);
    expect(replayHeadlessJournal({ ...journal, commands: journal.commands.map(entry => ({ ...entry,
      failure: entry.failure ? { ...entry.failure, message: "altered" } : { name: "Error", code: "fake", message: "fake" } })) })).toBe(false);
  }, 300_000);

  it("keeps legacy journals without an integrity field strictly replayable", () => {
    let journal: HeadlessJournal | undefined;
    const result = runHeadlessGame(HEADLESS_SEEDS[0]!, { maxActions: 1, onJournal: value => { journal = value; } });
    expect(journal).toBeDefined();
    if (result.termination === "blocked") {
      expectBlockedEvidence(result);
      expect(replayHeadlessJournal(journal!)).toBe(true);
      return;
    }
    const { integrity: _integrity, ...legacy } = journal!;
    expect(replayHeadlessJournal(legacy)).toBe(true);
    expect(replayHeadlessJournal({ ...legacy, events: legacy.events.slice(1) })).toBe(false);
  }, 60_000);

  it("aggregates actual winners, turns and committed battle events", () => {
    expect(matrixResults).toHaveLength(6);
    const aggregate = aggregateHeadlessMatrixGames(matrixCases, matrixResults);
    const totalTurns = aggregate.totalTurns;
    const winners = aggregate.results.filter(result => result.termination === "winner");
    expect(totalTurns).toBeGreaterThan(0);
    expect(winners.length).toBeGreaterThan(0);
    const winnerIds = new Set(winners.flatMap(result => result.winner === null ? [] : [result.winner]));
    expect([...winnerIds].every(id => id === "A" || id === "B")).toBe(true);
    for (const key of Object.keys(aggregate.battleStats) as (keyof typeof aggregate.battleStats)[]) {
      expect(aggregate.battleStats[key]).toBe(aggregate.results.reduce((sum, result) => sum + result.battleStats[key], 0));
    }
    expect(aggregate.battleStats.points).toBeGreaterThan(0);
    expect(aggregate.results.reduce((sum, result) => sum + result.eventCount, 0)).toBeGreaterThan(0);
    expect(Object.values(aggregate.blockerReasons).reduce((sum, count) => sum + count, 0))
      .toBe(aggregate.results.reduce((sum, result) => sum + result.blockers.length, 0));
  }, 60_000);

  it.each([
    [{ maxTurns: 1 }, "turn-limit"],
    [{ maxActions: 1 }, "action-limit"],
  ] as const)("leaves the match unfinished at guard %j", (limits, reason) => {
    const result = runHeadlessGame(HEADLESS_SEEDS[0]!, { decks: ["vi-unl", "rumble-sfd"], ...limits });
    if (result.termination === "blocked") {
      expectBlockedEvidence(result);
      return;
    }
    expect(result.termination).toBe("guard");
    expect(result.guardReason).toBe(reason);
    expect(result.winner).toBeNull();
    expect(result.actionCoverage.commands.concede).toBe(0);
    expect(result.actionCoverage.commands.idle).toBe(1);
    expect(result.turnNumber).toBe(2);
    expect(result.replayMatches).toBe(true);
    expect(result.privacySafe).toBe(true);
  }, 60_000);

  it("uses a forty-turn default and rejects invalid guards", () => {
    expect(DEFAULT_TURN_LIMIT).toBe(40);
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => runHeadlessGame("invalid", { maxTurns: invalid })).toThrow(RangeError);
      expect(() => runHeadlessGame("invalid", { maxActions: invalid })).toThrow(RangeError);
    }
  });

  // This gate cannot be implemented by fixtures or hand-written settlement.
  // See src/headless/README.md for the engine contracts required to enable it.
  it.todo("wins several fixed-seed official games after the public Standard Move and Rune Pool commands land");
});
