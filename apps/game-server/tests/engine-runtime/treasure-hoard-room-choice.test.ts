import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession } from "../../../../packages/protocol/src/index.js";
import type { V2Command, V2CommandReceipt, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";

const TREASURE = "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564";
const PORO = "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82";
const GOLD = "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511";
const ROOM_SEED = "RIFT-1165-room-0-2-2";

// Official evidence:
// Treasure Hoard SFD-220/221: "When you conquer here, you may pay
// :rb_energy_1: to play a Gold gear token exhausted."
// CR v1.5 (2026-10-09, effective 2026-10-16) 383.3.a/.d and 405.1/.2 establish
// Finalize choice/payment and same-controller ordering for simultaneous triggers:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// canonicalCardId: card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564.

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
}

function projection(room: GameRoom, playerId: string): V2Projection {
  let result: V2Projection | undefined;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      result = (message as { readonly projection?: V2Projection }).projection;
    }
  });
  if (result === undefined) throw new Error(`Missing projection for ${playerId}`);
  return result;
}

function submit(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
  const session = started.sessions[playerId];
  const connectionId = started.connections[playerId];
  if (session === undefined || connectionId === undefined) throw new Error(`Missing room session ${playerId}`);
  let receipt: V2CommandReceipt | undefined;
  started.room.submitEngineV2(session, connectionId, command, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "command-receipt") {
      receipt = message as V2CommandReceipt;
    }
  });
  if (receipt === undefined) throw new Error(`Missing receipt for ${command.commandId}`);
  return receipt;
}

function v2(playerId: string, commandId: string, stateVersion: number,
  command: Omit<V2Command, "commandId" | "stateVersion">): V2Command {
  void playerId;
  return { ...command, commandId, stateVersion } as V2Command;
}

