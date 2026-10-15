import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  FOUNDATION_RULESET_ID,
  PROTOCOL_VERSION,
  type ClientSession,
  type ClientToServerMessage,
  type GameProjection,
  type RoomView,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { createGameServer, type GameServer } from "../src/server.js";

type MessageOf<T extends ServerToClientMessage["type"]> =
  Extract<ServerToClientMessage, { type: T }>;

class TestClient {
  private readonly messages: ServerToClientMessage[] = [];
  private readonly waiters = new Set<() => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", raw => {
      this.messages.push(JSON.parse(String(raw)) as ServerToClientMessage);
      for (const wake of this.waiters) wake();
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new TestClient(socket);
  }

  send(message: ClientToServerMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }

  async closeAndWait(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }

  async terminateAndWait(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      this.socket.once("close", () => resolve());
      this.socket.terminate();
    });
  }

  async waitFor<T extends ServerToClientMessage["type"]>(
    type: T,
    predicate: (message: MessageOf<T>) => boolean,
    label: string
  ): Promise<MessageOf<T>> {
    const deadline = Date.now() + 5_000;

    while (true) {
      const index = this.messages.findIndex(
        (message): message is MessageOf<T> =>
          message.type === type && predicate(message as MessageOf<T>)
      );
      if (index !== -1) {
        return this.messages.splice(index, 1)[0] as MessageOf<T>;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${label}: ${JSON.stringify(this.messages)}`
        );
      }

      await new Promise<void>(resolve => {
        const wake = () => {
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
        setTimeout(wake, 10);
      });
    }
  }
}

const clients: TestClient[] = [];
const servers: GameServer[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
});

async function startServer(): Promise<{ server: GameServer; url: string }> {
  let roomNumber = 0;
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    roomIdFactory: () => `foundation-ws-${++roomNumber}`,
    catalog,
    deckRules
  });
  servers.push(server);
  await server.start();

  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP address");
  }
  return { server, url: `ws://127.0.0.1:${address.port}/ws` };
}

async function connect(url: string): Promise<TestClient> {
  const client = await TestClient.connect(url);
  clients.push(client);
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.resumed !== true,
    "initial welcome"
  );
  return client;
}

async function createFoundationRoom(
  client: TestClient
): Promise<ClientSession> {
  client.send({
    type: "create-room",
    requestId: "create-room",
    playerName: "Alice",
    rulesetId: FOUNDATION_RULESET_ID
  });
  await waitForReceipt(client, "create-room");
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    "create welcome"
  );
  if (!welcome.session) throw new Error("Create welcome omitted the session");
  return welcome.session;
}

async function joinFoundationRoom(
  client: TestClient,
  roomId: string
): Promise<ClientSession> {
  client.send({
    type: "join-room",
    requestId: "join-room",
    roomId,
    playerName: "Bob"
  });
  await waitForReceipt(client, "join-room");
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    "join welcome"
  );
  if (!welcome.session) throw new Error("Join welcome omitted the session");
  return welcome.session;
}

async function waitForReceipt(
  client: TestClient,
  requestId: string
): Promise<void> {
  const receipt = await client.waitFor(
    "request-result",
    message =>
      message.type === "request-result" && message.requestId === requestId,
    `${requestId} receipt`
  );
  expect(receipt.ok).toBe(true);
}

async function submitDeck(
  client: TestClient,
  expectedRoomVersion: number,
  requestId: string
): Promise<number> {
  client.send({
    type: "submit-deck",
    requestId,
    expectedRoomVersion,
    deck
  });
  const receipt = await client.waitFor(
    "request-result",
    message =>
      message.type === "request-result" && message.requestId === requestId,
    `${requestId} receipt`
  );
  if (receipt.roomVersion === undefined) {
    throw new Error(`${requestId} receipt omitted roomVersion`);
  }
  return receipt.roomVersion;
}

async function setReady(
  client: TestClient,
  expectedRoomVersion: number,
  requestId: string
): Promise<number> {
  client.send({
    type: "set-ready",
    requestId,
    expectedRoomVersion,
    ready: true
  });
  const receipt = await client.waitFor(
    "request-result",
    message =>
      message.type === "request-result" && message.requestId === requestId,
    `${requestId} receipt`
  );
  if (receipt.roomVersion === undefined) {
    throw new Error(`${requestId} receipt omitted roomVersion`);
  }
  return receipt.roomVersion;
}

async function waitForRoom(
  client: TestClient,
  predicate: (room: RoomView) => boolean,
  label: string
): Promise<RoomView> {
  const message = await client.waitFor(
    "room",
    candidate => candidate.type === "room" && predicate(candidate.room),
    label
  );
  return message.room;
}

async function waitForProjection(
  client: TestClient,
  predicate: (projection: GameProjection) => boolean,
  label: string
): Promise<GameProjection> {
  const message = await client.waitFor(
    "projection",
    candidate =>
      candidate.type === "projection" && predicate(candidate.projection),
    label
  );
  return message.projection;
}

