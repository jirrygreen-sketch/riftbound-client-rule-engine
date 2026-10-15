import { afterEach, describe, expect, it } from "vitest";
import {
  RULESET_ID,
  PROTOCOL_VERSION,
  OFFICIAL_RULESET_ID,
  type ClientSession,
  type GameProjection,
  type PlayerCommand,
  type RoomDeckSubmission,
  type RoomView,
  type ServerToClientMessage
} from "@riftbound/protocol";
import type { GameServer } from "@riftbound/game-server-src";
import { ProtocolWebSocketClient } from "./test-support/websocket-client.js";
import { catalogFixture, startCatalogServer } from "./test-support/card-catalog-fixture.js";

type CreateGameServer = typeof import("@riftbound/game-server-src").createGameServer;

const clients: ProtocolWebSocketClient[] = [];
const servers: GameServer[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
});

async function startMultiplayerServer(): Promise<string> {
  const module = await import("@riftbound/game-server-src");
  if (typeof module.createGameServer !== "function") {
    throw new Error("The real game server must export createGameServer.");
  }
  const createGameServer = module.createGameServer as CreateGameServer;
  let roomNumber = 0;
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    roomIdFactory: () => `flow-room-${++roomNumber}`,
    catalog: catalogFixture,
    deckRules: { defaultMaxCopiesPerCanonical: 3 }
  });
  servers.push(server);
  await server.start();

  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("The game server did not expose an ephemeral TCP address.");
  }
  return `ws://127.0.0.1:${address.port}/ws`;
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

async function reconnect(
  url: string,
  session: ClientSession
): Promise<ProtocolWebSocketClient> {
  const client = await ProtocolWebSocketClient.connect(url);
  clients.push(client);
  client.send({
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    roomId: session.roomId,
    resumeToken: session.resumeToken
  });
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.resumed === true,
    "resumed welcome"
  );
  expect(sessionOf(welcome)).toEqual(session);
  return client;
}

function sessionOf(
  message: Extract<ServerToClientMessage, { type: "welcome" }>
): ClientSession {
  if (!message.session) throw new Error("Welcome omitted its session.");
  return message.session;
}

async function createRoom(
  client: ProtocolWebSocketClient,
  requestSuffix: string,
  rulesetId: string = OFFICIAL_RULESET_ID
): Promise<ClientSession> {
  client.send({
    type: "create-room",
    requestId: `create-${requestSuffix}`,
    playerName: "Alice",
    rulesetId
  });
  const receipt = await client.waitFor(
    "request-result",
    message => message.type === "request-result" &&
      message.requestId === `create-${requestSuffix}`,
    "create-room receipt"
  );
  expect(receipt.ok).toBe(true);
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    "create-room welcome"
  );
  return sessionOf(welcome);
}

async function joinRoom(
  client: ProtocolWebSocketClient,
  roomId: string,
  requestSuffix: string
): Promise<ClientSession> {
  client.send({
    type: "join-room",
    requestId: `join-${requestSuffix}`,
    roomId,
    playerName: "Bob"
  });
  const receipt = await client.waitFor(
    "request-result",
    message => message.type === "request-result" &&
      message.requestId === `join-${requestSuffix}`,
    "join-room receipt"
  );
  expect(receipt.ok).toBe(true);
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    "join-room welcome"
  );
  return sessionOf(welcome);
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

function command(
  requestId: string,
  commandId: string,
  expectedVersion: number,
  payload: PlayerCommand
) {
  return {
    type: "command" as const,
    requestId,
    commandId,
    expectedVersion,
    command: payload
  };
}

async function submitDeck(
  client: ProtocolWebSocketClient,
  expectedRoomVersion: number,
  deck: RoomDeckSubmission,
  requestId: string
) {
  client.send({
    type: "submit-deck",
    requestId,
    expectedRoomVersion,
    deck
  });
  const response = await client.waitForAny(
    ["request-result", "error"],
    message => message.requestId === requestId,
    "submit-deck response",
    1_000
  );
  if (response.type === "error") throw new SubmittedDeckRejected(response);
  return response;
}

class SubmittedDeckRejected extends Error {
  constructor(
    readonly response: Extract<ServerToClientMessage, { type: "error" }>
  ) {
    super(response.message);
  }
}

