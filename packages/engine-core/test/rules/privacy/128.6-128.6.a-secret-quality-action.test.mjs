// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-secret-quality-action-not-compelled          (CR v1.5 128.6, 128.6.a)
//   scenario: privacy-secret-quality-action-accepted-reveals-minimum (CR v1.5 128.6, 108.1.b, 107.1.d)
//
// Subject: choice.optional + effect.play through the real ChainEngine plus
// src/projection/v2. The player may ignore the type-restricted instruction
// (128.6.a uses "ignored = impossible"), and only the played card becomes public.
import assert from "node:assert/strict";
import test from "node:test";
import { c, describeUnitPlay, drain, projectFor, projectionState, scene, spellDraft, timings } from "./harness.mjs";

test("privacy-secret-quality-action-not-compelled: the player may ignore a type-restricted private-zone action", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", name: "Expensive Unit", types: ["unit"], might: 6 })
    .hand("spell", { owner: "A", types: ["spell"] }), { describePlay: describeUnitPlay });
  s.kernel.setPicks("hand-unit", [s.kernel.ref("h1")]);
  s.answers.set("play/choose-unit", []);

  s.engine.execute(spellDraft(s.kernel, "spell", [{
    id: "play", op: "effect.play",
    args: {
      pick: "hand-unit", location: c({ type: "base", player: "A" }),
      cost: c({ finalized: true, energy: 0, power: [] }),
      choice: { id: "choose-unit", min: 0, max: 1 }
    }
  }]));
  drain(s.engine);

  // 128.6/128.6.a: the private-zone pick is optional, so declining is legal.
  assert.equal(s.engine.items.length, 0);
  assert.equal(s.kernel.getObject("h1").zone, "hand", "the unit was not forced into play");
  assert.equal(s.kernel.zone("A", "board").length, 0);
  assert.deepEqual(s.asked.map(request => [request.id, request.visibility]), [[
    s.asked[0].id, "chooser-only"
  ]]);
  const state = projectionState(s.kernel);
  const B = projectFor(state, "B");
  assert.equal(B.players.A.hand.count, 1, "the opponent only sees that a hand card remains");
  assert.equal(B.players.A.hand.cards[0].visibility, "face-down", "the declined card stays private");
  assert.equal(JSON.stringify(B).includes("card:h1"), false);
});

test("privacy-secret-quality-action-accepted-reveals-minimum: accepting publishes only the chosen card", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", name: "Expensive Unit", types: ["unit"], might: 6 })
    .hand("h2", { owner: "A", cardId: "card:h2", name: "Cheap Unit", types: ["unit"], might: 1 })
    .hand("spell", { owner: "A", types: ["spell"] }), { describePlay: describeUnitPlay });
  s.kernel.setPicks("hand-unit", [s.kernel.ref("h1"), s.kernel.ref("h2")]);
  s.answers.set("play/choose-unit", [s.kernel.ref("h1")]);

  s.engine.execute(spellDraft(s.kernel, "spell", [{
    id: "play", op: "effect.play",
    args: {
      pick: "hand-unit", location: c({ type: "base", player: "A" }),
      cost: c({ finalized: true, energy: 0, power: [] }),
      choice: { id: "choose-unit", min: 0, max: 1 }
    }
  }]));
  drain(s.engine);

  // The real play happened: hand -> Base, and the unchosen card did not move.
  assert.equal(s.kernel.getObject("h1").zone, "board");
  assert.equal(s.kernel.getObject("h2").zone, "hand");
  assert.equal(timings(s.engine).includes("object-leaves-hand"), true);
  const state = projectionState(s.kernel);
  const B = projectFor(state, "B");
  assert.deepEqual(B.players.A.base.cards.map(card => card.cardId), ["card:h1"], "107.1.d: the played card is public");
  assert.equal(B.players.A.hand.cards[0].visibility, "face-down", "108.7.c: the unchosen card stays private");
  assert.equal(JSON.stringify(B.players.A.hand).includes("card:h2"), false);
  assert.equal(JSON.stringify(B).includes("card:h2"), false, "the unchosen card never leaks");
});

