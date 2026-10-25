import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

function setupProjection(ownerPlayerId: string | null): V2Projection {
  const cards = [0, 1, 2, 3].map(index => ({
    objectId: `opening-${index}`,
    zoneEntryId: 1,
    zone: "hand" as const,
    ownerPlayerId: "player-1",
    cardId: `card-${index}`,
    name: `Opening ${index}`,
    faceDown: false,
    visibility: "owner-only" as const,
  }));
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "mulligan-match",
    viewerPlayerId: "player-1",
    stateVersion: 0,
    eventSeq: 0,
    phase: "setup",
    turnNumber: 1,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 0, power: {}, xp: 0,
        handCount: 4, deckCount: 35, runeDeckCount: 12, zoneCounts: { hand: 4 } },
      { playerId: "player-2", name: "Bob", score: 0, energy: 0, power: {}, xp: 0,
        handCount: 4, deckCount: 35, runeDeckCount: 12, zoneCounts: { hand: 4 } },
    ],
    zones: [
      { zone: "hand", ownerPlayerId: "player-1", count: 4, objects: cards },
      { zone: "hand", ownerPlayerId: "player-2", count: 4 },
    ],
    objects: cards,
    chain: { status: "closed", phase: "open", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "choice" },
    scoring: { victoryScore: 8, battlefieldLocationIds: [], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
    ] },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
    pendingChoice: ownerPlayerId === null ? { status: "none" } : {
      status: "pending",
      choiceId: "mulligan:player-1",
      ownerPlayerId,
      stateVersion: 0,
      kind: "select-objects",
      ...(ownerPlayerId === "player-1" ? { options: cards.map(card => ({
        id: card.objectId,
        label: card.name,
        value: card.objectId,
        objectRef: { objectId: card.objectId, zoneEntryId: card.zoneEntryId },
      })) } : {}),
      min: 0,
      max: 2,
    },
    winnerPlayerId: null,
    events: [],
  };
}

function state(projection: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0, choiceTimeoutMs: 60_000 }),
    projection,
    choice: createV2ChoiceUiState(projection.pendingChoice, {
      viewerPlayerId: "player-1", now: 0, timeoutMs: 60_000,
    }),
  };
}

describe("V2 mulligan board", () => {
  it("exposes keep-all only in the viewer's projected mulligan window", () => {
    const markup = renderToStaticMarkup(<V2MatchBoard state={state(setupProjection("player-1"))}
      onCommand={vi.fn()} />);
    expect(markup).toContain("保留起手");
    expect(markup).toContain("选择至多 2 张换掉");
    expect(markup).not.toContain("确认起手");
    expect(markup).toMatch(/<button[^>]*>保留起手<\/button>/u);
  });

  it("disables the action while the opponent owns the turn-order mulligan window", () => {
    const markup = renderToStaticMarkup(<V2MatchBoard state={state(setupProjection("player-2"))}
      onCommand={vi.fn()} />);
    expect(markup).toContain("等待服务端开放你的换牌窗口");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>保留起手<\/button>/u);
  });

  it("does not invent a mulligan action once the setup choice is absent", () => {
    const markup = renderToStaticMarkup(<V2MatchBoard state={state(setupProjection(null))}
      onCommand={vi.fn()} />);
    expect(markup).toContain("等待服务端开放你的换牌窗口");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>保留起手<\/button>/u);
  });
});
