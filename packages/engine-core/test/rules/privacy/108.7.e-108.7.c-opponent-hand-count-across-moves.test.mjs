// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-opponent-hand-count-across-moves (CR v1.5 108.7.e, 108.7.c)
//
// Subject: the real Play path of the merged ChainEngine plus src/projection/v2.
// Two units are played from hand; every viewer must see the hand count update
// at each step while the faces stay private.
import assert from "node:assert/strict";
import test from "node:test";
import { drain, permanentDraft, projectFor, projectionState, scene } from "./harness.mjs";

test("privacy-opponent-hand-count-across-moves: the opponent hand count updates while its faces stay private", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("u1", { owner: "A", cardId: "card:u1", name: "First Unit", types: ["unit"], might: 1 })
    .hand("u2", { owner: "A", cardId: "card:u2", name: "Second Unit", types: ["unit"], might: 1 })
    .hand("b1", { owner: "B", cardId: "card:b1", name: "B One", types: ["spell"] })
    .hand("b2", { owner: "B", cardId: "card:b2", name: "B Two", types: ["spell"] })
    .hand("b3", { owner: "B", cardId: "card:b3", name: "B Three", types: ["spell"] }));

  const counts = [];
  const snapshot = label => {
    const state = projectionState(s.kernel);
    const B = projectFor(state, "B");
    const spectator = projectFor(state, null);
    counts.push([label, B.players.A.hand.count, B.players.A.base.count, spectator.players.A.hand.count]);
    assert.equal(B.players.A.hand.cards.every(card => card.visibility === "face-down"), true, label + ": A's hand faces stay private");
    assert.equal(B.players.B.hand.cards.every(card => card.visibility === "identity"), true, label + ": B still reads B's own hand");
    // The played card is public once it is on the Board (107.1.d); what must
    // stay private is the hand's own information channel.
    assert.equal(JSON.stringify(B.players.A.hand).includes("card:u1"), false, label + ": the hand view leaks nothing");
    assert.equal(JSON.stringify(B.players.B.hand).includes("card:b1"), true, label + ": B's own faces are still readable by B");
  };

  snapshot("before");
  s.engine.execute(permanentDraft(s.kernel, "u1"));
  drain(s.engine);
  snapshot("after-first");
  s.engine.execute(permanentDraft(s.kernel, "u2"));
  drain(s.engine);
  snapshot("after-second");

  assert.deepEqual(counts, [
    ["before", 2, 0, 2],
    ["after-first", 1, 1, 1],
    ["after-second", 0, 2, 0]
  ]);
  assert.deepEqual(s.kernel.zone("A", "board").map(ref => ref.id).sort(), ["u1", "u2"], "both units really entered the Board");
  const B = projectFor(projectionState(s.kernel), "B");
  assert.deepEqual(B.players.A.base.cards.map(card => card.cardId).sort(), ["card:u1", "card:u2"], "107.1.d: played permanents are public");
  assert.equal(B.players.B.hand.count, 3, "B's three hand cards stay private but countable");
});
