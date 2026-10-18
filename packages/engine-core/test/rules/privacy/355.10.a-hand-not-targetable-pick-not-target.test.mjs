// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-hand-not-targetable-pick-not-target            (CR v1.5 355.10.a, 355.10.a.1)
//   scenario: privacy-pick-from-private-zone-opponent-sees-result-only (355.10.a, 423.1.a, 108.7.c)
//
// Subject: the real ChainEngine Finalize path plus src/projection/v2. The hand
// card is selected through a PickSpec (a non-target selection), so the chain
// item must finalize with no targets and the opponent must never see a prompt
// or an identity for it.
import assert from "node:assert/strict";
import test from "node:test";
import { chainInput, drain, permanentDraft, projectFor, projectionState, scene, spellDraft, timings } from "./harness.mjs";

function describePlay(action, source) {
  return {
    id: "play:" + source.ref.id,
    controller: action.player,
    source,
    kind: "unit",
    speed: "action",
    body: [],
    location: action.location ?? { type: "base", player: action.player }
  };
}

test("privacy-hand-not-targetable-pick-not-target: a hand selection is a pick, never a target, and never leaks", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", name: "Hidden Unit", types: ["unit"], might: 3 })
    .hand("h2", { owner: "A", cardId: "card:h2", name: "Hidden Unit Two", types: ["unit"], might: 4 })
    .hand("spell", { owner: "A", types: ["spell"] }), { describePlay });
  s.kernel.setPicks("hand-unit", [s.kernel.ref("h1"), s.kernel.ref("h2")]);
  s.answers.set("play/choose-unit", [s.kernel.ref("h1")]);

  s.engine.execute(spellDraft(s.kernel, "spell", [{
    id: "play", op: "effect.play",
    args: {
      pick: "hand-unit", location: { kind: "constant", value: { type: "base", player: "A" } },
      cost: { kind: "constant", value: { finalized: true, energy: 0, power: [] } },
      choice: { id: "choose-unit", min: 0, max: 1 }
    }
  }]));
  const item = s.engine.items[0];
  assert.deepEqual(item.targetPlans, [], "355.10.a: nothing in hand was made a target");
  assert.equal(s.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
  assert.equal(timings(s.engine).includes("became-target"), false);

  const state = projectionState(s.kernel, { chain: chainInput(s.engine) });
  for (const viewer of ["A", "B", null]) {
    const projection = projectFor(state, viewer);
    assert.deepEqual(projection.chain[0].targets, [], viewer + " sees no finalized target");
  }
  // The choice request was chooser-only: the opponent never sees the options.
  assert.equal(JSON.stringify(projectFor(state, "B")).includes("card:h1"), false, "the hand pick never leaks to the opponent");

  drain(s.engine);
  // The selection itself happened at resolve time as a chooser-only request.
  const choice = s.asked.find(request => request.id === "play/choose-unit");
  assert.ok(choice, "the resolve-time pick really asked");
  assert.equal(choice.visibility, "chooser-only");
  assert.deepEqual(choice.options.map(ref => ref.id), ["h1", "h2"]);
  assert.equal(s.kernel.getObject("h1").zone, "board", "the picked unit really entered the Board");
  assert.equal(s.kernel.getObject("h2").zone, "hand", "the unpicked unit stayed in hand");
});
