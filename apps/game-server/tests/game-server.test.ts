import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  type ClientSession,
  type ClientToServerMessage,
  type GameProjection,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { createGameServer, type GameServer } from "../src/server.js";

type MessageByType<T extends ServerToClientMessage["type"]> =
  Extract<ServerToClientMessage, { type: T }>;

class TestClient {
  private readonly queued: ServerToClientMessage[] = [];
  private readonly waiters = new Set<() => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", raw => {
      this.queued.push(JSON.parse(String(raw)) as ServerToClientMessage);
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
    this.socket.close();
  }

  async waitFor<T extends ServerToClientMessage["type"]>(
    type: T,
    predicate: (message: MessageByType<T>) => boolean,
    label: string
  ): Promise<MessageByType<T>> {
    const deadline = Date.now() + 2_000;

    while (true) {
      const index = this.queued.findIndex(
        (message): message is MessageByType<T> =>
          message.type === type && predicate(message as MessageByType<T>)
      );
      if (index !== -1) {
        const [message] = this.queued.splice(index, 1);
        return message as MessageByType<T>;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(this.queued)}`);
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

const servers: GameServer[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
});

async function startServer(): Promise<{ server: GameServer; url: string }> {
  let roomNumber = 0;
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    roomIdFactory: () => `room-${++roomNumber}`
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

async function createRoom(client: TestClient, name: string): Promise<ClientSession> {
  client.send({ type: "create-room", requestId: "create-1", playerName: name });
  await client.waitFor(
    "request-result",
    message => message.type === "request-result" && message.requestId === "create-1",
    "create receipt"
  );
  const welcome = await client.waitFor("welcome", message => message.type === "welcome", "create welcome");
  if (!welcome.session) throw new Error("Create welcome did not include a session");
  return welcome.session;
}

async function joinRoom(
  client: TestClient,
  name: string,
  roomId: string
): Promise<ClientSession> {
  client.send({ type: "join-room", requestId: "join-1", roomId, playerName: name });
  await client.waitFor(
    "request-result",
    message => message.type === "request-result" && message.requestId === "join-1",
    "join receipt"
  );
  const welcome = await client.waitFor("welcome", message => message.type === "welcome", "join welcome");
  if (!welcome.session) throw new Error("Join welcome did not include a session");
  return welcome.session;
}

async function waitForProjection(
  client: TestClient,
  predicate: (projection: GameProjection) => boolean,
  label: string
): Promise<GameProjection> {
  const message = await client.waitFor(
    "projection",
    candidate => candidate.type === "projection" && predicate(candidate.projection),
    label
  );
  return message.projection;
}

describe("game server", () => {
  it("rejects room operations until hello completes", async () => {
    const { url } = await startServer();
    const client = await TestClient.connect(url);
    clients.push(client);

    client.send({ type: "ping" });
    await client.waitFor("pong", message => message.type === "pong", "pre-handshake pong");

    client.send({ type: "create-room", requestId: "create-1", playerName: "Alice" });
    const error = await client.waitFor(
      "error",
      message => message.type === "error" && message.code === "handshake-required",
      "handshake error"
    );
    expect(error.code).toBe("handshake-required");
  });

  it("creates, joins, plays, prompts, and keeps hidden state private", async () => {
    const { url } = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);

    const aliceSession = await createRoom(alice, "Alice");
    const bobSession = await joinRoom(bob, "Bob", aliceSession.roomId);

    const aliceInitial = await waitForProjection(
      alice,
      projection => projection.players.length === 2 && projection.prompt === null,
      "Alice initial projection"
    );
    const bobInitial = await waitForProjection(
      bob,
      projection => projection.players.length === 2 && projection.prompt === null,
      "Bob initial projection"
    );
    expect(aliceInitial.players[0]?.hand).toHaveLength(1);
    expect(aliceInitial.players[1]?.hand).toHaveLength(0);
    expect(bobInitial.players[0]?.hand).toHaveLength(0);
    expect(bobInitial.players[1]?.hand).toHaveLength(1);

    alice.send({
      type: "command",
      requestId: "play-request",
      commandId: "play-command",
      expectedVersion: aliceInitial.version,
      command: {
        type: "play-card",
        instanceId: `${aliceSession.playerId}:trigger-conquer`
      }
    });
    await alice.waitFor(
      "request-result",
      message => message.type === "request-result" &&
        message.requestId === "play-request" &&
        message.commandId === "play-command",
      "play receipt"
    );

    const prompted = await waitForProjection(
      alice,
      projection => projection.prompt !== null,
      "prompt projection"
    );
    const prompt = prompted.prompt;
    if (!prompt) throw new Error("Expected a prompt");
    expect(prompt.ownerPlayerId).toBe(aliceSession.playerId);

    await waitForProjection(
      bob,
      projection =>
        projection.prompt === null &&
        projection.waitingForPlayerId === aliceSession.playerId,
      "private prompt projection"
    );

    alice.send({
      type: "command",
      requestId: "respond-request",
      commandId: "respond-command",
      expectedVersion: prompted.version,
      command: {
        type: "respond-to-prompt",
        promptId: prompt.id,
        optionId: "resolve",
        stateVersion: prompt.stateVersion
      }
    });
    await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "respond-request",
      "respond receipt"
    );

    await waitForProjection(
      alice,
      projection =>
        projection.prompt === null &&
        projection.players.some(
          player => player.id === bobSession.playerId && player.life === 19
        ),
      "resolved projection"
    );
  });

  it("replays commands, rejects conflicts, and ignores a replaced socket close", async () => {
    const { server, url } = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceSession = await createRoom(alice, "Alice");
    await joinRoom(bob, "Bob", aliceSession.roomId);
    const initial = await waitForProjection(
      alice,
      projection => projection.players.length === 2 && projection.prompt === null,
      "initial projection"
    );

    alice.send({
      type: "command",
      requestId: "pass-1",
      commandId: "pass-command",
      expectedVersion: initial.version,
      command: { type: "pass" }
    });
    const first = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "pass-1",
      "first receipt"
    );

    alice.send({
      type: "command",
      requestId: "pass-2",
      commandId: "pass-command",
      expectedVersion: initial.version,
      command: { type: "pass" }
    });
    const duplicate = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "pass-2",
      "duplicate receipt"
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.appliedVersion).toBe(first.appliedVersion);

    alice.send({
      type: "command",
      requestId: "conflict",
      commandId: "pass-command",
      expectedVersion: initial.version,
      command: {
        type: "play-card",
        instanceId: `${aliceSession.playerId}:trigger-conquer`
      }
    });
    const conflict = await alice.waitFor(
      "error",
      message => message.type === "error" && message.requestId === "conflict",
      "conflict error"
    );
    expect(conflict.code).toBe("idempotency-conflict");

    const resumed = await TestClient.connect(url);
    clients.push(resumed);
    resumed.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
    await resumed.waitFor("welcome", message => message.type === "welcome", "resume handshake");
    resumed.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: aliceSession.roomId,
      resumeToken: aliceSession.resumeToken
    });
    const resumedWelcome = await resumed.waitFor(
      "welcome",
      message => message.type === "welcome" && message.resumed === true,
      "resumed welcome"
    );
    expect(resumedWelcome.session).toEqual(aliceSession);

    alice.send({
      type: "command",
      requestId: "old-socket-command",
      commandId: "old-socket-pass",
      expectedVersion: first.appliedVersion ?? 0,
      command: { type: "pass" }
    });
    const replaced = await alice.waitFor(
      "error",
      message => message.type === "error" && message.code === "session-replaced",
      "replaced socket command rejection"
    );
    expect(replaced.code).toBe("session-replaced");

    alice.close();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(server.rooms.get(aliceSession.roomId)?.players.size).toBe(2);

    resumed.send({ type: "ping" });
    await resumed.waitFor("pong", message => message.type === "pong", "resumed pong");
  });
});
