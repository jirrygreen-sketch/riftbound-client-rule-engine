import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DUEL_RULESET_ID,
  type ClientSession,
  type ServerTransport,
} from "@riftbound/protocol";
import {
  isV2CommandReceipt,
  isV2Projection,
  type V2CommandReceipt,
  type V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { FileRoomStore } from "../../src/file-room-store.js";
import { GameRoom, type RoomConnection } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";

const directories: string[] = [];
const transport: ServerTransport = () => undefined;

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(label: string): Promise<string> {
  const root = path.join("/tmp", process.env.SWARM_TASK ?? "RIFT-1108-mulligan-probe-reuse");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, `${label}-`));
  directories.push(directory);
  return directory;
}

interface StartedSetup {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<"player-1" | "player-2", ClientSession>>;
  readonly connections: Readonly<Record<"player-1" | "player-2", RoomConnection>>;
}

function sessionFor(room: GameRoom, connection: RoomConnection): ClientSession {
  return {
    roomId: room.roomId,
    playerId: connection.playerId,
    resumeToken: connection.resumeToken,
  };
}

function projectionFor(room: GameRoom, playerId: string): V2Projection {
  let projection: unknown;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      projection = (message as { readonly projection?: unknown }).projection;
    }
  });
  if (!isV2Projection(projection)) throw new Error(`No valid projection for ${playerId}`);
  return projection;
}

async function startedSetup(roomId: string): Promise<StartedSetup> {
  const catalog = await loadCardCatalogRuntime();
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const first = room.join("Alice", transport, "alice");
  const second = room.join("Bob", transport, "bob");
  const connections = { "player-1": first, "player-2": second } as const;
  const sessions = {
    "player-1": sessionFor(room, first),
    "player-2": sessionFor(room, second),
  } as const;
  room.submitDeck(sessions["player-1"], first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, "deck-a", transport);
  room.setReady(sessions["player-1"], first.connectionId, room.currentRoomVersion,
    true, "ready-a", transport);
  room.submitDeck(sessions["player-2"], second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["fiora-sfd"].deck, "deck-b", transport);
  room.setReady(sessions["player-2"], second.connectionId, room.currentRoomVersion,
    true, "ready-b", transport);
  expect(projectionFor(room, "player-1").phase).toBe("setup");
  return { room, sessions, connections };
}

function submitMulligan(
  setup: StartedSetup,
  playerId: "player-1" | "player-2",
  commandId: string,
  selectedObjectIds: readonly string[] = [],
): V2CommandReceipt {
  let receipt: unknown;
  setup.room.submitEngineV2(setup.sessions[playerId], setup.connections[playerId].connectionId,
    { type: "mulligan", commandId, stateVersion: 0, selectedObjectIds },
    message => { receipt = message; });
  if (!isV2CommandReceipt(receipt)) throw new Error(`No receipt for ${commandId}`);
  return receipt;
}

function hand(view: V2Projection): readonly { readonly objectId: string; readonly cardId?: string }[] {
  return view.zones.find(zone => zone.zone === "hand" &&
    zone.ownerPlayerId === view.viewerPlayerId)?.objects ?? [];
}

