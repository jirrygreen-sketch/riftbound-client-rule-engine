import { describe, expect, it } from "vitest";
import {
  FOUNDATION_RULESET_ID,
  RULESET_ID,
  type RoomDeckSubmission,
  type ServerTransport,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { createFoundationGame } from "../src/foundation-game.js";
import {
  loadCardCatalogRuntime,
  type CardCatalogRuntime,
  type PublicCatalogCard
} from "../src/card-catalog.js";
import { GameRoom, RoomError } from "../src/room.js";

const catalogCards: readonly PublicCatalogCard[] = [
  catalogCard("fixture.basic-unit", "Basic Unit", "Unit", 2),
  catalogCard("fixture.text-unit", "Text Unit", "Unit", 3, "Text ability."),
  catalogCard("fixture.extra-unit-1", "Extra Unit 1", "Unit", 1),
  catalogCard("fixture.extra-unit-2", "Extra Unit 2", "Unit", 2),
  catalogCard("fixture.extra-unit-3", "Extra Unit 3", "Unit", 3),
  catalogCard("fixture.gear", "Basic Gear", "Gear", 1, ""),
  catalogCard("fixture.champion", "Fixture Champion", "Unit", 1, "", ["Champion", "Fixturechamp"], ["Fury"]),
  catalogCard("fixture.legend", "Fixture Legend", "Legend", 5, "", ["Fixturechamp"], ["Fury"]),
  catalogCard("fixture.rune", "Fixture Rune", "Rune", 0),
  catalogCard("fixture.battlefield", "Fixture Battlefield", "Battlefield", 1)
];

const rawCatalog = {
  schemaVersion: 1,
  dataVersion: "foundation-room-fixture",
  digest: `sha256:${"b".repeat(64)}`,
  cards: [
    rawCard("fixture.basic-unit", "Basic Unit", "Unit", 2),
    rawCard("fixture.text-unit", "Text Unit", "Unit", 3, "Text ability."),
    rawCard("fixture.extra-unit-1", "Extra Unit 1", "Unit", 1),
    rawCard("fixture.extra-unit-2", "Extra Unit 2", "Unit", 2),
    rawCard("fixture.extra-unit-3", "Extra Unit 3", "Unit", 3),
    rawCard("fixture.gear", "Basic Gear", "Gear", 1),
    rawCard("fixture.champion", "Fixture Champion", "Unit", 1, "", ["Champion", "Fixturechamp"], ["Fury"]),
    rawCard("fixture.legend", "Fixture Legend", "Legend", 5, "", ["Fixturechamp"], ["Fury"]),
    rawCard("fixture.rune", "Fixture Rune", "Rune", 0),
    rawCard("fixture.battlefield", "Fixture Battlefield", "Battlefield", 1)
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
    { cardId: "fixture.basic-unit", quantity: 1 },
    { cardId: "fixture.text-unit", quantity: 1 },
    { cardId: "fixture.extra-unit-1", quantity: 1 },
    { cardId: "fixture.extra-unit-2", quantity: 1 },
    { cardId: "fixture.extra-unit-3", quantity: 1 },
    { cardId: "fixture.gear", quantity: 1 }
  ],
  champion: [{ cardId: "fixture.champion", quantity: 1 }],
  legend: [{ cardId: "fixture.legend", quantity: 1 }],
  runes: [{ cardId: "fixture.rune", quantity: 1 }],
  battlefields: [{ cardId: "fixture.battlefield", quantity: 1 }]
};

function captureTransport(): {
  messages: ServerToClientMessage[];
  transport: ServerTransport;
} {
  const messages: ServerToClientMessage[] = [];
  return {
    messages,
    transport: message => {
      messages.push(message);
    }
  };
}

describe("foundation game adapter", () => {
  it("maps submitted printings without guessing unmodeled card semantics", () => {
    const state = createFoundationGame(
      [
        { id: "player-1", name: "Alice", deck },
        { id: "player-2", name: "Bob", deck }
      ],
      catalogCards
    );

    expect(state.rules.rulesetId).toBe(FOUNDATION_RULESET_ID);
    expect(state.players.map(player => player.id)).toEqual([
      "player-1",
      "player-2"
    ]);
    expect(state.players[0]?.hand.map(card => card.instanceId)).toEqual([
      "player-1:mainDeck:0:1",
      "player-1:mainDeck:1:1",
      "player-1:mainDeck:2:1",
      "player-1:mainDeck:3:1"
    ]);
    expect(state.players[0]?.deck.map(id => state.objects[id]?.instanceId)).toEqual([
      "player-1:mainDeck:4:1",
      "player-1:mainDeck:5:1"
    ]);

    const basicUnit = state.cards["fixture.basic-unit"];
    expect(basicUnit).toMatchObject({
      id: "fixture.basic-unit",
      name: "Basic Unit",
      cost: 2,
      types: ["unit"]
    });
    expect(basicUnit?.effect).toBeUndefined();
    expect(state.cards["fixture.champion"]).toMatchObject({
      id: "fixture.champion",
      types: ["unit"]
    });

    expect(state.cards["fixture.text-unit"]?.effect).toMatchObject({
      kind: "judge-required",
      reason: "official card text not modeled"
    });
    expect(state.cards["fixture.gear"]).toMatchObject({
      types: ["token"],
      effect: {
        kind: "judge-required",
        reason: "official card type not modeled"
      }
    });
    expect(state.cards["fixture.rune"]).toMatchObject({
      types: ["rune"],
      effect: {
        kind: "judge-required",
        reason: "inherent rune abilities not modeled"
      }
    });

    const battlefield = state.objects["player-1:battlefields:0:1"];
    expect(battlefield).toMatchObject({
      instanceId: "player-1:battlefields:0:1",
      cardId: "fixture.battlefield",
      zone: "battlefield"
    });
    expect(state.objects["player-1:champion:0:1"]).toMatchObject({
      instanceId: "player-1:champion:0:1",
      cardId: "fixture.champion",
      zone: "champion"
    });
  });

  it("rejects unknown card types instead of compiling a synthetic type", () => {
    const unknownCards: readonly PublicCatalogCard[] = [
      catalogCard("fixture.unknown", "Unknown", "Unicorn", 1)
    ];
    const unknownDeck: RoomDeckSubmission = {
      mainDeck: [{ cardId: "fixture.unknown", quantity: 1 }]
    };

    expect(() => createFoundationGame(
      [
        { id: "player-1", name: "Alice", deck: unknownDeck },
        { id: "player-2", name: "Bob", deck: unknownDeck }
      ],
      unknownCards
    )).toThrow("no supported foundation object type");
  });
});

describe("foundation room orchestration", () => {
  it("starts only after two current, ready, submitted-deck connections", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("foundation-room", FOUNDATION_RULESET_ID, runtime);
    const alice = captureTransport();
    const bob = captureTransport();
    const aliceConnection = room.join("Alice", alice.transport, "alice-1");
    const bobConnection = room.join("Bob", bob.transport, "bob-1");
    const aliceSession = sessionFor(room, aliceConnection);
    const bobSession = sessionFor(room, bobConnection);

    room.submitDeck(
      aliceSession,
      aliceConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "alice-deck",
      alice.transport
    );
    room.submitDeck(
      bobSession,
      bobConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "bob-deck",
      bob.transport
    );
    room.setReady(
      aliceSession,
      aliceConnection.connectionId,
      room.currentRoomVersion,
      true,
      "alice-ready",
      alice.transport
    );
    expect(room.status).toBe("waiting");

    room.setReady(
      bobSession,
      bobConnection.connectionId,
      room.currentRoomVersion,
      true,
      "bob-ready",
      bob.transport
    );
    expect(room.status).toBe("playing");

    const projection = room.projectionFor("player-1");
    expect(projection?.rulesetId).toBe(FOUNDATION_RULESET_ID);
    expect(projection?.players[0]?.zoneCounts?.deck).toBe(2);
    expect(projection?.players[0]?.hand).toHaveLength(4);
    expect(projection?.players[0]?.zoneCounts?.["rune-deck"]).toBe(1);
    expect(projection?.players[1]?.zoneCounts?.["rune-deck"]).toBe(1);
    expect(projection?.players[0]?.zoneCounts?.rune).toBe(0);
    expect(projection?.objects?.some(object =>
      object.cardId === "fixture.rune"
    )).toBe(false);
    expect(projection?.objects?.map(object => object.cardId)).toContain(
      "fixture.battlefield"
    );
  });

  it("resets readiness when a submitted deck changes", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("ready-reset-room", FOUNDATION_RULESET_ID, runtime);
    const alice = captureTransport();
    const bob = captureTransport();
    const aliceConnection = room.join("Alice", alice.transport, "alice-1");
    const bobConnection = room.join("Bob", bob.transport, "bob-1");
    const aliceSession = sessionFor(room, aliceConnection);
    const bobSession = sessionFor(room, bobConnection);

    room.submitDeck(
      aliceSession,
      aliceConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "alice-deck",
      alice.transport
    );
    room.submitDeck(
      bobSession,
      bobConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "bob-deck",
      bob.transport
    );
    room.setReady(
      aliceSession,
      aliceConnection.connectionId,
      room.currentRoomVersion,
      true,
      "alice-ready",
      alice.transport
    );
    expect(room.roomView().players.find(player => player.id === "player-1")?.ready)
      .toBe(true);

    room.submitDeck(
      aliceSession,
      aliceConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "alice-deck-2",
      alice.transport
    );
    const readyEvent = [...room.roomEvents()].reverse().find(event =>
      event.type === "player-ready" && event.playerId === "player-1"
    );
    expect(readyEvent).toMatchObject({ ready: false });
    expect(room.roomView().players.find(player => player.id === "player-1")?.ready)
      .toBe(false);
  });

  it("does not start when a ready player has no current connection", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("disconnect-room", FOUNDATION_RULESET_ID, runtime);
    const alice = captureTransport();
    const bob = captureTransport();
    const aliceConnection = room.join("Alice", alice.transport, "alice-1");
    const bobConnection = room.join("Bob", bob.transport, "bob-1");
    const aliceSession = sessionFor(room, aliceConnection);
    const bobSession = sessionFor(room, bobConnection);

    room.submitDeck(
      aliceSession,
      aliceConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "alice-deck",
      alice.transport
    );
    room.submitDeck(
      bobSession,
      bobConnection.connectionId,
      room.currentRoomVersion,
      deck,
      "bob-deck",
      bob.transport
    );
    room.setReady(
      bobSession,
      bobConnection.connectionId,
      room.currentRoomVersion,
      true,
      "bob-ready",
      bob.transport
    );
    room.disconnect("player-2", bobConnection.connectionId);

    room.setReady(
      aliceSession,
      aliceConnection.connectionId,
      room.currentRoomVersion,
      true,
      "alice-ready",
      alice.transport
    );
    expect(room.status).toBe("waiting");
    expect(() => room.start()).toThrow(
      "Every player must be connected"
    );
  });

  it("replays only viewer-visible game events and rejects replaced connections", () => {
    const room = new GameRoom("synthetic-room", RULESET_ID);
    const alice = captureTransport();
    const bob = captureTransport();
    const aliceConnection = room.join("Alice", alice.transport, "alice-1");
    const bobConnection = room.join("Bob", bob.transport, "bob-1");
    const aliceSession = sessionFor(room, aliceConnection);
    const bobSession = sessionFor(room, bobConnection);
    room.start();

    room.submit(
      aliceSession,
      aliceConnection.connectionId,
      { type: "play-card", instanceId: "player-1:trigger-conquer" },
      "alice-play",
      room.projectionFor("player-1")?.version ?? 1,
      "alice-play-request",
      alice.transport
    );

    room.sendEvents(aliceSession, aliceConnection.connectionId, 0);
    room.sendEvents(bobSession, bobConnection.connectionId, 0);
    const aliceEvents = alice.messages.find(message => message.type === "events");
    const bobEvents = bob.messages.find(message => message.type === "events");
    expect(aliceEvents?.events.some(event => event.type === "prompt-created"))
      .toBe(true);
    expect(bobEvents?.events.some(event => event.type === "prompt-created"))
      .toBe(false);

    const resumed = captureTransport();
    room.reconnect(aliceSession.resumeToken, resumed.transport, "alice-2");
    expect(() => room.sendEvents(
      aliceSession,
      aliceConnection.connectionId,
      0
    )).toThrowError(RoomError);
  });
});

