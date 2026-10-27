import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DUEL_RULESET_ID,
  type ClientSession,
  type ServerTransport
} from "@riftbound/protocol";
import { stableStringify } from "@riftbound/replay-core/full-product";
import {
  isV2CommandReceipt,
  isV2Projection,
  type V2Command,
  type V2Projection
} from "../../../../packages/protocol/dist/v2/index.js";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import { FileRoomStore } from "../../src/file-room-store.js";
import { GameRoom, type RoomArchive, type RoomConnection } from "../../src/room.js";
import { createGameServer, type GameServer } from "../../src/server.js";
import { PersistentRoomArchiveStore } from "../../src/storage/persistent-room-store.js";
import { RuntimeJournalWriter, type RuntimeJournal } from "../../src/engine-runtime/index.js";
import { p4RuntimeFixtureCatalog } from "../duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "../duel/fixtures/setup-adapter-catalog.js";

const roots: string[] = [];
const servers: GameServer[] = [];
const transport: ServerTransport = () => undefined;

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function temporaryRoot(label: string): Promise<string> {
  const base = path.join(
    "/tmp",
    process.env.SWARM_TASK ?? "RIFT-1100-room-restore-startup-time"
  );
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, `${label}-`));
  roots.push(root);
  return root;
}

async function fixtureCatalog(): Promise<CardCatalogRuntime> {
  return loadCardCatalogRuntime({ catalog: p4RuntimeFixtureCatalog });
}

function room(roomId: string, catalog: CardCatalogRuntime): GameRoom {
  return new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
}

function connectionSession(roomId: string, connection: RoomConnection): ClientSession {
  return {
    roomId,
    playerId: connection.playerId,
    resumeToken: connection.resumeToken
  };
}

function projectionFor(room: GameRoom, playerId: string): V2Projection {
  let projection: V2Projection | null = null;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection" &&
        isV2Projection((message as { readonly projection?: unknown }).projection)) {
      projection = (message as { readonly projection: V2Projection }).projection;
    }
  });
  if (projection === null) throw new Error("V2 room did not emit a projection");
  return projection;
}

function submit(
  room: GameRoom,
  session: ClientSession,
  connection: RoomConnection,
  command: V2Command
): void {
  let receipt: unknown;
  room.submitEngineV2(session, connection.connectionId, command, message => {
    if (isV2CommandReceipt(message)) receipt = message;
  });
  if (!isV2CommandReceipt(receipt)) throw new Error("V2 room did not return a command receipt");
  if (!receipt.accepted) throw new Error(`Command rejected: ${receipt.rejection ?? "unknown"}`);
}

async function startedRoom(
  roomId: string,
  catalog: CardCatalogRuntime
): Promise<{
  readonly room: GameRoom;
  readonly sessions: readonly ClientSession[];
  readonly connections: readonly RoomConnection[];
}> {
  const game = room(roomId, catalog);
  const first = game.join("Alice", transport, `${roomId}-a`);
  const second = game.join("Bob", transport, `${roomId}-b`);
  const sessions = [connectionSession(roomId, first), connectionSession(roomId, second)];
  const connections = [first, second] as const;
  for (const [index, session] of sessions.entries()) {
    game.submitDeck(
      session,
      connections[index]!.connectionId,
      game.currentRoomVersion,
      index === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission,
      `${roomId}-deck-${index}`,
      transport
    );
    game.setReady(
      session,
      connections[index]!.connectionId,
      game.currentRoomVersion,
      true,
      `${roomId}-ready-${index}`,
      transport
    );
  }
  let setup = projectionFor(game, "player-1");
  if (setup.phase !== "setup" || setup.pendingChoice.status !== "pending") {
    throw new Error("Production V2 room did not open setup");
  }
  const firstOwner = setup.pendingChoice.ownerPlayerId;
  const firstIndex = firstOwner === "player-1" ? 0 : 1;
  for (const index of [firstIndex, 1 - firstIndex]) {
    submit(game, sessions[index]!, connections[index]!, {
      type: "mulligan",
      commandId: `${roomId}-mulligan-${index}`,
      stateVersion: 0,
      selectedObjectIds: []
    });
  }
  setup = projectionFor(game, "player-1");
  if (setup.phase !== "main") throw new Error("Production V2 room did not enter Main");
  const actorIndex = setup.activePlayerId === "player-1" ? 0 : 1;
  submit(game, sessions[actorIndex]!, connections[actorIndex]!, {
    type: "pass",
    commandId: `${roomId}-accepted-pass`,
    stateVersion: setup.stateVersion
  });
  return { room: game, sessions, connections };
}

