import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sunken-temple.js";
import effectDraw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("sunken-temple: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("sunken-temple: conquer-with-Mighty structure with pay and draw", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Mighty/);
  assert.match(program.judgeReason, /mightGte|is-mighty/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /here/);
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

test("sunken-temple: the merged draw primitive executes the printed draw-1 for real", () => {
  // The card's own draw args (amount 1) are executed through the merged
  // effect.draw primitive; the missing half is only the cost.pay instruction
  // that the card links it to (see the test.todo below).
  const kernel = world().deck("top-card").build();
  const [choice] = program.abilities[0].body;
  const [, drawInstruction] = choice.args.body.value;
  const run = runInstruction(effectDraw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.zone("A", "hand").length, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(drawInstruction.linkedTo, "sunken-temple.pay");
});

test.todo("sunken-temple: the here anchor on the conquer event needs an event-payload location selector (RIFT-120)");
test.todo("sunken-temple: an is-mighty/mightGte predicate inside the trigger condition count (Mighty keyword expansion is merged; the filter vocabulary is not)");
test.todo("sunken-temple: the cost.pay primitive for the printed 1-energy payment (RIFT-261)");
test.todo("sunken-temple: end-to-end trigger registration through the card-program binding once the condition and payment exist (RIFT-257)");
