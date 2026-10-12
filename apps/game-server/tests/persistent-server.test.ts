import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
import {
  createGameServer,
  type GameServer,
  type GameServerOptions
} from "../src/server.js";
import type { CardCatalogRuntime } from "../src/card-catalog.js";
import { InMemoryRoomStore } from "../src/room-store.js";

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

  async closeAndWait(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }

  hasRequestResult(requestId: string): boolean {
    return this.messages.some(
      message =>
        message.type === "request-result" && message.requestId === requestId
    );
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

  async waitForError(requestId: string): Promise<MessageOf<"error">> {
    return this.waitFor(
      "error",
      message => message.type === "error" && message.requestId === requestId,
      `${requestId} error`
    );
  }
}

class SaveFailureRoomStore extends InMemoryRoomStore {
  failSaves = false;
  saveCalls = 0;

  override async save(): Promise<void> {
    this.saveCalls += 1;
    if (this.failSaves) {
      throw new Error("Injected durable save failure");
    }
  }
}

const clients: TestClient[] = [];
const servers: GameServer[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.closeAndWait().catch(() => undefined);
  for (const server of servers.splice(0)) {
    await server.stop().catch(() => undefined);
  }

  for (const directory of temporaryDirectories.splice(0)) {
    const expectedPrefix = path.join(
      tmpdir(),
      path.sep,
      "riftbound-persistent-server-"
    ).replace(/\\/g, "/");
    const normalized = path.resolve(directory).replace(/\\/g, "/");
    if (normalized.startsWith(expectedPrefix)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function makeStorageDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "riftbound-persistent-server-")
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function startServer(
  options: Pick<GameServerOptions, "roomStore" | "storageDirectory">
): Promise<{ server: GameServer; url: string }> {
  let roomNumber = 0;
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    roomIdFactory: () => `persistent-server-${++roomNumber}`,
    catalog,
    deckRules,
    ...options
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

async function resume(
  url: string,
  session: ClientSession
): Promise<TestClient> {
  const client = await TestClient.connect(url);
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
    `resumed welcome for ${session.playerId}`
  );
  if (!welcome.session) {
    throw new Error("Resumed welcome omitted the session");
  }
  expect(welcome.session).toEqual(session);
  return client;
}

async function createFoundationRoom(
  client: TestClient,
  requestId: string
): Promise<ClientSession> {
  client.send({
    type: "create-room",
    requestId,
    playerName: "Alice",
    rulesetId: FOUNDATION_RULESET_ID
  });
  await waitForSuccess(client, requestId);
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    `${requestId} welcome`
  );
  if (!welcome.session) {
    throw new Error("Create welcome omitted the session");
  }
  return welcome.session;
}

async function joinFoundationRoom(
  client: TestClient,
  roomId: string,
  requestId: string
): Promise<ClientSession> {
  client.send({
    type: "join-room",
    requestId,
    roomId,
    playerName: "Bob"
  });
  await waitForSuccess(client, requestId);
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.session !== undefined,
    `${requestId} welcome`
  );
  if (!welcome.session) {
    throw new Error("Join welcome omitted the session");
  }
  return welcome.session;
}

async function waitForSuccess(
  client: TestClient,
  requestId: string
): Promise<MessageOf<"request-result">> {
  const receipt = await client.waitFor(
    "request-result",
    message =>
      message.type === "request-result" && message.requestId === requestId,
    `${requestId} receipt`
  );
  expect(receipt.ok).toBe(true);
  return receipt;
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
  const receipt = await waitForSuccess(client, requestId);
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
  const receipt = await waitForSuccess(client, requestId);
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
  requestRoomVersions: Record<
    "alice-deck" | "alice-ready" | "bob-deck" | "bob-ready",
    number
  >;
}> {
  const alice = await connect(url);
  const bob = await connect(url);
  const aliceSession = await createFoundationRoom(alice, "alice-create");
  const bobSession = await joinFoundationRoom(
    bob,
    aliceSession.roomId,
    "bob-join"
  );
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
  const bobReadyVersion = await setReady(
    bob,
    aliceReadyVersion,
    "bob-ready"
  );

  const started = await waitForProjection(
    alice,
    projection =>
      projection.rulesetId === FOUNDATION_RULESET_ID &&
      projection.phase === "main" &&
      projection.players.length === 2,
    "Foundation started projection"
  );
  await waitForProjection(
    bob,
    projection => projection.version === started.version,
    "Bob Foundation started projection"
  );
  return {
    alice,
    bob,
    aliceSession,
    bobSession,
    started,
    requestRoomVersions: {
      "alice-deck": aliceDeckVersion,
      "alice-ready": aliceReadyVersion,
      "bob-deck": bobDeckVersion,
      "bob-ready": bobReadyVersion
    }
  };
}

