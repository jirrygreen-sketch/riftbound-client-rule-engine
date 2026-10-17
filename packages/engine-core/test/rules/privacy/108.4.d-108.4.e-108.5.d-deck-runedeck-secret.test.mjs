// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-spectator-deck-runedeck-secret-order  (CR v1.5 108.4.d, 108.4.e, 108.5.d)
//   scenario: privacy-negative-deck-top-never-in-projection (108.4.e, 128.3)
//
// Subject: src/projection/v2 projectFor. Deck order is Secret Information, so
// every viewer — including the owner — receives counts only.
import assert from "node:assert/strict";
import test from "node:test";
import { projectFor, world, assertNotSerialized } from "./harness.mjs";

function kernel() {
  return world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .deck(["d1", "d2", "d3"], { owner: "A", cardId: "card:d1", name: "Deck One" })
    .rune(["r1", "r2", "r3"], { owner: "A", cardId: "card:r1" })
    .deck(["e1"], { owner: "B", cardId: "card:e1" })
    .rune(["s1"], { owner: "B", cardId: "card:s1" })
    .build();
}

function stateOf(fixture) {
  const zone = (player, name) => fixture.objectsInZone(player, name).map(ref => fixture.object(ref));
  return {
    players: [
      { id: "A", ...fixture.player("A"), mainDeck: zone("A", "deck"), runeDeck: zone("A", "rune-deck") },
      { id: "B", ...fixture.player("B"), mainDeck: zone("B", "deck"), runeDeck: zone("B", "rune-deck") }
    ],
    objects: fixture.objects
  };
}

test("privacy-spectator-deck-runedeck-secret-order: counts stay public, order and identities never do", () => {
  const fixture = kernel();
  const state = stateOf(fixture);
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.players.A.mainDeck.count, 3, viewer + " sees A's deck count");
    assert.equal(projection.players.B.mainDeck.count, 1, viewer + " sees B's deck count");
    assert.equal(projection.players.A.runeDeck.count, 3, viewer + " sees A's rune deck count");
    assert.equal(projection.players.B.runeDeck.count, 1, viewer + " sees B's rune deck count");
    // 108.4.e / 108.5.d: the projector exposes no deck placeholders and no order.
    assert.equal(projection.players.A.mainDeck.cards.length, 0);
    assert.equal(projection.players.A.runeDeck.cards.length, 0);
  }
});

test("privacy-negative-deck-top-never-in-projection: the deck top is Secret even to its owner", () => {
  const fixture = kernel();
  const state = stateOf(fixture);
  for (const viewer of ["A", "B", null]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.players.A.mainDeck.identitiesVisible, false);
    assert.equal(projection.players.A.mainDeck.orderKnown, false);
    assert.equal(projection.players.A.mainDeck.cards.length, 0);
  }
  assertNotSerialized(projectFor(state, "A"), ["card:d1", "Deck One", "d1"], "owner view");
  assertNotSerialized(projectFor(state, "B"), ["card:d1", "Deck One", "d1"], "opponent view");
  assertNotSerialized(projectFor(state, null), ["card:d1", "Deck One", "d1"], "spectator view");
});

