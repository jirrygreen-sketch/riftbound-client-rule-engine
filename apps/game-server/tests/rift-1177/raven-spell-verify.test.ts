import { describe, expect, it } from "vitest";
import { PLAYER_1, PLAYER_2, accepted, commandId, fundEnergy, nextOwnMain, openMain, ownedHand, projection, settle, settlePlay, startRoom } from "./helpers.js";

// Ravenbloom Conservatory, sfd-215-221, canonicalCardId
// card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82.
// Official gallery text (zh_CN, read 2026-10-31): "When you defend here,
// reveal the top card of your Main Deck. If it's a spell, put it in your hand.
// Otherwise, recycle it." CR v1.5 383.4.f, 425.1/.1.a.2, 425.2.a, 417.1 and
// 466.2 govern the Defend event, reveal-in-place, spell fan-out and recycle.
describe("RIFT-1177 Ravenbloom real-room spell branch", () => {
  it("places a revealed spell into the defending player's hand", async () => {
    const started = await startRoom("RIFT-1177-room-0", "rumble-sfd", "fiora-sfd", 1);
    let view = openMain(started, PLAYER_1);
    fundEnergy(started, PLAYER_1, 2, "raven-spell-poro");
    const poro = ownedHand(projection(started, PLAYER_1), PLAYER_1).find(object => object.name === "Plundering Poro");
    expect(poro).toBeDefined();
    accepted(started, PLAYER_1, { type: "play", commandId: commandId("raven-spell-poro-play"),
      stateVersion: projection(started, PLAYER_1).stateVersion, cardObjectId: poro!.objectId,
      destination: { kind: "base", playerId: PLAYER_1 } });
    settlePlay(started, PLAYER_1, "raven-spell-poro-settle");
    view = nextOwnMain(started, PLAYER_1, view.turnNumber);
    const raven = view.objects.find(object => object.name === "Ravenbloom Conservatory" &&
      object.zone === "board" && object.location?.kind === "battlefield");
    expect(raven, JSON.stringify(view.objects.filter(object => object.zone === "board"))).toBeDefined();
    const location = raven!.location as Extract<NonNullable<typeof raven>["location"], { kind: "battlefield" }>;
    accepted(started, PLAYER_1, { type: "move", commandId: commandId("raven-spell-conquer"),
      stateVersion: view.stateVersion, objectId: poro!.objectId,
      to: { zone: "battlefield", locationId: location.battlefieldId } });
    closeShowdown(started, "raven-spell-conquer");
    settle(started, PLAYER_1, "raven-spell-conquer-settle");
    expect(projection(started, PLAYER_1).battlefields.find(field =>
      field.battlefieldId === location.battlefieldId)?.controllerPlayerId).toBe(PLAYER_1);

    view = nextOwnMain(started, PLAYER_2, projection(started, PLAYER_2).turnNumber);
    fundEnergy(started, PLAYER_2, 4, "raven-spell-attacker");
    const attacker = ownedHand(projection(started, PLAYER_2), PLAYER_2).find(object => object.name === "Laurent Duelist");
    expect(attacker, JSON.stringify(ownedHand(projection(started, PLAYER_2), PLAYER_2))).toBeDefined();
    accepted(started, PLAYER_2, { type: "play", commandId: commandId("raven-spell-attacker-play"),
      stateVersion: projection(started, PLAYER_2).stateVersion, cardObjectId: attacker!.objectId,
      destination: { kind: "base", playerId: PLAYER_2 } });
    settlePlay(started, PLAYER_2, "raven-spell-attacker-settle");
    view = nextOwnMain(started, PLAYER_2, projection(started, PLAYER_2).turnNumber);
    const before = projection(started, PLAYER_1).players.find(player => player.playerId === PLAYER_1)!;
    accepted(started, PLAYER_2, { type: "move", commandId: commandId("raven-spell-defend"),
      stateVersion: view.stateVersion, objectId: attacker!.objectId,
      to: { zone: "battlefield", locationId: location.battlefieldId } });
    closeShowdown(started, "raven-spell-defend");
    settle(started, PLAYER_1, "raven-spell-defend-settle");
    const after = projection(started, PLAYER_1);
    const playerAfter = after.players.find(player => player.playerId === PLAYER_1)!;
    expect(after.events.filter(event => event.timingPoint === "card-revealed").length).toBeGreaterThan(0);
    expect(after.events.filter(event => event.timingPoint === "card-recycled")).toHaveLength(0);
    expect(playerAfter.handCount).toBe(before.handCount + 1);
    expect(playerAfter.deckCount).toBe(before.deckCount - 1);
  }, 180_000);
});

function closeShowdown(started: Awaited<ReturnType<typeof startRoom>>, prefix: string): void {
  for (let index = 0; index < 12; index += 1) {
    const view = projection(started, PLAYER_1);
    if (view.pendingChoice.status === "pending") return;
    if (view.chain.focusPlayerId === null && view.chain.items.length === 0) return;
    const focusActor = [PLAYER_1, PLAYER_2].find(playerId =>
      projection(started, playerId).actionOptions.canPass === true);
    const actor = focusActor ?? view.chain.focusPlayerId ?? view.chain.priorityPlayerId;
    if (actor === null) throw new Error(`No Showdown/Chain actor at ${prefix}`);
    accepted(started, actor, { type: "pass", commandId: commandId(`${prefix}:${index}`), stateVersion: view.stateVersion });
  }
  throw new Error(`Showdown did not close at ${prefix}`);
}
