import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDATION_RULESET_ID,
  PROTOCOL_VERSION,
  type ClientSession,
  type ClientToServerMessage,
  type GameProjection,
  type PlayerCommand,
  type RoomDeckSubmission,
  type RoomView,
  type ServerToClientMessage
} from "@riftbound/protocol";
import type { GameServer } from "@riftbound/game-server-src";
import { ProtocolWebSocketClient } from "../../src/test-support/websocket-client.js";
import {
  startCatalogServer,
  type FixtureCatalogCard
} from "../../src/test-support/card-catalog-fixture.js";

type RequestMessage = Extract<ClientToServerMessage, { requestId: string }>;
type CommandMessage = Extract<ClientToServerMessage, { type: "command" }>;
type Receipt = Extract<ServerToClientMessage, { type: "request-result" }>;
type ServerError = Extract<ServerToClientMessage, { type: "error" }>;

const clients: ProtocolWebSocketClient[] = [];
const servers: GameServer[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
});

function emptyUnit(
  id: string,
  name: string,
  cardNumber: string
): FixtureCatalogCard {
  return {
    id,
    canonicalCardId: id,
    name,
    fullName: name,
    cardType: "Unit",
    domains: [],
    tags: [],
    setCode: "ogs",
    cardNumber,
    variant: "standard",
    imageUrl: null,
    energy: 1,
    power: 1,
    might: null,
    ability: ""
  };
}

const effectFreeCatalog = {
  schemaVersion: 1,
  dataVersion: "full-product-two-client-foundation",
  digest: `sha256:${"e".repeat(64)}`,
  cards: [
    emptyUnit("fixture.empty-unit-a", "Empty Unit A", "001"),
    emptyUnit("fixture.empty-unit-b", "Empty Unit B", "002")
  ]
} as const;

const legalDeck = (): RoomDeckSubmission => ({
  mainDeck: [
    { cardId: "fixture.empty-unit-a", quantity: 3 },
    { cardId: "fixture.empty-unit-b", quantity: 3 }
  ]
});

async function startFoundationServer(): Promise<string> {
  let roomNumber = 0;
  const started = await startCatalogServer({
    catalog: effectFreeCatalog,
    deckRules: { defaultMaxCopiesPerCanonical: 3 },
    roomIdFactory: () => `full-product-${++roomNumber}`
  });
  servers.push(started.server);
  return `ws://127.0.0.1:${new URL(started.baseUrl).port}/ws`;
}

async function connect(url: string): Promise<ProtocolWebSocketClient> {
  const client = await ProtocolWebSocketClient.connect(url);
  clients.push(client);
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.resumed !== true,
    "initial handshake"
  );
  return client;
}

async function resume(
  url: string,
  session: ClientSession,
  cursors?: { afterEventSeq?: number; afterRoomEventSeq?: number }
): Promise<ProtocolWebSocketClient> {
  const client = await ProtocolWebSocketClient.connect(url);
  clients.push(client);
  client.send({
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    roomId: session.roomId,
    resumeToken: session.resumeToken,
    ...(cursors?.afterEventSeq === undefined
      ? {}
      : { afterEventSeq: cursors.afterEventSeq }),
    ...(cursors?.afterRoomEventSeq === undefined
      ? {}
      : { afterRoomEventSeq: cursors.afterRoomEventSeq })
  });
  return client;
}

async function createRoom(
  client: ProtocolWebSocketClient,
  suffix: string
): Promise<ClientSession> {
  client.send({
    type: "create-room",
    requestId: `create-${suffix}`,
    playerName: "Alice",
    rulesetId: FOUNDATION_RULESET_ID
  });
  const receipt = await requestReceipt(client, `create-${suffix}`, "create-room");
  expect(receipt.ok).toBe(true);
  return await sessionFromWelcome(client, "create-room welcome");
}

async function joinRoom(
  client: ProtocolWebSocketClient,
  roomId: string,
  suffix: string
): Promise<ClientSession> {
  client.send({
    type: "join-room",
    requestId: `join-${suffix}`,
    roomId,
    playerName: "Bob"
  });
  const receipt = await requestReceipt(client, `join-${suffix}`, "join-room");
  expect(receipt.ok).toBe(true);
  return await sessionFromWelcome(client, "join-room welcome");
}

async function sessionFromWelcome(
  client: ProtocolWebSocketClient,
  label: string
): Promise<ClientSession> {
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    label
  );
  if (!welcome.session) throw new Error("Welcome omitted its session.");
  return welcome.session;
}

