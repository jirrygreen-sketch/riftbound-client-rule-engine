// RIFT-1179 authoritative GameRoom regression.
//
// Core Rules v1.5 was published 2026-10-09 and is effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Chinese card source (read 2026-10-31):
// https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
// CR 133.3.a and 355.9.a.1: an unqualified "unit" means a Board Unit unless
// its effect names another zone. CR 141.1.a/.b distinguishes Board Units from
// Unit cards in non-Board zones. CR 819.1.d requires Quick-Draw to attach to a
// Unit you control.
import { describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { V2_M1_PRECONS }
  from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { PersistentRoomArchiveStore }
  from "../../src/storage/persistent-room-store.js";

const ROOM_ID = "RIFT-1168-room-122";
const LONG_SWORD = "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";
const RUMBLE = "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";
const FORECASTER = "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40";
const RECOVERED_ARCHIVE = "/root/swarm-rift/shared/rift1170/archive.log";
const RECOVERED_ROOM_ID = "b0dd7361";

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
  readonly playerIds: readonly [string, string];
}

type EngineRuntimeInspection = {
  readonly host: {
    object(ref: { readonly id: string; readonly zoneEntryId: number }): {
      readonly zone: string;
      readonly controller: string;
      readonly cardId: string | null;
    } | null;
  };
};

function view(room: GameRoom, playerId: string): V2Projection {
  let projection: V2Projection | undefined;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      projection = (message as { readonly projection: V2Projection }).projection;
    }
  });
  if (projection === undefined) throw new Error(`Missing projection for ${playerId}`);
  return projection;
}

function submit(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
  const session = started.sessions[playerId];
  const connection = started.connections[playerId];
  if (session === undefined || connection === undefined) throw new Error(`Missing session for ${playerId}`);
  let receipt: V2CommandReceipt | undefined;
  started.room.submitEngineV2(session, connection, command, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "command-receipt") {
      receipt = message as V2CommandReceipt;
    }
  });
  if (receipt === undefined) throw new Error(`Missing receipt for ${command.commandId}`);
  return receipt;
}

