// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-pick-from-private-zone-opponent-sees-result-only (CR v1.5 355.10.a, 423.1.a, 108.7.c)
//
// Subject: effect.inspect + effect.zone through the real ChainEngine plus
// src/projection/v2. The opponent learns the counts before and after, never
// which cards were looked at, taken or put back.
import assert from "node:assert/strict";
import test from "node:test";
import { c, drain, linkedPick, projectFor, projectionState, scene, slice, spellDraft } from "./harness.mjs";

test("privacy-pick-from-private-zone-opponent-sees-result-only: only the resulting counts are public", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .deck(["d1", "d2", "d3", "d4"], { owner: "A", cardId: "card:deck" })
    .hand("spell", { owner: "A", types: ["spell"] }));

  s.engine.execute(spellDraft(s.kernel, "spell", [
    {
      id: "look", op: "effect.inspect", picks: [slice("top3", 3)],
      args: {
        player: c("A"), zone: c("deck"), scope: c("picks"), picksSpecId: c("top3"),
        choose: c(true), chooseCount: c({ min: 1, max: 1 }),
        pickedKey: c("looked"), choosePicksKey: c("taken"), choiceId: c("look:choose")
      }
    },
    { id: "take", op: "effect.zone", linkedTo: "look", picks: [linkedPick("taken-pick", "look", "taken")], args: { pick: "taken-pick", to: c("hand") } },
    { id: "rest", op: "effect.zone", linkedTo: "look", picks: [linkedPick("rest-pick", "look", "looked", "taken")], args: { pick: "rest-pick", to: c("deck-bottom") } }
  ]));
  s.answers.set("look/look%3Achoose", [s.kernel.ref("d2")]);
  drain(s.engine);

  // The selection was private and the real counts moved: deck 4 -> 3, hand 0 -> 1.
  assert.deepEqual(s.asked.map(request => [request.id, request.visibility]), [["look/look%3Achoose", "chooser-only"]]);
  assert.equal(s.kernel.player("A").deckCount, 3);
  assert.deepEqual(s.kernel.zone("A", "hand").map(ref => ref.id), ["d2"]);
  assert.equal(s.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 0, "no Reveal happened");

  const state = projectionState(s.kernel);
  const B = projectFor(state, "B");
  const spectator = projectFor(state, null);
  assert.equal(B.players.A.hand.count, 1, "the opponent sees the hand count");
  assert.equal(B.players.A.hand.cards[0].visibility, "face-down", "the taken card is private");
  assert.equal(B.players.A.mainDeck.count, 3, "the opponent sees the deck count");
  assert.equal(B.players.A.mainDeck.cards.length, 0, "the deck order stays Secret");
  assert.equal(spectator.players.A.hand.cards[0].visibility, "face-down");
  assert.equal(projectFor(state, "A").players.A.hand.cards[0].cardId, "card:deck");
  for (const secret of ["card:deck", "d1", "d3", "d4"]) {
    assert.equal(JSON.stringify(B).includes(secret), false, "no leak of " + secret);
  }
});

