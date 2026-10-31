// RIFT-1167 real room coverage: the projection advertises a Gold activation
// and the ordinary `activate` command performs the card-program cost/effect.
//
// Gold sfd-t03 text: "Kill this, :rb_exhaust:: [Reaction] — [Add]
// :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)"
// Treasure Hoard sfd-220/221: "When you conquer here, you may pay
// :rb_energy_1: to play a Gold gear token exhausted."
// Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 312.1, 377.1-.3, 403.3, 405.1, 415.1.b, 415.4, 430.2-.3.
// canonicalCardIds:
// Gold card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511.
import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession, type RoomDeckSubmission } from "@riftbound/protocol";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import type { RuntimeJournal } from "../../src/engine-runtime/journal.js";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom } from "../../src/room.js";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import {
  PLAYER_1,
  accepted,
  fundEnergy,
  nextOwnMain,
  openMain,
  ownedHand,
  projection,
  settlePlay,
  startRoom,
} from "../rift-1177/helpers.js";

const GOLD = "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511";
const PORO = "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82";
const TREASURE = "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564";
const PRODUCTION_SURGE = "card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b";
const PRODUCTION_SURGE_PRINTING = "sfd-076-221";
const FURY_RUNE_PRINTING = "ogn-007-298";

const PAYMENT_DECK_RULES: CardCatalogRuntime["deckRules"] = {
  cardPolicies: {},
  defaultMaxCopiesPerCanonical: 40,
  copyRules: [
    { zones: ["mainDeck"], maxCopiesPerCanonical: 40 },
    { zones: ["runes"], maxCopiesPerCanonical: 12 },
    { zones: ["legend"], maxCopiesPerCanonical: 1 },
    { zones: ["champion"], maxCopiesPerCanonical: 1 },
    { zones: ["battlefields"], maxCopiesPerCanonical: 1 },
  ],
  sizeRules: {
    mainDeck: { minimum: 40, maximum: 40 },
    runes: { minimum: 12, maximum: 12 },
    legend: { minimum: 1, maximum: 1 },
    champion: { minimum: 1, maximum: 1 },
    battlefields: { minimum: 3, maximum: 3 },
  },
  uniqueCanonicalZones: ["battlefields"],
};

function battlefieldId(view: V2Projection, cardId: string): string {
  const battlefield = view.objects.find(object => object.cardId === cardId && object.zone === "board");
  expect(battlefield, JSON.stringify(view.objects.filter(object => object.zone === "board"))).toBeDefined();
  const location = battlefield!.location;
  if (location?.kind !== "battlefield") throw new Error("Selected Battlefield has no location");
  return location.battlefieldId;
}

function playPoro(started: Awaited<ReturnType<typeof startRoom>>, prefix: string): void {
  const view = projection(started, PLAYER_1);
  const poro = ownedHand(view, PLAYER_1).find(object => object.cardId === PORO);
  expect(poro, JSON.stringify(ownedHand(view, PLAYER_1))).toBeDefined();
  accepted(started, PLAYER_1, {
    type: "play", commandId: `${prefix}:play`, stateVersion: view.stateVersion,
    cardObjectId: poro!.objectId, destination: { kind: "base", playerId: PLAYER_1 },
  });
  settlePlay(started, PLAYER_1, `${prefix}:settle`);
}

function settleTreasureChoice(started: Awaited<ReturnType<typeof startRoom>>, prefix: string): void {
  for (let index = 0; index < 16; index += 1) {
    const view = projection(started, PLAYER_1);
    if (view.pendingChoice.status === "pending") {
      const option = view.pendingChoice.options?.find(candidate => candidate.value === true) ??
        view.pendingChoice.options?.[0];
      accepted(started, PLAYER_1, {
        type: "choose", commandId: `${prefix}:choose:${index}`, stateVersion: view.stateVersion,
        choiceId: view.pendingChoice.choiceId, answer: option?.value ?? true,
      });
      continue;
    }
    if (view.chain.items.length === 0 && view.chain.focusPlayerId === null) return;
    const actor = view.chain.priorityPlayerId ?? view.chain.focusPlayerId;
    if (actor === null) throw new Error(`Missing Treasure settlement actor at ${prefix}`);
    accepted(started, actor, {
      type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: view.stateVersion,
    });
  }
  throw new Error(`Treasure did not settle at ${prefix}`);
}

