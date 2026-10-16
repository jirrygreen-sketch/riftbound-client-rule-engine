import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/treasure-hoard.js";

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
  const ids = ability.body.map(instruction => instruction.id);
  assert.deepEqual(ids, [
    "treasure-hoard.opt-in",
    "treasure-hoard.pay",
    "treasure-hoard.create",
    "treasure-hoard.play"
  ]);
  assert.equal(ability.body[0].op, "choice.optional");
  assert.equal(ability.body[1].op, "cost.pay");
  assert.deepEqual(ability.body[1].args.energy, { kind: "constant", value: 1 });
  assert.equal(ability.body[1].linkedTo, "treasure-hoard.opt-in");
  assert.equal(ability.body[2].op, "effect.token");
  assert.deepEqual(ability.body[2].args.token, { kind: "constant", value: "gold" });
  assert.equal(ability.body[3].op, "effect.play");
  assert.equal(ability.body[3].linkedTo, "treasure-hoard.create");
});

// Gold token definition, chain-create + cost-waived play flow and the
// exhausted entry override are all unmerged (see judgeReason); no part of the
// body can be honestly executed with the reference kernel.
test.todo("treasure-hoard: Gold gear token definition (RIFT-81~91)");
test.todo("treasure-hoard: chain-create + cost-waived play of the token (RIFT-81~91)");
test.todo("treasure-hoard: exhausted entry override on the created token (RIFT-81~91)");
