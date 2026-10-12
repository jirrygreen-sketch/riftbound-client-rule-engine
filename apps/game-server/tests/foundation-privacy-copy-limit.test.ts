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
  type CardCatalogRuntime,
  type PublicCatalogCard
} from "../src/card-catalog.js";
import { GameRoom, RoomError } from "../src/room.js";

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

const rawCatalog = {
  schemaVersion: 1,
  dataVersion: "foundation-privacy-copy-limit-fixture",
  digest: `sha256:${"d".repeat(64)}`,
  cards: [
    rawCard("fixture.basic-unit", "Basic Unit", "Unit", 2),
    rawCard("fixture.text-unit", "Text Unit", "Unit", 3, "Text ability."),
    rawCard("fixture.extra-unit-1", "Extra Unit 1", "Unit", 1),
    rawCard("fixture.extra-unit-2", "Extra Unit 2", "Unit", 2),
    rawCard("fixture.extra-unit-3", "Extra Unit 3", "Unit", 3),
    rawCard("fixture.gear", "Basic Gear", "Gear", 1),
    rawCard("fixture.champion", "Fixture Champion", "Unit", 1, "", ["Champion"]),
    rawCard("fixture.legend", "Fixture Legend", "Legend", 5),
    rawCard("fixture.rune", "Fixture Rune", "Rune", 0),
    rawCard("fixture.battlefield", "Fixture Battlefield", "Battlefield", 1)
  ]
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

const bobPrivateIds = [
  "player-2:mainDeck:0:1",
  "player-2:mainDeck:1:1",
  "player-2:mainDeck:2:1",
  "player-2:mainDeck:3:1",
  "player-2:mainDeck:4:1",
  "player-2:mainDeck:5:1",
  "player-2:runes:0:1"
] as const;

interface TestSeat {
  readonly transport: ServerTransport;
  readonly messages: ServerToClientMessage[];
  readonly connection: ReturnType<GameRoom["join"]>;
  readonly session: ClientSession;
}

async function createStartedRoom(roomId: string): Promise<{
  room: GameRoom;
  alice: TestSeat;
  bob: TestSeat;
}> {
  const runtime = await loadCardCatalogRuntime({
    catalog: rawCatalog,
    deckRules
  });
  const room = new GameRoom(roomId, FOUNDATION_RULESET_ID, runtime);
  const alice = joinSeat(room, "Alice", "alice-1");
  const bob = joinSeat(room, "Bob", "bob-1");

  room.submitDeck(
    alice.session,
    alice.connection.connectionId,
    room.currentRoomVersion,
    deck,
    "alice-deck",
    alice.transport
  );
  room.submitDeck(
    bob.session,
    bob.connection.connectionId,
    room.currentRoomVersion,
    deck,
    "bob-deck",
    bob.transport
  );
  room.setReady(
    alice.session,
    alice.connection.connectionId,
    room.currentRoomVersion,
    true,
    "alice-ready",
    alice.transport
  );
  room.setReady(
    bob.session,
    bob.connection.connectionId,
    room.currentRoomVersion,
    true,
    "bob-ready",
    bob.transport
  );
  expect(room.status).toBe("playing");
  return { room, alice, bob };
}

async function createWaitingRoom(roomId: string): Promise<{
  room: GameRoom;
  alice: TestSeat;
  bob: TestSeat;
}> {
  const runtime = await loadCardCatalogRuntime({
    catalog: rawCatalog,
    deckRules
  });
  const room = new GameRoom(roomId, FOUNDATION_RULESET_ID, runtime);
  return {
    room,
    alice: joinSeat(room, "Alice", "alice-1"),
    bob: joinSeat(room, "Bob", "bob-1")
  };
}

function joinSeat(
  room: GameRoom,
  name: string,
  connectionId: string
): TestSeat {
  const capture = captureTransport();
  const connection = room.join(name, capture.transport, connectionId);
  return {
    transport: capture.transport,
    messages: capture.messages,
    connection,
    session: sessionFor(room, connection)
  };
}

function resumeSeat(
  room: GameRoom,
  current: TestSeat,
  connectionId: string
): TestSeat {
  const capture = captureTransport();
  const connection = room.reconnect(
    current.session.resumeToken,
    capture.transport,
    connectionId
  );
  if (!connection) throw new Error("Expected the resume token to be valid");
  return {
    transport: capture.transport,
    messages: capture.messages,
    connection,
    session: sessionFor(room, connection)
  };
}

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

function sessionFor(room: GameRoom, connection: {
  readonly playerId: string;
  readonly resumeToken: string;
}): ClientSession {
  return {
    roomId: room.roomId,
    playerId: connection.playerId,
    resumeToken: connection.resumeToken
  };
}

function captureRoomError(operation: () => void): RoomError {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RoomError);
  return caught as RoomError;
}

