// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-facedown-leaves-zone-revealed-to-all (CR v1.5 422.4)
//
// 422.4 requires a facedown card to be revealed to all players when it changes
// zones. The merged kernel can move the card (effect.zone) and the projection
// enforces the post-move privacy level; the mandatory reveal event itself is
// missing, so the event half is a separate todo below.
import assert from "node:assert/strict";
import test from "node:test";
import { c, drain, projectFor, projectionState, scene, spellDraft, timings } from "./harness.mjs";

test("privacy-facedown-leaves-zone-revealed-to-all: after the zone change the hand entry is private again", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .card("f1", {
      owner: "A", controller: "A", cardId: "card:f1", name: "Hidden Spell", types: ["spell"],
      zone: "board", location: { type: "battlefield", id: "bf1" }, faceDown: true
    })
    .hand("spell", { owner: "A", types: ["spell"] }));
  s.kernel.setPicks("face-pick", [s.kernel.ref("f1")]);

  s.engine.execute(spellDraft(s.kernel, "spell", [{
    id: "ret", op: "effect.zone",
    picks: [{ id: "face-pick", options: [], selection: "all" }],
    args: { pick: "face-pick", to: c("hand") }
  }]));
  drain(s.engine);

  // The real zone change happened: Battlefield Facedown Zone -> Hand.
  assert.deepEqual(timings(s.engine).slice(10, 16), ["object-leaves-zone", "object-leaves-board", "object-leaves-battlefield", "object-enters-zone", "object-enters-hand", "card-played"]);
  assert.equal(s.kernel.getObject("f1").zone, "hand");
  assert.equal(s.kernel.objectsInZone("A", "board").length, 0, "the Facedown Zone slot is empty again");

  // Once in the hand, 108.7.c applies again: only its owner reads the face.
  const state = projectionState(s.kernel);
  assert.equal(projectFor(state, "A").players.A.hand.cards[0].cardId, "card:f1");
  assert.equal(projectFor(state, "B").players.A.hand.cards[0].visibility, "face-down");
  assert.equal(projectFor(state, null).players.A.hand.cards[0].visibility, "face-down");
  assert.equal(JSON.stringify(projectFor(state, "B")).includes("card:f1"), false);
});

test.todo(
  "privacy-facedown-leaves-zone-revealed-to-all: 换区瞬间产生对所有人可见的 card.revealed " +
  "[M]（缺：422.4 的换区展示时点；实测 effect.zone 换区后事件流没有 card-revealed）"
);

