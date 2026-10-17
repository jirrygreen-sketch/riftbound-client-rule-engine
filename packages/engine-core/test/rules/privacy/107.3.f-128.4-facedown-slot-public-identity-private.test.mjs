// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-facedown-slot-occupied-public-identity-private (CR v1.5 107.3.f, 128.4)
//   scenario: privacy-facedown-controller-not-owner-reads             (CR v1.5 128.4)
//
// Subject: src/projection/v2 projectFor over facedown objects at a Battlefield.
// The reference kernel builds the position (its builder exposes faceDown and
// controller), and the projection decides who may read the face.
import assert from "node:assert/strict";
import test from "node:test";
import { assertNotSerialized, projectFor, projectionState, world } from "./harness.mjs";

function battlefieldState(kernel) {
  const fields = kernel.objects
    .filter(object => object.zone === "board" && object.location?.type === "battlefield")
    .map(object => object.location.id);
  return projectionState(kernel, {
    battlefields: [...new Set(fields)].map(id => ({
      id,
      controller: null,
      units: { A: [], B: [] },
      facedown: {
        A: kernel.objects.filter(object => object.location?.id === id && object.faceDown && object.owner === "A"),
        B: kernel.objects.filter(object => object.location?.id === id && object.faceDown && object.owner === "B")
      }
    }))
  });
}

test("privacy-facedown-slot-occupied-public-identity-private: the slot is public, the face is the controller's", () => {
  const kernel = world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .card("f1", {
      owner: "A", controller: "A", cardId: "card:f1", name: "Hidden Spell",
      types: ["spell"], keywords: [{ id: "Hidden" }],
      zone: "board", location: { type: "battlefield", id: "bf1" }, faceDown: true
    })
    .build();
  const state = battlefieldState(kernel);

  // 107.3.f: the Facedown Zone is a Public Zone; occupancy is visible to all.
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.players.A.facedown.count, 1, viewer + " sees the occupied slot");
    const card = projection.players.A.facedown.cards[0];
    assert.equal(card.faceDown, true, viewer + " sees a facedown card");
    if (viewer !== "A") {
      assert.equal(card.visibility, "face-down", viewer + " cannot read the face");
      assert.equal(card.cardId, undefined, viewer + " gets no cardId");
      assert.equal(card.types, undefined, viewer + " gets no types");
      assert.equal(card.keywords, undefined, viewer + " gets no keywords");
      assertNotSerialized(projection, ["card:f1", "Hidden Spell"], "view of " + String(viewer));
    }
  }
  // 128.4: the controller may read the face.
  assert.equal(projectFor(state, "A").players.A.facedown.cards[0].cardId, "card:f1");
});

test("privacy-facedown-controller-not-owner-reads: the reader is the controller, not the owner", () => {
  const kernel = world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .card("f1", {
      owner: "A", controller: "B", cardId: "card:f1", name: "A's Card Under B",
      types: ["spell"],
      zone: "board", location: { type: "battlefield", id: "bf1" }, faceDown: true
    })
    .build();
  const state = battlefieldState(kernel);

  // 128.4: the owner A cannot read it; the controller B can.
  assert.equal(projectFor(state, "A").players.A.facedown.cards[0].cardId, undefined);
  assert.equal(projectFor(state, "B").players.A.facedown.cards[0].cardId, "card:f1");
  assert.equal(projectFor(state, null).players.A.facedown.cards[0].cardId, undefined);
  assert.notEqual(projectFor(state, "A").players.A.facedown.cards[0].id, "f1", "the projected id is opaque");
});
