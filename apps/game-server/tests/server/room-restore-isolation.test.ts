import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  DUEL_RULESET_ID,
  FOUNDATION_RULESET_ID,
  type ClientSession,
  type ServerToClientMessage,
  type ServerTransport
} from "@riftbound/protocol";
import {
  PROTOCOL_V2_VERSION,
  isV2Projection,
  type V2Command,
  type V2Projection
} from "../../../../packages/protocol/dist/v2/index.js";
import { stableStringify } from "@riftbound/replay-core/full-product";
import { createGameServer, type GameServer } from "../../src/server.js";
import { FileRoomStore } from "../../src/file-room-store.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { RuntimeJournalWriter, type RuntimeJournal } from "../../src/engine-runtime/index.js";
import { p4RuntimeFixtureCatalog } from "../duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "../duel/fixtures/setup-adapter-catalog.js";

const servers: GameServer[] = [];
const sockets: WebSocket[] = [];
const directories: string[] = [];

class Client {
  readonly messages: ServerToClientMessage[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", raw => {
      this.messages.push(JSON.parse(String(raw)) as ServerToClientMessage);
    });
  }

  send(value: unknown): void { this.socket.send(JSON.stringify(value)); }

  async wait<T extends ServerToClientMessage["type"]>(
    type: T,
    predicate: (value: Extract<ServerToClientMessage, { type: T }>) => boolean,
    label: string
  ): Promise<Extract<ServerToClientMessage, { type: T }>> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(message =>
        message.type === type && predicate(message as Extract<ServerToClientMessage, { type: T }>));
      if (index >= 0) {
        return this.messages.splice(index, 1)[0] as Extract<ServerToClientMessage, { type: T }>;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(this.messages)}`);
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      this.socket.once("close", resolve);
      this.socket.close();
    });
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function connect(url: string): Promise<Client> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client = new Client(socket);
  client.send({ type: "hello", protocolVersion: PROTOCOL_V2_VERSION });
  await client.wait("welcome", message => message.type === "welcome", "v2 welcome");
  return client;
}

async function startServer(directory: string): Promise<{ server: GameServer; url: string }> {
  const server = createGameServer({
    host: "127.0.0.1",
    port: Number(process.env.SWARM_PORT_BASE ?? 35620),
    storageDirectory: directory,
    catalog: p4RuntimeFixtureCatalog,
    duelRandomIndex: () => 0
  });
  servers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server has no TCP address");
  return { server, url: `ws://127.0.0.1:${address.port}/ws` };
}

