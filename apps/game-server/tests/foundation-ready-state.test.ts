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
  dataVersion: "foundation-ready-state-fixture",
  digest: `sha256:${"c".repeat(64)}`,
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

interface TestSeat {
  readonly transport: ServerTransport;
  readonly messages: ServerToClientMessage[];
  readonly connection: ReturnType<GameRoom["join"]>;
  readonly session: ClientSession;
}

async function createHarness(roomId: string): Promise<{
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

function submitDeck(
  room: GameRoom,
  seat: TestSeat,
  requestId: string,
  expectedRoomVersion = room.currentRoomVersion
): void {
  room.submitDeck(
    seat.session,
    seat.connection.connectionId,
    expectedRoomVersion,
    deck,
    requestId,
    seat.transport
  );
}

function setReady(
  room: GameRoom,
  seat: TestSeat,
  ready: boolean,
  requestId: string,
  expectedRoomVersion = room.currentRoomVersion
): void {
  room.setReady(
    seat.session,
    seat.connection.connectionId,
    expectedRoomVersion,
    ready,
    requestId,
    seat.transport
  );
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

describe("foundation ready and start state", () => {
  it("rejects ready without a submitted deck and leaves state unchanged", async () => {
    const { room, alice } = await createHarness("no-deck");
    const before = room.roomView();

    const error = captureRoomError(() =>
      setReady(room, alice, true, "alice-ready")
    );

    expect(error.code).toBe("invalid-deck");
    expect(room.roomView()).toEqual(before);
    expect(countRoomEvents(room, "game-started")).toBe(0);
  });

  it("auto-starts once when both players submit decks and become ready", async () => {
    const { room, alice, bob } = await createHarness("auto-start");

    submitDeck(room, alice, "alice-deck");
    expect(room.status).toBe("waiting");
    submitDeck(room, bob, "bob-deck");
    expect(room.status).toBe("waiting");

    setReady(room, alice, true, "alice-ready");
    expect(room.status).toBe("waiting");
    setReady(room, bob, true, "bob-ready");

    expect(room.status).toBe("playing");
    expect(room.projectionFor("player-1")).not.toBeNull();
    expect(room.projectionFor("player-2")).not.toBeNull();
    expect(countRoomEvents(room, "game-started")).toBe(1);
    expect(room.roomEvents().at(-1)?.type).toBe("game-started");
  });

  it("cancels ready when a deck is resubmitted and requires ready again", async () => {
    const { room, alice, bob } = await createHarness("ready-reset");

    submitDeck(room, alice, "alice-deck");
    submitDeck(room, bob, "bob-deck");
    setReady(room, alice, true, "alice-ready");
    expect(room.roomView().players[0]?.ready).toBe(true);
    const versionBeforeResubmit = room.currentRoomVersion;

    submitDeck(room, alice, "alice-deck-again");

    expect(room.currentRoomVersion).toBeGreaterThan(versionBeforeResubmit);
    expect(room.roomView().players[0]?.ready).toBe(false);
    expect(room.roomEvents().slice(-2).map(event => event.type)).toEqual([
      "player-ready",
      "deck-submitted"
    ]);
    expect(room.roomEvents().at(-2)).toMatchObject({
      playerId: "player-1",
      ready: false
    });

    setReady(room, bob, true, "bob-ready");
    expect(room.status).toBe("waiting");
    expect(countRoomEvents(room, "game-started")).toBe(0);

    setReady(room, alice, true, "alice-ready-again");
    expect(room.status).toBe("playing");
    expect(countRoomEvents(room, "game-started")).toBe(1);
  });

  it("rejects stale deck and ready versions without advancing the start", async () => {
    const { room, alice, bob } = await createHarness("stale-room-version");
    const beforeStaleDeck = room.roomView();

    const staleDeck = captureRoomError(() =>
      submitDeck(
        room,
        alice,
        "stale-deck",
        room.currentRoomVersion + 1
      )
    );
    expect(staleDeck.code).toBe("stale-version");
    expect(room.roomView()).toEqual(beforeStaleDeck);

    submitDeck(room, alice, "alice-deck");
    submitDeck(room, bob, "bob-deck");
    const beforeStaleReady = room.roomView();

    const staleReady = captureRoomError(() =>
      setReady(
        room,
        alice,
        true,
        "stale-ready",
        room.currentRoomVersion + 1
      )
    );
    expect(staleReady.code).toBe("stale-version");
    expect(room.roomView()).toEqual(beforeStaleReady);

    setReady(room, bob, true, "bob-ready");
    expect(room.status).toBe("waiting");
    expect(countRoomEvents(room, "game-started")).toBe(0);

    setReady(room, alice, true, "alice-ready");
    expect(room.status).toBe("playing");
  });

  it("rejects mutations from a replaced session and does not start early", async () => {
    const { room, alice: initialAlice, bob } =
      await createHarness("session-replaced");
    submitDeck(room, initialAlice, "alice-deck");
    submitDeck(room, bob, "bob-deck");

    const alice = resumeSeat(room, initialAlice, "alice-2");
    const beforeOldSessionMutation = room.roomView();
    const replaced = captureRoomError(() =>
      setReady(
        room,
        initialAlice,
        true,
        "old-alice-ready"
      )
    );

    expect(replaced.code).toBe("session-replaced");
    expect(room.roomView()).toEqual(beforeOldSessionMutation);

    setReady(room, bob, true, "bob-ready");
    expect(room.status).toBe("waiting");
    expect(countRoomEvents(room, "game-started")).toBe(0);

    setReady(room, alice, true, "alice-ready");
    expect(room.status).toBe("playing");
    expect(countRoomEvents(room, "game-started")).toBe(1);
  });

  it("does not start while a ready player is disconnected", async () => {
    const { room, alice: initialAlice, bob } =
      await createHarness("disconnect-before-start");
    submitDeck(room, initialAlice, "alice-deck");
    submitDeck(room, bob, "bob-deck");
    setReady(room, initialAlice, true, "alice-ready");

    expect(
      room.disconnect("player-1", initialAlice.connection.connectionId)
    ).toBe(true);
    expect(room.roomView().players[0]?.connected).toBe(false);

    const startError = captureRoomError(() => room.start());
    expect(startError.code).toBe("command-rejected");

    setReady(room, bob, true, "bob-ready");
    expect(room.status).toBe("waiting");
    expect(countRoomEvents(room, "game-started")).toBe(0);

    const alice = resumeSeat(room, initialAlice, "alice-2");
    expect(room.status).toBe("waiting");

    setReady(room, alice, true, "alice-ready-again");
    expect(room.status).toBe("playing");
    expect(countRoomEvents(room, "game-started")).toBe(1);
  });

  it("rejects deck and ready mutations after the game starts", async () => {
    const { room, alice, bob } = await createHarness("mutations-after-start");
    submitDeck(room, alice, "alice-deck");
    submitDeck(room, bob, "bob-deck");
    setReady(room, alice, true, "alice-ready");
    setReady(room, bob, true, "bob-ready");
    expect(room.status).toBe("playing");

    const beforeMutations = room.roomView();
    const deckError = captureRoomError(() =>
      submitDeck(room, alice, "late-deck")
    );
    const readyError = captureRoomError(() =>
      setReady(room, bob, false, "late-ready")
    );

    expect(deckError.code).toBe("command-rejected");
    expect(readyError.code).toBe("command-rejected");
    expect(room.roomView()).toEqual(beforeMutations);
    expect(countRoomEvents(room, "game-started")).toBe(1);
  });
});

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

function rawCard(
  id: string,
  name: string,
  cardType: string,
  energy: number,
  ability = "",
  tags: readonly string[] = [],
  domains: readonly string[] = []
): Omit<PublicCatalogCard, "allowedZones" | "maxCopies" | "banned" | "available" | "availabilityReason"> {
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