async function requestReceipt(
  client: ProtocolWebSocketClient,
  requestId: string,
  label: string
): Promise<Receipt> {
  return await client.waitFor(
    "request-result",
    message => message.requestId === requestId,
    `${label} receipt`
  );
}

async function requestError(
  client: ProtocolWebSocketClient,
  requestId: string,
  label: string
): Promise<ServerError> {
  return await client.waitFor(
    "error",
    message => message.requestId === requestId,
    `${label} error`
  );
}

function sendRequest(
  client: ProtocolWebSocketClient,
  message: RequestMessage,
  label: string
): Promise<Receipt> {
  client.send(message);
  return requestReceipt(client, message.requestId, label);
}

function sendFailingRequest(
  client: ProtocolWebSocketClient,
  message: RequestMessage,
  label: string
): Promise<ServerError> {
  client.send(message);
  return requestError(client, message.requestId, label);
}

function commandMessage(
  requestId: string,
  commandId: string,
  expectedVersion: number,
  payload: PlayerCommand
): CommandMessage {
  return {
    type: "command",
    requestId,
    commandId,
    expectedVersion,
    command: payload
  };
}

async function waitForRoom(
  client: ProtocolWebSocketClient,
  predicate: (room: RoomView) => boolean,
  label: string
): Promise<RoomView> {
  const message = await client.waitFor(
    "room",
    item => item.type === "room" && predicate(item.room),
    label
  );
  return message.room;
}

async function waitForProjection(
  client: ProtocolWebSocketClient,
  predicate: (projection: GameProjection) => boolean,
  label: string
): Promise<GameProjection> {
  const message = await client.waitFor(
    "projection",
    item => item.type === "projection" && predicate(item.projection),
    label
  );
  return message.projection;
}

function requiredVersion(version: number | undefined, label: string): number {
  if (version === undefined) {
    throw new Error(`${label} omitted its version.`);
  }
  return version;
}

function expectSequentialSeq(
  events: readonly { seq: number }[],
  after: number,
  next: number
): void {
  expect(events.map(event => event.seq)).toEqual(
    Array.from({ length: events.length }, (_, index) => after + index + 1)
  );
  expect(next).toBe(after + events.length);
}

async function startFoundationGame(
  alice: ProtocolWebSocketClient,
  bob: ProtocolWebSocketClient,
  suffix: string
): Promise<{
  aliceSession: ClientSession;
  bobSession: ClientSession;
  room: RoomView;
  aliceProjection: GameProjection;
  bobProjection: GameProjection;
}> {
  const aliceSession = await createRoom(alice, suffix);
  const bobSession = await joinRoom(bob, aliceSession.roomId, suffix);
  const joinedRoom = await waitForRoom(
    bob,
    room => room.players.length === 2,
    `${suffix} joined room`
  );

  const aliceDeck = await sendRequest(alice, {
    type: "submit-deck",
    requestId: `${suffix}-alice-deck`,
    expectedRoomVersion: joinedRoom.roomVersion,
    deck: legalDeck()
  }, `${suffix} Alice deck`);
  const aliceDeckVersion = requiredVersion(
    aliceDeck.roomVersion,
    `${suffix} Alice deck receipt`
  );

  const bobDeck = await sendRequest(bob, {
    type: "submit-deck",
    requestId: `${suffix}-bob-deck`,
    expectedRoomVersion: aliceDeckVersion,
    deck: legalDeck()
  }, `${suffix} Bob deck`);
  const bobDeckVersion = requiredVersion(
    bobDeck.roomVersion,
    `${suffix} Bob deck receipt`
  );

  const aliceReady = await sendRequest(alice, {
    type: "set-ready",
    requestId: `${suffix}-alice-ready`,
    expectedRoomVersion: bobDeckVersion,
    ready: true
  }, `${suffix} Alice ready`);
  const aliceReadyVersion = requiredVersion(
    aliceReady.roomVersion,
    `${suffix} Alice ready receipt`
  );

  await sendRequest(bob, {
    type: "set-ready",
    requestId: `${suffix}-bob-ready`,
    expectedRoomVersion: aliceReadyVersion,
    ready: true
  }, `${suffix} Bob ready`);

  const room = await waitForRoom(
    alice,
    item => item.status === "playing" && item.players.every(player =>
      player.ready && player.deckSubmitted
    ),
    `${suffix} playing room`
  );
  const aliceProjection = await waitForProjection(
    alice,
    projection => projection.players.length === 2,
    `${suffix} Alice projection`
  );
  const bobProjection = await waitForProjection(
    bob,
    projection => projection.players.length === 2,
    `${suffix} Bob projection`
  );

  return {
    aliceSession,
    bobSession,
    room,
    aliceProjection,
    bobProjection
  };
}

