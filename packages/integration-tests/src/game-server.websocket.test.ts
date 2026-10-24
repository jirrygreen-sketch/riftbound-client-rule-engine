import { afterEach, describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  RULESET_ID,
  type ClientSession,
  type GameProjection,
  type ServerToClientMessage
} from "@riftbound/protocol";
import type { GameServer } from "@riftbound/game-server-src";
import { ProtocolWebSocketClient } from "./test-support/websocket-client.js";

type CreateGameServer = typeof import("@riftbound/game-server-src").createGameServer;

const clients: ProtocolWebSocketClient[] = [];
const servers: GameServer[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
});

async function loadCreateGameServer(): Promise<CreateGameServer> {
  try {
    const module = await import("@riftbound/game-server-src");
    if (typeof module.createGameServer !== "function") {
      throw new Error("createGameServer export is missing");
    }
    return module.createGameServer;
  } catch (error: unknown) {
    throw new Error(
      "The real game-server API could not be loaded. " +
      "Fix its exports and protocol/engine integration instead of skipping this suite.",
      { cause: error }
    );
  }
}

async function startServer(): Promise<{ url: string; server: GameServer }> {
  const createGameServer = await loadCreateGameServer();
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
    throw new Error("Game server did not expose a TCP address");
  }

  return {
    server,
    url: `ws://127.0.0.1:${address.port}/ws`
  };
}

async function waitForCondition(
  predicate: () => boolean,
  label: string,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function connect(url: string): Promise<ProtocolWebSocketClient> {
  const client = await ProtocolWebSocketClient.connect(url);
  clients.push(client);
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  await client.waitFor(
    "welcome",
    message => message.type === "welcome" && message.resumed !== true,
    "initial welcome"
  );
  return client;
}

function requireSession(
  message: Extract<ServerToClientMessage, { type: "welcome" }>
): ClientSession {
  if (!message.session) {
    throw new Error(`Welcome did not contain a session: ${JSON.stringify(message)}`);
  }
  return message.session;
}

async function createRoom(
  client: ProtocolWebSocketClient,
  playerName: string
): Promise<ClientSession> {
  client.send({
    type: "create-room",
    requestId: "create-1",
    playerName,
    rulesetId: RULESET_ID
  });
  const receipt = await client.waitFor(
    "request-result",
    message => message.type === "request-result" && message.requestId === "create-1",
    "create-room receipt"
  );
  expect(receipt.ok).toBe(true);
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome",
    "create-room welcome"
  );
  return requireSession(welcome);
}

async function joinRoom(
  client: ProtocolWebSocketClient,
  playerName: string,
  roomId: string
): Promise<ClientSession> {
  client.send({ type: "join-room", requestId: "join-1", roomId, playerName });
  const receipt = await client.waitFor(
    "request-result",
    message => message.type === "request-result" && message.requestId === "join-1",
    "join-room receipt"
  );
  expect(receipt.ok).toBe(true);
  const welcome = await client.waitFor(
    "welcome",
    message => message.type === "welcome",
    "join-room welcome"
  );
  return requireSession(welcome);
}

async function waitForProjection(
  client: ProtocolWebSocketClient,
  predicate: (projection: GameProjection) => boolean,
  label: string
) {
  return client.waitFor(
    "projection",
    message => message.type === "projection" && predicate(message.projection),
    label
  );
}

