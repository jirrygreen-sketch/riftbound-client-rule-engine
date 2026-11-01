import { expect } from "vitest";
import { DUEL_RULESET_ID, type ClientSession } from "../../../../packages/protocol/src/index.js";
import type {
  V2Command,
  V2CommandReceipt,
  V2PendingChoice,
  V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";

export const PLAYER_1 = "player-1";
export const PLAYER_2 = "player-2";
let commandSerial = 0;

export function commandId(prefix: string): string {
  commandSerial += 1;
  return `${prefix}:${commandSerial}`;
}

export interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
}

function receiveProjection(room: GameRoom, playerId: string): V2Projection {
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

export function projection(started: StartedRoom, playerId: string): V2Projection {
  return receiveProjection(started.room, playerId);
}

export function submit(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
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

export function accepted(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
  const receipt = submit(started, playerId, command);
  expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  return receipt;
}

export async function startRoom(roomId: string, firstDeck: "rumble-sfd" | "fiora-sfd",
  secondDeck: "rumble-sfd" | "fiora-sfd", battlefieldChoice: number): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime();
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => battlefieldChoice,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = (): void => undefined;
  const first = room.join("Player One", noMessages, `${roomId}-a`);
  const second = room.join("Player Two", noMessages, `${roomId}-b`);
  const sessions = {
    [first.playerId]: { roomId, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId, playerId: second.playerId, resumeToken: second.resumeToken },
  } as const;
  const connections = {
    [first.playerId]: first.connectionId,
    [second.playerId]: second.connectionId,
  } as const;
  room.submitDeck(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS[firstDeck].deck, `${roomId}-deck-a`, noMessages);
  room.setReady(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-a`, noMessages);
  room.submitDeck(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS[secondDeck].deck, `${roomId}-deck-b`, noMessages);
  room.setReady(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-b`, noMessages);
  const started = { room, sessions, connections };
  for (let index = 0; index < 2; index += 1) {
    const due = [first.playerId, second.playerId]
      .map(playerId => receiveProjection(room, playerId))
      .find(view => view.pendingChoice.status === "pending" &&
        view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending") {
      throw new Error("Expected a due Mulligan owner");
    }
    accepted({ room, sessions, connections }, due.viewerPlayerId!, {
      type: "mulligan", commandId: commandId(`${roomId}-mulligan-${index}`), stateVersion: 0,
      selectedObjectIds: [],
    });
  }
  return started;
}

export function ownedHand(view: V2Projection, playerId: string) {
  return view.objects.filter(object => object.ownerPlayerId === playerId && object.zone === "hand");
}

export function ownedBoard(view: V2Projection, playerId: string, cardId?: string) {
  return view.objects.filter(object => object.ownerPlayerId === playerId && object.zone === "board" &&
    (cardId === undefined || object.cardId === cardId));
}

export function readyRunes(view: V2Projection, playerId: string) {
  return (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined);
}

export function fundEnergy(started: StartedRoom, playerId: string, count: number, prefix: string): void {
  const view = projection(started, playerId);
  const available = readyRunes(view, playerId);
  const current = view.players.find(player => player.playerId === playerId)?.energy ?? 0;
  const runes = available.slice(0, Math.max(0, count - current));
  expect(current + runes.length, JSON.stringify({ playerId, prefix, ready: available.length })).toBeGreaterThanOrEqual(count);
  for (const [index, rune] of runes.entries()) {
    accepted(started, playerId, {
      type: "rune-energy", commandId: `${prefix}:rune:${index}`,
      stateVersion: projection(started, playerId).stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    });
  }
}

export function fundPower(started: StartedRoom, playerId: string, name: string, count: number,
  prefix: string): void {
  const runes = readyRunes(projection(started, playerId), playerId)
    .filter(rune => rune.name === name).slice(0, count);
  expect(runes.length, JSON.stringify({ playerId, prefix, name })).toBe(count);
  for (const [index, rune] of runes.entries()) {
    accepted(started, playerId, {
      type: "rune-power", commandId: commandId(`${prefix}:rune-power:${index}`),
      stateVersion: projection(started, playerId).stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    });
  }
}

export function settle(started: StartedRoom, viewerId: string, prefix: string): void {
  for (let index = 0; index < 40; index += 1) {
    const views = ["player-1", "player-2"].map(playerId => projection(started, playerId));
    const owed = views.map(view => view.pendingChoice).find(choice =>
      choice.status === "pending" && views.some(view => view.viewerPlayerId === choice.ownerPlayerId));
    if (owed?.status === "pending") {
      const owner = owed.ownerPlayerId;
      let answer: string | number | boolean | readonly { readonly objectId: string; readonly zoneEntryId: number }[];
      if (owed.kind === "optional") answer = false;
      else if (owed.kind === "mode") {
        const option = owed.options?.[0];
        if (!option) throw new Error(`Missing mode option at ${prefix}`);
        answer = option.value ?? option.id;
      } else if (owed.kind === "number") answer = owed.min ?? 0;
      else {
        const refs = (owed.options ?? []).flatMap(option => option.objectRef === undefined ? [] : [option.objectRef]);
        answer = owed.kind === "order" ? refs : refs.slice(0, owed.min ?? 0);
      }
      accepted(started, owner, { type: "choose", commandId: commandId(`${prefix}:choose:${index}`),
        stateVersion: projection(started, owner).stateVersion, choiceId: owed.choiceId, answer });
      continue;
    }
    const view = projection(started, viewerId);
    if (view.pendingChoice.status === "pending") return;
    if (view.chain.items.length > 0) {
      const actor = view.chain.priorityPlayerId;
      if (actor === null) throw new Error(`No Chain actor at ${prefix}`);
      accepted(started, actor, { type: "pass", commandId: commandId(`${prefix}:chain:${index}`), stateVersion: view.stateVersion });
      continue;
    }
    if (view.chain.focusPlayerId !== null) {
      accepted(started, view.chain.focusPlayerId, {
        type: "pass", commandId: commandId(`${prefix}:focus:${index}`), stateVersion: view.stateVersion,
      });
      continue;
    }
    if (view.actionOptions.canAdvance === true) {
      accepted(started, view.activePlayerId, {
        type: "advance", commandId: commandId(`${prefix}:advance:${index}`), stateVersion: view.stateVersion,
      });
      continue;
    }
    return;
  }
  throw new Error(`Room did not settle at ${prefix}`);
}

/** Settle only choices/Chain work caused by the current owner's play. */
export function settlePlay(started: StartedRoom, playerId: string, prefix: string): void {
  for (let index = 0; index < 24; index += 1) {
    const view = projection(started, playerId);
    const choice = view.pendingChoice;
    if (choice.status === "pending" && choice.ownerPlayerId === playerId) {
      let answer: string | number | boolean | readonly { readonly objectId: string; readonly zoneEntryId: number }[];
      if (choice.kind === "optional") answer = false;
      else if (choice.kind === "mode") {
        const option = choice.options?.[0];
        if (!option) throw new Error(`Missing mode option at ${prefix}`);
        answer = option.value ?? option.id;
      } else if (choice.kind === "number") answer = choice.min ?? 0;
      else {
        const refs = (choice.options ?? []).flatMap(option => option.objectRef === undefined ? [] : [option.objectRef]);
        answer = choice.kind === "order" ? refs : refs.slice(0, choice.min ?? 0);
      }
      accepted(started, playerId, {
        type: "choose", commandId: commandId(`${prefix}:choose:${index}`), stateVersion: view.stateVersion,
        choiceId: choice.choiceId, answer,
      });
      continue;
    }
    if (view.chain.items.length === 0 && view.chain.focusPlayerId === null) return;
    const actor = view.chain.priorityPlayerId ?? view.chain.focusPlayerId;
    if (actor === null) throw new Error(`Missing settle actor at ${prefix}`);
    accepted(started, actor, {
      type: "pass", commandId: commandId(`${prefix}:pass:${index}`), stateVersion: view.stateVersion,
    });
  }
  throw new Error(`Play did not settle at ${prefix}`);
}

export function openMain(started: StartedRoom, playerId: string): V2Projection {
  let view = projection(started, playerId);
  for (let guard = 0; view.phase !== "main" && guard < 12; guard += 1) {
    accepted(started, view.activePlayerId, {
      type: "end-turn", commandId: commandId(`${started.room.roomId}:open-main:${guard}`),
      stateVersion: view.stateVersion,
    });
    settle(started, playerId, `${started.room.roomId}:open-main-settle:${guard}`);
    view = projection(started, playerId);
  }
  expect(view.phase).toBe("main");
  return view;
}

export function nextOwnMain(started: StartedRoom, playerId: string, expectedTurn: number): V2Projection {
  let view = projection(started, playerId);
  for (let guard = 0; !(view.phase === "main" && view.activePlayerId === playerId &&
    view.turnNumber > expectedTurn) && guard < 12; guard += 1) {
    accepted(started, view.activePlayerId, {
      type: "end-turn", commandId: commandId(`${started.room.roomId}:next-main:${guard}`),
      stateVersion: view.stateVersion,
    });
    settle(started, playerId, `${started.room.roomId}:next-main-settle:${guard}`);
    view = projection(started, playerId);
  }
  expect(view).toMatchObject({ phase: "main", activePlayerId: playerId });
  return view;
}

export function pendingChoice(started: StartedRoom, playerId: string): Extract<V2PendingChoice, { status: "pending" }> {
  const choice = projection(started, playerId).pendingChoice;
  expect(choice, JSON.stringify(projection(started, playerId).pendingChoice)).toMatchObject({
    status: "pending", ownerPlayerId: playerId,
  });
  if (choice.status !== "pending") throw new Error(`Missing pending choice for ${playerId}`);
  return choice;
}
