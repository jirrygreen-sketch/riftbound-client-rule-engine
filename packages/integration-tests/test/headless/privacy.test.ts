import { describe, expect, it, vi } from "vitest";
import { projectFor } from "../../../engine-core/dist/projection/v2/index.js";
import { world } from "../../../engine-core/dist/effects/testing/test-kernel.js";
import { checkpointHeadlessWorld, createHeadlessCheckpointManager, headlessProjectionLeaks, restoreHeadlessWorld } from "../../src/headless/index.js";

// This is a projection audit fixture, not a manufactured playing position.
const privateCard = (owner: string, zone: "hand" | "deck" | "rune-deck", id: string) => ({
  id, ref: { id, zoneEntryId: 3 }, owner, controller: owner, zone,
  cardId: `secret:${id}`, name: `Private ${id}`, types: ["unit"], energy: 4, power: null, might: 5,
});
const cards = [privateCard("A", "hand", "a-hand"), privateCard("B", "hand", "b-hand"),
  privateCard("A", "deck", "a-deck"), privateCard("B", "rune-deck", "b-rune")];
const input = {
  players: ["A", "B"].map(id => ({ id,
    hand: cards.filter(card => card.owner === id && card.zone === "hand"),
    deck: cards.filter(card => card.owner === id && card.zone === "deck"),
    runeDeck: cards.filter(card => card.owner === id && card.zone === "rune-deck"),
  })),
  objects: cards,
};

describe("headless privacy audit", () => {
  it("checkpoints authoritative state and linked values with one state copy", () => {
    const kernel = world().player("A").player("B").build();
    kernel.link("before", 1);
    const snapshot = vi.spyOn(kernel, "snapshot");
    const checkpoint = checkpointHeadlessWorld(kernel);
    expect(snapshot).toHaveBeenCalledTimes(1);

    kernel.perform({ type: "gain-energy", player: "A", amount: 3 });
    kernel.link("after", 2);
    restoreHeadlessWorld(kernel, checkpoint);
    expect(kernel.player("A").energy).toBe(0);
    expect(kernel.linkedSnapshot()).toEqual({ before: 1 });
  });

  it("reuses an unchanged checkpoint until authoritative state or links change", () => {
    const kernel = world().player("A").player("B").build();
    const manager = createHeadlessCheckpointManager(kernel);
    const snapshot = vi.spyOn(kernel, "snapshot");
    const first = manager.checkpoint();
    expect(manager.checkpoint()).toBe(first);
    expect(snapshot).toHaveBeenCalledTimes(1);

    manager.invalidate();
    kernel.perform({ type: "gain-energy", player: "A", amount: 2 });
    const second = manager.checkpoint();
    expect(second).not.toBe(first);
    expect(snapshot).toHaveBeenCalledTimes(2);

    manager.restore(first);
    expect(kernel.player("A").energy).toBe(0);
  });

  it.each(["A", "B", "spectator"])("checks all private surfaces for %s", viewer => {
    const projection = projectFor(input, viewer);
    const hidden = cards.filter(card => card.zone !== "hand" || card.owner !== viewer).map(card => card.ref);
    expect(headlessProjectionLeaks(projection, hidden)).toEqual([]);
    if (viewer !== "spectator") expect(projection.players[viewer]!.hand.cards[0]!.cardId).toBe(`secret:${viewer.toLowerCase()}-hand`);
  });

  it("detects identities and characteristics injected into the top-level hidden object list", () => {
    const projection = projectFor(input, "A");
    const hiddenObject = projection.objects.find(object => object.visibility === "face-down")!;
    expect(headlessProjectionLeaks({ ...projection, objects: [...projection.objects,
      { ...hiddenObject, cardId: "leaked", name: "leaked", power: null }] }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/cardId$/), expect.stringMatching(/name$/), expect.stringMatching(/power$/)]));
  });

  it("detects a raw private incarnation injected into an event", () => {
    const projection = projectFor(input, "A");
    expect(headlessProjectionLeaks({ ...projection, events: [{ object: cards[1] }] }, [cards[1]!.ref]))
      .toEqual(expect.arrayContaining([expect.stringMatching(/events\[0\].object.ref/)]));
  });

  it("detects a private Hand mistakenly projected as an identity", () => {
    const projection = projectFor(input, "A");
    const opponent = projection.players.B!;
    const leaked = { ...projection, players: { ...projection.players,
      B: { ...opponent, hand: { ...opponent.hand, cards: opponent.hand.cards.map(card => ({ ...card, visibility: "identity" as const })) } } } };
    expect(headlessProjectionLeaks(leaked)).toContain("players.B.private-zone");
  });
});
