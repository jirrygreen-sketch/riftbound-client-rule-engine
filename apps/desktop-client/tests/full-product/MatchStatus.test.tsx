import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { buildMatchStatus, MatchStatusBar } from "../../src/full-product/MatchStatusBar";
import type { PlayableMatchView } from "../../src/full-product/types";
import type { GameProjection } from "@riftbound/protocol";

describe("MatchStatusBar", () => {
  it("shows phase, priority, active player, result, and interaction mode", () => {
    const html = renderToStaticMarkup(<MatchStatusBar view={makeView({})} />);
    expect(html).toContain("main");
    expect(html).toContain("Alice");
    expect(html).toContain("对局进行中");
    expect(html).toContain("可交互");
  });

  it("switches to read-only status for ended matches or disconnected clients", () => {
    expect(buildMatchStatus(makeView({ phase: "ended" })).read_only).toBe(true);
    expect(buildMatchStatus(makeView({ status: "disconnected" })).read_only).toBe(true);
  });
});

function makeView({
  phase = "main",
  status = "connected"
}: {
  phase?: GameProjection["phase"];
  status?: PlayableMatchView["connectionStatus"];
}): PlayableMatchView {
  return {
    connectionStatus: status,
    commandPending: false,
    viewerPlayerId: "player-1",
    resolveCardTitle: cardId => cardId,
    resolveCardImage: () => null,
    projection: {
      version: 1,
      eventSeq: 0,
      phase,
      turnNumber: 3,
      activePlayerId: "player-1",
      priority: { playerId: "player-1" },
      winnerPlayerId: null,
      prompt: null,
      waitingForPlayerId: null,
      players: [
        { id: "player-1", name: "Alice", handCount: 0, hand: [] },
        { id: "player-2", name: "Bob", handCount: 0, hand: [] }
      ],
      events: []
    }
  };
}
