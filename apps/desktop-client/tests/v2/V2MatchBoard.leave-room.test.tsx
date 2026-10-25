import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import type { RoomView } from "@riftbound/protocol";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

function state(
  projection: V2Projection | null,
  connectionStatus: V2ClientState["connectionStatus"] = "connected"
): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: projection?.viewerPlayerId ?? "player-1", now: 0 }),
    projection,
    stateVersion: projection?.stateVersion ?? 0,
    eventSeq: projection?.eventSeq ?? 0,
    connectionStatus,
    choice: createV2ChoiceUiState(projection?.pendingChoice ?? { status: "none" },
      { viewerPlayerId: projection?.viewerPlayerId ?? "player-1", now: 0 })
  };
}

function endedProjection(viewerPlayerId: "player-1" | "player-2"): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-ended",
    viewerPlayerId,
    stateVersion: 12,
    eventSeq: 12,
    phase: "ended",
    turnNumber: 6,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 8, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 0, runeDeckCount: 0, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 5, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 0, runeDeckCount: 0, zoneCounts: {} }
    ],
    zones: [],
    objects: [],
    chain: { status: "closed", phase: "open", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "open" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: [
        { playerId: "player-1", points: 8, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "player-2", points: 5, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
      ]
    },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: "player-1",
    events: []
  };
}

function render(value: V2ClientState, room: RoomView | null = null, onLeaveRoom = () => undefined): string {
  return renderToStaticMarkup(<V2MatchBoard state={value} room={room} onLeaveRoom={onLeaveRoom}
    onCommand={async () => ({ type: "command-receipt", protocolVersion: "2.0.0", commandId: "test",
      stateVersion: 1, eventSeq: 1, accepted: true, duplicate: false, rejection: null })} />);
}

describe("RIFT-1064 V2 leave room", () => {
  it("shows the authenticated viewer's result, winner, score and return button", () => {
    const html = render(state(endedProjection("player-1")));
    expect(html).toContain('aria-label="对局结果"');
    expect(html).toContain("你获胜");
    expect(html).toContain("胜者：Alice");
    expect(html).toContain("比分：Alice 8 : Bob 5");
    expect(html).toContain("返回大厅");
    expect(html).not.toContain("你落败");

    const loserHtml = render(state(endedProjection("player-2")));
    expect(loserHtml).toContain("你落败");
    expect(loserHtml).toContain("胜者：Alice");
    expect(loserHtml).toContain("返回大厅");
  });

  it("offers leaving while the room is still waiting", () => {
    const room: RoomView = {
      roomId: "waiting-room",
      status: "waiting",
      rulesetId: "riftbound-duel",
      version: 1,
      roomVersion: 1,
      roomEventSeq: 0,
      players: [
        { id: "player-1", name: "Alice", connected: true, ready: false, deckSubmitted: false }
      ]
    };
    const html = render(state(null), room);
    expect(html).toContain("房间 waiting-room");
    expect(html).toContain("离开房间");
  });
});
