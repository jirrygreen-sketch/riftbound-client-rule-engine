// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-hand-faces-private-count-public               (CR v1.5 108.7.c, 108.7.e)
//   scenario: privacy-negative-opponent-view-must-not-contain-hand-identity (108.7.c, 128.4)
//
// Subject: src/projection/v2 projectFor over a position built with the merged
// src/effects/testing reference kernel. The projection is pure and the
// authoritative snapshots are never hand-edited.
import assert from "node:assert/strict";
import test from "node:test";
import { assertNotSerialized, projectFor, projectionState, world } from "./harness.mjs";

function fixture() {
  return world()
    .player("A", { energy: 1 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", name: "Hand One", types: ["unit"], might: 2 })
    .hand("h2", { owner: "B", cardId: "card:h2", name: "Hand Two", types: ["spell"] })
    .hand("h3", { owner: "B", cardId: "card:h3", name: "Hand Three", types: ["spell"] })
    .build();
}

function assertZoneFaceDown(zone, message) {
  for (const card of zone.cards) {
    assert.equal(card.visibility, "face-down", message);
    assert.equal(card.cardId, undefined, message);
  }
}

test("privacy-hand-faces-private-count-public: hand faces stay private while the count is public", () => {
  const kernel = fixture();
  const before = kernel.objects.map(object => ({ ref: object.ref, cardId: object.cardId }));
  const state = projectionState(kernel);
  const A = projectFor(state, "A");
  const B = projectFor(state, "B");
  const spectator = projectFor(state, null);

  // 108.7.e: the number of cards in a hand is Public Information for every viewer.
  assert.equal(A.players.B.hand.count, 2);
  assert.equal(B.players.A.hand.count, 1);
  assert.equal(spectator.players.A.hand.count, 1);
  assert.equal(spectator.players.B.hand.count, 2);
  assert.equal(A.players.A.handCount, 1);
  assert.equal(A.players.B.handCount, 2);

  // 108.7.c: only the owner may read the faces of their own hand.
  assert.equal(A.players.A.hand.cards[0].cardId, "card:h1");
  assert.equal(A.players.B.hand.cards[0].cardId, undefined);
  assert.equal(B.players.B.hand.cards[0].cardId, "card:h2");
  assert.equal(B.players.A.hand.cards[0].cardId, undefined);
  assertZoneFaceDown(B.players.A.hand, "opponent view of A's hand");
  assertZoneFaceDown(spectator.players.B.hand, "spectator view of B's hand");

  // The projection is pure: the authoritative snapshots are untouched.
  assert.deepEqual(kernel.objects.map(object => ({ ref: object.ref, cardId: object.cardId })), before);
});

test("privacy-negative-opponent-view-must-not-contain-hand-identity: no hand identity reaches the opponent or spectator view", () => {
  const kernel = fixture();
  const state = projectionState(kernel, {
    eventLog: [{ type: "zone.enter", object: kernel.ref("h1"), cardId: "card:h1", name: "Hand One" }]
  });
  const B = projectFor(state, "B");
  const spectator = projectFor(state, null);

  assertZoneFaceDown(B.players.A.hand, "opponent view of A's hand");
  assert.equal(B.players.A.hand.cards[0].name, undefined);
  assert.equal(B.players.A.hand.cards[0].cost, undefined);
  assertZoneFaceDown(spectator.players.B.hand, "spectator view of B's hand");
  // 128.4 also forbids leaking through state snapshots or event payloads.
  assertNotSerialized(B, ["card:h1", "Hand One"], "opponent view of A's hand");
  assertNotSerialized(spectator, ["card:h1", "Hand One", "card:h2", "card:h3"], "spectator view");
});
