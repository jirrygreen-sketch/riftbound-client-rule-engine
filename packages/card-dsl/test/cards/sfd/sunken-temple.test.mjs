import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sunken-temple.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

test("sunken-temple: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("sunken-temple: conquer-with-Mighty structure with pay and draw", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Mighty predicate/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.optional, true);
  // The Might>=5 gate is a trigger condition (CR v1.5 706–709).
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.filter.mightGte, 5);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["sunken-temple.opt-in"]);
  const [choice] = ability.body;
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  const [pay, draw] = choice.args.body.value;
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), ["sunken-temple.pay", "sunken-temple.draw"]);
  assert.equal(pay.op, "cost.pay");
  assert.equal(pay.linkedTo, undefined);
  assert.deepEqual(pay.args.energy, { kind: "constant", value: 1 });
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
  assert.equal(draw.linkedTo, "sunken-temple.pay");
});

test("sunken-temple: declining skips both payment and draw", () => {
  const kernel = world().deck("top-card").build();
  kernel.setAnswers({ "sunken-temple.opt-in/optional": false });
  const outcome = runAbilityBody(program.abilities[0].body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["sunken-temple.opt-in"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.zone("A", "deck").length, 1);
  assert.equal(kernel.zone("A", "hand").length, 0);
});

// The draw primitive (effect.draw) is merged, but the ability cannot be
// honestly executed end-to-end: the Might>=5 trigger condition has no
// predicate/payload support, and cost.pay has no merged primitive.
test.todo("sunken-temple: Mighty predicate / conquer-payload Might filter (RIFT-81~91)");
test.todo("sunken-temple: cost.pay primitive for the energy payment (RIFT-81~91)");
test.todo("sunken-temple: draw-1 execution once the trigger condition is evaluable (RIFT-81~91)");