function catalogCard(
  id: string,
  name: string,
  cardType: string,
  energy: number,
  ability = "",
  tags: readonly string[] = [],
  domains: readonly string[] = []
): PublicCatalogCard {
  return {
    id,
    canonicalCardId: id,
    name,
    fullName: name,
    cardType,
    domains,
    tags,
    setCode: "ogs",
    cardNumber: id.slice(-3),
    variant: "standard",
    imageUrl: null,
    energy,
    power: null,
    might: null,
    ability,
    allowedZones: ["mainDeck", "sideboard"],
    maxCopies: 3,
    banned: false,
    available: true,
    availabilityReason: "available"
  };
}

function rawCard(
  id: string,
  name: string,
  cardType: string,
  energy: number,
  ability = "",
  tags: readonly string[] = [],
  domains: readonly string[] = []
) {
  return {
    id,
    canonicalCardId: id,
    name,
    fullName: name,
    cardType,
    domains,
    tags,
    setCode: "ogs",
    cardNumber: id.slice(-3),
    variant: "standard",
    imageUrl: null,
    energy,
    power: null,
    might: null,
    ability
  };
}

function sessionFor(room: GameRoom, connection: {
  readonly playerId: string;
  readonly resumeToken: string;
}) {
  return {
    roomId: room.roomId,
    playerId: connection.playerId,
    resumeToken: connection.resumeToken
  };
}