async function startRoom(): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime();
  const room = new GameRoom(ROOM_ID, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = (): void => undefined;
  const first = room.join("Rumble", noMessages, `${ROOM_ID}-a`);
  const second = room.join("Fiora", noMessages, `${ROOM_ID}-b`);
  const sessions = {
    [first.playerId]: { roomId: ROOM_ID, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId: ROOM_ID, playerId: second.playerId, resumeToken: second.resumeToken },
  } as const;
  const connections = {
    [first.playerId]: first.connectionId,
    [second.playerId]: second.connectionId,
  } as const;
  const playerIds = [first.playerId, second.playerId] as const;
  const started: StartedRoom = { room, sessions, connections, playerIds };
  for (const [index, connection] of [first, second].entries()) {
    const playerId = connection.playerId;
    room.submitDeck(sessions[playerId]!, connection.connectionId, room.currentRoomVersion,
      index === 0 ? V2_M1_PRECONS["rumble-sfd"].deck : V2_M1_PRECONS["fiora-sfd"].deck,
      `${ROOM_ID}-deck-${index}`, noMessages);
    room.setReady(sessions[playerId]!, connection.connectionId, room.currentRoomVersion,
      true, `${ROOM_ID}-ready-${index}`, noMessages);
  }
  for (let index = 0; index < 2; index++) {
    const due = playerIds
      .map(playerId => view(room, playerId))
      .find(candidate => candidate.pendingChoice.status === "pending" &&
        candidate.pendingChoice.ownerPlayerId === candidate.viewerPlayerId);
    if (due === undefined) throw new Error(`Missing mulligan owner ${index}`);
    const receipt = submit(started, due.viewerPlayerId!, {
      type: "mulligan", commandId: `${ROOM_ID}-mulligan-${index}`,
      stateVersion: 0, selectedObjectIds: [],
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  return started;
}

function settleChain(started: StartedRoom, playerId: string): void {
  for (let guard = 0; guard < 30; guard++) {
    const current = view(started.room, playerId);
    if (current.chain.items.length === 0) return;
    const priority = current.chain.priorityPlayerId;
    if (priority === null) throw new Error("Open chain has no priority holder");
    const receipt = submit(started, priority, {
      type: "pass", commandId: `${ROOM_ID}-pass-${current.stateVersion}-${guard}`,
      stateVersion: current.stateVersion,
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  throw new Error("Chain did not settle");
}

function advanceTurn(started: StartedRoom, current: V2Projection): V2Projection {
  const actor = current.activePlayerId;
  if (actor === null) throw new Error("Main phase has no active player");
  expect(submit(started, actor, {
    type: "end-turn", commandId: `${ROOM_ID}-end-${current.turnNumber}`,
    stateVersion: current.stateVersion,
  }).accepted).toBe(true);
  return view(started.room, actor);
}

function zoneObjects(current: V2Projection, playerId: string, zone: string) {
  return current.zones.find(candidate => candidate.ownerPlayerId === playerId && candidate.zone === zone)?.objects ?? [];
}

describe("RIFT-1179 authoritative Unit target candidates", () => {
  it("restores the reported archive at the Quick-Draw pending snapshot", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rift-1179-recovered-"));
    try {
      await copyFile(RECOVERED_ARCHIVE, path.join(directory, "archive.log"));
      const store = new PersistentRoomArchiveStore(directory);
      try {
        const page = await store.readArchives(RECOVERED_ROOM_ID, 0, 1_000);
        const recovered = page.archives.find(record => record.archiveSeq === 45);
        expect(recovered).toBeDefined();
        if (recovered === undefined || !("engineRuntimeJournal" in recovered.archive)) {
          throw new Error("Recovered Quick-Draw archive snapshot is unavailable");
        }
        const catalog = await loadCardCatalogRuntime();
        const room = GameRoom.restore(recovered.archive as Parameters<typeof GameRoom.restore>[0], catalog);
        let packet: unknown;
        room.sendProjection("player-1", message => { packet = message; });
        const projection = (packet as { readonly projection?: V2Projection }).projection;
        expect(projection?.pendingChoice).toMatchObject({
          status: "pending", choiceId: "target:quick-draw-unit",
          ownerPlayerId: "player-1", kind: "select-objects",
        });
        if (projection?.pendingChoice.status !== "pending") {
          throw new Error("Recovered Quick-Draw target is missing");
        }
        const refs = projection.pendingChoice.options?.flatMap(option =>
          option.objectRef === undefined ? [] : [option.objectRef]) ?? [];
        expect(refs).toHaveLength(1);
        const runtime = (room as unknown as { readonly engineRuntime?: EngineRuntimeInspection }).engineRuntime;
        expect(runtime).toBeDefined();
        const candidate = runtime!.host.object({ id: refs[0]!.objectId, zoneEntryId: refs[0]!.zoneEntryId });
        expect(candidate).toMatchObject({
          zone: "board", controller: "A", cardId: FORECASTER,
        });
      } finally {
        await store.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("Quick-Draw lists only the chooser's Board Units", async () => {
    const started = await startRoom();
    let current = view(started.room, started.playerIds[0]);
    while (current.turnNumber < 5) current = advanceTurn(started, current);
    current = view(started.room, started.playerIds[0]);

    const rumble = zoneObjects(current, started.playerIds[0], "hand").find(object => object.cardId === RUMBLE);
    expect(rumble).toBeDefined();
    for (const rune of zoneObjects(current, started.playerIds[0], "rune-zone")
      .filter(object => object.exhausted === false).slice(0, 4)) {
      const receipt = submit(started, started.playerIds[0], {
        type: "rune-energy", commandId: `${ROOM_ID}-rumble-energy-${rune.objectId}`,
        stateVersion: current.stateVersion, runeObjectId: rune.objectId,
        zoneEntryId: rune.zoneEntryId!,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      current = view(started.room, started.playerIds[0]);
    }
    expect(submit(started, started.playerIds[0], {
      type: "play", commandId: `${ROOM_ID}-play-rumble`, stateVersion: current.stateVersion,
      cardObjectId: rumble!.objectId, destination: { kind: "base", playerId: started.playerIds[0] },
    }).accepted).toBe(true);
    settleChain(started, started.playerIds[0]);
    current = advanceTurn(started, view(started.room, started.playerIds[0]));
    current = advanceTurn(started, current);
    current = view(started.room, started.playerIds[0]);
    expect(current.turnNumber).toBe(7);

    const sword = zoneObjects(current, started.playerIds[0], "hand")
      .find(object => object.cardId === LONG_SWORD);
    expect(sword).toBeDefined();
    for (const rune of zoneObjects(current, started.playerIds[0], "rune-zone")
      .filter(object => object.exhausted === false).slice(0, 2)) {
      const receipt = submit(started, started.playerIds[0], {
        type: "rune-energy", commandId: `${ROOM_ID}-sword-energy-${rune.objectId}`,
        stateVersion: current.stateVersion, runeObjectId: rune.objectId,
        zoneEntryId: rune.zoneEntryId!,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      current = view(started.room, started.playerIds[0]);
    }
    const fury = zoneObjects(current, started.playerIds[0], "rune-zone")
      .find(object => object.exhausted === false && object.name === "Fury Rune");
    expect(fury).toBeDefined();
    expect(submit(started, started.playerIds[0], {
      type: "rune-power", commandId: `${ROOM_ID}-sword-power`, stateVersion: current.stateVersion,
      runeObjectId: fury!.objectId, zoneEntryId: fury!.zoneEntryId!,
    }).accepted).toBe(true);
    current = view(started.room, started.playerIds[0]);
    expect(submit(started, started.playerIds[0], {
      type: "play", commandId: `${ROOM_ID}-play-long-sword`, stateVersion: current.stateVersion,
      cardObjectId: sword!.objectId, destination: { kind: "base", playerId: started.playerIds[0] },
    }).accepted).toBe(true);

    current = view(started.room, started.playerIds[0]);
    expect(current.pendingChoice).toMatchObject({
      status: "pending", choiceId: "target:quick-draw-unit",
      ownerPlayerId: started.playerIds[0], kind: "select-objects",
    });
    if (current.pendingChoice.status !== "pending") throw new Error("Quick-Draw target is missing");
    const objectsByRef = new Map(current.objects.map(object =>
      [`${object.objectId}:${object.zoneEntryId}`, object] as const));
    const candidates = current.pendingChoice.options?.map(option => {
      const ref = option.objectRef;
      expect(ref).toBeDefined();
      const object = ref === undefined ? undefined : objectsByRef.get(`${ref.objectId}:${ref.zoneEntryId}`);
      expect(object).toBeDefined();
      return object!;
    }) ?? [];
    const runtime = (started.room as unknown as { readonly engineRuntime?: EngineRuntimeInspection }).engineRuntime;
    expect(runtime).toBeDefined();
    const authoritative = (current.pendingChoice.options ?? []).map(option => {
      const ref = option.objectRef;
      if (ref === undefined) return null;
      return runtime!.host.object({ id: ref.objectId, zoneEntryId: ref.zoneEntryId });
    });
    expect(authoritative.every(object => object !== null)).toBe(true);
    expect(authoritative.every(object => object!.zone === "board" &&
      object!.controller === "A")).toBe(true);
    expect(authoritative).toHaveLength(1);
    expect(authoritative.some(object => object!.cardId === RUMBLE)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      zone: "board", ownerPlayerId: started.playerIds[0], cardId: RUMBLE,
    });
    expect(candidates.some(object => object.cardId === LONG_SWORD)).toBe(false);
    const opponentBoardIds = new Set(view(started.room, started.playerIds[1]).objects
      .filter(object => object.zone === "board" && object.controllerPlayerId === started.playerIds[1])
      .map(object => object.objectId));
    expect(candidates.some(object => opponentBoardIds.has(object.objectId))).toBe(false);
  }, 120_000);
});
