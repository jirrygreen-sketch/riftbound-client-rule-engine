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
  dataVersion: "room-request-dedupe-fixture",
  digest: `sha256:${"r".repeat(64)}`,
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

function submitDeck(
  room: GameRoom,
  seat: TestSeat,
  requestId: string,
  deckPayload: RoomDeckSubmission = deck,
  expectedRoomVersion: number = room.currentRoomVersion
): void {
  room.submitDeck(
    seat.session,
    seat.connection.connectionId,
    expectedRoomVersion,
    deckPayload,
    requestId,
    seat.transport
  );
}

function setReady(
  room: GameRoom,
  seat: TestSeat,
  requestId: string,
  ready: boolean,
  expectedRoomVersion: number = room.currentRoomVersion
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

function captureError(operation: () => void): RoomError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RoomError);
    return error as RoomError;
  }
  throw new Error("Expected the operation to fail");
}

function receipt(seat: TestSeat, requestId: string) {
  const result = [...seat.messages].reverse().find(message =>
    message.type === "request-result" && message.requestId === requestId
  );
  expect(result).toBeDefined();
  return result as Extract<ServerToClientMessage, { type: "request-result" }>;
}

function snapshotConnections(room: GameRoom) {
  return [...room.players.entries()].map(([playerId, connection]) => ({
    playerId,
    connection
  }));
}

function rawCard(
  id: string,
  name: string,
  cardType: string,
  energy: number,
  ability = "",
  tags: readonly string[] = [],
  domains: readonly string[] = []
): Omit<PublicCatalogCard,
  "allowedZones" |
  "maxCopies" |
  "banned" |
  "available" |
  "availabilityReason"