async function startReadyFoundationGame(url: string): Promise<{
  alice: TestClient;
  bob: TestClient;
  aliceSession: ClientSession;
  bobSession: ClientSession;
  started: GameProjection;
  bobStarted: GameProjection;
}> {
  const alice = await connect(url);
  const bob = await connect(url);
  const aliceSession = await createFoundationRoom(alice);
  const bobSession = await joinFoundationRoom(bob, aliceSession.roomId);
  expect(aliceSession.playerId).toBe("player-1");
  expect(bobSession.playerId).toBe("player-2");

  const waiting = await waitForRoom(
    bob,
    room =>
      room.status === "waiting" &&
      room.players.length === 2 &&
      room.players.every(player => player.connected),
    "Foundation waiting room"
  );
  expect(waiting.rulesetId).toBe(FOUNDATION_RULESET_ID);

  const aliceDeckVersion = await submitDeck(
    alice,
    waiting.roomVersion,
    "alice-deck"
  );
  const bobDeckVersion = await submitDeck(
    bob,
    aliceDeckVersion,
    "bob-deck"
  );
  const aliceReadyVersion = await setReady(
    alice,
    bobDeckVersion,
    "alice-ready"
  );
  await setReady(bob, aliceReadyVersion, "bob-ready");

  const started = await waitForProjection(
    alice,
    projection =>
      projection.rulesetId === FOUNDATION_RULESET_ID &&
      projection.phase === "main" &&
      projection.players.length === 2,
    "Foundation started projection"
  );
  const bobStarted = await waitForProjection(
    bob,
    projection =>
      projection.rulesetId === FOUNDATION_RULESET_ID &&
      projection.version === started.version,
    "Bob Foundation started projection"
  );
  expect(bobStarted.eventSeq).toBe(started.eventSeq);

  await waitForRoom(
    alice,
    room => room.status === "playing",
    "Foundation playing room"
  );
  return { alice, bob, aliceSession, bobSession, started, bobStarted };
}