describe("synthetic-demo WebSocket vertical slice", () => {
  // The first real vertical-slice request now takes about 8s under the shared
  // gate load; keep a bounded margin so a stalled WebSocket still fails.
  it("creates a room, joins a second player, plays, prompts, and responds", async () => {
    const { url } = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);

    const aliceSession = await createRoom(alice, "Alice");
    expect(aliceSession.roomId).toBe("room-1");
    expect(aliceSession.playerId).toBe("player-1");

    const bobSession = await joinRoom(bob, "Bob", aliceSession.roomId);
    expect(bobSession.playerId).toBe("player-2");

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

    expect(aliceInitial.projection.players[0]?.hand).toHaveLength(1);
    expect(aliceInitial.projection.players[1]?.hand).toHaveLength(0);
    expect(bobInitial.projection.players[0]?.hand).toHaveLength(0);
    expect(bobInitial.projection.players[1]?.hand).toHaveLength(1);

    alice.send({
      type: "command",
      requestId: "play-request",
      commandId: "play-command",
      expectedVersion: aliceInitial.projection.version,
      command: {
        type: "play-card",
        instanceId: `${aliceSession.playerId}:trigger-conquer`
      }
    });

    const playReceipt = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "play-request",
      "play-card receipt"
    );
    expect(playReceipt.commandId).toBe("play-command");
    expect(playReceipt.duplicate).not.toBe(true);

    const prompted = await waitForProjection(
      alice,
      projection => projection.prompt !== null,
      "trigger prompt projection"
    );
    const prompt = prompted.projection.prompt;
    if (!prompt) throw new Error("Expected a prompt projection");

    expect(prompt.ownerPlayerId).toBe(aliceSession.playerId);
    expect(prompt.playerId).toBe(aliceSession.playerId);
    expect(prompt.reason).toBe("trigger-conquer");

    await waitForProjection(
      bob,
      projection =>
        projection.prompt === null &&
        projection.waitingForPlayerId === aliceSession.playerId,
      "Bob hidden prompt projection"
    );

    alice.send({
      type: "command",
      requestId: "respond-request",
      commandId: "respond-command",
      expectedVersion: prompted.projection.version,
      command: {
        type: "respond-to-prompt",
        promptId: prompt.id,
        optionId: "resolve",
        stateVersion: prompt.stateVersion
      }
    });

    const respondReceipt = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "respond-request",
      "respond receipt"
    );
    expect(respondReceipt.ok).toBe(true);

    const resolved = await waitForProjection(
      alice,
      projection =>
        projection.prompt === null &&
        projection.players.some(player => player.id === bobSession.playerId && player.life === 19),
      "resolved prompt projection"
    );
    expect(resolved.projection.events.some(event => event.type === "damage-dealt")).toBe(true);
  }, 30_000);

  it("reconnects with the issued token and resumes the same authoritative session", async () => {
    const { url, server } = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const session = await createRoom(alice, "Alice");
    const bobSession = await joinRoom(bob, "Bob", session.roomId);
    const before = await waitForProjection(
      alice,
      projection =>
        projection.players.length === 2 &&
        projection.activePlayerId === session.playerId,
      "initial playing projection"
    );

    alice.close();
    await waitForCondition(
      () => server.rooms.get(session.roomId)?.players.size === 1,
      "server to observe Alice disconnecting"
    );
    const disconnectedRoom = await bob.waitFor(
      "room",
      message =>
        message.type === "room" &&
        message.room.players.find(player => player.id === session.playerId)?.connected === false &&
        message.room.players.find(player => player.id === bobSession.playerId)?.connected === true,
      "Bob to observe Alice disconnecting"
    );
    expect(disconnectedRoom.room.status).toBe("playing");

    const resumedClient = await connect(url);
    resumedClient.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: session.roomId,
      resumeToken: session.resumeToken
    });

    const welcome = await resumedClient.waitFor(
      "welcome",
      message => message.type === "welcome" && message.resumed === true,
      "resumed welcome"
    );
    expect(requireSession(welcome)).toEqual(session);

    const after = await waitForProjection(
      resumedClient,
      projection =>
        projection.version === before.projection.version &&
        projection.activePlayerId === session.playerId,
      "projection after reconnect"
    );
    expect(after.projection.players[0]?.hand).toHaveLength(
      before.projection.players[0]?.hand.length ?? -1
    );
  });

  it("keeps the room playable while a player is disconnected and after reconnecting", async () => {
    const { url } = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const session = await createRoom(alice, "Alice");
    const bobSession = await joinRoom(bob, "Bob", session.roomId);
    const initial = await waitForProjection(
      alice,
      projection => projection.players.length === 2 && projection.activePlayerId === session.playerId,
      "initial projection"
    );

    alice.send({
      type: "command",
      requestId: "connected-pass",
      commandId: "connected-pass-command",
      expectedVersion: initial.projection.version,
      command: { type: "pass" }
    });
    const connectedPass = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "connected-pass",
      "turn pass while connected"
    );
    await waitForProjection(
      bob,
      projection =>
        projection.version === connectedPass.appliedVersion &&
        projection.activePlayerId === bobSession.playerId,
      "Bob turn projection"
    );

    alice.close();
    await bob.waitFor(
      "room",
      message =>
        message.type === "room" &&
        message.room.players.find(player => player.id === session.playerId)?.connected === false,
      "disconnect room broadcast"
    );

    bob.send({
      type: "command",
      requestId: "offline-pass",
      commandId: "offline-pass-command",
      expectedVersion: connectedPass.appliedVersion ?? 0,
      command: { type: "pass" }
    });
    const offlinePass = await bob.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "offline-pass",
      "command while a player is disconnected"
    );
    const offlineProjection = await waitForProjection(
      bob,
      projection =>
        projection.version === offlinePass.appliedVersion &&
        projection.activePlayerId === session.playerId,
      "projection after offline action"
    );

    const resumedClient = await connect(url);
    resumedClient.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: session.roomId,
      resumeToken: session.resumeToken
    });
    await resumedClient.waitFor(
      "welcome",
      message => message.type === "welcome" && message.resumed === true,
      "resumed welcome"
    );

    resumedClient.send({
      type: "command",
      requestId: "reconnected-pass",
      commandId: "reconnected-pass-command",
      expectedVersion: offlineProjection.projection.version,
      command: { type: "pass" }
    });
    const reconnectedPass = await resumedClient.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "reconnected-pass",
      "command after reconnecting"
    );

    await waitForProjection(
      resumedClient,
      projection =>
        projection.version === reconnectedPass.appliedVersion &&
        projection.activePlayerId === bobSession.playerId,
      "Alice projection after reconnecting"
    );
    await waitForProjection(
      bob,
      projection =>
        projection.version === reconnectedPass.appliedVersion &&
        projection.activePlayerId === bobSession.playerId,
      "Bob projection after Alice reconnects"
    );
  });

  it("replays duplicates, rejects stale versions, and rejects commandId reuse with another payload", async () => {
    const { url } = await startServer();
    const alice = await connect(url);
    const bob = await connect(url);
    const aliceSession = await createRoom(alice, "Alice");
    await joinRoom(bob, "Bob", aliceSession.roomId);
    const initial = await waitForProjection(
      alice,
      projection => projection.players.length === 2 && projection.prompt === null,
      "initial projection"
    );

    const command = {
      type: "command" as const,
      requestId: "pass-request-1",
      commandId: "pass-command",
      expectedVersion: initial.projection.version,
      command: { type: "pass" as const }
    };
    alice.send(command);

    const first = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "pass-request-1",
      "first pass receipt"
    );
    expect(first.commandId).toBe("pass-command");
    expect(first.appliedVersion).toEqual(expect.any(Number));
    expect(first.eventSeq).toEqual(expect.any(Number));
    expect(first.duplicate).not.toBe(true);

    alice.send({ ...command, requestId: "pass-request-2" });
    const duplicate = await alice.waitFor(
      "request-result",
      message => message.type === "request-result" && message.requestId === "pass-request-2",
      "duplicate pass receipt"
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.appliedVersion).toBe(first.appliedVersion);
    expect(duplicate.eventSeq).toBe(first.eventSeq);

    alice.send({
      ...command,
      requestId: "stale-request",
      commandId: "stale-command",
      expectedVersion: initial.projection.version - 1
    });
    const stale = await alice.waitFor(
      "error",
      message => message.type === "error" && message.requestId === "stale-request",
      "stale version rejection"
    );
    expect(stale.code).toBe("stale-version");

    alice.send({
      ...command,
      requestId: "conflict-request",
      command: {
        type: "play-card",
        instanceId: `${aliceSession.playerId}:trigger-conquer`
      }
    });
    const conflict = await alice.waitFor(
      "error",
      message => message.type === "error" && message.requestId === "conflict-request",
      "idempotency conflict"
    );
    expect(conflict.code).toBe("idempotency-conflict");
  });
});
