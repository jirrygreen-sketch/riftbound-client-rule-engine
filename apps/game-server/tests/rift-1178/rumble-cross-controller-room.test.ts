import { describe, expect, it } from "vitest";

import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { V2_M1_PRECONS }
  from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";

// Riftbound Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 740.1.a: friendly objects share a controller. CR 191.5.a controls the
// ability from its source. CR 478.1.a and 479.3.a-b continuously re-evaluate
// ability-layer grants. CR 801.3.a.3 ties the grant to its source lifetime;
// CR 807.1.c and 807.1.d.1 make Assault contribute only while its host is an Attacker;
// CR 467.2.a-b sum each side's current Might. Rumble, Hotheaded's Assault is
// scoped by "Your Mechs". Official zh_CN gallery source, read 2026-10-31:
// https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
const FORECASTER =
  "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40";
const RUMBLE_HOTHEADED =
  "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";
const ROOM_ID = "RIFT-1178-6";

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
  readonly playerIds: readonly [string, string];
}

function readProjection(room: GameRoom, playerId: string): V2Projection {
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
  const a = room.join("A", noMessages, `${ROOM_ID}-a`);
  const b = room.join("B", noMessages, `${ROOM_ID}-b`);
  const sessions = {
    [a.playerId]: { roomId: ROOM_ID, playerId: a.playerId, resumeToken: a.resumeToken },
    [b.playerId]: { roomId: ROOM_ID, playerId: b.playerId, resumeToken: b.resumeToken },
  } as const;
  const connections = {
    [a.playerId]: a.connectionId,
    [b.playerId]: b.connectionId,
  } as const;
  const started = { room, sessions, connections,
    playerIds: [a.playerId, b.playerId] as const } satisfies StartedRoom;
  for (const seat of [a, b]) {
    room.submitDeck(sessions[seat.playerId]!, seat.connectionId, room.currentRoomVersion,
      V2_M1_PRECONS["rumble-sfd"].deck, `${ROOM_ID}-deck-${seat.playerId}`, noMessages);
    room.setReady(sessions[seat.playerId]!, seat.connectionId, room.currentRoomVersion, true,
      `${ROOM_ID}-ready-${seat.playerId}`, noMessages);
  }
  for (let index = 0; index < 2; index += 1) {
    const due = [a.playerId, b.playerId].map(playerId => readProjection(room, playerId)).find(view =>
      view.phase === "setup" && view.pendingChoice.status === "pending" &&
      view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending" || due.viewerPlayerId === null) {
      throw new Error("Expected a due Mulligan owner");
    }
    const receipt = submit(started, due.viewerPlayerId, {
      type: "mulligan", commandId: `${ROOM_ID}-mulligan-${index}`,
      stateVersion: 0, selectedObjectIds: [],
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  return started;
}

function hand(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "hand" &&
    zone.ownerPlayerId === playerId)?.objects ?? [];
}

function readyRunes(view: V2Projection, playerId: string) {
  return (view.zones.find(zone => zone.zone === "rune-zone" &&
    zone.ownerPlayerId === playerId)?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined);
}

function champion(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "champion" &&
    zone.ownerPlayerId === playerId)?.objects?.[0];
}

function settleChain(started: StartedRoom, actor: string, prefix = "chain"): void {
  for (let index = 0; index < 30; index += 1) {
    const view = readProjection(started.room, actor);
    if (view.pendingChoice.status === "pending") {
      const owner = view.pendingChoice.ownerPlayerId;
      if (owner === null) throw new Error("Pending choice has no owner");
      const pending = view.pendingChoice;
      const answer = pending.kind === "optional"
        ? (pending.options ?? []).find(option => option.value === false)?.value ?? false
        : pending.kind === "mode"
          ? (pending.options?.[0]?.value ?? pending.options?.[0]?.id ?? null)
          : pending.kind === "number" ? pending.min ?? 0 : [];
      const receipt = submit(started, owner, {
        type: "choose", commandId: `${ROOM_ID}-${prefix}-choice-${index}`,
        stateVersion: view.stateVersion, choiceId: pending.choiceId, answer,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      continue;
    }
    if (view.chain.items.length === 0) return;
    const priority = view.chain.priorityPlayerId;
    if (priority === null) throw new Error("Open chain has no priority holder");
    const receipt = submit(started, priority, {
      type: "pass", commandId: `${ROOM_ID}-${prefix}-pass-${index}`,
      stateVersion: view.stateVersion,
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  throw new Error("Chain did not settle");
}

function settleTurn(started: StartedRoom, playerId: string, turnOrdinal: number): void {
  for (let index = 0; index < 30; index += 1) {
    const view = readProjection(started.room, playerId);
    if (view.pendingChoice.status === "pending") {
      const owner = view.pendingChoice.ownerPlayerId;
      if (owner === null) throw new Error("Pending choice has no owner");
      const pending = view.pendingChoice;
      const answer = pending.kind === "optional"
        ? (pending.options ?? []).find(option => option.value === false)?.value ?? false
        : pending.kind === "mode"
          ? (pending.options?.[0]?.value ?? pending.options?.[0]?.id ?? null)
          : pending.kind === "number" ? pending.min ?? 0 : [];
      const receipt = submit(started, owner, {
        type: "choose", commandId: `${ROOM_ID}-turn-${turnOrdinal}-choice-${index}`,
        stateVersion: view.stateVersion, choiceId: pending.choiceId, answer,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      continue;
    }
    if (view.chain.items.length > 0) {
      const priority = view.chain.priorityPlayerId;
      if (priority === null) throw new Error("Open chain has no priority holder");
      const receipt = submit(started, priority, {
        type: "pass", commandId: `${ROOM_ID}-turn-${turnOrdinal}-pass-${index}`,
        stateVersion: view.stateVersion,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      continue;
    }
    if (view.combat.status === "active") {
      const focus = view.chain.focusPlayerId ?? view.priority.playerId;
      if (focus === null) throw new Error("Showdown has no Focus holder");
      const receipt = submit(started, focus, {
        type: "pass", commandId: `${ROOM_ID}-turn-${turnOrdinal}-focus-${index}`,
        stateVersion: view.stateVersion,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      continue;
    }
    const active = view.activePlayerId;
    if (active === null) throw new Error("Main phase has no active player");
    const receipt = submit(started, active, {
      type: "end-turn", commandId: `${ROOM_ID}-turn-${turnOrdinal}-end`,
      stateVersion: view.stateVersion,
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
    return;
  }
  throw new Error("Turn did not settle");
}

function moveToBattlefield(started: StartedRoom, playerId: string, objectId: string, ordinal: number): string {
  const view = readProjection(started.room, playerId);
  const move = view.actionOptions.moves.find(option => option.objectId === objectId &&
    option.destination.kind === "battlefield");
  expect(move, JSON.stringify({ objectId, moves: view.actionOptions.moves })).toBeDefined();
  if (move?.destination.kind !== "battlefield") throw new Error("Battlefield destination is missing");
  const receipt = submit(started, playerId, {
    type: "move", commandId: `${ROOM_ID}-move-${ordinal}`, stateVersion: view.stateVersion,
    objectId, to: { zone: "battlefield", locationId: move.destination.battlefieldId },
  });
  expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  return move.destination.battlefieldId;
}

function reachDamage(started: StartedRoom, playerId: string): V2Projection["combat"] {
  for (let index = 0; index < 20; index += 1) {
    const view = readProjection(started.room, playerId);
    if (view.combat.status === "active" && view.combat.step === "damage") return view.combat;
    if (view.pendingChoice.status === "pending") {
      settleChain(started, playerId);
      continue;
    }
    if (view.chain.items.length > 0) {
      settleChain(started, playerId);
      continue;
    }
    if (view.combat.status === "active" && view.actionOptions.canAdvance && view.activePlayerId !== null) {
      const receipt = submit(started, view.activePlayerId, {
        type: "advance", commandId: `${ROOM_ID}-combat-advance-${index}`,
        stateVersion: view.stateVersion,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      continue;
    }
    const focus = view.chain.focusPlayerId ?? view.priority.playerId;
    if (focus === null) throw new Error("Showdown has no Focus holder");
    const receipt = submit(started, focus, {
      type: "pass", commandId: `${ROOM_ID}-combat-pass-${index}`,
      stateVersion: view.stateVersion,
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  throw new Error("Combat did not reach its damage window");
}

function fundAndPlay(started: StartedRoom, playerId: string,
  card: V2Projection["objects"][number], energy: number, label: string): string {
  const view = readProjection(started.room, playerId);
  for (const [index, rune] of readyRunes(view, playerId).slice(0, energy).entries()) {
    const receipt = submit(started, playerId, {
      type: "rune-energy", commandId: `${ROOM_ID}-energy-${playerId}-${index}`,
      stateVersion: readProjection(started.room, playerId).stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  const playView = readProjection(started.room, playerId);
  const play = submit(started, playerId, {
    type: "play", commandId: `${ROOM_ID}-play-${label}`, stateVersion: playView.stateVersion,
    cardObjectId: card.objectId, destination: { kind: "base", playerId },
  });
  expect(play.accepted || play.pending === true, JSON.stringify(play)).toBe(true);
  settleChain(started, playerId);
  return card.objectId;
}

function settleOpen(started: StartedRoom, actor: string): void {
  for (let index = 0; index < 20; index += 1) {
    const view = readProjection(started.room, actor);
    if (view.pendingChoice.status === "pending") {
      settleChain(started, actor, `open-${index}`);
      continue;
    }
    if (view.chain.items.length > 0) {
      settleChain(started, actor, `open-chain-${index}`);
      continue;
    }
    if (view.combat.status === "active") {
      if (view.combat.step === "damage") return;
      const focus = view.chain.focusPlayerId ?? view.priority.playerId;
      if (focus === null) throw new Error("Showdown has no Focus holder");
      const receipt = submit(started, focus, {
        type: "pass", commandId: `${ROOM_ID}-focus-${index}`, stateVersion: view.stateVersion,
      });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      continue;
    }
    return;
  }
  throw new Error("Open-state settling exceeded its bound");
}

describe("RIFT-1178 authoritative room aura ownership", () => {
  it("keeps Rumble Hotheaded's Assault out of the opposing Forecaster's damage budget", async () => {
    const started = await startRoom();
    const [aId, bId] = started.playerIds;
    const aForecasterCard = hand(readProjection(started.room, aId), aId)
      .find(object => object.cardId === FORECASTER);
    expect(aForecasterCard).toBeDefined();
    const aForecaster = fundAndPlay(started, aId, aForecasterCard!, 2, "forecaster");
    let bView = readProjection(started.room, bId);
    expect(bView.activePlayerId).toBe(aId);
    for (let index = 0; index < 6; index += 1) settleTurn(started, aId, index);
    expect(readProjection(started.room, bId).activePlayerId).toBe(aId);
    settleTurn(started, bId, 6);
    const bChampion = champion(readProjection(started.room, bId), bId);
    expect(bChampion).toMatchObject({ cardId: RUMBLE_HOTHEADED, faceDown: false });
    const bRumble = fundAndPlay(started, bId, bChampion!, 4, "rumble");
    const preGame = readProjection(started.room, aId);
    expect(preGame.phase).toBe("main");
    expect(preGame.objects.some(object => object.objectId === aForecaster &&
      object.cardId === FORECASTER && object.zone === "board")).toBe(true);
    expect(readProjection(started.room, bId).objects.some(object =>
      object.objectId === bRumble && object.cardId === RUMBLE_HOTHEADED)).toBe(true);
    expect(aForecaster).not.toBe(bRumble);

    // Rumble and Forecaster entered exhausted. Advance to B's next turn and
    // move Hotheaded first, then join with Forecaster on A's next turn.
    settleTurn(started, aId, 7);
    expect(readProjection(started.room, bId).activePlayerId).toBe(aId);
    settleTurn(started, bId, 8);
    expect(readProjection(started.room, bId).activePlayerId).toBe(bId);
    const battlefieldId = moveToBattlefield(started, bId, bRumble, 0);
    settleOpen(started, bId);
    settleTurn(started, bId, 9);
    expect(readProjection(started.room, bId).activePlayerId).toBe(aId);
    moveToBattlefield(started, aId, aForecaster, 1);
    const combat = reachDamage(started, aId);
    expect(combat).toMatchObject({ status: "active", step: "damage", battlefieldId });
    if (combat.status !== "active" || combat.damage === undefined) throw new Error("Missing damage plan");
    expect(combat.attackerPlayerId).toBe(aId);
    expect(combat.defenderPlayerId).toBe(bId);
    expect(combat.damage.attackerMight).toBe(2,
      "B Rumble Hotheaded's Assault does not reach A Forecaster");
    const inspected = (started.room as unknown as { engineRuntime?: {
      host?: { objects: () => readonly { ref: { id: string; zoneEntryId: number }; controller: string;
        might: number | null; keywords: readonly { id: string; value?: number }[]; types: readonly string[] }[] };
      match?: { flow?: { chain?: { layers: { setObjects: (objects: readonly unknown[]) => void;
        evaluateAll: () => readonly { ref: { id: string }; might: number | null;
          keywords: readonly { id: string; value?: number }[]; controller: string; types: readonly string[] }[] } } } };
    } }).engineRuntime;
    if (inspected?.host === undefined || inspected.match?.flow?.chain === undefined) {
      throw new Error("GameRoom did not expose its authoritative layers");
    }
    inspected.match.flow.chain.layers.setObjects(inspected.host.objects());
    const defenderLayer = inspected.match.flow.chain.layers.evaluateAll()
      .find(object => object.ref.id === bRumble)!;
    const internalController = defenderLayer.controller;
    expect(internalController).toBe(combat.defenderPlayerId === bId ? "B" : "A");
    expect(combat.damage.defenderMight).toBe(5,
      "B's defender gets its own Mechanized Menace Shield but no Assault while defending");
  }, 180_000);
});
