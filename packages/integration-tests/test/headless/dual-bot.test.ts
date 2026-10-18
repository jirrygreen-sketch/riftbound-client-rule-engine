import { describe, expect, it } from "vitest";
import {
  DEFAULT_TURN_LIMIT,
  HEADLESS_SEEDS,
  replayHeadlessJournal,
  runHeadlessGames,
  type HeadlessJournal,
  M1_DECK_IDS,
  buildM1Deck,
  runHeadlessGame,
  runHeadlessMatrix,
  runHeadlessRegression,
} from "../../src/headless/index.js";

describe("M1 headless dual-bot regression", () => {
  const run = runHeadlessRegression();

  it("runs five fixed seeds for every pair of the four M1 decks", () => {
    const summary = run.matrix;
    expect(summary.games).toBe(30);
    expect(summary.pairings).toHaveLength(6);
    expect(summary.pairings.every(pairing => pairing.games === 5)).toBe(true);
    expect(summary.results).toHaveLength(30);
    expect(summary.exceptions, JSON.stringify(summary.results.filter(result => result.exceptions.length))).toBe(0);
    expect(summary.gamesWithReplayMismatch).toBe(0);
    expect(summary.gamesWithPrivacyLeak).toBe(0);
    expect(summary.results.every(result => result.victoryScore === 8)).toBe(true);
    expect(summary.results.every(result => result.termination !== "concede")).toBe(true);
    expect(summary.winners).toBe(summary.terminationReasons.winner);
    expect(summary.winnerRatio).toBe(summary.winners / summary.games);
    expect(summary.completed + summary.blocked + summary.terminationReasons.guard).toBe(30);
    for (const result of summary.results) {
      expect(result.privacyChecks).toBeGreaterThanOrEqual(6);
      if (result.termination === "winner") {
        expect(result.winner).not.toBeNull();
        expect(result.scores[result.winner!]).toBeGreaterThanOrEqual(8);
        expect(result.battleStats.scores).toBeGreaterThan(0);
      } else {
        expect(result.winner).toBeNull();
        if (result.termination === "blocked") expect(result.blockers.length).toBeGreaterThan(0);
        if (result.termination === "guard") expect(result.guardReason).not.toBeNull();
      }
    }
    expect(summary.results.every(result => result.judgeRequiredRejections >= 0)).toBe(true);
    expect(summary.actionCoverage.commands.concede).toBe(0);
    expect(summary.judgeRequiredCardCounts.length).toBeGreaterThan(0);
  }, 600_000);

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

  it("keeps one seed deterministic across repeated runs", () => {
    const [first, second] = run.determinism;
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
  }, 30_000);

  it("keeps blocked runs unfinished instead of awarding a concession win", () => {
    const result = run.blocked;
    expect(result.actionCoverage.commands.concede).toBe(0);
    expect(result.victoryScore).toBe(8);
    expect(result.replayMatches).toBe(true);
    expect(result.exceptions).toEqual([]);
    if (result.blockers.length) {
      expect(result.termination).toBe("blocked");
      expect(result.winner).toBeNull();
      expect(result.blockers.every(blocker => blocker.code && blocker.message)).toBe(true);
    } else {
      expect(result.termination).toBe("winner");
      expect(result.scores[result.winner!]).toBeGreaterThanOrEqual(8);
    }
  });

  it("answers target choices through the ResolveContext instead of throwing AwaitChoice", () => {
    const result = run.targets;
    expect(result.actionCoverage.choices["select-objects"]).toBeGreaterThan(0);
    expect(result.exceptions).toEqual([]);
    expect(result.replayMatches).toBe(true);
    expect(result.privacySafe).toBe(true);
    expect(result.actionCoverage.commands.concede).toBe(0);
  }, 30_000);

  it("preserves unsupported source-trigger diagnostics without advancing or fabricating a winner", () => {
    const result = run.sourceTrigger;
    expect(result.replayMatches).toBe(true);
    expect(result.exceptions).toEqual([]);
    expect(result.actionCoverage.commands.concede).toBe(0);
    if (result.termination === "blocked") {
      expect(result.winner).toBeNull();
      expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({
        name: "ProgramBindingError", code: "judge-required", message: "Unsupported filter field battlefieldWas",
      })]));
    } else {
      expect(result.termination).toBe("winner");
      expect(result.scores[result.winner!]).toBeGreaterThanOrEqual(8);
    }
  }, 30_000);

  it("rejects altered journal commands, events and state even when scores and winner still match", () => {
    const journal: HeadlessJournal = run.tamper.journal;
    const result = run.tamper.result;
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
  }, 30_000);

  it("aggregates actual winners, turns and committed battle events", () => {
    const summary = run.aggregate;
    expect(summary.averageTurns).toBe(summary.totalTurns / 2);
    expect(summary.winners).toBe(summary.results.filter(result => result.termination === "winner").length);
    expect(summary.winsByPlayer.A! + summary.winsByPlayer.B!).toBe(summary.winners);
    expect(Object.values(summary.terminationReasons).reduce((sum, count) => sum + count, 0)).toBe(2);
    for (const key of Object.keys(summary.battleStats) as (keyof typeof summary.battleStats)[]) {
      expect(summary.battleStats[key]).toBe(summary.results.reduce((sum, result) => sum + result.battleStats[key], 0));
    }
    expect(Object.values(summary.blockerReasons).reduce((sum, count) => sum + count, 0))
      .toBe(summary.results.reduce((sum, result) => sum + result.blockers.length, 0));
  }, 30_000);

  it.each([
    [{ maxTurns: 1 }, "turn-limit"],
    [{ maxActions: 1 }, "action-limit"],
  ] as const)("leaves the match unfinished at guard %j", (limits, reason) => {
    const result = runHeadlessGame(HEADLESS_SEEDS[0]!, { decks: ["vi-unl", "rumble-sfd"], ...limits });
    expect(result.termination).toBe("guard");
    expect(result.guardReason).toBe(reason);
    expect(result.winner).toBeNull();
    expect(result.actionCoverage.commands.concede).toBe(0);
    expect(result.actionCoverage.commands.idle).toBe(1);
    expect(result.turnNumber).toBe(2);
    expect(result.replayMatches).toBe(true);
    expect(result.privacySafe).toBe(true);
  });

  it("uses a forty-turn default and rejects invalid guards", () => {
    expect(DEFAULT_TURN_LIMIT).toBe(40);
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => runHeadlessGame("invalid", { maxTurns: invalid })).toThrow(RangeError);
      expect(() => runHeadlessGame("invalid", { maxActions: invalid })).toThrow(RangeError);
    }
  });

  // This gate cannot be implemented by fixtures or hand-written settlement.
  // See src/headless/README.md for the engine contracts required to enable it.
  it.todo("wins several fixed-seed official games by eight-point scoring through real movement and combat");
});
