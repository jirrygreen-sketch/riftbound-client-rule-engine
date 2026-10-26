import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { buildV2ChoiceAnswer, V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2PendingChoice, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1078: found in a real two-browser M1 run on macOS (integration
// cf76aa86). Playing Veteran Poro with no equipment asked a select-objects
// choice with min 0, max 0 and no candidates. The board treated the empty
// list as "candidates not projected yet", disabled the submit button and left
// concede as the only action. An empty selection is the legal answer.

function pendingChoice(min: number, max: number): V2PendingChoice {
  return {
    status: "pending", choiceId: "target:weaponmaster-equipment", ownerPlayerId: "player-2", stateVersion: 4,
    kind: "select-objects", min, max, options: [], source: { objectId: "token:69", name: "Veteran Poro" }
  } as V2PendingChoice;
}

function projection(choice: V2PendingChoice): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection", protocolVersion: "2.0.0", rulesetVersion: "core-1.5",
    matchId: "match-v2", viewerPlayerId: "player-2", stateVersion: 4, eventSeq: 9, phase: "main", turnNumber: 2,
    activePlayerId: "player-2",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 0, power: {}, xp: 0, handCount: 5, deckCount: 34, runeDeckCount: 10, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 0, energy: 1, power: {}, xp: 0, handCount: 3, deckCount: 34, runeDeckCount: 9, zoneCounts: {} }
    ],
    zones: [], objects: [],
    chain: { status: "closed", phase: "open", priorityPlayerId: "player-2", focusPlayerId: null, items: [] },
    priority: { playerId: "player-2", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: [], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [], combat: { status: "none" },
    actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
    pendingChoice: choice, winnerPlayerId: null, events: []
  } as V2Projection;
}

function render(choice: V2PendingChoice): string {
  const value = projection(choice);
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "player-2", now: 0 }),
    projection: value, stateVersion: value.stateVersion, eventSeq: value.eventSeq, connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "player-2", now: 0 })
  };
  return renderToStaticMarkup(<V2MatchBoard state={state} onCommand={async () => { throw new Error("not called"); }} />);
}

function submitButton(html: string): string {
  const panel = html.slice(html.indexOf('aria-label="选择请求"'));
  const end = panel.indexOf(">提交选择<");
  return panel.slice(panel.lastIndexOf("<button", end), end);
}

describe("RIFT-1078 empty optional object choice", () => {
  it("lets the player submit an empty selection when nothing can be chosen", () => {
    const html = render(pendingChoice(0, 0));
    expect(html).toContain("没有可选对象，直接提交即可继续。");
    expect(html).not.toContain("等待服务端投影选择候选");
    expect(submitButton(html)).not.toContain("disabled");
    expect(buildV2ChoiceAnswer(pendingChoice(0, 0), [], "")).toEqual([]);
  });

  it("still waits for candidates when at least one object must be chosen", () => {
    const html = render(pendingChoice(1, 1));
    expect(html).toContain("等待服务端投影选择候选");
    expect(submitButton(html)).toContain("disabled");
    expect(buildV2ChoiceAnswer(pendingChoice(1, 1), [], "")).toBeNull();
  });
});