describe("Foundation WebSocket reconnect regression", () => {
  it("creates, joins, starts, resumes, and replays missed room/game state", async () => {
    const { url } = await startServer();
    const {
      alice,
      bob,
      aliceSession,
      started,
      bobStarted
    } = await startReadyFoundationGame(url);

    expect(started.players[0]?.hand.length).toBeGreaterThan(0);
    expect(bobStarted.players[1]?.hand.length).toBeGreaterThan(0);

    alice.send({
      type: "command",
      requestId: "alice-pass",
      commandId: "alice-pass",
      expectedVersion: started.version,
      command: { type: "pass" }
    });
    const alicePass = await alice.waitFor(
      "request-result",
      message =>
        message.type === "request-result" &&
        message.requestId === "alice-pass",
      "Alice pass receipt"
    );
    const beforeDisconnect = await waitForProjection(
      alice,
      projection => projection.version === alicePass.appliedVersion,
      "Alice pass projection"
    );

    await alice.closeAndWait();
    const disconnected = await waitForRoom(
      bob,
      room =>
        room.status === "playing" &&
        room.players.find(
          player => player.id === aliceSession.playerId
        )?.connected === false,
      "Bob observes Alice disconnect"
    );
    expect(disconnected.players.find(
      player => player.id === aliceSession.playerId
    )?.deckSubmitted).toBe(true);

    bob.send({
      type: "command",
      requestId: "bob-pass",
      commandId: "bob-pass",
      expectedVersion: beforeDisconnect.version,
      command: { type: "pass" }
    });
    const bobPass = await bob.waitFor(
      "request-result",
      message =>
        message.type === "request-result" && message.requestId === "bob-pass",
      "Bob pass receipt"
    );
    const whileOffline = await waitForProjection(
      bob,
      projection => projection.version === bobPass.appliedVersion,
      "Bob pass projection"
    );
    expect(whileOffline.version).toBeGreaterThan(beforeDisconnect.version);

    const resumed = await TestClient.connect(url);
    clients.push(resumed);
    resumed.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: aliceSession.roomId,
      resumeToken: aliceSession.resumeToken,
      afterEventSeq: beforeDisconnect.eventSeq,
      afterRoomEventSeq: 0
    });

    const welcome = await resumed.waitFor(
      "welcome",
      message => message.type === "welcome" && message.resumed === true,
      "resumed welcome"
    );
    expect(welcome.session).toEqual(aliceSession);

    const resumedRoom = await waitForRoom(
      resumed,
      room =>
        room.roomId === aliceSession.roomId &&
        room.players.find(
          player => player.id === aliceSession.playerId
        )?.connected === true,
      "resumed room"
    );
    expect(resumedRoom.status).toBe("playing");

    const resumedProjection = await waitForProjection(
      resumed,
      projection =>
        projection.version === whileOffline.version &&
        projection.activePlayerId === aliceSession.playerId,
      "resumed projection"
    );
    expect(resumedProjection.eventSeq).toBe(whileOffline.eventSeq);

    const roomReplay = await resumed.waitFor(
      "room-events",
      message =>
        message.type === "room-events" && message.afterRoomEventSeq === 0,
      "resumed room event replay"
    );
    const roomEventTypes = roomReplay.events.map(event => event.type);
    expect(roomEventTypes).toContain("game-started");
    expect(roomEventTypes).toContain("player-disconnected");
    expect(roomEventTypes).toContain("player-reconnected");
    expect(roomReplay.events.find(event =>
      event.type === "player-disconnected"
    )?.playerId).toBe(aliceSession.playerId);

    const gameReplay = await resumed.waitFor(
      "events",
      message =>
        message.type === "events" &&
        message.afterEventSeq === beforeDisconnect.eventSeq,
      "resumed game event replay"
    );
    expect(gameReplay.events.some(event => event.type === "turn-passed"))
      .toBe(true);
    expect(gameReplay.nextEventSeq).toBe(whileOffline.eventSeq);
  });

  it("keeps the resumed connection current after the replaced socket closes", async () => {
    const { server, url } = await startServer();
    const {
      alice,
      aliceSession,
      started
    } = await startReadyFoundationGame(url);

    const replacement = await TestClient.connect(url);
    clients.push(replacement);
    replacement.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: aliceSession.roomId,
      resumeToken: aliceSession.resumeToken,
      afterRoomEventSeq: 0
    });
    const welcome = await replacement.waitFor(
      "welcome",
      message => message.type === "welcome" && message.resumed === true,
      "replacement welcome"
    );
    expect(welcome.session).toEqual(aliceSession);

    const room = server.rooms.get(aliceSession.roomId);
    if (!room) throw new Error("Foundation room was not retained by the server");
    const replacementConnectionId =
      room.players.get(aliceSession.playerId)?.connectionId;
    if (!replacementConnectionId) {
      throw new Error("Replacement connection was not registered");
    }

    await replacement.waitFor(
      "projection",
      message =>
        message.type === "projection" &&
        message.projection.version === started.version,
      "replacement projection"
    );
    await alice.terminateAndWait();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(room.players.get(aliceSession.playerId)?.connectionId)
      .toBe(replacementConnectionId);
    expect(room.connectedPlayerCount).toBe(2);
    expect(room.roomEvents().filter(event =>
      event.type === "player-disconnected" &&
      event.playerId === aliceSession.playerId
    )).toHaveLength(0);

    replacement.send({
      type: "sync-events",
      requestId: "replacement-sync",
      afterRoomEventSeq: 0
    });
    const roomReplay = await replacement.waitFor(
      "room-events",
      message =>
        message.type === "room-events" &&
        message.afterRoomEventSeq === 0,
      "replacement room event replay"
    );
    expect(roomReplay.events.some(event =>
      event.type === "player-reconnected" &&
      event.playerId === aliceSession.playerId
    )).toBe(true);
    expect(roomReplay.events.some(event =>
      event.type === "player-disconnected" &&
      event.playerId === aliceSession.playerId
    )).toBe(false);

    replacement.send({
      type: "command",
      requestId: "replacement-pass",
      commandId: "replacement-pass",
      expectedVersion: started.version,
      command: { type: "pass" }
    });
    const receipt = await replacement.waitFor(
      "request-result",
      message =>
        message.type === "request-result" &&
        message.requestId === "replacement-pass",
      "replacement pass receipt"
    );
    expect(receipt.appliedVersion).toBeGreaterThan(started.version);
  });
});

const deck = {
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

const deckRules = {
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

const catalog = {
  schemaVersion: 1,
  dataVersion: "foundation-websocket-fixture",
  digest: `sha256:${"c".repeat(64)}`,
  cards: [
    card("fixture.basic-unit", "Basic Unit", "Unit"),
    card("fixture.text-unit", "Text Unit", "Unit", "Text ability."),
    card("fixture.extra-unit-1", "Extra Unit 1", "Unit"),
    card("fixture.extra-unit-2", "Extra Unit 2", "Unit"),
    card("fixture.extra-unit-3", "Extra Unit 3", "Unit"),
    card("fixture.gear", "Basic Gear", "Gear", ""),
    {
      ...card("fixture.champion", "Fixture Champion", "Unit"),
      tags: ["Champion", "Fixturechamp"],
      domains: ["Fury"]
    },
    {
      ...card("fixture.legend", "Fixture Legend", "Legend"),
      tags: ["Fixturechamp"],
      domains: ["Fury"]
    },
    card("fixture.rune", "Fixture Rune", "Rune"),
    card("fixture.battlefield", "Fixture Battlefield", "Battlefield")
  ]
};

function card(
  canonicalCardId: string,
  fullName: string,
  cardType: string,
  ability = "Fixture."
) {
  return {
    id: canonicalCardId,
    canonicalCardId,
    name: fullName,
    fullName,
    cardType,
    domains: [],
    tags: [],
    setCode: "ogs",
    cardNumber: canonicalCardId.slice(-3),
    variant: "standard",
    imageUrl: null,
    energy: 1,
    power: 1,
    might: null,
    ability
  };
}