async function startedRoom(): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime();
  const room = new GameRoom(ROOM_SEED, DUEL_RULESET_ID, catalog, () => 2,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = (): void => undefined;
  const first = room.join("Jirry", noMessages, "rift-1165-room-a");
  const second = room.join("Opponent", noMessages, "rift-1165-room-b");
  const sessions = {
    [first.playerId]: { roomId: ROOM_SEED, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId: ROOM_SEED, playerId: second.playerId, resumeToken: second.resumeToken },
  } as const;
  const connections = {
    [first.playerId]: first.connectionId,
    [second.playerId]: second.connectionId,
  } as const;
  room.submitDeck(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, "rift-1165-deck-a", noMessages);
  room.setReady(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    true, "rift-1165-ready-a", noMessages);
  room.submitDeck(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["fiora-sfd"].deck, "rift-1165-deck-b", noMessages);
  room.setReady(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    true, "rift-1165-ready-b", noMessages);
  const started: StartedRoom = { room, sessions, connections };
  const playerIds = [first, second] as const;
  for (let index = 0; index < 2; index += 1) {
    const due = playerIds.map(connection => projection(room, connection.playerId)).find(view =>
      view.pendingChoice.status === "pending" &&
      view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending") {
      throw new Error("Expected a due Mulligan owner");
    }
    const receipt = submit(started, due.pendingChoice.ownerPlayerId,
      v2(due.pendingChoice.ownerPlayerId, `rift-1165-mulligan-${index}`, 0, {
        type: "mulligan", selectedObjectIds: [],
      }));
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  return started;
}

function fundA(started: StartedRoom, count: number, prefix: string): void {
  const runes = (projection(started.room, "player-1").zones.find(zone =>
    zone.zone === "rune-zone" && zone.ownerPlayerId === "player-1")?.objects ?? [])
    .filter(rune => rune.exhausted === false).slice(0, count);
  for (const [index, rune] of runes.entries()) {
    const view = projection(started.room, "player-1");
    const receipt = submit(started, "player-1", v2("player-1", `${prefix}:rune:${index}`, view.stateVersion, {
      type: "rune-energy", runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    }));
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
}

function settle(started: StartedRoom, prefix: string, stopAtChoice = false): void {
  for (let index = 0; index < 24; index += 1) {
    const view = projection(started.room, "player-1");
    if (view.pendingChoice.status === "pending" && stopAtChoice) return;
    if (view.chain.items.length === 0) {
      if (view.chain.focusPlayerId === null) return;
      const receipt = submit(started, view.chain.focusPlayerId,
        v2(view.chain.focusPlayerId, `${prefix}:focus:${index}`, view.stateVersion, { type: "pass" }));
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      continue;
    }
    const actor = view.chain.priorityPlayerId;
    if (actor === null) throw new Error(`No Chain actor at ${prefix}`);
    const receipt = submit(started, actor,
      v2(actor, `${prefix}:pass:${index}`, view.stateVersion, { type: "pass" }));
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  throw new Error(`Room Chain did not settle at ${prefix}`);
}

function reachTreasureChoice(started: StartedRoom, fundTreasure: boolean): void {
  fundA(started, 2, "play-poro");
  const hand = projection(started.room, "player-1").objects.find(object =>
    object.zone === "hand" && object.ownerPlayerId === "player-1" && object.cardId === PORO);
  expect(hand).toBeDefined();
  const played = submit(started, "player-1",
    v2("player-1", "play-poro", projection(started.room, "player-1").stateVersion, {
      type: "play", cardObjectId: hand!.objectId, destination: { kind: "base", playerId: "player-1" },
    }));
  expect(played.accepted, JSON.stringify(played)).toBe(true);
  settle(started, "play-poro");
  for (const [index, playerId] of ["player-1", "player-2"].entries()) {
    const receipt = submit(started, playerId,
      v2(playerId, `end:${index}`, projection(started.room, playerId).stateVersion, { type: "end-turn" }));
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  if (fundTreasure) fundA(started, 1, "treasure-energy");
  const poro = projection(started.room, "player-1").objects.find(object =>
    object.zone === "board" && object.ownerPlayerId === "player-1" && object.cardId === PORO);
  expect(poro).toBeDefined();
  const move = submit(started, "player-1",
    v2("player-1", "move-to-treasure", projection(started.room, "player-1").stateVersion, {
      type: "move", objectId: poro!.objectId,
      to: { zone: "battlefield", locationId: "token:7" },
    }));
  expect(move.accepted, JSON.stringify(move)).toBe(true);
  for (const [index, playerId] of ["player-1", "player-2"].entries()) {
    const view = projection(started.room, playerId);
    const receipt = submit(started, playerId,
      v2(playerId, `showdown:${index}`, view.stateVersion, { type: "pass" }));
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  const choice = projection(started.room, "player-1").pendingChoice;
  expect(choice).toMatchObject({ status: "pending", kind: "mode", ownerPlayerId: "player-1" });
  if (choice.status !== "pending") throw new Error("Missing trigger order choice");
  const treasure = choice.options?.find(option => option.label === "Treasure Hoard");
  expect(treasure).toBeDefined();
  const ordered = submit(started, "player-1",
    v2("player-1", "order-treasure", projection(started.room, "player-1").stateVersion, {
      type: "choose", choiceId: choice.choiceId, answer: treasure!.value!,
    }));
  expect(ordered.accepted, JSON.stringify(ordered)).toBe(true);
}

function chooseTreasure(started: StartedRoom, answer: boolean): void {
  const view = projection(started.room, "player-1");
  const choice = view.pendingChoice;
  expect(choice).toMatchObject({ status: "pending", kind: "optional", ownerPlayerId: "player-1",
    prompt: "Pay 1 energy to play a Gold gear token exhausted?", source: { name: "Treasure Hoard" } });
  if (choice.status !== "pending") throw new Error("Missing Treasure Hoard choice");
  const receipt = submit(started, "player-1",
    v2("player-1", `choose-treasure-${String(answer)}`, view.stateVersion, {
      type: "choose", choiceId: choice.choiceId, answer,
    }));
  expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
}

describe("RIFT-1165 real room Treasure Hoard choice", () => {
  it("projects the owner choice and pays for an exhausted Gold on acceptance", async () => {
    const started = await startedRoom();
    reachTreasureChoice(started, true);
    expect(projection(started.room, "player-1").players.find(player => player.playerId === "player-1")?.energy).toBe(1);
    chooseTreasure(started, true);
    expect(projection(started.room, "player-1").players.find(player => player.playerId === "player-1")?.energy).toBe(0);
    settle(started, "resolve");
    const gold = projection(started.room, "player-1").objects.find(object => object.cardId === GOLD);
    expect(gold).toMatchObject({ zone: "board", exhausted: true,
      location: { kind: "base", playerId: "player-1" } });
    expect(projection(started.room, "player-2").pendingChoice).not.toHaveProperty("prompt");
  }, 180_000);

  it("declines without spending Energy or creating a Treasure Hoard Gold", async () => {
    const started = await startedRoom();
    reachTreasureChoice(started, true);
    chooseTreasure(started, false);
    expect(projection(started.room, "player-1").players.find(player => player.playerId === "player-1")?.energy).toBe(1);
    settle(started, "resolve");
    const golds = projection(started.room, "player-1").objects.filter(object => object.cardId === GOLD);
    // Plundering Poro's separate mandatory ability still resolves and creates
    // its own exhausted Gold; the declined Treasure Hoard creates no second one.
    expect(golds).toHaveLength(1);
    expect(golds[0]).toMatchObject({ exhausted: true,
      location: { kind: "base", playerId: "player-1" } });
  }, 180_000);

  it("asks even when unpayable and an accepted decline-to-pay leaves no extra Gold", async () => {
    const started = await startedRoom();
    reachTreasureChoice(started, false);
    expect(projection(started.room, "player-1").players.find(player => player.playerId === "player-1")?.energy).toBe(0);
    chooseTreasure(started, true);
    settle(started, "resolve");
    const golds = projection(started.room, "player-1").objects.filter(object => object.cardId === GOLD);
    expect(golds).toHaveLength(1);
    expect(golds[0]).toMatchObject({ exhausted: true,
      location: { kind: "base", playerId: "player-1" } });
    expect(projection(started.room, "player-1").players.find(player => player.playerId === "player-1")?.energy).toBe(0);
  }, 180_000);
});
