import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DUEL_RULESET_ID,
  type ClientSession,
  type ServerTransport
} from "@riftbound/protocol";
import type { JsonObject } from "@riftbound/replay-core/full-product";
import {
  isV2CommandReceipt,
  isV2Projection,
  type V2Projection
} from "../../../../packages/protocol/dist/v2/index.js";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import { FileRoomStore } from "../../src/file-room-store.js";
import { GameRoom, type RoomArchive, type RoomConnection } from "../../src/room.js";
import { PersistentRoomArchiveStore } from "../../src/storage/persistent-room-store.js";
import { p4RuntimeFixtureCatalog } from "../duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "../duel/fixtures/setup-adapter-catalog.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const transport: ServerTransport = () => undefined;

async function temporaryDirectory(label: string): Promise<string> {
  const root = path.join(
    "/tmp",
    process.env.SWARM_TASK ?? "RIFT-1099-room-restore-waiting-room-quarantined"
  );
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, `${label}-`));
  directories.push(directory);
  return directory;
}

async function fixtureCatalog(): Promise<CardCatalogRuntime> {
  return loadCardCatalogRuntime({ catalog: p4RuntimeFixtureCatalog });
}

function storeFor(directory: string, catalog: CardCatalogRuntime): FileRoomStore {
  return new FileRoomStore(directory, async () => catalog);
}

function room(roomId: string, catalog: CardCatalogRuntime): GameRoom {
  return new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
}

function sessionFor(roomId: string, connection: RoomConnection): ClientSession {
  return {
    roomId,
    playerId: connection.playerId,
    resumeToken: connection.resumeToken
  };
}

