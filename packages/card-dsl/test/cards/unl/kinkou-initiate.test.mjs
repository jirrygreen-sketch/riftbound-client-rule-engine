import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/kinkou-initiate.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-578f670d7fdae87fd32e34179e331f901a8f108dcb51c337c971db00b3e3c498";
const SOURCE_TEXT = "When you play me, draw 1 if your other units have total Might 5 or more.";

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("unl-097-219 Kinkou Initiate: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-097-219 Kinkou Initiate: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /143\.2\.a\.1/);
  assert.match(program.judgeReason, /total Might/);
  assert.match(program.judgeReason, /count/);
});

test("unl-097-219 Kinkou Initiate: 'when you play me' trigger is the card-played Play Effect", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-097-219 Kinkou Initiate: the gate sits on the draw instruction, not on the trigger", () => {
  // 383.2.a.1: "if …" follows the instruction, so it is part of the Effect; the
  // Loose Cannon example in the Core Rules has the same structure.
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "kinkou-initiate.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  // The draw is the implicit "you" = the ability controller (190.6.d).
  assert.equal(drawInstruction.args.player, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);

  const condition = drawInstruction.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-friendly-units-total-might");
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    exclude: "self"
  });
});

test("unl-097-219 Kinkou Initiate golden: the merged effect.draw instruction really draws 1", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("unl-097-219 Kinkou Initiate: the retained sum-of-Might gate does not evaluate as a count", () => {
  // 143.2.a.1: "total Might" is the sum of Effective Might over the filtered set.
  // The merged `count` expression counts objects, so the placeholder subject and
  // its filter must not be read as an equivalent gate: three 1-Might units count
  // as 3 even though their total Might is also 3, and a single 4-Might unit
  // counts as 1 while its Might is 4 — the two differ by construction.
  const kernel = world()
    .unit("strong", { might: 4 })
    .unit("weak", { might: 1 })
    .build();
  const counted = kernel.query({
    type: "unit",
    controller: "A",
    exclude: "self"
  }).length;
  assert.equal(counted, 2, "the placeholder counts objects, not Might");
  const totalMight = kernel
    .query({ type: "unit", controller: "A" })
    .reduce((sum, unit) => sum + unit.might, 0);
  assert.equal(totalMight, 5);
  assert.notEqual(counted, totalMight);
});

test.todo(
  "unl-097-219 Kinkou Initiate: evaluate 'your other units have total Might 5 or more' " +
    "as a sum of Effective Might over the filtered set (143.2.a.1) — the frozen Expr algebra has " +
    "no sum-over-set form (contract 3.2 Expr); depends on the expression/`condition.predicate` workstream (RIFT-9 expression inventory, RIFT-89/90 condition pipeline)"
);
