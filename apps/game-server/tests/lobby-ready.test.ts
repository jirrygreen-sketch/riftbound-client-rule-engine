import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  FOUNDATION_RULESET_ID,
  PROTOCOL_VERSION,
  RULESET_ID,
  type ClientSession,
  type ClientToServerMessage,
  type GameProjection,
  type RoomView,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { createGameServer, type GameServer } from "../src/server.js";

type MessageOf<T extends ServerToClientMessage["type"]> =
  Extract<ServerToClientMessage, { type: T }>;

class LobbyClient {
  private constructor(
    private readonly socket: WebSocket,
    private readonly messages: ServerToClientMessage[] = []
  ) {
    socket.on("message", raw => {
      this.messages.push(JSON.parse(String(raw)) as ServerToClientMessage);
    });
  }

  static async connect(url: string): Promise<LobbyClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new LobbyClient(socket, []);
  }

  send(message: ClientToServerMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  async waitFor<T extends ServerToClientMessage["type"]>(
    type: T,
    requestId: string
  ): Promise<MessageOf<T>> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(
        message => message.type === type &&
          ("requestId" in message ? message.requestId : undefined) === requestId
      );
      if (index !== -1) {
        return this.messages.splice(index, 1)[0] as MessageOf<T>;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const failure = this.messages.find(
      message => message.type === "error" && message.requestId === requestId
    );
    if (failure) throw new Error(`Request ${requestId} failed: ${JSON.stringify(failure)}`);
    throw new Error(`Timed out waiting for ${type}/${requestId}`);
  }

  async waitForType<T extends ServerToClientMessage["type"]>(
    type: T,
    predicate: (message: MessageOf<T>) => boolean = () => true
  ): Promise<MessageOf<T>> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(
        message => message.type === type && predicate(message as MessageOf<T>)
      );
      if (index !== -1) {
        return this.messages.splice(index, 1)[0] as MessageOf<T>;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${type}`);
  }

  async waitForRoom(
    predicate: (room: RoomView) => boolean
  ): Promise<RoomView> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(
        message => message.type === "room" && predicate(message.room)
      );
      if (index !== -1) {
        return (this.messages[index] as MessageOf<"room">).room;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for room state");
  }

  async waitForProjection(
    predicate: (projection: GameProjection) => boolean
  ): Promise<GameProjection> {
    const message = await this.waitForType(
      "projection",
      message => predicate(message.projection)
    );
    return message.projection;
  }
}

const servers: GameServer[] = [];
const clients: LobbyClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
});

async function startServer(): Promise<string> {
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    roomIdFactory: () => `lobby-${servers.length + 1}`,
    catalog,
    deckRules: {
      defaultMaxCopiesPerCanonical: 40,
      cardPolicies: {
        "fixture.flame-warden": { type: "limited", maxCopies: 40 },
        "fixture.champion": { type: "limited", maxCopies: 40 }
      },
      copyRules: [
        { zones: ["mainDeck", "champion"], maxCopiesPerCanonical: 40 },
        { zones: ["legend"], maxCopiesPerCanonical: 3 },
        { zones: ["runes"], maxCopiesPerCanonical: 12 },
        { zones: ["battlefields"], maxCopiesPerCanonical: 1 }
      ],
      sizeRules: {
        legend: { minimum: 1, maximum: 1 },
        champion: { minimum: 1, maximum: 1 },
        runes: { minimum: 12, maximum: 12 },
        battlefields: { minimum: 3, maximum: 3 },
        sideboard: { minimum: 0, maximum: 10 }
      },
      sizeGroups: [
        { zones: ["mainDeck", "champion"], rule: { minimum: 40, maximum: 40 } }
      ],
      uniqueCanonicalZones: ["battlefields"]
    }
  });
  servers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("No TCP address");
  }
  return `ws://127.0.0.1:${address.port}/ws`;
}

async function connect(url: string): Promise<LobbyClient> {
  const client = await LobbyClient.connect(url);
  clients.push(client);
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  return client;
}

async function createRoom(
  client: LobbyClient,
  name: string,
  rulesetId?: string
): Promise<ClientSession> {
  client.send({
    type: "create-room",
    requestId: "create",
    playerName: name,
    ...(rulesetId === undefined ? {} : { rulesetId })
  });
  await client.waitFor("request-result", "create");
  const welcome = await client.waitForType(
    "welcome",
    message => message.session !== undefined
  );
  if (!welcome.session) throw new Error("Create welcome did not include a session");
  await client.waitForRoom(() => true);
  return welcome.session;
}

async function joinRoom(
  client: LobbyClient,
  roomId: string
): Promise<void> {
  client.send({
    type: "join-room",
    requestId: "join",
    roomId,
    playerName: "Bob"
  });
  await client.waitFor("request-result", "join");
  const welcome = await client.waitForType(
    "welcome",
    message => message.session !== undefined
  );
  if (!welcome.session) throw new Error("Join welcome did not include a session");
}

function submitDeck(
  client: LobbyClient,
  expectedRoomVersion: number,
  requestId: string
): void {
  client.send({
    type: "submit-deck",
    requestId,
    expectedRoomVersion,
    deck: {
      mainDeck: [
        { cardId: "fixture.flame-warden", quantity: 39 }
      ],
      legend: [{ cardId: "fixture.legend", quantity: 1 }],
      champion: [{ cardId: "fixture.champion", quantity: 1 }],
      runes: [{ cardId: "fixture.rune", quantity: 12 }],
      battlefields: [
        { cardId: "fixture.battlefield-1", quantity: 1 },
        { cardId: "fixture.battlefield-2", quantity: 1 },
        { cardId: "fixture.battlefield-3", quantity: 1 }
      ]
    }
  });
}

const catalog = {
  schemaVersion: 1,
  dataVersion: "lobby-fixture",
  digest: `sha256:${"a".repeat(64)}`,
  cards: [
    card("fixture.flame-warden", "Flame Warden", "Unit", "unl"),
    {
      ...card("fixture.champion", "Fixture Champion", "Unit", "unl"),
      tags: ["Champion", "Fixturechamp"],
      domains: ["Fury"]
    },
    {
      ...card("fixture.legend", "Fixture Legend", "Legend", "unl"),
      tags: ["Fixturechamp"],
      domains: ["Fury"]
    },
    card("fixture.rune", "Fixture Rune", "Rune", "unl"),
    card("fixture.battlefield-1", "Battlefield One", "Battlefield", "unl"),
    card("fixture.battlefield-2", "Battlefield Two", "Battlefield", "unl"),
    card("fixture.battlefield-3", "Battlefield Three", "Battlefield", "unl")
  ]
};

function card(
  canonicalCardId: string,
  fullName: string,
  cardType: string,
  setCode: string
) {
  return {
    id: canonicalCardId,
    canonicalCardId,
    name: fullName,
    fullName,
    cardType,
    domains: [],
    tags: [],
    setCode,
    cardNumber: canonicalCardId.slice(-3),
    variant: "standard",
    imageUrl: null,
    energy: 1,
    power: 1,
    might: null,
    ability: "Fixture."
  };
}

describe("lobby and ready flow", () => {
  it("keeps the default synthetic room behavior", async () => {
    const url = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceRoom = await createRoom(alice, "Alice");
    await joinRoom(bob, aliceRoom.roomId);

    const room = await alice.waitForRoom(
      candidate => candidate.rulesetId === RULESET_ID && candidate.status === "playing"
    );
    expect(room.players).toHaveLength(2);

    const [aliceProjection, bobProjection] = await Promise.all([
      alice.waitForProjection(projection => projection.players.length === 2),
      bob.waitForProjection(projection => projection.players.length === 2)
    ]);
    expect(aliceProjection.players[0]?.hand).toHaveLength(1);
    expect(bobProjection.players[1]?.hand).toHaveLength(1);
  });

  it("requires ready decks before an official room starts", async () => {
    const url = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceRoom = await createRoom(
      alice,
      "Alice",
      FOUNDATION_RULESET_ID
    );
    await joinRoom(bob, aliceRoom.roomId);

    const joined = await alice.waitForRoom(
      candidate => candidate.players.length === 2 && candidate.status === "waiting"
    );
    expect(joined.roomEventSeq).toBeGreaterThan(0);

    submitDeck(alice, joined.roomVersion, "alice-deck");
    const aliceDeck = await alice.waitFor(
      "request-result",
      "alice-deck"
    );
    expect(aliceDeck.roomVersion).toBeGreaterThan(joined.roomVersion);

    const aliceReadyRoom = await alice.waitForRoom(
      candidate => candidate.players.some(player => player.deckSubmitted)
    );
    submitDeck(bob, aliceReadyRoom.roomVersion, "bob-deck");
    const bobDeck = await bob.waitFor("request-result", "bob-deck");

    bob.send({
      type: "set-ready",
      requestId: "bob-ready",
      expectedRoomVersion: bobDeck.roomVersion ?? 0,
      ready: true
    });
    await bob.waitFor("request-result", "bob-ready");
    const bobReadyRoom = await bob.waitForRoom(
      candidate => candidate.players.some(player => player.ready)
    );

    alice.send({
      type: "set-ready",
      requestId: "alice-ready",
      expectedRoomVersion: bobReadyRoom.roomVersion,
      ready: true
    });
    await alice.waitFor("request-result", "alice-ready");

    const started = await alice.waitForRoom(
      candidate => candidate.status === "playing"
    );
    expect(started.players.every(player => player.ready)).toBe(true);
  });

  it("rejects an invalid deck and a stale room version without advancing state", async () => {
    const url = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceRoom = await createRoom(
      alice,
      "Alice",
      FOUNDATION_RULESET_ID
    );
    await joinRoom(bob, aliceRoom.roomId);
    const joined = await alice.waitForRoom(
      candidate => candidate.players.length === 2
    );

    alice.send({
      type: "submit-deck",
      requestId: "invalid",
      expectedRoomVersion: joined.roomVersion,
      deck: { mainDeck: [{ cardId: "unknown-card", quantity: 1 }] }
    });
    const invalid = await alice.waitFor("error", "invalid");
    expect(invalid.code).toBe("invalid-deck");

    const unchanged = await alice.waitForRoom(
      candidate => candidate.players.length === 2
    );
    alice.send({
      type: "set-ready",
      requestId: "stale",
      expectedRoomVersion: unchanged.roomVersion + 1,
      ready: true
    });
    await alice.waitFor("error", "stale");

    submitDeck(alice, unchanged.roomVersion, "stale-deck");
    await alice.waitFor("request-result", "stale-deck");
    const submitted = await alice.waitForRoom(
      candidate => candidate.players.some(player => player.deckSubmitted)
    );
    alice.send({
      type: "set-ready",
      requestId: "stale-version",
      expectedRoomVersion: submitted.roomVersion + 1,
      ready: true
    });
    const staleVersion = await alice.waitFor("error", "stale-version");
    expect(staleVersion.code).toBe("stale-version");
  });

  it("replays room and game events from requested cursors", async () => {
    const url = await startServer();
    const alice = await connect(url);
    await createRoom(alice, "Alice");

    const room = await alice.waitForRoom(candidate => true);
    alice.send({
      type: "sync-events",
      requestId: "sync",
      afterRoomEventSeq: 0
    });
    await alice.waitFor("request-result", "sync");
    const replay = await alice.waitForType("room-events");
    expect(replay?.events.length).toBeGreaterThan(0);
    expect(room.roomEventSeq).toBeGreaterThan(0);
  });

  it("binds game replay to the current connection on both resume paths", async () => {
    const url = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceSession = await createRoom(alice, "Alice");
    await joinRoom(bob, aliceSession.roomId);
    const room = await alice.waitForRoom(candidate => true);

    alice.send({
      type: "sync-events",
      requestId: "sync",
      afterEventSeq: 0
    });
    const replay = await alice.waitFor("request-result", "sync");
    const gameReplay = await alice.waitForType("events");
    expect(gameReplay.events.some(event => event.type === "game-started"))
      .toBe(true);

    const resumed = await LobbyClient.connect(url);
    clients.push(resumed);
    resumed.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: room.roomId,
      resumeToken: aliceSession.resumeToken,
      afterEventSeq: 0
    });
    await resumed.waitForType("welcome", message => message.resumed === true);
    const resumedReplay = await resumed.waitForType("events");
    expect(resumedReplay.events.some(event => event.type === "game-started"))
      .toBe(true);

    alice.send({
      type: "sync-events",
      requestId: "replaced",
      afterEventSeq: 0
    });
    const replaced = await alice.waitFor("error", "replaced");
    expect(replaced.code).toBe("session-replaced");
    expect(gameReplay.nextEventSeq).toBeGreaterThan(0);
  });
});
