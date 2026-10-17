// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-chain-items-public (CR v1.5 108.1.b)
//
// Subject: the real ChainEngine commit path plus src/projection/v2. The card is
// played from a private zone through the merged Pending/Finalize path; the
// chain item is then projected for every viewer.
import assert from "node:assert/strict";
import test from "node:test";
import { chainInput, drain, projectFor, projectionState, scene, spellDraft, timings } from "./harness.mjs";

test("privacy-chain-items-public: a card that enters the Chain becomes public to every view", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("s1", { owner: "A", cardId: "card:s1", name: "Secret Spell", types: ["spell"] })
    .unit("u1", { owner: "A", cardId: "card:u1", name: "Friendly Unit", might: 2, location: { type: "battlefield", id: "bf1" } }));

  s.engine.execute(spellDraft(s.kernel, "s1", [], {
    targets: [{ requirement: { id: "unit", filter: { zone: "board" }, selection: "one" }, options: { selected: [s.kernel.ref("u1")] } }]
  }));

  // The real event path: private hand -> Chain -> Pending -> target locked at
  // Finalize (383.4.b) -> Finalize.
  assert.deepEqual(timings(s.engine), ["object-leaves-zone", "object-leaves-hand", "object-enters-zone", "object-enters-chain", "chain-item-pending", "cleanup-start", "cleanup-end", "became-target", "chain-item-finalize", "cleanup-start", "cleanup-end"]);
  assert.equal(s.kernel.getObject("s1").zone, "chain", "the played card is really on the Chain");
  const item = s.engine.items[0];
  assert.equal(item.status, "finalized");
  assert.deepEqual(item.targetPlans[0].selected, [s.kernel.ref("u1")]);

  const state = projectionState(s.kernel, { chain: chainInput(s.engine) });
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.chain.length, 1, viewer + " sees the chain item");
    assert.equal(projection.chain[0].status, "finalized");
    assert.equal(projection.chain[0].source.cardId, "card:s1", viewer + " sees the chain source identity");
    assert.equal(projection.chain[0].source.visibility, "identity");
    assert.deepEqual(projection.chain[0].targets.map(target => target.visibility), ["identity"], viewer + " sees the finalized target");
    // The projected object is correlated with the real board object by ref,
    // not by a hidden second copy of the authority.
    const boardTarget = projection.players.A.battlefield.cards.find(card => card.ref.id === projection.chain[0].targets[0].ref.id);
    assert.equal(boardTarget.cardId, "card:u1", viewer + " can correlate the public target");
  }
});
