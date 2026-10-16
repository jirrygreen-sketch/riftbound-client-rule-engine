import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minefield.js";

test("minefield: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("minefield: triggered conquer structure", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect.mill/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.trigger.filter.event, "conquer");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.trigger.filter.player, "controller");
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  const instruction = ability.body[0];
  assert.equal(instruction.op, "effect.zone");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.to, { kind: "constant", value: "trash" });
});

// The mill execution cannot be asserted with the reference kernel: no merged
// primitive submits the "mill" GameAction (effect.zone only performs
// per-object move-zone on target/pick refs). Tracked under RIFT-81~91.
test.todo("minefield: mills the top 2 deck cards to trash via a mill primitive (RIFT-81~91)");
test.todo("minefield: conquer timing-point wiring fires the trigger from scoring (RIFT-81~91)");