function publicProjection(room: GameRoom, playerId: string): V2Projection {
  let packet: unknown;
  room.sendProjection(playerId, message => { packet = message; });
  if (!isRecord(packet) || packet.type !== "projection" || !isV2Projection(packet.projection)) {
    throw new Error("The production room did not emit a V2 projection");
  }
  return packet.projection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function submitMulligan(
  room: GameRoom,
  session: ClientSession,
  connectionId: string,
  commandId: string,
  transport: (message: unknown) => void
): void {
  room.submitEngineV2(session, connectionId, {
    type: "mulligan",
    commandId,
    stateVersion: 0,
    selectedObjectIds: []
  }, transport);
}

async function createDivergingArchive(
  directory: string,
  roomId: string
): Promise<{ readonly journal: RuntimeJournal; readonly sessions: readonly ClientSession[] }> {
  const catalog = await loadCardCatalogRuntime({ catalog: p4RuntimeFixtureCatalog });
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const messages: ServerToClientMessage[] = [];
  const transport: ServerTransport = message => { messages.push(message); };
  const firstConnection = room.join("Alice", transport, "archive-a");
  const secondConnection = room.join("Bob", transport, "archive-b");
  const sessions: readonly ClientSession[] = [firstConnection, secondConnection].map(connection => ({
    roomId,
    playerId: connection.playerId,
    resumeToken: connection.resumeToken
  }));
  const connections = [firstConnection, secondConnection] as const;
  for (const [index, session] of sessions.entries()) {
    room.submitDeck(session, connections[index]!.connectionId, room.currentRoomVersion,
      index === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission,
      `archive-deck-${index}`, transport);
    room.setReady(session, connections[index]!.connectionId, room.currentRoomVersion,
      true, `archive-ready-${index}`, transport);
  }

  const setup = publicProjection(room, "player-1");
  if (setup.phase !== "setup" || setup.pendingChoice.status !== "pending") {
    throw new Error("The production V2 room did not open its mulligan window");
  }
  const firstIndex = setup.pendingChoice.ownerPlayerId === "player-1" ? 0 : 1;
  submitMulligan(room, sessions[firstIndex]!, connections[firstIndex]!.connectionId, "archive-mulligan-a", transport);
  submitMulligan(room, sessions[1 - firstIndex]!, connections[1 - firstIndex]!.connectionId, "archive-mulligan-b", transport);

  const main = publicProjection(room, "player-1");
  if (main.phase !== "main") throw new Error("The production V2 room did not enter Main");
  const actorIndex = main.activePlayerId === "player-1" ? 0 : 1;
  room.submitEngineV2(sessions[actorIndex]!, connections[actorIndex]!.connectionId, {
    type: "pass",
    commandId: "accepted-pass",
    stateVersion: main.stateVersion
  }, transport);
  expect(messages.length).toBeGreaterThan(0);

  const archive = room.exportArchive();
  const journal = archive.engineRuntimeJournal;
  if (journal === null || journal === undefined || journal.entries.length === 0) {
    throw new Error("The production V2 room did not journal its accepted command");
  }

  const store = new FileRoomStore(directory, async () => catalog);
  await store.create(room);
  await store.save(room);
  const healthyRoom = new GameRoom("healthy-room");
  await store.create(healthyRoom);
  await store.save(healthyRoom);
  await store.close();
  return { journal, sessions };
}

function rehashWithRejectedCommand(journal: RuntimeJournal): RuntimeJournal {
  const original = journal.entries[0]!;
  const forged: V2Command = {
    type: "pass",
    commandId: original.command.commandId,
    stateVersion: original.command.stateVersion + 10_000
  };
  const writer = new RuntimeJournalWriter({
    header: journal.header,
    stateDigest: "0".repeat(64),
    privateStateDigest: "0".repeat(64)
  });
  const { kind: _kind, seq: _seq, integrity: _integrity, ...appendInput } = original;
  writer.append({ ...appendInput, command: forged, payload: forged });
  return writer.snapshot();
}

async function rewriteLastArchiveRecord(
  directory: string,
  divergingRoomId: string
): Promise<void> {
  const roomHash = createHash("sha256").update(divergingRoomId, "utf8").digest("hex");
  const logPath = path.join(directory, roomHash, "archive.log");
  const line = (await readFile(logPath, "utf8")).trimEnd().split("\n").at(-1)!;
  const persisted = JSON.parse(line) as unknown;
  if (!isRecord(persisted) || !isRecord(persisted.record) || !Array.isArray(persisted.record.entries)) {
    throw new Error("The private archive log record has an invalid shape");
  }
  const event = persisted.record.entries.at(-1)?.event;
  if (!isRecord(event) || event.type !== "room-archive" || !isRecord(event.archive) ||
      !isRecord(event.archive.engineRuntimeJournal)) {
    throw new Error("The saved production room has no engine journal to corrupt");
  }
  event.archive.engineRuntimeJournal = rehashWithRejectedCommand(
    event.archive.engineRuntimeJournal as RuntimeJournal
  );
  await writeFile(logPath, `${JSON.stringify({
    checksum: createHash("sha256").update(stableStringify(persisted.record)).digest("hex"),
    record: persisted.record
  })}\n`, "utf8");
}

describe("room restore isolation", () => {
  it("quarantines one journal divergence while another room starts and remains joinable", async () => {
    const scratch = path.join(
      "/tmp",
      process.env.SWARM_TASK ?? "RIFT-1077-room-restore-isolation-beta-start-log"
    );
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(path.join(
      scratch,
      "restore-"
    ));
    directories.push(directory);
    const divergingRoomId = "3dc25522-room-restore-isolation";
    const { sessions } = await createDivergingArchive(directory, divergingRoomId);
    await rewriteLastArchiveRecord(directory, divergingRoomId);

    const { server, url } = await startServer(directory);
    expect(server.rooms.has("healthy-room")).toBe(true);
    expect(server.rooms.has(divergingRoomId)).toBe(false);
    expect(server.quarantinedRooms).toHaveLength(1);
    expect(server.quarantinedRooms[0]).toMatchObject({
      roomId: divergingRoomId,
      rulesetId: DUEL_RULESET_ID,
      rulesetVersion: "core-1.5",
      engineVersion: "@riftbound/engine-core/current",
      protocolVersion: PROTOCOL_V2_VERSION,
      reason: expect.stringContaining("Journal replay failed")
    });

    const sourceHash = createHash("sha256").update(divergingRoomId, "utf8").digest("hex");
    await expect(stat(path.join(directory, sourceHash))).rejects.toMatchObject({ code: "ENOENT" });
    const quarantinePath = server.quarantinedRooms[0]!.quarantinePath;
    const preservedLog = await readFile(path.join(quarantinePath, "archive.log"));
    expect(preservedLog.byteLength).toBeGreaterThan(0);
    expect(preservedLog.toString("utf8")).toContain("accepted-pass");
    const marker = JSON.parse(await readFile(path.join(quarantinePath, "quarantine.json"), "utf8"));
    expect(marker).toMatchObject({
      roomId: divergingRoomId,
      rulesetId: DUEL_RULESET_ID,
      rulesetVersion: "core-1.5",
      engineVersion: "@riftbound/engine-core/current",
      protocolVersion: PROTOCOL_V2_VERSION
    });

    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server has no TCP address");
    const health = await fetch(`http://127.0.0.1:${address.port}/health`).then(response => response.json());
    expect(health).toMatchObject({
      status: "ok",
      rooms: 1,
      quarantinedRooms: [{
        roomId: divergingRoomId,
        rulesetId: DUEL_RULESET_ID,
        rulesetVersion: "core-1.5",
        engineVersion: "@riftbound/engine-core/current",
        protocolVersion: PROTOCOL_V2_VERSION
      }]
    });
    const repeatHealth = await fetch(`http://127.0.0.1:${address.port}/health`).then(response => response.json());
    expect(repeatHealth).toEqual(health);
    await writeFile(path.join(quarantinePath, "quarantine.json"), "{broken\n", "utf8");
    const damagedHealth = await fetch(`http://127.0.0.1:${address.port}/health`).then(response => response.json());
    expect(damagedHealth).toEqual(health);

    const healthy = await connect(url);
    healthy.send({ type: "join-room", requestId: "healthy-join", roomId: "healthy-room", playerName: "Alice" });
    expect(await healthy.wait("request-result", message =>
      message.type === "request-result" && message.requestId === "healthy-join", "healthy room receipt"))
      .toMatchObject({ ok: true });
    expect(server.rooms.get("healthy-room")?.playerCount).toBe(1);

    const blocked = await connect(url);
    blocked.send({
      type: "join-room",
      requestId: "quarantined-join",
      roomId: divergingRoomId,
      playerName: "Late"
    });
    expect(await blocked.wait("error", message =>
      message.type === "error" && message.requestId === "quarantined-join", "quarantined room error"))
      .toMatchObject({
        code: "room-not-found",
        message: expect.stringContaining(quarantinePath)
      });

    const resumedBlocked = await connect(url);
    resumedBlocked.send({
      type: "hello",
      protocolVersion: PROTOCOL_V2_VERSION,
      roomId: divergingRoomId,
      resumeToken: sessions[0]!.resumeToken
    });
    expect(await resumedBlocked.wait("error", message =>
      message.type === "error" && !("requestId" in message), "quarantined resume error"))
      .toMatchObject({ code: "room-not-found", message: expect.stringContaining(quarantinePath) });

    const retryStore = new FileRoomStore(directory, async () => {
      throw new Error("The quarantined room must not reload its catalog");
    });
    await expect(retryStore.create(new GameRoom(divergingRoomId)))
      .rejects.toThrow(/already exists|quarantine/);
    await retryStore.close();
  }, 300_000);

  it("does not quarantine a room when the shared catalog itself cannot load", async () => {
    const scratch = path.join(
      "/tmp",
      process.env.SWARM_TASK ?? "RIFT-1077-room-restore-isolation-beta-start-log"
    );
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(path.join(scratch, "shared-catalog-failure-"));
    directories.push(directory);
    const room = new GameRoom("foundation-room", FOUNDATION_RULESET_ID);
    const initial = new FileRoomStore(directory, async () => {
      throw new Error("catalog lookup should not occur while saving");
    });
    await initial.create(room);
    await initial.save(room);
    await initial.close();

    const failing = new FileRoomStore(directory, async () => {
      throw new Error("shared catalog unavailable");
    });
    await expect(failing.list()).rejects.toThrow(/shared card catalog.*shared catalog unavailable/i);
    expect(await failing.inspectQuarantined()).toEqual([]);
    const source = path.join(
      directory,
      createHash("sha256").update(room.roomId, "utf8").digest("hex"),
      "archive.log"
    );
    expect((await stat(source)).isFile()).toBe(true);
    await failing.close();
  }, 120_000);

});
