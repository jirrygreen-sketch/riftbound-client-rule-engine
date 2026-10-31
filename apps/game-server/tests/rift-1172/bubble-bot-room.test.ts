import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession, type RoomDeckSubmission } from "@riftbound/protocol";
import {
  isV2CommandReceipt,
  isV2Projection,
  type V2Command,
  type V2CommandReceipt,
  type V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";
import { buildM1Deck } from "../../../../packages/integration-tests/src/headless/decks.js";

// Official evidence: Core Rules v1.5 (published 2026-10-09, effective
// 2026-10-16), https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
// 5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf. CR 143.4 makes a played Unit
// enter exhausted, 339.1 requires both response passes and 340.1 resolves the
// newest item, 383.4.a.2 creates the Play Effect after the permanent enters,
// 401-403.2 make its required choice during that Triggered Ability's
// finalization, 355.7 and 406.1 keep the chosen object a legal Target, and
// 416.1 makes Ready turn the selected exhausted Unit ready.
// Bubble Bot canonical id:
// card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389.

const BUBBLE_BOT = "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389";
const RUMBLE = "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";

type Seat = {
  readonly id: "player-1" | "player-2";
  readonly connectionId: string;
  readonly session: ClientSession;
};

function projection(room: GameRoom, playerId: "player-1" | "player-2"): V2Projection {
  let packet: unknown;
  room.sendProjection(playerId, message => { packet = message; });
  if (!packet || typeof packet !== "object" || (packet as { type?: unknown }).type !== "projection") {
    throw new Error("engine-v2 room projection required");
  }
  const value = (packet as { projection: unknown }).projection;
  if (!isV2Projection(value)) throw new Error("invalid engine-v2 projection");
  return value;
}

function hand(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function cardSubmission(cards: readonly { readonly canonicalCardId: string }[], printing: ReadonlyMap<string, string>) {
  const quantities = new Map<string, number>();
  for (const card of cards) quantities.set(card.canonicalCardId, (quantities.get(card.canonicalCardId) ?? 0) + 1);
  return [...quantities].map(([canonicalCardId, quantity]) => {
    const cardId = printing.get(canonicalCardId);
    if (cardId === undefined) throw new Error(`No catalog printing for ${canonicalCardId}`);
    return { cardId, quantity };
  });
}

async function boot() {
  const catalog = await loadCardCatalogRuntime();
  const printing = new Map(catalog.publicCatalog.cards.map(card => [card.canonicalCardId, card.id] as const));
  const submit = (seat: "A" | "B"): RoomDeckSubmission => {
    const deck = buildM1Deck("rumble-sfd", seat);
    return {
      mainDeck: cardSubmission(deck.mainDeck, printing),
      runes: cardSubmission(deck.runeDeck, printing),
      legend: cardSubmission([deck.championLegend], printing),
      champion: cardSubmission([deck.chosenChampion], printing),
      battlefields: cardSubmission(deck.battlefields, printing),
    };
  };

  // This fixed room id gives a deterministic opening hand containing both the
  // printed Bubble Bot and Rumble from the current official precon catalog.
  // It exercises real setup/shuffle instead of replacing projected state.
  const room = new GameRoom("RIFT-1172-room-5", DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const makeSeat = (name: string, connectionId: string): Seat => {
    const connection = room.join(name, () => undefined, connectionId);
    return {
      id: connection.playerId,
      connectionId,
      session: { roomId: room.roomId, playerId: connection.playerId, resumeToken: connection.resumeToken },
    };
  };
  const seats = [makeSeat("Alice", "a"), makeSeat("Bob", "b")] as const;
  const decks = [submit("A"), submit("B")] as const;
  for (const [index, seat] of seats.entries()) {
    room.submitDeck(seat.session, seat.connectionId, room.currentRoomVersion,
      decks[index]!, `deck-${index}`, () => undefined);
    room.setReady(seat.session, seat.connectionId, room.currentRoomVersion, true,
      `ready-${index}`, () => undefined);
  }
  for (let index = 0; index < 2; index += 1) {
    const setup = projection(room, seats[index]!.id);
    if (setup.pendingChoice.status !== "pending") throw new Error("mulligan projection must be pending");
    const owner = seats.find(seat => seat.id === setup.pendingChoice.ownerPlayerId)!;
    room.submitEngineV2(owner.session, owner.connectionId,
      { type: "mulligan", commandId: `mulligan-${index}`, stateVersion: 0, selectedObjectIds: [] },
      () => undefined);
  }
  return { room, seats, catalog };
}

function submit(room: GameRoom, seat: Seat, command: Omit<V2Command, "commandId"> & { readonly commandId: string }) {
  let receipt: V2CommandReceipt | null = null;
  room.submitEngineV2(seat.session, seat.connectionId, command as V2Command, value => {
    if (isV2CommandReceipt(value)) receipt = value;
  });
  if (receipt === null) throw new Error(`No receipt for ${command.commandId}`);
  return receipt;
}

describe("RIFT-1172 Bubble Bot real GameRoom path", () => {
  it("sends play -> choose -> both passes and projects the selected Rumble ready", async () => {
    const { room, seats, catalog } = await boot();
    expect(catalog.publicCatalog.cards.some(card => card.canonicalCardId === BUBBLE_BOT)).toBe(true);

    let view = projection(room, seats[0]!.id);
    for (let step = 0; step < 40; step += 1) {
      view = projection(room, seats[0]!.id);
      const actingId = view.priority.playerId ?? view.activePlayerId;
      const active = seats.find(seat => seat.id === actingId)!;
      if (active.id === seats[0]!.id) {
        const wanted = hand(view, active.id).some(card => card.cardId === BUBBLE_BOT) &&
          hand(view, active.id).some(card => card.cardId === RUMBLE);
        const readyRunes = (view.zones.find(zone => zone.zone === "rune-zone" &&
          zone.ownerPlayerId === active.id)?.objects ?? []).filter(rune => rune.exhausted === false);
        if (wanted && readyRunes.length >= 2) {
          const energy = view.players.find(player => player.playerId === active.id)?.energy ?? 0;
          if (energy >= 7) break;
          const rune = readyRunes[0]!;
          const receipt = submit(room, active, { type: "rune-energy",
            commandId: `fund-${step}`, stateVersion: view.stateVersion,
            runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId! });
          expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
          continue;
        }
      }
      const ender = seats.find(seat => seat.id === view.activePlayerId)!;
      const receipt = submit(room, ender, { type: "end-turn",
        commandId: `advance-${step}`, stateVersion: view.stateVersion });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
    }

    view = projection(room, seats[0]!.id);
    expect(view.activePlayerId).toBe(seats[0]!.id);
    expect(view.players.find(player => player.playerId === seats[0]!.id)?.energy).toBeGreaterThanOrEqual(7);
    const rumbleCard = hand(view, seats[0]!.id).find(card => card.cardId === RUMBLE);
    const bubbleCard = hand(view, seats[0]!.id).find(card => card.cardId === BUBBLE_BOT);
    expect(rumbleCard).toBeDefined();
    expect(bubbleCard).toBeDefined();

    const playedRumble = submit(room, seats[0]!, { type: "play", commandId: "play-rumble",
      stateVersion: view.stateVersion, cardObjectId: rumbleCard!.objectId,
      destination: { kind: "base", playerId: seats[0]!.id } });
    expect(playedRumble.accepted, JSON.stringify(playedRumble)).toBe(true);
    for (let index = 0; index < 4; index += 1) {
      const pending = projection(room, seats[0]!.id);
      if (pending.chain.items.length === 0) break;
      const actor = seats.find(seat => seat.id === pending.chain.priorityPlayerId)!;
      const receipt = submit(room, actor, { type: "pass", commandId: `settle-rumble-${index}`,
        stateVersion: pending.stateVersion });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
    }

    view = projection(room, seats[0]!.id);
    const rumbleOnBoard = view.objects.find(object => object.cardId === RUMBLE && object.zone === "board");
    expect(rumbleOnBoard).toMatchObject({ exhausted: true });
    const stillBubble = hand(view, seats[0]!.id).find(card => card.cardId === BUBBLE_BOT);
    expect(stillBubble).toBeDefined();
    const playedBubble = submit(room, seats[0]!, { type: "play", commandId: "play-bubble",
      stateVersion: view.stateVersion, cardObjectId: stillBubble!.objectId,
      destination: { kind: "base", playerId: seats[0]!.id } });
    expect(playedBubble.accepted, JSON.stringify(playedBubble)).toBe(true);

    const pendingChoiceView = projection(room, seats[0]!.id);
    expect(pendingChoiceView.pendingChoice).toMatchObject({
      status: "pending", choiceId: "target:other-friendly-mech", kind: "select-objects",
      ownerPlayerId: seats[0]!.id, min: 1, max: 1,
    });
    if (pendingChoiceView.pendingChoice.status !== "pending") throw new Error("Bubble Bot target required");
    expect(pendingChoiceView.pendingChoice.options).toHaveLength(1);
    const target = pendingChoiceView.pendingChoice.options?.find(option =>
      option.objectRef?.objectId === rumbleOnBoard!.objectId &&
      option.objectRef.zoneEntryId === rumbleOnBoard!.zoneEntryId);
    expect(target).toBeDefined();
    const answered = submit(room, seats[0]!, { type: "choose",
      commandId: "choose-rumble", stateVersion: pendingChoiceView.stateVersion,
      choiceId: pendingChoiceView.pendingChoice.choiceId, answer: [target!.objectRef!] });
    expect(answered.accepted, JSON.stringify(answered)).toBe(true);

    const finalized = projection(room, seats[0]!.id);
    expect(finalized.objects.find(object => object.objectId === rumbleOnBoard!.objectId)?.exhausted).toBe(true);
    expect(finalized.chain.items).toHaveLength(1);
    for (let index = 0; index < 4 && projection(room, seats[0]!.id).chain.items.length > 0; index += 1) {
      const current = projection(room, seats[0]!.id);
      const actor = seats.find(seat => seat.id === current.chain.priorityPlayerId)!;
      const receipt = submit(room, actor, { type: "pass", commandId: `resolve-bubble-${index}`,
        stateVersion: current.stateVersion });
      expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
    }

    const resolved = projection(room, seats[0]!.id);
    expect(resolved.pendingChoice).toEqual({ status: "none" });
    expect(resolved.chain.items).toEqual([]);
    expect(resolved.objects.find(object => object.objectId === rumbleOnBoard!.objectId)).toMatchObject({
      zone: "board", exhausted: false,
    });
    expect(resolved.events).toContainEqual(expect.objectContaining({
      timingPoint: "object-readied",
      payload: expect.objectContaining({
        objectId: { visibility: "public", value: rumbleOnBoard!.objectId },
      }),
    }));

    const restored = GameRoom.restore(room.exportArchive(), catalog);
    expect(projection(restored, seats[0]!.id).objects.find(object =>
      object.objectId === rumbleOnBoard!.objectId)).toMatchObject({
        zone: "board", exhausted: false,
      });
  }, 180_000);
});
