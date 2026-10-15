import { describe, expect, it } from "vitest";
import {
  FOUNDATION_RULESET_ID,
  type ClientSession,
  type RoomDeckSubmission,
  type ServerToClientMessage,
  type ServerTransport
} from "@riftbound/protocol";
import {
  loadCardCatalogRuntime,
  type CardCatalogRuntime
} from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";

const catalog = {
  schemaVersion: 1,
  dataVersion: "full-product-room-adapter-fixture",
  digest: `sha256:${"e".repeat(64)}`,
  cards: [
    card("fixture.unit-1", "Unit One"),
    card("fixture.unit-2", "Unit Two"),
    card("fixture.unit-3", "Unit Three"),
    card("fixture.unit-4", "Unit Four"),
    card("fixture.unit-5", "Unit Five"),
    card("fixture.unit-6", "Unit Six"),
    { ...card("fixture.champion", "Champion"), tags: ["Champion", "Fixturechamp"], domains: ["Fury"] },
    { ...card("fixture.legend", "Legend"), tags: ["Fixturechamp"], domains: ["Fury"] },
    card("fixture.rune", "Rune"),
    card("fixture.battlefield", "Battlefield")
  ]
};

const deckRules: CardCatalogRuntime["deckRules"] = {
  defaultMaxCopiesPerCanonical: 3,
  cardPolicies: {},
  copyRules: [
    { zones: ["mainDeck", "champion", "sideboard"], maxCopiesPerCanonical: 3 },
    { zones: ["legend"], maxCopiesPerCanonical: 3 },
    { zones: ["runes"], maxCopiesPerCanonical: 3 },
    { zones: ["battlefields"], maxCopiesPerCanonical: 1 }
  ],
  sizeRules: {
    legend: { minimum: 1, maximum: 1 },
    champion: { minimum: 1, maximum: 1 },
    runes: { minimum: 1, maximum: 1 },
    battlefields: { minimum: 1, maximum: 1 }
  },
  uniqueCanonicalZones: ["battlefields"]
};

const deck: RoomDeckSubmission = {
  mainDeck: [
    { cardId: "fixture.unit-1", quantity: 1 },
    { cardId: "fixture.unit-2", quantity: 1 },
    { cardId: "fixture.unit-3", quantity: 1 },
    { cardId: "fixture.unit-4", quantity: 1 },
    { cardId: "fixture.unit-5", quantity: 1 },
    { cardId: "fixture.unit-6", quantity: 1 }
  ],
  champion: [{ cardId: "fixture.champion", quantity: 1 }],
  legend: [{ cardId: "fixture.legend", quantity: 1 }],
  runes: [{ cardId: "fixture.rune", quantity: 1 }],
  battlefields: [{ cardId: "fixture.battlefield", quantity: 1 }]
};

function card(id: string, name: string) {
  return {
    id,
    canonicalCardId: id,
    name,
    fullName: name,
    cardType: id === "fixture.rune"
      ? "Rune"
      : id === "fixture.legend"
        ? "Legend"
        : id === "fixture.battlefield"
          ? "Battlefield"
          : "Unit",
    domains: [],
    tags: [],
    setCode: "ogs",
    cardNumber: id.slice(-3),
    variant: "standard",
    imageUrl: null,
    energy: 0,
    power: 1,
    might: null,
    ability: ""
  };
}

function captureTransport(): {
  messages: ServerToClientMessage[];
  transport: ServerTransport;
} {
  const messages: ServerToClientMessage[] = [];
  return { messages, transport: message => messages.push(message) };
}

describe("full product room adapter boundary", () => {
  it("propagates an authenticated concession to both clients and a resumed session", async () => {
    const runtime = await loadCardCatalogRuntime({ catalog, deckRules });
    const room = new GameRoom(
      "full-product-adapter",
      FOUNDATION_RULESET_ID,
      runtime
    );
    const alice = captureTransport();
    const bob = captureTransport();
    const aliceConnection = room.join("Alice", alice.transport, "alice-1");
    const bobConnection = room.join("Bob", bob.transport, "bob-1");
    const session = (playerId: "player-1" | "player-2"): ClientSession => ({
      roomId: room.roomId,
      playerId,
      resumeToken: playerId === "player-1"
        ? aliceConnection.resumeToken
        : bobConnection.resumeToken
    });

    room.submitDeck(
      session("player-1"),
      aliceConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "alice-deck",
      alice.transport
    );
    room.submitDeck(
      session("player-2"),
      bobConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "bob-deck",
      bob.transport
    );
    room.setReady(
      session("player-1"),
      aliceConnection.connectionId,
      room.currentRoomVersion,
      true,
      "alice-ready",
      alice.transport
    );
    room.setReady(
      session("player-2"),
      bobConnection.connectionId,
      room.currentRoomVersion,
      true,
      "bob-ready",
      bob.transport
    );

    const current = room.projectionFor("player-1");
    const activePlayerId = current?.activePlayerId ?? "player-1";
    room.submit(
      session(activePlayerId as "player-1" | "player-2"),
      activePlayerId === "player-1"
        ? aliceConnection.connectionId
        : bobConnection.connectionId,
      { type: "concede" },
      "adapter-concede",
      current?.version ?? 1,
      "adapter-concede",
      activePlayerId === "player-1" ? alice.transport : bob.transport
    );

    const ended = room.projectionFor("player-1");
    expect(room.status).toBe("ended");
    expect(ended?.phase).toBe("ended");
    expect(ended?.winnerPlayerId).not.toBeNull();
    expect(ended?.events.at(-1)).toMatchObject({
      type: "game-ended"
    });
    expect(alice.messages.at(-1)).toMatchObject({ type: "room", room: { status: "ended" } });
    expect(bob.messages.at(-1)).toMatchObject({ type: "room", room: { status: "ended" } });

    const resumed = captureTransport();
    const reconnection = room.reconnect(
      aliceConnection.resumeToken,
      resumed.transport,
      "alice-resumed"
    );
    expect(reconnection).not.toBeNull();
    expect(room.roomView().status).toBe("ended");
    expect(room.projectionFor("player-1")?.phase).toBe("ended");
    expect(room.projectionFor("player-1")?.events.at(-1)).toMatchObject({
      type: "game-ended"
    });
  });
});
