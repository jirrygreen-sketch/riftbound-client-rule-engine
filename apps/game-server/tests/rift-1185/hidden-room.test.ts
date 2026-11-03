// RIFT-1185 (player report c8366bf6): Hidden cards could not be hidden. The
// engine already implements Hide and playing from facedown; protocol v2 had
// no `hide` command, the projection listed no Hide option, and a hidden card
// was neither concealed nor playable through the room.
//
// Official evidence:
// - Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
//   CR 811.1.c Hide is a turn-player Open State action paying one Power of any
//   Domain; CR 811.1.d a hidden card is played as a Reaction from its
//   Facedown Zone on a later turn, ignoring its Energy/Power cost; CR 107.3.f
//   and 128.4 the Facedown Zone is public but the card's face is Private to
//   its controller.
// - Card text (official zh_CN gallery,
//   https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN,
//   updated 2026-10-28): sfd-070-221 痛苦之酬 and ogn-083-298 借鉴历史 both read
//   “[待命]（支付:rb_rune_rainbow:正面朝下放置此牌，之后可支付:rb_energy_0:将其当作反应牌打出。）”.
//   Both are in the Rumble M1 precon.
import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import {
  isV2CommandReceipt,
  isV2Projection,
  type V2Command,
  type V2CommandReceipt,
  type V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import {
  botCommand,
  projectedCombatDamagePlayer,
  projectedPlayCommand,
  readyRunes,
} from "../../../../packages/integration-tests/src/v2-duel/bot.js";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";

// The room id seeds the shuffle; this one lets Rumble hide 痛苦之酬 (sfd-070-221).
const ROOM_ID = "RIFT-1185-room-0";
const WAGES_OF_PAIN = "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c";
const RUMBLE = "player-1";
const FIORA = "player-2";

type CardFact = {
  readonly energy: number | null;
  readonly power: number | null;
  readonly status: string;
  readonly kind: "unit" | "gear" | "spell";
};

const cardFacts = new Map<string, CardFact>(Object.values(V2_M1_PRECONS).flatMap(precon =>
  precon.cards.map(card => {
    const program = cardProgramsById.get(card.canonicalCardId) as unknown as CardProgram | undefined;
    const normalized = card.cardType.toLowerCase();
    const kind: CardFact["kind"] = normalized === "unit" ? "unit" : normalized === "gear" ? "gear" : "spell";
    return [card.canonicalCardId, {
      energy: card.energy ?? null,
      power: card.power ?? null,
      status: String(program?.status ?? "pending"),
      kind,
    }] as const;
  })));

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
}

function view(room: GameRoom, playerId: string): V2Projection {
  let result: unknown;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      result = (message as { readonly projection?: unknown }).projection;
    }
  });
  if (!isV2Projection(result)) throw new Error(`Invalid projection for ${playerId}`);
  return result;
}

function submit(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
  const session = started.sessions[playerId];
  const connection = started.connections[playerId];
  if (!session || !connection) throw new Error(`Missing room session for ${playerId}`);
  let receipt: unknown;
  started.room.submitEngineV2(session, connection, command, message => {
    if (isV2CommandReceipt(message)) receipt = message;
  });
  if (!isV2CommandReceipt(receipt)) throw new Error(`Missing receipt for ${command.commandId}`);
  return receipt;
}