async function persist(
  directory: string,
  catalog: CardCatalogRuntime,
  game: GameRoom
): Promise<void> {
  const store = new FileRoomStore(directory, async () => catalog);
  await store.create(game);
  await store.save(game);
  await store.close();
}

function roomHash(roomId: string): string {
  return createHash("sha256").update(roomId, "utf8").digest("hex");
}

function rehashWithIllegalCommand(journal: RuntimeJournal): RuntimeJournal {
  const last = journal.entries.at(-1)!;
  const source = last.pendingReason ? journal.entries.find(entry => !entry.pendingReason)! : last;
  const forged: V2Command = {
    type: "move",
    commandId: "illegal-move",
    stateVersion: journal.head.stateVersion,
    objectId: "object-with-no-live-incarnation",
    to: { zone: "base", playerId: source.playerId }
  };
  const writer = new RuntimeJournalWriter(journal);
  writer.append({
    playerId: source.playerId,
    actor: source.actor,
    requestId: source.requestId,
    commandId: `illegal-move:${source.commandId}`,
    command: forged,
    payload: forged,
    acceptedAt: new Date(0).toISOString(),
    expectedStateVersion: journal.head.stateVersion,
    expectedRoomVersion: source.expectedRoomVersion,
    appliedStateVersion: journal.head.stateVersion + 1,
    roomVersion: source.roomVersion,
    eventSeq: source.eventSeq,
    result: source.result,
    publicReceipt: source.publicReceipt,
    duplicate: false,
    rejection: null,
    entropyConsumed: [],
    projectionDigestByViewer: source.projectionDigestByViewer,
    stateDigest: journal.head.stateDigest,
    privateStateDigest: journal.head.privateStateDigest
  });
  return writer.snapshot();
}

async function rewriteJournal(
  directory: string,
  roomId: string,
  update: (journal: RuntimeJournal) => RuntimeJournal
): Promise<void> {
  const logPath = path.join(directory, roomHash(roomId), "archive.log");
  const lines = (await readFile(logPath, "utf8")).trimEnd().split("\n");
  const snapshotIndex = lines.map((_line, index) => index).reverse().find(index => {
    const candidate = JSON.parse(lines[index]!) as {
      readonly record?: { readonly entries?: readonly { readonly event?: Record<string, unknown> }[] };
    };
    return candidate.record?.entries?.some(entry =>
      entry.event?.type === "room-archive" &&
      entry.event.archive !== null && typeof entry.event.archive === "object" &&
      "engineRuntimeJournal" in (entry.event.archive as Record<string, unknown>)
    ) === true;
  });
  if (snapshotIndex === undefined) throw new Error("No room archive checkpoint found");
  const persisted = JSON.parse(lines[snapshotIndex]!) as {
    readonly record: { readonly entries: readonly { readonly event: Record<string, unknown> }[] };
  };
  const event = persisted.record.entries.at(-1)?.event;
  const archive = event?.archive;
  if (event?.type !== "room-archive" || archive === null || typeof archive !== "object") {
    throw new Error("No room archive checkpoint found");
  }
  const value = archive as Record<string, unknown>;
  value.engineRuntimeJournal = update(value.engineRuntimeJournal as RuntimeJournal);
  lines[snapshotIndex] = JSON.stringify({
    checksum: createHash("sha256").update(stableStringify(persisted.record)).digest("hex"),
    record: persisted.record
  });
  await writeFile(logPath, `${lines.slice(0, snapshotIndex + 1).join("\n")}\n`, "utf8");
}

async function startServer(directory: string, catalog: CardCatalogRuntime): Promise<GameServer> {
  const server = createGameServer({
    host: "127.0.0.1",
    port: Number(process.env.SWARM_PORT_BASE ?? 36380),
    storageDirectory: directory,
    catalog: p4RuntimeFixtureCatalog,
    duelRandomIndex: () => 0,
    startupRoomRestoreTimeoutMs: 5_000
  });
  servers.push(server);
  await server.start();
  expect(await server.httpServer.address()).not.toBeNull();
  return server;
}

