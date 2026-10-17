import { describe, expect, it } from "vitest";
import {
  HEADLESS_SEEDS,
  M1_DECK_IDS,
  buildM1Deck,
  runHeadlessGame,
  runHeadlessMatrix,
} from "../../src/headless/index.js";

describe("M1 headless dual-bot regression", () => {
  it("runs five fixed seeds for every pair of the four M1 decks", () => {
    const summary = runHeadlessMatrix({ games: 5, decks: M1_DECK_IDS, seeds: HEADLESS_SEEDS.slice(0, 5) });
    expect(summary.games).toBe(30);
    expect(summary.pairings).toHaveLength(6);
    expect(summary.pairings.every(pairing => pairing.games === 5)).toBe(true);
    expect(summary.results).toHaveLength(30);
    expect(summary.exceptions).toBe(0);
    expect(summary.gamesWithReplayMismatch).toBe(0);
    expect(summary.gamesWithPrivacyLeak).toBe(0);
    expect(summary.results.every(result => result.winner !== null)).toBe(true);
    expect(summary.results.every(result => result.judgeRequiredRejections >= 0)).toBe(true);
    expect(summary.actionCoverage.commands.concede).toBe(30);
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
    const first = runHeadlessGame(HEADLESS_SEEDS[0]!, { decks: ["vex-unl", "vi-unl"] });
    const second = runHeadlessGame(HEADLESS_SEEDS[0]!, { decks: ["vex-unl", "vi-unl"] });
    expect(second.winner).toBe(first.winner);
    expect(second.turnNumber).toBe(first.turnNumber);
    expect(second.termination).toBe(first.termination);
    expect(second.eventCount).toBe(first.eventCount);
    expect(second.judgeRequiredCards).toEqual(first.judgeRequiredCards);
    expect(second.actionCoverage).toEqual(first.actionCoverage);
    expect(second.replayMatches).toBe(true);
    expect(second.privacySafe).toBe(true);
  }, 30_000);
});