async function startRoom(roomId: string): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime();
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = () => undefined;
  const first = room.join("Rumble", noMessages, `${roomId}-a`);
  const second = room.join("Fiora", noMessages, `${roomId}-b`);
  const sessions = {
    [first.playerId]: { roomId, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId, playerId: second.playerId, resumeToken: second.resumeToken },
  } as const;
  const connections = { [first.playerId]: first.connectionId, [second.playerId]: second.connectionId } as const;
  room.submitDeck(sessions[first.playerId], first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, `${roomId}-deck-a`, noMessages);
  room.setReady(sessions[first.playerId], first.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-a`, noMessages);
  room.submitDeck(sessions[second.playerId], second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["fiora-sfd"].deck, `${roomId}-deck-b`, noMessages);
  room.setReady(sessions[second.playerId], second.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-b`, noMessages);
  const started = { room, sessions, connections };
  for (let index = 0; index < 2; index += 1) {
    const due = [first.playerId, second.playerId].map(playerId => view(room, playerId)).find(candidate =>
      candidate.phase === "setup" && candidate.pendingChoice.status === "pending" &&
      candidate.pendingChoice.ownerPlayerId === candidate.viewerPlayerId);
    if (!due || due.pendingChoice.status !== "pending") throw new Error("Expected a due mulligan owner");
    const receipt = submit(started, due.pendingChoice.ownerPlayerId, {
      type: "mulligan", commandId: `${roomId}-mulligan-${index}`, stateVersion: 0, selectedObjectIds: [],
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  return started;
}

function actorAndView(first: V2Projection, second: V2Projection): { readonly actor: string; readonly view: V2Projection } {
  const pending = [first, second].find(candidate => candidate.pendingChoice.status === "pending" &&
    candidate.pendingChoice.ownerPlayerId === candidate.viewerPlayerId);
  if (pending) return { actor: pending.viewerPlayerId!, view: pending };
  const actor = projectedCombatDamagePlayer(first) ?? first.priority.playerId ??
    (first.actionOptions.canAdvance ? first.activePlayerId : null) ??
    (first.phase === "main" && first.chain.items.length === 0 && first.combat.status === "none"
      ? first.activePlayerId : null) ??
    (first.actionOptions.canEndTurn ? first.activePlayerId : null);
  if (actor === null) throw new Error(`No actor at state ${first.stateVersion}`);
  return { actor, view: actor === first.viewerPlayerId ? first : second };
}

interface HiddenRecord {
  readonly objectId: string;
  readonly cardId: string;
  readonly battlefieldId: string;
  readonly turnNumber: number;
}

/** Everything the opponent and a spectator-free room publish to Fiora must stay identity-free. */
function expectConcealedFrom(opponent: V2Projection, hidden: HiddenRecord): void {
  const atField = opponent.objects.filter(object => object.zone === "facedown" &&
    object.location?.kind === "battlefield" && object.location.battlefieldId === hidden.battlefieldId);
  expect(atField).toHaveLength(1);
  expect(atField[0]).toMatchObject({ faceDown: true, ownerPlayerId: RUMBLE });
  expect(atField[0]!.cardId).toBeUndefined();
  expect(atField[0]!.name).toBeUndefined();
  expect(atField[0]!.objectId).not.toBe(hidden.objectId);
  const serialized = JSON.stringify(opponent);
  expect(serialized).not.toContain(`"${hidden.objectId}"`);
  expect(opponent.objects.some(object => object.cardId === hidden.cardId &&
    object.location?.kind === "battlefield")).toBe(false);
  expect(opponent.actionOptions.hides ?? []).toEqual([]);
}

describe("RIFT-1185 Hidden through a real M1 room", () => {
  it("hides a Rumble card for one Power, keeps it private, and plays it from facedown on a later turn", async () => {
    const started = await startRoom(ROOM_ID);
    const rejected = new Map<string, Set<string>>();
    let hidden: HiddenRecord | null = null;
    let sawUnpayableHide = false;
    let sawLockedTurn = false;
    let played: { readonly energyBefore: number; readonly turnNumber: number } | null = null;
    for (let action = 0; action < 1500 && played === null; action += 1) {
      const first = view(started.room, RUMBLE);
      const second = view(started.room, FIORA);
      expect(second.actionOptions.hides ?? []).toEqual([]);
      if (hidden !== null) expectConcealedFrom(second, hidden);
      const { actor, view: current } = actorAndView(first, second);
      const commandId = `${ROOM_ID}-${action}`;
      let command: V2Command | null = null;
      if (actor === RUMBLE && current.pendingChoice.status === "none") {
        if (hidden === null) {
          const option = current.actionOptions.hides?.[0];
          if (option !== undefined && !option.payable) {
            sawUnpayableHide = true;
            const rune = readyRunes(current, RUMBLE)[0];
            if (rune !== undefined) {
              command = { type: "rune-power", commandId, stateVersion: current.stateVersion,
                runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId };
            }
          } else if (option !== undefined) {
            command = { type: "hide", commandId, stateVersion: current.stateVersion,
              cardObjectId: option.cardObjectId, battlefieldId: option.battlefieldId };
          }
        } else {
          const option = current.actionOptions.plays.find(candidate => candidate.cardObjectId === hidden!.objectId);
          if (option === undefined) {
            if (current.turnNumber === hidden.turnNumber) sawLockedTurn = true;
          } else {
            expect(current.turnNumber).toBeGreaterThan(hidden.turnNumber);
            command = projectedPlayCommand(option, commandId, current.stateVersion);
            played = { energyBefore: current.players.find(player => player.playerId === RUMBLE)!.energy,
              turnNumber: current.turnNumber };
          }
        }
      }
      command ??= botCommand(current, actor, commandId, rejected.get(actor) ?? new Set(), cardFacts);
      if (command === null) throw new Error(`No command for ${actor} at state ${current.stateVersion}`);
      const receipt = submit(started, actor, command);
      if (command.type === "hide" || (played !== null && command.type === "play")) {
        expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
      } else if (!receipt.accepted && command.type === "play") {
        const values = rejected.get(actor) ?? new Set();
        values.add(command.cardObjectId);
        rejected.set(actor, values);
      }
      if (command.type === "hide") {
        const own = view(started.room, RUMBLE);
        const card = own.objects.find(object => object.objectId === command.cardObjectId);
        expect(card).toMatchObject({ zone: "facedown", faceDown: true, visibility: "owner-only",
          location: { kind: "battlefield", battlefieldId: command.battlefieldId } });
        expect(card!.cardId).toBeDefined();
        expect(own.objects.filter(object => object.zone === "hand" && object.objectId === command.cardObjectId))
          .toHaveLength(0);
        // The Facedown Zone holds one card and Hide unlocks only on a later turn.
        expect(own.actionOptions.hides?.some(option => option.battlefieldId === command.battlefieldId) ?? false)
          .toBe(false);
        expect(own.actionOptions.plays.some(option => option.cardObjectId === command.cardObjectId)).toBe(false);
        hidden = { objectId: command.cardObjectId, cardId: card!.cardId!, battlefieldId: command.battlefieldId,
          turnNumber: own.turnNumber };
        expectConcealedFrom(view(started.room, FIORA), hidden);
      }
    }
    expect(hidden, "Rumble never had a Hide option").not.toBeNull();
    expect(hidden!.cardId).toBe(WAGES_OF_PAIN);
    expect(sawUnpayableHide).toBe(true);
    expect(sawLockedTurn).toBe(true);
    expect(played, "the hidden card was never offered from facedown").not.toBeNull();
    // Playing from facedown ignores the printed Energy cost (CR 811.1.d).
    expect(view(started.room, RUMBLE).players.find(player => player.playerId === RUMBLE)!.energy)
      .toBe(played!.energyBefore);
    // Answer the play's Finalize choices and resolve the Chain it opened.
    for (let action = 0; action < 40; action += 1) {
      const first = view(started.room, RUMBLE);
      const second = view(started.room, FIORA);
      if (first.chain.items.length === 0 && first.pendingChoice.status === "none" &&
          second.pendingChoice.status === "none") break;
      const { actor, view: current } = actorAndView(first, second);
      const command = botCommand(current, actor, `${ROOM_ID}-settle-${action}`, new Set(), cardFacts);
      if (command === null) throw new Error(`No settle command for ${actor} at state ${current.stateVersion}`);
      expect(submit(started, actor, command).accepted).toBe(true);
    }
    const own = view(started.room, RUMBLE);
    expect(own.chain.items).toEqual([]);
    expect(own.objects.find(object => object.objectId === hidden!.objectId))
      .toMatchObject({ zone: "trash", faceDown: false, cardId: hidden!.cardId });
    const opponent = view(started.room, FIORA);
    expect(opponent.objects.some(object => object.zone === "facedown" &&
      object.location?.kind === "battlefield" && object.location.battlefieldId === hidden!.battlefieldId))
      .toBe(false);
    // Once played, the card is public in its owner's Trash (CR 811.1.d).
    expect(opponent.objects.find(object => object.objectId === hidden!.objectId))
      .toMatchObject({ zone: "trash", cardId: hidden!.cardId });
  }, 120_000);
});
