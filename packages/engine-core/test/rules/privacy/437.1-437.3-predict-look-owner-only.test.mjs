// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-predict-look-owner-only (CR v1.5 437.1, 437.1.a, 108.4.e)
//
// Subject: effect.inspect (look) plus effect.recycle through the real
// ChainEngine, then src/projection/v2. The Predicting player sees the top
// cards privately; the opponent only learns that a recycle happened.
import assert from "node:assert/strict";
import test from "node:test";
import { c, drain, projectFor, projectionState, scene, slice, spellDraft } from "./harness.mjs";

test("privacy-predict-look-owner-only: the look is private, the recycle is public and the deck stays Secret", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .deck(["d1", "d2", "d3"], { owner: "A", cardId: "card:deck" })
    .hand("spell", { owner: "A", types: ["spell"] }));

  s.engine.execute(spellDraft(s.kernel, "spell", [
    {
      id: "look", op: "effect.inspect", picks: [slice("top2", 2)],
      args: {
        player: c("A"), zone: c("deck"), scope: c("picks"), picksSpecId: c("top2"),
        choose: c(true), chooseCount: c({ min: 1, max: 1 }),
        pickedKey: c("looked"), choosePicksKey: c("chosen"), choiceId: c("look:choose")
      }
    },
    { id: "recycle", op: "effect.recycle", linkedTo: "look", args: { objects: { kind: "linked-value", instructionId: "look", key: "chosen" } } }
  ]));
  // The answer names a real card from the private top, read through the kernel.
  s.answers.set("look/look%3Achoose", [s.kernel.ref("d2")]);
  drain(s.engine);

  // 437.1: the look was private to its chooser and did not change zones.
  assert.deepEqual(s.asked.map(request => [request.id, request.visibility]), [["look/look%3Achoose", "chooser-only"]]);
  assert.equal(s.kernel.player("A").deckCount, 3, "the deck size is unchanged");
  // The chosen card was really recycled to the deck bottom.
  const deck = s.kernel.zone("A", "deck").map(ref => ref.id);
  assert.equal(deck.at(-1), "d2");
  assert.deepEqual([...deck].sort(), ["d1", "d2", "d3"]);

  // 108.4.e: after the effect, the deck is Secret again in every view.
  const state = projectionState(s.kernel);
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.players.A.mainDeck.count, 3, viewer + " keeps the public count");
    assert.equal(projection.players.A.mainDeck.cards.length, 0, viewer + " sees no deck order or identity");
  }
  assert.equal(JSON.stringify(projectFor(state, "B")).includes("card:deck"), false);
});