describe("persistent game server", () => {
  it("restores a Foundation game, sessions, private projections, and command dedupe after restart", async () => {
    const storageDirectory = await makeStorageDirectory();
    const first = await startServer({ storageDirectory });
    const {
      alice,
      bob,
      aliceSession,
      bobSession,
      started
    } = await startReadyFoundationGame(first.url);

    alice.send({
      type: "command",
      requestId: "alice-pass",
      commandId: "alice-pass",
      expectedVersion: started.version,
      command: { type: "pass" }
    });
    const pass = await waitForSuccess(alice, "alice-pass");
    const beforeRestart = await waitForProjection(
      alice,
      projection => projection.version === pass.appliedVersion,
      "Alice pass projection before restart"
    );
    const bobBeforeRestart = await waitForProjection(
      bob,
      projection => projection.version === pass.appliedVersion,
      "Bob pass projection before restart"
    );
    const aliceHand = beforeRestart.players
      .find(player => player.id === aliceSession.playerId)?.hand ?? [];
    expect(aliceHand.length).toBeGreaterThan(0);
    const bobHand = bobBeforeRestart.players
      .find(player => player.id === bobSession.playerId)?.hand ?? [];

    await first.server.stop();
    servers.splice(servers.indexOf(first.server), 1);
    await alice.closeAndWait();
    await bob.closeAndWait();

    const second = await startServer({ storageDirectory });
    const resumedAlice = await resume(second.url, aliceSession);
    const resumedBob = await resume(second.url, bobSession);

    const restoredAliceProjection = await waitForProjection(
      resumedAlice,
      projection => projection.version === beforeRestart.version,
      "Alice restored projection"
    );
    expect(restoredAliceProjection.eventSeq).toBe(beforeRestart.eventSeq);
    expect(restoredAliceProjection.players.find(
      player => player.id === aliceSession.playerId
    )?.hand).toHaveLength(aliceHand.length);

    const restoredBobProjection = await waitForProjection(
      resumedBob,
      projection => projection.version === beforeRestart.version,
      "Bob restored projection"
    );
    expect(restoredBobProjection.players.find(
      player => player.id === aliceSession.playerId
    )?.hand).toHaveLength(0);
    expect(restoredBobProjection.players.find(
      player => player.id === bobSession.playerId
    )?.hand).toHaveLength(bobHand.length);

    const restoredRoom = await waitForRoom(
      resumedAlice,
      room =>
        room.roomId === aliceSession.roomId &&
        room.players.length === 2 &&
        room.players.every(player => player.connected),
      "restored room with both seats"
    );
    expect(restoredRoom.status).toBe("playing");
    expect(restoredRoom.version).toBe(beforeRestart.version);

    resumedAlice.send({
      type: "command",
      requestId: "alice-pass-dedupe",
      commandId: "alice-pass",
      expectedVersion: beforeRestart.version,
      command: { type: "pass" }
    });
    const duplicate = await waitForSuccess(
      resumedAlice,
      "alice-pass-dedupe"
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.appliedVersion).toBe(pass.appliedVersion);
    expect(duplicate.eventSeq).toBe(pass.eventSeq);
  });

  it("rolls back a command when its durable save fails and allows the same command to retry", async () => {
    const roomStore = new SaveFailureRoomStore();
    const { server, url } = await startServer({ roomStore });
    const {
      alice,
      aliceSession,
      started
    } = await startReadyFoundationGame(url);
    const room = server.rooms.get(aliceSession.roomId);
    if (!room) throw new Error("Foundation room was not retained");

    const beforeFailure = room.exportArchive();
    const activeConnectionId = room.players.get(aliceSession.playerId)
      ?.connectionId;
    roomStore.failSaves = true;

    alice.send({
      type: "command",
      requestId: "alice-failing-pass",
      commandId: "alice-failing-pass",
      expectedVersion: started.version,
      command: { type: "pass" }
    });
    const error = await alice.waitForError("alice-failing-pass");
    expect(error.message).toContain("Injected durable save failure");
    expect(alice.hasRequestResult("alice-failing-pass")).toBe(false);

    expect(room.exportArchive()).toEqual(beforeFailure);
    expect(room.processedCommands.has("alice-failing-pass")).toBe(false);
    expect(room.connectedPlayerCount).toBe(2);
    expect(room.players.get(aliceSession.playerId)?.connectionId)
      .toBe(activeConnectionId);

    roomStore.failSaves = false;
    alice.send({
      type: "command",
      requestId: "alice-failing-pass",
      commandId: "alice-failing-pass",
      expectedVersion: started.version,
      command: { type: "pass" }
    });
    const retried = await waitForSuccess(alice, "alice-failing-pass");
    expect(retried.ok).toBe(true);
    expect(retried.duplicate).toBe(false);
    expect(retried.appliedVersion).toBeGreaterThan(started.version);
    await waitForProjection(
      alice,
      projection => projection.version === retried.appliedVersion,
      "successfully retried command projection"
    );
    expect(room.processedCommands.has("alice-failing-pass")).toBe(true);
  });

  it("does not leak a seat or report success when create or join writes fail", async () => {
    const roomStore = new SaveFailureRoomStore();
    const { server, url } = await startServer({ roomStore });
    const alice = await connect(url);

    roomStore.failSaves = true;
    alice.send({
      type: "create-room",
      requestId: "alice-create-fails",
      playerName: "Alice",
      rulesetId: FOUNDATION_RULESET_ID
    });
    const createError = await alice.waitForError("alice-create-fails");
    expect(createError.message).toContain("Injected durable save failure");
    expect(alice.hasRequestResult("alice-create-fails")).toBe(false);
    expect(server.rooms.size).toBe(0);
    expect(await roomStore.count()).toBe(0);

    roomStore.failSaves = false;
    const aliceSession = await createFoundationRoom(
      alice,
      "alice-create-retry"
    );
    expect(await roomStore.count()).toBe(1);
    const room = server.rooms.get(aliceSession.roomId);
    if (!room) throw new Error("Created room was not retained");
    const beforeFailedJoin = room.exportArchive();

    const bob = await connect(url);
    roomStore.failSaves = true;
    bob.send({
      type: "join-room",
      requestId: "bob-join-fails",
      roomId: aliceSession.roomId,
      playerName: "Bob"
    });
    const joinError = await bob.waitForError("bob-join-fails");
    expect(joinError.message).toContain("Injected durable save failure");
    expect(bob.hasRequestResult("bob-join-fails")).toBe(false);
    expect(room.playerCount).toBe(1);
    expect(room.connectedPlayerCount).toBe(1);
    expect(room.exportArchive()).toEqual(beforeFailedJoin);
    expect(await roomStore.count()).toBe(1);

    roomStore.failSaves = false;
    const bobSession = await joinFoundationRoom(
      bob,
      aliceSession.roomId,
      "bob-join-retry"
    );
    expect(bobSession.playerId).toBe("player-2");
    expect(room.playerCount).toBe(2);
    expect(room.connectedPlayerCount).toBe(2);
    expect(await roomStore.count()).toBe(1);
  });

  it("keeps the live socket authoritative when a reconnect save fails", async () => {
    const roomStore = new SaveFailureRoomStore();
    const { server, url } = await startServer({ roomStore });
    const { alice, aliceSession, started } = await startReadyFoundationGame(url);
    const room = server.rooms.get(aliceSession.roomId);
    if (!room) throw new Error("Foundation room was not retained");
    const beforeFailedReconnect = room.exportArchive();
    const originalConnectionId = room.players.get(aliceSession.playerId)
      ?.connectionId;
    if (!originalConnectionId) {
      throw new Error("Alice did not have a live connection");
    }

    const replacement = await TestClient.connect(url);
    clients.push(replacement);
    roomStore.failSaves = true;
    replacement.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: aliceSession.roomId,
      resumeToken: aliceSession.resumeToken
    });
    const error = await replacement.waitFor(
      "error",
      message =>
        message.type === "error" &&
        message.code === "command-rejected" &&
        message.message.includes("Injected durable save failure"),
      "failed reconnect error"
    );
    expect(error.code).toBe("command-rejected");
    expect(error.message).toContain("Injected durable save failure");
    expect(replacement.hasRequestResult("reconnect")).toBe(false);

    expect(room.exportArchive()).toEqual(beforeFailedReconnect);
    expect(room.players.get(aliceSession.playerId)?.connectionId)
      .toBe(originalConnectionId);
    expect(room.connectedPlayerCount).toBe(2);
    expect(room.players.get(aliceSession.playerId)?.send)
      .toBeDefined();

    replacement.send({
      type: "command",
      requestId: "unhandshaken-command",
      commandId: "unhandshaken-command",
      expectedVersion: started.version,
      command: { type: "pass" }
    });
    const handshakeError = await replacement.waitForError(
      "unhandshaken-command"
    );
    expect(handshakeError.code).toBe("handshake-required");

    roomStore.failSaves = false;
    alice.send({
      type: "command",
      requestId: "original-socket-pass",
      commandId: "original-socket-pass",
      expectedVersion: started.version,
      command: { type: "pass" }
    });
    const pass = await waitForSuccess(alice, "original-socket-pass");
    expect(pass.ok).toBe(true);
    expect(roomStore.saveCalls).toBeGreaterThan(0);
  });

  it("replays submit-deck and auto-start set-ready receipts after a restart", async () => {
    const storageDirectory = await makeStorageDirectory();
    const first = await startServer({ storageDirectory });
    const {
      alice,
      bob,
      aliceSession,
      bobSession,
      started,
      requestRoomVersions
    } =
      await startReadyFoundationGame(first.url);

    await first.server.stop();
    servers.splice(servers.indexOf(first.server), 1);
    await alice.closeAndWait();
    await bob.closeAndWait();

    const second = await startServer({ storageDirectory });
    const resumedAlice = await resume(second.url, aliceSession);
    const resumedBob = await resume(second.url, bobSession);
    const restoredRoom = second.server.rooms.get(aliceSession.roomId);
    if (!restoredRoom) throw new Error("Foundation room was not restored");
    expect(restoredRoom.status).toBe("playing");
    expect(restoredRoom.roomView().roomVersion).toBe(
      requestRoomVersions["bob-ready"] + 2
    );

    for (const [client, request] of [
      [resumedAlice, "alice-deck"],
      [resumedAlice, "alice-ready"],
      [resumedBob, "bob-deck"],
      [resumedBob, "bob-ready"]
    ] as const) {
      const requestType = request.endsWith("deck")
        ? "submit-deck"
        : "set-ready";
      const expectedRoomVersion = requestRoomVersions[request];
      client.send({
        type: requestType,
        requestId: request,
        expectedRoomVersion,
        ...(requestType === "submit-deck" ? { deck } : { ready: true })
      });
      const duplicate = await waitForSuccess(client, request);
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.roomVersion).toBe(expectedRoomVersion);
    }

    await waitForProjection(
      resumedAlice,
      projection => projection.version === started.version,
      "restored projection after room-request dedupe"
    );
    expect(restoredRoom.processedRoomRequests.size).toBe(4);
  });

  it("rejects bad sync cursors without saving or replacing the connection", async () => {
    const roomStore = new SaveFailureRoomStore();
    const { server, url } = await startServer({ roomStore });
    const { alice, aliceSession, started } = await startReadyFoundationGame(url);
    const room = server.rooms.get(aliceSession.roomId);
    if (!room) throw new Error("Foundation room was not retained");
    const beforeBadCursor = room.exportArchive();
    const originalConnectionId = room.players.get(aliceSession.playerId)
      ?.connectionId;
    const savesBeforeBadCursor = roomStore.saveCalls;

    alice.send({
      type: "sync-events",
      requestId: "bad-game-cursor",
      afterEventSeq: started.eventSeq + 1
    });
    const gameCursorError = await alice.waitForError("bad-game-cursor");
    expect(gameCursorError.code).toBe("command-rejected");
    expect(gameCursorError.message).toContain("Event cursor is ahead");

    alice.send({
      type: "sync-events",
      requestId: "bad-room-cursor",
      afterRoomEventSeq: room.currentRoomEventSeq + 1
    });
    const roomCursorError = await alice.waitForError("bad-room-cursor");
    expect(roomCursorError.code).toBe("command-rejected");
    expect(roomCursorError.message).toContain("Room event cursor is ahead");

    expect(roomStore.saveCalls).toBe(savesBeforeBadCursor);
    expect(room.exportArchive()).toEqual(beforeBadCursor);
    expect(room.players.get(aliceSession.playerId)?.connectionId)
      .toBe(originalConnectionId);
    expect(roomStore.saveCalls).toBeGreaterThan(0);
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

const catalog = {
  schemaVersion: 1,
  dataVersion: "persistent-server-fixture",
  digest: `sha256:${"p".repeat(64)}`,
  cards: [
    card("fixture.basic-unit", "Basic Unit", "Unit"),
    card("fixture.text-unit", "Text Unit", "Unit", "Text ability."),
    card("fixture.extra-unit-1", "Extra Unit 1", "Unit"),
    card("fixture.extra-unit-2", "Extra Unit 2", "Unit"),
    card("fixture.extra-unit-3", "Extra Unit 3", "Unit"),
    card("fixture.gear", "Basic Gear", "Gear", ""),
    {
      ...card("fixture.champion", "Fixture Champion", "Unit"),
      tags: ["Champion"]
    },
    card("fixture.legend", "Fixture Legend", "Legend"),
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
