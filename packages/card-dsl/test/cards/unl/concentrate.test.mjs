import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/concentrate.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-faa895f1e7713ee3a12d2dc5921967e2171457086b5582208825c5b0eae45fd6";
const SOURCE_TEXT =
  "Draw 2.\n" +
  "[Level 6][>] This costs :rb_energy_2: less. (While you have 6+ XP, get the effect.)\n" +
  "[Level 11][>] This costs :rb_energy_4: less instead.";

const [levelSix, levelEleven, play] = program.abilities;
const [drawTwo] = play.body;

test("unl-091-219 Concentrate: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-091-219 Concentrate: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /824\.1/);
});

test("unl-091-219 Concentrate: the two [Level] cost reductions are recorded as static cost.modify shapes", () => {
  assert.equal(program.abilities.length, 3);
  for (const [ability, amount, threshold] of [
    [levelSix, -2, 6],
    [levelEleven, -4, 11]
  ]) {
    assert.equal(ability.kind, "static");
    // 356.4: the discount applies to this card's printed Energy cost while it is
    // being played; no merged consumer reads this shape (see judgeReason).
    assert.deepEqual(ability.effect, {
      kind: "cost.modify",
      resource: "energy",
      component: "total",
      appliesTo: "self",
      amount: { kind: "constant", value: amount }
    });
    // 824.1.b.1 / 824.1.c: the Level gate is the controller's XP threshold.
    assert.equal(ability.condition.kind, "compare");
    assert.equal(ability.condition.operator, "gte");
    assert.equal(ability.condition.left.subject, "controller-xp");
    assert.deepEqual(ability.condition.right, { kind: "constant", value: threshold });
  }
});

test("unl-091-219 Concentrate: the play half is an independent Draw 2", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(drawTwo.id, "concentrate.draw-2");
  assert.equal(drawTwo.op, "effect.draw");
  assert.deepEqual(drawTwo.args.amount, { kind: "constant", value: 2 });
  assert.equal(drawTwo.linkedTo, undefined);
  assert.equal(drawTwo.condition, undefined);
});

test("unl-091-219 Concentrate golden: Draw 2 draws two cards for the caster", () => {
  const kernel = world().player("A").deck(["card-one", "card-two", "card-three"]).build();
  const run = runInstruction(draw, { amount: drawTwo.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("unl-091-219 Concentrate golden: a short deck still draws as many as possible (432.1.c)", () => {
  const kernel = world().deck(["only-card"]).build();
  const run = runInstruction(draw, { amount: drawTwo.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
});

test.todo(
  "unl-091-219 Concentrate: apply the printed Energy cost discount in the Finalize cost plan (CR 356.4) — " +
    "cost/plan-values.ts readCost blocks card-declared discounts; only CostPlanInput.discounts applies them (RIFT-89)"
);

test.todo(
  "unl-091-219 Concentrate: evaluate the [Level 6]/[Level 11] XP thresholds and pick exactly one 'instead' discount " +
    "(CR 824.1.b.1 / 824.1.c) — the Level predicate has no consumer and PlayerSnapshot.xp has no Expr path"
);
