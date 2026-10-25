import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2PlayOption, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1055: found in a real two-browser M1 run on macOS. The server keeps
// every permanent in the "board" zone and says where it is in `location`; the
// board listed units and gear in a base under "战场", play destinations showed
// the battlefield's object id, and both seats were named "玩家".

function projection(plays: readonly V2PlayOption[] = []): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-v2",
    viewerPlayerId: "player-1",
    stateVersion: 3,
    eventSeq: 2,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 2, power: {}, xp: 0, handCount: 1, deckCount: 30, runeDeckCount: 10, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 4, deckCount: 30, runeDeckCount: 12, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      { objectId: "hand-1", zone: "hand", ownerPlayerId: "player-1", cardId: "unit", name: "Flame Chompers", faceDown: false, visibility: "owner-only" },
      { objectId: "unit-base", zone: "board", ownerPlayerId: "player-1", cardId: "u1", name: "Rumble", faceDown: false, visibility: "owner-only", location: { kind: "base", playerId: "player-1" } },
      { objectId: "gear-base", zone: "board", ownerPlayerId: "player-2", cardId: "g1", name: "Gold", faceDown: false, visibility: "public", location: { kind: "base", playerId: "player-2" } },
      { objectId: "unit-field", zone: "board", ownerPlayerId: "player-2", cardId: "u2", name: "Fiora", faceDown: false, visibility: "public", location: { kind: "battlefield", battlefieldId: "field-1" } },
      { objectId: "field-1", zone: "board", ownerPlayerId: "player-1", cardId: "bf1", name: "Treasure Hoard", faceDown: false, visibility: "public" },
      { objectId: "field-2", zone: "board", ownerPlayerId: "player-2", cardId: "bf2", name: "Vilemaw's Lair", faceDown: false, visibility: "public" }
    ],
    chain: { status: "closed", phase: "open", priorityPlayerId: "player-1", focusPlayerId: null, items: [] },
    priority: { playerId: "player-1", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1", "field-2"], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: ["field-1"], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [
      { battlefieldId: "field-1", controllerPlayerId: "player-2", contestedByPlayerId: null, staged: "none", occupantObjectIds: ["unit-field"] },
      { battlefieldId: "field-2", controllerPlayerId: null, contestedByPlayerId: null, staged: "none", occupantObjectIds: [] }
    ],
    actionOptions: { canEndTurn: true, canAdvance: false, moves: [], plays },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  } as V2Projection;
}

function render(value: V2Projection, initialSelectedCardId: string | null = null): string {
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0 }),
    projection: value, stateVersion: value.stateVersion, eventSeq: value.eventSeq, connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "player-1", now: 0 })
  };
  return renderToStaticMarkup(<V2MatchBoard state={state} initialSelectedCardId={initialSelectedCardId} onCommand={async () => ({
    type: "command-receipt", protocolVersion: "2.0.0", commandId: "x", stateVersion: 3,
    eventSeq: 2, accepted: true, duplicate: false, rejection: null
  })} />);
}

function zone(html: string, label: string): string {
  const start = html.indexOf(`<article class="v2-zone" aria-label="${label}"`);
  expect(start, label).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
}

describe("RIFT-1055 V2 board places permanents by location", () => {
  const html = render(projection());

  it("lists base permanents in their owner's base, not on a battlefield", () => {
    expect(zone(html, "我的基地")).toContain("Rumble");
    expect(zone(html, "对手基地")).toContain("Gold");
    for (const label of ["战场 · Treasure Hoard（Bob 控制）", "战场 · Vilemaw&#x27;s Lair（无人控制）"]) {
      expect(zone(html, label)).not.toContain("Rumble");
      expect(zone(html, label)).not.toContain("Gold");
    }
  });

  it("gives each battlefield its own panel with the units there", () => {
    expect(zone(html, "战场 · Treasure Hoard（Bob 控制）")).toContain("Fiora");
    expect(zone(html, "战场 · Vilemaw&#x27;s Lair（无人控制）")).toContain("暂无公开牌");
    expect(html).not.toContain('aria-label="战场"');
  });

  it("names the priority player instead of showing the player id", () => {
    expect(html).toContain("优先权：Alice");
    expect(html).not.toContain("优先权：player-1");
  });
});

describe("RIFT-1055 V2 play destinations use names", () => {
  it("labels battlefield destinations with the battlefield card's name", () => {
    const plays: V2PlayOption[] = [
      { cardObjectId: "hand-1", destination: { kind: "base", playerId: "player-1" }, requiresDestination: true },
      { cardObjectId: "hand-1", destination: { kind: "battlefield", battlefieldId: "field-2" }, requiresDestination: true }
    ];
    const html = render(projection(plays), "hand-1");
    const select = html.slice(html.indexOf('aria-label="永久物落点"'), html.indexOf("</select>", html.indexOf('aria-label="永久物落点"')));
    expect(select).toContain(">我的基地<");
    expect(select).toContain(">战场 Vilemaw&#x27;s Lair<");
    expect(select).not.toContain(">战场 field-2<");
  });
});

describe("RIFT-1055 V2 lobby seat name", () => {
  it("lets the player set the name used to create or join a room", () => {
    const state: V2ClientState = { ...createV2ClientState({ viewerPlayerId: null, now: 0 }), connectionStatus: "connected" };
    const html = renderToStaticMarkup(<V2MatchBoard state={state} playerName="Alice"
      onCreateRoom={async () => { throw new Error("not called in a static render"); }}
      onCommand={async () => { throw new Error("not called in a static render"); }} />);
    expect(html).toMatch(/玩家名 <input[^>]*value="Alice"/u);
  });
});
