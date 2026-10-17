import { describe, expect, it } from "vitest";
import { HEADLESS_SEEDS, runHeadlessGames, runHeadlessGame } from "../../src/headless/index.js";

describe("M1 headless dual-bot regression", () => {
  it("runs the fixed 20 seeds with deterministic terminal and privacy checks", () => {
    const summary = runHeadlessGames(HEADLESS_SEEDS.length, HEADLESS_SEEDS);
    expect(summary.games).toBe(20);
    expect(summary.results).toHaveLength(20);
    expect(summary.exceptions).toBe(0);
    expect(summary.gamesWithReplayMismatch).toBe(0);
    expect(summary.gamesWithPrivacyLeak).toBe(0);
    expect(summary.results.every(result => result.winner !== null)).toBe(true);
    expect(summary.results.every(result => result.judgeRequiredRejections >= 0)).toBe(true);
  }, 600_000);

  it("keeps one seed deterministic across repeated runs", () => {
    const first = runHeadlessGame(HEADLESS_SEEDS[0]!);
    const second = runHeadlessGame(HEADLESS_SEEDS[0]!);
    expect(second.winner).toBe(first.winner);
    expect(second.turnNumber).toBe(first.turnNumber);
    expect(second.termination).toBe(first.termination);
    expect(second.eventCount).toBe(first.eventCount);
    expect(second.judgeRequiredCards).toEqual(first.judgeRequiredCards);
    expect(second.replayMatches).toBe(true);
    expect(second.privacySafe).toBe(true);
  }, 30_000);
});