function countRoomEvents(room: GameRoom, type: string): number {
  return room.roomEvents().filter(event => event.type === type).length;
}

function expectNoPrivateIds(value: unknown, privateIds: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const privateId of privateIds) {
    expect(serialized).not.toContain(privateId);
  }
}

function rawCard(
  id: string,
  name: string,
  cardType: string,
  energy: number,
  ability = "",
  tags: readonly string[] = []
): Omit<PublicCatalogCard, "allowedZones" | "maxCopies" | "banned" | "available" | "availabilityReason"> {
  return {
    id,
    canonicalCardId: id,
    name,
    fullName: name,
    cardType,
    domains: [],
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

describe("foundation privacy and copy limits", () => {
  it("projects only the viewer's hand and never exposes private zone objects", async () => {
    const { room } = await createStartedRoom("privacy-zones");
    const aliceProjection = room.projectionFor("player-1");
    const bobProjection = room.projectionFor("player-2");
    expect(aliceProjection).not.toBeNull();
    expect(bobProjection).not.toBeNull();

    const aliceSeat = aliceProjection?.players.find(player => player.id === "player-1");
    const viewedBob = aliceProjection?.players.find(player => player.id === "player-2");
    const bobSeat = bobProjection?.players.find(player => player.id === "player-2");

    expect(aliceSeat?.hand).toHaveLength(4);
    expect(aliceSeat?.hand.map(card => card.instanceId)).toEqual([
      "player-1:mainDeck:0:1",
      "player-1:mainDeck:1:1",
      "player-1:mainDeck:2:1",
      "player-1:mainDeck:3:1"
    ]);
    expect(viewedBob?.hand).toEqual([]);
    expect(viewedBob?.handCount).toBe(4);
    expect(bobSeat?.hand).toHaveLength(4);

    const aliceObjectIds = aliceProjection?.objects?.map(object => object.objectId) ?? [];
    expect(aliceObjectIds).not.toEqual(expect.arrayContaining([...bobPrivateIds]));
    expect(aliceObjectIds).toContain("player-2:battlefields:0:1");
    expect(aliceObjectIds).toContain("player-2:champion:0:1");
    expect(aliceObjectIds).toContain("player-2:legend:0:1");
    expect(aliceProjection?.objects?.some(object =>
      object.zone === "deck" || object.zone === "rune-deck"
    )).toBe(false);
  });

  it("keeps snapshots, event replay, room views, and transports free of private data", async () => {
    const { room, alice } = await createStartedRoom("privacy-replay");
    const snapshot = room.snapshot("player-1");
    expect(snapshot).not.toBeNull();
    expectNoPrivateIds(snapshot, bobPrivateIds);
    expect(snapshot?.projection.players.find(player => player.id === "player-2")?.hand)
      .toEqual([]);

    const resumed = resumeSeat(room, alice, "alice-2");
    room.sendEvents(resumed.session, resumed.connection.connectionId, 0);
    const eventsMessage = resumed.messages.find(message => message.type === "events");
    expect(eventsMessage).toBeDefined();
    expectNoPrivateIds(eventsMessage, bobPrivateIds);

    room.sendRoomEvents(resumed.session, resumed.connection.connectionId, 0);
    const roomEventsMessage = resumed.messages.find(message =>
      message.type === "room-events"
    );
    expect(roomEventsMessage).toBeDefined();
    expectNoPrivateIds(roomEventsMessage, bobPrivateIds);

    const aliceDeck = alice.messages.find(message =>
      message.type === "request-result" &&
      message.requestId === "alice-deck"
    );
    expect(aliceDeck).toBeDefined();
    expectNoPrivateIds(aliceDeck, bobPrivateIds);

    const roomView = room.roomView();
    expectNoPrivateIds(roomView, bobPrivateIds);
    expect(roomView).not.toHaveProperty("resumeToken");

    const allTransportMessages = [
      ...alice.messages,
      ...resumed.messages
    ];
    expectNoPrivateIds(allTransportMessages, bobPrivateIds);
    expectNoPrivateIds(allTransportMessages, [alice.session.resumeToken]);
    expectNoPrivateIds(allTransportMessages, [resumed.session.resumeToken]);
  });

  it("rejects replaced sessions and invalid tokens for room mutations", async () => {
    const { room, alice: initialAlice, bob } =
      await createWaitingRoom("session-binding");
    const alice = resumeSeat(room, initialAlice, "alice-2");
    const before = room.roomView();

    const replacedDeck = captureRoomError(() =>
      room.submitDeck(
        initialAlice.session,
        initialAlice.connection.connectionId,
        room.currentRoomVersion,
        deck,
        "old-deck",
        initialAlice.transport
      )
    );
    expect(replacedDeck.code).toBe("session-replaced");

    const replacedReady = captureRoomError(() =>
      room.setReady(
        initialAlice.session,
        initialAlice.connection.connectionId,
        room.currentRoomVersion,
        true,
        "old-ready",
        initialAlice.transport
      )
    );
    expect(replacedReady.code).toBe("session-replaced");

    const invalidToken: ClientSession = {
      ...alice.session,
      resumeToken: `${alice.session.resumeToken}-invalid`
    };
    const invalidDeck = captureRoomError(() =>
      room.submitDeck(
        invalidToken,
        alice.connection.connectionId,
        room.currentRoomVersion,
        deck,
        "invalid-deck-token",
        alice.transport
      )
    );
    expect(invalidDeck.code).toBe("invalid-token");

    const invalidReady = captureRoomError(() =>
      room.setReady(
        invalidToken,
        alice.connection.connectionId,
        room.currentRoomVersion,
        true,
        "invalid-ready-token",
        alice.transport
      )
    );
    expect(invalidReady.code).toBe("invalid-token");

    expect(room.roomView()).toEqual(before);
    room.submitDeck(
      alice.session,
      alice.connection.connectionId,
      room.currentRoomVersion,
      deck,
      "alice-deck",
      alice.transport
    );
    room.submitDeck(
      bob.session,
      bob.connection.connectionId,
      room.currentRoomVersion,
      deck,
      "bob-deck",
      bob.transport
    );
  });

  it("rejects over-limit canonical copies without mutating room state", async () => {
    const { room, alice } = await createWaitingRoom("copy-limit-rejected");
    const overLimitDeck: RoomDeckSubmission = {
      ...deck,
      mainDeck: [{ cardId: "fixture.basic-unit", quantity: 4 }]
    };
    const beforeView = room.roomView();
    const beforeEvents = room.roomEvents();
    const beforeVersion = room.currentRoomVersion;

    const error = captureRoomError(() =>
      room.submitDeck(
        alice.session,
        alice.connection.connectionId,
        room.currentRoomVersion,
        overLimitDeck,
        "over-limit",
        alice.transport
      )
    );

    expect(error.code).toBe("invalid-deck");
    expect(room.currentRoomVersion).toBe(beforeVersion);
    expect(room.roomView()).toEqual(beforeView);
    expect(room.roomEvents()).toEqual(beforeEvents);
    expect(countRoomEvents(room, "deck-submitted")).toBe(0);
    expect(alice.messages).toEqual([]);
  });

  it("accepts duplicate entries that total the canonical copy limit", async () => {
    const { room, alice } = await createWaitingRoom("copy-limit-merged");
    const exactLimitDeck: RoomDeckSubmission = {
      ...deck,
      mainDeck: [
        { cardId: "fixture.basic-unit", quantity: 1 },
        { cardId: "fixture.basic-unit", quantity: 2 }
      ]
    };

    room.submitDeck(
      alice.session,
      alice.connection.connectionId,
      room.currentRoomVersion,
      exactLimitDeck,
      "exact-limit",
      alice.transport
    );

    expect(room.roomView().players.find(player => player.id === "player-1")?.deckSubmitted)
      .toBe(true);
    expect(countRoomEvents(room, "deck-submitted")).toBe(1);
    expect(alice.messages.some(message =>
      message.type === "request-result" &&
      message.requestId === "exact-limit" &&
      message.ok
    )).toBe(true);
  });
});
