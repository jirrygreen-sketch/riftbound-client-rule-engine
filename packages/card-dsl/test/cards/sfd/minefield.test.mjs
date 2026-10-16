import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minefield.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.equal(instruction.op, "effect.mill");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(instruction.args.player, undefined);
});

test("minefield: the supported body mills the controller's top 2 cards", () => {
  const kernel = world().deck(["top", "second", "third"], { owner: "A" }).build();
  const instruction = program.abilities[0].body[0];
  const outcome = resolveChainBody([instruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 2);
  assert.deepEqual(kernel.zoneSlice("A", "trash", "top").map((object) => object.ref.id), ["top", "second"]);
  assert.deepEqual(kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id), ["third"]);
});

test.todo(
  "minefield: the conquer trigger must enforce the printed battlefield-relative here restriction " +
    "through CardProgram trigger registration and EventPattern host-location matching (RIFT-257)"
);