interface StartedPaymentRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
}

function runtimeJournal(started: StartedPaymentRoom): RuntimeJournal {
  return (started.room as unknown as {
    readonly engineRuntime: { journal(): RuntimeJournal };
  }).engineRuntime.journal();
}

async function startPaymentRoom(roomId: string): Promise<StartedPaymentRoom> {
  const catalog = await loadCardCatalogRuntime({ deckRules: PAYMENT_DECK_RULES });
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 2,
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
  const baseDeck = V2_M1_PRECONS["rumble-sfd"].deck;
  const deck: RoomDeckSubmission = {
    ...baseDeck,
    mainDeck: [
      { cardId: "sfd-069-221", quantity: 20 },
      { cardId: PRODUCTION_SURGE_PRINTING, quantity: 20 },
    ],
    runes: [{ cardId: FURY_RUNE_PRINTING, quantity: 12 }],
  };
  for (const [playerId, connection] of [
    [first.playerId, first.connectionId],
    [second.playerId, second.connectionId],
  ] as const) {
    room.submitDeck(sessions[playerId]!, connection, room.currentRoomVersion,
      deck, `${roomId}:deck:${playerId}`, noMessages);
    room.setReady(sessions[playerId]!, connection, room.currentRoomVersion,
      true, `${roomId}:ready:${playerId}`, noMessages);
  }
  const started = { room, sessions, connections };
  for (let index = 0; index < 2; index += 1) {
    const due = [first.playerId, second.playerId]
      .map(playerId => projection(started, playerId))
      .find(view => view.pendingChoice.status === "pending" &&
        view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending") {
      throw new Error("Expected a due Mulligan owner in the payment room");
    }
    accepted(started, due.viewerPlayerId!, {
      type: "mulligan", commandId: `${roomId}:mulligan:${index}`, stateVersion: 0,
      selectedObjectIds: [],
    });
  }
  return started;
}

