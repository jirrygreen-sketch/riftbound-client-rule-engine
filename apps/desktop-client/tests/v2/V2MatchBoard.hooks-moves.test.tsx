import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2MoveOption, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1047: found by a real two-browser M1 smoke run on macOS. When the first
// projection arrived, V2MatchBoard ran two useMemo hooks that sit after its
// `projection === null` early return, React threw "Rendered more hooks than
// during the previous render", and both clients went blank at game start.
// Static markup renders cannot see that transition, so the structure itself is
// asserted, and the move panel is checked against actionOptions.moves.

describe("RIFT-1047 V2 board hook order", () => {
  it("calls no hook after the projection === null early return", () => {
    const source = readFileSync(new URL("../../src/full-product/v2/V2MatchBoard.tsx", import.meta.url), "utf8");
    const start = source.indexOf("export function V2MatchBoard(");
    const early = source.indexOf("if (projection === null) {", start);
    const end = source.indexOf("\nfunction ", early);
    expect(start).toBeGreaterThan(-1);
    expect(early).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(early);
    const afterEarlyReturn = source.slice(early, end);
    expect(afterEarlyReturn.match(/\buse[A-Z]\w*\s*\(/gu) ?? []).toEqual([]);
  });
});

function projection(moves: readonly V2MoveOption[]): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-v2",
    viewerPlayerId: "player-1",
    stateVersion: 3,
    eventSeq: 2,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 2, power: {}, xp: 0, handCount: 0, deckCount: 30, runeDeckCount: 10, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 4, deckCount: 30, runeDeckCount: 12, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      { objectId: "unit-1", zone: "base", ownerPlayerId: "player-1", controllerPlayerId: "player-1", cardId: "unit", name: "Rumble", faceDown: false, visibility: "public", location: { kind: "base", playerId: "player-1" } },
      { objectId: "field-1", zone: "battlefield", ownerPlayerId: "player-1", controllerPlayerId: "player-1", cardId: "bf", name: "Treasure Hoard", faceDown: false, visibility: "public", location: { kind: "battlefield", battlefieldId: "field-1" } }
    ],
    chain: { status: "closed", phase: "open", priorityPlayerId: "player-1", focusPlayerId: null, items: [] },
    priority: { playerId: "player-1", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    actionOptions: { canEndTurn: true, canAdvance: false, moves, plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  };
}

function render(value: V2Projection): string {
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value, stateVersion: value.stateVersion, eventSeq: value.eventSeq, connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "player-1", now: 0, timeoutMs: 10_000 })
  };
  return renderToStaticMarkup(<V2MatchBoard state={state} onCommand={async () => ({
    type: "command-receipt", protocolVersion: "2.0.0", commandId: "x", stateVersion: 3,
    eventSeq: 2, accepted: true, duplicate: false, rejection: null
  })} />);
}

function movePanel(html: string): string {
  const start = html.indexOf('aria-label="移动操作"');
  return html.slice(start, html.indexOf("</section>", start));
}

describe("RIFT-1047 V2 move panel follows actionOptions.moves", () => {
  it("lists only units the server offers a Standard Move for, never a battlefield card", () => {
    const panel = movePanel(render(projection([{ objectId: "unit-1", destination: { kind: "battlefield", battlefieldId: "field-1" } }])));
    expect(panel).toContain(">Rumble</button>");
    expect(panel).not.toContain("Treasure Hoard</button>");
    expect(panel).not.toContain("当前没有可移动的单位");
  });

  it("says there is nothing to move when the server publishes no moves", () => {
    const panel = movePanel(render(projection([])));
    expect(panel).toContain("当前没有可移动的单位");
    expect(panel).not.toContain(">Rumble</button>");
  });
});
