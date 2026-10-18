// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-negative-spectator-view-equals-non-owner (CR v1.5 128.4, 108.7.c, 107.3.f)
//
// Subject: src/projection/v2 projectFor. A spectator must never see more than
// the most-restricted non-controller seat.
import assert from "node:assert/strict";
import test from "node:test";
import { assertNotSerialized, projectFor, projectionState, world } from "./harness.mjs";

test("privacy-negative-spectator-view-equals-non-owner: the spectator view never exceeds the opponent view", () => {
  const kernel = world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", name: "A Hand Card", types: ["unit"] })
    .card("f1", {
      owner: "A", controller: "A", cardId: "card:f1", name: "A Hidden Spell", types: ["spell"],
      zone: "board", location: { type: "battlefield", id: "bf1" }, faceDown: true
    })
    .build();
  const state = projectionState(kernel);
  const A = projectFor(state, "A");
  const B = projectFor(state, "B");
  const spectator = projectFor(state, null);

  // 128.4: the owner/controller keeps their own private faces.
  assert.equal(A.players.A.hand.cards[0].cardId, "card:h1");
  assert.equal(A.players.A.facedown.cards[0].cardId, "card:f1");
  // The opponent sees the backs and nothing else.
  assert.equal(B.players.A.hand.cards[0].visibility, "face-down");
  assert.equal(B.players.A.facedown.cards[0].visibility, "face-down");
  // The spectator must not see a single private face.
  assert.equal(spectator.players.A.hand.cards[0].visibility, "face-down");
  assert.equal(spectator.players.A.facedown.cards[0].visibility, "face-down");
  assert.equal(spectator.players.A.facedown.count, 1, "107.3.f: the occupied slot is still public");
  assertNotSerialized(spectator, ["card:h1", "card:f1", "A Hand Card", "A Hidden Spell"], "spectator view");
});

