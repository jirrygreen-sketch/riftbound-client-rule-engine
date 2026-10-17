// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-public-zones-visible-all-views
//     (CR v1.5 108.2.d Trash, 108.6.e Banishment, 108.3.e Champion Zone, 107.1.d Base)
//
// Subject: src/projection/v2 projectFor. Trash / Banishment / Base entries are
// produced by real reference-kernel GameActions, never by hand-settled state.
// The Champion/Legend Zone half has no merged engine representation yet; it is
// recorded as a separate todo in 108.3.e-champion-legend-zone-public.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { projectFor, projectionState, world } from "./harness.mjs";

function fixture() {
  return world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("t1", { owner: "A", cardId: "card:t1", name: "Trash Card", types: ["spell"] })
    .hand("x1", { owner: "A", cardId: "card:x1", name: "Banished Gear", types: ["gear"] })
    .base("a1", { owner: "A", cardId: "card:a1", name: "Base Unit", types: ["unit"], might: 3 })
    .unit("u1", { owner: "A", cardId: "card:u1", types: ["unit"], might: 2, location: { type: "battlefield", id: "bf1" } })
    .build();
}

test("privacy-public-zones-visible-all-views: Trash, Banishment and Base identities are identical in all four views", () => {
  const kernel = fixture();
  // Real GameActions move the cards into the public zones (423.1 / 428.1 / 421).
  assert.equal(kernel.perform({ type: "discard", object: kernel.ref("t1") }).status, "done");
  assert.equal(kernel.perform({ type: "banish", object: kernel.ref("x1") }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("u1"), to: "base" }).status, "done");
  assert.equal(kernel.getObject("t1").zone, "trash");
  assert.equal(kernel.getObject("x1").zone, "banishment");
  assert.equal(kernel.getObject("u1").zone, "board");

  const state = projectionState(kernel);
  const expectedBase = ["card:a1", "card:u1"];
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.players.A.trash.count, 1, viewer + " sees the Trash count");
    assert.equal(projection.players.A.trash.cards[0].cardId, "card:t1", viewer + " sees the Trash identity");
    assert.equal(projection.players.A.banishment.count, 1, viewer + " sees the Banishment count");
    assert.equal(projection.players.A.banishment.cards[0].cardId, "card:x1", viewer + " sees the Banishment identity");
    assert.equal(projection.players.A.base.count, 2, viewer + " sees both Base permanents");
    assert.deepEqual(
      projection.players.A.base.cards.map(card => card.cardId),
      expectedBase,
      viewer + " sees the Base identities"
    );
  }
});
