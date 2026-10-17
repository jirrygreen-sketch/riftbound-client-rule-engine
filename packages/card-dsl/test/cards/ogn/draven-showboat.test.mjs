// Scenario evidence: ../templates/static-641.test.mjs (supported paths and explicit binding gaps).
// Whole-card execution remains pending; the existing component evidence below is retained.
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
  // The amount is the controller's current points, recorded as descriptor data
  // because Expr has no player-attribute reader (see judgeReason).
  assert.deepEqual(ability.effect.amountFrom, { player: "controller", property: "points" });
  assert.equal(ability.effect.amount, undefined);
});

test("ogn-028-298 Draven, Showboat golden: the static effect registers, but the amount stays at the printed Might", () => {
  // 194/194.4: "your points" is the controller's current points (PlayerSnapshot.score).
  // The static ability does bind through the real lifecycle, so the gap is not
  // registration — it is that `amountFrom` is descriptive data the layer engine
  // never reads, and Expr has no player-attribute form to express it.
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
});

test.todo(
  "ogn-028-298 Draven, Showboat: execute 'Might += your points' as a dynamic arithmetic-layer " +
    "Might change (CR 194/194.4) once Expr/PlayerSnapshot exposes a points reader"
);