describe("RIFT-1167 real room Gold activation", () => {
  it("uses Gold from the projected parent Pay Costs window and completes the parent", async () => {
    const started = await startPaymentRoom("RIFT-1167-gold-payment-command-room");
    let view = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "gold-parent-poro");
    playPoro(started, "gold-parent-poro");

    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const treasure = battlefieldId(view, TREASURE);
    fundEnergy(started, PLAYER_1, 1, "gold-parent-treasure");
    const poro = projection(started, PLAYER_1).objects.find(object =>
      object.cardId === PORO && object.zone === "board");
    expect(poro).toBeDefined();
    accepted(started, PLAYER_1, {
      type: "move", commandId: "gold-parent-conquer",
      stateVersion: projection(started, PLAYER_1).stateVersion,
      objectId: poro!.objectId, to: { zone: "battlefield", locationId: treasure },
    });
    settleTreasureChoice(started, "gold-parent-conquer");

    view = nextOwnMain(started, PLAYER_1, projection(started, PLAYER_1).turnNumber);
    const gold = view.objects.find(object => object.cardId === GOLD && object.zone === "board");
    expect(gold).toMatchObject({ exhausted: false });
    const parent = ownedHand(view, PLAYER_1).find(object => object.cardId === PRODUCTION_SURGE);
    expect(parent).toBeDefined();
    fundEnergy(started, PLAYER_1, 4, "gold-parent-surge");
    view = projection(started, PLAYER_1);

    // Funding Energy alone leaves the parent's printed Mind Power absent, so
    // the engine freezes the parent before Pay Costs instead of partially
    // paying it.
    accepted(started, PLAYER_1, {
      type: "play", commandId: "gold-parent-play", stateVersion: view.stateVersion,
      cardObjectId: parent!.objectId,
    });
    view = projection(started, PLAYER_1);
    expect(view.pendingChoice).toEqual({ status: "none" });
    expect(view.chain.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceObjectId: parent!.objectId, status: "finalized" }),
    ]));
    const goldWindow = view.actionOptions.activations?.find(candidate =>
      candidate.sourceObjectId === gold!.objectId && candidate.reaction === true);
    expect(goldWindow, JSON.stringify(view.actionOptions.activations)).toBeDefined();
    expect(projection(started, "player-2").actionOptions.activations ?? [])
      .not.toContainEqual(expect.objectContaining({ sourceObjectId: gold!.objectId }));
    const priorityBefore = view.chain.priorityPlayerId;
    const focusBefore = view.chain.focusPlayerId;

    const activationReceipt = accepted(started, PLAYER_1, {
      type: "activate", commandId: "gold-parent-activate", stateVersion: view.stateVersion,
      sourceObjectId: gold!.objectId, abilityId: goldWindow!.abilityId,
    });
    const afterGold = projection(started, PLAYER_1);
    expect(afterGold.chain.priorityPlayerId).toBe(priorityBefore);
    expect(afterGold.chain.focusPlayerId).toBe(focusBefore);
    expect(afterGold.objects.find(object => object.objectId === gold!.objectId)?.zone).toBe("trash");
    expect(afterGold.players.find(player => player.playerId === PLAYER_1)!.power.universal ?? 0).toBe(0);
    expect(afterGold.players.find(player => player.playerId === PLAYER_1)!.energy).toBe(0);
    expect(afterGold.priority.window).toBe("closed");
    expect(afterGold.actionOptions.activations ?? [])
      .not.toContainEqual(expect.objectContaining({ sourceObjectId: gold!.objectId }));

    view = projection(started, PLAYER_1);
    expect(view.chain.items).toEqual([
      expect.objectContaining({ sourceObjectId: parent!.objectId, status: "finalized" }),
    ]);
    expect(view.pendingChoice).toEqual({ status: "none" });
    expect(view.priority.window).toBe("closed");
    const parentItem = view.chain.items[0]!;
    const journal = runtimeJournal(started);
    expect(activationReceipt).toMatchObject({ accepted: true, rejection: null });
    expect(journal.entries.find(entry => entry.commandId === "gold-parent-play")).toMatchObject({
      commandId: "gold-parent-play",
      pendingReason: { kind: "payment" },
      result: { paymentContinuation: expect.objectContaining({
        itemId: parentItem.itemId,
        payer: "A",
      }) },
    });
    expect(journal.entries.find(entry => entry.commandId === "gold-parent-activate")).toMatchObject({
      command: { type: "activate", sourceObjectId: gold!.objectId, abilityId: goldWindow!.abilityId },
      result: {
        parentPaid: true,
        resources: { energy: 0, power: ["universal"] },
        parentPayment: {
          paid: true,
          power: { power: [{ requirementIndex: 0, from: "any", amount: 1 }] },
        },
      },
    });

    const catalog = await loadCardCatalogRuntime({ deckRules: PAYMENT_DECK_RULES });
    const restored = GameRoom.restore(started.room.exportArchive(), catalog);
    expect(restored.exportArchive().engineRuntimeJournal?.entries)
      .toEqual(started.room.exportArchive().engineRuntimeJournal?.entries);
    const restoredPlayerId = started.room.exportArchive().seats.find(seat => seat.id === PLAYER_1)?.id;
    expect(restoredPlayerId).toBe(PLAYER_1);
    let restoredView: V2Projection | undefined;
    restored.sendProjection(PLAYER_1, message => {
      if (message !== null && typeof message === "object" &&
          (message as { readonly type?: unknown }).type === "projection") {
        restoredView = (message as { readonly projection: V2Projection }).projection;
      }
    });
    expect(restoredView?.stateVersion).toBe(20);
    expect(restoredView?.objects.find(object => object.cardId === GOLD)?.zone).toBe("trash");
    expect(restoredView?.chain.items).toEqual(view.chain.items);
    expect(restoredView?.pendingChoice).toEqual({ status: "none" });
    expect(restored.exportArchive().engineRuntimeJournal?.head.stateVersion).toBe(20);
  }, 180_000);

  it("retains its existing ready-Gold activation path outside an explicit payment window", async () => {
    const started = await startRoom("RIFT-1167-gold-payment-room", "rumble-sfd", "fiora-sfd", 2);
    let view = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "gold-payment-poro");
    playPoro(started, "gold-payment-poro");

    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    fundEnergy(started, PLAYER_1, 1, "gold-payment-treasure");
    const treasure = battlefieldId(view, TREASURE);
    const poro = projection(started, PLAYER_1).objects.find(object => object.cardId === PORO && object.zone === "board");
    expect(poro).toBeDefined();
    accepted(started, PLAYER_1, {
      type: "move", commandId: "gold-payment-conquer", stateVersion: projection(started, PLAYER_1).stateVersion,
      objectId: poro!.objectId, to: { zone: "battlefield", locationId: treasure },
    });
    settleTreasureChoice(started, "gold-payment-conquer");

    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const gold = view.objects.find(object => object.cardId === GOLD && object.zone === "board" && !object.exhausted);
    expect(gold).toBeDefined();
    const goldWindow = view.actionOptions.activations?.find(candidate =>
      candidate.sourceObjectId === gold!.objectId && candidate.reaction === true);
    expect(goldWindow, JSON.stringify(view.actionOptions.activations)).toBeDefined();

    accepted(started, PLAYER_1, {
      type: "activate", commandId: "gold-payment-activate", stateVersion: view.stateVersion,
      sourceObjectId: gold!.objectId, abilityId: goldWindow!.abilityId,
    });
    const after = projection(started, PLAYER_1);
    expect(after.objects.find(object => object.objectId === gold!.objectId)?.zone).toBe("trash");
    // No parent Pay Costs step is pending at this point. The normal Gold
    // Reaction Add therefore resolves in place and retains its Universal Power.
    expect(after.players.find(player => player.playerId === PLAYER_1)!.power.universal ?? 0).toBe(1);
    expect(after.actionOptions.activations ?? [])
      .not.toContainEqual(expect.objectContaining({ sourceObjectId: gold!.objectId }));
  }, 180_000);

  it("does not advertise an exhausted Gold, then advertises and activates it after the next Awaken", async () => {
    const started = await startRoom("RIFT-1167-gold-room", "rumble-sfd", "fiora-sfd", 2);
    let view = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "gold-poro");
    playPoro(started, "gold-poro");

    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const treasure = battlefieldId(view, TREASURE);
    fundEnergy(started, PLAYER_1, 1, "gold-treasure");
    const poro = projection(started, PLAYER_1).objects.find(object => object.cardId === PORO && object.zone === "board");
    expect(poro).toBeDefined();
    accepted(started, PLAYER_1, {
      type: "move", commandId: "gold-conquer", stateVersion: projection(started, PLAYER_1).stateVersion,
      objectId: poro!.objectId, to: { zone: "battlefield", locationId: treasure },
    });
    settleTreasureChoice(started, "gold-conquer");

    view = projection(started, PLAYER_1);
    const exhaustedGold = view.objects.find(object => object.cardId === GOLD && object.zone === "board");
    expect(exhaustedGold).toMatchObject({ exhausted: true, location: { kind: "base", playerId: PLAYER_1 } });
    expect(view.actionOptions.activations ?? [])
      .not.toContainEqual(expect.objectContaining({ sourceObjectId: exhaustedGold!.objectId }));

    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const readyGold = view.objects.find(object => object.objectId === exhaustedGold!.objectId);
    expect(readyGold).toMatchObject({ exhausted: false, zone: "board" });
    const activation = view.actionOptions.activations?.find(candidate =>
      candidate.sourceObjectId === readyGold!.objectId);
    expect(activation, JSON.stringify(view.actionOptions.activations)).toMatchObject({
      abilityId: "0", reaction: true,
      label: expect.stringMatching(/^Kill this, :rb_exhaust:: \[Reaction\] — \[Add\] :rb_rune_rainbow:\./u),
    });
    const powerBefore = view.players.find(player => player.playerId === PLAYER_1)!.power;
    accepted(started, PLAYER_1, {
      type: "activate", commandId: "activate-ready-gold", stateVersion: view.stateVersion,
      sourceObjectId: readyGold!.objectId, abilityId: activation!.abilityId,
    });
    const after = projection(started, PLAYER_1);
    expect(after.objects.find(object => object.objectId === readyGold!.objectId)?.zone).toBe("trash");
    expect(after.players.find(player => player.playerId === PLAYER_1)!.power.universal)
      .toBe((powerBefore.universal ?? 0) + 1);
    expect(after.actionOptions.activations ?? [])
      .not.toContainEqual(expect.objectContaining({ sourceObjectId: readyGold!.objectId }));
  }, 180_000);
});
