// RIFT-1167 real-room Equip coverage. The activated ability must be visible in
// `actionOptions.activations`, then its target is selected through the normal
// `target:equip-target` pending choice and the unit gains the printed +2.
//
// Long Sword sfd-022-221: "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this
// to a unit you control.)" Quick-Draw has already attached it on play; the
// activated Equip remains independently usable (CR 818.1, 818.4).
// Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 312.1, 377.1-.3, 403.3, 404.1.a, 405.1, 415.4, 818.1.b/.b.1/.c.2.
// canonicalCardId card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010.
import { describe, expect, it } from "vitest";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import {
  PLAYER_1,
  accepted,
  fundEnergy,
  fundPower,
  nextOwnMain,
  ownedHand,
  pendingChoice,
  projection,
  settle,
  settlePlay,
  startRoom,
} from "../rift-1177/helpers.js";

const LONG_SWORD = "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";

function purchaseLongSword(started: Awaited<ReturnType<typeof startRoom>>): {
  readonly view: V2Projection;
  readonly swordId: string;
} {
  // Advance through the ordinary turn loop until Long Sword reaches the legal hand.
  let view = projection(started, PLAYER_1);
  for (let guard = 0; guard < 40 && !ownedHand(view, PLAYER_1).some(object => object.cardId === LONG_SWORD); guard += 1) {
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
  }
  const sword = ownedHand(view, PLAYER_1).find(object => object.cardId === LONG_SWORD);
  expect(sword, JSON.stringify(ownedHand(view, PLAYER_1))).toBeDefined();
  fundEnergy(started, PLAYER_1, 2, "equip-sword-energy");
  fundPower(started, PLAYER_1, "Fury Rune", 1, "equip-sword-power");
  view = projection(started, PLAYER_1);
  accepted(started, PLAYER_1, {
    type: "play", commandId: "equip-play-sword", stateVersion: view.stateVersion,
    cardObjectId: sword!.objectId, destination: { kind: "base", playerId: PLAYER_1 },
  });
  view = projection(started, PLAYER_1);
  if (view.pendingChoice.status === "pending") {
    const target = view.pendingChoice.options?.find(option => option.objectRef !== undefined);
    expect(target, JSON.stringify(view.pendingChoice)).toBeDefined();
    accepted(started, PLAYER_1, {
      type: "choose", commandId: "equip-quick-draw-target", stateVersion: view.stateVersion,
      choiceId: view.pendingChoice.choiceId, answer: [target!.objectRef!],
    });
  }
  settlePlay(started, PLAYER_1, "equip-play-sword-settle");
  view = projection(started, PLAYER_1);
  const onBoard = view.objects.find(object => object.cardId === LONG_SWORD && object.zone === "board");
  expect(onBoard).toBeDefined();
  return { view, swordId: onBoard!.objectId };
}

describe("RIFT-1167 real room Equip activation", () => {
  it("projects Equip only when Fury is payable, chooses a target after activate, and grants +2", async () => {
    const started = await startRoom("RIFT-1167-equip-room", "rumble-sfd", "fiora-sfd", 1);
    let view = projection(started, PLAYER_1);
    for (let guard = 0; guard < 12 && !ownedHand(view, PLAYER_1).some(object =>
      object.cardId === "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91"); guard += 1) {
      view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    }
    const duo = ownedHand(view, PLAYER_1).find(object =>
      object.cardId === "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91");
    expect(duo).toBeDefined();
    fundEnergy(started, PLAYER_1, 3, "equip-dangerous-duo");
    view = projection(started, PLAYER_1);
    accepted(started, PLAYER_1, {
      type: "play", commandId: "equip-play-dangerous-duo", stateVersion: view.stateVersion,
      cardObjectId: duo!.objectId, destination: { kind: "base", playerId: PLAYER_1 },
    });
    settlePlay(started, PLAYER_1, "equip-play-dangerous-duo-settle");
    const targetUnit = projection(started, PLAYER_1).objects.find(object =>
      object.objectId === duo!.objectId && object.zone === "board");
    expect(targetUnit).toBeDefined();
    const sword = purchaseLongSword(started);
    view = projection(started, PLAYER_1);
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const equipWithoutPower = view.actionOptions.activations?.find(candidate =>
      candidate.sourceObjectId === sword.swordId && candidate.label === "Equip");
    expect(equipWithoutPower).toBeUndefined();

    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    fundPower(started, PLAYER_1, "Fury Rune", 1, "equip-activate-power");
    view = projection(started, PLAYER_1);
    const equip = view.actionOptions.activations?.find(candidate =>
      candidate.sourceObjectId === sword.swordId && candidate.label === "Equip");
    expect(equip, JSON.stringify(view.actionOptions.activations)).toMatchObject({
      abilityId: "0",
      label: "Equip",
    });
    expect(equip?.reaction).toBeUndefined();

    accepted(started, PLAYER_1, {
      type: "activate", commandId: "equip-activate", stateVersion: view.stateVersion,
      sourceObjectId: sword.swordId, abilityId: equip!.abilityId,
    });
    const choice = pendingChoice(started, PLAYER_1);
    expect(choice).toMatchObject({ kind: "select-objects", ownerPlayerId: PLAYER_1 });
    const target = choice.options?.find(option => option.objectRef?.objectId === targetUnit!.objectId);
    expect(target, JSON.stringify(choice.options)).toBeDefined();
    accepted(started, PLAYER_1, {
      type: "choose", commandId: "equip-target", stateVersion: projection(started, PLAYER_1).stateVersion,
      choiceId: choice.choiceId, answer: [target!.objectRef!],
    });
    settle(started, PLAYER_1, "equip-target-settle");
    view = projection(started, PLAYER_1);
    expect(view.pendingChoice).toEqual({ status: "none" });
    const targetRef = { id: targetUnit!.objectId, zoneEntryId: targetUnit!.zoneEntryId! };
    const runtime = (started.room as unknown as { readonly engineRuntime: {
      readonly host: { object(ref: unknown): { readonly attachedTo: unknown } | null };
    } }).engineRuntime;
    expect(runtime.host.object({ id: sword.swordId, zoneEntryId: view.objects.find(object =>
      object.objectId === sword.swordId)?.zoneEntryId })?.attachedTo).toEqual(targetRef);
    expect(view.players.find(player => player.playerId === PLAYER_1)?.power.Fury ?? 0).toBe(0);
    expect(view.events.some(event => event.timingPoint === "object-attached" &&
      event.payload.objectId?.value === sword.swordId)).toBe(true);
  }, 180_000);
});
