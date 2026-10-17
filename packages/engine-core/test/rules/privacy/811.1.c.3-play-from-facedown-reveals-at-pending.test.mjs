// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-play-from-facedown-reveals-at-pending (CR v1.5 811.1.c.3, 108.1.b)
//
// Subject: the real ChainEngine commit path plus src/projection/v2. A facedown
// card is played from its Facedown Zone; 811.1.c.3 says that opens a chain, and
// 108.1.b makes the resulting chain item public to every viewer.
import assert from "node:assert/strict";
import test from "node:test";
import { c, chainInput, drain, projectFor, projectionState, scene, timings } from "./harness.mjs";

test("privacy-play-from-facedown-reveals-at-pending: a card played from facedown is public the moment it enters the Chain", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .card("f1", {
      owner: "A", controller: "A", cardId: "card:f1", name: "Hidden Spell", types: ["spell"],
      keywords: [{ id: "Hidden" }],
      zone: "board", location: { type: "battlefield", id: "bf1" }, faceDown: true
    })
    .unit("u1", { owner: "B", cardId: "card:u1", might: 2, location: { type: "battlefield", id: "bf1" } }));

  s.engine.execute({
    id: "play-f1", controller: "A", source: s.kernel.getObject("f1"), kind: "spell", speed: "normal", body: [],
    cost: { id: "cost:play-f1", cost: { energy: c(0), power: c([]) } }
  });

  // 811.1.c.3: playing from facedown opens a chain and leaves the Facedown Zone.
  assert.deepEqual(timings(s.engine).slice(0, 6), ["object-leaves-zone", "object-leaves-board", "object-leaves-battlefield", "object-enters-zone", "object-enters-chain", "chain-item-pending"]);
  assert.equal(s.kernel.getObject("f1").zone, "chain");
  assert.equal(s.kernel.objectsInZone("A", "board").length, 0, "the Facedown Zone slot is empty");
  assert.equal(s.engine.items.length, 1);
  assert.equal(s.engine.items[0].status, "finalized");

  // 108.1.b: the Pending/Finalized item is public in every view.
  const state = projectionState(s.kernel, { chain: chainInput(s.engine) });
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.chain.length, 1, viewer + " sees the item");
    assert.equal(projection.chain[0].source.cardId, "card:f1", viewer + " reads the revealed identity");
    assert.equal(projection.chain[0].source.visibility, "identity");
  }

  drain(s.engine);
  assert.equal(s.kernel.getObject("f1").zone, "trash", "the resolved spell left the Chain");
});

