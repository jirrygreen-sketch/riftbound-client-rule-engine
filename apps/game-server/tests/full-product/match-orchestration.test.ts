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
} from "../../src/card-catalog.js";
import { GameRoom, RoomError } from "../../src/room.js";

const rawCatalog = {
  schemaVersion: 1,
  dataVersion: "full-product-orchestration-fixture",
  digest: `sha256:${"d".repeat(64)}`,
  cards: [
    rawCard("fixture.basic-unit", "Basic Unit", "Unit", 1, ""),
    rawCard("fixture.extra-unit-1", "Extra Unit 1", "Unit", 1, ""),
    rawCard("fixture.extra-unit-2", "Extra Unit 2", "Unit", 1, ""),
    rawCard("fixture.extra-unit-3", "Extra Unit 3", "Unit", 1, ""),
    rawCard("fixture.text-unit", "Text Unit", "Unit", 1, "Text ability."),
    rawCard("fixture.gear", "Basic Gear", "Gear", 1, ""),
    rawCard("fixture.champion", "Fixture Champion", "Unit", 1, "", ["Champion", "Fixturechamp"], ["Fury"]),
    rawCard("fixture.legend", "Fixture Legend", "Legend", 1, "", ["Fixturechamp"], ["Fury"]),
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

const legalDeck: RoomDeckSubmission = {
  mainDeck: [
    { cardId: "fixture.basic-unit", quantity: 1 },
    { cardId: "fixture.extra-unit-1", quantity: 1 },
    { cardId: "fixture.extra-unit-2", quantity: 1 },
    { cardId: "fixture.extra-unit-3", quantity: 1 },
    { cardId: "fixture.text-unit", quantity: 1 },
    { cardId: "fixture.gear", quantity: 1 }
  ],
  champion: [{ cardId: "fixture.champion", quantity: 1 }],
  legend: [{ cardId: "fixture.legend", quantity: 1 }],
  runes: [{ cardId: "fixture.rune", quantity: 1 }],
  battlefields: [{ cardId: "fixture.battlefield", quantity: 1 }]
};

interface Seat {
  readonly messages: ServerToClientMessage[];
  readonly transport: ServerTransport;
  readonly playerId: "player-1" | "player-2";
  readonly resumeToken: string;
  readonly connectionId: string;
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

function joinSeat(room: GameRoom, name: string, connectionId: string): Seat {
  const capture = captureTransport();
  const connection = room.join(name, capture.transport, connectionId);
  return {
    messages: capture.messages,
    transport: capture.transport,
    playerId: connection.playerId as Seat["playerId"],
    resumeToken: connection.resumeToken,
    connectionId: connection.connectionId
  };
}

function resumeSeat(room: GameRoom, seat: Seat, connectionId: string): Seat {
  const capture = captureTransport();
  const connection = room.reconnect(
    seat.resumeToken,
    capture.transport,
    connectionId
  );
  if (!connection) throw new Error("The resume token was rejected");
  return {
    messages: capture.messages,
    transport: capture.transport,
    playerId: connection.playerId as Seat["playerId"],
    resumeToken: connection.resumeToken,
    connectionId: connection.connectionId
  };
}

function sessionFor(room: GameRoom, seat: Seat): ClientSession {
  return {
    roomId: room.roomId,
    playerId: seat.playerId,
    resumeToken: seat.resumeToken
  };
}

function roomError(operation: () => void): RoomError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RoomError);
    return error as RoomError;
  }
  throw new Error("Expected the operation to fail");
}

function submitDeck(
  room: GameRoom,
  seat: Seat,
  deck: RoomDeckSubmission = legalDeck,
  expectedRoomVersion: number = room.currentRoomVersion
): void {
  room.submitDeck(
    sessionFor(room, seat),
    seat.connectionId,
    expectedRoomVersion,
    deck,
    `${seat.playerId}-deck-${room.currentRoomEventSeq}`,
    seat.transport
  );
}

function setReady(
  room: GameRoom,
  seat: Seat,
  ready: boolean,
  expectedRoomVersion: number = room.currentRoomVersion
): void {
  room.setReady(
    sessionFor(room, seat),
    seat.connectionId,
    expectedRoomVersion,
    ready,
    `${seat.playerId}-ready-${room.currentRoomEventSeq}`,
    seat.transport
  );
}

