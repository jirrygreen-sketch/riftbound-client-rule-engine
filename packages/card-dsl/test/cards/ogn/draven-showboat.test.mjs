// Scenario execution evidence: ../templates/static-666.test.mjs (one row per card plus condition boundaries).
// This file retains validation, identity, and key IR structure checks; whole-card status stays judge-required until all consumers exist.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/draven-showboat.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-2fce7f4e1db0ed6a111d74a7702d3846593794a9cddf1a1722959543f53ec58e";
const forged = { ...program, status: "executable", judgeReason: undefined };

test("ogn-028-298 Draven, Showboat: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /points/);
});

test("ogn-028-298 Draven, Showboat: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, "My Might is increased by your points.");
  assert.equal(program.judgeReason.includes("continuous.might"), true);
  assert.match(program.judgeReason, /194\.1/);
  assert.match(program.judgeReason, /score/);
  assert.match(program.judgeReason, /expr-ext\/evaluate\.ts/);
});

test("ogn-028-298 Draven, Showboat: one static arithmetic Might effect sourced from the controller's points", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  // RIFT-711 adds the player-state expression needed to represent the printed
  // amount. Production LayerEngine wiring remains the open dependency.
  assert.deepEqual(ability.effect.amount, {
    kind: "player-property",
    player: "controller",
    property: "points"
  });
  assert.equal(ability.effect.amountFrom, undefined);
});

test("ogn-028-298 Draven, Showboat golden: the static effect registers, but the amount stays at the printed Might", () => {
  // 194/194.4: "your points" is the controller's current points (PlayerSnapshot.score).
  // The static ability does bind through the real lifecycle, so the gap is not
  // registration — production LayerEngine still does not route the merged
  // player-property expression through expr-ext.
  const state = fixture({ cards: [{ id: "draven", cardId: CARD_ID, types: ["unit"], might: 3 }] });
  createProgramBinding({ cardPrograms: [forged] }).attachLifecycle(state.engine, () => {});
  state.engine.commit({ type: "move-zone", object: state.kernel.ref("draven"), to: "board", location: { type: "base", player: "A" } });

  assert.equal(state.engine.layers.registry.list().length, 1);

  state.kernel.perform({ type: "score", player: "A", amount: 3 });
  assert.equal(state.kernel.player("A").score, 3);
  assert.equal(state.engine.layers.evaluate(state.kernel.ref("draven")).might, 3);

  // Control: the same registration with a numeric amount does raise Might, so
  // the layer path itself is fine and only the points reader is missing.
  state.engine.layers.addContinuous({
    id: "draven-control",
    layer: "arithmetic",
    source: state.kernel.getObject("draven").ref,
    filter: { objectId: "draven", zone: "board" },
    effect: { kind: "continuous.might", mode: "add", amount: 3 }
  }, { type: "permanent" });
  assert.equal(state.engine.layers.evaluate(state.kernel.ref("draven")).might, 6);

  // Points are tracked and can move, which is what a real reader would have to
  // follow (it is not locked at entry).
  state.kernel.perform({ type: "score", player: "A", amount: 2 });
  assert.equal(state.kernel.player("A").score, 5);
  // The control layer still contributes its fixed +3; the card's own
  // player-property expression remains a zero contribution after the score
  // changes, so the result stays at 6 instead of following points to 5.
  assert.equal(state.engine.layers.evaluate(state.kernel.ref("draven")).might, 6);
});

test.todo(
  "ogn-028-298 Draven, Showboat: execute 'Might += your points' as a dynamic arithmetic-layer " +
    "Might change (CR 194/194.4) once programs/statics.ts and LayerEngine route " +
    "player-property(points) through expr-ext/evaluate.ts"
);