describe("RIFT-1108 mulligan preview reuse", () => {
  it("shares one immutable opening across seats and creates the formal runtime only after both choices", async () => {
    const setup = await startedSetup("RIFT-1108-preview-reuse");
    const firstA = projectionFor(setup.room, "player-1");
    const firstB = projectionFor(setup.room, "player-2");
    const preview = Reflect.get(setup.room, "engineMulliganPreview") as object;
    const previewBeforeFirstChoice = preview;
    expect(firstA.phase).toBe("setup");
    expect(firstB.phase).toBe("setup");
    expect(hand(firstA)).toHaveLength(4);
    expect(hand(firstB)).toHaveLength(4);
    expect(firstA.activePlayerId).toBe(firstB.activePlayerId);
    expect(firstA.battlefields).toEqual(firstB.battlefields);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(setup.room.exportArchive().engineRuntimeJournal).toBeNull();

    const firstPlayerId = firstA.activePlayerId as "player-1" | "player-2";
    const secondPlayerId = firstPlayerId === "player-1" ? "player-2" : "player-1";
    const firstReceipt = submitMulligan(setup, firstPlayerId, "mulligan-first");
    expect(firstReceipt).toMatchObject({ accepted: true, stateVersion: 0 });
    expect(setup.room.exportArchive()).toMatchObject({
      engineMulligan: { choices: expect.arrayContaining([expect.any(Array)]) },
      engineRuntimeJournal: null,
    });
    expect(projectionFor(setup.room, secondPlayerId).phase).toBe("setup");
    expect(Reflect.get(setup.room, "engineMulliganPreview")).toBe(previewBeforeFirstChoice);

    const secondReceipt = submitMulligan(setup, secondPlayerId, "mulligan-second");
    expect(secondReceipt).toMatchObject({ accepted: true, stateVersion: 0 });
    const finalA = projectionFor(setup.room, "player-1");
    const finalB = projectionFor(setup.room, "player-2");
    expect(finalA.phase).not.toBe("setup");
    expect(finalB.phase).toBe(finalA.phase);
    expect(finalA.activePlayerId).toBe(firstA.activePlayerId);
    expect(finalA.battlefields.map(field => field.battlefieldId))
      .toEqual(firstA.battlefields.map(field => field.battlefieldId));
    expect(Reflect.get(setup.room, "engineMulliganPreview")).toBeNull();
    expect(setup.room.exportArchive()).toMatchObject({ engineMulligan: null });
    expect(setup.room.exportArchive().engineRuntimeJournal).not.toBeNull();
  }, 120_000);

  it("keeps the first opening when the first seat mulligans a real hand card", async () => {
    const setup = await startedSetup("RIFT-1108-partial-choice");
    const before = projectionFor(setup.room, "player-1");
    const firstPlayerId = before.activePlayerId as "player-1" | "player-2";
    const secondPlayerId = firstPlayerId === "player-1" ? "player-2" : "player-1";
    const firstView = projectionFor(setup.room, firstPlayerId);
    const selected = hand(firstView)[0];
    if (!selected) throw new Error("Opening hand was empty");
    expect(submitMulligan(setup, firstPlayerId, "partial-first", [selected.objectId]))
      .toMatchObject({ accepted: true });
    expect(hand(projectionFor(setup.room, secondPlayerId))).toHaveLength(4);
    expect(submitMulligan(setup, secondPlayerId, "partial-second")).toMatchObject({ accepted: true });
    expect(projectionFor(setup.room, "player-1").phase).toBe("main");
  }, 120_000);

  it("restores a half-complete mulligan lazily, continues in turn order, and starts the same game", async () => {
    const directory = await temporaryDirectory("restart-mulligan");
    const original = await startedSetup("RIFT-1108-restart-mulligan");
    const initial = projectionFor(original.room, "player-1");
    const firstPlayerId = initial.activePlayerId as "player-1" | "player-2";
    const secondPlayerId = firstPlayerId === "player-1" ? "player-2" : "player-1";
    expect(submitMulligan(original, firstPlayerId, "before-restart")).toMatchObject({ accepted: true });
    const saved = original.room.exportArchive();
    expect(saved).toMatchObject({ engineMulligan: { choices: expect.any(Array) }, engineRuntimeJournal: null });

    const store = new FileRoomStore(directory, async () => loadCardCatalogRuntime());
    await store.create(original.room);
    await store.save(original.room);
    await store.close();

    const reopened = new FileRoomStore(directory, async () => loadCardCatalogRuntime());
    const [restored] = await reopened.listForStartup();
    if (!restored) throw new Error("Pending mulligan room was not restored");
    expect(restored.exportArchive()).toEqual(saved);
    const firstBeforeConnect = Reflect.get(restored, "engineMulliganPreview");
    expect(firstBeforeConnect).toBeNull();
    const firstConnection = restored.reconnect(original.sessions[firstPlayerId].resumeToken,
      transport, "alice-after-restart");
    const secondConnection = restored.reconnect(original.sessions[secondPlayerId].resumeToken,
      transport, "bob-after-restart");
    if (!firstConnection || !secondConnection) throw new Error("Restored seat did not reconnect");
    const resumed: StartedSetup = {
      room: restored,
      sessions: original.sessions,
      connections: {
        "player-1": firstConnection.playerId === "player-1" ? firstConnection : secondConnection,
        "player-2": firstConnection.playerId === "player-2" ? firstConnection : secondConnection,
      },
    };
    expect(projectionFor(restored, secondPlayerId).phase).toBe("setup");
    expect(submitMulligan(resumed, secondPlayerId, "after-restart")).toMatchObject({ accepted: true });
    const after = restored.exportArchive();
    expect(after.engineMulligan).toBeNull();
    expect(after.engineRuntimeJournal).not.toBeNull();
    expect(after.engineRuntimeJournal?.header.setup?.firstPlayer).toBe(
      initial.activePlayerId === "player-1" ? 0 : 1);
    expect(projectionFor(restored, "player-1").phase).toBe("main");
    await reopened.close();
  }, 180_000);
});
