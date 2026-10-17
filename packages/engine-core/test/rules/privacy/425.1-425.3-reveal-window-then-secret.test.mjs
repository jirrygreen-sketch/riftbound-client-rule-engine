// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-reveal-top-cards-all-views-then-secret-again (CR v1.5 425.1, 425.1.a.3, 425.3, 108.4.e)
//   scenario: privacy-revealed-card-stays-in-zone                    (CR v1.5 425.1.a.2)
//
// Subject: effect.reveal through the real ChainEngine plus src/projection/v2.
// The reveal ActionOutcome supplies the actual revealed references; the test
// never names the cards the engine displayed.
import assert from "node:assert/strict";
import test from "node:test";
import { drain, projectFor, projectionState, revealGrant, scene, slice, spellDraft, timings } from "./harness.mjs";

test("privacy-reveal-top-cards-all-views-then-secret-again: the reveal window is public and expires back to Secret", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .deck(["d1", "d2", "d3"], { owner: "A", cardId: "card:deck" })
    .hand("spell", { owner: "A", types: ["spell"] }));
  const orderBefore = s.kernel.zone("A", "deck").map(ref => ref.id);

  s.engine.execute(spellDraft(s.kernel, "spell", [{ id: "rev", op: "effect.reveal", picks: [slice("top2", 2)], args: { pick: "top2" } }]));
  drain(s.engine);
  const revealedEvents = s.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed");
  assert.equal(revealedEvents.length, 2, "two card.revealed events fired");
  assert.deepEqual(timings(s.engine), ["object-leaves-zone", "object-leaves-hand", "object-enters-zone", "object-enters-chain", "chain-item-pending", "cleanup-start", "cleanup-end", "chain-item-finalize", "cleanup-start", "cleanup-end", "card-revealed", "card-revealed", "card-played", "object-leaves-zone", "object-leaves-chain", "object-enters-zone", "object-enters-trash", "chain-item-resolve", "cleanup-start", "cleanup-end"]);

  // 425.1.a.2: the cards stay in the Main Deck in their original order.
  assert.deepEqual(s.kernel.zone("A", "deck").map(ref => ref.id), orderBefore);
  assert.equal(s.kernel.player("A").deckCount, 3);

  // 425.1/425.3: while the grant is live, every viewer sees the two cards.
  const revealed = revealedEvents.map(event => event.object.ref);
  const base = projectionState(s.kernel);
  const live = { ...base, visibility: [revealGrant(revealed)] };
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(live, viewer);
    assert.equal(projection.players.A.mainDeck.count, 3, viewer + " keeps the public count");
    const faces = projection.players.A.mainDeck.cards.map(card => card.visibility);
    assert.deepEqual(faces, ["identity", "identity"], viewer + " sees the revealed cards");
  }

  // 425.1.a.3: once the grant expires the deck returns to count-only.
  const expired = { ...base, visibility: [revealGrant(revealed, { active: false })] };
  for (const viewer of ["A", "B", null]) {
    const projection = projectFor(expired, viewer);
    assert.equal(projection.players.A.mainDeck.cards.length, 0, viewer + " sees no deck identity after expiry");
    assert.equal(projection.players.A.mainDeck.count, 3);
  }
});