async function createHarness(roomId: string): Promise<{
  room: GameRoom;
  alice: Seat;
  bob: Seat;
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

function receipt(seat: Seat, requestId: string) {
  return seat.messages.find(message =>
    message.type === "request-result" && message.requestId === requestId
  );
}

function countEvents(room: GameRoom, type: ServerToClientMessage["type"] | string): number {
  return room.roomEvents().filter(event => event.type === type).length;
}

describe("full product match orchestration", () => {
  it("creates, joins, validates decks, and waits for both players before starting", async () => {
    const { room, alice, bob } = await createHarness("lifecycle");

    expect(room.roomId).toBe("lifecycle");
    expect(room.playerCount).toBe(2);
    expect(room.status).toBe("waiting");
    expect(room.roomView().players).toEqual([
      expect.objectContaining({
        id: "player-1",
        name: "Alice",
        connected: true,
        ready: false,
        deckSubmitted: false
      }),
      expect.objectContaining({
        id: "player-2",
        name: "Bob",
        connected: true,
        ready: false,
        deckSubmitted: false
      })
    ]);
    expect(room.roomEvents().map(event => event.type)).toEqual([
      "room-created",
      "player-joined",
      "player-joined"
    ]);

    const beforeInvalidDeck = room.roomView();
    const invalidDeck = roomError(() => submitDeck(room, alice, {
      mainDeck: [{ cardId: "fixture.missing", quantity: 1 }]
    }));
    expect(invalidDeck.code).toBe("invalid-deck");
    expect(room.roomView()).toEqual(beforeInvalidDeck);

    submitDeck(room, alice);
    expect(room.roomView().players[0]).toMatchObject({
      deckSubmitted: true,
      ready: false
    });
    expect(room.status).toBe("waiting");

    expect(roomError(() => setReady(room, bob, true)).code)
      .toBe("invalid-deck");
    expect(room.status).toBe("waiting");
    expect(room.roomView().players[1]).toMatchObject({
      deckSubmitted: false,
      ready: false
    });

    const beforeDeckReset = room.currentRoomVersion;
    submitDeck(room, bob);
    expect(room.currentRoomVersion).toBeGreaterThan(beforeDeckReset);
    expect(room.roomView().players[1]).toMatchObject({
      deckSubmitted: true,
      ready: false
    });

    setReady(room, alice, true);
    expect(room.status).toBe("waiting");
    setReady(room, bob, true);

    expect(room.status).toBe("playing");
    expect(countEvents(room, "game-started")).toBe(1);
    expect(room.roomEvents().at(-1)?.type).toBe("game-started");
    const aliceProjection = room.projectionFor("player-1");
    const bobProjection = room.projectionFor("player-2");
    expect(aliceProjection?.rulesetId).toBe(FOUNDATION_RULESET_ID);
    expect(aliceProjection?.version).toBe(bobProjection?.version);
    expect(aliceProjection?.eventSeq).toBe(bobProjection?.eventSeq);
  });

  it("rejects stale room commands and post-start mutations without changing state", async () => {
    const { room, alice, bob } = await createHarness("versioning");
    submitDeck(room, alice);
    submitDeck(room, bob);

    const beforeStale = room.roomView();
    expect(roomError(() =>
      setReady(room, alice, true, room.currentRoomVersion + 1)
    ).code).toBe("stale-version");
    expect(room.roomView()).toEqual(beforeStale);

    setReady(room, alice, true);
    setReady(room, bob, true);
    expect(room.status).toBe("playing");
    const playingView = room.roomView();
    const playingVersion = room.currentRoomVersion;
    const playingEventSeq = room.currentRoomEventSeq;

    expect(roomError(() =>
      submitDeck(room, alice, legalDeck, room.currentRoomVersion)
    ).code).toBe("command-rejected");
    expect(roomError(() =>
      setReady(room, bob, false, room.currentRoomVersion)
    ).code).toBe("command-rejected");
    expect(roomError(() => room.start()).code).toBe("command-rejected");
    expect(room.roomView()).toEqual(playingView);
    expect(room.currentRoomVersion).toBe(playingVersion);
    expect(room.currentRoomEventSeq).toBe(playingEventSeq);
  });

  it("validates command versions and idempotency without replaying duplicate effects", async () => {
    const { room, alice, bob } = await createHarness("commands");
    submitDeck(room, alice);
    submitDeck(room, bob);
    setReady(room, alice, true);
    setReady(room, bob, true);

    const initial = room.projectionFor("player-1");
    expect(initial?.activePlayerId).toBe("player-1");
    const before = room.projectionFor("player-1");

    const stale = roomError(() => room.submit(
      sessionFor(room, alice),
      alice.connectionId,
      { type: "pass" },
      "alice-pass",
      before.version + 1,
      "stale-pass",
      alice.transport
    ));
    expect(stale.code).toBe("stale-version");

    room.submit(
      sessionFor(room, alice),
      alice.connectionId,
      { type: "pass" },
      "alice-pass",
      before.version,
      "first-pass",
      alice.transport
    );
    const first = receipt(alice, "first-pass");
    expect(first).toMatchObject({
      ok: true,
      commandId: "alice-pass",
      duplicate: false
    });
    const afterFirst = room.projectionFor("player-1");
    expect(afterFirst?.version).toBeGreaterThan(before.version);
    expect(afterFirst?.activePlayerId).toBe("player-2");
    expect(afterFirst?.turnNumber).toBe(before.turnNumber + 1);

    room.submit(
      sessionFor(room, alice),
      alice.connectionId,
      { type: "pass" },
      "alice-pass",
      before.version,
      "duplicate-pass",
      alice.transport
    );
    const duplicate = receipt(alice, "duplicate-pass");
    expect(duplicate).toMatchObject({
      ok: true,
      commandId: "alice-pass",
      appliedVersion: first?.appliedVersion,
      eventSeq: first?.eventSeq,
      duplicate: true
    });
    expect(room.projectionFor("player-1")).toEqual(afterFirst);

    expect(roomError(() => room.submit(
      sessionFor(room, alice),
      alice.connectionId,
      { type: "play-card", instanceId: "player-1:mainDeck:0:1" },
      "alice-pass",
      afterFirst.version,
      "conflict-pass",
      alice.transport
    )).code).toBe("idempotency-conflict");

    expect(roomError(() => room.submit(
      sessionFor(room, alice),
      alice.connectionId,
      { type: "pass" },
      "alice-not-active",
      afterFirst.version,
      "alice-not-active",
      alice.transport
    )).code).toBe("not_your_turn");

    room.submit(
      sessionFor(room, bob),
      bob.connectionId,
      { type: "pass" },
      "bob-pass",
      afterFirst.version,
      "bob-pass-request",
      bob.transport
    );
    expect(room.projectionFor("player-1")?.activePlayerId).toBe("player-1");
  });

  it("resumes the current connection and replays public state without leaking private hands", async () => {
    const { room, alice, bob } = await createHarness("reconnect");
    submitDeck(room, alice);
    submitDeck(room, bob);
    setReady(room, alice, true);
    setReady(room, bob, true);
    const started = room.projectionFor("player-1");
    if (!started) throw new Error("The match did not start");

    room.submit(
      sessionFor(room, alice),
      alice.connectionId,
      { type: "pass" },
      "alice-pass",
      started.version,
      "alice-pass",
      alice.transport
    );
    const afterAlicePass = room.projectionFor("player-1");
    if (!afterAlicePass) throw new Error("The pass projection is missing");
    expect(room.disconnect(alice.playerId, alice.connectionId)).toBe(true);
    expect(room.connectedPlayerCount).toBe(1);

    room.submit(
      sessionFor(room, bob),
      bob.connectionId,
      { type: "pass" },
      "bob-offline-pass",
      afterAlicePass.version,
      "bob-offline-pass",
      bob.transport
    );
    const afterPass = room.projectionFor("player-1");
    if (!afterPass) throw new Error("The offline pass projection is missing");
    expect(afterPass.activePlayerId).toBe(alice.playerId);

    const offlineEventSeq = room.currentRoomEventSeq;
    const replacement = resumeSeat(room, alice, "alice-2");
    expect(room.connectedPlayerCount).toBe(2);
    expect(room.projectionFor(alice.playerId)).toEqual(afterPass);
    expect(room.disconnect(alice.playerId, alice.connectionId)).toBe(false);
    expect(room.currentRoomEventSeq).toBe(offlineEventSeq + 1);

    room.sendEvents(
      sessionFor(room, replacement),
      replacement.connectionId,
      started.eventSeq
    );
    const replay = replacement.messages.find(message =>
      message.type === "events" && message.afterEventSeq === started.eventSeq
    );
    expect(replay).toMatchObject({
      nextEventSeq: afterPass.eventSeq,
      version: afterPass.version
    });
    expect(replay?.events.filter(event => event.type === "turn-passed"))
      .toHaveLength(2);

    room.sendRoomEvents(
      sessionFor(room, replacement),
      replacement.connectionId,
      0
    );
    const roomReplay = replacement.messages.find(message =>
      message.type === "room-events"
    );
    const reconnectEvent = roomReplay?.events.find(event =>
      event.type === "player-reconnected" && event.playerId === alice.playerId
    );
    expect(reconnectEvent).toBeDefined();
    expect(roomReplay?.events.some(event =>
      event.type === "player-disconnected" && event.playerId === alice.playerId
    )).toBe(true);

    room.submit(
      sessionFor(room, replacement),
      replacement.connectionId,
      { type: "pass" },
      "alice-reconnected-pass",
      afterPass.version,
      "reconnected-pass",
      replacement.transport
    );
    expect(roomError(() => room.submit(
      sessionFor(room, alice),
      alice.connectionId,
      { type: "pass" },
      "old-socket-pass",
      room.projectionFor(alice.playerId)?.version ?? 0,
      "old-socket-pass",
      alice.transport
    )).code).toBe("session-replaced");

    const viewer = room.projectionFor(alice.playerId);
    const opponent = viewer?.players.find(player => player.id === bob.playerId);
    const own = viewer?.players.find(player => player.id === alice.playerId);
    expect(opponent?.hand).toEqual([]);
    expect(opponent?.handCount).toBeGreaterThan(0);
    expect(own?.hand.length).toBe(own?.handCount);
    expect(
      viewer?.objects?.filter(object => object.zone === "hand")
    ).toEqual(own?.hand.map(card => expect.objectContaining({
      objectId: card.instanceId,
      ownerPlayerId: alice.playerId
    })) ?? []);
  });
});

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
    power: cardType === "Unit" ? 1 : null,
    might: null,
    ability
  };
}
