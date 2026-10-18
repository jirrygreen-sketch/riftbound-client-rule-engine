// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-discard-choice-private-until-trash (CR v1.5 423.1.a, 108.7.c, 108.2.d)
//
// Subject: effect.discard through the real ChainEngine plus src/projection/v2.
// The discarder's choice is a chooser-only request; only the resulting Trash
// entry is public.
import assert from "node:assert/strict";
import test from "node:test";
import { drain, projectFor, projectionState, scene, spellDraft } from "./harness.mjs";
import { c } from "./harness.mjs";

test("privacy-discard-choice-private-until-trash: only the discarder sees the choice, only the Trash result is public", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", name: "Discarded One", types: ["unit"], might: 1 })
    .hand("h2", { owner: "A", cardId: "card:h2", name: "Kept Spell", types: ["spell"] })
    .hand("spell", { owner: "B", types: ["spell"] }), { turnPlayer: "B" });

  s.answers.set("discard/effect.discard%3AA", [s.kernel.ref("h1")]);
  s.engine.execute({
    id: "b-spell", controller: "B", source: s.kernel.getObject("spell"), kind: "spell", speed: "normal",
    body: [{ id: "discard", op: "effect.discard", args: { amount: c(1), player: c("A"), choiceId: c("effect.discard:A") } }],
    cost: { id: "cost:b-spell", cost: { energy: c(0), power: c([]) } }
  });
  drain(s.engine);

  // 423.1.a: the choice request was private to the discarder.
  assert.deepEqual(s.asked.map(request => [request.id, request.visibility]), [["discard/effect.discard%3AA", "chooser-only"]]);
  assert.equal(s.kernel.getObject("h1").zone, "trash", "the chosen card really moved to Trash");
  assert.equal(s.kernel.getObject("h2").zone, "hand");
  assert.deepEqual(s.kernel.zone("A", "trash").map(ref => ref.id), ["h1"]);

  const state = projectionState(s.kernel);
  const A = projectFor(state, "A");
  const B = projectFor(state, "B");
  const spectator = projectFor(state, null);
  // 108.2.d: the Trash entry is public to everyone.
  for (const projection of [A, B, spectator]) {
    assert.deepEqual(projection.players.A.trash.cards.map(card => card.cardId), ["card:h1"]);
  }
  // 108.7.c: the card that stayed in hand is still private to the opponent.
  assert.equal(A.players.A.hand.cards[0].cardId, "card:h2");
  assert.equal(B.players.A.hand.cards[0].visibility, "face-down");
  assert.equal(JSON.stringify(B.players.A.hand).includes("card:h2"), false, "the kept card never leaks");
  // The discarded card is public, so its recorded choice is readable by its owner.
  assert.equal(A.players.A.hand.count, 1);
  assert.equal(B.players.A.hand.count, 1);
});
