import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  PlayableMatchBoard,
  buildZones,
  isZoneVisibleToViewer,
  selectCard,
  selectTarget,
  visibleZoneObjects
} from "../../src/full-product/PlayableMatchBoard";
import {
  BoardZones,
  visibleObjects
} from "../../src/full-product/components/BoardZones";
import type { PlayableMatchView } from "../../src/full-product/types";
import type { GameProjection, ProjectionObject } from "@riftbound/protocol";

const hiddenObject: ProjectionObject = {
  objectId: "opponent-secret",
  cardId: "secret-card",
  zone: "hand",
  controllerId: "player-2",
  ownerPlayerId: "player-2",
  faceUp: false
};

const publicObject: ProjectionObject = {
  objectId: "opponent-unit",
  cardId: "public-card",
  zone: "board",
  controllerId: "player-2",
  ownerPlayerId: "player-2",
  faceUp: true
};

describe("full-product board privacy", () => {
  it("shows every required zone and keeps hidden zones count-only", () => {
    const zones = buildZones(makeView());
    expect(zones.map(zone => zone.zone)).toEqual([
      "hand",
      "deck",
      "rune-deck",
      "rune",
      "board",
      "battlefield",
      "discard",
      "banish",
      "chain"
    ]);
    const hand = zones.find(zone => zone.zone === "hand");
    expect(hand).toMatchObject({ hidden: true, count: 2 });
  });

  it("never exposes opponent private objects even if the wire accidentally includes them", () => {
    const view = makeView();
    expect(isZoneVisibleToViewer(view, "player-2", "hand")).toBe(false);
    expect(isZoneVisibleToViewer(view, "player-2", "deck")).toBe(false);
    expect(isZoneVisibleToViewer(view, "player-2", "rune-deck")).toBe(false);
    expect(visibleZoneObjects(view, "player-2", "hand")).toEqual([]);
    expect(visibleZoneObjects(view, "player-2", "board")).toEqual([publicObject]);
    expect(visibleObjects(view, "player-2", "hand")).toEqual([]);
  });

  it("renders a server-marked hand card without any click-trigger behavior", () => {
    const view = makeView();
    const html = renderToStaticMarkup(
      <pre>{JSON.stringify(visibleZoneObjects(view, "player-1", "hand"))}</pre>
    );
    expect(html).toContain("self-card");
    expect(html).not.toContain("secret-card");
    expect(html).not.toContain("onDoubleClick");
  });

  it("renders the integrated status, zones, and prompt action panel from one view", () => {
    const html = renderToStaticMarkup(
      <PlayableMatchBoard
        view={makeView()}
        selection={{ actionId: "pass", cardId: null, targetIds: [] }}
        onSelectionChange={() => {}}
        onSubmit={() => {}}
      />
    );
    expect(html).toContain("full-product-match");
    expect(html).toContain("full-product-status");
    expect(html).toContain("full-product-zones");
    expect(html).toContain("full-product-actions");
  });

  it("enables board targets immediately and maps them to prompt option ids", () => {
    const view: PlayableMatchView = {
      ...makeView(),
      targetRequirements: { "self-card": ["target"] },
      targets: {
        "self-card": [
          { id: "target-1", label: "target one", objectId: "opponent-unit" }
        ]
      }
    };
    const selection = selectCard({
      instanceId: "self-hand-1",
      cardId: "self-card",
      zone: "hand",
      title: "Card self-card"
    }, view, { actionId: null, cardId: null, targetIds: [] });
    expect(selection.actionId).toBe("play:self-hand-1");
    const html = renderToStaticMarkup(
      <BoardZones
        view={view}
        selectedActionId={selection.actionId}
        selectedCardId={selection.cardId}
        selectedTargetIds={selection.targetIds}
        onSelectCard={() => {}}
        onSelectTarget={() => {}}
      />
    );
    expect(html).toContain("Card public-card");
    expect(html).not.toContain("disabled=\"\"");
    const updated = selectTarget("target-1", view, selection);
    expect(updated.targetIds).toEqual(["target-1"]);
  });
});

function makeView(): PlayableMatchView {
  return {
    connectionStatus: "connected",
    commandPending: false,
    viewerPlayerId: "player-1",
    resolveCardTitle: cardId => `Card ${cardId}`,
    resolveCardImage: () => null,
    projection: makeProjection()
  };
}

function makeProjection(): GameProjection {
  return {
    version: 1,
    eventSeq: 0,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    priority: { playerId: "player-1" },
    winnerPlayerId: null,
    prompt: null,
    waitingForPlayerId: null,
    objects: [hiddenObject, publicObject, selfObject()],
    players: [
      {
        id: "player-1",
        name: "Alice",
        handCount: 1,
        hand: [{ instanceId: "self-hand-1", cardId: "self-card" }],
        playableInstanceIds: ["self-hand-1"],
        zoneCounts: { hand: 1, board: 1 }
      },
      {
        id: "player-2",
        name: "Bob",
        handCount: 1,
        hand: [],
        playableInstanceIds: [],
        zoneCounts: { hand: 1, board: 1 }
      }
    ],
    events: []
  };
}

function selfObject(): ProjectionObject {
  return {
    objectId: "self-hand-1",
    cardId: "self-card",
    zone: "hand",
    controllerId: "player-1",
    ownerPlayerId: "player-1",
    faceUp: true
  };
}
