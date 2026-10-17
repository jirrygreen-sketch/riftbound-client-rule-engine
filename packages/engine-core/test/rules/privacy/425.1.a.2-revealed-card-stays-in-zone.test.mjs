// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-revealed-card-stays-in-zone (CR v1.5 425.1.a.2)
//
// Subject: a real reveal plus a real card-program replacement bound to the
// revealed card, driven through the merged replacement layer. The revealed
// card must not change zones (425.1.a.2), while its "as I'm revealed" effect
// still resolves (425.1.a.1).
import assert from "node:assert/strict";
import test from "node:test";
import { c, drain, projectFor, projectionState, scene, slice, spellDraft } from "./harness.mjs";
import { bindReplacement } from "../../../dist/replacement/index.js";

test("privacy-revealed-card-stays-in-zone: a revealed card keeps its zone while its reveal trigger resolves", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .deck(["d1", "d2"], { owner: "A", cardId: "card:d1" })
    .hand("spell", { owner: "A", types: ["spell"] }));

  // A real card program replacement: "As I'm revealed from your Main Deck, add 2 energy."
  const bound = bindReplacement(
    {
      replaces: { event: "card-revealed", filter: { self: true } },
      with: [{ id: "gain", op: "effect.resources", args: { energy: c(2), player: c("A") } }]
    },
    s.kernel.ref("d1"),
    {
      host: { object: ref => s.kernel.object(ref), objects: () => s.kernel.objects, context: (source, controller) => s.kernel },
      pipeline: s.engine.pipeline
    }
  );

  s.engine.execute(spellDraft(s.kernel, "spell", [{ id: "rev", op: "effect.reveal", picks: [slice("top1", 1)], args: { pick: "top1" } }]));
  drain(s.engine);
  bound.cancel();

  // The replacement really applied to the reveal of the top card.
  assert.equal(s.kernel.player("A").energy, 2, "the reveal replacement added 2 energy");
  // 425.1.a.2: the revealed card is still the top card of the Main Deck.
  assert.deepEqual(s.kernel.zone("A", "deck").map(ref => ref.id), ["d1", "d2"]);
  assert.equal(s.kernel.player("A").deckCount, 2);
  // After the reveal window the cards are Secret again.
  const state = projectionState(s.kernel);
  for (const viewer of ["A", "B", null]) {
    assert.equal(projectFor(state, viewer).players.A.mainDeck.cards.length, 0);
    assert.equal(projectFor(state, viewer).players.A.mainDeck.count, 2);
  }
});

