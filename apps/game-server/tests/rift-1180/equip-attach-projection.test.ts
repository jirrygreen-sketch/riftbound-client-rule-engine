// RIFT-1180 -- the V2 projection names the Unit an Equipment is attached to,
// so the board can draw Long Sword under Rumble after Quick-Draw.
//
// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 819.1.d attaches on play; CR 718.5.c / 719.3.a keep the Equipment
// co-located with the Unit it is attached to when that Unit moves.
// The room path follows tests/rift-1168/quick-draw-room.test.ts.
import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import type { ObjectSnapshot } from "../../../../packages/engine-core/dist/effects/contract.js";
import { withAttachmentHosts } from "../../src/engine-runtime/projection.js";
import { V2_M1_PRECONS }
  from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";

// The room id seeds the shuffle; this one deals Rumble and Long Sword as in RIFT-1168.
const ROOM_ID = "RIFT-1168-room-122";
const LONG_SWORD = "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";
const RUMBLE = "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
}

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
  const started: StartedRoom = { room, sessions, connections };
  const players = [first, second] as const;
  for (const [index, connection] of players.entries()) {
    const playerId = connection.playerId;
    room.submitDeck(sessions[playerId]!, connection.connectionId, room.currentRoomVersion,
      index === 0 ? V2_M1_PRECONS["rumble-sfd"].deck : V2_M1_PRECONS["fiora-sfd"].deck,
      `RIFT-1180-deck-${index}`, noMessages);
    room.setReady(sessions[playerId]!, connection.connectionId, room.currentRoomVersion,
      true, `RIFT-1180-ready-${index}`, noMessages);
  }
  for (let index = 0; index < 2; index++) {
    const due = players.map(player => view(room, player.playerId)).find(candidate =>
      candidate.pendingChoice.status === "pending" &&
      candidate.pendingChoice.ownerPlayerId === candidate.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending") {
      throw new Error(`Missing mulligan owner ${index}`);
    }
    const receipt = submit(started, due.viewerPlayerId!, {
      type: "mulligan", commandId: `RIFT-1180-mulligan-${index}`, stateVersion: 0,
      selectedObjectIds: [],
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  return started;
}

function settleChain(started: StartedRoom, actor: string): void {
  for (let guard = 0; guard < 30; guard++) {
    const current = view(started.room, actor);
    if (current.chain.items.length === 0) return;
    const priority = current.chain.priorityPlayerId;
    if (priority === null) throw new Error("Open chain has no priority holder");
    const receipt = submit(started, priority, {
      type: "pass", commandId: `RIFT-1180-pass-${current.stateVersion}-${guard}`,
      stateVersion: current.stateVersion,
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  throw new Error("Quick-Draw chain did not settle");
}

function advanceTurn(started: StartedRoom, current: V2Projection): V2Projection {
  const actor = current.activePlayerId;
  if (actor === null) throw new Error("Main phase has no active player");
  const receipt = submit(started, actor, {
    type: "end-turn", commandId: `RIFT-1180-end-${current.turnNumber}`,
    stateVersion: current.stateVersion,
  });
  expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  return view(started.room, actor);
}

describe("RIFT-1180 real Long Sword attachment projection", () => {
  it("links Long Sword to Rumble in both players\u2019 projections and keeps the link after Rumble moves", async () => {
    const started = await startRoom();
    let current = view(started.room, "player-1");

    // Reach A's third turn. Holding Runes while advancing gives A six Runes,
    // enough for Rumble (4 Energy), Long Sword (2 Energy + Fury), and the Rune
    // recycle that produces Fury through the normal Add path.
    while (current.turnNumber < 5) current = advanceTurn(started, current);
    current = view(started.room, "player-1");
    expect(current).toMatchObject({ phase: "main", activePlayerId: "player-1", turnNumber: 5 });

    const runeZone = (candidate: V2Projection) =>
      candidate.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "player-1")?.objects ?? [];
    const handlers = (candidate: V2Projection) =>
      candidate.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "player-1")?.objects ?? [];

    const rumble = handlers(current).find(object => object.cardId === RUMBLE);
    expect(rumble, JSON.stringify(handlers(current))).toBeDefined();
    for (const rune of runeZone(current).filter(object => object.exhausted === false).slice(0, 4)) {
      const receipt = submit(started, "player-1", {
        type: "rune-energy", commandId: `RIFT-1180-rumble-energy-${rune.objectId}`,
        stateVersion: current.stateVersion, runeObjectId: rune.objectId,
        zoneEntryId: rune.zoneEntryId!,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      current = view(started.room, "player-1");
    }
    expect(current.players.find(player => player.playerId === "player-1")?.energy).toBe(4);
    expect(submit(started, "player-1", {
      type: "play", commandId: "RIFT-1180-play-rumble", stateVersion: current.stateVersion,
      cardObjectId: rumble!.objectId, destination: { kind: "base", playerId: "player-1" },
    }).accepted).toBe(true);
    settleChain(started, "player-1");
    current = view(started.room, "player-1");
    const rumbleOnBoard = current.objects.find(object => object.cardId === RUMBLE && object.zone === "board");
    expect(rumbleOnBoard).toBeDefined();

    current = advanceTurn(started, current);
    current = advanceTurn(started, current);
    current = view(started.room, "player-1");
    expect(current).toMatchObject({ phase: "main", activePlayerId: "player-1", turnNumber: 7 });
    const longSword = handlers(current).find(object => object.cardId === LONG_SWORD);
    expect(longSword, JSON.stringify(handlers(current))).toBeDefined();
    for (const rune of runeZone(current).filter(object => object.exhausted === false).slice(0, 2)) {
      const receipt = submit(started, "player-1", {
        type: "rune-energy", commandId: `RIFT-1180-sword-energy-${rune.objectId}`,
        stateVersion: current.stateVersion, runeObjectId: rune.objectId,
        zoneEntryId: rune.zoneEntryId!,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      current = view(started.room, "player-1");
    }
    const powerRune = runeZone(current).find(object => object.exhausted === false && object.name === "Fury Rune");
    expect(powerRune, JSON.stringify(runeZone(current))).toBeDefined();
    const power = submit(started, "player-1", {
      type: "rune-power", commandId: "RIFT-1180-sword-power", stateVersion: current.stateVersion,
      runeObjectId: powerRune!.objectId, zoneEntryId: powerRune!.zoneEntryId!,
    });
    expect(power.accepted, JSON.stringify(power)).toBe(true);
    current = view(started.room, "player-1");
    expect(current.players.find(player => player.playerId === "player-1")?.power)
      .toMatchObject({ Fury: 1 });

    const played = submit(started, "player-1", {
      type: "play", commandId: "RIFT-1180-play-long-sword", stateVersion: current.stateVersion,
      cardObjectId: longSword!.objectId, destination: { kind: "base", playerId: "player-1" },
    });
    expect(played.accepted, JSON.stringify(played)).toBe(true);
    current = view(started.room, "player-1");
    if (current.pendingChoice.status === "pending") {
      expect(current.pendingChoice.choiceId).toBe("target:quick-draw-unit");
      const target = current.pendingChoice.options?.find(option =>
        option.objectRef?.objectId === rumbleOnBoard!.objectId);
      expect(target, JSON.stringify(current.pendingChoice)).toBeDefined();
      const chosen = submit(started, "player-1", {
        type: "choose", commandId: "RIFT-1180-choose-rumble",
        stateVersion: current.stateVersion, choiceId: current.pendingChoice.choiceId,
        answer: [target!.objectRef!],
      });
      expect(chosen.accepted, JSON.stringify(chosen)).toBe(true);
      current = view(started.room, "player-1");
    }
    settleChain(started, "player-1");
    current = view(started.room, "player-1");
    const swordOnBoard = current.objects.find(object => object.cardId === LONG_SWORD && object.zone === "board");
    const liveRumble = current.objects.find(object => object.cardId === RUMBLE && object.zone === "board");
    expect(swordOnBoard).toBeDefined();
    expect(liveRumble).toBeDefined();
    expect(swordOnBoard!.location).toEqual({ kind: "base", playerId: "player-1" });

    // Both players see the attachment: the gear and its host are public permanents.
    for (const viewer of ["player-1", "player-2"]) {
      const seen = view(started.room, viewer);
      expect(seen.objects.find(object => object.objectId === swordOnBoard!.objectId)?.attachedToObjectId).toBe(liveRumble!.objectId);
      expect(seen.objects.find(object => object.objectId === liveRumble!.objectId)?.attachedToObjectId).toBeUndefined();
    }

    const field = current.battlefields.find(candidate => candidate.controllerPlayerId !== "player-1");
    expect(field).toBeDefined();
    const moved = submit(started, "player-1", {
      type: "move", commandId: "RIFT-1180-move-rumble", stateVersion: current.stateVersion,
      objectId: liveRumble!.objectId,
      to: { zone: "battlefield", locationId: field!.battlefieldId },
    });
    expect(moved.accepted, JSON.stringify(moved)).toBe(true);
    settleChain(started, "player-1");
    current = view(started.room, "player-1");
    const movedSword = current.objects.find(object => object.objectId === swordOnBoard!.objectId);
    expect(movedSword?.location).toMatchObject({ kind: "battlefield", battlefieldId: field!.battlefieldId });
    expect(movedSword?.attachedToObjectId).toBe(liveRumble!.objectId);
  }, 120_000);
});

describe("RIFT-1180 attachment links never reveal or go stale", () => {
  const snapshot = (id: string, zoneEntryId: number, attachedTo: ObjectSnapshot["attachedTo"]): ObjectSnapshot =>
    ({ ref: { id, zoneEntryId }, attachedTo } as unknown as ObjectSnapshot);
  const projected = (objectId: string, zoneEntryId: number, extra: Partial<V2Projection["objects"][number]> = {}) =>
    ({ objectId, zoneEntryId, zone: "board", ownerPlayerId: "player-1", faceDown: false, visibility: "public",
      location: { kind: "base", playerId: "player-1" }, ...extra } as V2Projection["objects"][number]);

  it("links gear to a face-up host on the board with the same zone entry", () => {
    const [sword] = withAttachmentHosts([projected("sword", 3), projected("unit", 2)],
      [snapshot("sword", 3, { id: "unit", zoneEntryId: 2 }), snapshot("unit", 2, null)]);
    expect(sword?.attachedToObjectId).toBe("unit");
  });

  it("drops the link once the host has left the board or re-entered as a new object", () => {
    const source = [snapshot("sword", 3, { id: "unit", zoneEntryId: 2 })];
    expect(withAttachmentHosts([projected("sword", 3), projected("unit", 2, { zone: "trash", location: undefined })], source)[0]
      ?.attachedToObjectId).toBeUndefined();
    expect(withAttachmentHosts([projected("sword", 3), projected("unit", 5)], source)[0]?.attachedToObjectId).toBeUndefined();
  });

  it("never names a face-down host or links face-down gear", () => {
    const source = [snapshot("sword", 3, { id: "unit", zoneEntryId: 2 })];
    expect(withAttachmentHosts([projected("sword", 3), projected("unit", 2, { faceDown: true })], source)[0]
      ?.attachedToObjectId).toBeUndefined();
    expect(withAttachmentHosts([projected("sword", 3, { faceDown: true }), projected("unit", 2)], source)[0]
      ?.attachedToObjectId).toBeUndefined();
  });
});