describe("two-client riftbound-foundation vertical slice", () => {
  it("plays a real multi-turn game with private projections, reconnect replay, and command idempotency", async () => {
    const url = await startFoundationServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const started = await startFoundationGame(alice, bob, "flow");
    const aliceId = started.aliceSession.playerId;
    const bobId = started.bobSession.playerId;
    const initial = started.aliceProjection;

    expect(aliceId).toBe("player-1");
    expect(bobId).toBe("player-2");
    expect(initial.projectionSchema).toBe("riftbound.projection.v1");
    expect(initial.rulesetId).toBe(FOUNDATION_RULESET_ID);
    expect(initial.activePlayerId).toBe(aliceId);
    expect(initial.events.some(event => event.type === "game-started")).toBe(true);
    expect(initial.events.some(event =>
      event.type === "turn-started" && event.playerId === aliceId && event.energy === 0
    )).toBe(true);

    const aliceSelf = initial.players.find(player => player.id === aliceId);
    const bobSelf = started.bobProjection.players.find(player => player.id === bobId);
    const bobViewOfAlice = started.bobProjection.players.find(
      player => player.id === aliceId
    );
    const aliceViewOfBob = initial.players.find(player => player.id === bobId);
    if (!aliceSelf || !bobSelf || !bobViewOfAlice || !aliceViewOfBob) {
      throw new Error("Both Foundation projections must contain both players.");
    }

    expect(aliceSelf.hand).toHaveLength(4);
    expect(aliceSelf.handCount).toBe(4);
    expect(aliceSelf.energy).toBe(0);
    expect(aliceSelf.playableInstanceIds).toEqual([]);
    expect(aliceViewOfBob.hand).toEqual([]);
    expect(aliceViewOfBob.handCount).toBe(4);
    expect(bobSelf.hand).toHaveLength(4);
    expect(bobViewOfAlice.hand).toEqual([]);
    expect(bobViewOfAlice.handCount).toBe(4);

    const aliceHandIds = new Set(aliceSelf.hand.map(card => card.instanceId));
    const aliceObjects = initial.objects ?? [];
    const bobObjects = started.bobProjection.objects ?? [];
    expect(aliceObjects.filter(object =>
      object.zone === "hand" && object.ownerPlayerId === aliceId
    ).map(object => object.objectId)).toEqual(expect.arrayContaining([...aliceHandIds]));
    expect(bobObjects.some(object =>
      object.zone === "hand" && object.ownerPlayerId === aliceId
    )).toBe(false);
    for (const objects of [aliceObjects, bobObjects]) {
      const zones = new Set(objects.map(object => object.zone));
      expect(zones.has("deck")).toBe(false);
      expect(zones.has("rune-deck")).toBe(false);
    }

    const notYourTurn = await sendFailingRequest(
      bob,
      commandMessage("bob-too-early", "bob-too-early", initial.version, { type: "pass" }),
      "Bob command before his turn"
    );
    expect(notYourTurn.code).toBe("not_your_turn");

    const alicePass = await sendRequest(
      alice,
      commandMessage("alice-pass", "alice-pass", initial.version, { type: "pass" }),
      "Alice first pass"
    );
    const alicePassVersion = requiredVersion(
      alicePass.appliedVersion,
      "Alice first pass"
    );
    const alicePassEventSeq = requiredVersion(
      alicePass.eventSeq,
      "Alice first pass"
    );
    expect(alicePassVersion).toBeGreaterThan(initial.version);
    expect(alicePassEventSeq).toBeGreaterThan(initial.eventSeq);
    expect(alicePass.duplicate).toBe(false);

    const bobPass = await sendRequest(
      bob,
      commandMessage("bob-pass", "bob-pass", alicePassVersion, { type: "pass" }),
      "Bob pass while Alice is offline"
    );
    const bobPassVersion = requiredVersion(bobPass.appliedVersion, "Bob pass");
    const bobPassEventSeq = requiredVersion(bobPass.eventSeq, "Bob pass");
    expect(bobPassVersion).toBeGreaterThan(alicePassVersion);
    expect(bobPassEventSeq).toBeGreaterThan(alicePassEventSeq);
    expect(bobPass.duplicate).toBe(false);

    alice.close();
    await waitForRoom(
      bob,
      room => room.players.some(player =>
        player.id === aliceId && player.connected === false
      ),
      "Alice disconnect broadcast"
    );

    const resumedAlice = await resume(url, started.aliceSession);
    const resumedWelcome = await resumedAlice.waitFor(
      "welcome",
      message => message.type === "welcome" && message.resumed === true,
      "Alice resumed welcome"
    );
    expect(resumedWelcome.session).toEqual(started.aliceSession);

    const sync = await sendRequest(resumedAlice, {
      type: "sync-events",
      requestId: "alice-missed-events",
      afterEventSeq: alicePassEventSeq,
      afterRoomEventSeq: started.room.roomEventSeq
    }, "Alice explicit event sync");
    expect(sync.ok).toBe(true);

    const replayedGameEvents = await resumedAlice.waitFor(
      "events",
      message => message.type === "events" &&
        message.afterEventSeq === alicePassEventSeq,
      "Alice missed game events"
    );
    expect(replayedGameEvents.events.map(event => event.type)).toEqual([
      "turn-passed",
      "turn-started"
    ]);
    expect(replayedGameEvents.events[0]).toMatchObject({
      type: "turn-passed",
      playerId: bobId
    });
    expect(replayedGameEvents.events[1]).toMatchObject({
      type: "turn-started",
      playerId: aliceId,
      energy: 1
    });
    expectSequentialSeq(
      replayedGameEvents.events,
      alicePassEventSeq,
      replayedGameEvents.nextEventSeq
    );

    const replayedRoomEvents = await resumedAlice.waitFor(
      "room-events",
      message => message.type === "room-events" &&
        message.afterRoomEventSeq === started.room.roomEventSeq,
      "Alice missed room events"
    );
    expect(replayedRoomEvents.events.map(event => event.type)).toEqual([
      "player-disconnected",
      "player-reconnected"
    ]);
    expectSequentialSeq(
      replayedRoomEvents.events,
      started.room.roomEventSeq,
      replayedRoomEvents.nextRoomEventSeq
    );

    const staleCommand = await sendFailingRequest(
      resumedAlice,
      commandMessage(
        "alice-stale-version",
        "alice-stale-version",
        alicePassVersion,
        { type: "pass" }
      ),
      "Alice command with stale version"
    );
    expect(staleCommand.code).toBe("stale-version");

    const currentAliceProjection = await waitForProjection(
      resumedAlice,
      projection =>
        projection.version === bobPassVersion &&
        projection.activePlayerId === aliceId,
      "Alice post-reconnect projection"
    );
    const currentAlice = currentAliceProjection.players.find(
      player => player.id === aliceId
    );
    if (!currentAlice) throw new Error("Alice is missing from her projection.");
    expect(currentAlice.energy).toBe(1);
    expect(currentAlice.hand).toHaveLength(5);
    expect(currentAlice.handCount).toBe(5);
    const currentPlayableIds = currentAlice.playableInstanceIds;
    if (currentPlayableIds === undefined) {
      throw new Error("Foundation projection omitted Alice's playable card ids.");
    }
    expect(currentPlayableIds).toHaveLength(5);

    const playableInstanceId = currentPlayableIds[0];
    if (!playableInstanceId) {
      throw new Error("Foundation did not expose a playable card after two turns.");
    }

    const playPayload: PlayerCommand = {
      type: "play-card",
      instanceId: playableInstanceId
    };
    const play = await sendRequest(
      resumedAlice,
      commandMessage(
        "alice-play-card",
        "alice-play-card",
        bobPassVersion,
        playPayload
      ),
      "Alice real play-card"
    );
    const playVersion = requiredVersion(play.appliedVersion, "Alice play-card");
    const playEventSeq = requiredVersion(play.eventSeq, "Alice play-card");
    expect(playVersion).toBeGreaterThan(bobPassVersion);
    expect(playEventSeq).toBeGreaterThan(bobPassEventSeq);
    expect(play.duplicate).toBe(false);

    const aliceAfterPlay = await waitForProjection(
      resumedAlice,
      projection =>
        projection.version === playVersion &&
        (projection.objects ?? []).some(object =>
          object.objectId === playableInstanceId && object.zone === "board"
        ),
      "Alice projection after play-card"
    );
    const bobAfterPlay = await waitForProjection(
      bob,
      projection =>
        projection.version === playVersion &&
        (projection.objects ?? []).some(object =>
          object.objectId === playableInstanceId && object.zone === "board"
        ),
      "Bob public board after play-card"
    );
    const aliceAfterPlaySelf = aliceAfterPlay.players.find(
      player => player.id === aliceId
    );
    const bobAfterPlayViewOfAlice = bobAfterPlay.players.find(
      player => player.id === aliceId
    );
    if (!aliceAfterPlaySelf || !bobAfterPlayViewOfAlice) {
      throw new Error("Post-play projections must contain both players.");
    }
    expect(aliceAfterPlaySelf.hand).toHaveLength(4);
    expect(aliceAfterPlaySelf.handCount).toBe(4);
    expect(bobAfterPlayViewOfAlice.hand).toEqual([]);
    expect(bobAfterPlayViewOfAlice.handCount).toBe(4);
    expect((bobAfterPlay.objects ?? []).some(object =>
      object.zone === "hand" && object.ownerPlayerId === aliceId
    )).toBe(false);
    expect(bobAfterPlay.events.some(event =>
      event.type === "card-played" &&
      event.instanceId === playableInstanceId
    )).toBe(true);

    const duplicate = await sendRequest(
      resumedAlice,
      commandMessage(
        "alice-play-card-duplicate",
        "alice-play-card",
        playVersion,
        playPayload
      ),
      "Alice duplicate commandId"
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.appliedVersion).toBe(playVersion);
    expect(duplicate.eventSeq).toBe(playEventSeq);

    const idempotencyConflict = await sendFailingRequest(
      resumedAlice,
      commandMessage(
        "alice-play-card-conflict",
        "alice-play-card",
        playVersion,
        { type: "pass" }
      ),
      "Alice reused commandId with another payload"
    );
    expect(idempotencyConflict.code).toBe("idempotency-conflict");
  });

  it("replays a successful submit-deck request without adding room state", async () => {
    const url = await startFoundationServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceSession = await createRoom(alice, "request-idempotency");
    await joinRoom(bob, aliceSession.roomId, "request-idempotency");
    const room = await waitForRoom(
      bob,
      item => item.players.length === 2,
      "request-idempotency joined room"
    );

    const first = await sendRequest(alice, {
      type: "submit-deck",
      requestId: "same-submit-deck-request",
      expectedRoomVersion: room.roomVersion,
      deck: legalDeck()
    }, "first deck request");
    const firstRoomVersion = requiredVersion(first.roomVersion, "first deck request");

    const second = await sendRequest(alice, {
      type: "submit-deck",
      requestId: "same-submit-deck-request",
      expectedRoomVersion: room.roomVersion,
      deck: legalDeck()
    }, "repeated deck request");
    const secondRoomVersion = requiredVersion(second.roomVersion, "repeated deck request");
    expect(second.ok).toBe(true);
    expect(secondRoomVersion).toBe(firstRoomVersion);
    expect(second.roomEventSeq).toBe(first.roomEventSeq);
    expect(second.duplicate).toBe(true);

    const conflictingPayload = await sendFailingRequest(alice, {
      type: "submit-deck",
      requestId: "same-submit-deck-request",
      expectedRoomVersion: firstRoomVersion,
      deck: {
        mainDeck: [
          { cardId: "fixture.empty-unit-a", quantity: 2 },
          { cardId: "fixture.empty-unit-b", quantity: 3 }
        ]
      }
    }, "submit-deck with same requestId and another payload");
    expect(conflictingPayload.code).toBe("idempotency-conflict");

    await sendRequest(alice, {
      type: "sync-events",
      requestId: "request-idempotency-room-replay",
      afterRoomEventSeq: 0
    }, "request-idempotency room replay");
    const replay = await alice.waitFor(
      "room-events",
      message => message.type === "room-events" && message.afterRoomEventSeq === 0,
      "request-idempotency room event log"
    );
    const aliceDeckEvents = replay.events.filter(event =>
      event.type === "deck-submitted" && event.playerId === aliceSession.playerId
    );

    expect(aliceDeckEvents).toHaveLength(1);
    expect(replay.nextRoomEventSeq).toBe(first.roomEventSeq);
  });

  it("rejects an invalid reconnect cursor without replacing the active socket", async () => {
    const url = await startFoundationServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const started = await startFoundationGame(alice, bob, "bad-cursor");

    const failedResume = await resume(url, started.aliceSession, {
      afterEventSeq: started.aliceProjection.eventSeq + 100
    });
    const failure = await failedResume.waitFor(
      "error",
      message => message.type === "error" && message.code === "command-rejected",
      "invalid reconnect cursor rejection"
    );
    expect(failure.code).toBe("command-rejected");

    const failedCommand = await sendFailingRequest(
      failedResume,
      commandMessage(
        "bad-cursor-command",
        "bad-cursor-command",
        started.aliceProjection.version,
        { type: "pass" }
      ),
      "command before failed resume handshake"
    );
    expect(failedCommand.code).toBe("handshake-required");

    const originalCommand = await sendRequest(
      alice,
      commandMessage(
        "bad-cursor-original-command",
        "bad-cursor-original-command",
      started.aliceProjection.version,
      { type: "pass" }
      ),
      "command from original Alice socket"
    );
    expect(originalCommand.ok).toBe(true);
  });
});