async function setReady(
  client: ProtocolWebSocketClient,
  expectedRoomVersion: number,
  ready: boolean,
  requestId: string
) {
  client.send({
    type: "set-ready",
    requestId,
    expectedRoomVersion,
    ready
  });
  const response = await client.waitForAny(
    ["request-result", "error"],
    message => message.requestId === requestId,
    "set-ready response",
    1_000
  );
  if (response.type === "error") throw new SetReadyRejected(response);
  return response;
}

class SetReadyRejected extends Error {
  constructor(
    readonly response: Extract<ServerToClientMessage, { type: "error" }>
  ) {
    super(response.message);
  }
}

function validDeck(): RoomDeckSubmission {
  return {
    mainDeck: [
      { cardId: "integration.flame-warden.standard", quantity: 2 },
      { cardId: "integration.flame-warden.alternate", quantity: 1 },
      { cardId: "integration.tide-oracle", quantity: 3 }
    ]
  };
}

async function startReadyGame(
  url: string,
  alice: ProtocolWebSocketClient,
  bob: ProtocolWebSocketClient,
  suffix: string
): Promise<{
  aliceSession: ClientSession;
  bobSession: ClientSession;
  projection: GameProjection;
}> {
  const aliceSession = await createRoom(alice, suffix);
  const bobSession = await joinRoom(bob, aliceSession.roomId, suffix);
  const room = await waitForRoom(
    bob,
    item => item.players.length === 2,
    `${suffix} waiting room`
  );

  const aliceDeck = await submitDeck(
    alice,
    room.roomVersion,
    validDeck(),
    `${suffix}-alice-deck`
  );
  const aliceDeckRoomVersion = aliceDeck.roomVersion ?? room.roomVersion;
  const bobDeck = await submitDeck(
    bob,
    aliceDeckRoomVersion,
    validDeck(),
    `${suffix}-bob-deck`
  );
  const bobDeckRoomVersion = bobDeck.roomVersion ?? aliceDeckRoomVersion;

    const aliceReady = await setReady(
    alice,
    bobDeckRoomVersion,
    true,
    `${suffix}-alice-ready`
  );
  const readyRoomVersion = aliceReady.roomVersion ?? bobDeckRoomVersion;
  await setReady(
    bob,
    readyRoomVersion,
    true,
    `${suffix}-bob-ready`
  );

  const projection = await waitForProjection(
    alice,
    item => item.players.length === 2,
    `${suffix} started projection`
  );
  return { aliceSession, bobSession, projection };
}

async function startSyntheticGame(
  url: string,
  alice: ProtocolWebSocketClient,
  bob: ProtocolWebSocketClient,
  suffix: string
): Promise<{
  aliceSession: ClientSession;
  bobSession: ClientSession;
  projection: GameProjection;
  bobProjection: GameProjection;
}> {
  const aliceSession = await createRoom(alice, suffix, RULESET_ID);
  const bobSession = await joinRoom(bob, aliceSession.roomId, suffix);
  const projection = await waitForProjection(
    alice,
    item => item.players.length === 2,
    `${suffix} synthetic projection`
  );
  const bobProjection = await waitForProjection(
    bob,
    item => item.players.length === 2,
    `${suffix} synthetic opponent projection`
  );
  return { aliceSession, bobSession, projection, bobProjection };
}

async function reconnectAndReplace(url: string, session: ClientSession) {
  const replacement = await ProtocolWebSocketClient.connect(url);
  clients.push(replacement);
  replacement.send({
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    roomId: session.roomId,
    resumeToken: session.resumeToken
  });
  const welcome = await replacement.waitFor(
    "welcome",
    message => message.type === "welcome" && message.resumed === true,
    "replacement resumed welcome"
  );
  expect(sessionOf(welcome)).toEqual(session);
  return replacement;
}

function invalidCanonicalDeck(): RoomDeckSubmission {
  return {
    mainDeck: [
      { cardId: "integration.flame-warden.standard", quantity: 2 },
      { cardId: "integration.flame-warden.alternate", quantity: 1 }
    ],
    sideboard: [
      { cardId: "integration.flame-warden.alternate", quantity: 1 }
    ]
  };
}

