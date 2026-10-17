// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-game-end-facedown-revealed-all (CR v1.5 422.4)
//
// Subject: src/projection/v2 projectFor. 422.4 says an ended game reveals the
// remaining facedown cards to every player, so the projector must drop the
// facedown filter once the game is over.
import assert from "node:assert/strict";
import test from "node:test";
import { projectFor, projectionState, world } from "./harness.mjs";

test("privacy-game-end-facedown-revealed-all: an ended game reveals remaining facedown cards to every view", () => {
  const kernel = world()
    .player("A", { score: 8 })
    .player("B", { score: 3 })
    .card("f1", {
      owner: "A", controller: "A", cardId: "card:f1", name: "Hidden Unit", types: ["unit"],
      zone: "board", location: { type: "battlefield", id: "bf1" }, faceDown: true
    })
    .unit("u1", { owner: "A", cardId: "card:u1", might: 3, location: { type: "battlefield", id: "bf1" } })
    .build();
  const state = projectionState(kernel, { phase: "ended" });
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    const card = projection.players.A.facedown.cards[0];
    assert.ok(card, viewer + " sees the facedown slot");
    assert.equal(card.visibility, "identity", viewer + " reads the face after the game ended");
    assert.equal(card.cardId, "card:f1");
  }
});