> {
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

describe("room request deduplication", () => {
  it("replays a successful submit-deck receipt without mutating the room", async () => {
    const { room, alice } = await createHarness("deck-replay");
    submitDeck(room, alice, "alice-deck");
    const first = receipt(alice, "alice-deck");
    const version = room.currentRoomVersion;
    const eventSeq = room.currentRoomEventSeq;
    const events = room.roomEvents();
    const view = room.roomView();

    submitDeck(
      room,
      alice,
      "alice-deck",
      deck,
      version + 17
    );

    expect(receipt(alice, "alice-deck")).toMatchObject({
      ok: true,
      roomVersion: first.roomVersion,
      roomEventSeq: first.roomEventSeq,
      duplicate: true
    });
    expect(room.currentRoomVersion).toBe(version);
    expect(room.currentRoomEventSeq).toBe(eventSeq);
    expect(room.roomEvents()).toEqual(events);
    expect(room.roomView()).toEqual(view);
  });

  it("scopes request ids by player", async () => {
    const { room, alice, bob } = await createHarness("shared-request-id");
    submitDeck(room, alice, "shared-deck");
    submitDeck(room, bob, "shared-deck");

    expect(receipt(alice, "shared-deck")).toMatchObject({
      ok: true,
      duplicate: false
    });
    expect(receipt(bob, "shared-deck")).toMatchObject({
      ok: true,
      duplicate: false
    });
    expect(room.roomEvents().filter(event =>
      event.type === "deck-submitted"
    )).toHaveLength(2);
  });

  it("rejects a submit-deck request id reused with a different payload", async () => {
    const { room, alice } = await createHarness("deck-conflict");
    submitDeck(room, alice, "alice-deck");
    const version = room.currentRoomVersion;
    const events = room.roomEvents();
    const view = room.roomView();

    const error = captureError(() => submitDeck(room, alice, "alice-deck", {
      ...deck,
      mainDeck: [...deck.mainDeck ?? [], { cardId: "fixture.gear", quantity: 1 }]
    }));

    expect(error.code).toBe("idempotency-conflict");
    expect(room.currentRoomVersion).toBe(version);
    expect(room.roomEvents()).toEqual(events);
    expect(room.roomView()).toEqual(view);
  });

  it("replays set-ready receipts and conflicts without state changes", async () => {
    const { room, alice } = await createHarness("ready-dedupe");
    submitDeck(room, alice, "alice-deck");
    setReady(room, alice, "alice-ready", true);
    const first = receipt(alice, "alice-ready");
    const version = room.currentRoomVersion;
    const eventSeq = room.currentRoomEventSeq;
    const events = room.roomEvents();
    const view = room.roomView();

    setReady(room, alice, "alice-ready", true, version + 9);
    expect(receipt(alice, "alice-ready")).toMatchObject({
      ok: true,
      roomVersion: first.roomVersion,
      roomEventSeq: first.roomEventSeq,
      duplicate: true
    });
    expect(room.currentRoomVersion).toBe(version);
    expect(room.currentRoomEventSeq).toBe(eventSeq);
    expect(room.roomEvents()).toEqual(events);
    expect(room.roomView()).toEqual(view);

    const conflict = captureError(() =>
      setReady(room, alice, "alice-ready", false)
    );
    expect(conflict.code).toBe("idempotency-conflict");
    expect(room.currentRoomVersion).toBe(version);
    expect(room.roomEvents()).toEqual(events);
    expect(room.roomView()).toEqual(view);
  });

  it("includes the auto-start version in the first receipt and replays after restore", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("archive-replay", FOUNDATION_RULESET_ID, runtime);
    const alice = joinSeat(room, "Alice", "alice-1");
    const bob = joinSeat(room, "Bob", "bob-1");

    submitDeck(room, alice, "alice-deck");
    submitDeck(room, bob, "bob-deck");
    setReady(room, alice, "alice-ready", true);
    setReady(room, bob, "bob-ready", true);

    const startedVersion = room.currentRoomVersion;
    const startedEventSeq = room.currentRoomEventSeq;
    const readyReceipt = receipt(bob, "bob-ready");
    expect(room.status).toBe("playing");
    expect(readyReceipt).toMatchObject({
      ok: true,
      roomVersion: startedVersion,
      roomEventSeq: startedEventSeq,
      duplicate: false
    });

    const archive = room.exportArchive();
    const restored = GameRoom.restore(archive, runtime);
    const restoredBobCapture = captureTransport();
    restored.reconnect(
      bob.connection.resumeToken,
      restoredBobCapture.transport,
      "restored-bob"
    );

    restored.setReady(
      bob.session,
      "restored-bob",
      restored.currentRoomVersion + 11,
      true,
      "bob-ready",
      restoredBobCapture.transport
    );

    const replay = [...restoredBobCapture.messages].reverse().find(message =>
      message.type === "request-result" && message.requestId === "bob-ready"
    );
    expect(replay).toMatchObject({
      ok: true,
      roomVersion: readyReceipt.roomVersion,
      roomEventSeq: readyReceipt.roomEventSeq,
      duplicate: true
    });
  });

  it("keeps processed room requests across archive restore and accepts old archives", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("archive-compat", FOUNDATION_RULESET_ID, runtime);
    const alice = joinSeat(room, "Alice", "alice-1");
    submitDeck(room, alice, "alice-deck");
    const original = receipt(alice, "alice-deck");
    const archive = room.exportArchive();
    const restored = GameRoom.restore(archive, runtime);
    restored.reconnect(
      alice.connection.resumeToken,
      alice.transport,
      "restored-alice"
    );

    restored.submitDeck(
      alice.session,
      "restored-alice",
      restored.currentRoomVersion + 5,
      deck,
      "alice-deck",
      alice.transport
    );
    expect(receipt(alice, "alice-deck")).toMatchObject({
      ok: true,
      roomVersion: original.roomVersion,
      roomEventSeq: original.roomEventSeq,
      duplicate: true
    });

    const legacyArchive = structuredClone(archive);
    Reflect.deleteProperty(legacyArchive, "processedRoomRequests");
    expect(() => GameRoom.restore(legacyArchive, runtime)).not.toThrow();
  });

  it("rejects corrupted archives without installing partial room state", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    for (const archive of [null, [], "archive", 17]) {
      expect(() => GameRoom.restore(archive, runtime))
        .toThrow("Invalid server room archive");
    }
  });

  it("rejects duplicate processed room request keys in archives", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("duplicate-room-request", FOUNDATION_RULESET_ID, runtime);
    const alice = joinSeat(room, "Alice", "alice-1");
    submitDeck(room, alice, "alice-deck");
    const archive = room.exportArchive();

    const duplicate = structuredClone(archive);
    duplicate.processedRoomRequests = [
      ...duplicate.processedRoomRequests ?? [],
      duplicate.processedRoomRequests?.[0]
    ];
    expect(() => GameRoom.restore(duplicate, runtime))
      .toThrow("Room archive contains an invalid processed room request");
  });

  it("rejects malformed processed room requests in archives", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("malformed-room-request", FOUNDATION_RULESET_ID, runtime);
    const alice = joinSeat(room, "Alice", "alice-1");
    submitDeck(room, alice, "alice-deck");
    const archive = room.exportArchive();

    for (const request of [null, 17, {
      requestId: "alice-deck",
      playerId: "player-1",
      payloadHash: "hash",
      roomVersion: 1,
      roomEventSeq: "1"
    }]) {
      const broken = structuredClone(archive);
      broken.processedRoomRequests = [
        ...(broken.processedRoomRequests ?? []).slice(1),
        request
      ];
      expect(() => GameRoom.restore(broken, runtime))
        .toThrow("Room archive contains an invalid processed room request");
    }
  });

  it("rejects duplicate and malformed processed commands in archives", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("malformed-command", FOUNDATION_RULESET_ID, runtime);
    joinSeat(room, "Alice", "alice-1");
    const archive = room.exportArchive();
    const validCommand = {
      commandId: "command-1",
      playerId: "player-1",
      payloadHash: "hash",
      appliedVersion: 1,
      eventSeq: 1
    };

    const duplicate = structuredClone(archive);
    duplicate.processedCommands = [validCommand, validCommand];
    expect(() => GameRoom.restore(duplicate, runtime))
      .toThrow("Room archive contains an invalid processed command");

    for (const command of [null, 17, {
      commandId: "command-1",
      playerId: "unknown-player",
      payloadHash: "hash",
      appliedVersion: 1,
      eventSeq: 1
    }]) {
      const broken = structuredClone(archive);
      broken.processedCommands = [command];
      expect(() => GameRoom.restore(broken, runtime))
        .toThrow("Room archive contains an invalid processed command");
    }
  });

  it("rejects corrupted nested archive state without a raw type error", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("corrupt-state", FOUNDATION_RULESET_ID, runtime);
    const alice = joinSeat(room, "Alice", "alice-1");
    const bob = joinSeat(room, "Bob", "bob-1");
    submitDeck(room, alice, "alice-deck");
    submitDeck(room, bob, "bob-deck");
    setReady(room, alice, "alice-ready", true);
    setReady(room, bob, "bob-ready", true);
    const archive = room.exportArchive();

    const nullPlayer = structuredClone(archive);
    (nullPlayer.state as unknown as { players: unknown[] }).players[0] = null;
    expect(() => GameRoom.restore(nullPlayer, runtime))
      .toThrow("Room archive state does not match its seats or rules");

    const missingRules = structuredClone(archive);
    Reflect.deleteProperty(
      missingRules.state as unknown as Record<string, unknown>,
      "rules"
    );
    expect(() => GameRoom.restore(missingRules, runtime))
      .toThrow("Room archive state does not match its seats or rules");
  });

  it("rejects archives whose seats are out of order or use the wrong first seat", async () => {
    const runtime = await loadCardCatalogRuntime({
      catalog: rawCatalog,
      deckRules
    });
    const room = new GameRoom("seat-order", FOUNDATION_RULESET_ID, runtime);
    joinSeat(room, "Alice", "alice-1");
    joinSeat(room, "Bob", "bob-1");
    const archive = room.exportArchive();

    const reversed = structuredClone(archive);
    reversed.seats = [reversed.seats[1], reversed.seats[0]];
    expect(() => GameRoom.restore(reversed, runtime))
      .toThrow("Invalid server room archive");

    const wrongSingleSeat = structuredClone(archive);
    wrongSingleSeat.seats = [wrongSingleSeat.seats[1]];
    expect(() => GameRoom.restore(wrongSingleSeat, runtime))
      .toThrow("Invalid server room archive");
  });

  it("validates resume cursors before reconnect installs a socket", async () => {
    const { room, alice, bob } = await createHarness("resume-cursors");
    const connectionsBefore = snapshotConnections(room);

    const invalidToken = captureError(() =>
      room.validateResumeCursors(`${alice.connection.resumeToken}x`, 0, 0)
    );
    expect(invalidToken.code).toBe("invalid-token");
    expect(snapshotConnections(room)).toEqual(connectionsBefore);

    const invalidGameCursor = captureError(() =>
      room.validateResumeCursors(alice.connection.resumeToken, -1, 0)
    );
    expect(invalidGameCursor.code).toBe("command-rejected");
    expect(snapshotConnections(room)).toEqual(connectionsBefore);

    const noGameCursor = captureError(() =>
      room.validateResumeCursors(alice.connection.resumeToken, 0)
    );
    expect(noGameCursor.code).toBe("command-rejected");
    expect(snapshotConnections(room)).toEqual(connectionsBefore);

    const aheadRoomCursor = captureError(() =>
      room.validateResumeCursors(
        alice.connection.resumeToken,
        undefined,
        room.currentRoomEventSeq + 1
      )
    );
    expect(aheadRoomCursor.code).toBe("command-rejected");
    expect(snapshotConnections(room)).toEqual(connectionsBefore);

    expect(() =>
      room.validateResumeCursors(
        bob.connection.resumeToken,
        undefined,
        room.currentRoomEventSeq
      )
    ).not.toThrow();
    expect(snapshotConnections(room)).toEqual(connectionsBefore);
  });

  it("accepts exact started-game cursors and rejects ahead-of-log cursors", async () => {
    const { room, alice, bob } = await createHarness("started-cursors");
    submitDeck(room, alice, "alice-deck");
    submitDeck(room, bob, "bob-deck");
    setReady(room, alice, "alice-ready", true);
    setReady(room, bob, "bob-ready", true);
    const connectionsBefore = snapshotConnections(room);

    expect(() =>
      room.validateResumeCursors(
        alice.connection.resumeToken,
        0,
        room.currentRoomEventSeq
      )
    ).not.toThrow();

    const aheadGameCursor = captureError(() =>
      room.validateResumeCursors(
        alice.connection.resumeToken,
        Number.MAX_SAFE_INTEGER,
        undefined
      )
    );
    expect(aheadGameCursor.code).toBe("command-rejected");
    expect(snapshotConnections(room)).toEqual(connectionsBefore);

    const aheadRoomCursor = captureError(() =>
      room.validateResumeCursors(
        bob.connection.resumeToken,
        0,
        room.currentRoomEventSeq + 1
      )
    );
    expect(aheadRoomCursor.code).toBe("command-rejected");
    expect(snapshotConnections(room)).toEqual(connectionsBefore);
  });
});