describe("cross-package multiplayer protocol flow", () => {
  it("requires a submitted deck before ready and starts only when both players are ready", async () => {
    const url = await startMultiplayerServer();
    const alice = await connect(url);
    const bob = await connect(url);

    const aliceSession = await createRoom(alice, "metadata");
    const bobSession = await joinRoom(bob, aliceSession.roomId, "metadata");
    expect(aliceSession.playerId).toBe("player-1");
    expect(bobSession.playerId).toBe("player-2");

    const room = await waitForRoom(
      bob,
      item =>
        item.players.length === 2 &&
        item.players.every(player => player.ready === false && player.deckSubmitted === false),
      "unready room metadata"
    );
    expect(room.roomId).toBe(aliceSession.roomId);
    expect(room.version).toBeGreaterThanOrEqual(0);
    expect(room.roomVersion).toBeGreaterThanOrEqual(0);
    expect(room.roomEventSeq).toBeGreaterThanOrEqual(0);

    const prematureReadyResult = await setReady(
      alice,
      room.roomVersion,
      true,
      "premature-ready"
    ).catch(error => error instanceof SetReadyRejected ? error : undefined);
    const prematureReady =
      prematureReadyResult instanceof SetReadyRejected ? prematureReadyResult : undefined;
    if (!prematureReady) {
      throw new Error("The server allowed ready before Alice submitted a deck.");
    }
    expect(prematureReady.response.code).toBe("invalid-deck");

    const aliceDeck = await submitDeck(
      alice,
      room.roomVersion,
      validDeck(),
      "alice-deck"
    );
    const aliceDeckRoomVersion = aliceDeck.roomVersion ?? room.roomVersion;
    const bobDeck = await submitDeck(
      bob,
      aliceDeckRoomVersion,
      validDeck(),
      "bob-deck"
    );
    const bobDeckRoomVersion = bobDeck.roomVersion ?? aliceDeckRoomVersion;

    const staleRoomReady = await setReady(
      alice,
      aliceDeckRoomVersion,
      true,
      "stale-room-ready"
    ).catch(error => error instanceof SetReadyRejected ? error : undefined);
    const staleRoomReadyRejected =
      staleRoomReady instanceof SetReadyRejected ? staleRoomReady : undefined;
    if (!staleRoomReadyRejected) {
      throw new Error("The server accepted a stale room version.");
    }
    expect(staleRoomReadyRejected.response.code).toBe("stale-version");

    const aliceReady = await setReady(
      alice,
      bobDeckRoomVersion,
      true,
      "alice-ready"
    );
    const readyRoomVersion = aliceReady.roomVersion ?? bobDeckRoomVersion;
    await setReady(bob, readyRoomVersion, true, "bob-ready");

    const started = await waitForRoom(
      alice,
      item =>
        item.status === "playing" &&
        item.players.every(player => player.ready && player.deckSubmitted),
      "started room"
    );
    expect(started.roomId).toBe(aliceSession.roomId);

    const projection = await waitForProjection(
      alice,
      item => item.players.length === 2,
      "started projection"
    );
    expect(projection.version).toBeGreaterThan(0);
  });

  it("enforces one canonical copy pool across deck zones after deck submission", async () => {
    const url = await startMultiplayerServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceSession = await createRoom(alice, "canonical");
    await joinRoom(bob, aliceSession.roomId, "canonical");
    const room = await waitForRoom(
      bob,
      item => item.players.length === 2,
      "canonical flow room"
    );

    const rejectedResult = await submitDeck(
      alice,
      room.roomVersion,
      invalidCanonicalDeck(),
      "canonical-invalid"
    ).catch(error => error instanceof SubmittedDeckRejected ? error : undefined);
    const rejected =
      rejectedResult instanceof SubmittedDeckRejected ? rejectedResult : undefined;
    if (!rejected) {
      throw new Error("The server accepted four copies of one canonical card.");
    }
    expect(rejected.response.code).toBe("invalid-deck");
  });

  it("replays missed events after reconnect and versioned command failures", async () => {
    const url = await startMultiplayerServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const started = await startReadyGame(url, alice, bob, "events");

    alice.send(
      command("pass-1", "pass-1", started.projection.version, { type: "pass" })
    );
    const pass = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "pass-1",
      "pass receipt"
    );
    expect(pass.appliedVersion).toBeGreaterThan(started.projection.version);

    alice.close();
    await bob.waitFor(
      "room",
      message =>
        message.type === "room" &&
        message.room.players.find(player =>
          player.id === started.aliceSession.playerId
        )?.connected === false,
      "disconnect broadcast"
    );
    const resumed = await reconnect(url, started.aliceSession);

    resumed.send({
      type: "sync-events",
      requestId: "sync-1",
      afterEventSeq: started.projection.eventSeq,
      afterRoomEventSeq: 0
    });
    const replay = await resumed.waitFor(
      "events",
      message =>
        message.type === "events" &&
        message.afterEventSeq === started.projection.eventSeq,
      "event replay"
    );
    expect(replay.events.some(event => event.type === "turn-passed")).toBe(true);
    const roomReplay = await resumed.waitFor(
      "room-events",
      message =>
        message.type === "room-events" && message.afterRoomEventSeq === 0,
      "room event replay"
    );
    expect(roomReplay.nextRoomEventSeq).toBeGreaterThan(0);
    const replayedRoomEventTypes = roomReplay.events.map(event => event.type);
    expect(replayedRoomEventTypes).toContain("player-disconnected");
    expect(replayedRoomEventTypes).toContain("player-reconnected");
    expect(replayedRoomEventTypes).toContain("game-started");

    resumed.send(command("stale-1", "stale-1", started.projection.version, { type: "pass" }));
    const stale = await resumed.waitFor(
      "error",
      message => message.type === "error" && message.requestId === "stale-1",
      "stale command error"
    );
    expect(stale.code).toBe("stale-version");

    resumed.send(command(
      "duplicate-1",
      "pass-1",
      pass.appliedVersion ?? 0,
      { type: "pass" }
    ));
    const duplicate = await resumed.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "duplicate-1",
      "duplicate receipt"
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.appliedVersion).toBe(pass.appliedVersion);

    resumed.send(command(
      "conflict-1",
      "pass-1",
      pass.appliedVersion ?? 0,
      { type: "play-card", instanceId: "player-1:trigger-conquer" }
    ));
    const conflict = await resumed.waitFor(
      "error",
      message => message.type === "error" && message.requestId === "conflict-1",
      "command idempotency conflict"
    );
    expect(conflict.code).toBe("idempotency-conflict");
  });

  it("replaces the active connection and rejects commands from the stale socket", async () => {
    const url = await startMultiplayerServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const started = await startReadyGame(url, alice, bob, "replacement");
    const replacement = await reconnectAndReplace(url, started.aliceSession);

    alice.send(command(
      "stale-socket-1",
      "stale-socket-1",
      started.projection.version,
      { type: "pass" }
    ));
    const rejected = await alice.waitFor(
      "error",
      message =>
        message.type === "error" && message.requestId === "stale-socket-1",
      "stale socket command rejection"
    );
    expect(rejected.code).toBe("session-replaced");

    replacement.send(command(
      "replacement-1",
      "replacement-1",
      started.projection.version,
      { type: "pass" }
    ));
    const accepted = await replacement.waitFor(
      "request-result",
      message =>
        message.type === "request-result" &&
        message.requestId === "replacement-1",
      "replacement command receipt"
    );
    expect(accepted.appliedVersion).toBeGreaterThan(started.projection.version);
  });

  it("clears ready when a player changes their submitted deck", async () => {
    const url = await startMultiplayerServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceSession = await createRoom(alice, "resubmit");
    await joinRoom(bob, aliceSession.roomId, "resubmit");
    const room = await waitForRoom(
      bob,
      item => item.players.length === 2,
      "resubmit waiting room"
    );

    const aliceDeck = await submitDeck(
      alice,
      room.roomVersion,
      validDeck(),
      "resubmit-alice-deck"
    );
    const bobDeck = await submitDeck(
      bob,
      aliceDeck.roomVersion ?? room.roomVersion,
      validDeck(),
      "resubmit-bob-deck"
    );
    const aliceReady = await setReady(
      alice,
      bobDeck.roomVersion ?? aliceDeck.roomVersion ?? room.roomVersion,
      true,
      "resubmit-alice-ready"
    );
    expect(aliceReady.ok).toBe(true);
    await waitForRoom(
      alice,
      item =>
        item.players.find(player => player.id === aliceSession.playerId)?.ready === true,
      "Alice ready room"
    );

    const resubmitted = await submitDeck(
      alice,
      aliceReady.roomVersion ?? bobDeck.roomVersion ?? aliceDeck.roomVersion ?? room.roomVersion,
      validDeck(),
      "resubmit-alice-again"
    );
    expect(resubmitted.ok).toBe(true);
    const cleared = await waitForRoom(
      alice,
      item =>
        item.players.find(player => player.id === aliceSession.playerId)?.ready === false &&
        item.players.find(player => player.id === aliceSession.playerId)?.deckSubmitted === true,
      "Alice ready cleared after deck change"
    );
    expect(cleared.status).toBe("waiting");
  });

  it("keeps hands and prompts private while the game remains playable", async () => {
    const url = await startMultiplayerServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const started = await startSyntheticGame(url, alice, bob, "privacy");
    const aliceInitial = started.projection;
    const aliceSession = started.aliceSession;
    const bobSession = started.bobSession;
    const bobInitial = started.bobProjection;

    const alicePlayer = aliceInitial.players.find(player => player.id === aliceSession.playerId);
    const bobPlayer = bobInitial.players.find(player => player.id === aliceSession.playerId);
    expect(alicePlayer?.hand.length).toBe(alicePlayer?.handCount);
    expect(bobPlayer?.hand).toEqual([]);
    expect(bobPlayer?.handCount).toBe(alicePlayer?.handCount);

    alice.send(command(
      "play-1",
      "play-1",
      aliceInitial.version,
      { type: "play-card", instanceId: `${aliceSession.playerId}:trigger-conquer` }
    ));
    await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "play-1",
      "play receipt"
    );

    const prompted = await waitForProjection(
      alice,
      projection => projection.prompt !== null,
      "Alice private prompt"
    );
    await waitForProjection(
      bob,
      projection =>
        projection.prompt === null &&
        projection.waitingForPlayerId === aliceSession.playerId &&
        projection.version > bobInitial.version,
      "Bob hidden prompt"
    );
    const prompt = prompted.prompt;
    if (!prompt) throw new Error("Expected a visible prompt for its owner.");

    bob.send(command(
      "answer-1",
      "answer-1",
      prompted.version,
      {
        type: "respond-to-prompt",
        promptId: prompt.id,
        optionId: "resolve",
        stateVersion: prompt.stateVersion
      }
    ));
    const unauthorized = await bob.waitFor(
      "error",
      message => message.type === "error" && message.requestId === "answer-1",
      "prompt authorization error"
    );
    expect(unauthorized.code).toBe("not_your_turn");

    alice.send(command(
      "answer-2",
      "answer-2",
      prompted.version,
      {
        type: "respond-to-prompt",
        promptId: prompt.id,
        optionId: "resolve",
        stateVersion: prompt.stateVersion
      }
    ));
    const answer = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "answer-2",
      "prompt answer receipt"
    );
    expect(answer.ok).toBe(true);

    await waitForProjection(
      bob,
      projection =>
        projection.prompt === null &&
        projection.waitingForPlayerId === null &&
        projection.version > prompted.version &&
        projection.players.some(player =>
          player.id === bobSession.playerId && player.life === 19
        ),
      "Bob receives the prompt outcome"
    );
  });

  it("starts foundation from the submitted printings and projects only owner-visible private data", async () => {
    const url = await startMultiplayerServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const started = await startReadyGame(url, alice, bob, "foundation");
    const aliceSession = started.aliceSession;
    const bobSession = started.bobSession;
    const bobProjection = await waitForProjection(
      bob,
      projection => projection.players.length === 2,
      "Bob foundation projection"
    );

    for (const [projection, session] of [
      [started.projection, aliceSession],
      [bobProjection, bobSession]
    ] as const) {
      expect(projection.projectionSchema).toBe("riftbound.projection.v1");
      expect(projection.rulesetId).toBe(OFFICIAL_RULESET_ID);
      expect(projection.objects).toBeDefined();
      const owner = projection.players.find(player => player.id === session.playerId);
      const opponent = projection.players.find(player => player.id !== session.playerId);
      if (!owner || !opponent) throw new Error("Foundation projection must contain two players.");

      expect(owner.score).toBe(0);
      expect(opponent.score).toBe(0);
      expect(owner.energy).toBe(0);
      expect(opponent.energy).toBe(0);
      expect(owner.life).toBeUndefined();
      expect(owner.mana).toBeUndefined();
      expect(owner.hand.length).toBe(owner.handCount);
      expect(opponent.hand).toEqual([]);
      expect(opponent.handCount).toBeGreaterThan(0);
      expect(owner.hand.map(card => card.cardId)).toContain("integration.flame-warden.standard");
      expect(owner.playableInstanceIds).toEqual([]);
      expect(opponent.playableInstanceIds).toEqual([]);
      expect(owner.zoneCounts?.hand).toBe(owner.handCount);
      expect(owner.zoneCounts?.deck).toBeGreaterThan(0);
      expect(opponent.zoneCounts?.deck).toBeGreaterThan(0);
      expect(projection.events.some(event => event.type === "game-started")).toBe(true);
    }

    const ownerHandIds = new Set(
      started.projection.players
        .find(player => player.id === aliceSession.playerId)?.hand
        .map(card => card.instanceId) ?? []
    );
    const safeObjectZones = new Set(
      (started.projection.objects ?? []).map(object => object.zone)
    );
    expect((started.projection.objects ?? []).some(object =>
      ownerHandIds.has(object.objectId) && object.zone === "hand"
    )).toBe(true);
    expect(safeObjectZones.has("deck")).toBe(false);
    expect(safeObjectZones.has("rune-deck")).toBe(false);
    expect(
      (started.projection.objects ?? []).filter(object =>
        object.zone === "hand" && object.ownerPlayerId === aliceSession.playerId
      ).map(object => object.objectId)
    ).toEqual(expect.arrayContaining([...ownerHandIds]));
    expect(
      (bobProjection.objects ?? []).some(object =>
        object.zone === "hand" && object.ownerPlayerId === aliceSession.playerId
      )
    ).toBe(false);

    expect(started.projection.events.some(event =>
      event.type === "card-played" &&
      event.cardId === "integration.flame-warden.standard"
    )).toBe(false);
    expect(started.projection.players.every(player => player.life === undefined)).toBe(true);
  });

  it("filters opponent prompt events from replayed game events", async () => {
    const url = await startMultiplayerServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const started = await startSyntheticGame(url, alice, bob, "prompt-replay");
    const aliceInitial = started.projection;

    alice.send(command(
      "prompt-replay-play",
      "prompt-replay-play",
      aliceInitial.version,
      { type: "play-card", instanceId: `${started.aliceSession.playerId}:trigger-conquer` }
    ));
    await alice.waitFor(
      "request-result",
      message => message.type === "request-result" &&
        message.requestId === "prompt-replay-play",
      "play-card receipt"
    );
    const prompted = await waitForProjection(
      alice,
      projection => projection.prompt !== null,
      "Alice private prompt"
    );

    for (const [client, label] of [
      [alice, "owner"],
      [bob, "opponent"]
    ] as const) {
      client.send({
        type: "sync-events",
        requestId: `prompt-replay-${label}`,
        afterEventSeq: aliceInitial.eventSeq
      });
      const replay = await client.waitFor(
        "events",
        message =>
          message.type === "events" &&
          message.afterEventSeq === aliceInitial.eventSeq,
        `${label} prompt replay`
      );
      const promptEvents = replay.events.filter(event =>
        event.type === "prompt-created" || event.type === "prompt-answered"
      );
      if (client === alice) {
        expect(promptEvents.length).toBeGreaterThan(0);
        expect(promptEvents.every(event => event.playerId === started.aliceSession.playerId))
          .toBe(true);
      } else {
        expect(promptEvents).toEqual([]);
      }
    }

    const prompt = prompted.prompt;
    if (!prompt) throw new Error("Expected Alice to own the prompt.");
    alice.send(command(
      "prompt-replay-answer",
      "prompt-replay-answer",
      prompted.version,
      {
        type: "respond-to-prompt",
        promptId: prompt.id,
        optionId: "resolve",
        stateVersion: prompt.stateVersion
      }
    ));
    await alice.waitFor(
      "request-result",
      message => message.type === "request-result" &&
        message.requestId === "prompt-replay-answer",
      "prompt answer receipt"
    );

    bob.send({
      type: "sync-events",
      requestId: "prompt-replay-after-answer",
      afterEventSeq: prompted.eventSeq
    });
    const afterAnswer = await bob.waitFor(
      "events",
      message =>
        message.type === "events" &&
        message.afterEventSeq === prompted.eventSeq,
      "opponent replay after prompt answer"
    );
    expect(afterAnswer.events.filter(event =>
      event.type === "prompt-created" || event.type === "prompt-answered"
    )).toEqual([]);
    expect(afterAnswer.events.some(event => event.type === "damage-dealt")).toBe(true);
  });
});
