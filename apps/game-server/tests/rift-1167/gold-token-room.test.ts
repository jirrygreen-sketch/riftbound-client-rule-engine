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
import { DUEL_RULESET_ID } from "@riftbound/protocol";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
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

describe("RIFT-1167 real room Gold activation", () => {
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
