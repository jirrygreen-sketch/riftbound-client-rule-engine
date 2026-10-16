import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sunken-temple.js";

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
  const ids = ability.body.map(instruction => instruction.id);
  assert.deepEqual(ids, ["sunken-temple.opt-in", "sunken-temple.pay", "sunken-temple.draw"]);
  assert.equal(ability.body[0].op, "choice.optional");
  assert.equal(ability.body[1].op, "cost.pay");
  assert.deepEqual(ability.body[1].args.energy, { kind: "constant", value: 1 });
  assert.equal(ability.body[2].op, "effect.draw");
  assert.deepEqual(ability.body[2].args.amount, { kind: "constant", value: 1 });
  assert.equal(ability.body[2].linkedTo, "sunken-temple.pay");
});

// The draw primitive (effect.draw) is merged, but the ability cannot be
// honestly executed end-to-end: the Might>=5 trigger condition has no
// predicate/payload support, and cost.pay has no merged primitive.
test.todo("sunken-temple: Mighty predicate / conquer-payload Might filter (RIFT-81~91)");
test.todo("sunken-temple: cost.pay primitive for the energy payment (RIFT-81~91)");
test.todo("sunken-temple: draw-1 execution once the trigger condition is evaluable (RIFT-81~91)");
