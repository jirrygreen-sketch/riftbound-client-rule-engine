import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/treasure-hoard.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

test("treasure-hoard: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("treasure-hoard: optional conquer structure with pay, token and play", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Gold gear token/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.optional, true);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["treasure-hoard.opt-in"]);
  const [choice] = ability.body;
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  const body = choice.args.body.value;
  const ids = body.map(instruction => instruction.id);
  assert.deepEqual(ids, [
    "treasure-hoard.pay",
    "treasure-hoard.create",
    "treasure-hoard.play"
  ]);
  assert.equal(body[0].op, "cost.pay");
  assert.deepEqual(body[0].args.energy, { kind: "constant", value: 1 });
  assert.equal(body[0].linkedTo, undefined);
  assert.equal(body[1].op, "effect.token");
  assert.equal(body[1].linkedTo, "treasure-hoard.pay");
  assert.deepEqual(body[1].args.token, { kind: "constant", value: "gold" });
  assert.equal(body[2].op, "effect.play");
  assert.equal(body[2].linkedTo, "treasure-hoard.create");
});

test("treasure-hoard: declining skips payment, creation and token play", () => {
  const kernel = world().build();
  kernel.setAnswers({ "treasure-hoard.opt-in/optional": false });
  const outcome = runAbilityBody(program.abilities[0].body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["treasure-hoard.opt-in"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
});

// Gold token definition, chain-create + cost-waived play flow and the
// exhausted entry override are all unmerged (see judgeReason); no part of the
// body can be honestly executed with the reference kernel.
test.todo("treasure-hoard: Gold gear token definition (RIFT-81~91)");
test.todo("treasure-hoard: chain-create + cost-waived play of the token (RIFT-81~91)");
test.todo("treasure-hoard: exhausted entry override on the created token (RIFT-81~91)");
