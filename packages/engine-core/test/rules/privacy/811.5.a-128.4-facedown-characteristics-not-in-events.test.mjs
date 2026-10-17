// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-negative-facedown-characteristics-not-in-events (CR v1.5 811.5.a, 128.4)
//
// Subject: the real ChainEngine Finalize path plus src/projection/v2. A card
// that legally targets "a facedown card" must not disclose its face anywhere in
// the projected chain snapshot.
import assert from "node:assert/strict";
import test from "node:test";
import { assertNotSerialized, chainInput, projectFor, projectionState, scene, spellDraft } from "./harness.mjs";

test("privacy-negative-facedown-characteristics-not-in-events: targeting a facedown card never reveals its identity", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .card("f1", {
      owner: "A", controller: "A", cardId: "card:f1", name: "Hidden Spell", types: ["spell"],
      keywords: [{ id: "Hidden" }],
      zone: "board", location: { type: "battlefield", id: "bf1" }, faceDown: true
    })
    .hand("spell", { owner: "B", cardId: "card:spell", types: ["spell"] }), { turnPlayer: "B" });

  s.engine.execute(spellDraft(s.kernel, "spell", [], {
    controller: "B",
    targets: [{ requirement: { id: "face", filter: { zone: "board" }, selection: "one" } }]
  }));

  // The facedown card really became a legal private target (355.9.a.3).
  assert.deepEqual(s.engine.items[0].targetPlans[0].selected, [s.kernel.ref("f1")]);
  assert.equal(s.kernel.getObject("f1").faceDown, true, "the card is still facedown while targeted");

  const state = projectionState(s.kernel, { chain: chainInput(s.engine) });
  for (const viewer of ["B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.chain[0].targets[0].visibility, "face-down", viewer + " sees only the back");
    assert.equal(projection.chain[0].targets[0].cardId, undefined);
    assert.equal(projection.chain[0].targets[0].types, undefined);
    assertNotSerialized(projection, ["card:f1", "Hidden Spell"], "view of " + String(viewer));
  }
  // The controller still reads it.
  assert.equal(projectFor(state, "A").chain[0].targets[0].cardId, "card:f1");
});