function reconnect(room: GameRoom, session: ClientSession, connectionId: string): RoomConnection {
  const connection = room.reconnect(session.resumeToken, transport, connectionId);
  if (connection === null) throw new Error("Trusted seat did not reconnect");
  return connection;
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

async function persistRoom(
  directory: string,
  catalog: CardCatalogRuntime,
  room: GameRoom
): Promise<void> {
  const store = storeFor(directory, catalog);
  await store.create(room);
  await store.save(room);
  await store.close();
}

async function submitFixtureDecks(
  room: GameRoom,
  alice: RoomConnection,
  bob: RoomConnection,
  aliceDeck = setupAdapterFixtureDecks.a.submission,
  bobDeck = setupAdapterFixtureDecks.b.submission
): Promise<readonly [ClientSession, ClientSession]> {
  const aliceSession = sessionFor(room.roomId, alice);
  const bobSession = sessionFor(room.roomId, bob);
  room.submitDeck(aliceSession, alice.connectionId, room.currentRoomVersion,
    aliceDeck, "fixture-deck-a", transport);
  room.submitDeck(bobSession, bob.connectionId, room.currentRoomVersion,
    bobDeck, "fixture-deck-b", transport);
  return [aliceSession, bobSession];
}

describe("waiting V2 room restart", () => {
  it("restores a one-seat room and lets the opponent join after restart", async () => {
    const directory = await temporaryDirectory("one-seat");
    const catalog = await fixtureCatalog();
    const original = room("waiting-one-seat", catalog);
    const alice = original.join("Alice", transport, "alice-before-restart");
    const saved = original.exportArchive();
    await persistRoom(directory, catalog, original);

    const reopened = storeFor(directory, catalog);
    const [restored] = await reopened.list();
    expect(restored?.roomId).toBe("waiting-one-seat");
    expect(restored?.exportArchive()).toEqual(saved);
    expect(await reopened.inspectQuarantined()).toEqual([]);
    expect(restored?.roomView()).toMatchObject({
      status: "waiting",
      players: [{ id: "player-1", name: "Alice", ready: false, deckSubmitted: false }]
    });

    const bob = restored!.join("Bob", transport, "bob-after-restart");
    expect(bob.playerId).toBe("player-2");
    expect(restored!.roomView()).toMatchObject({
      status: "waiting",
      players: [
        { id: "player-1", name: "Alice" },
        { id: "player-2", name: "Bob" }
      ]
    });
    expect(alice.resumeToken).not.toBe(bob.resumeToken);
    await reopened.close();
  });

  it("restores an empty room and lets the first opponent join after restart", async () => {
    const directory = await temporaryDirectory("zero-seats");
    const catalog = await fixtureCatalog();
    const original = room("waiting-zero-seats", catalog);
    await persistRoom(directory, catalog, original);

    const reopened = storeFor(directory, catalog);
    const [restored] = await reopened.list();
    expect(restored?.roomId).toBe("waiting-zero-seats");
    expect(await reopened.inspectQuarantined()).toEqual([]);
    expect(restored?.roomView()).toMatchObject({ status: "waiting", players: [] });

    const alice = restored!.join("Alice", transport, "alice-after-restart");
    expect(alice.playerId).toBe("player-1");
    expect(restored?.roomView()).toMatchObject({
      status: "waiting",
      players: [{ id: "player-1", name: "Alice", ready: false, deckSubmitted: false }]
    });
    await reopened.close();
  });

  it("restores two unready seats and lets an opponent submit the first deck after restart", async () => {
    const directory = await temporaryDirectory("two-unready");
    const catalog = await fixtureCatalog();
    const original = room("waiting-two-unready", catalog);
    const alice = original.join("Alice", transport, "alice-before-restart");
    const bob = original.join("Bob", transport, "bob-before-restart");
    const aliceSession = sessionFor(original.roomId, alice);
    const bobSession = sessionFor(original.roomId, bob);
    expect(original.roomView().players.every(player => !player.ready)).toBe(true);
    await persistRoom(directory, catalog, original);

    const reopened = storeFor(directory, catalog);
    const [restored] = await reopened.list();
    expect(restored?.roomId).toBe("waiting-two-unready");
    expect(await reopened.inspectQuarantined()).toEqual([]);
    expect(restored?.roomView()).toMatchObject({
      status: "waiting",
      players: [
        { id: "player-1", name: "Alice", ready: false, deckSubmitted: false },
        { id: "player-2", name: "Bob", ready: false, deckSubmitted: false }
      ]
    });

    const aliceResumed = reconnect(restored!, aliceSession, "alice-resumed");
    const bobResumed = reconnect(restored!, bobSession, "bob-resumed");
    restored!.submitDeck(bobSession, bobResumed.connectionId, restored!.currentRoomVersion,
      setupAdapterFixtureDecks.b.submission, "fixture-deck-b", transport);
    expect(restored!.roomView().players[1]).toMatchObject({ ready: false, deckSubmitted: true });
    restored!.setReady(bobSession, bobResumed.connectionId, restored!.currentRoomVersion,
      true, "ready-bob-after-restart", transport);
    expect(restored!.status).toBe("waiting");
    restored!.submitDeck(aliceSession, aliceResumed.connectionId, restored!.currentRoomVersion,
      setupAdapterFixtureDecks.a.submission, "fixture-deck-a", transport);
    expect(restored!.roomView().players[0]).toMatchObject({ ready: false, deckSubmitted: true });
    restored!.setReady(aliceSession, aliceResumed.connectionId,
      restored!.currentRoomVersion, true, "ready-alice-after-restart", transport);

    const setup = projectionFor(restored!, "player-1");
    expect(setup.phase).toBe("setup");
    expect(setup.pendingChoice).toMatchObject({ status: "pending", min: 0, max: 2 });
    expect(restored!.exportArchive().engineMulligan).not.toBeNull();
    expect(restored!.exportArchive().engineRuntimeJournal).toBeNull();
    await reopened.close();
  });

  it("restores the two-ready mulligan handoff and accepts a real setup command", async () => {
    const directory = await temporaryDirectory("ready-mulligan");
    const catalog = await fixtureCatalog();
    const original = room("waiting-ready-mulligan", catalog);
    const alice = original.join("Alice", transport, "alice-before-restart");
    const bob = original.join("Bob", transport, "bob-before-restart");
    const [aliceSession, bobSession] = await submitFixtureDecks(original, alice, bob);
    original.setReady(aliceSession, alice.connectionId, original.currentRoomVersion,
      true, "ready-alice-before-restart", transport);
    original.setReady(bobSession, bob.connectionId, original.currentRoomVersion,
      true, "ready-bob-before-restart", transport);
    const saved = original.exportArchive();
    expect(saved.engineMulligan).not.toBeNull();
    expect(saved.engineRuntimeJournal).toBeNull();
    await persistRoom(directory, catalog, original);

    const reopened = storeFor(directory, catalog);
    const [restored] = await reopened.list();
    expect(restored?.roomId).toBe("waiting-ready-mulligan");
    expect(await reopened.inspectQuarantined()).toEqual([]);
    expect(restored?.exportArchive()).toMatchObject({
      engineMulligan: saved.engineMulligan,
      engineRuntimeJournal: null
    });

    const aliceResumed = reconnect(restored!, aliceSession, "alice-resumed");
    reconnect(restored!, bobSession, "bob-resumed");
    const setup = projectionFor(restored!, "player-1");
    expect(setup.phase).toBe("setup");
    if (setup.pendingChoice.status !== "pending") throw new Error("Mulligan window required");
    const duePlayerId = setup.pendingChoice.ownerPlayerId;
    const dueSession = duePlayerId === aliceSession.playerId ? aliceSession : bobSession;
    const dueConnection = duePlayerId === aliceSession.playerId ? aliceResumed :
      restored!.players.get(duePlayerId);
    if (dueConnection === undefined) throw new Error("Due mulligan seat was not reconnected");

    const receipts: unknown[] = [];
    restored!.submitEngineV2(dueSession, dueConnection.connectionId, {
      type: "mulligan",
      commandId: "mulligan-after-restart",
      stateVersion: 0,
      selectedObjectIds: []
    }, message => receipts.push(message));
    const receipt = receipts.find(isV2CommandReceipt);
    expect(receipt).toMatchObject({
      commandId: "mulligan-after-restart",
      accepted: true,
      rejection: null
    });
    const afterChoice = restored!.exportArchive();
    expect(afterChoice.engineMulligan?.choices.some(choice => choice !== null)).toBe(true);
    expect(afterChoice.engineRuntimeJournal).toBeNull();
    const otherPlayerId = duePlayerId === "player-1" ? "player-2" : "player-1";
    const otherSetup = projectionFor(restored!, otherPlayerId);
    expect(otherSetup.phase).toBe("setup");
    expect(otherSetup.pendingChoice.status).toBe("pending");
    await reopened.close();
  });

  it("rejects corrupt mulligan choices while preserving a trusted seat", async () => {
    const directory = await temporaryDirectory("corrupt-mulligan");
    const catalog = await fixtureCatalog();
    const original = room("corrupt-mulligan-choices", catalog);
    const alice = original.join("Alice", transport, "alice-before-restart");
    const bob = original.join("Bob", transport, "bob-before-restart");
    const [aliceSession] = await submitFixtureDecks(original, alice, bob);
    original.setReady(aliceSession, alice.connectionId, original.currentRoomVersion,
      true, "ready-alice-before-restart", transport);
    original.setReady(sessionFor(original.roomId, bob), bob.connectionId,
      original.currentRoomVersion, true, "ready-bob-before-restart", transport);
    expect(original.exportArchive().engineMulligan).not.toBeNull();

    const damaged = structuredClone(original.exportArchive()) as unknown as {
      engineMulligan: { choices: unknown[] };
    };
    damaged.engineMulligan.choices = [["duplicate", "duplicate"], null];
    const durable = new PersistentRoomArchiveStore(
      path.join(directory, roomHash(original.roomId))
    );
    await durable.save(original.roomId, damaged as unknown as RoomArchive as JsonObject);
    await durable.close();

    const reopened = storeFor(directory, catalog);
    expect(await reopened.list()).toEqual([]);
    expect(await reopened.inspectQuarantined()).toEqual([
      expect.objectContaining({
        roomId: original.roomId,
        reason: "Invalid duel room archive and trusted seats"
      })
    ]);
    await reopened.close();
  });

  it("still quarantines an impossible two-ready archive with no mulligan handoff", async () => {
    const directory = await temporaryDirectory("damaged-ready");
    const catalog = await fixtureCatalog();
    const original = room("damaged-two-ready", catalog);
    const alice = original.join("Alice", transport, "alice-before-restart");
    const bob = original.join("Bob", transport, "bob-before-restart");
    await submitFixtureDecks(original, alice, bob);
    const damaged = structuredClone(original.exportArchive()) as unknown as {
      seats: { ready: boolean }[];
      engineRuntimeJournal: unknown;
      engineMulligan: unknown;
    };
    for (const seat of damaged.seats) seat.ready = true;
    damaged.engineRuntimeJournal = null;
    damaged.engineMulligan = null;
    const roomPath = path.join(directory, roomHash(original.roomId));
    const durable = new PersistentRoomArchiveStore(roomPath);
    await durable.save(original.roomId, damaged as unknown as RoomArchive as JsonObject);
    await durable.close();

    const reopened = storeFor(directory, catalog);
    expect(await reopened.list()).toEqual([]);
    const quarantined = await reopened.inspectQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({
      roomId: original.roomId,
      rulesetId: DUEL_RULESET_ID,
      rulesetVersion: "core-1.5",
      engineVersion: "@riftbound/engine-core/current",
      protocolVersion: "2.0.0",
      reason: "Invalid duel room archive and trusted seats"
    });
    await reopened.close();
  });
});

function roomHash(roomId: string): string {
  return createHash("sha256").update(roomId, "utf8").digest("hex");
}