describe("room restore startup time", () => {
  it("validates archives at startup without replaying journals, then resumes a room on first access", async () => {
    const root = await temporaryRoot("lazy-in-progress");
    const catalog = await fixtureCatalog();
    const finished = room("finished-ready", catalog);
    await persist(root, catalog, finished);
    const original = await startedRoom("in-progress", catalog);
    await persist(root, catalog, original.room);

    const store = new FileRoomStore(root, async () => catalog);
    const rooms = await store.listForStartup();
    const inProgress = rooms.find(candidate => candidate.roomId === "in-progress")!;
    expect(rooms.find(candidate => candidate.roomId === "finished-ready")?.hasDeferredRuntimeRestore)
      .toBe(false);
    expect(inProgress.hasDeferredRuntimeRestore).toBe(true);
    expect(inProgress.pendingJournalEntryCount).toBeGreaterThan(0);
    expect(inProgress.replayedJournalEntryCount).toBe(0);
    expect(inProgress.roomView()).toMatchObject({ status: "playing", version: 1 });
    const pendingReplayCount = inProgress.pendingJournalEntryCount;

    const [restored] = await Promise.all([store.get("in-progress"), store.get("in-progress")]);
    expect(restored).toBe(inProgress);
    expect(inProgress.hasDeferredRuntimeRestore).toBe(false);
    expect(inProgress.replayedJournalEntryCount).toBe(pendingReplayCount);
    const session = original.sessions[0]!;
    restored!.reconnect(session.resumeToken, transport, "resume-in-progress");
    expect(projectionFor(restored!, session.playerId).phase).toBe("main");
    await store.close();
  }, 120_000);

  it("restores a terminal room only when its result is queried, then releases the live graph", async () => {
    const root = await temporaryRoot("terminal-result");
    const catalog = await fixtureCatalog();
    const original = await startedRoom("terminal-result-room", catalog);
    const winner = original.connections[1]!;
    const loser = original.sessions[0]!;
    submit(original.room, loser, original.connections[0]!, {
      type: "concede",
      commandId: "terminal-concede",
      stateVersion: projectionFor(original.room, "player-1").stateVersion
    });
    const terminal = projectionFor(original.room, "player-1");
    expect(terminal.phase).toBe("ended");
    expect(terminal.winnerPlayerId).toBe(winner.playerId);
    await persist(root, catalog, original.room);

    const store = new FileRoomStore(root, async () => catalog);
    const [roomAtStartup] = await store.listForStartup();
    const replayCount = roomAtStartup.pendingJournalEntryCount;
    expect(replayCount).toBeGreaterThan(0);
    expect(roomAtStartup.roomView()).toMatchObject({ status: "playing", version: terminal.stateVersion });
    expect(roomAtStartup.replayedJournalEntryCount).toBe(0);

    const accessible = await store.get("terminal-result-room");
    expect(accessible).toBe(roomAtStartup);
    expect(accessible!.replayedJournalEntryCount).toBe(replayCount);
    expect(accessible!.exportArchive().engineRuntimeJournal).not.toBeNull();
    const restoredView = projectionFor(accessible!, "player-1");
    expect(restoredView.phase).toBe("ended");
    expect(restoredView.winnerPlayerId).toBe(winner.playerId);
    expect(restoredView.objects.filter(object => object.ownerPlayerId === "player-2" && object.faceDown))
      .toEqual([]);
    await store.close();
  }, 120_000);

  it("keeps HTTP readiness independent from an expensive engine replay", async () => {
    const root = await temporaryRoot("health-ready");
    const catalog = await fixtureCatalog();
    const original = await startedRoom("health-ready-room", catalog);
    await persist(root, catalog, original.room);
    const server = await startServer(root, catalog);
    const address = server.httpServer.address();
    if (address === null || typeof address === "string") throw new Error("No HTTP address");
    const health = await fetch(`http://127.0.0.1:${address.port}/health`).then(response => response.json()) as {
      readonly status: string;
      readonly archiveRecovery: { readonly completed: boolean; readonly pendingRooms: readonly string[] };
    };
    expect(health.status).toBe("ok");
    expect(health.archiveRecovery.completed).toBe(true);
    expect(health.archiveRecovery.pendingRooms).toEqual(["health-ready-room"]);
    expect(server.rooms.get("health-ready-room")?.replayedJournalEntryCount).toBe(0);
    await server.stop();
  }, 120_000);

  it("isolates a semantic replay divergence on first access instead of blocking startup", async () => {
    const root = await temporaryRoot("lazy-divergence");
    const catalog = await fixtureCatalog();
    const original = await startedRoom("diverges-later", catalog);
    await persist(root, catalog, original.room);
    await rewriteJournal(root, "diverges-later", rehashWithIllegalCommand);

    const store = new FileRoomStore(root, async () => catalog);
    const [roomBeforeAccess] = await store.listForStartup();
    expect(roomBeforeAccess.hasDeferredRuntimeRestore).toBe(true);
    expect(await store.inspectQuarantined()).toEqual([]);
    await expect(store.get("diverges-later")).rejects.toThrow(/quarantined.*Journal replay failed/i);
    expect(await store.inspectQuarantined()).toHaveLength(1);
    await store.close();
  }, 120_000);
});
